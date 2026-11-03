"""Gitterexport der Hardware-Abbildung (hw/): Qubit- und Kopplungszahlen der exportierten Instanzen stimmen mit den Zählungen aus
encodings/resources.py überein, isolierte Variablen bleiben im Graphen, die Gültigkeitsprüfung des Embeddings fängt Fehler."""
from __future__ import annotations

import sys
from pathlib import Path

import networkx as nx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hw import advantage_pegasus as ap  # noqa: E402
from hw import common  # noqa: E402
from hw.models import ENCODINGS, MODELS, ORDERS, analyse, build, fleet  # noqa: E402
import resources  # noqa: E402


@pytest.fixture(scope="module")
def exported(tmp_path_factory):
    path = tmp_path_factory.mktemp("hw") / "instances.json"
    common.export_instances(path)
    return common.load_instances(path)


def test_grid_covers_models_encodings_orders(exported):
    assert len(exported["instances"]) == len(MODELS) * len(ENCODINGS) * len(ORDERS)
    assert min(ORDERS) == 4 and max(ORDERS) == 18


def test_export_counts_match_resources(exported):
    """Exportierte Knoten und Kanten = Zählung des Reiters „Qubits & Kopplungen“ (resources.metrics), alle Instanzen bis n = 12;
    darüber nur die schnellen Kodierungen (Binary braucht bei n = 18 mehrere Sekunden je Instanz)."""
    for iid, inst in exported["instances"].items():
        assert len(inst["edges"]) == inst["couplings"]
        bqm = common.bqm_of(inst)
        assert bqm.num_variables == inst["qubits"] and bqm.num_interactions == inst["couplings"]  # isolierte Knoten bleiben erhalten
        if inst["n"] > 12 and inst["encoding"] == "BIN":
            continue
        cls, variant = MODELS[inst["model"]]
        m = resources.structure_metrics(cls, ENCODINGS[inst["encoding"]], variant, inst["n"], fleet(inst["n"]), valid=False)
        assert (inst["qubits"], inst["couplings"]) == (m["n"], m["couplings"]), iid


def test_isolated_variables_stay_in_the_graph():
    a = analyse(build("A", "DW", 4, 2))
    degree0 = sum(1 for v in a["bqm"].variables if a["bqm"].degree(v) == 0)
    g = ap.source_graph(a["bqm"])
    assert g.number_of_nodes() == a["n"] and sum(1 for v in g if g.degree(v) == 0) == degree0


def test_embedding_validation():
    target = nx.path_graph(6)
    source = nx.Graph([(0, 1), (1, 2)])
    assert ap.is_valid_embedding({0: [0], 1: [1], 2: [2]}, source, target)
    assert ap.is_valid_embedding({0: [0], 1: [1, 2], 2: [3]}, source, target)
    assert not ap.is_valid_embedding({0: [0], 1: [1], 2: [4]}, source, target)       # keine Kante zwischen den Ketten
    assert not ap.is_valid_embedding({0: [0], 1: [1, 3], 2: [4]}, source, target)    # Kette nicht zusammenhängend
    assert not ap.is_valid_embedding({0: [0], 1: [0], 2: [2]}, source, target)         # Ketten überlappen


def test_map_pegasus_small_and_limit():
    a = analyse(build("A", "OH", 4, 2))
    rec = ap.map_advantage_pegasus(a["bqm"], seed=0, timeout=3)
    assert rec["status"] == "mapped" and rec["physical_qubits"] >= a["n"] and rec["logical_qubits"] == a["n"]
    tiny = nx.path_graph(5)  # Zielgraph kleiner als die Zahl der logischen Qubits → hartes Limit, kein Embedder-Lauf
    assert ap.map_advantage_pegasus(a["bqm"], seed=0, timeout=3, target=tiny)["status"] == "exceeds_limit"


