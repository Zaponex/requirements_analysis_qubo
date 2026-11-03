"""Ressourcen der Formulierungen: Qubits, Kopplungen, Dichte, Grad, Präzision und gültige Zustände.

Ein **Fall** ist Problemklasse × Kodierung × Variante an einem Szenario (echter Moment oder „nur Struktur“ mit T, R):

    IA  paar        „höchstens eins“ als Paarstrafe Σ x·x′ – wie formulations.*_ia. Das ist die unbalancierte Strafe
                    −λ1·g + λ2·g² mit g = 1 − Σx und λ1 = λ2 (Montañez-Barrera 2024): g(g − 1) = 2·C(Σx, 2). Kein Slack.
    IA  slack       „höchstens eins“ als (Σx + s − 1)² mit einem Slack-Bit je Ungleichung (bei T = R gibt es keine)
    TA  wb          Lastausgleich H_obj + A·H_pen + B·H_WB (workload.py)
    TA  kap_slack   wb + Kapazität Σ_t x_tr ≤ K je Roboter: C·(Σx + Σ w_j s_j − K)², ⌈log₂(K+1)⌉ Slack-Bits je Roboter
    TA  kap_unbal   wb + Kapazität unbalanciert: C·(g²/K − g), g = K − Σx – null bei Σx ∈ {0, K}, Belohnung dazwischen, kein Slack
    TA  makespan    min C_max statt Lastausgleich: C_max als Binärzahl im Raster δ, je Roboter L_r + s_r = C_max (Slack-Bits)

Alle Terme werden als Polynom über die Bits gebaut (Gewichte schon eingesetzt), bei Binary nach Rosenberg quadratisiert und dann
gezählt. Die Kennzahlen folgen der Literatur im Ordner literature/: Qubits und Hilfs-/Slack-Variablen (Chen 2021, Montañez-Barrera
2024), Kopplungen und Grad gegen den Hardware-Graphen (Chancellor 2019, Berwall 2022), höchster Grad vor der Quadratisierung und
Anteil gültiger Zustände (Sawaya 2023), Dynamikbereich der Koeffizienten (Chancellor 2019, Berwall 2022).
"""
from __future__ import annotations

import math
from functools import lru_cache
from itertools import combinations, product

import numpy as np

import workload
from formulations import (
    _chain_deltas, _indicator, _lin_poly, _poly_mul, _quadratize_groups, binary_lie_gains, build_ia_instance, domain_wall_ia,
    ia_default_weights, ia_dw_default_weights, ia_valid_plans, nice_ceil,
)

CLASSES = ("IA", "TA")
ENCODINGS = ("one_hot", "domain_wall", "binary")
VARIANTS: dict[str, dict[str, dict]] = {
    "IA": {
        "paar": {"label": "Paarstrafe", "text": "höchstens eins: Σ x·x′ (= unbalanciert mit λ1 = λ2), ohne Slack"},
        "slack": {"label": "Slack", "text": "höchstens eins: (Σx + s − 1)², ein Slack-Bit je Ungleichung"},
    },
    "TA": {
        "wb": {"label": "Lastausgleich", "text": "H_obj + A·H_pen + B·Σ_r L_r²"},
        "kap_slack": {"label": "Kapazität (Slack)", "text": "+ Σ_t x_tr ≤ K je Roboter mit ⌈log₂(K+1)⌉ Slack-Bits"},
        "kap_unbal": {"label": "Kapazität (unbalanciert)", "text": "+ Σ_t x_tr ≤ K als −g + g²/K, g = K − Σx, ohne Slack"},
        "makespan": {"label": "Makespan", "text": "min C_max: C_max binär (Raster δ), L_r + s_r = C_max je Roboter"},
    },
}
VAR_TYPES = ("entscheidung", "hilfsbit", "slack", "schranke")
KINDS = ("regel", "quer", "last", "kapazitaet", "makespan", "hilfsbit", "kosten")  # Vorrang bei der Zuordnung einer Kopplung
CHECK_MAX_BITS = 18
MAX_STRUCT_T, MAX_STRUCT_R = 18, 9  # „nur Struktur“ und die Folgen der Verlaufsabbildung (halb: bis 18 × 9)


# ---------------------------------------------------------------------------------------------
# Instanzen
# ---------------------------------------------------------------------------------------------

