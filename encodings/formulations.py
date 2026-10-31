"""QUBO-Formulierungen des Zuweisungsproblems – One-Hot, mit und ohne Reihenfolge.

Baut aus einem Moment der Simulation (gewählte Anfragen + Flottenzustand) eine kleine
Lern-Instanz und beschreibt die Formulierung auf zwei Ebenen:

- **Regeln** (für Menschen): Kosten je Schalter, Zeilenregel je Auftrag, Spaltenregel je Roboter
- **QUBO-Einträge** (für die Hardware): Q_ij als Summe der Beiträge aus den Regeln

Die Strafgewichte A, B (und D) bleiben symbolisch – jeder Koeffizient wird als
c + a·A + b·B + d·D gespeichert –, damit die Oberfläche sie live verändern kann.

Zwei Problemklassen (Gerkey & Matarić 2004):

- **Sofortzuweisung** (`one_hot_ia`, instantaneous assignment): Jeder Roboter bekommt höchstens
  einen Auftrag. Dann ist jede Zuweisung eine feste Zahl c_tr – sie steht auf der Diagonale. Die
  Formulierung hängt von T : R ab (T = R, T < R, T > R); `domain_wall_ia` legt die Kette auf die Seite,
  die „genau eins“ braucht, `binary_ia` dort den Code (mit Hilfsbits ab Grad 3). `one_hot` ohne Spaltenregel lässt
  Doppelbelegung zu und rechnet trotzdem mit festen c_tr.
- **Zuweisung mit Reihenfolge** (`one_hot_sequence`, time-extended assignment): Ein Roboter
  darf mehrere Aufträge nacheinander fahren. Die Erledigungszeit eines Auftrags hängt dann
  von seinen Vorgängern ab – das geht nur mit **Hilfsvariablen** für den Platz in der
  Reihenfolge: x_trq = „Roboter r fährt Auftrag t als q-letzten“.

Vereinfachung für das Lernen (noch keine echte Instanzbildung, siehe docs/ARCHITEKTUR.md
Stufe 2): Alle gewählten Aufträge sehen den Flottenzustand zum Zeitpunkt der ersten
gewählten Anfrage und gelten ab diesem Zeitpunkt als verfügbar.
"""
from __future__ import annotations

import math
from itertools import combinations, permutations, product

from cost_model import CRITERIA_BY_KEY, SEQUENCE_CRITERIA_BY_KEY, assignment_cost, resolve_params

MAX_TASKS = 6
MAX_SLOTS = 3
VARIABLE_MODES = ("kandidaten", "alle")
WEIGHTS = ("A", "B", "D")


def manhattan(ax: float, ay: float, bx: float, by: float) -> float:
    return abs(ax - bx) + abs(ay - by)


def nice_ceil(v: float) -> float:
    """Rundet auf eine „schöne“ Zahl nach oben (wie niceCeil in der Oberfläche)."""
    if not v > 0:
        return 10.0
    exp = 10 ** math.floor(math.log10(v))
    step = exp / 2 if exp >= 10 else exp
    return math.ceil(v / step) * step


def _moment(tasks: list[dict], fleet: list[dict], task_ids: list[int]) -> tuple[list[dict], list[dict], dict]:
    """Gewählte Aufträge und der Flotten-Snapshot der ersten gewählten Anfrage."""
    if not 1 <= len(task_ids) <= MAX_TASKS:
        raise ValueError(f"Bitte 1 bis {MAX_TASKS} Aufträge wählen")
    by_id = {t["transport_id"]: t for t in tasks}
    missing = [i for i in task_ids if i not in by_id]
    if missing:
        raise ValueError(f"Unbekannte Aufträge: {missing}")

    chosen = sorted({i: by_id[i] for i in task_ids}.values(), key=lambda t: (t["time"], t["transport_id"]))
    first = chosen[0]
    snapshot = sorted((r for r in fleet if r["transport_id"] == first["transport_id"]), key=lambda r: r["robot_id"])
    if not snapshot:
        raise ValueError(f"Kein Flotten-Snapshot zu Auftrag {first['transport_id']}")

    robots = [{"robot_id": r["robot_id"], "x": r["x"], "y": r["y"], "status": r["status"],
               "available": bool(r["available"]), "aor": list(r["aor"]),
               "battery_percent": r.get("battery_percent")} for r in snapshot]
    task_list = [{
        "transport_id": t["transport_id"], "time": t["time"], "task_area": t["task_area"],
        "material_stage": t["material_stage"], "from_entity": t["from_entity"], "to_entity": t["to_entity"],
        "pickup": {"x": t["from_entity_x"], "y": t["from_entity_y"]},
        "drop": {"x": t["to_entity_x"], "y": t["to_entity_y"]},
        # Lastfahrt: Pfadlänge der Simulation; fehlt sie (Sentinel), Manhattan-Distanz als Schätzung
        "loaded_distance": t["path_steps"] if t.get("path_steps") is not None else t["manhattan"],
        "loaded_estimated": t.get("path_steps") is None,
    } for t in chosen]
    return task_list, robots, {"transport_id": first["transport_id"], "time": first["time"]}


def _eligible(task: dict, robot: dict) -> bool:
    return robot["available"] and (task["task_area"] is None or task["task_area"] in robot["aor"])


def build_instance(tasks: list[dict], fleet: list[dict], task_ids: list[int], variables: str = "kandidaten",
                   criterion: str = "leerfahrt", params: dict | None = None) -> dict:
    """Lern-Instanz aus Auftrags- und Flottendatensätzen (Format wie in webapp/data_service.py).

    variables = "kandidaten": nur Schalter für verfügbare und zuständige Roboter
    variables = "alle":       ein Schalter für jeden Roboter (auch belegte)
    criterion: Bewertungskriterium aus cost_model.CRITERIA – bestimmt c_tr (die Diagonale)
    params:    Annahmen des Kostenmodells (Geschwindigkeit, Ladezeiten, …), sonst Standardwerte
    """
    if variables not in VARIABLE_MODES:
        raise ValueError(f"variables muss eines von {VARIABLE_MODES} sein")
    if criterion not in CRITERIA_BY_KEY:
        raise ValueError(f"Unbekanntes Kriterium: {criterion}")
    p = resolve_params(params)
    task_list, robots, snapshot = _moment(tasks, fleet, task_ids)

    t0 = snapshot["time"]
    variables_out = []
    for t in task_list:
        for r in robots:
            eligible = _eligible(t, r)
            if variables == "kandidaten" and not eligible:
                continue
            d_leer = manhattan(r["x"], r["y"], t["pickup"]["x"], t["pickup"]["y"])
            cost, parts, comp = assignment_cost(criterion, t, r, t0, p, d_leer)
            variables_out.append({
                "index": len(variables_out),
                "task_id": t["transport_id"],
                "robot_id": r["robot_id"],
                "cost": cost,
                "parts": parts,
                "components": comp,
                "eligible": eligible,
            })
    return {
        "snapshot": snapshot,
        "mode": variables,
        "criterion": CRITERIA_BY_KEY[criterion],
        "params": p,
        "tasks": task_list,
        "robots": robots,
        "variables": variables_out,
    }


def one_hot(instance: dict, column_rule: bool = False) -> dict:
    """One-Hot-Formulierung: Regeln und QUBO-Einträge mit symbolischen Gewichten A (und B).

    E(x) = Σ c_tr x_tr                       Kosten
         + A Σ_t (1 − Σ_r x_tr)²             Zeilenregel: jeder Auftrag genau einen Roboter

    Doppelbelegung ist zulässig: Ein Roboter darf mehrere Aufträge bekommen. Die strengere Variante
    aus der Literatur (höchstens ein Auftrag je Roboter) gibt es nur noch mit column_rule=True:
         + B Σ_r Σ_{t<t'} x_tr x_t'r         Spaltenregel
    """
    variables = instance["variables"]
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    robot_ids = [r["robot_id"] for r in instance["robots"]]
    rows = {t: [v["index"] for v in variables if v["task_id"] == t] for t in task_ids}
    cols = {r: [v["index"] for v in variables if v["robot_id"] == r] for r in robot_ids}

    rules = [{"kind": "kosten", "vars": [v["index"]], "task_id": v["task_id"], "robot_id": v["robot_id"], "c": v["cost"]}
             for v in variables]
    rules += [{"kind": "zeile", "vars": rows[t], "task_id": t} for t in task_ids]
    if column_rule:
        rules += [{"kind": "spalte", "vars": cols[r], "robot_id": r} for r in robot_ids if len(cols[r]) >= 2]

    entries: dict[tuple[int, int], dict] = {}

    def add(i: int, j: int, part: dict) -> None:
        e = entries.setdefault((i, j), {"i": i, "j": j, "c": 0.0, "A": 0.0, "B": 0.0, "parts": []})
        for k in ("c", "A", "B"):
            e[k] += part.get(k, 0.0)
        e["parts"].append(part)

    for v in variables:
        add(v["index"], v["index"], {"kind": "kosten", "c": float(v["cost"]), "task_id": v["task_id"], "robot_id": v["robot_id"]})
    for t, idx in rows.items():
        # A(1 − Σx)² = A − A Σx + 2A Σ_{i<j} x_i x_j   (weil x² = x)
        for i in idx:
            add(i, i, {"kind": "zeile", "A": -1.0, "task_id": t})
        for i, j in combinations(idx, 2):
            add(i, j, {"kind": "zeile", "A": 2.0, "task_id": t})
    for r, idx in cols.items() if column_rule else ():
        for i, j in combinations(idx, 2):
            add(i, j, {"kind": "spalte", "B": 1.0, "robot_id": r})

    return {
        "encoding": "one_hot",
        "column_rule": column_rule,
        "rules": rules,
        "entries": sorted(entries.values(), key=lambda e: (e["i"], e["j"])),
        "const": {"c": 0.0, "A": float(len(task_ids)), "B": 0.0},  # je Zeile die Konstante A
        "n": len(variables),
    }


def coefficient(entry: dict, A: float, B: float, D: float = 0.0) -> float:
    return entry["c"] + entry["A"] * A + entry["B"] * B + entry.get("D", 0.0) * D


def energy_qubo(form: dict, x: list[int], A: float, B: float, D: float = 0.0) -> float:
    """E(x) = xᵀQx + const über die QUBO-Einträge."""
    e = coefficient(form["const"], A, B, D)
    for q in form["entries"]:
        if x[q["i"]] and x[q["j"]]:
            e += coefficient(q, A, B, D)
    return e


def energy_rules(form: dict, x: list[int], A: float, B: float, D: float = 0.0) -> float:
    """E(x) über die Regeln – muss für jedes x mit energy_qubo übereinstimmen."""
    e = 0.0
    for r in form["rules"]:
        kind = r["kind"]
        if kind == "luecke":
            e += D * sum(x[i] for i in r["upper"]) * (1 - sum(x[i] for i in r["lower"]))
            continue
        on = sum(x[i] for i in r["vars"])
        if kind == "kosten":
            e += r["c"] * on
        elif kind == "reihenfolge":
            e += r["c"] * x[r["vars"][0]] * x[r["vars"][1]]
        elif kind == "zeile":
            # exact=False: „höchstens ein Roboter“ (Sofortzuweisung mit T > R)
            e += A * ((1 - on) ** 2 if r.get("exact", True) else on * (on - 1) / 2)
        else:
            # exact=True: „genau ein Auftrag je Roboter“ (Sofortzuweisung mit T ≥ R)
            e += B * ((1 - on) ** 2 if r.get("exact", False) else on * (on - 1) / 2)
    return e


# ---------------------------------------------------------------------------------------------
# Sofortzuweisung (IA): One-Hot mit Spaltenregel – drei Fälle je nach Verhältnis T : R
# ---------------------------------------------------------------------------------------------
#
# Jeder Roboter fährt höchstens einen Auftrag (instantaneous assignment, Gerkey & Matarić 2004).
# Welche Seite vollständig zugewiesen wird, hängt davon ab, ob es mehr Aufträge oder mehr Roboter gibt:
#     H = H_obj + A·H_pen1 + B·H_pen2,   H_obj = Σ_t Σ_r c_tr x_tr
#     T = R:  H_pen1  = Σ_t (1 − Σ_r x_tr)²          jeder Auftrag genau einen Roboter
#             H_pen2  = Σ_r (1 − Σ_t x_tr)²          jeder Roboter genau einen Auftrag
#     T < R:  H_pen1,  H'_pen2 = Σ_r Σ_{t<t'} x_tr x_t'r   jeder Roboter höchstens einen Auftrag
#     T > R:  H'_pen1 = Σ_t Σ_{r<r'} x_tr x_tr',  H_pen2   jeder Auftrag höchstens einen Roboter
# Bei T > R bleiben T − R Aufträge für die nächste Entscheidungsrunde liegen, bei T < R R − T Roboter frei.

