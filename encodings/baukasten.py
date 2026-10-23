"""Formel-Baukasten: QUBO-Formulierungen aus Bausteinen zusammensetzen – auch falsche.

Eine Formulierung ist eine Liste von Bausteinen. Jeder Baustein hat ein eigenes Gewicht
(Symbol λ, A, B, D, …) und wird hier ausmultipliziert. Jeder QUBO-Eintrag ist eine Summe
Σ_k Gewicht_k · Beitrag_k. So kann die Oberfläche Gewichte live verändern und Bausteine an- und
abschalten, ohne neu zu rechnen; nur Änderungen an der Form eines Bausteins gehen zum Server.

Bausteine (Variablen x_trq: „Roboter r fährt Auftrag t als q-letzten“; bei K = 1 einfach x_tr):

- kosten:      Σ c_v x_v,  c = [ρ_r] + w(q)·([s⁰_rt] + p_t)    – bei Kriterien der Sofortzuweisung c_tr
- vorgaenger:  Σ w(q)·(s_tt' − s⁰_rt') · x_{t,r,q+1} x_{t',r,q}  – Variante „ohne Abzug“: w(q)·s_tt'
- gruppe:      Σ_G f(n_G),  n_G = Σ_{i∈G} x_i,  f(n) = a + b·n + c·n²
- nachbar:     Σ_{r,q} g(o_{r,q+1}, o_{r,q}),  g = a + b·o₁ + c·o₂ + d·o₁·o₂

Der Kern: **Jede quadratische Funktion einer Anzahl ist eine QUBO**, denn wegen x² = x gilt
    f(n) = a + (b + c)·Σ x_i + 2c·Σ_{i<j} x_i x_j.
„Genau k“ ist (k − n)², „höchstens eins“ ist n(n − 1)/2, eine lineare Regel (k − n) ist der
typische Fehler – und mit eigenen a, b, c lässt sich jede andere Form ausprobieren.

Die Voreinstellungen „one_hot“ und „reihenfolge“ ergeben genau die festen Formulierungen aus
formulations.py (geprüft in tests/test_baukasten.py).
"""
from __future__ import annotations

import math
from itertools import combinations

from cost_model import CRITERIA_BY_KEY, SEQUENCE_CRITERIA_BY_KEY
from formulations import _setup_maps, build_instance, build_sequence_instance, default_weights, nice_ceil

TERM_TYPES = ("kosten", "vorgaenger", "gruppe", "nachbar")
GROUPS = ("auftrag", "platz", "roboter", "auftrag_roboter", "alle")
FORMS = ("genau", "hoechstens1", "linear", "eigene")
NEIGHBOR_FORMS = ("luecke", "eigene")
WEIGHTINGS = ("q", "eins", "vorne")
VARIANTS = ("differenz", "ohne_abzug")
MAX_TERMS = 12
MAX_ABS = 1e6

# Welche Anforderung des echten Problems ein Baustein abdeckt (für die Diagnose in der Oberfläche)
GROUP_COVERS = {"auftrag": "auftrag", "platz": "platz", "roboter": "platz", "auftrag_roboter": None, "alle": None}


# ---------------------------------------------------------------------------------------------
# Instanz: dieselbe für alle Formulierungen – das „echte“ Problem
# ---------------------------------------------------------------------------------------------

