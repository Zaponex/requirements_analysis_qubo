"""Formel-Baukasten: QUBO-Formulierungen aus Bausteinen zusammensetzen – mit jeder Kodierung, auch falsch.

Eine Formulierung besteht aus zwei Entscheidungen:

1. **Kodierung je Auftrag.** Jeder Auftrag t wählt eine Option o = (Roboter r, Platz q) aus seiner
   Kandidatenliste (bei K = 1 nur den Roboter). Wie diese Wahl in Bits steht, sagt die Kodierung –
   frei wählbar je Auftrag, also auch gemischt:
     - One-Hot:     ein Bit je Option, der Indikator „t nimmt o“ ist das Bit selbst: I_{t,o} = x_{t,o}
     - Domain Wall: eine Kette aus m − 1 Bits, Ränder fest 1 und 0: I_{t,k} = δ_k = b_k − b_{k+1}
     - Binary:      ⌈log₂ m⌉ Bits als Zahl, I_{t,k} = Π_j (z_j bzw. 1 − z_j) – ein Produkt
2. **Bausteine**, jeder mit eigenem Gewicht (Symbol λ, A, B, D, M, …), auf zwei Ebenen:
     - Zuweisung (über die Indikatoren, gleich für jede Kodierung):
         kosten      Σ c_{t,o} I_{t,o}
         vorgaenger  Σ w(q)·(s_tt' − s⁰_rt') · I_{t,(r,q+1)} I_{t',(r,q)}
         gruppe      Σ_G f(n_G), n_G = Σ_{o∈G} I_o, f(n) = a + b·n + c·n²
         nachbar     Σ_{r,q} g(o_{r,q+1}, o_{r,q}), g = a + b·o₁ + c·o₂ + d·o₁·o₂
     - Bits (direkt auf den Bits eines Blocks):
         bitgruppe   Σ_G f(n_G), n_G = Σ_{i∈G} x_i         (je Block, je Bitstelle oder alle Bits)
         bitnachbar  Σ g(x_{i+1}, x_i) über benachbarte Bits eines Blocks – „kette“ ist die Domain-Wall-Regel
         ungueltig   Σ_{k ≥ m} I_{t,k}                    Phantom-Codes eines Binär-Blocks
         hilfsbit    Σ_w (xy − 2xw − 2yw + 3w)            Rosenberg-Strafe der Hilfsbits (automatisch)

Jeder Baustein kann mit „bloecke“ auf die Aufträge einer Kodierung beschränkt werden.

Ausmultipliziert wird mit I² = I („Paarform“): f(n) = a + (b + c)·Σ I + 2c·Σ_{i<j} I_i I_j. Für One-Hot-Bits
und Binär-Indikatoren ist das exakt f(n). Domain-Wall-Differenzen können an gebrochenen Ketten −1 werden –
dort weicht die Paarform von f(n) ab (die Zeilenregel belohnt dann sogar Kettenbrüche).

Das Ergebnis ist ein Polynom; Produkte von Binär-Indikatoren haben Grad > 2. Wie in formulations.binary
ersetzt dann ein Hilfsbit w das häufigste Paar x·y (bei Gleichstand eines über zwei Aufträge), bis alles
höchstens Grad 2 hat. Jeder QUBO-Eintrag ist Σ_k Gewicht_k · Beitrag_k – die Oberfläche kann Gewichte live
ändern und Bausteine an- und abschalten, ohne neu zu rechnen.

Die Voreinstellung „standard“ ergibt genau die festen Formulierungen aus formulations.py: one_hot,
one_hot_sequence, domain_wall und binary (geprüft in tests/test_baukasten.py).
"""
from __future__ import annotations

import heapq
import math
from itertools import combinations, product

import numpy as np

from cost_model import CRITERIA_BY_KEY, SEQUENCE_CRITERIA_BY_KEY
from formulations import (
    _indicator, _poly_mul, _setup_maps, build_instance, build_sequence_instance, default_weights, nice_ceil, plan_value,
)

ENCODINGS = ("one_hot", "domain_wall", "binary")
ENCODING_LABEL = {"one_hot": "One-Hot", "domain_wall": "Domain Wall", "binary": "Binary"}
ORDERS = ("nummer", "kosten")
TERM_TYPES = ("kosten", "vorgaenger", "gruppe", "nachbar", "bitgruppe", "bitnachbar", "ungueltig", "hilfsbit")
GROUPS = ("auftrag", "platz", "roboter", "auftrag_roboter", "alle")
BIT_GROUPS = ("block", "stelle", "alle")
FORMS = ("genau", "hoechstens1", "linear", "eigene")
NEIGHBOR_FORMS = ("luecke", "eigene")
BIT_NEIGHBOR_FORMS = ("kette", "eigene")
SCOPES = ("alle",) + ENCODINGS
WEIGHTINGS = ("q", "eins", "vorne")
VARIANTS = ("differenz", "ohne_abzug")
SPEC_KEYS = ("id", "type", "symbol", "bloecke", "auto", "gewichtung", "wartezeit", "anfahrt", "variante", "gruppe",
             "form", "k", "a", "b", "c", "d")
MAX_TERMS = 14
MAX_ABS = 1e6
MAX_VARS = 160  # Bits + Hilfsbits – darüber wird es im Browser zäh
PLAN_LIMIT = 4000  # so viele gültige Pläne (die besten) gehen an die Oberfläche
PRESET_ALIASES = {"one_hot": "standard", "reihenfolge": "standard", "domain_wall": "standard", "binary": "standard"}

# Welche Anforderung des echten Problems ein Baustein abdeckt (für die Diagnose in der Oberfläche)
GROUP_COVERS = {"auftrag": "auftrag", "platz": "platz", "roboter": "platz", "auftrag_roboter": None, "alle": None}

Poly = dict  # frozenset(Bits) → Koeffizient


# ---------------------------------------------------------------------------------------------
# Instanz: dieselbe für alle Formulierungen – das „echte“ Problem
# ---------------------------------------------------------------------------------------------

