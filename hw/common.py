"""Gemeinsame Teile der Hardware-Abbildung: Datensatz-Schema, Instanzgitter (Export), Ergebnis-Cache.

Der Gitterexport results/instances.json hält je Instanz die Kantenliste der QUBO (Struktur, ohne Koeffizienten), damit jede Hardware
dieselben Instanzen abbildet. Ergebnisse stehen in results/<hardware>.json und werden nur ergänzt, nie neu gerechnet.
"""
from __future__ import annotations

import json
import os
import time
from itertools import product
from pathlib import Path

import dimod

from .models import ENCODINGS, MODELS, ORDERS, analyse, build, fleet

RESULTS = Path(__file__).resolve().parent.parent / "results"
INSTANCES = RESULTS / "instances.json"
STATUSES = ("mapped", "not_found", "exceeds_limit")
# mapped: gültige Abbildung gefunden · not_found: Heuristik in allen Seeds im Zeitlimit gescheitert (im Paper „not mapped“,
# nie „not mappable“) · exceeds_limit: ein hartes Limit ist verletzt (sicher)


def grid() -> list[tuple[str, str, int]]:
    """Alle Instanzen (Model, Kodierung, n) in der Reihenfolge wachsender n."""
    return sorted(product(MODELS, ENCODINGS, ORDERS), key=lambda k: (k[2], k[0], list(ENCODINGS).index(k[1])))


def instance_id(model: str, enc: str, n: int) -> str:
    return f"{model}-{enc}-{n}"


def blank_record(hardware: str, bqm: dimod.BinaryQuadraticModel, seed: int) -> dict:
    """Datensatz im gemeinsamen Schema; model, encoding und n trägt der Aufrufer ein."""
    return {"hardware": hardware, "model": None, "encoding": None, "n": None, "seed": seed,
            "logical_qubits": bqm.num_variables, "couplings": bqm.num_interactions, "status": "not_found",
            "physical_qubits": None, "max_chain": None, "mean_chain": None, "two_qubit_gates": None, "depth": None, "runtime_s": 0.0}


def export_instances(path: Path = INSTANCES) -> dict:
    """Baut das ganze Gitter einmal und schreibt Kantenlisten (Struktur) nach results/instances.json."""
    out = {"orders": list(ORDERS), "fleet": "m = n/2", "models": {m: list(v) for m, v in MODELS.items()}, "instances": {}}
    for model, enc, n in grid():
        a = analyse(build(model, enc, n, fleet(n)))
        bqm = a["bqm"]
        out["instances"][instance_id(model, enc, n)] = {
            "model": model, "encoding": enc, "n": n, "R": fleet(n), "qubits": a["n"], "couplings": a["couplings"], "aux": a["aux"],
            "linear": sorted(v for v, c in bqm.linear.items() if c != 0.0), "edges": sorted([u, v] if u < v else [v, u] for u, v in bqm.quadratic)}
    write_json(path, out)
    return out


def load_instances(path: Path = INSTANCES) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def bqm_of(inst: dict) -> dimod.BinaryQuadraticModel:
    """BQM einer exportierten Instanz: nur die Struktur zählt (Kopplung 1.0, Feld 1.0, alle Knoten vorhanden, auch isolierte)."""
    bqm = dimod.BinaryQuadraticModel("BINARY")
    for v in range(inst["qubits"]):
        bqm.add_variable(v, 0.0)
    for v in inst["linear"]:
        bqm.set_linear(v, 1.0)
    for u, v in inst["edges"]:
        bqm.set_quadratic(u, v, 1.0)
    return bqm