def build_baukasten_instance(tasks: list[dict], fleet: list[dict], task_ids: list[int], variables: str = "kandidaten",
                             criterion: str = "erledigungszeit", slots: int = 2, params: dict | None = None) -> dict:
    """Instanz mit Variablen x_trq. objective sagt, wie das echte Ziel gerechnet wird:

    - "ablauf":    Summe der Erledigungs- bzw. Arbeitszeiten aus dem Ablaufplan (SEQUENCE_CRITERIA)
    - "zuweisung": Summe fester Kosten c_tr (Kriterien der Sofortzuweisung, nur K = 1)
    """
    if criterion in SEQUENCE_CRITERIA_BY_KEY:
        inst = build_sequence_instance(tasks, fleet, task_ids, variables, criterion, slots, params)
        inst["objective"] = "ablauf"
        return inst
    if criterion in CRITERIA_BY_KEY:
        if int(slots) != 1:
            raise ValueError(f"Das Kriterium „{CRITERIA_BY_KEY[criterion]['label']}“ gilt nur für die Sofortzuweisung (K = 1)")
        inst = build_sequence_instance(tasks, fleet, task_ids, variables, "bearbeitungszeit", 1, params)
        ia = build_instance(tasks, fleet, task_ids, variables, criterion, params)
        for v, w in zip(inst["variables"], ia["variables"], strict=True):
            assert (v["task_id"], v["robot_id"]) == (w["task_id"], w["robot_id"])
            v["cost"], v["parts"] = w["cost"], w["parts"]
        inst["criterion"] = {**CRITERIA_BY_KEY[criterion], "position_weight": False, "release": False}
        inst["objective"] = "zuweisung"
        return inst
    raise ValueError(f"Unbekanntes Kriterium: {criterion}")


def default_term_weights(instance: dict) -> dict[str, float]:
    """Startwerte der Gewichte je Symbol: λ = 1 für das Ziel, A, B, D für die Regeln."""
    if instance["objective"] == "ablauf":
        w = default_weights(instance)
        A, B, D = w["A"], w["B"], w["D"]
    else:  # wie auf der One-Hot-Seite: 1,5 × größte Kosten
        A = nice_ceil(max(10.0, 1.5 * max((v["cost"] for v in instance["variables"]), default=0.0)))
        B = D = A
    return {"λ": 1.0, "λ_V": 1.0, "A": A, "B": B, "D": D}


def requirements(instance: dict) -> list[dict]:
    """Was das echte Problem verlangt – daran misst die Diagnose jede Formulierung."""
    K = instance["slots"]
    out = [{"key": "auftrag", "label": "Jeder Auftrag wird genau einmal gefahren"},
           {"key": "platz", "label": "Kein Roboter fährt zwei Aufträge gleichzeitig" if K == 1
            else "Auf jedem Platz eines Roboters liegt höchstens ein Auftrag"}]
    if K >= 2:
        out.append({"key": "luecke", "label": "Die Plätze eines Roboters sind lückenlos belegt"})
    out.append({"key": "ziel", "label": f"Ziel: {instance['criterion']['label']} möglichst klein"})
    return out


def presets(instance: dict) -> dict[str, list[dict]]:
    """Die festen Formulierungen als Bausteinlisten."""
    crit = instance["criterion"]
    kosten = {"id": "kosten", "type": "kosten", "symbol": "λ", "gewichtung": "q" if crit.get("position_weight") else "eins",
              "wartezeit": bool(crit.get("release")), "anfahrt": True}
    vorg = {"id": "vorgaenger", "type": "vorgaenger", "symbol": "λ_V", "variante": "differenz",
            "gewichtung": kosten["gewichtung"]}
    zeile = {"id": "zeile", "type": "gruppe", "symbol": "A", "gruppe": "auftrag", "form": "genau", "k": 1}
    spalte = {"id": "spalte", "type": "gruppe", "symbol": "B", "gruppe": "roboter", "form": "hoechstens1"}
    platz = {"id": "platz", "type": "gruppe", "symbol": "B", "gruppe": "platz", "form": "hoechstens1"}
    luecke = {"id": "luecke", "type": "nachbar", "symbol": "D", "form": "luecke"}
    return {
        "one_hot": [kosten, zeile, spalte],
        "reihenfolge": [kosten, vorg, zeile, platz, luecke],
        "nur_kosten": [kosten],
    }


def default_preset(instance: dict) -> str:
    return "one_hot" if instance["slots"] == 1 else "reihenfolge"


# ---------------------------------------------------------------------------------------------
# Bausteine prüfen und ausmultiplizieren
# ---------------------------------------------------------------------------------------------

def _num(term: dict, key: str, default: float = 0.0) -> float:
    v = term.get(key, default)
    try:
        v = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"Baustein {term.get('id')}: {key} muss eine Zahl sein") from None
    if not math.isfinite(v) or abs(v) > MAX_ABS:
        raise ValueError(f"Baustein {term.get('id')}: {key} ist außerhalb des erlaubten Bereichs")
    return v


