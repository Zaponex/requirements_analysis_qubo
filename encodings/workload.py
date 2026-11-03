"""Workload Balancing in der Zuweisung mit Reihenfolge (TA, ST-SR-TA) – ohne Positionen und ohne Zeitraster.

Ein Roboter darf mehrere Aufträge nacheinander übernehmen. Zeitkriterien (Erledigungszeit, Makespan, Verspätung) hängen
dann von der Reihenfolge ab und brauchen Positions- oder Zeitraster-Variablen (Seite „One-Hot + Reihenfolge“). Die Last
eines Roboters dagegen ist die Summe der Arbeit seiner Aufträge – egal in welcher Reihenfolge. Formulierung des Users:

    H = H_obj + A·H_pen + B·H_WB
    H_obj = Σ_t Σ_r c_tr x_tr                      Gesamtlast
    H_WB  = Σ_r (L_r,0 + Σ_t c_tr x_tr)²           Quadratsumme der Roboterlasten (Vorlast + neue Arbeit)

    One-Hot:     x_tr = x_tr                                       H_pen1 = Σ_t (1 − Σ_r x_tr)²
    Domain Wall: x_tr = d_t,r−1 − d_t,r   (d_t,0 = 1, d_t,R = 0)    H_pen  = Σ_t Σ_i d_t,i+1 (1 − d_t,i)
    Binary:      x_tr = y_tr = Indikator des Codes von r            H_pen  = Σ_t Σ_(gesperrte, ungenutzte Codes) I_t,k

c_tr ist die Arbeit von Auftrag t auf Roboter r aus wählbaren Anteilen (Anfahrt, Beladen, Lastfahrt, Entladen; als Zeit,
Strecke oder Energie), L_r,0 die Vorlast eines belegten Roboters (Rest seines laufenden Auftrags). Ausmultipliziert:

    (L + Σ c x)² = L² + Σ (2Lc + c²) x + 2 Σ_{t<t'} c c' x x'      (One-Hot, x² = x)

Die Paare koppeln Aufträge am selben Roboter – dieselben Paare wie die Spaltenregel der IA, aber mit 2B·c·c′ statt B.
Bei Domain Wall wird jedes x eine Differenz zweier Bits, bei Binary ein Produkt von K Bits (Grad 2K → Hilfsbits).

Annahmen (siehe auch formulations.py): Die Anfahrt zählt ab der aktuellen Position – exakt nur für den ersten Auftrag
eines Roboters, die eines späteren hängt vom Vorgänger ab. Ohne Anfahrt ist c_tr = c_t für alle Roboter: Die Gesamtlast
ist dann für jeden gültigen Plan gleich und H_WB die Zahlenpartitionierung der Auftragslasten auf R Roboter.
"""
from __future__ import annotations

import math
from itertools import combinations, product

from cost_model import resolve_params
from formulations import (
    _chain_deltas, _indicator, _lin_eval, _lin_poly, _poly_mul, _quadratize_groups, binary_lie_gains, build_ia_instance,
    couplings, manhattan, nice_ceil,
)

ENCODINGS = ("one_hot", "domain_wall", "binary")