IA_CASES: dict[str, dict] = {
    "T=R": {"zeile": True, "spalte": True},  # exact je Regel: „genau eins“ statt „höchstens eins“
    "T<R": {"zeile": True, "spalte": False},
    "T>R": {"zeile": False, "spalte": True},
}


def ia_case(n_tasks: int, n_robots: int) -> str:
    if n_tasks == n_robots:
        return "T=R"
    return "T<R" if n_tasks < n_robots else "T>R"


def build_ia_instance(tasks: list[dict], fleet: list[dict], task_ids: list[int], robot_ids: list[int] | None = None,
                      variables: str = "kandidaten", criterion: str = "fahrstrecke", params: dict | None = None) -> dict:
    """Lern-Instanz der Sofortzuweisung: wie build_instance, aber mit wählbarer Robotermenge R.

    R = gewählte Roboter (robot_ids, sonst alle); bei variables = "kandidaten" nur freie. Ist keiner der gewählten
    frei, gelten alle freien (robots_fallback = True). "fleet" behält den ganzen Snapshot für die Auswahl.
    """
    inst = build_instance(tasks, fleet, task_ids, variables, criterion, params)
    pool = [r for r in inst["robots"] if variables == "alle" or r["available"]]
    if not pool:
        raise ValueError("Kein freier Roboter in diesem Moment – „alle Roboter“ wählen")
    known = {r["robot_id"] for r in inst["robots"]}
    if robot_ids is not None and any(i not in known for i in robot_ids):
        raise ValueError(f"Unbekannte Roboter: {sorted(set(robot_ids) - known)}")
    chosen = [r for r in pool if robot_ids is None or r["robot_id"] in robot_ids]
    fallback = not chosen
    chosen = chosen or pool
    keep = {r["robot_id"] for r in chosen}
    kept = [v for v in inst["variables"] if v["robot_id"] in keep]
    return {
        **inst,
        "fleet": inst["robots"],
        "robots": chosen,
        "robots_fallback": fallback,
        "variables": [{**v, "index": i} for i, v in enumerate(kept)],
        "case": ia_case(len(inst["tasks"]), len(chosen)),
    }


def one_hot_ia(instance: dict) -> dict:
    """One-Hot der Sofortzuweisung: Regeln und QUBO-Einträge mit symbolischen Gewichten A (Auftrag), B (Roboter).

    Regelart "zeile" = H_pen1 bzw. H'_pen1, "spalte" = H_pen2 bzw. H'_pen2; exact sagt, welche Form gilt.
    """
    variables = instance["variables"]
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    robot_ids = [r["robot_id"] for r in instance["robots"]]
    case = ia_case(len(task_ids), len(robot_ids))
    exact = IA_CASES[case]
    rows = {t: [v["index"] for v in variables if v["task_id"] == t] for t in task_ids}
    cols = {r: [v["index"] for v in variables if v["robot_id"] == r] for r in robot_ids}

    rules = [{"kind": "kosten", "vars": [v["index"]], "task_id": v["task_id"], "robot_id": v["robot_id"], "c": v["cost"]}
             for v in variables]
    rules += [{"kind": "zeile", "vars": rows[t], "task_id": t, "exact": exact["zeile"]} for t in task_ids]
    rules += [{"kind": "spalte", "vars": cols[r], "robot_id": r, "exact": exact["spalte"]} for r in robot_ids]

    entries: dict[tuple[int, int], dict] = {}

    def add(i: int, j: int, part: dict) -> None:
        e = entries.setdefault((i, j), {"i": i, "j": j, "c": 0.0, "A": 0.0, "B": 0.0, "parts": []})
        for k in ("c", "A", "B"):
            e[k] += part.get(k, 0.0)
        e["parts"].append(part)

    for v in variables:
        add(v["index"], v["index"], {"kind": "kosten", "c": float(v["cost"]), "task_id": v["task_id"], "robot_id": v["robot_id"]})
    const_parts: list[dict] = []
    # (1 − Σx)² = 1 − Σx + 2 Σ_{i<j} x_i x_j (weil x² = x);  Σ_{i<j} x_i x_j ist schon quadratisch
    for kind, weight, groups, key in (("zeile", "A", rows, "task_id"), ("spalte", "B", cols, "robot_id")):
        for g, idx in groups.items():
            if exact[kind]:
                const_parts.append({"kind": kind, weight: 1.0, key: g})
                for i in idx:
                    add(i, i, {"kind": kind, weight: -1.0, key: g})
            for i, j in combinations(idx, 2):
                add(i, j, {"kind": kind, weight: 2.0 if exact[kind] else 1.0, key: g})

    return {
        "encoding": "one_hot_ia",
        "case": case,
        "exact": exact,
        "rules": rules,
        "entries": sorted(entries.values(), key=lambda e: (e["i"], e["j"])),
        "const": {"c": 0.0, "A": float(len(task_ids)) if exact["zeile"] else 0.0,
                  "B": float(len(robot_ids)) if exact["spalte"] else 0.0},
        "const_parts": const_parts,
        "n": len(variables),
    }


def ia_valid_plans(instance: dict) -> list[dict]:
    """Alle gültigen Sofortzuweisungen des Falls: die kleinere Seite vollständig, niemand doppelt.

    T ≤ R: jeder Auftrag ein eigener Roboter; T > R: jeder Roboter ein eigener Auftrag. Nach Wert sortiert.
    """
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    robot_ids = [r["robot_id"] for r in instance["robots"]]
    cost = {(v["task_id"], v["robot_id"]): v["cost"] for v in instance["variables"]}
    if len(task_ids) <= len(robot_ids):
        combos = (list(zip(task_ids, rs)) for rs in permutations(robot_ids, len(task_ids)))
    else:
        combos = (list(zip(ts, robot_ids)) for ts in permutations(task_ids, len(robot_ids)))
    plans = [{"assignment": dict(pairs), "value": round(sum(cost[p] for p in pairs), 4)}
             for pairs in combos if all(p in cost for p in pairs)]
    return sorted(plans, key=lambda p: p["value"])


def ia_default_weights(instance: dict) -> dict:
    """Strafgewichte der Sofortzuweisung: A = B = 1,5 × größte Kosten (wie One-Hot ohne Spaltenregel).

    Bei T ≠ R belohnt nur die „genau eins“-Regel das Einschalten (−A bzw. −B auf der Diagonale); sie muss
    den teuersten nötigen Schalter überbieten. Bei T = R belohnen beide (−A − B). Brute Force an echten
    Momenten (alle Fälle, Modi und IA-Kriterien): ab A = B = 1,01·c_max immer gültig, mit 0,75·c_max bei
    T ≠ R oft ungültig (siehe tests/test_ia_one_hot.py).
    """
    c_max = max((v["cost"] for v in instance["variables"]), default=0.0)
    P = nice_ceil(max(10.0, 1.5 * c_max))
    return {"A": P, "B": P, "c_max": round(c_max, 4)}


# ---------------------------------------------------------------------------------------------
# Sofortzuweisung (IA): Domain Wall – die Kette liegt auf der Seite, die vollständig zugewiesen wird
# ---------------------------------------------------------------------------------------------
#
# Eine Domain-Wall-Kette kann nur „genau eins“ ausdrücken (Σ_k δ_k = 1 − 0 für jede Stellung). Deshalb:
#     T ≤ R: je Auftrag eine Kette über die Roboter:  x_tr = d_t,r−1 − d_t,r   (d_t,0 = 1, d_t,R = 0)
#            H = H_obj_DW + A·H_pen_DW + B·H_pen2 (T = R)  bzw.  + B·H'_pen2 (T < R)
#     T > R: je Roboter eine Kette über die Aufträge: x_tr = e_t−1,r − e_t,r  (e_0,r = 1, e_T,r = 0)
#            H = H'_obj_DW + A·H'_pen_DW + B·H'_pen1
# H_obj_DW = Σ_t (c_t,1 + Σ_i (c_t,i+1 − c_t,i) d_t,i) ist die Teleskopsumme von Σ c·x, H_pen_DW = Σ_t Σ_i d_t,i+1 (1 − d_t,i)
# verbietet die falsche Wand 0 → 1. Die Regel der anderen Seite („Querregel“: H_pen2, H'_pen2, H'_pen1) ist die
# One-Hot-Regel, eingesetzt mit x = Differenz zweier Bits – sie koppelt verschiedene Ketten.
# Gewichte: A = Kettenregel, B = Querregel (wie Domain Wall mit Spaltenregel in der TA).


def _lin_poly(e: dict) -> dict:
    """Lineare Form → Polynom {Monom (frozenset): Koeffizient}."""
    poly = {frozenset(): e["const"]} if e["const"] else {}
    for i, c in e["terms"].items():
        poly[frozenset([i])] = poly.get(frozenset([i]), 0.0) + c
    return poly


def _chain_deltas(n_members: int, bits: list[int]) -> list[dict]:
    """δ_k = Kette[k] − Kette[k+1] als lineare Form über die Bits (Ränder fest 1 und 0)."""
    b = [_lin(1.0)] + [_lin(0.0, {i: 1.0}) for i in bits] + [_lin(0.0)]
    out = []
    for k in range(n_members):
        terms = dict(b[k]["terms"])
        for i, c in b[k + 1]["terms"].items():
            terms[i] = terms.get(i, 0.0) - c
        out.append(_lin(b[k]["const"] - b[k + 1]["const"], terms))
    return out