def validate_terms(terms: list[dict]) -> list[dict]:
    if not isinstance(terms, list) or not 0 < len(terms) <= MAX_TERMS:
        raise ValueError(f"Eine Formulierung braucht 1 bis {MAX_TERMS} Bausteine")
    seen = set()
    for t in terms:
        if not isinstance(t, dict):
            raise ValueError("Jeder Baustein muss ein Objekt sein")
        tid = str(t.get("id", ""))
        if not tid or len(tid) > 24 or tid in seen:
            raise ValueError(f"Ungültige oder doppelte Baustein-Kennung: {tid!r}")
        seen.add(tid)
        if t.get("type") not in TERM_TYPES:
            raise ValueError(f"Baustein {tid}: unbekannter Typ {t.get('type')!r}")
        checks = {"gewichtung": WEIGHTINGS, "variante": VARIANTS}
        if t["type"] == "gruppe":
            checks.update(gruppe=GROUPS, form=FORMS)
        if t["type"] == "nachbar":
            checks.update(form=NEIGHBOR_FORMS)
        for key, allowed in checks.items():
            if key in t and t[key] not in allowed:
                raise ValueError(f"Baustein {tid}: {key} muss eines von {allowed} sein")
        for key in ("k", "a", "b", "c", "d"):
            if key in t:
                _num(t, key)
    return terms


def form_coefficients(term: dict) -> dict[str, float]:
    """f(n) = a + b·n + c·n² einer Gruppenregel."""
    form = term.get("form", "genau")
    if form == "genau":
        k = _num(term, "k", 1)
        return {"a": k * k, "b": -2 * k, "c": 1.0}
    if form == "hoechstens1":
        return {"a": 0.0, "b": -0.5, "c": 0.5}
    if form == "linear":
        k = _num(term, "k", 1)
        return {"a": k, "b": -1.0, "c": 0.0}
    return {key: _num(term, key) for key in "abc"}


def neighbor_coefficients(term: dict) -> dict[str, float]:
    """g(o₁, o₂) = a + b·o₁ + c·o₂ + d·o₁·o₂ (o₁: Platz q+1, o₂: Platz q). Lücke: o₁·(1 − o₂)."""
    if term.get("form", "luecke") == "luecke":
        return {"a": 0.0, "b": 1.0, "c": 0.0, "d": -1.0}
    return {key: _num(term, key) for key in "abcd"}


def weight_factor(weighting: str, q: int, K: int) -> int:
    """Gewicht eines Platzes: q (von hinten, richtig für Erledigungszeiten), 1, oder K + 1 − q (von vorne)."""
    return {"q": q, "eins": 1, "vorne": K + 1 - q}[weighting]


def groups_of(instance: dict, group: str) -> list[tuple[str, list[int]]]:
    """Variablengruppen einer Gruppenregel (eine Partition der Schalter, außer „alle“)."""
    variables = instance["variables"]
    K = instance["slots"]
    if group == "auftrag":  # auch Aufträge ohne Schalter: ihre Regel kann nie erfüllt werden
        return [(f"#{t['transport_id']}", [v["index"] for v in variables if v["task_id"] == t["transport_id"]])
                for t in instance["tasks"]]
    if group == "alle":
        return [("alle Schalter", [v["index"] for v in variables])]
    key, label = {
        "platz": (lambda v: (v["robot_id"], v["slot"]), lambda k: f"R{k[0]}" if K == 1 else f"R{k[0]} Platz {k[1]}"),
        "roboter": (lambda v: v["robot_id"], lambda k: f"R{k}"),
        "auftrag_roboter": (lambda v: (v["task_id"], v["robot_id"]), lambda k: f"#{k[0]} auf R{k[1]}"),
    }[group]
    out: dict = {}
    for v in variables:
        out.setdefault(key(v), []).append(v["index"])
    return [(label(k), idx) for k, idx in out.items()]


