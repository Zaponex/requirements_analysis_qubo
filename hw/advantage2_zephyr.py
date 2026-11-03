"""Schritt 2: D-Wave Advantage2 (Zephyr). Derselbe Embedding-Lauf wie bei Pegasus, Zielgraph der ideale Zephyr-Graph Z12.

Z12 hat laut dwave_networkx 4800 Qubits, 45864 Koppler und höchsten Grad 20. Das ausgelieferte System Advantage2_system1.1 hat laut
D-Wave-Datenblatt „4,400+“ Qubits, „40,000+“ Koppler und 20-way Konnektivität – der ideale Graph ist also eine obere Schranke und
größer als das gelieferte System (im Paper so sagen).
"""
from __future__ import annotations

from functools import lru_cache

import dimod
import dwave_networkx as dnx
import minorminer
import networkx as nx

from .embedding import TIMEOUT_S, map_embedding

HARDWARE = "advantage2_zephyr"
ZEPHYR_M = 12


@lru_cache(maxsize=1)
def target_graph() -> nx.Graph:
    return dnx.zephyr_graph(ZEPHYR_M)


def meta() -> dict:
    g = target_graph()
    return {"hardware": HARDWARE, "target": f"dwave_networkx.zephyr_graph({ZEPHYR_M})", "target_qubits": g.number_of_nodes(),
            "target_couplers": g.number_of_edges(), "target_max_degree": max(d for _, d in g.degree()),
            "ideal_graph": True,
            "note": "ideal Z12 graph (4800 qubits); the shipped Advantage2_system1.1 has 4,400+ qubits and 40,000+ couplers per the D-Wave data sheet: "
                    "the ideal graph is an upper bound",
            "sources": ["D-Wave Advantage2 data sheet: 4,400+ qubits, 20-way connectivity, 40,000+ couplers; Advantage2_system1.1 generally available "
                        "2025-05-20 (dwavequantum.com data sheet, support.dwavesys.com release notes), accessed 2026-11-02"],
            "minorminer": minorminer.__version__, "dwave_networkx": dnx.__version__}


def map_advantage2_zephyr(bqm: dimod.BinaryQuadraticModel, seed: int, timeout: float = TIMEOUT_S, target: nx.Graph | None = None) -> dict:
    """Ein Embedding-Lauf (ein Seed) → ein Datensatz im gemeinsamen Schema."""
    return map_embedding(HARDWARE, bqm, seed, target if target is not None else target_graph(), timeout)
