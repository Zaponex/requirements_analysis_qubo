"""Schritt 3: IBM Heron. Eine QAOA-Lage auf die Kopplungskarte von FakeFez (156 Qubits, 176 Koppler, cz) transpiliert.

Alle sechs Heron-Fakes (FakeFez, FakeKingston, FakeMarrakesh, FakeAachen, FakeBoston, FakePittsburgh) haben dieselbe Kopplungskarte
(in meta() nachgerechnet); die Gatterzahlen gelten damit für Heron r2 wie r3 gleich, nur die Fehlerraten unterscheiden sich (Ebene 2,
hier nicht berechnet). Laut IBM-Ankündigung ist ibm_boston das Heron-r3-System (accessed 2026-11-02, quantum.cloud.ibm.com).
"""
from __future__ import annotations

from functools import lru_cache

import dimod
import qiskit
import qiskit_ibm_runtime
from qiskit_ibm_runtime import fake_provider

from .gate_based import map_gate_based

HARDWARE = "heron"
BACKEND = "FakeFez"
SAME_MAP = ("FakeKingston", "FakeMarrakesh", "FakeAachen", "FakeBoston", "FakePittsburgh")


@lru_cache(maxsize=1)
def backend():
    return getattr(fake_provider, BACKEND)()


def _edges(b) -> set:
    return {tuple(sorted(e)) for e in b.coupling_map.get_edges()}


def meta() -> dict:
    b = backend()
    same = {n: _edges(getattr(fake_provider, n)()) == _edges(b) for n in SAME_MAP}
    return {"hardware": HARDWARE, "target": f"{BACKEND} (qiskit_ibm_runtime.fake_provider)", "target_qubits": b.num_qubits,
            "target_couplers": len(_edges(b)), "target_max_degree": max(sum(1 for e in _edges(b) if q in e) for q in range(b.num_qubits)),
            "two_qubit_gate": "cz", "same_coupling_map_as": same,
            "note": "one QAOA layer, optimization_level=3; counts hold for all Heron fakes with this coupling map; no error-based estimate",
            "sources": ["IBM Quantum announcement 2026-01-05: ibm_boston is the Heron r3 system, Heron has 176 couplers "
                        "(quantum.cloud.ibm.com/announcements/product-updates/2026-01-05-nighthawk), accessed 2026-11-02"],
            "qiskit": qiskit.__version__, "qiskit_ibm_runtime": qiskit_ibm_runtime.__version__}


def map_heron(bqm: dimod.BinaryQuadraticModel, seed: int) -> dict:
    return map_gate_based(HARDWARE, bqm, seed, backend())