WB_MEASURES: dict[str, dict] = {
    "zeit": {"key": "zeit", "label": "Arbeitszeit", "en": "Workload (time)", "unit": "s",
             "parts": ["anfahrt", "beladen", "lastfahrt", "entladen"]},
    "strecke": {"key": "strecke", "label": "Fahrstrecke", "en": "Workload (distance)", "unit": "Felder",
                "parts": ["anfahrt", "lastfahrt"]},
    "energie": {"key": "energie", "label": "Energie", "en": "Workload (energy)", "unit": "Wh",
                "parts": ["anfahrt", "lastfahrt"]},
}
# robot = True: hängt vom Roboter ab (sonst für alle Roboter eines Auftrags gleich)
WB_PARTS: dict[str, dict] = {
    "anfahrt": {"key": "anfahrt", "label": "Anfahrt", "robot": True,
                "formula": {"zeit": "d_leer / v", "strecke": "d_leer", "energie": "e_leer · d_leer"}},
    "beladen": {"key": "beladen", "label": "Beladen", "robot": False, "formula": {"zeit": "t_lade"}},
    "lastfahrt": {"key": "lastfahrt", "label": "Lastfahrt", "robot": False,
                  "formula": {"zeit": "d_last / v", "strecke": "d_last", "energie": "e_leer · f_last · d_last"}},
    "entladen": {"key": "entladen", "label": "Entladen", "robot": False, "formula": {"zeit": "t_ent"}},
}
VORLAST_MODES: dict[str, dict] = {
    "keine": {"key": "keine", "label": "keine", "text": "L_r,0 = 0 für alle Roboter"},
    "pauschal": {"key": "pauschal", "label": "pauschal", "text": "belegter Roboter: t_rest (bei Strecke · v, bei Energie · e_leer·v)"},
    "status": {"key": "status", "label": "aus Status", "text": "Rest des laufenden Auftrags aus Status, Position und Auftrag (gewählte Anteile)"},
    "log": {"key": "log", "label": "aus dem Log", "text": "tatsächliche Restdauer bis zur Ablieferung – Rückschau, nur Arbeitszeit"},
}
WB_PARAM_KEYS = ("v", "t_lade", "t_ent", "t_rest", "e_leer", "f_last")
# Status → welche Anteile vom laufenden Auftrag noch fehlen
_REMAINING = {
    "MOVING_TO_PICKUP": ("anfahrt", "beladen", "lastfahrt", "entladen"),
    "LOADING": ("beladen", "lastfahrt", "entladen"),
    "MOVING_TO_DROP_OFF": ("lastfahrt", "entladen"),
}


def _part_values(measure: str, p: dict[str, float], d_leer: float, d_last: float) -> dict[str, float]:
    """Alle Anteile einer Fahrt im gewählten Maß."""
    if measure == "zeit":
        return {"anfahrt": d_leer / p["v"], "beladen": p["t_lade"], "lastfahrt": d_last / p["v"], "entladen": p["t_ent"]}
    if measure == "strecke":
        return {"anfahrt": d_leer, "lastfahrt": d_last}
    return {"anfahrt": p["e_leer"] * d_leer, "lastfahrt": p["e_leer"] * p["f_last"] * d_last}


def _current_task(tasks: list[dict], robot_id: int, t0: float, exclude: set[int]) -> dict | None:
    """Laufender Auftrag eines Roboters zur Zeit t0 aus dem Lebenslauf (zuletzt zugewiesen, noch nicht fertig)."""
    best = None
    for t in tasks:
        if t["transport_id"] in exclude or t.get("assigned_robot") != robot_id:
            continue
        if t.get("t_assigned") is None or t["t_assigned"] > t0:
            continue
        ends = [x for x in (t.get("t_completed"), t.get("t_aborted")) if x is not None]
        if ends and min(ends) <= t0:
            continue
        if best is None or t["t_assigned"] > best["t_assigned"]:
            best = t
    return best


