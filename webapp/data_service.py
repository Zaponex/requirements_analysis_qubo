"""Datenschicht der Website: lädt Simulationsläufe über den Analyse-Code (Stufe 1) und
liefert sie als JSON-taugliche Strukturen.

Die Website rechnet nichts Eigenes am Ursprungsproblem – sie nutzt dieselben Funktionen
wie analysis/analysis.py (loader, features, checks). So zeigen Website und PNG-Berichte
garantiert dieselben Zahlen.
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "analysis"))
sys.path.insert(0, str(ROOT / "encodings"))
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))  # hw/ (Hardware-Abbildung)

from checks import run_checks  # noqa: E402
from features import WINDOW_SIZES, run_summary, task_features, task_robot_matrix  # noqa: E402
from cost_model import (  # noqa: E402
    CRITERIA, CRITERIA_BY_KEY, IA_CRITERIA, PARAMS, SEQUENCE_CRITERIA, SEQUENCE_NOTE, STRUCTURAL,
)
from formulations import (  # noqa: E402
    aux_estimates, best_assignment, binary, binary_default_weights, binary_ia, build_ia_instance, build_instance,
    build_sequence_instance, couplings, default_weights, domain_wall, domain_wall_ia, dw_default_weights, exact_optimum,
    ia_bin_default_weights, ia_default_weights, ia_dw_default_weights, ia_sizes, ia_valid_plans, one_hot, one_hot_ia,
    one_hot_sequence,
)
import baukasten  # noqa: E402
import workload  # noqa: E402
import paper_figures  # noqa: E402
import resources  # noqa: E402
from loader import PATH_SENTINEL_THRESHOLD, find_runs, load_run  # noqa: E402

DEFAULT_DATA_DIR = ROOT / "data" / "transport_logs"

ASSUMPTIONS = [
    "Bereich eines Auftrags: Bereich der Abholmaschine; ist die Abholung keine Maschine (Lager, Quelle), "
    "der Bereich der Zielmaschine; sonst kein Bereich (jeder Roboter zuständig).",
    "In Frage kommender Roboter: im Snapshot der Anfrage available = True und Auftragsbereich in seiner "
    "area_of_responsibility.",
    "Distanz Roboter → Abholort: Manhattan-Distanz auf den geloggten Koordinaten (keine Pfadplanung).",
    f"Pfadlängen ≥ {PATH_SENTINEL_THRESHOLD} gelten als Sentinel („unerreichbar“) und zählen als fehlend.",
    "Flotten-Snapshots gibt es nur zu Anfragezeitpunkten – dazwischen ist der Zustand der Roboter unbekannt.",
]


def _records(df: pd.DataFrame) -> list[dict]:
    """DataFrame → Liste von Dicts; NaN wird zu null, Tupel zu Listen, numpy-Typen zu Python-Typen."""
    return json.loads(df.to_json(orient="records", force_ascii=False))


class DataService:
    """Liest Läufe aus dem Datenordner und hält sie im Speicher, bis sich die Dateien ändern."""

    def __init__(self, data_dir: str | Path | None = None):
        self.data_dir = Path(data_dir or os.environ.get("QUBO_DATA_DIR") or DEFAULT_DATA_DIR)
        self._cache: dict[str, tuple[tuple, dict]] = {}
        self._baukasten_cache: dict[tuple, dict] = {}  # echtes Problem je Szenario (exaktes Optimum ist teuer)

    def _runs(self) -> dict[str, tuple[Path, Path]]:
        return find_runs(self.data_dir)

    @staticmethod
    def _stamp(paths: tuple[Path, Path]) -> tuple:
        return tuple((p.stat().st_mtime_ns, p.stat().st_size) for p in paths)

    def run_ids(self) -> list[str]:
        return sorted(self._runs())

    def payload(self, run_id: str) -> dict:
        """Alles, was die Oberfläche für einen Lauf braucht – einmal laden, dann im Browser filtern."""
        runs = self._runs()
        if run_id not in runs:
            raise KeyError(run_id)
        stamp = self._stamp(runs[run_id])
        cached = self._cache.get(run_id)
        if cached and cached[0] == stamp:
            return cached[1]

        run = load_run(run_id, *runs[run_id])
        matrix = task_robot_matrix(run)
        tasks = task_features(run, matrix)
        summary = run_summary(run, tasks)
        findings = run_checks(run)

        fleet = run.fleet[["transport_id", "time", "robot_id", "status", "x", "y", "battery_percent", "aor",
                           "available"]]
        robots = run.robots.assign(aor=run.robots["aor"].map(list))
        payload = {
            "run_id": run_id,
            "files": [p.name for p in runs[run_id]],
            "summary": json.loads(json.dumps(summary, default=float)),
            "findings": [asdict(f) for f in findings],
            "assumptions": ASSUMPTIONS,
            "tasks": _records(tasks),
            "fleet": _records(fleet.assign(aor=fleet["aor"].map(list))),
            "entities": _records(run.entities),
            "robots": _records(robots),
            "matrix": _records(matrix),
            "meta": {"sentinel_threshold": PATH_SENTINEL_THRESHOLD, "window_sizes": list(WINDOW_SIZES)},
        }
        self._cache[run_id] = (stamp, payload)
        return payload

    def one_hot(self, run_id: str, task_ids: list[int], variables: str = "kandidaten",
                criterion: str = "leerfahrt", params: dict | None = None) -> dict:
        """Lern-Instanz aus gewählten Aufträgen + One-Hot-Formulierung (Regeln und QUBO-Einträge).

        Liefert außerdem den Katalog der Bewertungskriterien und Kostenparameter für die Auswahl.
        """
        p = self.payload(run_id)
        instance = build_instance(p["tasks"], p["fleet"], task_ids, variables, criterion, params)
        return {
            "run_id": run_id,
            "instance": instance,
            "formulation": one_hot(instance),
            "catalog": {"criteria": CRITERIA, "structural": STRUCTURAL, "params": PARAMS, "sequence_note": SEQUENCE_NOTE},
        }

    def ia_one_hot(self, run_id: str, task_ids: list[int], robot_ids: list[int] | None = None,
                   variables: str = "kandidaten", criterion: str = "fahrstrecke", params: dict | None = None) -> dict:
        """Sofortzuweisung (IA) mit One-Hot: Fall T : R, Formulierung, bester gültiger Plan und für jedes
        IA-Kriterium die Spanne der c_tr und der beste Plan (Vergleich der Kriterien im selben Moment)."""
        instance, common = self._ia_common(run_id, task_ids, robot_ids, variables, criterion, params)
        return {**common, "formulation": one_hot_ia(instance), "weights": ia_default_weights(instance)}

    def ia_domain_wall(self, run_id: str, task_ids: list[int], robot_ids: list[int] | None = None,
                       variables: str = "kandidaten", criterion: str = "fahrstrecke", params: dict | None = None) -> dict:
        """Sofortzuweisung (IA) mit Domain Wall: Ketten je Auftrag (T ≤ R) bzw. je Roboter (T > R), Querregel,
        Empfehlung für A (Kette) und B (Querregel), Vergleich mit One-Hot – sonst wie ia_one_hot."""
        instance, common = self._ia_common(run_id, task_ids, robot_ids, variables, criterion, params)
        form = domain_wall_ia(instance)
        oh = one_hot_ia(instance)
        return {**common, "formulation": form, "weights": ia_dw_default_weights(instance, form),
                "one_hot": {"n": oh["n"], "couplings": sum(1 for e in oh["entries"] if e["i"] != e["j"])}}

    def ia_binary(self, run_id: str, task_ids: list[int], robot_ids: list[int] | None = None,
                  variables: str = "kandidaten", criterion: str = "fahrstrecke", params: dict | None = None) -> dict:
        """Sofortzuweisung (IA) mit Binary: Code je Auftrag (T ≤ R) bzw. je Roboter (T > R), Polynom, Hilfsbits, QUBO,
        Empfehlung für A, B und M, Vergleich mit One-Hot und Domain Wall (dieser Moment und T = 1 … 6) – sonst wie ia_one_hot."""
        instance, common = self._ia_common(run_id, task_ids, robot_ids, variables, criterion, params)
        form = binary_ia(instance)
        oh, dw = one_hot_ia(instance), domain_wall_ia(instance)
        return {**common, "formulation": form, "weights": ia_bin_default_weights(instance, form),
                "compare": {"one_hot": {"n": oh["n"], "couplings": couplings(oh)},
                            "domain_wall": {"n": dw["n"], "couplings": couplings(dw)}},
                "sizes": ia_sizes(len(instance["robots"]))}

    def ta_workload(self, run_id: str, encoding: str, task_ids: list[int], robot_ids: list[int] | None = None,
                    variables: str = "kandidaten", measure: str = "zeit", parts: list[str] | None = None,
                    vorlast: str = "status", params: dict | None = None) -> dict:
        """TA mit Lastverteilung (H = H_obj + A·H_pen + B·H_WB): Instanz mit Lasten c_tr und Vorlast L_r,0, Formulierung
        der Kodierung, Gewichtsempfehlung (A als Funktion von B), Vergleich der drei Kodierungen und Größen für T = 1 … 6."""
        p = self.payload(run_id)
        instance = workload.build_wb_instance(p["tasks"], p["fleet"], task_ids, robot_ids, variables, measure, parts, vorlast,
                                              params)
        forms = {enc: workload.wb_formulation(instance, enc) for enc in workload.ENCODINGS}
        form = forms[encoding]
        n_plans = 1
        for t in instance["tasks"]:
            n_plans *= sum(1 for v in instance["variables"] if v["task_id"] == t["transport_id"])
        return {
            "run_id": run_id,
            "instance": instance,
            "formulation": form,
            "weights": workload.wb_default_weights(instance, form),
            "compare": {enc: {"n": f["n"], "couplings": couplings(f), "aux": len(f["aux"])} for enc, f in forms.items()},
            "sizes": workload.wb_sizes(len(instance["robots"])),
            "n_plans": n_plans,
            "catalog": {"measures": list(workload.WB_MEASURES.values()), "parts": workload.WB_PARTS,
                        "vorlast": list(workload.VORLAST_MODES.values()),
                        "params": {k: PARAMS[k] for k in workload.WB_PARAM_KEYS}},
        }

    def resources(self, run_id: str, cases: list[dict]) -> list[dict]:
        """Reiter Ressourcen: je Fall (Klasse, Kodierung, Variante, Szenario) die Kennzahlen K1–K6 und die Prüfung des Minimums.
        Ein fehlerhafter Fall liefert {"error": …} und blockiert die anderen nicht."""
        payload = self.payload(run_id)
        out = []
        for spec in cases:
            try:
                out.append(resources.evaluate(payload, spec))
            except ValueError as exc:
                out.append({"error": str(exc)})
        return out

    def hardware(self) -> dict:
        """Reiter Hardware: Ergebnisse der Hardware-Abbildung (results/<hardware>.json) – nur gelesen, nichts neu gerechnet."""
        from hw import common, make_figures  # erst hier: dimod und matplotlib braucht nur dieser Reiter
        return {"hardware": [{**common.overview(h, make_figures.METRIC[h][0]), "title": make_figures.TITLES[h],
                              "metric": {"field": make_figures.METRIC[h][0], "label": make_figures.METRIC[h][1]}}
                             for h in make_figures.available()],
                "orders": list(common.ORDERS), "fleet": "m = n/2"}

    def hardware_figure(self, names: list[str], grayscale: bool) -> dict:
        """Abbildung (SVG) aus den gespeicherten Ergebnissen, eine Spalte je gewählter Hardware."""
        from hw import make_figures
        return {"svg": make_figures.render(names or make_figures.available(), "svg", grayscale).decode("utf-8")}

    def resources_sizes(self, cls: str, ratio: str, R: int, grayscale: bool, hardware_limits: bool = True) -> dict:
        """Verlauf über gemischte Instanzgrößen T × R (nur Struktur): Daten und die Abbildung als SVG.

        hardware_limits: das größte auf jeder Hardware abgebildete Problem (Modell A für IA, B für TA, aus results/*.json) als
        Strich-Punkt-Linie in jedem Feld – gibt es noch keine Ergebnisse, bleibt die Abbildung wie ohne."""
        if cls not in resources.CLASSES:
            raise ValueError(f"Klasse muss eine von {resources.CLASSES} sein")
        data = resources.size_series(cls, "paar" if cls == "IA" else "wb", ratio, R)
        refs = self._hardware_limits("A" if cls == "IA" else "B") if hardware_limits else []
        return {**data, "limits": refs, "svg": paper_figures.render_sizes(data, R, grayscale, "svg", refs).decode("utf-8")}

    def _hardware_limits(self, model: str) -> list[dict]:
        from hw import common, make_figures  # erst hier: dimod braucht nur die Hardware-Reiter
        out = []
        for h in make_figures.available():
            r = common.reach(h, model)
            if r:
                out.append({"label": make_figures.SHORT[h] + ("" if r["complete"] else " (partial)"), "hardware": h, **r})
        return out

    def resources_timeline(self, run_id: str, templates: list[dict], cut: str, window: float, robots: str) -> dict:
        """Verlauf über einen Lauf: echte Instanzgrößen je Anfrage und die Kennzahlen jeder Vorlage."""
        return resources.timeline(self.payload(run_id), templates, cut, window, robots)

    def _ia_common(self, run_id: str, task_ids: list[int], robot_ids: list[int] | None, variables: str, criterion: str,
                   params: dict | None) -> tuple[dict, dict]:
        """Instanz, bester gültiger Plan und für jedes IA-Kriterium Spanne der c_tr und bester Plan (Vergleich im selben
        Moment) – unabhängig von der Kodierung."""
        if criterion not in IA_CRITERIA:
            raise ValueError(f"Kriterium {criterion} ist in der Sofortzuweisung nicht vorgesehen")
        p = self.payload(run_id)
        instance = build_ia_instance(p["tasks"], p["fleet"], task_ids, robot_ids, variables, criterion, params)
        robots = [r["robot_id"] for r in instance["robots"]]
        overview = []
        for key in IA_CRITERIA:
            inst = instance if key == criterion else build_ia_instance(p["tasks"], p["fleet"], task_ids, robots, variables,
                                                                       key, params)
            costs = [v["cost"] for v in inst["variables"]]
            plans = ia_valid_plans(inst)
            overview.append({"key": key, "min": min(costs, default=0.0), "max": max(costs, default=0.0),
                             "best": plans[0] if plans else None, "plans": len(plans)})
        plans = ia_valid_plans(instance)
        return instance, {
            "run_id": run_id,
            "instance": instance,
            "best": plans[0] if plans else None,
            "n_valid": len(plans),
            "overview": overview,
            "catalog": {"criteria": [CRITERIA_BY_KEY[k] for k in IA_CRITERIA], "params": PARAMS},
        }

    def domain_wall(self, run_id: str, task_ids: list[int], variables: str = "kandidaten", criterion: str = "leerfahrt",
                    params: dict | None = None, order: str = "nummer") -> dict:
        """Lern-Instanz (wie One-Hot) + Domain-Wall-Formulierung, beste gültige Zuweisung und
        der Vergleich mit One-Hot für dieselben Aufträge."""
        p = self.payload(run_id)
        instance = build_instance(p["tasks"], p["fleet"], task_ids, variables, criterion, params)
        form = domain_wall(instance, order)
        oh = one_hot(instance)
        return {
            "run_id": run_id,
            "instance": instance,
            "formulation": form,
            "weights": dw_default_weights(instance),
            "best": best_assignment(instance),
            "one_hot": {"n": oh["n"], "couplings": sum(1 for e in oh["entries"] if e["i"] != e["j"])},
            "catalog": {"criteria": CRITERIA, "structural": STRUCTURAL, "params": PARAMS, "sequence_note": SEQUENCE_NOTE},
        }

    def binary(self, run_id: str, task_ids: list[int], variables: str = "kandidaten", criterion: str = "leerfahrt",
               params: dict | None = None, order: str = "nummer") -> dict:
        """Lern-Instanz + Binary-Formulierung (Polynom, Hilfsbits, QUBO), beste Zuweisung und der
        Vergleich mit One-Hot und Domain Wall für dieselben Aufträge."""
        p = self.payload(run_id)
        instance = build_instance(p["tasks"], p["fleet"], task_ids, variables, criterion, params)
        form = binary(instance, order)
        couplings = lambda f: sum(1 for e in f["entries"] if e["i"] != e["j"])  # noqa: E731
        oh, dw = one_hot(instance), domain_wall(instance, order)
        return {
            "run_id": run_id,
            "instance": instance,
            "formulation": form,
            "weights": binary_default_weights(instance, form),
            "best": best_assignment(instance),
            "compare": {"one_hot": {"n": oh["n"], "couplings": couplings(oh)},
                        "domain_wall": {"n": dw["n"], "couplings": couplings(dw)}},
            "catalog": {"criteria": CRITERIA, "structural": STRUCTURAL, "params": PARAMS, "sequence_note": SEQUENCE_NOTE},
        }

    def sequence(self, run_id: str, task_ids: list[int], variables: str = "kandidaten",
                 criterion: str = "erledigungszeit", slots: int = 2, params: dict | None = None) -> dict:
        """Zuweisung mit Reihenfolge: Instanz, Formulierung mit Positions-Hilfsvariablen, exaktes Optimum
        und der Vergleich mit Sofortzuweisung und anderen Hilfsvariablen-Ansätzen."""
        p = self.payload(run_id)
        instance = build_sequence_instance(p["tasks"], p["fleet"], task_ids, variables, criterion, slots, params)
        form = one_hot_sequence(instance)
        n_tasks = len(instance["tasks"])
        ia_instance = build_sequence_instance(p["tasks"], p["fleet"], task_ids, variables, criterion, 1, params)
        ia_form = one_hot_sequence(ia_instance)
        exact = exact_optimum(instance)
        return {
            "run_id": run_id,
            "instance": instance,
            "formulation": form,
            "weights": default_weights(instance),
            "exact": exact,
            # ohne Platzgrenze (jeder Roboter darf alle Aufträge fahren) – zeigt, ob K reicht
            "exact_free": exact_optimum(instance, max_per_robot=n_tasks) if instance["slots"] < n_tasks else exact,
            "exact_ia": exact_optimum(ia_instance),
            "estimates": aux_estimates(instance, form, ia_form),
            "catalog": {"criteria": SEQUENCE_CRITERIA, "params": {k: PARAMS[k] for k in ("v", "t_lade", "t_ent", "t_rest")}},
        }

    def baukasten(self, run_id: str, body: dict) -> dict:
        """Formel-Baukasten: das echte Problem (Instanz, exaktes Optimum – zwischengespeichert)
        plus die Formulierung aus den gesendeten Bausteinen (oder einer Voreinstellung)."""
        try:
            task_ids = [int(t) for t in body.get("tasks", [])]
            slots = int(body.get("plaetze", 1))
        except (TypeError, ValueError):
            raise ValueError("tasks muss eine Liste von Auftragsnummern sein, plaetze eine Zahl") from None
        variables = body.get("variables", "kandidaten")
        criterion = body.get("kriterium", "erledigungszeit")
        params = body.get("params") or {}
        if not isinstance(params, dict):
            raise ValueError("params muss ein Objekt sein")
        base = self._baukasten_base(run_id, task_ids, variables, criterion, slots, params)
        inst = base["instance"]
        encodings = baukasten.resolve_encodings(inst, body.get("kodierung"))
        order = body.get("reihenfolge") or "nummer"
        presets = baukasten.presets(inst, encodings)
        preset = body.get("preset") or baukasten.default_preset(inst)
        preset = baukasten.PRESET_ALIASES.get(preset, preset)
        if preset not in presets:
            raise ValueError(f"Unbekannte Voreinstellung: {preset}")
        form = baukasten.build(inst, body.get("terms") or presets[preset], encodings, order)
        return {**base, "presets": presets, "default_preset": baukasten.default_preset(inst),
                "requirements": form["requirements"], "terms": [baukasten.spec_of(t) for t in form["terms"]],
                "formulation": form}

    def _baukasten_base(self, run_id: str, task_ids: list[int], variables: str, criterion: str, slots: int,
                        params: dict) -> dict:
        runs = self._runs()
        if run_id not in runs:
            raise KeyError(run_id)
        key = (run_id, self._stamp(runs[run_id]), tuple(task_ids), variables, criterion, slots,
               json.dumps(params, sort_keys=True))
        cache = self._baukasten_cache
        if key not in cache:
            p = self.payload(run_id)
            inst = baukasten.build_baukasten_instance(p["tasks"], p["fleet"], task_ids, variables, criterion, slots, params)
            n_tasks = len(inst["tasks"])
            exact = exact_optimum(inst)
            allowed = SEQUENCE_CRITERIA + ([c for c in CRITERIA if c["key"] not in {s["key"] for s in SEQUENCE_CRITERIA}]
                                           if inst["slots"] == 1 else [])
            if len(cache) > 32:
                cache.clear()
            cache[key] = {
                "run_id": run_id,
                "instance": inst,
                "exact": exact,
                # ohne Platzgrenze nur bei echten Ablaufplänen sinnvoll (feste c_tr kennen keine Reihenfolge)
                "exact_free": (exact_optimum(inst, max_per_robot=n_tasks)
                               if inst["slots"] < n_tasks and inst["objective"] == "ablauf" else exact),
                # alle gültigen Pläne (die besten): Was kostet jeder Baustein bei gültigen Plänen?
                "plans": baukasten.valid_plans(inst),
                "weights": baukasten.default_term_weights(inst),
                "catalog": {"criteria": allowed,
                            "params": {k: PARAMS[k] for k in ("v", "t_lade", "t_ent", "t_rest")}},
            }
        return cache[key]

    def overview(self) -> list[dict]:
        """Kennzahlen aller Läufe (für Laufauswahl und Lauf-Vergleich)."""
        out = []
        for run_id in self.run_ids():
            try:
                p = self.payload(run_id)
                n_warn = sum(f["level"] == "Warnung" for f in p["findings"])
                out.append({**p["summary"], "n_warnings": n_warn, "error": None})
            except Exception as exc:  # ein kaputter Lauf soll die Übersicht nicht blockieren
                out.append({"run_id": run_id, "error": f"{type(exc).__name__}: {exc}"})
        return out
