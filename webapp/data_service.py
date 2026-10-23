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

from checks import run_checks  # noqa: E402
from features import WINDOW_SIZES, run_summary, task_features, task_robot_matrix  # noqa: E402
from cost_model import CRITERIA, PARAMS, SEQUENCE_CRITERIA, SEQUENCE_NOTE, STRUCTURAL  # noqa: E402
from formulations import (  # noqa: E402
    aux_estimates, best_assignment, build_instance, build_sequence_instance, default_weights, domain_wall,
    dw_default_weights, exact_optimum, one_hot, one_hot_sequence,
)
import baukasten  # noqa: E402
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
        preset = body.get("preset") or baukasten.default_preset(inst)
        if preset not in base["presets"]:
            raise ValueError(f"Unbekannte Voreinstellung: {preset}")
        terms = body.get("terms") or base["presets"][preset]
        return {**base, "terms": terms, "formulation": baukasten.build(inst, terms)}

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
                "requirements": baukasten.requirements(inst),
                "presets": baukasten.presets(inst),
                "default_preset": baukasten.default_preset(inst),
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