def structure_instance(T: int, R: int) -> dict:
    """Nur Struktur: T Aufträge, R Roboter, volle Zuständigkeit, Kosten 40 … 100 s ohne zufällige Auslöschungen, keine Vorlast."""
    if not (1 <= T <= MAX_STRUCT_T and 1 <= R <= MAX_STRUCT_R):
        raise ValueError(f"Struktur: 1 ≤ T ≤ {MAX_STRUCT_T} und 1 ≤ R ≤ {MAX_STRUCT_R}")
    variables = []
    for t, r in product(range(1, T + 1), range(1, R + 1)):
        frac = math.sqrt(17 * t + 7 * r * r + 3) % 1
        variables.append({"index": len(variables), "task_id": t, "robot_id": 60 + r, "cost": round(40 + 60 * frac, 4)})
    return {"tasks": [{"transport_id": t} for t in range(1, T + 1)],
            "robots": [{"robot_id": 60 + r, "load0": 0.0, "available": True} for r in range(1, R + 1)],
            "variables": variables, "structure": True}


def case_instance(payload: dict | None, spec: dict) -> dict:
    """Instanz eines Falls: echter Moment (Aufträge, Roboter, Modus) oder Struktur (T, R)."""
    cls = spec.get("cls", "IA")
    if cls not in CLASSES:
        raise ValueError(f"Klasse muss eine von {CLASSES} sein")
    if spec.get("struktur") or payload is None:
        return structure_instance(int(spec.get("T", 3)), int(spec.get("R", 3)))
    tasks = [int(t) for t in spec.get("tasks", [])]
    robots = [int(r) for r in spec.get("robots", [])] or None
    variables = spec.get("variables", "kandidaten")
    params = spec.get("params") or {}
    if cls == "IA":
        return build_ia_instance(payload["tasks"], payload["fleet"], tasks, robots, variables, spec.get("kriterium", "fahrstrecke"), params)
    return workload.build_wb_instance(payload["tasks"], payload["fleet"], tasks, robots, variables, spec.get("last", "zeit"),
                                      spec.get("anteile"), spec.get("vorlast", "status"), params)


# ---------------------------------------------------------------------------------------------
# Formulierung als Polynom
# ---------------------------------------------------------------------------------------------

def _encode(inst: dict, encoding: str, side: str) -> tuple[list[dict], list, list[tuple[object, dict]]]:
    """Bits, x je Variable als Polynom und die Regel der Kodierung (je Gruppe, ohne Gewicht) auf der „genau eins“-Seite."""
    variables = inst["variables"]
    task_ids = [t["transport_id"] for t in inst["tasks"]]
    robot_ids = [r["robot_id"] for r in inst["robots"]]
    if side == "zeile":
        groups = [(t, [v for v in variables if v["task_id"] == t]) for t in task_ids]
        others, member = robot_ids, (lambda v: v["robot_id"])
    else:
        groups = [(r, [v for v in variables if v["robot_id"] == r]) for r in robot_ids]
        others, member = task_ids, (lambda v: v["task_id"])
    bits: list[dict] = []
    x_polys: list = [None] * len(variables)
    rules: list[tuple[object, dict]] = []
    K = math.ceil(math.log2(len(others))) if len(others) > 1 else 0
    for key, cand in groups:
        if encoding == "one_hot":
            lin = {frozenset(): 1.0}
            for v in cand:
                i = len(bits)
                bits.append({"index": i, "type": "entscheidung", "group": key})
                x_polys[v["index"]] = {frozenset([i]): 1.0}
                lin[frozenset([i])] = -1.0
            rules.append((key, _poly_mul(lin, lin) if cand else {}))
        elif encoding == "domain_wall":
            idx = []
            for _ in range(1, len(cand)):
                idx.append(len(bits))
                bits.append({"index": len(bits), "type": "entscheidung", "group": key})
            for v, d in zip(cand, _chain_deltas(len(cand), idx)):
                x_polys[v["index"]] = _lin_poly(d)
            pen: dict = {}
            for a, b in zip(idx, idx[1:]):
                pen[frozenset([b])] = pen.get(frozenset([b]), 0.0) + 1.0
                pen[frozenset([a, b])] = pen.get(frozenset([a, b]), 0.0) - 1.0
            rules.append((key, pen))
        else:
            idx = []
            for _ in range(K):
                idx.append(len(bits))
                bits.append({"index": len(bits), "type": "entscheidung", "group": key})
            by_member = {member(v): v for v in cand}
            pen = {}
            for k in range(2 ** K):
                v = by_member.get(others[k]) if k < len(others) else None
                if v is not None:
                    x_polys[v["index"]] = _indicator(idx, k)
                elif cand:
                    for m, c in _indicator(idx, k).items():
                        pen[m] = pen.get(m, 0.0) + c
            rules.append((key, pen))
    return bits, x_polys, rules


