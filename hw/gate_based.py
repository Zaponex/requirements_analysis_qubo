"""Gatterbasierte Hardware (IBM): eine QAOA-Lage der BQM auf die Kopplungskarte des Geräts transpilieren und Zwei-Qubit-Gatter zählen.

Eine Lage: Hadamard auf allen Qubits, je quadratischem Term ein RZZ, je linearem Term ein RZ, je Qubit ein RX-Mixer; die Winkel sind feste
Platzhalter, nur die Struktur zählt. Native Zwei-Qubit-Gatter ist cz, ein RZZ kostet zwei davon; Routing-Aufwand = gezählte Gatter − 2 ·
Kopplungen. Transpiler: generate_preset_pass_manager(optimization_level=3, backend, seed_transpiler=seed).

„mapped“ = die Lage wurde auf die Kopplungskarte transpiliert; das hängt hier nur an der Qubitzahl: Hat das Gerät genug Qubits, gelingt
das Routing immer (mit SWAPs), die Kosten stehen in two_qubit_gates. „exceeds_limit“ = mehr logische Qubits als das Gerät hat (sicher).
"""
from __future__ import annotations

import time

import dimod
from qiskit import QuantumCircuit
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

from .common import blank_record


def qaoa_layer(bqm: dimod.BinaryQuadraticModel) -> QuantumCircuit:
    n = bqm.num_variables
    qc = QuantumCircuit(n)
    qc.h(range(n))
    for u, v in bqm.quadratic:
        qc.rzz(0.37, u, v)
    for v, c in bqm.linear.items():
        if c != 0.0:
            qc.rz(0.21, v)
    qc.rx(0.5, range(n))
    return qc


def map_gate_based(hardware: str, bqm: dimod.BinaryQuadraticModel, seed: int, backend) -> dict:
    """Ein Transpiler-Lauf (ein Seed) → ein Datensatz im gemeinsamen Schema."""
    rec = blank_record(hardware, bqm, seed)
    rec["routing_overhead"] = None
    if bqm.num_variables > backend.num_qubits:  # hartes Limit
        rec["status"] = "exceeds_limit"
        return rec
    if bqm.num_variables == 0:
        rec.update(status="mapped", two_qubit_gates=0, depth=0, routing_overhead=0)
        return rec
    qc = qaoa_layer(bqm)
    t0 = time.perf_counter()
    out = generate_preset_pass_manager(optimization_level=3, backend=backend, seed_transpiler=seed).run(qc)
    rec["runtime_s"] = round(time.perf_counter() - t0, 3)
    gates = out.num_nonlocal_gates()
    rec.update(status="mapped", two_qubit_gates=gates, depth=out.depth(), routing_overhead=gates - 2 * bqm.num_interactions)
    return rec