def domain_wall_ia(instance: dict) -> dict:
    """Domain Wall der Sofortzuweisung (Instanz aus build_ia_instance) mit symbolischen Gewichten A (Kette), B (Querregel).

    side = "zeile": je Auftrag eine Kette über die Roboter (T ≤ R), "spalte": je Roboter eine über die Aufträge (T > R).
    Roboter stehen nach Nummer, Aufträge in Anfrage-Reihenfolge in der Kette. x_forms[v] ist x_tr der Variable v als
    lineare Form der Bits; die Querregel ist exakt („genau eins“, T = R) oder „höchstens eins“ (T ≠ R).
    """
    variables = instance["variables"]
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    robot_ids = [r["robot_id"] for r in instance["robots"]]
    case = ia_case(len(task_ids), len(robot_ids))
    exact = IA_CASES[case]
    side = "zeile" if len(task_ids) <= len(robot_ids) else "spalte"
    cross = "spalte" if side == "zeile" else "zeile"
    if side == "zeile":
        groups = [(t, [v for v in variables if v["task_id"] == t]) for t in task_ids]
    else:
        groups = [(r, [v for v in variables if v["robot_id"] == r]) for r in robot_ids]
    key_name = "task_id" if side == "zeile" else "robot_id"

    chains, bits = [], []
    x_forms: list[dict | None] = [None] * len(variables)
    for key, cand in groups:
        members = [v["robot_id"] if side == "zeile" else v["task_id"] for v in cand]
        idx = []
        for k in range(1, len(cand)):
            idx.append(len(bits))
            bits.append({"index": len(bits), key_name: key, "chain": key, "pos": k, "left": members[k - 1], "right": members[k]})
        for v, d in zip(cand, _chain_deltas(len(cand), idx)):
            x_forms[v["index"]] = d
        chains.append({"key": key, key_name: key, "members": members, "vars": [v["index"] for v in cand],
                       "task_ids": [v["task_id"] for v in cand], "robot_ids": [v["robot_id"] for v in cand],
                       "costs": [v["cost"] for v in cand], "bits": idx})

    rules: list[dict] = []
    entries: dict[tuple[int, int], dict] = {}
    const_parts: list[dict] = []

    def add(i: int, j: int, part: dict) -> None:
        i, j = min(i, j), max(i, j)
        e = entries.setdefault((i, j), {"i": i, "j": j, "c": 0.0, "A": 0.0, "B": 0.0, "parts": []})
        for k in ("c", "A", "B"):
            e[k] += part.get(k, 0.0)
        e["parts"].append(part)

    def put(poly: dict, weight: str, meta: dict) -> None:
        for mono, coef in poly.items():
            if abs(coef) < 1e-12:
                continue
            ms = sorted(mono)
            part = {**meta, weight: coef}
            if not ms:
                const_parts.append(part)
            else:
                add(ms[0], ms[-1], part)

    for ch in chains:
        key = ch["key"]
        if not ch["members"]:
            continue  # niemand in der Kette: in Domain Wall nicht darstellbar
        rules.append({"kind": "kosten", "chain": key, "vars": ch["bits"], "costs": ch["costs"],
                      "deltas": [x_forms[i] for i in ch["vars"]]})
        # Teleskopsumme: Σ_k c_k δ_k = c_1 + Σ_i (c_i+1 − c_i) d_i
        const_parts.append({"kind": "kosten", "c": float(ch["costs"][0]), "chain": key, "member": ch["members"][0]})
        for k, i in enumerate(ch["bits"], start=1):
            add(i, i, {"kind": "kosten", "c": round(float(ch["costs"][k] - ch["costs"][k - 1]), 4), "chain": key,
                       "left": ch["members"][k - 1], "right": ch["members"][k]})
        # Kettenregel: d_i+1 (1 − d_i) = d_i+1 − d_i d_i+1
        for a, b in zip(ch["bits"], ch["bits"][1:]):
            rules.append({"kind": "kette", "chain": key, "vars": [a, b]})
            add(b, b, {"kind": "kette", "A": 1.0, "chain": key})
            add(a, b, {"kind": "kette", "A": -1.0, "chain": key})

    # Querregel je Gruppe der anderen Seite: (1 − Σ x)² bzw. Σ_{i<j} x_i x_j mit x = lineare Form der Bits
    other = robot_ids if side == "zeile" else task_ids
    other_name = "robot_id" if side == "zeile" else "task_id"
    for g in other:
        members = [v for v in variables if v[other_name] == g and x_forms[v["index"]] is not None]
        ds = [x_forms[v["index"]] for v in members]
        meta = {"kind": "quer", other_name: g}
        rules.append({"kind": "quer", other_name: g, "exact": exact[cross], "deltas": ds,
                      "members": [v["task_id"] if side == "zeile" else v["robot_id"] for v in members],
                      "vars": sorted({i for d in ds for i in d["terms"]})})
        if exact[cross]:
            lin = _lin(1.0)
            for d in ds:
                lin["const"] -= d["const"]
                for i, c in d["terms"].items():
                    lin["terms"][i] = lin["terms"].get(i, 0.0) - c
            p = _lin_poly(lin)
            put(_poly_mul(p, p), "B", meta)
        else:
            poly: dict[frozenset, float] = {}
            for d1, d2 in combinations(ds, 2):
                for m, c in _poly_mul(_lin_poly(d1), _lin_poly(d2)).items():
                    poly[m] = poly.get(m, 0.0) + c
            put(poly, "B", meta)

    const = {"c": 0.0, "A": 0.0, "B": 0.0}
    for p in const_parts:
        for k in const:
            const[k] += p.get(k, 0.0)
    return {
        "encoding": "domain_wall_ia",
        "case": case,
        "exact": exact,
        "side": side,
        "cross": cross,
        "chains": chains,
        "bits": bits,
        "x_forms": x_forms,
        "rules": rules,
        "entries": sorted(entries.values(), key=lambda e: (e["i"], e["j"])),
        "const": const,
        "const_parts": const_parts,
        "n": len(bits),
        "unrepresentable": [ch["key"] for ch in chains if not ch["members"]],
    }


def energy_rules_dw_ia(form: dict, b: list[int], A: float, B: float) -> float:
    """H(b) direkt aus den Regeln (mit x = Differenz zweier Bits) – muss mit energy_qubo übereinstimmen."""
    e = 0.0
    for r in form["rules"]:
        if r["kind"] == "kosten":
            e += sum(c * _lin_eval(d, b) for c, d in zip(r["costs"], r["deltas"]))
        elif r["kind"] == "kette":
            i, j = r["vars"]
            e += A * b[j] * (1 - b[i])
        else:
            xs = [_lin_eval(d, b) for d in r["deltas"]]
            e += B * ((1 - sum(xs)) ** 2 if r["exact"] else sum(p * q for p, q in combinations(xs, 2)))
    return e


def decode_domain_wall_ia(form: dict, b: list[int]) -> dict:
    """Bits → Paare (Auftrag, Roboter). Gültig: jede Kette genau eine Wand und die Querregel des Falls erfüllt."""
    pairs, issues = [], []
    for ch in form["chains"]:
        name = f"#{ch['key']}" if form["side"] == "zeile" else f"R{ch['key']}"
        if not ch["members"]:
            issues.append(f"{name}: nicht darstellbar")
            continue
        bb = [1] + [b[i] for i in ch["bits"]] + [0]
        if any(bb[k] == 0 and bb[k + 1] == 1 for k in range(len(bb) - 1)):
            issues.append(f"{name}: Kette gebrochen")
            continue
        k = next(k for k in range(len(bb) - 1) if bb[k] == 1 and bb[k + 1] == 0)
        pairs.append((ch["task_ids"][k], ch["robot_ids"][k]))
    for r in form["rules"]:
        if r["kind"] != "quer":
            continue
        if "robot_id" in r:
            n, name = sum(p[1] == r["robot_id"] for p in pairs), f"R{r['robot_id']}"
        else:
            n, name = sum(p[0] == r["task_id"] for p in pairs), f"#{r['task_id']}"
        if n > 1 or (r["exact"] and n == 0):
            issues.append(f"{name}: {n}")
    return {"valid": not issues, "issues": issues, "pairs": pairs}


def ia_dw_default_weights(instance: dict, form: dict) -> dict:
    """Strafgewichte für Domain Wall in der Sofortzuweisung: B = P, A = 3P mit P = 1,5 × Kostenspannweite s einer Kette.

    B (Querregel) > s: Mit gültigen Ketten spart eine Doppelbelegung höchstens s je weggeschobenem Partner.
    A (Kette) > B + 2s: Eine gebrochene Kette hat x = −1 an einem Mitglied. Steht dort ein anderer, belohnt die
    „höchstens eins“-Regel das Paar mit −B; zusammen mit dem Phantasiewert (≤ s) und dem gesparten Ausweichen (≤ s)
    gewinnt der Bruch bis B + 2s. Brute Force an echten Momenten (tests/test_ia_domain_wall.py): A = 2B scheitert
    bei T ≠ R vereinzelt, A = B + 2s nie; B = 0,9·s scheitert. T = R ist robust (Strafe (1 − Σx)² ≥ 0).
    """
    spread = max((max(ch["costs"]) - min(ch["costs"]) for ch in form["chains"] if ch["costs"]), default=0.0)
    P = nice_ceil(max(10.0, 1.5 * spread))
    return {"A": 3 * P, "B": P, "spread": round(spread, 4)}


# ---------------------------------------------------------------------------------------------
# Sofortzuweisung (IA): Binary – der Code liegt auf der Seite, die vollständig zugewiesen wird
# ---------------------------------------------------------------------------------------------
#
# Wie bei Domain Wall trägt die „genau eins“-Seite einen Code aus K Bits – jede Stellung ist genau ein Code:
#     T ≤ R: je Auftrag K = ⌈log₂ R⌉ Bits b_t,k; Roboter r hat den Code u_r (Platz in R nach Nummer, höchste Stelle zuerst)
#            y_tr = Π_k (u_k,r b_t,k + (1 − u_k,r)(1 − b_t,k))  = 1 genau dann, wenn Auftrag t den Code von r trägt
#            H = H_obj_B + A·H_pen_B + B·H_pen2 (T = R)  bzw.  + B·H'_pen2 (T < R)
#     T > R: je Roboter K = ⌈log₂ T⌉ Bits g_r,k; Auftrag t hat den Code v_t (Anfrage-Reihenfolge), w_tr wie y_tr
#            H = H'_obj_B + A·H'_pen_B + B·H'_pen1
# H_pen_B bestraft die 2^K − R ungenutzten Codes U_f (bzw. V_f) und – bei Zuständigkeiten – Codes von Robotern, die den
# Auftrag nicht fahren dürfen („gesperrt“). y ist immer 0 oder 1 (anders als x bei Domain Wall), also y² = y.
# Grad: y hat Grad K, die Querregel multipliziert zwei y verschiedener Aufträge → Grad 2K. Ab K = 2 (Querregel) bzw.
# K = 3 (schon die Kosten) braucht es Hilfsbits: H_Aux = Σ (xy − 2xa − 2ya + 3a) mit Gewicht M (Rosenberg 1975).
# Gewichte: A = Codesperre, B = Querregel, M (gespeichert als D) = Hilfsbits.

IA_BINARY_KINDS = ("kosten", "ungueltig", "quer")


def _quadratize_groups(work: dict, group: dict) -> list[dict]:
    """Rosenberg-Quadratisierung innerhalb der Gruppen: Solange ein Term mehr als zwei Variablen hat, ersetzt ein neues
    Hilfsbit a das häufigste Paar x·y dieser Terme – nur Paare einer Gruppe (zwei Bits desselben Codes). Das reicht immer:
    Ein Term vom Grad > 2 besteht aus höchstens zwei Codes, einer davon hat mindestens zwei Variablen. Je Gruppe entstehen
    höchstens 2^K − K − 1 Hilfsbits (eines je Teilprodukt ihrer Bits); der freie Greedy über Gruppen hinweg brauchte bei
    K = 3 bis doppelt so viele. work = {Termart: {Monom: Koeffizienten}} wird umgeschrieben; group: Index → Gruppe.
    Ein Hilfsbit steht für das Produkt der Bits in covers und erbt die Gruppe.
    """
    group = dict(group)
    covers = {i: (i,) for i in group}
    aux: list[dict] = []

    def same(pr: tuple[int, int]) -> bool:
        return group[pr[0]] is not None and group[pr[0]] == group[pr[1]]

    while True:
        counts: dict[tuple[int, int], int] = {}
        for p in work.values():
            for m in p:
                if len(m) > 2:
                    for pair in combinations(sorted(m), 2):
                        counts[pair] = counts.get(pair, 0) + 1
        if not counts:
            return aux
        x, y = min([pr for pr in counts if same(pr)] or counts, key=lambda pr: (-counts[pr], pr))
        a = len(group)
        group[a] = group[x] if same((x, y)) else None
        covers[a] = tuple(sorted(covers[x] + covers[y]))
        aux.append({"index": a, "pair": [x, y], "replaced": counts[(x, y)], "covers": list(covers[a]), "group": group[a]})
        for kind, p in work.items():
            new: dict[frozenset, dict] = {}
            for m, e in p.items():
                m2 = (m - {x, y}) | {a} if len(m) > 2 and x in m and y in m else m
                acc = new.setdefault(m2, {k: 0.0 for k in e})
                for k in acc:
                    acc[k] += e[k]
            work[kind] = new