def aggregate(records: list[dict]) -> dict[tuple[str, str, int], dict]:
    """Je Instanz (Model, Kodierung, n) über alle Seeds: Status, bestes Ergebnis und Streuung.

    Status: mapped, sobald ein Seed gültig abgebildet hat; exceeds_limit, wenn jeder Seed ein hartes Limit verletzt; sonst not_found.
    Das beste Ergebnis ist das kleinste physical_qubits (Annealer) bzw. two_qubit_gates (Gatter) unter den gelungenen Seeds."""
    groups: dict[tuple[str, str, int], list[dict]] = {}
    for r in records:
        groups.setdefault((r["model"], r["encoding"], r["n"]), []).append(r)
    out = {}
    for key, recs in groups.items():
        ok = [r for r in recs if r["status"] == "mapped"]
        status = "mapped" if ok else "exceeds_limit" if all(r["status"] == "exceeds_limit" for r in recs) else "not_found"
        agg = {"status": status, "seeds": len(recs), "mapped_seeds": len(ok), "logical_qubits": recs[0]["logical_qubits"], "couplings": recs[0]["couplings"]}
        for field in ("physical_qubits", "max_chain", "mean_chain", "two_qubit_gates", "depth"):
            vals = [r[field] for r in ok if r[field] is not None]
            if vals:
                agg[field] = {"best": min(vals), "min": min(vals), "max": max(vals), "median": sorted(vals)[len(vals) // 2]}
        out[key] = agg
    return out


def overview(hardware: str, metric_field: str) -> dict:
    """Ergebnisse einer Hardware für die Website: Metadaten, Fortschritt, Zeilen je Instanz und die Grenze je (Model, Kodierung).

    Liest nur results/<hardware>.json. Grenze: größtes abgebildetes n und kleinstes nicht abgebildetes n; „not mapped“ heißt
    nur, dass die Heuristik in allen Seeds scheiterte (kein Beweis, außer exceeds_limit)."""
    res = load_results(hardware)
    agg = aggregate(res["records"])
    rows = []
    for (m, e, n), a in sorted(agg.items(), key=lambda kv: (kv[0][0], list(ENCODINGS).index(kv[0][1]), kv[0][2])):
        rows.append({"model": m, "encoding": e, "n": n, "status": a["status"], "seeds": a["seeds"], "mapped_seeds": a["mapped_seeds"],
                     "logical_qubits": a["logical_qubits"], "couplings": a["couplings"], "metric": a.get(metric_field),
                     "max_chain": a.get("max_chain"), "mean_chain": a.get("mean_chain")})
    boundary = []
    for m in MODELS:
        for e in ENCODINGS:
            mine = [r for r in rows if r["model"] == m and r["encoding"] == e]
            if not mine:
                continue
            ok = [r["n"] for r in mine if r["status"] == "mapped"]
            bad = [r for r in mine if r["status"] != "mapped"]
            first_bad = min(bad, key=lambda r: r["n"]) if bad else None
            boundary.append({"model": m, "encoding": e, "done": len(mine), "last_mapped_n": max(ok) if ok else None,
                             "first_not_mapped_n": first_bad["n"] if first_bad else None,
                             "first_not_mapped_status": first_bad["status"] if first_bad else None,
                             "mapped_again_later": bool(first_bad and any(n > first_bad["n"] for n in ok))})
    seeds = res["meta"].get("seeds") or 0
    return {"hardware": hardware, "meta": res["meta"], "records": len(res["records"]), "expected": len(grid()) * seeds,
            "instances": len({(r["model"], r["encoding"], r["n"]) for r in res["records"]}), "instances_expected": len(grid()),
            "rows": rows, "boundary": boundary}


def reach(hardware: str, model: str) -> dict | None:
    """Größtes abgebildetes Problem einer Hardware für ein Modell (über alle Kodierungen) – nur aus results/<hardware>.json.

    qubits und couplings: größter Wert unter allen Instanzen, die abgebildet wurden. density: Dichte der abgebildeten Instanz mit den
    meisten Kopplungen (das Maximum über alle wäre bei kleinen vollständigen Graphen trivial 1,0). None, wenn nichts abgebildet wurde."""
    res = load_results(hardware)
    agg = aggregate(res["records"])
    ok = [(k, a) for k, a in agg.items() if k[0] == model and a["status"] == "mapped"]
    if not ok:
        return None
    seeds = res["meta"].get("seeds") or 0
    q = max(ok, key=lambda ka: ka[1]["logical_qubits"])
    c = max(ok, key=lambda ka: ka[1]["couplings"])
    n = c[1]["logical_qubits"]
    return {"qubits": q[1]["logical_qubits"], "qubits_at": f"{q[0][1]}-{q[0][2]}", "couplings": c[1]["couplings"],
            "couplings_at": f"{c[0][1]}-{c[0][2]}", "density": c[1]["couplings"] / (n * (n - 1) / 2) if n > 1 else 0.0,
            "complete": seeds > 0 and len(res["records"]) >= len(grid()) * seeds}  # False: Lauf noch unvollständig, Linie vorläufig


def write_json(path: Path, data) -> None:
    """Atomar schreiben: ein abgebrochener Lauf lässt nie eine halbe Datei zurück."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for attempt in range(20):  # Windows: os.replace scheitert kurz mit „Zugriff verweigert“, wenn Virenscanner/Indexer die Datei hält
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.25 * (attempt + 1))
    os.replace(tmp, path)


def results_path(hardware: str) -> Path:
    return RESULTS / f"{hardware}.json"


def load_results(hardware: str) -> dict:
    p = results_path(hardware)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"hardware": hardware, "meta": {}, "records": []}
