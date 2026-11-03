"""Schritt 5: Quantinuum Helios (Ionenfalle, all-to-all). Kein Routing, kein Emulator: Es wird nur gezählt.

Qubits = logische Qubits (die Hilfsbits der Quadratisierung sind schon enthalten), Zwei-Qubit-Gatter je QAOA-Lage = Zahl der Kopplungen,
wenn das native Gatter eine ZZ-Rotation ist. Hartes Limit: 98 Qubits. Die Zählung ist deterministisch, ein Seed reicht (SEEDS = 1).

NICHT VERIFIZIERT: Die 98 Qubits und die all-to-all-Konnektivität stammen aus der Quantinuum-Ankündigung (quantinuum.com, Presse und
Fachpresse, accessed 2026-11-02). Dass das native Zwei-Qubit-Gatter eine ZZ-Rotation RZZ(θ) ist, steht nur in einer Drittquelle; eine offizielle
Angabe des Gattersatzes habe ich nicht gefunden. Wäre nur RZZ(π/2) nativ (CNOT-äquivalent), kostete jeder RZZ zwei Gatter.
"""
from __future__ import annotations

import dimod

from .common import blank_record

HARDWARE = "helios"
QUBITS = 98
SEEDS = 1  # deterministische Zählung


def meta() -> dict:
    return {"hardware": HARDWARE, "target": f"all-to-all, {QUBITS} qubits (counting only)", "target_qubits": QUBITS,
            "note": "no routing, no emulator: qubits = logical qubits, two-qubit gates per layer = number of couplings (ZZ-type native gate assumed, unverified); "
                    "deterministic, one seed",
            "sources": ["Quantinuum Helios announcement: 98 fully connected physical qubits, two-qubit fidelity 99.921% "
                        "(quantinuum.com/blog/introducing-helios-the-most-accurate-quantum-computer-in-the-world, press coverage), accessed 2026-11-02",
                        "native gate RZZ(θ): third-party analysis only, official gate set not found"]}


def map_helios(bqm: dimod.BinaryQuadraticModel, seed: int) -> dict:
    rec = blank_record(HARDWARE, bqm, seed)
    if bqm.num_variables > QUBITS:  # hartes Limit
        rec["status"] = "exceeds_limit"
        return rec
    rec.update(status="mapped", two_qubit_gates=bqm.num_interactions, depth=None)
    return rec