def _scale(poly: dict, w: float) -> dict:
    return {m: c * w for m, c in poly.items() if abs(c * w) > 1e-12}


def _sum_lin(terms: list[tuple[dict, float]], const: float = 0.0) -> dict:
    out = {frozenset(): const} if const else {}
    for poly, w in terms:
        for m, c in poly.items():
            out[m] = out.get(m, 0.0) + c * w
    return {m: c for m, c in out.items() if abs(c) > 1e-12}


def _slack_weights(K: int) -> list[int]:
    """Gewichte der Slack-Bits für 0 … K: 1, 2, 4, …, Rest – die Summe ist genau K (beschränkter Slack)."""
    if K <= 0:
        return []
    n = math.ceil(math.log2(K + 1))
    w = [2 ** j for j in range(n - 1)]
    return w + [K - sum(w)]


def build_case(inst: dict, cls: str, encoding: str, variant: str, params: dict | None = None, exact_M: bool = True) -> dict:
    """Formulierung eines Falls mit eingesetzten (empfohlenen) Gewichten: Bits mit Typ, Polynom-Blöcke je Herkunft, QUBO-Einträge."""
    if encoding not in ENCODINGS:
        raise ValueError(f"Kodierung muss eine von {ENCODINGS} sein")
    if variant not in VARIANTS.get(cls, {}):
        raise ValueError(f"Variante {variant} gibt es für {cls} nicht")
    params = dict(params or {})
    T, R = len(inst["tasks"]), len(inst["robots"])
    side = "zeile" if cls == "TA" or T <= R else "spalte"
    bits, x_polys, rules = _encode(inst, encoding, side)
    variables = inst["variables"]
    blocks: list[tuple[dict, dict]] = []
    weights: dict[str, float] = {}

    def add_slack(n: int, typ: str, group) -> list[int]:
        out = []
        for _ in range(n):
            out.append(len(bits))
            bits.append({"index": len(bits), "type": typ, "group": group})
        return out

    if cls == "IA":
        if encoding == "one_hot":
            w = ia_default_weights(inst)
        elif encoding == "domain_wall":
            w = ia_dw_default_weights(inst, domain_wall_ia(inst))
        else:  # wie ia_bin_default_weights, ohne M (das bestimmt _assemble für genau diese Formulierung)
            key = "task_id" if side == "zeile" else "robot_id"
            spreads = [max(c) - min(c) for c in ([v["cost"] for v in variables if v[key] == g] for g, _ in rules) if c]
            w = {"A": nice_ceil(max(10.0, 1.5 * max((v["cost"] for v in variables), default=0.0))),
                 "B": nice_ceil(max(10.0, 1.5 * max(spreads, default=0.0)))}
        A, B = w["A"], w["B"]
        weights.update(A=A, B=B)
        blocks.append(({"kind": "kosten"}, _sum_lin([(x_polys[v["index"]], v["cost"]) for v in variables if x_polys[v["index"]]])))
        for key, pen in rules:
            blocks.append(({"kind": "regel", "group": key}, _scale(pen, A)))
        cross = "robot_id" if side == "zeile" else "task_id"
        cross_keys = [r["robot_id"] for r in inst["robots"]] if side == "zeile" else [t["transport_id"] for t in inst["tasks"]]
        for g in cross_keys:
            xs = [x_polys[v["index"]] for v in variables if v[cross] == g and x_polys[v["index"]]]
            if T == R:  # „genau eins“ auf beiden Seiten
                lin = _sum_lin([(x, -1.0) for x in xs], 1.0)
                poly = _poly_mul(lin, lin)
            elif variant == "paar":
                poly = {}
                for x1, x2 in combinations(xs, 2):
                    for m, c in _poly_mul(x1, x2).items():
                        poly[m] = poly.get(m, 0.0) + c
            else:
                s = add_slack(1, "slack", f"q{g}")
                lin = _sum_lin([(x, 1.0) for x in xs] + [({frozenset([s[0]]): 1.0}, 1.0)], -1.0)
                poly = _poly_mul(lin, lin)
            blocks.append(({"kind": "quer", "group": g}, _scale(poly, B)))
    else:
        # Gewichte wie workload.wb_default_weights (B = 1/(2c̄), A aus der Schranke) – ohne die Formulierung dort zu bauen
        costs = [v["cost"] for v in variables]
        B = workload._round_sig(1.0 / (2.0 * (sum(costs) / len(costs))), 2) if costs else 0.01
        unrep = [t["transport_id"] for t in inst["tasks"] if not any(v["task_id"] == t["transport_id"] for v in variables)]
        bound = workload.weight_bound(inst, {"encoding": encoding, "unrepresentable": unrep})
        load0 = {r["robot_id"]: float(r.get("load0", 0.0)) for r in inst["robots"]}
        if variant == "makespan":
            delta = float(params.get("delta", 10.0))
            ct = {v["index"]: max(1, round(v["cost"] / delta)) for v in variables}
            L0 = {r: round(l / delta) for r, l in load0.items()}
            U = max(L0[r] + sum(ct[v["index"]] for v in variables if v["robot_id"] == r) for r in load0)
            Kc = max(1, math.ceil(math.log2(U + 1)))
            A = nice_ceil(max(10.0, 1.5 * max(ct.values(), default=1)))
            P = 2.0
            weights.update(A=A, P=P, delta=delta, Kc=Kc, U=U)
            m_bits = add_slack(Kc, "schranke", "cmax")
            cmax = {frozenset([b]): float(2 ** k) for k, b in enumerate(m_bits)}
            blocks.append(({"kind": "kosten"}, dict(cmax)))
            for key, pen in rules:
                blocks.append(({"kind": "regel", "group": key}, _scale(pen, A)))
            for r in load0:
                s_bits = add_slack(Kc, "slack", f"s{r}")
                terms = [(x_polys[v["index"]], float(ct[v["index"]])) for v in variables if v["robot_id"] == r and x_polys[v["index"]]]
                terms += [({frozenset([b]): 1.0}, float(2 ** j)) for j, b in enumerate(s_bits)]
                terms += [(cmax, -1.0)]
                lin = _sum_lin(terms, float(L0[r]))
                blocks.append(({"kind": "makespan", "group": r}, _scale(_poly_mul(lin, lin), P)))
        else:
            A = workload.recommend_A(bound, B)
            weights.update(A=A, B=B)
            kap = variant in ("kap_slack", "kap_unbal")
            if kap:
                Kcap = int(params.get("kap") or math.ceil(T / R))
                # Kapazität: Strafe C = Schranke über den teuersten Roboter (der billigste kann voll sein); A mindestens C
                C = nice_ceil(max(10.0, 1.1 * max((max(o["a"] + B * o["w"] for o in g["options"]) for g in bound), default=100.0)))
                A = max(A, C)
                weights.update(A=A, C=C, kap=Kcap)
            blocks.append(({"kind": "kosten"}, _sum_lin([(x_polys[v["index"]], v["cost"]) for v in variables if x_polys[v["index"]]])))
            for key, pen in rules:
                blocks.append(({"kind": "regel", "group": key}, _scale(pen, A)))
            for r in load0:
                lin = _sum_lin([(x_polys[v["index"]], v["cost"]) for v in variables if v["robot_id"] == r and x_polys[v["index"]]], load0[r])
                blocks.append(({"kind": "last", "group": r}, _scale(_poly_mul(lin, lin), B)))
            if kap:
                for r in load0:
                    xs = [(x_polys[v["index"]], 1.0) for v in variables if v["robot_id"] == r and x_polys[v["index"]]]
                    if variant == "kap_slack":
                        s_bits = add_slack(len(_slack_weights(Kcap)), "slack", f"k{r}")
                        lin = _sum_lin(xs + [({frozenset([b]): 1.0}, float(w)) for b, w in zip(s_bits, _slack_weights(Kcap))], -float(Kcap))
                        poly = _poly_mul(lin, lin)
                    else:
                        g = _sum_lin([(x, -c) for x, c in xs], float(Kcap))  # g = K − Σx
                        poly = _sum_lin([(_poly_mul(g, g), 1.0 / Kcap), (g, -1.0)])
                    blocks.append(({"kind": "kapazitaet", "group": r}, _scale(poly, C)))
    blocks =[(m, {k: c for k, c in p.items() if abs(c) > 1e-12}) for m, p in blocks]
    form = _assemble(bits, blocks, quadratize=encoding == "binary", exact_M=exact_M)
    form.update(cls=cls, encoding=encoding, variant=variant, side=side, weights={**weights, "M": form["M"]}, x_polys=x_polys,
                T=T, R=R)
    return form


