"""Minor-Embedding einer BQM-Struktur in einen Annealer-Zielgraphen – gemeinsamer Lauf für Pegasus (Schritt 1) und Zephyr (Schritt 2).

„mapped“ = ein gültiges Embedding (disjunkte, zusammenhängende Ketten, jede Kopplung durch einen Koppler gedeckt) wurde gefunden.
„not_found“ heißt nur: die Heuristik (minorminer) hat in diesem Seed im Zeitlimit keines gefunden – kein Beweis.
"""
from __future__ import annotations

import time

import dimod
import minorminer
import networkx as nx

from .common import blank_record

TIMEOUT_S = 60.0  # je Lauf (ein Seed)


def source_graph(bqm: dimod.BinaryQuadraticModel) -> nx.Graph:
    """Wechselwirkungsgraph; alle Variablen zuerst als Knoten, damit auch Variablen ohne Kopplung eingebettet werden."""
    g = nx.Graph()
    g.add_nodes_from(bqm.variables)
    g.add_edges_from(bqm.quadratic)
    return g


def is_valid_embedding(emb: dict, source: nx.Graph, target: nx.Graph) -> bool:
    """Ketten nicht leer, paarweise disjunkt, in sich zusammenhängend, und jede Kante der Quelle hat einen Koppler zwischen den Ketten."""
    if set(emb) != set(source.nodes) or any(not c for c in emb.values()):
        return False
    used: set = set()
    for chain in emb.values():
        if used & set(chain) or not set(chain) <= set(target.nodes) or not nx.is_connected(target.subgraph(chain)):
            return False
        used |= set(chain)
    owner = {q: v for v, chain in emb.items() for q in chain}
    cover = {frozenset((owner[a], owner[b])) for a, b in target.subgraph(used).edges}
    return all(frozenset(e) in cover for e in source.edges)


def map_embedding(hardware: str, bqm: dimod.BinaryQuadraticModel, seed: int, target: nx.Graph, timeout: float = TIMEOUT_S) -> dict:
    """Ein Embedding-Lauf (ein Seed) → ein Datensatz im gemeinsamen Schema."""
    rec = blank_record(hardware, bqm, seed)
    if bqm.num_variables > target.number_of_nodes():  # hartes Limit, der Embedder läuft gar nicht erst
        rec["status"] = "exceeds_limit"
        return rec
    if bqm.num_variables == 0:  # nichts einzubetten
        rec.update(status="mapped", physical_qubits=0, max_chain=0, mean_chain=0.0)
        return rec
    source = source_graph(bqm)
    t0 = time.perf_counter()
    emb = minorminer.find_embedding(source, target, random_seed=seed, timeout=timeout)
    rec["runtime_s"] = round(time.perf_counter() - t0, 3)
    if emb and is_valid_embedding(emb, source, target):
        lengths = [len(c) for c in emb.values()]
        rec.update(status="mapped", physical_qubits=sum(lengths), max_chain=max(lengths), mean_chain=round(sum(lengths) / len(lengths), 4))
    return rec