def _vorlast(robot: dict, mode: str, measure: str, parts: list[str], p: dict[str, float], tasks: list[dict],
             t0: float, exclude: set[int]) -> dict:
    """L_r,0 eines Roboters mit Zerlegung und Herkunft."""
    out = {"value": 0.0, "parts": [], "source": "frei", "task_id": None}
    if mode == "keine":
        out["source"] = "keine"
        return out
    if robot["available"]:
        return out
    pauschal = {"zeit": p["t_rest"], "strecke": p["v"] * p["t_rest"], "energie": p["e_leer"] * p["v"] * p["t_rest"]}[measure]
    cur = _current_task(tasks, robot["robot_id"], t0, exclude) if mode in ("status", "log") else None
    if mode == "log" and measure == "zeit" and cur is not None and cur.get("t_completed") is not None:
        val = float(cur["t_completed"]) - t0
        return {"value": round(val, 4), "parts": [{"key": "log", "name": f"Restdauer #{cur['transport_id']} (Log)", "value": round(val, 4)}],
                "source": "log", "task_id": cur["transport_id"]}
    remaining = _REMAINING.get(robot["status"])
    if cur is None or remaining is None:
        return {"value": round(pauschal, 4), "parts": [{"key": "pauschal", "name": "Restzeit pauschal", "value": round(pauschal, 4)}],
                "source": "pauschal" if mode == "pauschal" else "pauschal (kein laufender Auftrag im Log)", "task_id": None}
    pickup = (cur["from_entity_x"], cur["from_entity_y"])
    drop = (cur["to_entity_x"], cur["to_entity_y"])
    d_last = cur["path_steps"] if cur.get("path_steps") is not None else cur["manhattan"]
    if robot["status"] == "MOVING_TO_DROP_OFF":
        d_last = manhattan(robot["x"], robot["y"], *drop)
    d_leer = manhattan(robot["x"], robot["y"], *pickup) if robot["status"] == "MOVING_TO_PICKUP" else 0.0
    values = _part_values(measure, p, d_leer, d_last)
    rest = [{"key": k, "name": f"{WB_PARTS[k]['label']} #{cur['transport_id']}", "value": round(values[k], 4)}
            for k in parts if k in remaining and k in values]
    source = "status" if mode == "status" else "status (Log ohne Ablieferung)" if measure == "zeit" else "status (Log nur für Arbeitszeit)"
    return {"value": round(sum(x["value"] for x in rest), 4), "parts": rest, "source": source, "task_id": cur["transport_id"]}


def build_wb_instance(tasks: list[dict], fleet: list[dict], task_ids: list[int], robot_ids: list[int] | None = None,
                      variables: str = "kandidaten", measure: str = "zeit", parts: list[str] | None = None,
                      vorlast: str = "status", params: dict | None = None) -> dict:
    """Lern-Instanz für Workload Balancing: Robotermenge R wie in der IA, c_tr = Summe der gewählten Anteile im Maß
    measure, je Roboter die Vorlast L_r,0 (robot["load0"]). Doppelbelegung ist zulässig – das ist der Sinn der TA."""
    if measure not in WB_MEASURES:
        raise ValueError(f"Lastmaß muss eines von {tuple(WB_MEASURES)} sein")
    if vorlast not in VORLAST_MODES:
        raise ValueError(f"Vorlast muss eine von {tuple(VORLAST_MODES)} sein")
    allowed = WB_MEASURES[measure]["parts"]
    chosen = [k for k in allowed if parts is None or k in parts]
    unknown = [k for k in (parts or []) if k not in WB_PARTS]
    if unknown:
        raise ValueError(f"Unbekannte Anteile: {unknown}")
    if not chosen:
        raise ValueError("Mindestens ein Anteil der Last muss gewählt sein")
    base = build_ia_instance(tasks, fleet, task_ids, robot_ids, variables, "bearbeitungszeit", params)
    p = base["params"]
    t0 = base["snapshot"]["time"]
    exclude = set(task_ids)
    robots = []
    for r in base["robots"]:
        v0 = _vorlast(r, vorlast, measure, chosen, p, tasks, t0, exclude)
        robots.append({**r, "load0": v0["value"], "load0_parts": v0["parts"], "load0_source": v0["source"],
                       "current_task": v0["task_id"]})
    out_vars = []
    for v in base["variables"]:
        comp = v["components"]
        values = _part_values(measure, p, comp["d_leer"], comp["d_last"])
        ps = [{"key": k, "name": WB_PARTS[k]["label"], "value": round(values[k], 4), "const": not WB_PARTS[k]["robot"]} for k in chosen]
        out_vars.append({**v, "cost": round(sum(x["value"] for x in ps), 4), "parts": ps})
    m = WB_MEASURES[measure]
    return {
        **base,
        "robots": robots,
        "variables": out_vars,
        "measure": m,
        "load_parts": chosen,
        "vorlast": VORLAST_MODES[vorlast],
        # für die gemeinsamen Bausteine der Oberfläche (Einheit, Beschriftung)
        "criterion": {"key": f"wb_{measure}", "label": m["label"], "en": m["en"], "unit": m["unit"],
                      "goal": "die Last gleichmäßig auf die Roboter verteilt ist",
                      "formula": "c = " + " + ".join(WB_PARTS[k]["formula"][measure] for k in chosen)},
    }