def _assemble(bits: list[dict], blocks: list[tuple[dict, dict]], quadratize: bool, exact_M: bool) -> dict:
    """Polynom → QUBO-Einträge (numerisch, je Eintrag die Beiträge je Herkunft); Binary: Hilfsbits nach Rosenberg + M."""
    degree_before = max((len(m) for _, p in blocks for m in p), default=0)
    work = {k: {m: {"c": c} for m, c in p.items()} for k, (_, p) in enumerate(blocks)}
    aux: list[dict] = []
    if quadratize and degree_before > 2:
        group = {b["index"]: (b["group"] if b["type"] == "entscheidung" else None) for b in bits}
        aux = _quadratize_groups(work, group)
        for a in aux:
            bits.append({"index": a["index"], "type": "hilfsbit", "group": a["group"], "pair": a["pair"]})
    entries: dict[tuple[int, int], dict] = {}
    const = 0.0
    for k, p in work.items():
        kind = blocks[k][0]["kind"]
        for m, e in p.items():
            c = e["c"]
            if abs(c) < 1e-12:
                continue
            ms = sorted(m)
            if not ms:
                const += c
                continue
            i, j = ms[0], ms[-1]
            en = entries.setdefault((i, j), {"i": i, "j": j, "parts": []})
            en["parts"].append({"kind": kind, "c": c})
    form = {"bits": bits, "entries": list(entries.values()), "aux": aux, "n": len(bits), "degree_before": degree_before, "const": const}
    M = 0.0
    if aux:
        if exact_M:
            gains = binary_lie_gains(form, 0.0, 0.0)
            M = nice_ceil(max(10.0, 1.1 * max(gains.values(), default=0.0)))
        else:  # schnelle, sichere Schranke: |Feld| + Σ |Kopplungen| des Hilfsbits
            field: dict[int, float] = {a["index"]: 0.0 for a in aux}
            for e in form["entries"]:
                v = abs(sum(p["c"] for p in e["parts"]))
                for w in {e["i"], e["j"]}:
                    if w in field:
                        field[w] += v
            M = nice_ceil(max(10.0, 1.1 * max(field.values())))
        for a in aux:
            x, y = a["pair"]
            w = a["index"]
            for (i, j), c in (((x, y), 1.0), ((x, w), -2.0), ((y, w), -2.0), ((w, w), 3.0)):
                i, j = min(i, j), max(i, j)
                entries.setdefault((i, j), {"i": i, "j": j, "parts": []})["parts"].append({"kind": "hilfsbit", "c": c * M})
        form["entries"] = list(entries.values())
    for e in form["entries"]:
        e["value"] = sum(p["c"] for p in e["parts"])
    form["M"] = M
    return form