def build_baukasten_instance(tasks: list[dict], fleet: list[dict], task_ids: list[int], variables: str = "kandidaten",
                             criterion: str = "erledigungszeit", slots: int = 2, params: dict | None = None) -> dict:
    """Instanz mit Optionen x_trq. objective sagt, wie das echte Ziel gerechnet wird:

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
    """Grundgrößen der Gewichte: λ = 1 für das Ziel, A, B, D für die Regeln (aus dem Kostenbereich)."""
    if instance["objective"] == "ablauf":
        w = default_weights(instance)
        A, B, D = w["A"], w["B"], w["D"]
    else:  # wie auf der One-Hot-Seite: 1,5 × größte Kosten
        A = nice_ceil(max(10.0, 1.5 * max((v["cost"] for v in instance["variables"]), default=0.0)))
        B = D = A
    return {"λ": 1.0, "λ_V": 1.0, "A": A, "B": B, "D": D}


def requirements(instance: dict, form: dict | None = None) -> list[dict]:
    """Was das echte Problem verlangt – daran misst die Diagnose jede Formulierung.

    Mit form kommen die Bedingungen der Kodierung dazu: gültige Codewörter und ehrliche Hilfsbits.
    """
    K = instance["slots"]
    out = [{"key": "auftrag", "label": "Jeder Auftrag wird genau einmal gefahren"}]
    if K >= 2:  # bei K = 1 ist Doppelbelegung zulässig – der Roboter fährt in Anfrage-Reihenfolge
        out += [{"key": "platz", "label": "Auf jedem Platz eines Roboters liegt höchstens ein Auftrag"},
                {"key": "luecke", "label": "Die Plätze eines Roboters sind lückenlos belegt"}]
    if form and any(b["encoding"] != "one_hot" for b in form["blocks"]):
        out.append({"key": "kodierung", "label": "Jeder Bit-Block ist ein gültiges Codewort (Kette ohne Bruch, kein Phantom-Code)",
                    "encoding": True})
    if form and form["aux"]:
        out.append({"key": "hilfsbit", "label": "Jedes Hilfsbit ist ehrlich (w = x·y) – nur für die QUBO, nicht fürs echte Problem",
                    "encoding": True})
    out.append({"key": "ziel", "label": f"Ziel: {instance['criterion']['label']} möglichst klein"})
    return out


def resolve_encodings(instance: dict, spec: str | dict | None = None) -> dict[int, str]:
    """Kodierung je Auftrag: ein Name für alle oder {Auftragsnummer: Name} (fehlende: One-Hot)."""
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    if spec is None:
        spec = "one_hot"
    if isinstance(spec, str):
        if spec not in ENCODINGS:
            raise ValueError(f"Kodierung muss eine von {ENCODINGS} sein")
        return {t: spec for t in task_ids}
    if not isinstance(spec, dict):
        raise ValueError("kodierung muss ein Name oder ein Objekt {Auftrag: Name} sein")
    out = {}
    for t in task_ids:
        e = spec.get(str(t), spec.get(t, "one_hot"))
        if e not in ENCODINGS:
            raise ValueError(f"Kodierung von #{t} muss eine von {ENCODINGS} sein")
        out[t] = e
    return out


def presets(instance: dict, encodings: dict[int, str] | None = None) -> dict[str, list[dict]]:
    """Die festen Formulierungen als Bausteinlisten – passend zu den Kodierungen der Aufträge.

    Je Kodierung die Regel, die ihre Bits zu genau einer Option macht: Zeilenregel (One-Hot),
    Kettenregel (Domain Wall), Phantom-Codes (Binary). Gemischt gilt jede nur für ihre Blöcke.
    Keine Spaltenregel: Doppelbelegung ist zulässig. Ab K = 2 Platz- und Lückenregel (sie verbieten keine
    Doppelbelegung, nur zwei Aufträge auf demselben Platz bzw. Lücken).
    """
    crit = instance["criterion"]
    K = instance["slots"]
    used = set((encodings or {}).values()) or {"one_hot"}
    mixed = len(used) > 1
    kosten = {"id": "kosten", "type": "kosten", "symbol": "λ", "gewichtung": "q" if crit.get("position_weight") else "eins",
              "wartezeit": bool(crit.get("release")), "anfahrt": True}
    vorg = {"id": "vorgaenger", "type": "vorgaenger", "symbol": "λ_V", "variante": "differenz",
            "gewichtung": kosten["gewichtung"]}
    std = [kosten] + ([vorg] if K >= 2 else [])
    if "one_hot" in used:
        std.append({"id": "zeile", "type": "gruppe", "symbol": "A", "gruppe": "auftrag", "form": "genau", "k": 1,
                    "bloecke": "one_hot" if mixed else "alle"})
    if "domain_wall" in used:
        std.append({"id": "kette", "type": "bitnachbar", "symbol": "A_K" if mixed else "A", "form": "kette",
                    "bloecke": "domain_wall" if mixed else "alle"})
    if "binary" in used:
        std.append({"id": "ungueltig", "type": "ungueltig", "symbol": "A_C" if mixed else "A",
                    "bloecke": "binary" if mixed else "alle"})
    if K >= 2:
        std += [{"id": "platz", "type": "gruppe", "symbol": "B", "gruppe": "platz", "form": "hoechstens1"},
                {"id": "luecke", "type": "nachbar", "symbol": "D", "form": "luecke"}]
    return {"standard": std, "nur_kosten": [kosten]}


def default_preset(instance: dict) -> str:
    return "standard"


# ---------------------------------------------------------------------------------------------
# Das echte Problem: alle gültigen Pläne
# ---------------------------------------------------------------------------------------------

def valid_plans(instance: dict, limit: int = PLAN_LIMIT) -> dict:
    """Alle gültigen Pläne aufzählen (wie exact_optimum) und die `limit` besten behalten.

    Ein Plan ist je Auftrag der Index seiner Option x_trq (in der Reihenfolge der Aufträge). Die
    Oberfläche kodiert jeden Plan in die gewählten Bits und sieht so, was jeder Baustein bei gültigen
    Plänen kostet – und welchen gültigen Plan die QUBO für den besten hält.
    K = 1: Doppelbelegung zulässig, ein Roboter fährt seine Aufträge in Anfrage-Reihenfolge.
    """
    K = instance["slots"]
    if K == 1:
        return _plans_one_slot(instance, limit)
    s0, sb = _setup_maps(instance)
    position_weight = instance["criterion"].get("position_weight", False)
    task_by_id = {t["transport_id"]: t for t in instance["tasks"]}
    release = {r["robot_id"]: r["release"] for r in instance["robots"]}
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    pos = {t: k for k, t in enumerate(task_ids)}
    options = {t: sorted({v["robot_id"] for v in instance["variables"] if v["task_id"] == t}) for t in task_ids}
    idx = {(v["task_id"], v["robot_id"], v["slot"]): v["index"] for v in instance["variables"]}
    assign_cost = ({(v["task_id"], v["robot_id"]): v["cost"] for v in instance["variables"] if v["slot"] == 1}
                   if instance.get("objective") == "zuweisung" else None)
    seqs: dict[int, list[int]] = {r["robot_id"]: [] for r in instance["robots"]}
    heap: list[tuple[float, int, list[int]]] = []  # (−Wert, Nummer, Plan): die schlechtesten oben
    state = {"count": 0}

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

    def snapshot() -> list[int]:
        plan = [0] * len(task_ids)
        for r, seq in seqs.items():
            for k, t in enumerate(seq):
                plan[pos[t]] = idx[(t, r, len(seq) - k)]
        return plan

    def rec(k: int) -> None:
        if k == len(task_ids):
            state["count"] += 1
            val = round(total(), 4)
            if len(heap) < limit:
                heapq.heappush(heap, (-val, state["count"], snapshot()))
            elif val < -heap[0][0] - 1e-9:
                heapq.heapreplace(heap, (-val, state["count"], snapshot()))
            return
        t = task_ids[k]
        for r in options[t]:
            seq = seqs[r]
            if len(seq) >= K:
                continue
            for p in range(len(seq) + 1):
                seq.insert(p, t)
                rec(k + 1)
                seq.pop(p)

    rec(0)
    plans = sorted(((-v, n, plan) for v, n, plan in heap), key=lambda e: (e[0], e[1]))
    return {"count": state["count"], "truncated": state["count"] > limit,
            "plans": [{"opts": plan, "value": v} for v, _, plan in plans]}


def _plans_one_slot(instance: dict, limit: int) -> dict:
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    fifo = sorted(task_ids)
    options = {t: [v for v in instance["variables"] if v["task_id"] == t] for t in task_ids}
    heap: list[tuple[float, int, list[int]]] = []
    count = 0
    for combo in product(*(options[t] for t in task_ids)):
        seqs: dict[int, list[int]] = {}
        robot_of = {v["task_id"]: v["robot_id"] for v in combo}
        for t in fifo:
            seqs.setdefault(robot_of[t], []).append(t)
        count += 1
        val = round(plan_value(instance, seqs), 4)
        item = (-val, count, [v["index"] for v in combo])
        if len(heap) < limit:
            heapq.heappush(heap, item)
        elif val < -heap[0][0] - 1e-9:
            heapq.heapreplace(heap, item)
    plans = sorted(((-v, n, plan) for v, n, plan in heap), key=lambda e: (e[0], e[1]))
    return {"count": count, "truncated": count > limit, "plans": [{"opts": plan, "value": v} for v, _, plan in plans]}


# ---------------------------------------------------------------------------------------------
# Kodierung: Bit-Blöcke und Indikatoren
# ---------------------------------------------------------------------------------------------

def _padd(acc: Poly, poly: Poly, scale: float = 1.0) -> None:
    for m, c in poly.items():
        acc[m] = acc.get(m, 0.0) + scale * c


def _clean(p: Poly) -> Poly:
    return {m: c for m, c in p.items() if abs(c) > 1e-12}


def _const(c: float) -> Poly:
    return {frozenset(): float(c)} if c else {}


def _var(i: int) -> Poly:
    return {frozenset([i]): 1.0}


def make_blocks(instance: dict, encodings: dict[int, str], order: str = "nummer") -> tuple[list[dict], list[dict]]:
    """Je Auftrag ein Block Bits. Optionen nach Nummer (Roboter, dann Platz) oder billigste zuerst."""
    blocks, bits = [], []
    for t in instance["tasks"]:
        tid = t["transport_id"]
        opts = [v for v in instance["variables"] if v["task_id"] == tid]
        if order == "kosten":
            opts.sort(key=lambda v: (v["cost"], v["index"]))
        enc = encodings[tid]
        m = len(opts)
        nb = {"one_hot": m, "domain_wall": max(m - 1, 0), "binary": math.ceil(math.log2(m)) if m > 1 else 0}[enc]
        idx = list(range(len(bits), len(bits) + nb))
        for j, i in enumerate(idx):
            b = {"index": i, "task_id": tid, "pos": j + 1, "encoding": enc, "aux": False}
            if enc == "one_hot":
                b["option"] = opts[j]["index"]
            elif enc == "domain_wall":
                b["left"], b["right"] = opts[j]["index"], opts[j + 1]["index"]
            else:
                b["place"] = 2 ** (nb - 1 - j)
            bits.append(b)
        block = {"task_id": tid, "encoding": enc, "options": [v["index"] for v in opts], "bits": idx, "nb": nb}
        if enc == "binary":
            block["codes"] = [{"code": k, "pattern": format(k, f"0{nb}b") if nb else "",
                               "option": opts[k]["index"] if k < m else None} for k in range(2 ** nb if m else 0)]
        blocks.append(block)
    return blocks, bits


def indicator_polys(blocks: list[dict]) -> dict[int, Poly]:
    """I_{t,o} als Polynom der Bits: One-Hot x, Domain Wall δ = b_k − b_{k+1}, Binary Indikator-Produkt."""
    ind: dict[int, Poly] = {}
    for b in blocks:
        opts, bits = b["options"], b["bits"]
        if b["encoding"] == "one_hot":
            for o, i in zip(opts, bits):
                ind[o] = _var(i)
        elif b["encoding"] == "domain_wall":
            chain = [_const(1.0)] + [_var(i) for i in bits] + [{}]
            for k, o in enumerate(opts):
                p = dict(chain[k])
                _padd(p, chain[k + 1], -1.0)
                ind[o] = _clean(p)
        else:
            for k, o in enumerate(opts):
                ind[o] = _indicator(bits, k)
    return ind


def indicator_values(form: dict, x: list[int]) -> dict[int, int]:
    """Wert jedes Indikators für eine Bitstellung: 0/1, bei gebrochenen Domain-Wall-Ketten auch −1."""
    y: dict[int, int] = {}
    for b in form["blocks"]:
        opts, bits = b["options"], b["bits"]
        if b["encoding"] == "one_hot":
            for o, i in zip(opts, bits):
                y[o] = x[i]
        elif b["encoding"] == "domain_wall":
            chain = [1] + [x[i] for i in bits] + [0]
            for k, o in enumerate(opts):
                y[o] = chain[k] - chain[k + 1]
        else:
            code = sum(x[i] << (b["nb"] - 1 - j) for j, i in enumerate(bits))
            for k, o in enumerate(opts):
                y[o] = int(code == k)
    return y


def honest_aux(form: dict, x: list[int]) -> list[int]:
    """Hilfsbits ehrlich setzen: w = x·y (in Reihenfolge – Hilfsbits können auf Hilfsbits aufbauen)."""
    x = list(x)
    for a in form["aux"]:
        x[a["index"]] = x[a["pair"][0]] * x[a["pair"][1]]
    return x


def encode_plan(form: dict, plan: list[int]) -> list[int]:
    """Gültiger Plan (Option je Auftrag) → Bits in den gewählten Kodierungen, Hilfsbits ehrlich."""
    x = [0] * form["n"]
    for b, o in zip(form["blocks"], plan):
        k = b["options"].index(o)
        if b["encoding"] == "one_hot":
            x[b["bits"][k]] = 1
        elif b["encoding"] == "domain_wall":  # 1 … 1 0 … 0, Wand nach Position k
            for j, i in enumerate(b["bits"]):
                x[i] = int(j < k)
        else:
            for j, i in enumerate(b["bits"]):
                x[i] = (k >> (b["nb"] - 1 - j)) & 1
    return honest_aux(form, x)


# ---------------------------------------------------------------------------------------------
# Bausteine prüfen
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
        checks = {"gewichtung": WEIGHTINGS, "variante": VARIANTS, "bloecke": SCOPES}
        if t["type"] in ("gruppe", "bitgruppe"):
            checks.update(gruppe=GROUPS if t["type"] == "gruppe" else BIT_GROUPS, form=FORMS)
        if t["type"] == "nachbar":
            checks.update(form=NEIGHBOR_FORMS)
        if t["type"] == "bitnachbar":
            checks.update(form=BIT_NEIGHBOR_FORMS)
        for key, allowed in checks.items():
            if key in t and t[key] not in allowed:
                raise ValueError(f"Baustein {tid}: {key} muss eines von {allowed} sein")
        for key in ("k", "a", "b", "c", "d"):
            if key in t:
                _num(t, key)
    return terms


def spec_of(term: dict) -> dict:
    """Nur die Felder, die einen Baustein beschreiben (ohne Zusätze wie stats, f, covers)."""
    return {k: term[k] for k in SPEC_KEYS if k in term}


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
    """g(o₁, o₂) = a + b·o₁ + c·o₂ + d·o₁·o₂ (o₁: oben/später, o₂: unten/früher).

    Lücke (Plätze) und Kette (Bits) haben dieselbe Form o₁·(1 − o₂): „oben nur, wenn unten“.
    """
    if term.get("form", "luecke") in ("luecke", "kette"):
        return {"a": 0.0, "b": 1.0, "c": 0.0, "d": -1.0}
    return {key: _num(term, key) for key in "abcd"}


def weight_factor(weighting: str, q: int, K: int) -> int:
    """Gewicht eines Platzes: q (von hinten, richtig für Erledigungszeiten), 1, oder K + 1 − q (von vorne)."""
    return {"q": q, "eins": 1, "vorne": K + 1 - q}[weighting]


def groups_of(instance: dict, group: str, tasks: set[int] | None = None) -> list[tuple[str, list[int]]]:
    """Optionsgruppen einer Gruppenregel, nur mit Optionen der Aufträge in `tasks`."""
    variables = [v for v in instance["variables"] if tasks is None or v["task_id"] in tasks]
    K = instance["slots"]
    if group == "auftrag":  # auch Aufträge ohne Optionen: ihre Regel kann nie erfüllt werden
        return [(f"#{t['transport_id']}", [v["index"] for v in variables if v["task_id"] == t["transport_id"]])
                for t in instance["tasks"] if tasks is None or t["transport_id"] in tasks]
    if group == "alle":
        return [("alle Optionen", [v["index"] for v in variables])] if variables else []
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
    """Kosten einer Option nach den Optionen des Kosten-Bausteins."""
    if instance["objective"] == "zuweisung":
        return v["cost"]
    task = next(t for t in instance["tasks"] if t["transport_id"] == v["task_id"])
    robot = next(r for r in instance["robots"] if r["robot_id"] == v["robot_id"])
    w = weight_factor(term.get("gewichtung", "q"), v["slot"], instance["slots"])
    rel = robot["release"] if term.get("wartezeit", True) else 0.0
    setup = s0[(v["robot_id"], v["task_id"])] if term.get("anfahrt", True) else 0.0
    return round(rel + w * (setup + task["p"]), 4)


# ---------------------------------------------------------------------------------------------
# Ausmultiplizieren
# ---------------------------------------------------------------------------------------------

def _pair_form(polys: list[Poly], f: dict) -> Poly:
    """f(n) mit n = Σ p, ausmultipliziert mit p² = p: a + (b + c)·Σ p + 2c·Σ_{i<j} p_i p_j."""
    out = _const(f["a"])
    for p in polys:
        _padd(out, p, f["b"] + f["c"])
    if f["c"]:
        for p, q in combinations(polys, 2):
            _padd(out, _poly_mul(p, q), 2 * f["c"])
    return _clean(out)


def _neighbor_poly(upper: Poly, lower: Poly, g: dict) -> Poly:
    out = _const(g["a"])
    _padd(out, upper, g["b"])
    _padd(out, lower, g["c"])
    if g["d"]:
        _padd(out, _poly_mul(upper, lower), g["d"])
    return _clean(out)


def _sum(polys: list[Poly]) -> Poly:
    out: Poly = {}
    for p in polys:
        _padd(out, p)
    return _clean(out)


def _substitute(p: Poly, x: int, y: int, w: int) -> Poly:
    """Rosenberg-Ersetzung: in jedem Term vom Grad > 2, der x und y enthält, steht danach w statt x·y."""
    out: Poly = {}
    for m, c in p.items():
        m2 = (m - {x, y}) | {w} if len(m) > 2 and x in m and y in m else m
        out[m2] = out.get(m2, 0.0) + c
    return out


def _next_id(terms: list[dict], base: str) -> str:
    ids = {str(t["id"]) for t in terms}
    if base not in ids:
        return base
    return next(f"{base}{k}" for k in range(2, 100) if f"{base}{k}" not in ids)


def build(instance: dict, terms: list[dict], encodings: str | dict | None = None, order: str = "nummer") -> dict:
    """Kodierung + Bausteine → Polynom → QUBO-Einträge mit Beiträgen je Baustein.

    Eintrag: {"i", "j", "parts": [{"term", "kind", "v", …}]}; Wert = Σ v · Gewicht(term).
    Konstante: {term: Wert}. Ob ein Baustein an ist, entscheidet erst die Oberfläche.
    """
    validate_terms(terms)
    if order not in ORDERS:
        raise ValueError(f"Reihenfolge der Optionen muss eine von {ORDERS} sein")
    enc = resolve_encodings(instance, encodings)
    blocks, bits = make_blocks(instance, enc, order)
    ind = indicator_polys(blocks)
    used_enc = {b["encoding"] for b in blocks}
    K = instance["slots"]
    s0, sb = _setup_maps(instance)
    variables = instance["variables"]
    by_key = {(v["task_id"], v["robot_id"], v["slot"]): v["index"] for v in variables}
    task_ids = [t["transport_id"] for t in instance["tasks"]]
    robot_ids = [r["robot_id"] for r in instance["robots"]]
    block_of = {b["task_id"]: b for b in blocks}

    def scope(term: dict) -> set[int]:
        s = term.get("bloecke", "alle")
        return {t for t in task_ids if s == "alle" or enc[t] == s}

    rules: list[dict] = []
    resolved: list[dict] = []
    term_polys: dict[str, Poly] = {}

    def rule(tid: str, kind: str, poly: Poly, **meta) -> None:
        rules.append({"term": tid, "kind": kind, **meta, "_poly": poly})
        _padd(term_polys.setdefault(tid, {}), poly)

    for term in terms:
        tid, kind = str(term["id"]), term["type"]
        mine = scope(term)
        info: dict = {"notes": [], "tasks": sorted(mine), "misfit": False}  # misfit: passt nicht zur Kodierung
        term_polys.setdefault(tid, {})
        if term.get("bloecke", "alle") != "alle" and not mine:
            info["notes"].append(f"kein Auftrag ist {ENCODING_LABEL[term['bloecke']]}-kodiert – der Baustein wirkt nicht")
            info["misfit"] = True
        if kind == "kosten":
            info["covers"] = "ziel"
            for v in variables:
                if v["task_id"] not in mine:
                    continue
                c = cost_coefficient(instance, v, term, s0)
                rule(tid, kind, {m: c * k for m, k in ind[v["index"]].items()}, opt=v["index"], c=c,
                     task_id=v["task_id"], robot_id=v["robot_id"], slot=v["slot"])
        elif kind == "vorgaenger":
            info["covers"] = "ziel"
            if K < 2:
                info["notes"].append("wirkt erst ab K = 2 Plätzen – mit einem Platz gibt es keinen Vorgänger")
            weighting = term.get("gewichtung", "q")
            for r in robot_ids:
                for q in range(1, K):
                    w = weight_factor(weighting, q, K)
                    for i in task_ids:
                        for j in task_ids:
                            a, b = by_key.get((i, r, q + 1)), by_key.get((j, r, q))
                            if i == j or a is None or b is None or i not in mine or j not in mine:
                                continue
                            base = sb[(i, j)] - (s0[(r, j)] if term.get("variante", "differenz") == "differenz" else 0.0)
                            c = round(w * base, 4)
                            if c:
                                rule(tid, kind, {m: c * k for m, k in _poly_mul(ind[a], ind[b]).items()}, opts=[a, b], c=c,
                                     robot_id=r, slot=q, **{"from": i, "to": j}, weight=w, s=sb[(i, j)], s0=s0[(r, j)])
        elif kind == "gruppe":
            f = form_coefficients(term)
            group = term.get("gruppe", "auftrag")
            groups = groups_of(instance, group, mine)
            info.update(f=f, groups=len(groups), max_size=max((len(g) for _, g in groups), default=0),
                        covers=GROUP_COVERS[group] if K >= 2 or group not in ("platz", "roboter") else None)
            if group in ("platz", "roboter") and K == 1 and f["c"] > 0:
                info["misfit"] = True
                info["notes"].append("bei K = 1 ist das die Spaltenregel: sie verbietet Doppelbelegung, die im echten Problem erlaubt ist")
            if group == "roboter" and K > 1:
                info["notes"].append("strenger als nötig: höchstens ein Auftrag je Roboter verbietet jede Reihenfolge")
            if group == "auftrag_roboter" and K == 1:
                info["notes"].append("bei K = 1 hat jede Gruppe nur eine Option – die Regel koppelt nichts")
            if group == "auftrag" and any(enc[t] == "domain_wall" for t in mine) and f["c"]:
                info["misfit"] = True
                info["notes"].append("auf Domain-Wall-Ketten ist Σδ immer 1; mit I² = I ausmultipliziert gilt aber "
                                     "δ = −1 an Kettenbrüchen – die Regel belohnt dann Brüche")
            if group == "auftrag" and any(enc[t] == "binary" for t in mine):
                info["notes"].append("auf Binär-Blöcken ist „genau eine Option“ dasselbe wie „kein Phantom-Code“")
            for label, opts in groups:
                rule(tid, kind, _pair_form([ind[o] for o in opts], f), opts=opts, label=label, f=f)
        elif kind == "nachbar":
            g = neighbor_coefficients(term)
            info.update(g=g, covers="luecke")
            if K < 2:
                info["notes"].append("wirkt erst ab K = 2 Plätzen")
            for r in robot_ids:
                for q in range(1, K):
                    up = [v["index"] for v in variables if v["robot_id"] == r and v["slot"] == q + 1 and v["task_id"] in mine]
                    low = [v["index"] for v in variables if v["robot_id"] == r and v["slot"] == q and v["task_id"] in mine]
                    if not up and not low:
                        continue
                    poly = _neighbor_poly(_sum([ind[o] for o in up]), _sum([ind[o] for o in low]), g)
                    rule(tid, kind, poly, upper=up, lower=low, robot_id=r, slot=q, label=f"R{r} Platz {q + 1}/{q}", g=g)
        elif kind == "bitgruppe":
            f = form_coefficients(term)
            group = term.get("gruppe", "block")
            mine_blocks = [b for b in blocks if b["task_id"] in mine and b["bits"]]
            if group == "block":
                groups = [(f"#{b['task_id']}", b["bits"]) for b in mine_blocks]
            elif group == "stelle":
                width = max((len(b["bits"]) for b in mine_blocks), default=0)
                groups = [(f"Bitstelle {j + 1}", [b["bits"][j] for b in mine_blocks if len(b["bits"]) > j])
                          for j in range(width)]
            else:
                groups = [("alle Bits", [i for b in mine_blocks for i in b["bits"]])] if mine_blocks else []
            info.update(f=f, groups=len(groups), max_size=max((len(g) for _, g in groups), default=0), covers=None)
            for label, group_bits in groups:
                rule(tid, kind, _pair_form([_var(i) for i in group_bits], f), bits=group_bits, label=label, f=f)
        elif kind == "bitnachbar":
            g = neighbor_coefficients(term)
            chain_rule = term.get("form", "kette") == "kette"
            info.update(g=g, covers="kodierung" if chain_rule and any(enc[t] == "domain_wall" for t in mine) else None)
            if chain_rule and any(enc[t] != "domain_wall" for t in mine):
                info["misfit"] = True
                info["notes"].append("die Kettenregel auf One-Hot- oder Binär-Bits verlangt: ein Bit nur, wenn das vorige "
                                     "an ist – für diese Kodierungen ohne Sinn")
            for t in sorted(mine, key=task_ids.index):
                bb = block_of[t]["bits"]
                for j in range(len(bb) - 1):
                    lo, hi = bb[j], bb[j + 1]
                    rule(tid, kind, _neighbor_poly(_var(hi), _var(lo), g), hi=hi, lo=lo, task_id=t,
                         label=f"#{t} Bit {j + 2}/{j + 1}", g=g)
        elif kind == "ungueltig":
            info["covers"] = "kodierung"
            if any(enc[t] != "binary" for t in mine):
                info["misfit"] = True
                info["notes"].append("Phantom-Codes gibt es nur in Binär-Blöcken – auf die anderen wirkt der Baustein nicht")
            for t in sorted(mine, key=task_ids.index):
                b = block_of[t]
                if b["encoding"] != "binary":
                    continue
                phantom = [c["code"] for c in b["codes"] if c["option"] is None]
                if phantom:
                    rule(tid, kind, _sum([_indicator(b["bits"], k) for k in phantom]), task_id=t, bits=b["bits"],
                         codes=phantom, nb=b["nb"], label=f"#{t} Phantom-Codes")
            if not any(r["term"] == tid for r in rules) and any(enc[t] == "binary" for t in mine):
                info["notes"].append("keine Phantom-Codes: jede Optionszahl ist eine Zweierpotenz")
        else:  # hilfsbit: erst nach der Quadratisierung
            info["covers"] = "hilfsbit"
        term_polys[tid] = _clean(term_polys[tid])
        resolved.append({**term, **info})

    # Grad vor der Quadratisierung
    degrees: dict[int, int] = {}
    for p in term_polys.values():
        for m in p:
            if m:
                degrees[len(m)] = degrees.get(len(m), 0) + 1
    degrees = dict(sorted(degrees.items()))

    # Quadratisierung wie formulations.binary: häufigstes Paar in Termen vom Grad > 2 → Hilfsbit
    aux: list[dict] = []
    work = {tid: p for tid, p in term_polys.items() if p}
    task_of = {b["index"]: b["task_id"] for b in bits}
    while True:
        counts: dict[tuple[int, int], int] = {}
        for p in work.values():
            for m in p:
                if len(m) > 2:
                    for pair in combinations(sorted(m), 2):
                        counts[pair] = counts.get(pair, 0) + 1
        if not counts:
            break
        if len(bits) >= MAX_VARS:
            raise ValueError(f"Zu groß: über {MAX_VARS} Bits mit Hilfsbits – weniger Aufträge, weniger Plätze oder "
                             "eine andere Kodierung wählen")
        x, y = min(counts, key=lambda pr: (-counts[pr], task_of[pr[0]] == task_of[pr[1]], pr))
        w = len(bits)
        bits.append({"index": w, "task_id": None, "pos": len(aux) + 1, "encoding": None, "aux": True, "pair": [x, y]})
        task_of[w] = None
        aux.append({"index": w, "pair": [x, y], "replaced": counts[(x, y)]})
        work = {tid: _substitute(p, x, y, w) for tid, p in work.items()}

    # Hilfsbit-Strafe: automatisch ergänzt, solange Hilfsbits nötig sind
    hb = [t for t in resolved if t["type"] == "hilfsbit"]
    if aux and not hb:
        auto = {"id": _next_id(resolved, "hilfsbit"), "type": "hilfsbit", "symbol": "M", "auto": True,
                "notes": ["automatisch ergänzt: Terme vom Grad > 2 brauchen Hilfsbits"], "tasks": [], "covers": "hilfsbit"}
        resolved.append(auto)
        hb = [auto]
    if not aux:
        resolved = [t for t in resolved if not (t["type"] == "hilfsbit" and t.get("auto"))]
        for t in resolved:
            if t["type"] == "hilfsbit":
                t["notes"].append("keine Hilfsbits nötig – alle Terme haben höchstens Grad 2")
    for t in hb:
        for a in aux:
            x, y = a["pair"]
            w = a["index"]
            rules.append({"term": str(t["id"]), "kind": "hilfsbit", "aux": w, "pair": [x, y], "label": f"w{w}",
                          "_poly": {frozenset([x, y]): 1.0, frozenset([x, w]): -2.0, frozenset([y, w]): -2.0,
                                    frozenset([w]): 3.0}})

    # Einträge: dieselbe Ersetzungsfolge auf jede Regel einzeln – so bleibt die Herkunft jedes Beitrags sichtbar
    entries: dict[tuple[int, int], dict] = {}
    const: dict[str, float] = {str(t["id"]): 0.0 for t in resolved}
    residual: dict[tuple[str, frozenset], float] = {}  # Terme vom Grad > 2, die sich im Baustein wegheben
    meta_keys = {"kosten": ("task_id", "robot_id", "slot"), "vorgaenger": ("robot_id", "slot", "from", "to"),
                 "hilfsbit": ("aux", "pair")}
    for r in rules:
        p = r.pop("_poly")
        if r["kind"] != "hilfsbit":
            for a in aux:
                p = _substitute(p, a["pair"][0], a["pair"][1], a["index"])
        keys = meta_keys.get(r["kind"])
        meta = {k: r[k] for k in keys} if keys else {"group": r["label"]}
        for m, c in p.items():
            if abs(c) < 1e-12:
                continue
            ms = sorted(m)
            if len(ms) > 2:
                residual[(r["term"], m)] = residual.get((r["term"], m), 0.0) + c
                continue
            if not ms:
                const[r["term"]] += c
                continue
            i, j = ms[0], ms[-1]
            e = entries.setdefault((i, j), {"i": i, "j": j, "parts": []})
            e["parts"].append({"term": r["term"], "kind": r["kind"], "v": c, **meta})
    if any(abs(c) > 1e-6 for c in residual.values()):
        raise RuntimeError("Quadratisierung unvollständig – ein Term vom Grad > 2 ist übrig geblieben")

    for t in resolved:  # Strukturkennzahlen je Baustein
        t["stats"] = {"diag": 0, "couplings": 0, "const": round(const[str(t["id"])], 4)}
    by_id = {str(t["id"]): t for t in resolved}
    for e in entries.values():
        for term_id in {p["term"] for p in e["parts"]}:
            by_id[term_id]["stats"]["diag" if e["i"] == e["j"] else "couplings"] += 1
    for t in resolved:
        t["note"] = " · ".join(t.pop("notes"))
        if not t["note"]:
            del t["note"]

    form = {
        "encoding": "baukasten",
        "encodings": {str(k): v for k, v in enc.items()},
        "used_encodings": [e for e in ENCODINGS if e in used_enc],
        "order": order,
        "blocks": blocks,
        "bits": bits,
        "aux": aux,
        "n_task_bits": sum(len(b["bits"]) for b in blocks),
        "degrees": degrees,
        "max_degree": max(degrees, default=0),
        "terms": resolved,
        "rules": rules,
        "entries": sorted(entries.values(), key=lambda e: (e["i"], e["j"])),
        "const": const,
        "n": len(bits),
    }
    form["requirements"] = requirements(instance, form)
    recommend_weights(instance, form)
    return form


# ---------------------------------------------------------------------------------------------
# Empfohlene Gewichte
# ---------------------------------------------------------------------------------------------

def lie_gains(form: dict, weights: dict[str, float]) -> dict[int, float]:
    """Je Hilfsbit: größter Energiegewinn, wenn es „lügt“ (w ≠ x·y) – ohne die Hilfsbit-Strafe.

    Wie formulations.binary_lie_gains: alle Belegungen der Nachbarn durchprobiert (bis 16, sonst die
    Summe der Beträge als obere Schranke). Die Strafe kostet je Lüge mindestens M.
    """
    aux_ids = {a["index"] for a in form["aux"]}
    lin = {w: 0.0 for w in aux_ids}
    nbr: dict[int, dict[int, float]] = {w: {} for w in aux_ids}
    for e in form["entries"]:
        value = sum(p["v"] * weights.get(p["term"], 0.0) for p in e["parts"] if p["kind"] != "hilfsbit")
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
        masks = np.arange(1 << len(context), dtype=np.int64)
        val = {v: (masks >> k) & 1 for k, v in enumerate(context)}
        honest = val[x] * val[y]
        field = lin[w] + sum(q * val[j] for j, q in nbr[w].items())
        gains[w] = max(0.0, float((-(1 - 2 * honest) * field).max()))
    return gains


def recommend_weights(instance: dict, form: dict) -> dict[str, float]:
    """Empfohlenes Gewicht je Baustein, nach seiner Rolle (steht danach als „recommended“ am Baustein).

    - Ziel (Kosten, Vorgänger): 1
    - Zeilen-, Phantom- und Bitregeln: A (One-Hot-Regel: übersteigt den größten Zuwachs bzw. 1,5 × größte Kosten)
    - Platz/Spalte: B, Lücke: D
    - Kettenregel: bei K = 1 A (ein Kettenbruch spart höchstens die Kostenspannweite); ab K = 2 2 × max(B, D) –
      an einer falschen Wand wird δ = −1 und Platz- bzw. Lückenregel belohnen statt zu strafen
    - Hilfsbit-Strafe M: 1,1 × größter Gewinn einer Lüge bei den übrigen empfohlenen Gewichten
    """
    base = default_term_weights(instance)
    A, B, D = base["A"], base["B"], base["D"]
    out: dict[str, float] = {}
    for t in form["terms"]:
        kind = t["type"]
        if kind in ("kosten", "vorgaenger"):
            w = 1.0
        elif kind == "gruppe":
            w = B if t.get("gruppe", "auftrag") in ("platz", "roboter") else A
        elif kind == "nachbar":
            w = D
        elif kind == "bitnachbar":
            w = (2 * max(B, D) if instance["slots"] >= 2 else A) if t.get("form", "kette") == "kette" else A
        else:
            w = A
        out[str(t["id"])] = w
    if form["aux"]:
        gains = lie_gains(form, out)
        M = nice_ceil(max(10.0, 1.1 * max(gains.values(), default=0.0)))
        for t in form["terms"]:
            if t["type"] == "hilfsbit":
                out[str(t["id"])] = M
    for t in form["terms"]:
        t["recommended"] = out[str(t["id"])]
    return out


# ---------------------------------------------------------------------------------------------
# Energie und Lesart
# ---------------------------------------------------------------------------------------------

def energy_qubo(form: dict, x: list[int], weights: dict[str, float], active: set[str] | None = None) -> float:
    """E(x) = xᵀQx + Konstante; weights je Baustein-Kennung, active = eingeschaltete Bausteine."""
    on = (lambda t: True) if active is None else (lambda t: t in active)
    e = sum(v * weights[t] for t, v in form["const"].items() if on(t))
    for q in form["entries"]:
        if x[q["i"]] and x[q["j"]]:
            e += sum(p["v"] * weights[p["term"]] for p in q["parts"] if on(p["term"]))
    return e


def rule_value(r: dict, x: list[int], y: dict[int, int]) -> float:
    """Wert einer Regel ohne Gewicht – direkt aus ihrer Bedeutung (y: Indikatorwerte)."""
    kind = r["kind"]
    if kind == "kosten":
        return r["c"] * y[r["opt"]]
    if kind == "vorgaenger":
        return r["c"] * y[r["opts"][0]] * y[r["opts"][1]]
    if kind in ("gruppe", "bitgruppe"):
        vals = [y[o] for o in r["opts"]] if kind == "gruppe" else [x[i] for i in r["bits"]]
        f = r["f"]
        pairs = (sum(vals) ** 2 - sum(v * v for v in vals)) / 2
        return f["a"] + (f["b"] + f["c"]) * sum(vals) + 2 * f["c"] * pairs
    if kind in ("nachbar", "bitnachbar"):
        if kind == "nachbar":
            o1, o2 = sum(y[o] for o in r["upper"]), sum(y[o] for o in r["lower"])
        else:
            o1, o2 = x[r["hi"]], x[r["lo"]]
        g = r["g"]
        return g["a"] + g["b"] * o1 + g["c"] * o2 + g["d"] * o1 * o2
    if kind == "ungueltig":
        code = sum(x[i] << (r["nb"] - 1 - j) for j, i in enumerate(r["bits"]))
        return float(code in r["codes"])
    a, b = r["pair"]
    w = r["aux"]
    return x[a] * x[b] - 2 * x[a] * x[w] - 2 * x[b] * x[w] + 3 * x[w]


def energy_rules(form: dict, x: list[int], weights: dict[str, float], active: set[str] | None = None) -> float:
    """E(x) direkt aus den Regeln – stimmt mit energy_qubo überein, solange die Hilfsbits ehrlich sind."""
    y = indicator_values(form, x)
    return sum(weights[r["term"]] * rule_value(r, x, y) for r in form["rules"] if active is None or r["term"] in active)


def read_plan(instance: dict, form: dict, x: list[int]) -> dict:
    """Bits → Plan: Optionen mit I = 1 je Auftrag; Verstöße gegen das echte Problem und die Kodierung."""
    from formulations import decode_schedule, simulate

    y = indicator_values(form, x)
    one_hot = [0] * len(instance["variables"])
    for o, v in y.items():
        one_hot[o] = int(v == 1)
    dec = decode_schedule(instance, one_hot)
    issues = list(dec["issues"])
    for b in form["blocks"]:
        if b["encoding"] == "domain_wall" and any(y[o] < 0 for o in b["options"]):
            issues.append(f"#{b['task_id']}: Kette gebrochen")
        if b["encoding"] == "binary" and b["options"] and not any(y[o] for o in b["options"]):
            issues.append(f"#{b['task_id']}: Phantom-Code")
    lies = [a["index"] for a in form["aux"] if x[a["index"]] != x[a["pair"][0]] * x[a["pair"][1]]]
    if instance["objective"] == "zuweisung":
        value = sum(v["cost"] for v in instance["variables"] if one_hot[v["index"]])
    else:
        value = simulate(instance, dec["sequences"])["total"]
    return {"valid": not issues, "issues": issues, "sequences": dec["sequences"], "value": round(value, 4), "lies": lies}