# ---------------------------------------------------------------------------------------------
# Formulierungen: alle Terme als Polynom über die Bits der Kodierung, dann (Binary) quadratisieren
# ---------------------------------------------------------------------------------------------

def _x_polys(instance: dict, encoding: str) -> tuple[list[dict | None], dict]:
    """x_tr jeder Variablen als Polynom der Bits und die Struktur der Kodierung (Bits, Ketten bzw. Codes)."""
    variables = instance["variables"]
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    robot_ids = [r["robot_id"] for r in instance["robots"]]
    if encoding == "one_hot":
        bits = [{"index": v["index"], "task_id": v["task_id"], "robot_id": v["robot_id"], "aux": False} for v in variables]
        return [{frozenset([v["index"]]): 1.0} for v in variables], {"bits": bits}
    if encoding == "domain_wall":
        chains, bits = [], []
        x_polys: list[dict | None] = [None] * len(variables)
        for t in task_ids:
            cand = [v for v in variables if v["task_id"] == t]  # nach Roboternummer (wie build_instance)
            idx = []
            for k in range(1, len(cand)):
                idx.append(len(bits))
                bits.append({"index": len(bits), "task_id": t, "chain": t, "pos": k, "left": cand[k - 1]["robot_id"],
                             "right": cand[k]["robot_id"], "aux": False})
            for v, d in zip(cand, _chain_deltas(len(cand), idx)):
                x_polys[v["index"]] = _lin_poly(d)
            chains.append({"key": t, "task_id": t, "members": [v["robot_id"] for v in cand], "vars": [v["index"] for v in cand],
                           "costs": [v["cost"] for v in cand], "bits": idx})
        return x_polys, {"bits": bits, "chains": chains}
    # Binary: je Auftrag K = ⌈log₂ R⌉ Bits, Roboter r hat den Code seiner Stelle in R (Nummernfolge)
    K = math.ceil(math.log2(len(robot_ids))) if len(robot_ids) > 1 else 0
    var_at = {(v["task_id"], v["robot_id"]): v for v in variables}
    groups, bits = [], []
    x_polys = [None] * len(variables)
    for t in task_ids:
        idx = []
        for j in range(K):
            idx.append(len(bits))
            bits.append({"index": len(bits), "task_id": t, "group": t, "pos": j + 1, "place": 2 ** (K - 1 - j), "aux": False})
        codes = []
        for k in range(2 ** K):
            m = robot_ids[k] if k < len(robot_ids) else None
            v = var_at.get((t, m)) if m is not None else None
            codes.append({"code": k, "pattern": format(k, f"0{K}b") if K else "", "member": m, "var": v["index"] if v else None,
                          "cost": v["cost"] if v else None, "status": "ok" if v else "ungenutzt" if m is None else "gesperrt"})
            if v:
                x_polys[v["index"]] = _indicator(idx, k)
        ok = [c for c in codes if c["var"] is not None]
        groups.append({"key": t, "task_id": t, "bits": idx, "codes": codes, "members": [c["member"] for c in ok],
                       "vars": [c["var"] for c in ok], "costs": [c["cost"] for c in ok]})
    return x_polys, {"bits": bits, "groups": groups, "K": K, "members": robot_ids}


def _add_poly(target: dict, poly: dict, weight: str, scale: float = 1.0) -> None:
    for m, c in poly.items():
        e = target.setdefault(m, {"c": 0.0, "A": 0.0, "B": 0.0})
        e[weight] += c * scale