# ---------------------------------------------------------------------------------------------
# Kennzahlen
# ---------------------------------------------------------------------------------------------

def _plans(inst: dict, cls: str) -> list[dict]:
    """Gültige Zuweisungen der Klasse (ohne Kapazität/Schranke): IA wie ia_valid_plans, TA jeder Auftrag ein Roboter."""
    if cls == "IA":
        return [{"pairs": list(p["assignment"].items()), "value": p["value"]} for p in ia_valid_plans(inst)]
    opts = [[v for v in inst["variables"] if v["task_id"] == t["transport_id"]] for t in inst["tasks"]]
    if any(not o for o in opts):
        return []
    return [{"pairs": [(v["task_id"], v["robot_id"]) for v in combo], "vars": combo} for combo in product(*opts)]


def _plan_eval(inst: dict, form: dict, plan: dict) -> dict:
    """Ziel und Zulässigkeit eines Plans für die Variante des Falls."""
    w = form["weights"]
    cost = {(v["task_id"], v["robot_id"]): v["cost"] for v in inst["variables"]}
    if form["cls"] == "IA":
        return {"ok": True, "value": round(sum(cost[p] for p in plan["pairs"]), 6)}
    L = {r["robot_id"]: float(r.get("load0", 0.0)) for r in inst["robots"]}
    count = {r: 0 for r in L}
    for t, r in plan["pairs"]:
        L[r] += cost[(t, r)]
        count[r] += 1
    if form["variant"] == "makespan":
        d = w["delta"]
        Lt = {r["robot_id"]: round(float(r.get("load0", 0.0)) / d) for r in inst["robots"]}
        for t, r in plan["pairs"]:
            Lt[r] += max(1, round(cost[(t, r)] / d))
        return {"ok": True, "value": max(Lt.values()), "maxL": max(Lt.values())}
    ok = form["variant"] == "wb" or all(c <= w["kap"] for c in count.values())
    return {"ok": ok, "value": round(sum(cost[p] for p in plan["pairs"]) + w["B"] * sum(x * x for x in L.values()), 6)}


