"""QUBO-Formulierungen des Zuweisungsproblems – One-Hot, mit und ohne Reihenfolge.

Baut aus einem Moment der Simulation (gewählte Anfragen + Flottenzustand) eine kleine
Lern-Instanz und beschreibt die Formulierung auf zwei Ebenen:

- **Regeln** (für Menschen): Kosten je Schalter, Zeilenregel je Auftrag, Spaltenregel je Roboter
- **QUBO-Einträge** (für die Hardware): Q_ij als Summe der Beiträge aus den Regeln

Die Strafgewichte A, B (und D) bleiben symbolisch – jeder Koeffizient wird als
c + a·A + b·B + d·D gespeichert –, damit die Oberfläche sie live verändern kann.

Zwei Problemklassen (Gerkey & Matarić 2004):

- **Sofortzuweisung** (`one_hot`, instantaneous assignment): Jeder Roboter bekommt höchstens
  einen Auftrag. Dann ist jede Zuweisung eine feste Zahl c_tr – sie steht auf der Diagonale.
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
from itertools import combinations, product

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


def one_hot(instance: dict) -> dict:
    """One-Hot-Formulierung: Regeln und QUBO-Einträge mit symbolischen Gewichten A und B.

    E(x) = Σ c_tr x_tr                       Kosten
         + A Σ_t (1 − Σ_r x_tr)²             Zeilenregel: jeder Auftrag genau einen Roboter
         + B Σ_r Σ_{t<t'} x_tr x_t'r         Spaltenregel: kein Roboter zwei Aufträge
    """
    variables = instance["variables"]
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    robot_ids = [r["robot_id"] for r in instance["robots"]]
    rows = {t: [v["index"] for v in variables if v["task_id"] == t] for t in task_ids}
    cols = {r: [v["index"] for v in variables if v["robot_id"] == r] for r in robot_ids}

    rules = [{"kind": "kosten", "vars": [v["index"]], "task_id": v["task_id"], "robot_id": v["robot_id"], "c": v["cost"]}
             for v in variables]
    rules += [{"kind": "zeile", "vars": rows[t], "task_id": t} for t in task_ids]
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
    for r, idx in cols.items():
        for i, j in combinations(idx, 2):
            add(i, j, {"kind": "spalte", "B": 1.0, "robot_id": r})

    return {
        "encoding": "one_hot",
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
            e += A * (1 - on) ** 2
        else:
            e += B * on * (on - 1) / 2
    return e


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
         + B Σ_rq Σ_{t<t'} x_trq x_t'rq                            Platzregel: höchstens ein Auftrag je Platz
         + D Σ_r Σ_q o_r(q+1) (1 − o_rq),  o_rq = Σ_t x_trq         Lückenregel: Platz q+1 nur, wenn q belegt
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
              for r in robot_ids for q in range(1, K + 1) if len(slot_vars[(r, q)]) >= 2]
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
        for q in sorted(set(slots)):
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


def domain_wall(instance: dict, order: str = "nummer") -> dict:
    """Domain-Wall-Formulierung einer Sofortzuweisung (Instanz aus build_instance).

    E(b) = Σ_t Σ_k c_{t,k} δ_{t,k}                    Kosten (Teleskopsumme: Konstante + Differenzen)
         + A Σ_t Σ_i b_{t,i+1} (1 − b_{t,i})          Kettenregel: keine Wand 0 → 1
         + B Σ_r Σ_{t<t'} δ_{t,r} δ_{t',r}            Spaltenregel: kein Roboter doppelt

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
    for r, items in by_robot.items():
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
    """Bits → Roboter je Auftrag. Gültig: jede Kette hat genau eine Wand und kein Roboter fährt doppelt."""
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
    used: dict[int, list[int]] = {}
    for tid, r in tasks.items():
        used.setdefault(r, []).append(tid)
    for r, ts in used.items():
        if len(ts) > 1:
            issues.append(f"R{r} fährt {len(ts)} Aufträge")
    return {"valid": not issues, "issues": issues, "assignment": tasks}


def best_assignment(instance: dict) -> dict | None:
    """Beste gültige Sofortzuweisung (jeder Auftrag genau ein Roboter, kein Roboter doppelt) durch Aufzählen."""
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    options = {t: [v for v in instance["variables"] if v["task_id"] == t] for t in task_ids}
    best, count = None, 0
    for combo in product(*(options[t] for t in task_ids)):
        robots = [v["robot_id"] for v in combo]
        if len(set(robots)) < len(robots):
            continue
        count += 1
        value = round(sum(v["cost"] for v in combo), 4)
        if best is None or value < best["value"] - 1e-9:
            best = {"value": value, "assignment": {v["task_id"]: v["robot_id"] for v in combo}}
    return None if best is None else {**best, "count": count}


def dw_default_weights(instance: dict) -> dict:
    """Strafgewichte für Domain Wall.

    Ein Auftrag kann in Domain Wall nicht liegen bleiben, also zählt nur die Spannweite der Kosten
    (teuerster minus billigster Roboter eines Auftrags): B > Spannweite macht Doppelbelegung teurer
    als jedes Ausweichen. A muss B zusätzlich überstimmen, weil an einer falschen Wand δ = −1 wird und
    die Spaltenregel dann belohnt statt bestraft: A = 2B. (Mit A = B war das Minimum in rund 40 % der
    geprüften echten Momente unzulässig, mit A = 2B in keinem – siehe tests/test_domain_wall.py.)
    """
    spreads = []
    for t in instance["tasks"]:
        c = [v["cost"] for v in instance["variables"] if v["task_id"] == t["transport_id"]]
        if c:
            spreads.append(max(c) - min(c))
    spread = max(spreads, default=0.0)
    B = nice_ceil(max(10.0, 1.5 * spread))
    return {"A": 2 * B, "B": B, "spread": round(spread, 4)}