def wb_formulation(instance: dict, encoding: str) -> dict:
    """QUBO der Lastverteilung mit symbolischen Gewichten A (Regel der Kodierung), B (H_WB) und – bei Binary – M (= D).

    Termarten: "kosten" (H_obj, je Auftrag), Regel "zeile" | "kette" | "ungueltig" (je Auftrag), "last" (H_WB, je Roboter),
    "hilfsbit" (Binary, Rosenberg). Jeder Beitrag trägt task_id bzw. robot_id – die Oberfläche erklärt damit die Matrix.
    """
    if encoding not in ENCODINGS:
        raise ValueError(f"Kodierung muss eine von {ENCODINGS} sein")
    variables = instance["variables"]
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    x_polys, struct = _x_polys(instance, encoding)
    bits = struct["bits"]
    pen_kind = {"one_hot": "zeile", "domain_wall": "kette", "binary": "ungueltig"}[encoding]

    blocks: list[tuple[dict, dict]] = []  # (Meta, Polynom {Monom: {c, A, B}})
    for t in task_ids:
        mine = [v for v in variables if v["task_id"] == t and x_polys[v["index"]] is not None]
        poly: dict = {}
        for v in mine:
            _add_poly(poly, x_polys[v["index"]], "c", float(v["cost"]))
        blocks.append(({"kind": "kosten", "task_id": t}, poly))
        pen: dict = {}
        if encoding == "one_hot":
            lin = {frozenset(): 1.0}
            for v in mine:
                lin[frozenset([v["index"]])] = lin.get(frozenset([v["index"]]), 0.0) - 1.0
            _add_poly(pen, _poly_mul(lin, lin), "A")
        elif encoding == "domain_wall":
            ch = next(c for c in struct["chains"] if c["key"] == t)
            for a, b in zip(ch["bits"], ch["bits"][1:]):  # d_i+1 (1 − d_i)
                _add_poly(pen, {frozenset([b]): 1.0, frozenset([a, b]): -1.0}, "A")
        else:
            gr = next(g for g in struct["groups"] if g["key"] == t)
            for c in gr["codes"]:
                if c["var"] is None and gr["vars"]:
                    _add_poly(pen, _indicator(gr["bits"], c["code"]), "A")
        blocks.append(({"kind": pen_kind, "task_id": t}, pen))
    for r in instance["robots"]:
        mine = [v for v in variables if v["robot_id"] == r["robot_id"] and x_polys[v["index"]] is not None]
        lin = {frozenset(): float(r["load0"])} if r["load0"] else {}
        for v in mine:
            for m, c in x_polys[v["index"]].items():
                lin[m] = lin.get(m, 0.0) + c * v["cost"]
        poly: dict = {}
        _add_poly(poly, _poly_mul(lin, lin) if lin else {}, "B")
        blocks.append(({"kind": "last", "robot_id": r["robot_id"]}, poly))
    blocks = [(meta, {m: e for m, e in p.items() if any(abs(x) > 1e-12 for x in e.values())}) for meta, p in blocks]

    degrees_before: dict[int, int] = {}
    for _, p in blocks:
        for m in p:
            if m:
                degrees_before[len(m)] = degrees_before.get(len(m), 0) + 1
    polynomial = [{**meta, "terms": [{"vars": sorted(m), **e} for m, e in p.items()]} for meta, p in blocks]

    aux: list[dict] = []
    work = {k: dict(p) for k, (_, p) in enumerate(blocks)}
    if encoding == "binary":
        aux = _quadratize_groups(work, {b["index"]: b["group"] for b in bits})
        for k, a in enumerate(aux, start=1):
            bits.append({"index": a["index"], "task_id": a["group"], "group": a["group"], "pos": k, "place": None, "aux": True,
                         "pair": a["pair"], "covers": a["covers"]})

    entries: dict[tuple[int, int], dict] = {}
    const_parts: list[dict] = []

    def add(i: int, j: int, part: dict) -> None:
        i, j = min(i, j), max(i, j)
        e = entries.setdefault((i, j), {"i": i, "j": j, "c": 0.0, "A": 0.0, "B": 0.0, "D": 0.0, "parts": []})
        for k in ("c", "A", "B", "D"):
            e[k] += part.get(k, 0.0)
        e["parts"].append(part)

    for k, p in work.items():
        meta = blocks[k][0]
        for m, e in p.items():
            coefs = {w: round(v, 10) for w, v in e.items() if abs(v) > 1e-12}
            if not coefs:
                continue
            ms = sorted(m)
            part = {**meta, **coefs}
            if not ms:
                const_parts.append(part)
            else:
                add(ms[0], ms[-1], part)
    for a in aux:  # Rosenberg: D·(xy − 2xa − 2ya + 3a)
        x, y = a["pair"]
        w = a["index"]
        meta = {"kind": "hilfsbit", "aux": w, "pair": [x, y]}
        add(x, y, {**meta, "D": 1.0})
        add(x, w, {**meta, "D": -2.0})
        add(y, w, {**meta, "D": -2.0})
        add(w, w, {**meta, "D": 3.0})

    const = {"c": 0.0, "A": 0.0, "B": 0.0, "D": 0.0}
    for part in const_parts:
        for k in const:
            const[k] += part.get(k, 0.0)
    n_code = len([b for b in bits if not b["aux"]])
    unrep = [t for t in task_ids if not any(v["task_id"] == t and x_polys[v["index"]] is not None for v in variables)]
    return {
        "encoding": encoding,
        "pen_kind": pen_kind,
        **struct,
        "bits": bits,
        "aux": aux,
        "n_code_bits": n_code,
        "x_polys": [None if p is None else [{"vars": sorted(m), "c": c} for m, c in p.items()] for p in x_polys],
        "polynomial": polynomial,
        "degrees_before": dict(sorted(degrees_before.items())),
        "max_degree": max(degrees_before, default=0),
        "entries": sorted(entries.values(), key=lambda e: (e["i"], e["j"])),
        "const": const,
        "const_parts": const_parts,
        "n": len(bits),
        "unrepresentable": unrep,
    }