def _slack_reps(K: int) -> dict[int, int]:
    """Wie viele Slack-Muster ergeben welchen Wert? Bei K + 1 keine Zweierpotenz gibt es Doppelte (K = 2: Gewichte 1, 1)."""
    reps: dict[int, int] = {}
    ws = _slack_weights(K)
    for mask in range(2 ** len(ws)):
        v = sum(w for j, w in enumerate(ws) if mask >> j & 1)
        reps[v] = reps.get(v, 0) + 1
    return reps


def valid_count(inst: dict, form: dict) -> int:
    """Zahl der gültigen Bitmuster: zulässige Pläne × Slack-Muster, die die Gleichungen schließen (Hilfsbits ehrlich, eindeutig);
    Makespan × mögliche C_max ≥ größte Last."""
    total = 0
    reps = _slack_reps(form["weights"]["kap"]) if form["variant"] == "kap_slack" else None
    for p in _plans(inst, form["cls"]):
        ev = _plan_eval(inst, form, p)
        if not ev["ok"]:
            continue
        if form["variant"] == "makespan":
            total += 2 ** form["weights"]["Kc"] - ev["maxL"]
        elif reps is not None:
            count = {r["robot_id"]: 0 for r in inst["robots"]}
            for _, r in p["pairs"]:
                count[r] += 1
            total += math.prod(reps.get(form["weights"]["kap"] - c, 0) for c in count.values())
        else:
            total += 1
    return total


def _decode(inst: dict, form: dict, b: list[int]) -> dict | None:
    """Bits → Plan (Paare), wenn jede Gruppe der „genau eins“-Seite genau eine 1 hat und kein x negativ ist."""
    xs = [0.0 if p is None else sum(c for m, c in p.items() if all(b[i] for i in m)) for p in form["x_polys"]]
    if any(x < -1e-9 or (x > 1e-9 and abs(x - 1) > 1e-9) for x in xs):
        return None
    pairs = [(v["task_id"], v["robot_id"]) for v in inst["variables"] if xs[v["index"]] > 0.5]
    T = {t["transport_id"] for t in inst["tasks"]}
    by_task = [t for t, _ in pairs]
    by_robot = [r for _, r in pairs]
    if form["cls"] == "TA":
        if sorted(by_task) != sorted(T):
            return None
    else:
        exact_t = len(inst["tasks"]) <= len(inst["robots"])
        exact_r = len(inst["tasks"]) >= len(inst["robots"])
        if len(set(by_task)) != len(by_task) or len(set(by_robot)) != len(by_robot):
            return None
        if (exact_t and set(by_task) != T) or (exact_r and set(by_robot) != {r["robot_id"] for r in inst["robots"]}):
            return None
    if any(b[a["index"]] != b[a["pair"][0]] * b[a["pair"][1]] for a in form["aux"]):
        return None
    return {"pairs": pairs}


def check_minimum(inst: dict, form: dict) -> dict:
    """Brute Force (bis CHECK_MAX_BITS): Ist das QUBO-Minimum ein zulässiger und bester Plan?"""
    n = form["n"]
    if n > CHECK_MAX_BITS:
        return {"status": "zu_gross", "text": f"{n} Bits – Prüfung nur bis {CHECK_MAX_BITS}"}
    plans = [(p, _plan_eval(inst, form, p)) for p in _plans(inst, form["cls"])]
    feas = [ev["value"] for _, ev in plans if ev["ok"]]
    if not feas:
        return {"status": "unloesbar", "text": "kein zulässiger Plan"}
    best = min(feas)
    Q = np.zeros((n, n))
    for e in form["entries"]:
        Q[e["i"], e["j"]] += e["value"]
    X = ((np.arange(2 ** n)[:, None] >> np.arange(n)) & 1).astype(float)
    E = np.einsum("ki,ij,kj->k", X, Q, X)
    k = int(np.argmin(E))
    b = [int(v) for v in X[k]]
    dec = _decode(inst, form, b)
    if dec is None:
        return {"status": "ungueltig", "text": "Minimum verletzt eine Regel"}
    ev = _plan_eval(inst, form, dec)
    if not ev["ok"]:
        return {"status": "ungueltig", "text": "Minimum verletzt die Kapazität"}
    if ev["value"] > best + 1e-6 * max(1.0, abs(best)):
        return {"status": "suboptimal", "text": f"gültig, aber {ev['value']:.1f} statt {best:.1f}"}
    return {"status": "ok", "text": "gültig und optimal"}


