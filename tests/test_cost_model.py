"""Tests des Kostenmodells (encodings/cost_model.py) und der Kriterien-Auswahl.

Aufruf (aus dem Projektordner):  python -m pytest tests
"""
from __future__ import annotations

import itertools
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "encodings"))

from cost_model import CRITERIA, PARAMS, resolve_params  # noqa: E402
from formulations import build_instance, energy_qubo, energy_rules, one_hot  # noqa: E402
from webapp.data_service import DataService  # noqa: E402

RUN = "2026-10-09_12-59-39"


@pytest.fixture(scope="module")
def payload():
    service = DataService()
    if RUN not in service.run_ids():
        pytest.skip(f"Lauf {RUN} nicht vorhanden")
    return service.payload(RUN)


def best_valid_assignment(inst: dict) -> tuple[frozenset, float]:
    """Optimale gültige Zuweisung durch Ausprobieren (jeder Auftrag ein Roboter, kein Roboter doppelt)."""
    tasks = [t["transport_id"] for t in inst["tasks"]]
    options = {t: [v for v in inst["variables"] if v["task_id"] == t] for t in tasks}
    best = None
    for combo in itertools.product(*(options[t] for t in tasks)):
        robots = [v["robot_id"] for v in combo]
        if len(set(robots)) < len(robots):
            continue
        cost = sum(v["cost"] for v in combo)
        if best is None or cost < best[1]:
            best = (frozenset((v["task_id"], v["robot_id"]) for v in combo), cost)
    return best


def test_standard_ist_leerfahrt(payload):
    inst = build_instance(payload["tasks"], payload["fleet"], [1, 2])
    assert inst["criterion"]["key"] == "leerfahrt"
    assert all(v["cost"] == v["components"]["d_leer"] for v in inst["variables"])


@pytest.mark.parametrize("key", [c["key"] for c in CRITERIA])
def test_jedes_kriterium_regel_gleich_matrix(payload, key):
    """Für jedes Kriterium: Teile summieren sich zu c, und Regel-Energie == QUBO-Energie."""
    inst = build_instance(payload["tasks"], payload["fleet"], [1, 2], "alle", key)
    for v in inst["variables"]:
        assert v["cost"] == pytest.approx(sum(p["value"] for p in v["parts"]))
        assert v["cost"] >= 0
    form = one_hot(inst)
    for x in itertools.product([0, 1], repeat=form["n"]):
        assert energy_qubo(form, list(x), 80, 80) == pytest.approx(energy_rules(form, list(x), 80, 80))


def test_konstante_anteile_aendern_die_entscheidung_nicht(payload):
    """Fahrstrecke = Leerfahrt + Lastfahrt; die Lastfahrt ist je Auftrag gleich → gleiches Optimum."""
    ids = [1, 2]
    a = best_valid_assignment(build_instance(payload["tasks"], payload["fleet"], ids, "kandidaten", "leerfahrt"))
    b = best_valid_assignment(build_instance(payload["tasks"], payload["fleet"], ids, "kandidaten", "fahrstrecke"))
    assert a[0] == b[0] and b[1] > a[1]


def test_belegte_roboter_warten(payload):
    task = next(t for t in payload["tasks"] if 0 < t["n_available"] < 4)
    inst = build_instance(payload["tasks"], payload["fleet"], [task["transport_id"]], "alle", "erledigungszeit", {"t_rest": 77})
    busy = [v for v in inst["variables"] if not v["eligible"]]
    free = [v for v in inst["variables"] if v["eligible"]]
    assert busy and free
    assert all(v["components"]["t_warte"] == 77 for v in busy)
    assert all(v["components"]["t_warte"] == 0 for v in free)


def test_verspaetung_nur_bei_ueberschreitung(payload):
    lax = build_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "verspaetung", {"soll": 10_000})
    tight = build_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "verspaetung", {"soll": 0})
    assert all(v["cost"] == 0 for v in lax["variables"])
    assert all(v["cost"] > 0 for v in tight["variables"])


def test_parameter_pruefung():
    p = resolve_params({"v": 0, "t_lade": -5})
    assert p["v"] == PARAMS["v"]["min"] and p["t_lade"] == 0
    with pytest.raises(ValueError):
        resolve_params({"gibtsnicht": 1})
    with pytest.raises(ValueError):
        resolve_params({"v": "schnell"})


def test_api_kriterium(payload):
    from fastapi.testclient import TestClient

    from webapp.server import create_app

    client = TestClient(create_app())
    url = f"/api/runs/{RUN}/one-hot"
    ok = client.get(url, params={"tasks": "1,2", "kriterium": "energie", "params": '{"f_last": 2}'})
    assert ok.status_code == 200
    body = ok.json()
    assert body["instance"]["criterion"]["key"] == "energie" and body["instance"]["params"]["f_last"] == 2
    assert {c["key"] for c in body["catalog"]["criteria"]} >= {"leerfahrt", "erledigungszeit", "energie"}
    assert client.get(url, params={"tasks": "1,2", "kriterium": "makespan"}).status_code == 400
    assert client.get(url, params={"tasks": "1,2", "params": "[1,2]"}).status_code == 400