# ---------------------------------------------------------------------------------------------
# Auswerten, Pläne, Gewichte
# ---------------------------------------------------------------------------------------------

def x_values(form: dict, b: list[int]) -> list[float]:
    """x_tr jeder Variablen für die Bits b (Domain Wall: −1, 0, 1 möglich; Binary: Code-Bits, Hilfsbits egal)."""
    return [0.0 if p is None else sum(t["c"] for t in p if all(b[i] for i in t["vars"])) for p in form["x_polys"]]


def loads(instance: dict, x: list[float]) -> dict[int, float]:
    """Last je Roboter: L_r,0 + Σ_t c_tr x_tr."""
    out = {r["robot_id"]: float(r["load0"]) for r in instance["robots"]}
    for v in instance["variables"]:
        out[v["robot_id"]] += v["cost"] * x[v["index"]]
    return out


def energy_rules_wb(form: dict, instance: dict, b: list[int], A: float, B: float) -> float:
    """H(b) direkt aus den Regeln (ohne Hilfsbit-Strafe) – muss mit dem Polynom bzw. der QUBO bei ehrlichen Hilfsbits übereinstimmen."""
    x = x_values(form, b)
    obj = sum(v["cost"] * x[v["index"]] for v in instance["variables"])
    wb = sum(L * L for L in loads(instance, x).values())
    if form["encoding"] == "one_hot":
        pen = sum((1 - sum(x[v["index"]] for v in instance["variables"] if v["task_id"] == t["transport_id"])) ** 2
                  for t in instance["tasks"])
    elif form["encoding"] == "domain_wall":
        pen = sum(b[j] * (1 - b[i]) for ch in form["chains"] for i, j in zip(ch["bits"], ch["bits"][1:]))
    else:
        pen = 0
        for gr in form["groups"]:
            if not gr["vars"]:
                continue
            code = sum(b[i] << (form["K"] - 1 - j) for j, i in enumerate(gr["bits"]))
            pen += gr["codes"][code]["var"] is None
    return obj + A * pen + B * wb