def metrics(inst: dict, form: dict, full: bool = True) -> dict:
    """K1–K6 (und die Prüfung des Minimums, wenn full)."""
    n = form["n"]
    types = {t: sum(1 for b in form["bits"] if b["type"] == t) for t in VAR_TYPES}
    deg = [0] * n
    by_kind = {k: 0 for k in KINDS}
    edges = []
    coefs = []
    diag = 0
    for e in form["entries"]:
        if abs(e["value"]) < 1e-9:
            continue
        coefs.append(abs(e["value"]))
        if e["i"] == e["j"]:
            diag += 1
            continue
        kinds = {p["kind"] for p in e["parts"] if abs(p["c"]) > 1e-12}
        kind = next(k for k in KINDS if k in kinds)
        by_kind[kind] += 1
        deg[e["i"]] += 1
        deg[e["j"]] += 1
        edges.append([e["i"], e["j"], kind])
    E = len(edges)
    rng = max(coefs) / min(coefs) if coefs else 1.0
    out = {
        "n": n, "types": types, "couplings": E, "by_kind": {k: v for k, v in by_kind.items() if v},
        "density": E / math.comb(n, 2) if n > 1 else 0.0, "deg_mean": 2 * E / n if n else 0.0, "deg_max": max(deg, default=0),
        "terms": diag + E, "degree_before": form["degree_before"], "range": rng, "bits": math.log2(rng) if rng > 0 else 0.0,
        "weights": form["weights"], "T": form["T"], "R": form["R"],
    }
    if full:
        nv = valid_count(inst, form)
        out["n_valid"] = nv
        out["valid_log10"] = (math.log10(nv) - n * math.log10(2)) if nv else None
        out["check"] = check_minimum(inst, form)
    return out


def evaluate(payload: dict | None, spec: dict) -> dict:
    """Ein Fall: Instanz, Formulierung, Kennzahlen. spec["kurz"]: nur Zählen (ohne gültige Zustände und Brute-Force-Prüfung)."""
    inst = case_instance(payload, spec)
    form = build_case(inst, spec.get("cls", "IA"), spec.get("encoding", "one_hot"), spec.get("variant", "paar"), spec.get("vparams"))
    m = metrics(inst, form, full=not spec.get("kurz"))
    m["scenario"] = {"T": len(inst["tasks"]), "R": len(inst["robots"]), "tasks": [t["transport_id"] for t in inst["tasks"]],
                     "robots": [r["robot_id"] for r in inst["robots"]], "struktur": bool(inst.get("structure"))}
    return m


@lru_cache(maxsize=4096)
def structure_metrics(cls: str, encoding: str, variant: str, T: int, R: int, vparams: tuple = (), valid: bool = True) -> dict:
    """Kennzahlen eines Falls „nur Struktur“ (ohne Prüfung, schnelles M) – für Skalierung, Fall-Landkarte und Verlauf.
    valid=False lässt die Aufzählung der gültigen Zustände weg (nur Qubits, Kopplungen, Dichte, Grad)."""
    inst = structure_instance(T, R)
    form = build_case(inst, cls, encoding, variant, dict(vparams), exact_M=False)
    m = metrics(inst, form, full=False)
    nv = valid_count(inst, form) if valid and T <= 8 else None
    m["valid_log10"] = (math.log10(nv) - m["n"] * math.log10(2)) if nv else None
    return m


RATIOS = ("halb", "fest", "quadrat")


