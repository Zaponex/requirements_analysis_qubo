"""QUBOs der Hardware-Abbildung: Instanzen aus encodings/resources.py als dimod-BQM.

Model A = Sofortzuweisung (IA, Paarstrafe), Model B = Zuweisung mit Reihenfolge (TA, Lastausgleich H_WB) – dieselben Formulierungen wie
im Reiter „Qubits & Kopplungen“. Instanzgröße: n Aufträge (orders), Flotte R = n/2 (fleet m = n/2), volle Zuständigkeit, Kosten 40 … 100 s
ohne Zufall (resources.structure_instance). Die Instanz ist deterministisch; der Seed der Abbildungsläufe (Embedding, Transpiler)
steckt nicht hier, sondern in den map_*-Funktionen.
"""
from __future__ import annotations

import sys
from pathlib import Path

import dimod

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "encodings"))

import resources  # noqa: E402

MODELS = {"A": ("IA", "paar"), "B": ("TA", "wb")}
ENCODINGS = {"OH": "one_hot", "DW": "domain_wall", "BIN": "binary"}
ORDERS = tuple(range(4, 19, 2))  # n = 4, 6, …, 18 Aufträge, R = n/2 Roboter (bis 18 × 9); n = 2 hat bei Model B keine Entscheidungsbits


def fleet(n: int) -> int:
    """Flottengröße zu n Aufträgen: m = n/2."""
    return max(1, n // 2)


def build(model: str, enc: str, T: int, R: int, seed: int = 0) -> dict:
    """Fertige QUBO-Formulierung (Bits mit Typ, Einträge Q_ij) für Model A/B, Kodierung OH/DW/BIN und T × R.

    seed: wird nur durchgereicht, die Strukturinstanz hat keine Zufallskomponente (Kosten sind eine feste Funktion von t, r).
    Das schnelle M (exact_M=False) wie bei den Zählungen im Reiter – es ändert nur Koeffizienten, nie die Kopplungen.
    """
    if model not in MODELS or enc not in ENCODINGS:
        raise ValueError(f"model ∈ {tuple(MODELS)}, enc ∈ {tuple(ENCODINGS)}")
    cls, variant = MODELS[model]
    return resources.build_case(resources.structure_instance(T, R), cls, ENCODINGS[enc], variant, exact_M=False)


def analyse(form: dict) -> dict:
    """QUBO → dimod.BinaryQuadraticModel und Zählung. Variablen ohne Kopplung bleiben als isolierte Knoten im Graphen.

    Eine Kopplung ist ein Eintrag Q_ij ≠ 0 mit i ≠ j (|Q_ij| ≥ 1e-9, wie resources.metrics); das Feld Q_ii ist ein linearer Term.
    """
    bqm = dimod.BinaryQuadraticModel("BINARY")
    for b in form["bits"]:
        bqm.add_variable(b["index"], 0.0)
    for e in form["entries"]:
        if abs(e["value"]) < 1e-9:
            continue
        if e["i"] == e["j"]:
            bqm.add_linear(e["i"], e["value"])
        else:
            bqm.add_quadratic(e["i"], e["j"], e["value"])
    bqm.offset = form["const"]
    n = bqm.num_variables
    return {"bqm": bqm, "n": n, "couplings": bqm.num_interactions, "linear_terms": sum(1 for v in bqm.linear.values() if v != 0.0),
            "aux": sum(1 for b in form["bits"] if b["type"] == "hilfsbit"),
            "density": bqm.num_interactions / (n * (n - 1) / 2) if n > 1 else 0.0}