def binary_ia(instance: dict) -> dict:
    """Binary der Sofortzuweisung (Instanz aus build_ia_instance) mit symbolischen Gewichten A, B und M (= D).

    side = "zeile": je Auftrag ein Code über die Roboter (T ≤ R), "spalte": je Roboter einer über die Aufträge (T > R).
    Polynom (beliebiger Grad) je Termart: kosten Σ c·y, ungueltig A·Σ I(ungenutzte und gesperrte Codes), quer B·(1 − Σy)²
    („genau eins“, T = R) bzw. B·Σ y·y′ („höchstens eins“). QUBO: Paare in Termen vom Grad > 2 werden durch Hilfsbits
    ersetzt (_quadratize_groups) + D·(xy − 2xa − 2ya + 3a).
    """
    variables = instance["variables"]
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    robot_ids = [r["robot_id"] for r in instance["robots"]]
    case = ia_case(len(task_ids), len(robot_ids))
    exact = IA_CASES[case]
    side = "zeile" if len(task_ids) <= len(robot_ids) else "spalte"
    cross = "spalte" if side == "zeile" else "zeile"
    keys, members = (task_ids, robot_ids) if side == "zeile" else (robot_ids, task_ids)
    key_name = "task_id" if side == "zeile" else "robot_id"
    K = math.ceil(math.log2(len(members))) if len(members) > 1 else 0
    var_at = {(v["task_id"], v["robot_id"]): v for v in variables}

    groups, bits = [], []
    y_polys: list[dict | None] = [None] * len(variables)
    for g in keys:
        idx = []
        for j in range(K):
            idx.append(len(bits))
            bits.append({"index": len(bits), key_name: g, "group": g, "pos": j + 1, "place": 2 ** (K - 1 - j), "aux": False})
        codes = []
        for k in range(2 ** K):
            m = members[k] if k < len(members) else None
            v = None if m is None else var_at.get((g, m) if side == "zeile" else (m, g))
            codes.append({"code": k, "pattern": format(k, f"0{K}b") if K else "", "member": m,
                          "var": v["index"] if v else None, "cost": v["cost"] if v else None,
                          "status": "ok" if v else "ungenutzt" if m is None else "gesperrt"})
            if v:
                y_polys[v["index"]] = _indicator(idx, k)
        ok = [c for c in codes if c["var"] is not None]
        groups.append({"key": g, key_name: g, "bits": idx, "codes": codes, "members": [c["member"] for c in ok],
                       "vars": [c["var"] for c in ok], "costs": [c["cost"] for c in ok]})

    polys: dict[str, dict[frozenset, dict]] = {k: {} for k in IA_BINARY_KINDS}
    rules: list[dict] = []

    def put(kind: str, poly: dict, weight: str, scale: float) -> dict[int, int]:
        degrees: dict[int, int] = {}
        for mono, coef in poly.items():
            e = polys[kind].setdefault(mono, {"c": 0.0, "A": 0.0, "B": 0.0})
            e[weight] += coef * scale
            if mono and abs(coef) > 1e-12:
                degrees[len(mono)] = degrees.get(len(mono), 0) + 1
        return dict(sorted(degrees.items()))

    for gr in groups:
        g = gr["key"]
        if not gr["vars"]:
            continue  # niemand darf: nicht darstellbar
        cost_poly: dict[frozenset, float] = {}
        for c in gr["codes"]:
            if c["var"] is not None:
                for m, coef in y_polys[c["var"]].items():
                    cost_poly[m] = cost_poly.get(m, 0.0) + coef * c["cost"]
        rules.append({"kind": "kosten", key_name: g, "vars": gr["bits"], "codes": [c["code"] for c in gr["codes"] if c["var"] is not None],
                      "costs": gr["costs"], "degrees": put("kosten", cost_poly, "c", 1.0)})
        forbidden = [c["code"] for c in gr["codes"] if c["var"] is None]
        if forbidden:
            pen: dict[frozenset, float] = {}
            for k in forbidden:
                for m, coef in _indicator(gr["bits"], k).items():
                    pen[m] = pen.get(m, 0.0) + coef
            rules.append({"kind": "ungueltig", key_name: g, "vars": gr["bits"], "codes": forbidden, "degrees": put("ungueltig", pen, "A", 1.0)})

    # Querregel je Element der anderen Seite: (1 − Σ y)² bzw. Σ_{i<j} y_i y_j – y aus verschiedenen Codes
    other_name = "robot_id" if side == "zeile" else "task_id"
    for h in (robot_ids if side == "zeile" else task_ids):
        mine = [v for v in variables if v[other_name] == h and y_polys[v["index"]] is not None]
        ys = [y_polys[v["index"]] for v in mine]
        if exact[cross]:
            lin = {frozenset(): 1.0}
            for y in ys:
                for m, coef in y.items():
                    lin[m] = lin.get(m, 0.0) - coef
            poly = _poly_mul(lin, lin)
        else:
            poly = {}
            for y1, y2 in combinations(ys, 2):
                for m, coef in _poly_mul(y1, y2).items():
                    poly[m] = poly.get(m, 0.0) + coef
        poly = {m: c for m, c in poly.items() if abs(c) > 1e-12}
        rules.append({"kind": "quer", other_name: h, "exact": exact[cross], "vars": sorted({i for y in ys for m in y for i in m}),
                      "members": [v[key_name] for v in mine], "var_ids": [v["index"] for v in mine], "degrees": put("quer", poly, "B", 1.0)})
    for kind in IA_BINARY_KINDS:  # Terme, die sich weggehoben haben, entfernen
        polys[kind] = {m: e for m, e in polys[kind].items() if any(abs(v) > 1e-12 for v in e.values())}

    degrees_before: dict[int, int] = {}
    for p in polys.values():
        for m in p:
            if m:
                degrees_before[len(m)] = degrees_before.get(len(m), 0) + 1
    degrees_before = dict(sorted(degrees_before.items()))
    original = {kind: [{"vars": sorted(m), **e} for m, e in p.items()] for kind, p in polys.items()}

    work = {kind: dict(p) for kind, p in polys.items()}
    aux = _quadratize_groups(work, {b["index"]: b["group"] for b in bits})
    for k, a in enumerate(aux, start=1):
        bits.append({"index": a["index"], key_name: a["group"], "group": a["group"], "pos": k, "place": None, "aux": True,
                     "pair": a["pair"], "covers": a["covers"]})

    entries: dict[tuple[int, int], dict] = {}
    const_parts: list[dict] = []

    def add(i: int, j: int, part: dict) -> None:
        i, j = min(i, j), max(i, j)
        e = entries.setdefault((i, j), {"i": i, "j": j, "c": 0.0, "A": 0.0, "B": 0.0, "D": 0.0, "parts": []})
        for k in ("c", "A", "B", "D"):
            e[k] += part.get(k, 0.0)
        e["parts"].append(part)

    for kind, p in work.items():
        for m, e in p.items():
            part = {"kind": kind, **{k: v for k, v in e.items() if abs(v) > 1e-12}}
            if len(part) == 1:
                continue
            ms = sorted(m)
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
    return {
        "encoding": "binary_ia",
        "case": case,
        "exact": exact,
        "side": side,
        "cross": cross,
        "K": K,
        "members": members,
        "groups": groups,
        "bits": bits,
        "aux": aux,
        "n_code_bits": len(keys) * K,
        "rules": rules,
        "polynomial": original,
        "degrees_before": degrees_before,
        "max_degree": max(degrees_before, default=0),
        "entries": sorted(entries.values(), key=lambda e: (e["i"], e["j"])),
        "const": const,
        "const_parts": const_parts,
        "n": len(bits),
        "unrepresentable": [gr["key"] for gr in groups if not gr["vars"]],
    }


def _ia_codes(form: dict, b: list[int]) -> list[int]:
    """Code je Gruppe aus den Bits (höchste Stelle zuerst)."""
    K = form["K"]
    return [sum(b[i] << (K - 1 - j) for j, i in enumerate(gr["bits"])) for gr in form["groups"]]


def energy_rules_bin_ia(form: dict, b: list[int], A: float, B: float) -> float:
    """H(b) direkt aus den Regeln (y = 1 genau beim eigenen Code) – muss mit dem Polynom übereinstimmen."""
    codes = dict(zip((gr["key"] for gr in form["groups"]), _ia_codes(form, b)))
    key_name = "task_id" if form["side"] == "zeile" else "robot_id"
    y = {c["var"]: int(codes[gr["key"]] == c["code"]) for gr in form["groups"] for c in gr["codes"] if c["var"] is not None}
    e = 0.0
    for r in form["rules"]:
        if r["kind"] == "kosten":
            e += sum(cost * (codes[r[key_name]] == k) for k, cost in zip(r["codes"], r["costs"]))
        elif r["kind"] == "ungueltig":
            e += A * (codes[r[key_name]] in r["codes"])
        else:
            ys = [y[v] for v in r["var_ids"]]
            e += B * ((1 - sum(ys)) ** 2 if r["exact"] else sum(p * q for p, q in combinations(ys, 2)))
    return e


def decode_binary_ia(form: dict, b: list[int]) -> dict:
    """Bits → Paare (Auftrag, Roboter). Gültig: jeder Code gehört zu einem zuständigen Mitglied, die Querregel des Falls
    ist erfüllt und jedes Hilfsbit ist das Produkt seines Paares."""
    zeile = form["side"] == "zeile"
    pairs, issues = [], []
    for gr, code in zip(form["groups"], _ia_codes(form, b)):
        name = f"#{gr['key']}" if zeile else f"R{gr['key']}"
        if not gr["vars"]:
            issues.append(f"{name}: nicht darstellbar")
            continue
        c = gr["codes"][code]
        if c["var"] is None:
            issues.append(f"{name}: Code {code} {c['status']}")
        else:
            pairs.append((gr["key"], c["member"]) if zeile else (c["member"], gr["key"]))
    for r in form["rules"]:
        if r["kind"] != "quer":
            continue
        if "robot_id" in r:
            n, name = sum(p[1] == r["robot_id"] for p in pairs), f"R{r['robot_id']}"
        else:
            n, name = sum(p[0] == r["task_id"] for p in pairs), f"#{r['task_id']}"
        if n > 1 or (r["exact"] and n == 0):
            issues.append(f"{name}: {n}")
    lies = [a["index"] for a in form["aux"] if b[a["index"]] != b[a["pair"][0]] * b[a["pair"][1]]]
    if lies:
        issues.append(f"{len(lies)} Hilfsbit(s) ≠ Produkt")
    return {"valid": not issues, "issues": issues, "pairs": pairs, "lies": lies}


def ia_bin_default_weights(instance: dict, form: dict) -> dict:
    """Strafgewichte für Binary in der Sofortzuweisung.

    A (ungenutzte und gesperrte Codes): Ein solcher Code hat keinen Kostenterm – A muss die größten Kosten übersteigen.
    B (Querregel): Eine Doppelbelegung spart höchstens die Kostenspannweite s einer Gruppe – B > s. y ist immer 0 oder 1,
    die Querregel belohnt also nie (anders als bei Domain Wall).
    M (Hilfsbits): größer als der größte Gewinn eines lügenden Hilfsbits (binary_lie_gains).
    """
    c_max = max((v["cost"] for v in instance["variables"]), default=0.0)
    spread = max((max(gr["costs"]) - min(gr["costs"]) for gr in form["groups"] if gr["costs"]), default=0.0)
    A = nice_ceil(max(10.0, 1.5 * c_max))
    B = nice_ceil(max(10.0, 1.5 * spread))
    gains = binary_lie_gains(form, A, B)
    M = nice_ceil(max(10.0, 1.1 * max(gains.values(), default=0.0)))
    return {"A": A, "B": B, "M": M, "c_max": round(c_max, 4), "spread": round(spread, 4)}


def couplings(form: dict) -> int:
    """Kopplungen (Einträge i ≠ j), die bei allgemeinen Gewichten nicht verschwinden."""
    return sum(1 for e in form["entries"] if e["i"] != e["j"] and abs(coefficient(e, 37.3, 53.1, 91.7)) > 1e-9)


def ia_sizes(n_robots: int, max_tasks: int = MAX_TASKS) -> list[dict]:
    """Qubits und Kopplungen der drei IA-Kodierungen bei voller Zuständigkeit, R = n_robots und T = 1 … max_tasks.

    Die Kosten sind allgemein gewählt (keine zufälligen Auslöschungen) – gezählt wird die Struktur, nicht ein Moment.
    """
    rows = []
    for T in range(1, max_tasks + 1):
        inst = {"tasks": [{"transport_id": t} for t in range(1, T + 1)],
                "robots": [{"robot_id": r} for r in range(1, n_robots + 1)],
                "variables": [{"index": k, "task_id": t, "robot_id": r, "cost": 10 + math.sqrt(17 * t + 7 * r * r + 3)}
                              for k, (t, r) in enumerate(product(range(1, T + 1), range(1, n_robots + 1)))]}
        b = binary_ia(inst)
        rows.append({"T": T, "case": ia_case(T, n_robots),
                     "one_hot": {"n": T * n_robots, "couplings": couplings(one_hot_ia(inst))},
                     "domain_wall": {"n": (dw := domain_wall_ia(inst))["n"], "couplings": couplings(dw)},
                     "binary": {"n": b["n"], "couplings": couplings(b), "aux": len(b["aux"]), "K": b["K"], "max_degree": b["max_degree"]}})
    return rows