def family_sizes(ratio: str, R: int = 3) -> list[tuple[int, int]]:
    """Wachsende Folge von Instanzgrößen (T, R) bis T = 18: halb = Flotte halb so groß wie die Auftragszahl (R = T/2, wie im Paper),
    fest = R bleibt, quadrat = T = R."""
    if ratio == "halb":
        return [(2 * r, r) for r in range(1, MAX_STRUCT_T // 2 + 1)]
    if ratio == "fest":
        r = max(1, min(MAX_STRUCT_R, int(R)))
        return [(T, r) for T in range(2, MAX_STRUCT_T + 1, 2)]
    if ratio == "quadrat":
        return [(k, k) for k in range(2, MAX_STRUCT_R + 1)]
    raise ValueError(f"ratio muss eine von {RATIOS} sein")


def size_series(cls: str, variant: str, ratio: str = "halb", R: int = 3) -> dict:
    """Je Kodierung Qubits, Kopplungen und Dichte über eine Folge gemischter Instanzgrößen T × R (nach T·R sortiert).
    Struktur mit voller Zuständigkeit, ohne Prüfung."""
    if cls not in CLASSES or variant not in VARIANTS[cls]:
        raise ValueError(f"Unbekannter Fall: {cls} / {variant}")
    sizes = sorted(family_sizes(ratio, R), key=lambda s: (s[0] * s[1], s[0]))
    series = []
    for enc in ENCODINGS:
        points = []
        for T, r in sizes:
            m = structure_metrics(cls, enc, variant, T, r, valid=False)
            points.append({"T": T, "R": r, "n": m["n"], "aux": m["types"]["hilfsbit"], "couplings": m["couplings"],
                           "density": m["density"], "deg_max": m["deg_max"]})
        series.append({"encoding": enc, "points": points})
    return {"cls": cls, "variant": variant, "ratio": ratio, "series": series}


def scaling(templates: list[dict], axis: str = "T", fixed: int = 3, upto: int = 6) -> list[dict]:
    """Je Vorlage (Klasse, Kodierung, Variante) die Kennzahlen über T = 1 … upto (R fest) bzw. über R."""
    out = []
    for tp in templates:
        rows = []
        for k in range(1, upto + 1):
            T, R = (k, fixed) if axis == "T" else (fixed, k)
            try:
                rows.append({"x": k, **structure_metrics(tp["cls"], tp["encoding"], tp["variant"], T, R, tuple(sorted((tp.get("vparams") or {}).items())))})
            except ValueError as exc:
                rows.append({"x": k, "error": str(exc)})
        out.append({**tp, "rows": rows})
    return out


def landscape(variants: dict[str, str], upto: int = 6) -> dict:
    """Fall-Landkarte: für T, R = 1 … upto und jede Klasse alle drei Kodierungen (Qubits, Kopplungen, max. Grad, Bits)."""
    grid = []
    for cls in CLASSES:
        for T, R in product(range(1, upto + 1), range(1, upto + 1)):
            cell = {"cls": cls, "T": T, "R": R}
            for enc in ENCODINGS:
                m = structure_metrics(cls, enc, variants[cls], T, R)
                cell[enc] = {k: m[k] for k in ("n", "couplings", "deg_max", "bits", "density")}
            grid.append(cell)
    return {"variants": variants, "grid": grid}


def timeline(payload: dict, templates: list[dict], cut: str = "fenster", window: float = 60.0, robots: str = "frei",
             t_cap: int = 10) -> dict:
    """Verlauf über einen Lauf: je Anfrage die echte Instanzgröße (T, R) und die Kennzahlen jeder Vorlage (Struktur bei echtem T, R).

    cut = "fenster": Anfragen in [t, t + window]; "offen": bis t angefragt und bei t noch nicht zugewiesen (Lebenslauf nötig).
    robots = "frei": verfügbar im Snapshot der Anfrage; "alle": ganze Flotte. T wird bei t_cap gekappt (vermerkt).
    """
    tasks = payload["tasks"]
    if cut == "offen" and not any(t.get("t_assigned") is not None for t in tasks):
        raise ValueError("Dieser Lauf hat keinen Lebenslauf (ASSIGNED) – Schnitt „offen“ nicht möglich")
    fleet_by_task: dict[int, list[dict]] = {}
    for r in payload["fleet"]:
        fleet_by_task.setdefault(r["transport_id"], []).append(r)
    points = []
    for t in tasks:
        t0 = t["time"]
        if cut == "fenster":
            T = sum(1 for u in tasks if t0 <= u["time"] <= t0 + window)
        else:
            T = sum(1 for u in tasks if u["time"] <= t0 and (u.get("t_assigned") is None or u["t_assigned"] > t0))
        snap = fleet_by_task.get(t["transport_id"], [])
        R = sum(1 for r in snap if r["available"]) if robots == "frei" else len(snap)
        points.append({"transport_id": t["transport_id"], "time": t0, "T": T, "R": R})
    series = []
    for tp in templates:
        vals = []
        for p in points:
            T, R = min(p["T"], t_cap), p["R"]
            if T < 1 or R < 1:
                vals.append(None)
                continue
            try:
                m = structure_metrics(tp["cls"], tp["encoding"], tp["variant"], T, R, tuple(sorted((tp.get("vparams") or {}).items())))
                vals.append({k: m[k] for k in ("n", "couplings", "deg_max", "bits")})
            except ValueError:
                vals.append(None)
        series.append({**tp, "values": vals})
    return {"points": points, "series": series, "capped": sum(1 for p in points if p["T"] > t_cap), "t_cap": t_cap}