def decode_wb(form: dict, instance: dict, b: list[int]) -> dict:
    """Bits → Roboter je Auftrag. Gültig: jeder Auftrag genau ein Roboter (Doppelbelegung erlaubt), Hilfsbits ehrlich."""
    x = x_values(form, b)
    assignment, issues = {}, []
    for t in instance["tasks"]:
        tid = t["transport_id"]
        mine = [v for v in instance["variables"] if v["task_id"] == tid]
        on = [v for v in mine if abs(x[v["index"]]) > 1e-9]
        if not mine or tid in form["unrepresentable"]:
            issues.append(f"#{tid}: kein Roboter möglich")
        elif any(x[v["index"]] < 0 for v in on) or len(on) != 1 or abs(x[on[0]["index"]] - 1) > 1e-9:
            issues.append(f"#{tid}: {'Kette gebrochen' if form['encoding'] == 'domain_wall' else 'Code ungültig' if form['encoding'] == 'binary' else f'{len(on)} Roboter'}")
        else:
            assignment[tid] = on[0]["robot_id"]
    lies = [a["index"] for a in form["aux"] if b[a["index"]] != b[a["pair"][0]] * b[a["pair"][1]]]
    if lies:
        issues.append(f"{len(lies)} Hilfsbit(s) ≠ Produkt")
    return {"valid": not issues, "issues": issues, "assignment": assignment, "lies": lies}


def wb_plans(instance: dict) -> list[dict]:
    """Alle gültigen Pläne (jeder Auftrag genau ein zuständiger Roboter aus R) mit Gesamtlast, Σ L² und größter Last."""
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    options = [[v for v in instance["variables"] if v["task_id"] == t] for t in task_ids]
    if any(not o for o in options):
        return []
    base = {r["robot_id"]: float(r["load0"]) for r in instance["robots"]}
    plans = []
    for combo in product(*options):
        L = dict(base)
        for v in combo:
            L[v["robot_id"]] += v["cost"]
        plans.append({"assignment": {v["task_id"]: v["robot_id"] for v in combo}, "obj": round(sum(v["cost"] for v in combo), 6),
                      "wb": round(sum(x * x for x in L.values()), 6), "max": round(max(L.values()), 6)})
    return plans


def best_plan(plans: list[dict], B: float) -> dict | None:
    """Bester gültiger Plan für H_obj + B·H_WB (die Strafe ist bei gültigen Plänen 0)."""
    return min(plans, key=lambda p: (p["obj"] + B * p["wb"], p["max"]), default=None)


def _round_sig(v: float, digits: int = 2) -> float:
    if not v > 0:
        return 0.0
    return round(v, digits - 1 - math.floor(math.log10(v)))


def weight_bound(instance: dict, form: dict) -> list[dict]:
    """Schranke für A als Funktion von B: A > max_Gruppe min_Option (a + B·w) – die Oberfläche rechnet sie live nach.

    One-Hot und Binary: Ein Auftrag ohne Roboter (bzw. auf einem gesperrten Code) spart Kosten und Last. Einschalten bei
    r kostet höchstens c + B·(c² + 2c·(L_r,0 + Σ_{t'≠t} c_t'r)) – alle anderen Aufträge im schlimmsten Fall auch auf r.
    Liegt A über dem billigsten r, lohnt Liegenlassen nie; Doppelbelegung kostet A ohne Gewinn.
    Domain Wall: Eine Kette wählt immer genau einen Roboter, gefährlich ist nur der Bruch (x = −1 an einem Roboter). Er
    spart höchstens die Spannweite s_t und an Last 2c·L − c² mit L = L_r,0 + Σ_{t'≠t} c_t'r.
    """
    by_robot: dict[int, float] = {r["robot_id"]: float(r["load0"]) for r in instance["robots"]}
    for v in instance["variables"]:
        by_robot[v["robot_id"]] += v["cost"]
    groups = []
    for t in instance["tasks"]:
        tid = t["transport_id"]
        mine = [v for v in instance["variables"] if v["task_id"] == tid]
        if not mine or tid in form["unrepresentable"]:
            continue
        rest = {v["robot_id"]: by_robot[v["robot_id"]] - v["cost"] for v in mine}  # Vorlast + alle anderen Aufträge auf r
        if form["encoding"] == "domain_wall":
            costs = [v["cost"] for v in mine]
            w = max(2 * v["cost"] * rest[v["robot_id"]] - v["cost"] ** 2 for v in mine) if len(mine) > 1 else 0.0
            groups.append({"task_id": tid, "options": [{"a": round(max(costs) - min(costs), 6), "w": round(max(0.0, w), 6)}]})
        else:
            groups.append({"task_id": tid, "options": [{"robot_id": v["robot_id"], "a": v["cost"],
                                                        "w": round(v["cost"] ** 2 + 2 * v["cost"] * rest[v["robot_id"]], 6)} for v in mine]})
    return groups