def cost_coefficient(instance: dict, v: dict, term: dict, s0: dict) -> float:
    """Kosten eines Schalters nach den Optionen des Kosten-Bausteins."""
    if instance["objective"] == "zuweisung":
        return v["cost"]
    task = next(t for t in instance["tasks"] if t["transport_id"] == v["task_id"])
    robot = next(r for r in instance["robots"] if r["robot_id"] == v["robot_id"])
    w = weight_factor(term.get("gewichtung", "q"), v["slot"], instance["slots"])
    rel = robot["release"] if term.get("wartezeit", True) else 0.0
    setup = s0[(v["robot_id"], v["task_id"])] if term.get("anfahrt", True) else 0.0
    return round(rel + w * (setup + task["p"]), 4)


def build(instance: dict, terms: list[dict]) -> dict:
    """Bausteine → Regeln (für die Erklärung) und QUBO-Einträge mit Beiträgen je Baustein.

    Eintrag: {"i", "j", "parts": [{"term", "kind", "v", …}]}; Wert = Σ v · Gewicht(term).
    Konstante: {term: Wert}. Ob ein Baustein an ist, entscheidet erst die Oberfläche.
    """
    validate_terms(terms)
    variables = instance["variables"]
    K = instance["slots"]
    s0, sb = _setup_maps(instance)
    idx = {(v["task_id"], v["robot_id"], v["slot"]): v["index"] for v in variables}
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    robot_ids = [r["robot_id"] for r in instance["robots"]]
    slot_vars = {(r, q): [v["index"] for v in variables if v["robot_id"] == r and v["slot"] == q]
                 for r in robot_ids for q in range(1, K + 1)}

    entries: dict[tuple[int, int], dict] = {}
    const: dict[str, float] = {}
    rules: list[dict] = []
    resolved: list[dict] = []

    def add(i: int, j: int, part: dict) -> None:
        if part["v"] == 0:
            return
        i, j = min(i, j), max(i, j)
        entries.setdefault((i, j), {"i": i, "j": j, "parts": []})["parts"].append(part)

    for term in terms:
        tid, kind = str(term["id"]), term["type"]
        info: dict = {}
        const[tid] = 0.0
        if kind == "kosten":
            info["covers"] = "ziel"
            for v in variables:
                c = cost_coefficient(instance, v, term, s0)
                rules.append({"term": tid, "kind": kind, "vars": [v["index"]], "c": c, "task_id": v["task_id"],
                              "robot_id": v["robot_id"], "slot": v["slot"]})
                add(v["index"], v["index"], {"term": tid, "kind": kind, "v": c, "task_id": v["task_id"],
                                             "robot_id": v["robot_id"], "slot": v["slot"]})
        elif kind == "vorgaenger":
            info["covers"] = "ziel"
            if K < 2:
                info["note"] = "wirkt erst ab K = 2 Plätzen – mit einem Platz gibt es keinen Vorgänger"
            weighting = term.get("gewichtung", "q")
            for r in robot_ids:
                for q in range(1, K):
                    w = weight_factor(weighting, q, K)
                    for i in task_ids:
                        for j in task_ids:
                            a, b = idx.get((i, r, q + 1)), idx.get((j, r, q))
                            if i == j or a is None or b is None:
                                continue
                            base = sb[(i, j)] - (s0[(r, j)] if term.get("variante", "differenz") == "differenz" else 0.0)
                            c = round(w * base, 4)
                            rules.append({"term": tid, "kind": kind, "vars": [a, b], "c": c, "robot_id": r, "slot": q,
                                          "from": i, "to": j, "weight": w, "s": sb[(i, j)], "s0": s0[(r, j)]})
                            add(a, b, {"term": tid, "kind": kind, "v": c, "robot_id": r, "slot": q, "from": i, "to": j})
        elif kind == "gruppe":
            f = form_coefficients(term)
            groups = groups_of(instance, term.get("gruppe", "auftrag"))
            info.update(f=f, groups=len(groups), max_size=max((len(g) for _, g in groups), default=0),
                        covers=GROUP_COVERS[term.get("gruppe", "auftrag")])
            if term.get("gruppe") == "roboter" and K > 1:
                info["note"] = "strenger als nötig: höchstens ein Auftrag je Roboter verbietet jede Reihenfolge"
            if term.get("gruppe") == "auftrag_roboter" and K == 1:
                info["note"] = "bei K = 1 hat jede Gruppe nur einen Schalter – die Regel koppelt nichts"
            for label, vs in groups:
                rules.append({"term": tid, "kind": kind, "vars": vs, "label": label, "f": f})
                const[tid] += f["a"]
                for i in vs:  # x² = x: der n²-Anteil landet zur Hälfte auf der Diagonale
                    add(i, i, {"term": tid, "kind": kind, "v": f["b"] + f["c"], "group": label})
                for i, j in combinations(vs, 2):
                    add(i, j, {"term": tid, "kind": kind, "v": 2 * f["c"], "group": label})
        else:  # nachbar
            g = neighbor_coefficients(term)
            info.update(g=g, covers="luecke")
            if K < 2:
                info["note"] = "wirkt erst ab K = 2 Plätzen"
            for r in robot_ids:
                for q in range(1, K):
                    up, low = slot_vars[(r, q + 1)], slot_vars[(r, q)]
                    if not up and not low:
                        continue
                    label = f"R{r} Platz {q + 1}/{q}"
                    rules.append({"term": tid, "kind": kind, "upper": up, "lower": low, "vars": up + low,
                                  "robot_id": r, "slot": q, "label": label, "g": g})
                    const[tid] += g["a"]
                    for u in up:
                        add(u, u, {"term": tid, "kind": kind, "v": g["b"], "group": label})
                    for low_i in low:
                        add(low_i, low_i, {"term": tid, "kind": kind, "v": g["c"], "group": label})
                    for u in up:
                        for low_i in low:
                            add(u, low_i, {"term": tid, "kind": kind, "v": g["d"], "group": label})
        resolved.append({**term, **info})

    for e in entries.values():  # Strukturkennzahlen je Baustein
        for p in e["parts"]:
            stats = next(t for t in resolved if t["id"] == p["term"]).setdefault("stats", {"diag": 0, "couplings": 0})
            stats["diag" if e["i"] == e["j"] else "couplings"] += 1
    for t in resolved:
        t.setdefault("stats", {"diag": 0, "couplings": 0})
        t["stats"]["const"] = round(const[str(t["id"])], 4)

    return {
        "encoding": "baukasten",
        "terms": resolved,
        "rules": rules,
        "entries": sorted(entries.values(), key=lambda e: (e["i"], e["j"])),
        "const": const,
        "n": len(variables),
    }


