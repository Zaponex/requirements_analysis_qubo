"""Schritt 1: D-Wave Advantage (Pegasus). Minor-Embedding der BQM-Struktur in den idealen Pegasus-Graphen P16.

P16 hat 5640 Qubits, 40484 Koppler und höchsten Grad 15. Das ist der IDEALE Graph: Das echte System hat inaktive Qubits und Koppler,
der ideale Graph ist also eine obere Schranke dessen, was sich einbetten lässt (im Paper so sagen). Den tatsächlichen Arbeitsgraphen
gibt es nur mit Leap-Zugang; er ließe sich später als Option ergänzen.
"""
from __future__ import annotations

from functools import lru_cache

import dimod
import dwave_networkx as dnx
import minorminer
import networkx as nx

from .embedding import TIMEOUT_S, is_valid_embedding, map_embedding, source_graph  # noqa: F401  (Namen bleiben hier importierbar)

HARDWARE = "advantage_pegasus"
PEGASUS_M = 16


@lru_cache(maxsize=1)
def target_graph() -> nx.Graph:
    return dnx.pegasus_graph(PEGASUS_M)


def meta() -> dict:
    g = target_graph()
    return {"hardware": HARDWARE, "target": f"dwave_networkx.pegasus_graph({PEGASUS_M})", "target_qubits": g.number_of_nodes(),
            "target_couplers": g.number_of_edges(), "target_max_degree": max(d for _, d in g.degree()),
            "ideal_graph": True, "note": "ideal graph without inactive qubits/couplers: an upper bound for the real system",
            "minorminer": minorminer.__version__, "dwave_networkx": dnx.__version__}


def map_advantage_pegasus(bqm: dimod.BinaryQuadraticModel, seed: int, timeout: float = TIMEOUT_S, target: nx.Graph | None = None) -> dict:
    """Ein Embedding-Lauf (ein Seed) → ein Datensatz im gemeinsamen Schema."""
    return map_embedding(HARDWARE, bqm, seed, target if target is not None else target_graph(), timeout)