# ---------------------------------------------------------------------------------------------
# Zuweisung mit Reihenfolge: Positions-Hilfsvariablen x_trq
# ---------------------------------------------------------------------------------------------
#
# Ein Roboter r fährt seine Aufträge π_1, …, π_n nacheinander. Erledigungszeit des k-ten:
#     C_{π_k} = ρ_r + Σ_{l ≤ k} (s_{π_{l−1} π_l} + p_{π_l})        (ρ_r: Roboter wird erst frei)
# Summiert über alle k zählt jede Fahrt so oft, wie Aufträge ab ihr noch warten:
#     Σ_k C_{π_k} = n·ρ_r + Σ_l (n − l + 1)·(s_{π_{l−1} π_l} + p_{π_l})
# Mit dem Platz von hinten q = n − l + 1 ist das Gewicht q eine feste Zahl je Schalter. Die
# Anfahrt s hängt nur vom direkten Vorgänger ab (Platz q + 1) → eine Kopplung zwischen
# benachbarten Plätzen. Alles bleibt quadratisch (Idee: Horn 1973 für R||ΣC_j, hier mit
# reihenfolgeabhängigen Anfahrten).


def _setup_maps(instance: dict) -> tuple[dict, dict]:
    """Anfahrtszeiten als Nachschlagetabellen: (Roboter, Auftrag) vom Start, (Auftrag, Auftrag) dazwischen."""
    start = {(s["robot_id"], s["task_id"]): s["time"] for s in instance["setup"]["start"]}
    between = {(s["from"], s["to"]): s["time"] for s in instance["setup"]["between"]}
    return start, between


def _weight(crit: dict, q: int) -> int:
    return q if crit["position_weight"] else 1


def build_sequence_instance(tasks: list[dict], fleet: list[dict], task_ids: list[int], variables: str = "kandidaten",
                            criterion: str = "erledigungszeit", slots: int = 2, params: dict | None = None) -> dict:
    """Lern-Instanz für die Zuweisung mit Reihenfolge: ein Schalter x_trq je Auftrag, Roboter und Platz.

    slots (K): höchstens so viele Aufträge je Roboter. Plätze werden **von hinten** gezählt –
    q = 1 ist der letzte Auftrag eines Roboters, q = 2 der vorletzte, … K = 1 ist genau die
    Sofortzuweisung.
    """
    if variables not in VARIABLE_MODES:
        raise ValueError(f"variables muss eines von {VARIABLE_MODES} sein")
    if criterion not in SEQUENCE_CRITERIA_BY_KEY:
        raise ValueError(f"Unbekanntes Kriterium für die Reihenfolge: {criterion}")
    if not 1 <= int(slots) <= MAX_SLOTS:
        raise ValueError(f"Plätze je Roboter: 1 bis {MAX_SLOTS}")
    p = resolve_params(params)
    crit = SEQUENCE_CRITERIA_BY_KEY[criterion]
    task_list, robots, snapshot = _moment(tasks, fleet, task_ids)
    K = min(int(slots), len(task_list))

    for t in task_list:
        t["t_last"] = round(t["loaded_distance"] / p["v"], 4)
        t["p"] = round(p["t_lade"] + t["t_last"] + p["t_ent"], 4)  # Bearbeitung ohne Anfahrt
    for r in robots:
        r["release"] = 0.0 if r["available"] else p["t_rest"]  # belegt: erst nach der Restzeit frei

    # Anfahrten: vom Standort des Roboters bzw. vom Abgabeort des Vorgängers zum Abholort
    setup_start = [{"robot_id": r["robot_id"], "task_id": t["transport_id"], "distance": d, "time": round(d / p["v"], 4)}
                   for r in robots for t in task_list
                   for d in [manhattan(r["x"], r["y"], t["pickup"]["x"], t["pickup"]["y"])]]
    setup_between = [{"from": a["transport_id"], "to": b["transport_id"], "distance": d, "time": round(d / p["v"], 4)}
                     for a in task_list for b in task_list if a is not b
                     for d in [manhattan(a["drop"]["x"], a["drop"]["y"], b["pickup"]["x"], b["pickup"]["y"])]]
    s0 = {(s["robot_id"], s["task_id"]): s["time"] for s in setup_start}

    def part(name: str, base: float, weight: int) -> dict:
        return {"name": name, "base": round(base, 4), "weight": weight, "value": round(base * weight, 4)}

    variables_out = []
    for t in task_list:
        for r in robots:
            eligible = _eligible(t, r)
            if variables == "kandidaten" and not eligible:
                continue
            for q in range(1, K + 1):
                w = _weight(crit, q)
                parts = [part("Anfahrt vom Standort", s0[(r["robot_id"], t["transport_id"])], w),
                         part("Beladen, Lastfahrt, Entladen", t["p"], w)]
                if crit["release"]:
                    parts.insert(0, part("Warten, bis der Roboter frei ist", r["release"], 1))
                variables_out.append({
                    "index": len(variables_out), "task_id": t["transport_id"], "robot_id": r["robot_id"], "slot": q,
                    "weight": w, "cost": round(sum(x["value"] for x in parts), 4), "parts": parts, "eligible": eligible,
                })
    return {
        "snapshot": snapshot,
        "mode": variables,
        "criterion": crit,
        "params": p,
        "slots": K,
        "tasks": task_list,
        "robots": robots,
        "setup": {"start": setup_start, "between": setup_between},
        "variables": variables_out,
    }


def one_hot_sequence(instance: dict) -> dict:
    """One-Hot-Formulierung mit Reihenfolge: Regeln und QUBO-Einträge mit symbolischen Gewichten A, B, D.

    E(x) = Σ c_trq x_trq                                          Kosten je Platz (Diagonale)
         + Σ_r Σ_q Σ_{t≠t'} w_q (s_tt' − s⁰_rt') x_tr(q+1) x_t'rq   Vorgänger-Korrektur (Reihenfolge)
         + A Σ_t (1 − Σ_rq x_trq)²                                 Zeilenregel: jeder Auftrag genau einen Platz
         + B Σ_rq Σ_{t<t'} x_trq x_t'rq                            Platzregel: höchstens ein Auftrag je Platz (K ≥ 2)
         + D Σ_r Σ_q o_r(q+1) (1 − o_rq),  o_rq = Σ_t x_trq         Lückenregel: Platz q+1 nur, wenn q belegt

    Die Platzregel verbietet keine Doppelbelegung – mehrere Aufträge liegen auf verschiedenen Plätzen. Sie
    verhindert nur zwei Aufträge auf demselben Platz (keine Reihenfolge ablesbar). Bei K = 1 wäre sie die
    Spaltenregel und entfällt: Doppelbelegung ist zulässig, der Roboter fährt in Anfrage-Reihenfolge.
    """
    variables = instance["variables"]
    crit = instance["criterion"]
    K = instance["slots"]
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    robot_ids = [r["robot_id"] for r in instance["robots"]]
    s0, sb = _setup_maps(instance)
    idx = {(v["task_id"], v["robot_id"], v["slot"]): v["index"] for v in variables}
    rows = {t: [v["index"] for v in variables if v["task_id"] == t] for t in task_ids}
    slot_vars = {(r, q): [v["index"] for v in variables if v["robot_id"] == r and v["slot"] == q]
                 for r in robot_ids for q in range(1, K + 1)}

    rules = [{"kind": "kosten", "vars": [v["index"]], "task_id": v["task_id"], "robot_id": v["robot_id"],
              "slot": v["slot"], "c": v["cost"]} for v in variables]
    for r in robot_ids:
        for q in range(1, K):
            w = _weight(crit, q)
            for i in task_ids:
                for j in task_ids:
                    a, b = idx.get((i, r, q + 1)), idx.get((j, r, q))
                    if i == j or a is None or b is None:
                        continue
                    rules.append({"kind": "reihenfolge", "vars": [a, b], "robot_id": r, "slot": q, "from": i, "to": j,
                                  "weight": w, "s": sb[(i, j)], "s0": s0[(r, j)], "c": round(w * (sb[(i, j)] - s0[(r, j)]), 4)})
    rules += [{"kind": "zeile", "vars": rows[t], "task_id": t} for t in task_ids]
    rules += [{"kind": "spalte", "vars": slot_vars[(r, q)], "robot_id": r, "slot": q}
              for r in robot_ids for q in range(1, K + 1) if len(slot_vars[(r, q)]) >= 2 and K >= 2]
    rules += [{"kind": "luecke", "upper": slot_vars[(r, q + 1)], "lower": slot_vars[(r, q)],
               "vars": slot_vars[(r, q + 1)] + slot_vars[(r, q)], "robot_id": r, "slot": q}
              for r in robot_ids for q in range(1, K) if slot_vars[(r, q + 1)]]

    entries: dict[tuple[int, int], dict] = {}

    def add(i: int, j: int, part: dict) -> None:
        i, j = min(i, j), max(i, j)
        e = entries.setdefault((i, j), {"i": i, "j": j, "c": 0.0, "A": 0.0, "B": 0.0, "D": 0.0, "parts": []})
        for k in ("c", *WEIGHTS):
            e[k] += part.get(k, 0.0)
        e["parts"].append(part)

    for rule in rules:
        kind = rule["kind"]
        if kind == "kosten":
            add(rule["vars"][0], rule["vars"][0], {"kind": "kosten", "c": float(rule["c"]), "task_id": rule["task_id"],
                                                   "robot_id": rule["robot_id"], "slot": rule["slot"]})
        elif kind == "reihenfolge":
            add(*rule["vars"], {"kind": "reihenfolge", "c": float(rule["c"]), "robot_id": rule["robot_id"],
                                "slot": rule["slot"], "from": rule["from"], "to": rule["to"]})
        elif kind == "zeile":
            # A(1 − Σx)² = A − A Σx + 2A Σ_{i<j} x_i x_j   (weil x² = x)
            for i in rule["vars"]:
                add(i, i, {"kind": "zeile", "A": -1.0, "task_id": rule["task_id"]})
            for i, j in combinations(rule["vars"], 2):
                add(i, j, {"kind": "zeile", "A": 2.0, "task_id": rule["task_id"]})
        elif kind == "spalte":
            for i, j in combinations(rule["vars"], 2):
                add(i, j, {"kind": "spalte", "B": 1.0, "robot_id": rule["robot_id"], "slot": rule["slot"]})
        else:
            # D·o_oben·(1 − o_unten) = D Σ x_oben − D Σ x_oben·x_unten
            for u in rule["upper"]:
                add(u, u, {"kind": "luecke", "D": 1.0, "robot_id": rule["robot_id"], "slot": rule["slot"]})
                for low in rule["lower"]:
                    add(u, low, {"kind": "luecke", "D": -1.0, "robot_id": rule["robot_id"], "slot": rule["slot"]})

    return {
        "encoding": "one_hot_sequence",
        "rules": rules,
        "entries": sorted(entries.values(), key=lambda e: (e["i"], e["j"])),
        "const": {"c": 0.0, "A": float(len(task_ids)), "B": 0.0, "D": 0.0},
        "n": len(variables),
    }


def simulate(instance: dict, sequences: dict[int, list[int]]) -> dict:
    """Fährt die Reihenfolgen ab: Zeitplan je Auftrag und Summe nach dem Kriterium."""
    s0, sb = _setup_maps(instance)
    p = instance["params"]
    task_by_id = {t["transport_id"]: t for t in instance["tasks"]}
    robot_by_id = {r["robot_id"]: r for r in instance["robots"]}
    rows, completion, busy = [], 0.0, 0.0
    for r, seq in sequences.items():
        clock = robot_by_id[r]["release"]
        prev = None
        for k, tid in enumerate(seq):
            task = task_by_id[tid]
            setup = s0[(r, tid)] if prev is None else sb[(prev, tid)]
            start = clock
            clock += setup + task["p"]
            busy += setup + task["p"]
            completion += clock
            rows.append({"task_id": tid, "robot_id": r, "order": k + 1, "slot": len(seq) - k, "start": start,
                         "setup": setup, "setup_from": prev, "load": p["t_lade"], "loaded": task["t_last"],
                         "unload": p["t_ent"], "finish": clock})
            prev = tid
    total = completion if instance["criterion"]["position_weight"] else busy
    return {"tasks": rows, "total": round(total, 4), "completion_sum": round(completion, 4), "busy_sum": round(busy, 4)}