def bound_value(groups: list[dict], B: float) -> float:
    return max((min(o["a"] + B * o["w"] for o in g["options"]) for g in groups), default=0.0)


def recommend_A(groups: list[dict], B: float) -> float:
    return nice_ceil(max(10.0, 1.1 * bound_value(groups, B)))


def wb_default_weights(instance: dict, form: dict) -> dict:
    """B = 1/(2·c̄): Ein Auftrag auf einem Roboter, der schon einen gleich großen fährt, kostet um seine eigene Last mehr
    als auf einem leeren (B·(2c·c + c²) − B·c² = c bei c = c̄). A aus weight_bound, M = 1,1 × größter Lügengewinn."""
    costs = [v["cost"] for v in instance["variables"]]
    c_mean = sum(costs) / len(costs) if costs else 0.0
    B = _round_sig(1.0 / (2.0 * c_mean), 2) if c_mean > 0 else 0.01
    groups = weight_bound(instance, form)
    A = recommend_A(groups, B)
    out = {"A": A, "B": B, "M": 0.0, "c_mean": round(c_mean, 4), "bound": groups}
    if form["aux"]:
        gains = binary_lie_gains(form, A, B)
        out["M"] = nice_ceil(max(10.0, 1.1 * max(gains.values(), default=0.0)))
    return out


def wb_sizes(n_robots: int, max_tasks: int = 6) -> list[dict]:
    """Qubits und Kopplungen der drei Kodierungen mit H_WB bei voller Zuständigkeit, R = n_robots, T = 1 … max_tasks.

    Kosten und Vorlast allgemein gewählt (keine zufälligen Auslöschungen) – gezählt wird die Struktur, nicht ein Moment.
    "varianz": One-Hot mit Σ_r (L_r − L̄)² statt Σ_r L_r² – (Σ L)² koppelt jedes Paar von Schaltern.
    """
    rows = []
    for T in range(1, max_tasks + 1):
        inst = {"tasks": [{"transport_id": t} for t in range(1, T + 1)],
                "robots": [{"robot_id": r, "load0": 3.0 + r} for r in range(1, n_robots + 1)],
                "variables": [{"index": k, "task_id": t, "robot_id": r, "cost": 10 + math.sqrt(17 * t + 7 * r * r + 3)}
                              for k, (t, r) in enumerate(product(range(1, T + 1), range(1, n_robots + 1)))]}
        row = {"T": T}
        for enc in ENCODINGS:
            f = wb_formulation(inst, enc)
            row[enc] = {"n": f["n"], "couplings": couplings(f), "aux": len(f["aux"]), "max_degree": f["max_degree"]}
        n = T * n_robots
        row["varianz"] = {"n": n, "couplings": n * (n - 1) // 2}
        rows.append(row)
    return rows


def wb_params(overrides: dict | None) -> dict[str, float]:
    """Parameter des Lastmodells (Teilmenge von cost_model.PARAMS)."""
    return {k: v for k, v in resolve_params(overrides).items() if k in WB_PARAM_KEYS}