def test_hardware_tab_reads_results_only(tmp_path, monkeypatch, exported):
    """Reiter „Hardware“: liest nur results/<hardware>.json (hier ein Temp-Ordner), rechnet nichts, ohne Ergebnisse leer statt Fehler."""
    from fastapi.testclient import TestClient
    from webapp.server import create_app

    monkeypatch.setattr(common, "RESULTS", tmp_path)
    client = TestClient(create_app())
    assert client.get("/api/hardware").json()["hardware"] == []
    assert client.get("/api/hardware/abbildung").status_code == 404

    recs = []
    for iid in ("A-OH-4", "A-OH-6", "B-DW-4"):
        inst = exported["instances"][iid]
        for seed in (0, 1):
            r = ap.map_advantage_pegasus(common.bqm_of(inst), seed, timeout=2)
            r.update(model=inst["model"], encoding=inst["encoding"], n=inst["n"])
            recs.append(r)
    failed = {**recs[0], "n": 8, "status": "not_found", "physical_qubits": None, "max_chain": None, "mean_chain": None}
    recs += [failed, {**failed, "seed": 1}]
    common.write_json(common.results_path("advantage_pegasus"), {"hardware": "advantage_pegasus", "meta": {"seeds": 2, "timeout_s": 2.0}, "records": recs})

    hw = client.get("/api/hardware").json()["hardware"]
    assert [h["hardware"] for h in hw] == ["advantage_pegasus"] and hw[0]["records"] == len(recs)
    b = next(x for x in hw[0]["boundary"] if x["model"] == "A" and x["encoding"] == "OH")
    assert (b["last_mapped_n"], b["first_not_mapped_n"], b["first_not_mapped_status"]) == (6, 8, "not_found") and not b["mapped_again_later"]
    row = next(r for r in hw[0]["rows"] if r["model"] == "A" and r["n"] == 8)
    assert row["status"] == "not_found" and row["mapped_seeds"] == 0 and row["metric"] is None
    svg = client.get("/api/hardware/abbildung?schwarzweiss=false").json()["svg"]
    assert svg.lstrip().startswith("<?xml") and "<svg" in svg
    for path in ("/static/js/views/hardware.js", "/"):
        assert client.get(path).status_code == 200
    assert 'data-tab="hardware"' in client.get("/").text


def test_reach_and_reference_lines(tmp_path, monkeypatch):
    """Größtes abgebildetes Problem je Hardware und Modell (nur aus results/) und die Referenzlinien in der Trend-Abbildung."""
    from fastapi.testclient import TestClient
    from webapp.server import create_app

    monkeypatch.setattr(common, "RESULTS", tmp_path)

    def rec(model, enc, n, status, q, c):
        ok = status == "mapped"
        return {"hardware": "advantage_pegasus", "model": model, "encoding": enc, "n": n, "seed": 0, "logical_qubits": q, "couplings": c,
                "status": status, "physical_qubits": q if ok else None, "max_chain": 1 if ok else None, "mean_chain": 1.0 if ok else None,
                "two_qubit_gates": None, "depth": None, "runtime_s": 0.0}

    records = [rec("A", "OH", 4, "mapped", 8, 16), rec("A", "OH", 18, "mapped", 162, 2025), rec("A", "BIN", 16, "mapped", 120, 6564),
               rec("A", "BIN", 18, "not_found", 279, 35298), rec("B", "OH", 4, "mapped", 8, 16)]
    common.write_json(common.results_path("advantage_pegasus"), {"hardware": "advantage_pegasus", "meta": {"seeds": 1}, "records": records})

    a = common.reach("advantage_pegasus", "A")  # nicht abgebildete Instanzen (279 Qubits) zählen nicht
    assert (a["qubits"], a["qubits_at"], a["couplings"], a["couplings_at"]) == (162, "OH-18", 6564, "BIN-16")
    assert a["density"] == pytest.approx(6564 / (120 * 119 / 2))  # Dichte der abgebildeten Instanz mit den meisten Kopplungen
    assert common.reach("advantage_pegasus", "B")["qubits"] == 8
    assert common.reach("heron", "A") is None

    client = TestClient(create_app())
    on = client.post("/api/ressourcen/groessen", json={"cls": "IA", "ratio": "halb", "hardware_limits": True}).json()
    off = client.post("/api/ressourcen/groessen", json={"cls": "IA", "ratio": "halb", "hardware_limits": False}).json()
    assert a["complete"] is False  # 5 von 48 Läufen: Linie vorläufig
    assert [(x["label"], x["qubits"]) for x in on["limits"]] == [("Advantage (partial)", 162)] and off["limits"] == []
    dash = "stroke-dasharray: 3.5,1.12,0.7,1.12"  # Strich-Punkt der Referenzlinien (5, 1.6, 1, 1.6 × Linienstärke 0.7)
    assert dash in on["svg"] and dash not in off["svg"]