def decode_schedule(instance: dict, x: list[int]) -> dict:
    """Schalterstellung → Reihenfolge je Roboter, plus alle Regelverstöße."""
    on = [v for v in instance["variables"] if x[v["index"]]]
    issues = []
    for t in instance["tasks"]:
        k = sum(v["task_id"] == t["transport_id"] for v in on)
        if k != 1:
            issues.append(f"#{t['transport_id']}: {k} Plätze")
    sequences = {}
    for r in instance["robots"]:
        mine = sorted((v for v in on if v["robot_id"] == r["robot_id"]), key=lambda v: (-v["slot"], v["task_id"]))
        slots = [v["slot"] for v in mine]
        for q in sorted(set(slots)) if instance["slots"] >= 2 else ():  # K = 1: Doppelbelegung zulässig
            if slots.count(q) > 1:
                issues.append(f"R{r['robot_id']} Platz {q}: {slots.count(q)} Aufträge")
        if slots and sorted(set(slots)) != list(range(1, max(slots) + 1)):
            issues.append(f"R{r['robot_id']}: Lücke in den Plätzen")
        if mine:
            sequences[r["robot_id"]] = [v["task_id"] for v in mine]
    return {"valid": not issues, "issues": issues, "sequences": sequences}


def exact_optimum(instance: dict, max_per_robot: int | None = None) -> dict | None:
    """Bester Ablaufplan durch vollständiges Aufzählen aller Reihenfolgen (Probe für die QUBO).

    max_per_robot: höchstens so viele Aufträge je Roboter (Standard: die Plätze K der Instanz).
    None, wenn es keinen gültigen Plan gibt (z.B. mehr Aufträge als Plätze).
    """
    if max_per_robot is None and instance["slots"] == 1:
        return _exact_one_slot(instance)
    K = max_per_robot or instance["slots"]
    s0, sb = _setup_maps(instance)
    position_weight = instance["criterion"].get("position_weight", False)
    task_by_id = {t["transport_id"]: t for t in instance["tasks"]}
    release = {r["robot_id"]: r["release"] for r in instance["robots"]}
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    options = {t: sorted({v["robot_id"] for v in instance["variables"] if v["task_id"] == t}) for t in task_ids}
    seqs: dict[int, list[int]] = {r["robot_id"]: [] for r in instance["robots"]}
    best = {"value": math.inf, "sequences": None, "count": 0}
    # Sofortzuweisung mit einem Kriterium aus cost_model.CRITERIA (Baukasten, K = 1): Ziel = Σ c_tr
    assign_cost = ({(v["task_id"], v["robot_id"]): v["cost"] for v in instance["variables"] if v["slot"] == 1}
                   if instance.get("objective") == "zuweisung" else None)

    def total() -> float:
        if assign_cost is not None:
            return sum(assign_cost[(t, r)] for r, seq in seqs.items() for t in seq)
        out = 0.0
        for r, seq in seqs.items():
            clock, prev = release[r], None
            for tid in seq:
                step = (s0[(r, tid)] if prev is None else sb[(prev, tid)]) + task_by_id[tid]["p"]
                clock += step
                out += clock if position_weight else step
                prev = tid
        return out

    def rec(k: int) -> None:
        if k == len(task_ids):
            best["count"] += 1
            val = total()
            if val < best["value"] - 1e-9:
                best["value"], best["sequences"] = val, {r: list(s) for r, s in seqs.items() if s}
            return
        t = task_ids[k]
        for r in options[t]:
            seq = seqs[r]
            if len(seq) >= K:
                continue
            for pos in range(len(seq) + 1):
                seq.insert(pos, t)
                rec(k + 1)
                seq.pop(pos)

    rec(0)
    if best["sequences"] is None:
        return None
    idx = {(v["task_id"], v["robot_id"], v["slot"]): v["index"] for v in instance["variables"]}
    bits = [idx.get((t, r, len(seq) - k)) for r, seq in best["sequences"].items() for k, t in enumerate(seq)]
    return {
        "value": round(best["value"], 4),
        "sequences": best["sequences"],
        "bits": None if None in bits else sorted(bits),  # ohne Platzgrenze passt der Plan evtl. nicht in K Plätze
        "count": best["count"],
        "max_per_robot": K,
    }


def plan_value(instance: dict, sequences: dict[int, list[int]]) -> float:
    """Wert eines Plans: feste Kosten (Sofortzuweisung mit cost_model.CRITERIA) oder der Ablaufplan."""
    if instance.get("objective") == "zuweisung":
        cost = {(v["task_id"], v["robot_id"]): v["cost"] for v in instance["variables"] if v["slot"] == 1}
        return sum(cost[(t, r)] for r, seq in sequences.items() for t in seq)
    return simulate(instance, sequences)["total"]


def _exact_one_slot(instance: dict) -> dict | None:
    """K = 1: jeder Auftrag genau ein Roboter, Doppelbelegung zulässig. Ein Roboter mit mehreren Aufträgen
    fährt sie in Anfrage-Reihenfolge (Auftragsnummer) – dieselbe Lesart wie decode_schedule."""
    task_ids = sorted(t["transport_id"] for t in instance["tasks"])
    options = {t: sorted({v["robot_id"] for v in instance["variables"] if v["task_id"] == t}) for t in task_ids}
    if any(not o for o in options.values()):
        return None
    best, count = None, 0
    for combo in product(*(options[t] for t in task_ids)):
        seqs: dict[int, list[int]] = {}
        for t, r in zip(task_ids, combo):
            seqs.setdefault(r, []).append(t)
        count += 1
        value = plan_value(instance, seqs)
        if best is None or value < best[0] - 1e-9:
            best = (value, seqs)
    idx = {(v["task_id"], v["robot_id"]): v["index"] for v in instance["variables"] if v["slot"] == 1}
    return {"value": round(best[0], 4), "sequences": best[1], "bits": sorted(idx[(t, r)] for r, s in best[1].items() for t in s),
            "count": count, "max_per_robot": None}


def default_weights(instance: dict) -> dict:
    """Strafgewichte, die sicher über dem Nutzen eines Regelbruchs liegen.

    U ist eine obere Schranke dafür, wie stark das Ziel durch das Hinzunehmen eines Auftrags
    steigen kann (alle Aufträge hintereinander auf einem Roboter). Zeilen- und Lückenregel
    bekommen A = D ≥ 1,1·U. Die Platzregel braucht mehr, weil die Lückenregel bei doppelt
    belegten Plätzen negativ wird (o·(1 − 2) = −o): B = 2·A.
    """
    s0, sb = _setup_maps(instance)
    crit = instance["criterion"]
    per_task = []
    used_robots = {v["robot_id"] for v in instance["variables"]}
    for t in instance["tasks"]:
        tid = t["transport_id"]
        robots = {v["robot_id"] for v in instance["variables"] if v["task_id"] == tid}
        setups = [s0[(r, tid)] for r in robots] + [sb[(i["transport_id"], tid)] for i in instance["tasks"] if i is not t]
        per_task.append(t["p"] + max(setups, default=0.0))
    if crit["position_weight"]:
        U = max((r["release"] for r in instance["robots"] if r["robot_id"] in used_robots), default=0.0) + sum(per_task)
    else:
        U = max(per_task, default=0.0)
    A = nice_ceil(1.1 * U)
    return {"A": A, "B": 2 * A, "D": A, "U": round(U, 2)}