def energy_qubo(form: dict, x: list[int], weights: dict[str, float], active: set[str] | None = None) -> float:
    """E(x) = xᵀQx + Konstante; weights je Baustein-Kennung, active = eingeschaltete Bausteine."""
    on = (lambda t: True) if active is None else (lambda t: t in active)
    e = sum(v * weights[t] for t, v in form["const"].items() if on(t))
    for q in form["entries"]:
        if x[q["i"]] and x[q["j"]]:
            e += sum(p["v"] * weights[p["term"]] for p in q["parts"] if on(p["term"]))
    return e


def energy_rules(form: dict, x: list[int], weights: dict[str, float], active: set[str] | None = None) -> float:
    """E(x) direkt aus den Regeln – muss für jedes x mit energy_qubo übereinstimmen."""
    e = 0.0
    for r in form["rules"]:
        if active is not None and r["term"] not in active:
            continue
        w = weights[r["term"]]
        if r["kind"] == "kosten":
            e += w * r["c"] * x[r["vars"][0]]
        elif r["kind"] == "vorgaenger":
            e += w * r["c"] * x[r["vars"][0]] * x[r["vars"][1]]
        elif r["kind"] == "gruppe":
            n = sum(x[i] for i in r["vars"])
            e += w * (r["f"]["a"] + r["f"]["b"] * n + r["f"]["c"] * n * n)
        else:
            o1, o2 = sum(x[i] for i in r["upper"]), sum(x[i] for i in r["lower"])
            g = r["g"]
            e += w * (g["a"] + g["b"] * o1 + g["c"] * o2 + g["d"] * o1 * o2)
    return e