def test_zephyr_target_and_small_embedding(exported):
    from hw import advantage2_zephyr as zep

    m = zep.meta()
    assert (m["target_qubits"], m["target_couplers"], m["target_max_degree"]) == (4800, 45864, 20)  # idealer Z12, obere Schranke
    rec = zep.map_advantage2_zephyr(common.bqm_of(exported["instances"]["A-OH-4"]), seed=0, timeout=3)
    assert rec["hardware"] == "advantage2_zephyr" and rec["status"] == "mapped" and rec["physical_qubits"] >= rec["logical_qubits"]


def test_gate_based_counts_and_limit(exported):
    from hw import heron, nighthawk
    from hw.gate_based import map_gate_based

    bqm = common.bqm_of(exported["instances"]["A-OH-6"])  # 18 Qubits, 63 Kopplungen
    for mod, fn, qubits in ((heron, heron.map_heron, 156), (nighthawk, nighthawk.map_nighthawk, 120)):
        rec = fn(bqm, seed=0)
        assert rec["status"] == "mapped" and mod.meta()["target_qubits"] == qubits
        assert rec["two_qubit_gates"] >= 2 * rec["couplings"]  # jedes RZZ = 2 cz, Routing kommt dazu
        assert rec["routing_overhead"] == rec["two_qubit_gates"] - 2 * rec["couplings"] and rec["depth"] > 0
        assert fn(bqm, seed=0)["two_qubit_gates"] == rec["two_qubit_gates"]  # fester Seed → reproduzierbar
    assert nighthawk.meta()["target_couplers"] == 218  # IBM-Ankündigung
    assert heron.meta()["target_couplers"] == 176 and all(heron.meta()["same_coupling_map_as"].values())

    class Tiny:
        num_qubits = 5

    assert map_gate_based("tiny", bqm, 0, Tiny())["status"] == "exceeds_limit"  # hartes Limit, kein Transpilerlauf


def test_helios_counts_only(exported):
    from hw import helios

    small = helios.map_helios(common.bqm_of(exported["instances"]["B-OH-6"]), 0)
    assert small["status"] == "mapped" and small["two_qubit_gates"] == small["couplings"] and small["physical_qubits"] is None
    big = helios.map_helios(common.bqm_of(exported["instances"]["A-OH-18"]), 0)  # 162 > 98 Qubits
    assert big["status"] == "exceeds_limit" and helios.SEEDS == 1


def test_reference_label_without_partial_when_complete(tmp_path, monkeypatch):
    """Sind alle Läufe da (Gitter × Seeds), steht der Hardware-Name ohne „(partial)“ an der Referenzlinie."""
    from fastapi.testclient import TestClient
    from webapp.server import create_app

    monkeypatch.setattr(common, "RESULTS", tmp_path)
    records = [{"hardware": "advantage_pegasus", "model": m, "encoding": e, "n": n, "seed": 0, "logical_qubits": 2 * n, "couplings": 3 * n,
                "status": "mapped", "physical_qubits": 4 * n, "max_chain": 2, "mean_chain": 1.5, "two_qubit_gates": None, "depth": None,
                "runtime_s": 0.0} for m, e, n in common.grid()]
    common.write_json(common.results_path("advantage_pegasus"), {"hardware": "advantage_pegasus", "meta": {"seeds": 1}, "records": records})
    assert common.reach("advantage_pegasus", "A")["complete"] is True
    limits = TestClient(create_app()).post("/api/ressourcen/groessen", json={"cls": "TA", "ratio": "halb"}).json()["limits"]
    assert [x["label"] for x in limits] == ["Advantage"]
