"""Schritt 4: IBM Nighthawk. Dieselbe Lage und derselbe Transpiler wie bei Heron, Kopplungskarte von FakeNighthawk (120 Qubits, 218 Koppler,
Quadratgitter, cz). Die Fehlerwerte der Fake-Klasse sind nicht typisch für Nighthawk: nur die Topologie wird benutzt, keine
fehlerbasierte Schätzung."""
from __future__ import annotations

from functools import lru_cache

import dimod
import qiskit
import qiskit_ibm_runtime
from qiskit_ibm_runtime import fake_provider

from .gate_based import map_gate_based

HARDWARE = "nighthawk"


@lru_cache(maxsize=1)
def backend():
    return fake_provider.FakeNighthawk()


def meta() -> dict:
    b = backend()
    edges = {tuple(sorted(e)) for e in b.coupling_map.get_edges()}
    return {"hardware": HARDWARE, "target": "FakeNighthawk (qiskit_ibm_runtime.fake_provider)", "target_qubits": b.num_qubits,
            "target_couplers": len(edges), "target_max_degree": max(sum(1 for e in edges if q in e) for q in range(b.num_qubits)),
            "two_qubit_gate": "cz",
            "note": "topology only; error values of FakeNighthawk are not typical, so no error-based estimate; one QAOA layer, optimization_level=3",
            "sources": ["IBM Quantum announcement 2026-01-05: Nighthawk has 120 qubits in a square lattice with 218 tunable couplers "
                        "(quantum.cloud.ibm.com/announcements/product-updates/2026-01-05-nighthawk), accessed 2026-11-02"],
            "qiskit": qiskit.__version__, "qiskit_ibm_runtime": qiskit_ibm_runtime.__version__}


def map_nighthawk(bqm: dimod.BinaryQuadraticModel, seed: int) -> dict:
    return map_gate_based(HARDWARE, bqm, seed, backend())