def aux_estimates(instance: dict, form: dict, ia_form: dict, dt: float = 5.0) -> list[dict]:
    """Qubit- und Kopplungsbedarf verschiedener Wege, die Reihenfolge abzubilden (für den Vergleich).

    Sofortzuweisung und Plätze sind exakt gezählt; Zeitraster und explizite Zeiten sind
    Abschätzungen mit Zeitauflösung dt über den Horizont H (alle Aufträge auf einem Roboter).
    """
    s0, sb = _setup_maps(instance)
    n = len(instance["tasks"])
    by_task = {t["transport_id"]: sorted({v["robot_id"] for v in instance["variables"] if v["task_id"] == t["transport_id"]})
               for t in instance["tasks"]}
    m_t = {t: len(r) for t, r in by_task.items()}
    p_of = {t["transport_id"]: t["p"] for t in instance["tasks"]}
    used = sorted({r for rs in by_task.values() for r in rs})
    release = {r["robot_id"]: r["release"] for r in instance["robots"]}
    on_robot = {r: [t for t in by_task if r in by_task[t]] for r in used}

    def max_setup(t: int) -> float:
        return max([s0[(r, t)] for r in by_task[t]] + [sb[(i, t)] for i in by_task if i != t], default=0.0)

    H = max((release[r] for r in used), default=0.0) + sum(p_of[t] + max_setup(t) for t in by_task)
    T = max(1, math.ceil(H / dt))

    def couplings(f: dict) -> int:
        return sum(1 for e in f["entries"] if e["i"] != e["j"])

    # Zeitraster: x_trτ = „r beginnt t im Zeitschritt τ“
    ti_vars = sum(m * T for m in m_t.values())
    ti_coup = sum(m * T * (m * T - 1) // 2 for m in m_t.values())  # One-Hot je Auftrag über (r, τ)
    for r in used:
        for i, j in combinations(on_robot[r], 2):
            w_ij = math.ceil((p_of[i] + sb[(i, j)]) / dt)
            w_ji = math.ceil((p_of[j] + sb[(j, i)]) / dt)
            ti_coup += min(T * T, T * (w_ij + w_ji))  # Startzeiten, die sich überlappen würden

    # Explizite Fertigstellungszeiten: x_tr, Reihenfolgebits y_tt', C_t binär, Schlupfbits je Ungleichung
    bits_c = math.ceil(math.log2(T + 1))
    bits_slack = math.ceil(math.log2(2 * T + 1))
    inequalities = sum(len(ts) * (len(ts) - 1) for ts in on_robot.values()) + sum(m_t.values())
    bm_vars = sum(m_t.values()) + n * (n - 1) // 2 + n * bits_c + inequalities * bits_slack

    return [
        {"key": "sofort", "label": "Sofortzuweisung (One-Hot)", "aux": "keine – x_tr", "qubits": ia_form["n"],
         "couplings": couplings(ia_form), "exact": True,
         "note": "Kann keine Reihenfolge ausdrücken: jeder Roboter höchstens ein Auftrag."},
        {"key": "plaetze", "label": f"Plätze von hinten (diese Seite, K = {instance['slots']})",
         "aux": f"x_trq, q = 1…{instance['slots']}", "qubits": form["n"], "couplings": couplings(form), "exact": True,
         "note": "Ziel bleibt quadratisch; Kopplungen nur zwischen benachbarten Plätzen desselben Roboters."},
        {"key": "zeitraster", "label": f"Zeitraster (time-indexed, Δt = {dt:g} s)", "aux": f"x_trτ, τ = 0…{T - 1}",
         "qubits": ti_vars, "couplings": ti_coup, "exact": False,
         "note": f"Ziel wieder diagonal (Startzeit + Dauer), aber die Qubits wachsen mit Horizont H ≈ {H:.0f} s / Δt."},
        {"key": "zeiten", "label": "Explizite Fertigstellungszeiten (Big-M)",
         "aux": f"y_tt′, C_t mit {bits_c} Bit, {bits_slack} Schlupfbits je Ungleichung", "qubits": bm_vars, "couplings": None,
         "exact": False,
         "note": f"{inequalities} Ungleichungen als Strafterme; Produkte x·x·y·C sind kubisch und brauchen zusätzlich "
                 "Quadratisierungs-Hilfsvariablen (nicht mitgezählt)."},
    ]


# ---------------------------------------------------------------------------------------------
# Domain Wall: je Auftrag eine Kette aus R_t − 1 Bits (Thermometer)
# ---------------------------------------------------------------------------------------------
#
# Kette mit festen Rändern [1, b_1, …, b_{R−1}, 0]. Gültig ist nur die Thermometer-Form 1…1 0…0 –
# die Stelle des Wechsels 1 → 0 (die Wand) ist der Roboter: δ_k = Kette[k] − Kette[k+1] ist 1
# genau für den k-ten Roboter der Kette (k = 0 … R−1). Eine Domain-Wall-Kette kann weder
# „niemand“ noch „zwei Roboter“ ausdrücken – nur ungültige Ketten mit mehreren Wänden.
# Chancellor (2019), Kapitel encodings/domain_wall/README.md.

DW_ORDERS = ("nummer", "kosten")


def _lin(const: float = 0.0, terms: dict[int, float] | None = None) -> dict:
    """Lineare Form const + Σ coef·b_i."""
    return {"const": const, "terms": dict(terms or {})}


def _lin_eval(e: dict, x: list[int]) -> float:
    return e["const"] + sum(c * x[i] for i, c in e["terms"].items())


def domain_wall(instance: dict, order: str = "nummer", column_rule: bool = False) -> dict:
    """Domain-Wall-Formulierung einer Sofortzuweisung (Instanz aus build_instance).

    E(b) = Σ_t Σ_k c_{t,k} δ_{t,k}                    Kosten (Teleskopsumme: Konstante + Differenzen)
         + A Σ_t Σ_i b_{t,i+1} (1 − b_{t,i})          Kettenregel: keine Wand 0 → 1

    Doppelbelegung ist zulässig – die Ketten der Aufträge sind nicht gekoppelt. Nur mit column_rule=True
    (strengere Variante, höchstens ein Auftrag je Roboter):
         + B Σ_r Σ_{t<t'} δ_{t,r} δ_{t',r}            Spaltenregel

    order = "nummer": Roboter in der Kette nach Nummer; "kosten": billigster zuerst.
    """
    if order not in DW_ORDERS:
        raise ValueError(f"Reihenfolge muss eine von {DW_ORDERS} sein")
    variables = instance["variables"]
    chains, bits = [], []
    for t in instance["tasks"]:
        tid = t["transport_id"]
        cand = [v for v in variables if v["task_id"] == tid]
        cand.sort(key=(lambda v: (v["cost"], v["robot_id"])) if order == "kosten" else (lambda v: v["robot_id"]))
        idx = []
        for k in range(1, len(cand)):
            idx.append(len(bits))
            bits.append({"index": len(bits), "task_id": tid, "pos": k, "left": cand[k - 1]["robot_id"],
                         "right": cand[k]["robot_id"]})
        chains.append({"task_id": tid, "robots": [v["robot_id"] for v in cand], "costs": [v["cost"] for v in cand],
                       "bits": idx})

    def deltas(ch: dict) -> list[dict]:
        """δ_k als lineare Form über die Bits der Kette (Ränder fest 1 und 0)."""
        b = [_lin(1.0)] + [_lin(0.0, {i: 1.0}) for i in ch["bits"]] + [_lin(0.0)]
        out = []
        for k in range(len(ch["robots"])):
            terms = dict(b[k]["terms"])
            for i, c in b[k + 1]["terms"].items():
                terms[i] = terms.get(i, 0.0) - c
            out.append(_lin(b[k]["const"] - b[k + 1]["const"], terms))
        return out

    rules: list[dict] = []
    entries: dict[tuple[int, int], dict] = {}
    const_parts: list[dict] = []

    def add(i: int, j: int, part: dict) -> None:
        i, j = min(i, j), max(i, j)
        e = entries.setdefault((i, j), {"i": i, "j": j, "c": 0.0, "A": 0.0, "B": 0.0, "parts": []})
        for k in ("c", "A", "B"):
            e[k] += part.get(k, 0.0)
        e["parts"].append(part)

    for ch in chains:
        tid = ch["task_id"]
        if not ch["robots"]:
            continue  # kein Roboter: der Auftrag ist in Domain Wall gar nicht darstellbar
        ds = deltas(ch)
        rules.append({"kind": "kosten", "task_id": tid, "vars": ch["bits"], "robots": ch["robots"], "costs": ch["costs"],
                      "deltas": ds})
        # Teleskopsumme: Σ_k c_k δ_k = c_0 + Σ_k (c_k − c_{k−1}) b_k
        const_parts.append({"kind": "kosten", "c": float(ch["costs"][0]), "task_id": tid, "robot_id": ch["robots"][0]})
        for k, i in enumerate(ch["bits"], start=1):
            add(i, i, {"kind": "kosten", "c": round(float(ch["costs"][k] - ch["costs"][k - 1]), 4), "task_id": tid,
                       "left": ch["robots"][k - 1], "right": ch["robots"][k]})
        # Kettenregel: b_{i+1}(1 − b_i) = b_{i+1} − b_i b_{i+1}
        for a, b in zip(ch["bits"], ch["bits"][1:]):
            rules.append({"kind": "kette", "task_id": tid, "vars": [a, b]})
            add(b, b, {"kind": "kette", "A": 1.0, "task_id": tid})
            add(a, b, {"kind": "kette", "A": -1.0, "task_id": tid})

    # Spaltenregel: je Roboter und Auftragspaar δ·δ′ – Produkt zweier linearer Formen
    by_robot: dict[int, list[tuple[int, dict]]] = {}
    for ch in chains:
        for r, d in zip(ch["robots"], deltas(ch) if ch["robots"] else []):
            by_robot.setdefault(r, []).append((ch["task_id"], d))
    for r, items in by_robot.items() if column_rule else ():
        for (t1, d1), (t2, d2) in combinations(items, 2):
            rules.append({"kind": "spalte", "robot_id": r, "tasks": [t1, t2], "vars": sorted(set(d1["terms"]) | set(d2["terms"])),
                          "deltas": [d1, d2]})
            meta = {"kind": "spalte", "robot_id": r, "tasks": [t1, t2]}
            c0 = d1["const"] * d2["const"]
            if c0:
                const_parts.append({**meta, "B": c0})
            for i, c in d1["terms"].items():
                if d2["const"]:
                    add(i, i, {**meta, "B": c * d2["const"]})
            for j, c in d2["terms"].items():
                if d1["const"]:
                    add(j, j, {**meta, "B": c * d1["const"]})
            for i, ci in d1["terms"].items():
                for j, cj in d2["terms"].items():
                    add(i, j, {**meta, "B": ci * cj})

    const = {"c": 0.0, "A": 0.0, "B": 0.0}
    for p in const_parts:
        for k in const:
            const[k] += p.get(k, 0.0)
    return {
        "encoding": "domain_wall",
        "column_rule": column_rule,
        "order": order,
        "chains": chains,
        "bits": bits,
        "rules": rules,
        "entries": sorted(entries.values(), key=lambda e: (e["i"], e["j"])),
        "const": const,
        "const_parts": const_parts,
        "n": len(bits),
        "unrepresentable": [ch["task_id"] for ch in chains if not ch["robots"]],
    }


def energy_rules_dw(form: dict, x: list[int], A: float, B: float) -> float:
    """E(b) direkt aus den Regeln der Domain-Wall-Formulierung – muss mit energy_qubo übereinstimmen."""
    e = 0.0
    for r in form["rules"]:
        if r["kind"] == "kosten":
            e += sum(c * _lin_eval(d, x) for c, d in zip(r["costs"], r["deltas"]))
        elif r["kind"] == "kette":
            a, b = r["vars"]
            e += A * x[b] * (1 - x[a])
        else:
            e += B * _lin_eval(r["deltas"][0], x) * _lin_eval(r["deltas"][1], x)
    return e


def decode_domain_wall(form: dict, x: list[int]) -> dict:
    """Bits → Roboter je Auftrag. Gültig: jede Kette hat genau eine Wand (Doppelbelegung nur mit Spaltenregel verboten)."""
    tasks, issues = {}, []
    for ch in form["chains"]:
        tid = ch["task_id"]
        if not ch["robots"]:
            issues.append(f"#{tid}: kein Roboter – nicht darstellbar")
            continue
        b = [1] + [x[i] for i in ch["bits"]] + [0]
        down = [k for k in range(len(b) - 1) if b[k] == 1 and b[k + 1] == 0]
        up = [k for k in range(len(b) - 1) if b[k] == 0 and b[k + 1] == 1]
        if up:
            issues.append(f"#{tid}: {len(down) + len(up)} Wände")
        else:
            tasks[tid] = ch["robots"][down[0]]
    issues += _double_issues(tasks) if form.get("column_rule") else []
    return {"valid": not issues, "issues": issues, "assignment": tasks}


def _double_issues(assignment: dict[int, int]) -> list[str]:
    """Doppelbelegungen – nur ein Verstoß in der strengeren Variante mit Spaltenregel."""
    used: dict[int, list[int]] = {}
    for tid, r in assignment.items():
        used.setdefault(r, []).append(tid)
    return [f"R{r} fährt {len(ts)} Aufträge" for r, ts in used.items() if len(ts) > 1]


def best_assignment(instance: dict, distinct: bool = False) -> dict | None:
    """Beste gültige Sofortzuweisung durch Aufzählen: jeder Auftrag genau ein Roboter.

    Doppelbelegung ist zulässig – dann nimmt jeder Auftrag seinen billigsten Roboter. distinct=True ist die
    strengere Variante mit Spaltenregel (kein Roboter doppelt).
    """
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    options = {t: [v for v in instance["variables"] if v["task_id"] == t] for t in task_ids}
    best, count = None, 0
    for combo in product(*(options[t] for t in task_ids)):
        robots = [v["robot_id"] for v in combo]
        if distinct and len(set(robots)) < len(robots):
            continue
        count += 1
        value = round(sum(v["cost"] for v in combo), 4)
        if best is None or value < best["value"] - 1e-9:
            best = {"value": value, "assignment": {v["task_id"]: v["robot_id"] for v in combo}}
    return None if best is None else {**best, "count": count}


def dw_default_weights(instance: dict, column_rule: bool = False) -> dict:
    """Strafgewichte für Domain Wall.

    Ohne Spaltenregel (Standard) muss nur die Kettenregel einen Kettenbruch teurer machen, als er bringt.
    Ein Bruch erzeugt ein Wandpaar (δ = −1 an einem Roboter, δ = +1 an einem weiteren); damit sinkt der
    Kostenwert höchstens um die Spannweite der Kosten (teuerster minus billigster Roboter eines Auftrags).
    A > Spannweite genügt, empfohlen A = 1,5 × Spannweite.

    Mit Spaltenregel (column_rule=True): B > Spannweite, und A muss B zusätzlich überstimmen, weil an einer
    falschen Wand δ = −1 wird und die Spaltenregel dann belohnt statt bestraft: A = 2B. (Mit A = B war das
    Minimum in rund 40 % der geprüften echten Momente unzulässig – siehe tests/test_domain_wall.py.)
    """
    spreads = []
    for t in instance["tasks"]:
        c = [v["cost"] for v in instance["variables"] if v["task_id"] == t["transport_id"]]
        if c:
            spreads.append(max(c) - min(c))
    spread = max(spreads, default=0.0)
    P = nice_ceil(max(10.0, 1.5 * spread))
    if column_rule:
        return {"A": 2 * P, "B": P, "spread": round(spread, 4)}
    return {"A": P, "B": 0.0, "spread": round(spread, 4)}


# ---------------------------------------------------------------------------------------------
# Binary: je Auftrag die Roboternummer als Binärzahl aus ⌈log₂ R_t⌉ Bits
# ---------------------------------------------------------------------------------------------
#
# Roboter k der Kandidatenliste (k = 0 … R−1) hat den Code k, höchste Stelle zuerst. Die Aussage
# „Roboter k ist gewählt“ ist das Indikator-Produkt I_k = Π_j (z_j bzw. 1 − z_j) – ein Polynom vom
# Grad ⌈log₂ R⌉. Kosten, ungültige Codes und Spaltenregel ergeben deshalb ein Polynom höheren Grades.
# Es wird mit Hilfsbits nach Rosenberg (1975) auf Grad 2 gebracht: w ersetzt das Paar x·y, die
# Strafe M·(xy − 2xw − 2yw + 3w) ist genau dann 0, wenn w = x·y. Lesekapitel: encodings/binary/README.md

BINARY_KINDS = ("kosten", "ungueltig", "spalte")


def _poly_mul(a: dict, b: dict) -> dict:
    out: dict[frozenset, float] = {}
    for k1, c1 in a.items():
        for k2, c2 in b.items():
            k = k1 | k2
            out[k] = out.get(k, 0.0) + c1 * c2
    return {k: c for k, c in out.items() if abs(c) > 1e-12}


def _indicator(bits: list[int], code: int) -> dict:
    """I_code = Π_j (z_j, falls Stelle j von code eine 1 ist, sonst 1 − z_j); höchste Stelle zuerst."""
    nb = len(bits)
    poly = {frozenset(): 1.0}
    for j, i in enumerate(bits):
        one = (code >> (nb - 1 - j)) & 1
        factor = {frozenset([i]): 1.0} if one else {frozenset(): 1.0, frozenset([i]): -1.0}
        poly = _poly_mul(poly, factor)
    return poly


def binary(instance: dict, order: str = "nummer", column_rule: bool = False) -> dict:
    """Binary-Formulierung einer Sofortzuweisung (Instanz aus build_instance).

    Polynom (beliebiger Grad):
        E(z) = Σ_t Σ_k c_{t,k} I_{t,k}(z)               Kosten
             + A Σ_t Σ_{k ≥ R_t} I_{t,k}(z)             ungültige Codes („Phantomroboter“)
             + B Σ_r Σ_{t<t'} I_{t,r}(z) I_{t',r}(z)     Spaltenregel – nur mit column_rule=True
    Ohne Spaltenregel (Standard: Doppelbelegung zulässig) koppeln die Aufträge nicht; der Grad ist ⌈log₂ R⌉.
    QUBO: jedes Paar, das in einem Term vom Grad > 2 vorkommt, wird schrittweise durch ein Hilfsbit
    ersetzt (das häufigste zuerst) + D·(xy − 2xw − 2yw + 3w). Das Gewicht D ist die Hilfsbit-Strafe M.
    """
    if order not in DW_ORDERS:
        raise ValueError(f"Reihenfolge muss eine von {DW_ORDERS} sein")
    variables = instance["variables"]
    tasks, bits = [], []
    for t in instance["tasks"]:
        tid = t["transport_id"]
        cand = [v for v in variables if v["task_id"] == tid]
        cand.sort(key=(lambda v: (v["cost"], v["robot_id"])) if order == "kosten" else (lambda v: v["robot_id"]))
        R = len(cand)
        nb = math.ceil(math.log2(R)) if R > 1 else 0
        idx = []
        for j in range(nb):
            idx.append(len(bits))
            bits.append({"index": len(bits), "task_id": tid, "pos": j + 1, "place": 2 ** (nb - 1 - j), "aux": False})
        codes = [{"code": k, "pattern": format(k, f"0{nb}b") if nb else "", "robot_id": cand[k]["robot_id"] if k < R else None,
                  "cost": cand[k]["cost"] if k < R else None} for k in range(2 ** nb if nb else (1 if R else 0))]
        tasks.append({"task_id": tid, "robots": [v["robot_id"] for v in cand], "costs": [v["cost"] for v in cand],
                      "bits": idx, "nb": nb, "codes": codes})

    # Polynome je Termart; Koeffizient als {c, A, B}
    polys: dict[str, dict[frozenset, dict]] = {k: {} for k in BINARY_KINDS}
    rules: list[dict] = []

    def put(kind: str, poly: dict, weight: str, scale: float) -> None:
        for mono, coef in poly.items():
            e = polys[kind].setdefault(mono, {"c": 0.0, "A": 0.0, "B": 0.0})
            e[weight] += coef * scale

    for t in tasks:
        if not t["robots"]:
            continue
        for k, cost in enumerate(t["costs"]):
            put("kosten", _indicator(t["bits"], k), "c", float(cost))
        rules.append({"kind": "kosten", "task_id": t["task_id"], "vars": t["bits"], "costs": t["costs"]})
        invalid = [c["code"] for c in t["codes"] if c["robot_id"] is None]
        if invalid:
            for k in invalid:
                put("ungueltig", _indicator(t["bits"], k), "A", 1.0)
            rules.append({"kind": "ungueltig", "task_id": t["task_id"], "vars": t["bits"], "codes": invalid})
    for t1, t2 in combinations([t for t in tasks if t["robots"]], 2) if column_rule else ():
        for r in set(t1["robots"]) & set(t2["robots"]):
            k1, k2 = t1["robots"].index(r), t2["robots"].index(r)
            put("spalte", _poly_mul(_indicator(t1["bits"], k1), _indicator(t2["bits"], k2)), "B", 1.0)
            rules.append({"kind": "spalte", "robot_id": r, "tasks": [t1["task_id"], t2["task_id"]], "codes": [k1, k2],
                          "vars": t1["bits"] + t2["bits"]})
    for kind in BINARY_KINDS:  # Terme, die sich weggehoben haben, entfernen
        polys[kind] = {m: e for m, e in polys[kind].items() if any(abs(v) > 1e-12 for v in e.values())}

    def degree_counts(ps: dict) -> dict[int, int]:
        counts: dict[int, int] = {}
        for p in ps.values():
            for m in p:
                if m:
                    counts[len(m)] = counts.get(len(m), 0) + 1
        return dict(sorted(counts.items()))

    degrees_before = degree_counts(polys)
    original = {kind: [{"vars": sorted(m), **e} for m, e in p.items()] for kind, p in polys.items()}

    # Quadratisierung: häufigstes Paar in Termen vom Grad > 2 durch ein Hilfsbit ersetzen
    aux: list[dict] = []
    work = {kind: dict(p) for kind, p in polys.items()}
    while True:
        counts: dict[tuple[int, int], int] = {}
        for p in work.values():
            for m in p:
                if len(m) > 2:
                    for pair in combinations(sorted(m), 2):
                        counts[pair] = counts.get(pair, 0) + 1
        if not counts:
            break
        # häufigstes Paar; bei Gleichstand Paare über zwei Aufträge (wie die XNOR-Hilfsbits im Kapitel)
        task_of = {b["index"]: b["task_id"] for b in bits}
        x, y = min(counts, key=lambda pr: (-counts[pr], task_of[pr[0]] == task_of[pr[1]], pr))
        w = len(bits)
        bits.append({"index": w, "task_id": None, "pos": len(aux) + 1, "place": None, "aux": True, "pair": [x, y]})
        aux.append({"index": w, "pair": [x, y], "replaced": counts[(x, y)]})
        for kind, p in work.items():
            new: dict[frozenset, dict] = {}
            for m, e in p.items():
                m2 = (m - {x, y}) | {w} if len(m) > 2 and x in m and y in m else m
                acc = new.setdefault(m2, {"c": 0.0, "A": 0.0, "B": 0.0})
                for key in acc:
                    acc[key] += e[key]
            work[kind] = new

    entries: dict[tuple[int, int], dict] = {}
    const_parts: list[dict] = []

    def add(i: int, j: int, part: dict) -> None:
        i, j = min(i, j), max(i, j)
        e = entries.setdefault((i, j), {"i": i, "j": j, "c": 0.0, "A": 0.0, "B": 0.0, "D": 0.0, "parts": []})
        for k in ("c", "A", "B", "D"):
            e[k] += part.get(k, 0.0)
        e["parts"].append(part)

    for kind, p in work.items():
        for m, e in p.items():
            part = {"kind": kind, **{k: v for k, v in e.items() if abs(v) > 1e-12}}
            if len(part) == 1:
                continue
            ms = sorted(m)
            if not ms:
                const_parts.append(part)
            elif len(ms) == 1:
                add(ms[0], ms[0], part)
            else:
                add(ms[0], ms[1], part)
    for a in aux:  # Rosenberg: D·(xy − 2xw − 2yw + 3w)
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
    n_task_bits = sum(len(t["bits"]) for t in tasks)
    return {
        "encoding": "binary",
        "column_rule": column_rule,
        "order": order,
        "tasks": tasks,
        "bits": bits,
        "aux": aux,
        "n_task_bits": n_task_bits,
        "rules": rules,
        "polynomial": original,
        "degrees_before": degrees_before,
        "max_degree": max(degrees_before, default=0),
        "entries": sorted(entries.values(), key=lambda e: (e["i"], e["j"])),
        "const": const,
        "const_parts": const_parts,
        "n": len(bits),
        "unrepresentable": [t["task_id"] for t in tasks if not t["robots"]],
    }


def binary_poly_energy(form: dict, x: list[int], A: float, B: float, kinds: tuple = BINARY_KINDS) -> float:
    """Wert des ursprünglichen Polynoms (vor der Quadratisierung) – nur die Auftrags-Bits zählen."""
    e = 0.0
    for kind in kinds:
        for term in form["polynomial"][kind]:
            if all(x[i] for i in term["vars"]):
                e += term["c"] + term["A"] * A + term["B"] * B
    return e


def decode_binary(form: dict, x: list[int]) -> dict:
    """Bits → Roboter je Auftrag; Verstöße: ungültiger Code, Hilfsbit ≠ Produkt („lügt“), mit Spaltenregel auch Roboter doppelt."""
    assignment, issues = {}, []
    for t in form["tasks"]:
        tid = t["task_id"]
        if not t["robots"]:
            issues.append(f"#{tid}: kein Roboter – nicht darstellbar")
            continue
        code = sum(x[i] << (t["nb"] - 1 - j) for j, i in enumerate(t["bits"]))
        if code >= len(t["robots"]):
            issues.append(f"#{tid}: Code {code} gibt es nicht")
        else:
            assignment[tid] = t["robots"][code]
    issues += _double_issues(assignment) if form.get("column_rule") else []
    lies = [a["index"] for a in form["aux"] if x[a["index"]] != x[a["pair"][0]] * x[a["pair"][1]]]
    if lies:
        issues.append(f"{len(lies)} Hilfsbit(s) ≠ Produkt")
    return {"valid": not issues, "issues": issues, "assignment": assignment, "lies": lies}


def honest_aux(form: dict, x: list[int]) -> list[int]:
    """Hilfsbits ehrlich setzen: w = x·y (in Reihenfolge, Hilfsbits können auf Hilfsbits aufbauen)."""
    x = list(x)
    for a in form["aux"]:
        x[a["index"]] = x[a["pair"][0]] * x[a["pair"][1]]
    return x


def binary_lie_gains(form: dict, A: float, B: float) -> dict[int, float]:
    """Je Hilfsbit: der größte Energiegewinn, wenn es „lügt“ (w ≠ x·y) – ohne die Hilfsbit-Strafe.

    Alle Belegungen der Nachbarn des Hilfsbits werden durchprobiert (bis 16 Nachbarn, sonst die
    Summe der Beträge als obere Schranke). Ein Lügen kostet mindestens M (Rosenberg-Term ≥ 1),
    also verhindert M > größter Gewinn jede einzelne Lüge.
    """
    lin: dict[int, float] = {a["index"]: 0.0 for a in form["aux"]}
    nbr: dict[int, dict[int, float]] = {a["index"]: {} for a in form["aux"]}
    for e in form["entries"]:
        value = sum(p.get("c", 0.0) + p.get("A", 0.0) * A + p.get("B", 0.0) * B for p in e["parts"] if p["kind"] != "hilfsbit")
        if not value:
            continue
        if e["i"] == e["j"]:
            if e["i"] in lin:
                lin[e["i"]] += value
            continue
        for w, other in ((e["i"], e["j"]), (e["j"], e["i"])):
            if w in nbr:
                nbr[w][other] = nbr[w].get(other, 0.0) + value
    gains = {}
    for a in form["aux"]:
        w = a["index"]
        x, y = a["pair"]
        context = sorted(set(nbr[w]) | {x, y})
        if len(context) > 16:
            gains[w] = abs(lin[w]) + sum(abs(q) for q in nbr[w].values())
            continue
        best = 0.0
        for mask in range(1 << len(context)):
            val = {v: (mask >> k) & 1 for k, v in enumerate(context)}
            honest = val[x] * val[y]
            field = lin[w] + sum(q * val[j] for j, q in nbr[w].items())
            delta = (1 - 2 * honest) * field  # Energieänderung, wenn w von x·y auf 1 − x·y springt
            best = max(best, -delta)
        gains[w] = best
    return gains


def binary_default_weights(instance: dict, form: dict) -> dict:
    """Strafgewichte für Binary.

    A (ungültige Codes): ein Phantomroboter kostet sonst 0 – A muss die größten Kosten übersteigen.
    B (Spaltenregel, nur column_rule=True): wie bei Domain Wall reicht die Spannweite der Kosten.
    M (Hilfsbits): größer als der größte Gewinn, den ein lügendes Hilfsbit bringt (binary_lie_gains).
    Mit Spaltenregel wächst das mit der Zahl der Aufträge, die sich ein Hilfsbit teilen – siehe tests/test_binary.py.
    """
    costs = [v["cost"] for v in instance["variables"]]
    spreads = [max(t["costs"]) - min(t["costs"]) for t in form["tasks"] if t["costs"]]
    A = nice_ceil(max(10.0, 1.5 * max(costs, default=0.0)))
    B = nice_ceil(max(10.0, 1.5 * max(spreads, default=0.0))) if form.get("column_rule") else 0.0
    gains = binary_lie_gains(form, A, B)
    M = nice_ceil(max(10.0, 1.1 * max(gains.values(), default=0.0)))
    return {"A": A, "B": B, "M": M}
