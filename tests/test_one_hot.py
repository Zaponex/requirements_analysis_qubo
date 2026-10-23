"""Tests der One-Hot-Formulierung (encodings/formulations.py) und des Website-Endpunkts.

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

from formulations import build_instance, energy_qubo, energy_rules, one_hot  # noqa: E402
from webapp.data_service import DataService  # noqa: E402

RUN = "2026-10-09_12-59-39"


@pytest.fixture(scope="module")
def payload():
    service = DataService()
    if RUN not in service.run_ids():
        pytest.skip(f"Lauf {RUN} nicht vorhanden")
    return service.payload(RUN)


def states(n: int):
    return itertools.product([0, 1], repeat=n)


def test_beispiel_aus_dem_kapitel(payload):
    """Gleiche Zahlen wie encodings/one_hot/README.md: Kosten, Minimum, Kopplungen."""
    inst = build_instance(payload["tasks"], payload["fleet"], [1, 2])
    costs = {(v["task_id"], v["robot_id"]): v["cost"] for v in inst["variables"]}
    assert [costs[(1, r)] for r in (61, 62, 63, 64)] == [35, 10, 18, 49]
    assert [costs[(2, r)] for r in (61, 62, 63, 64)] == [29, 8, 24, 43]

    form = one_hot(inst)
    assert form["n"] == 8
    assert sum(1 for e in form["entries"] if e["i"] != e["j"]) == 16
    best = min(states(form["n"]), key=lambda x: energy_qubo(form, list(x), 50, 50))
    chosen = {(inst["variables"][i]["task_id"], inst["variables"][i]["robot_id"]) for i, b in enumerate(best) if b}
    assert chosen == {(1, 63), (2, 62)}
    assert energy_qubo(form, list(best), 50, 50) == 26

    # Strafe zu klein → „niemand fährt“ (alle Schalter aus) ist billiger
    worst_case = min(states(form["n"]), key=lambda x: energy_qubo(form, list(x), 5, 50))
    assert sum(worst_case) == 0


@pytest.mark.parametrize("mode", ["kandidaten", "alle"])
def test_regeln_und_matrix_stimmen_ueberein(payload, mode):
    """Für jeden Moment mit mehreren Anfragen: Regel-Energie == QUBO-Energie für alle Zustände."""
    by_time: dict[float, list[int]] = {}
    for t in payload["tasks"]:
        by_time.setdefault(t["time"], []).append(t["transport_id"])
    groups = [ids[:3] for ids in by_time.values() if len(ids) >= 2]
    assert groups
    for ids in groups:
        form = one_hot(build_instance(payload["tasks"], payload["fleet"], ids, mode))
        if form["n"] > 12:
            continue
        for x in states(form["n"]):
            for A, B in ((50, 50), (5, 80), (0, 0)):
                assert energy_qubo(form, list(x), A, B) == pytest.approx(energy_rules(form, list(x), A, B))


def test_kandidaten_modus_laesst_belegte_roboter_weg(payload):
    task = next(t for t in payload["tasks"] if 0 < t["n_eligible"] < 4)
    cand = build_instance(payload["tasks"], payload["fleet"], [task["transport_id"]], "kandidaten")
    alle = build_instance(payload["tasks"], payload["fleet"], [task["transport_id"]], "alle")
    assert len(cand["variables"]) == task["n_eligible"]
    assert len(alle["variables"]) == len(alle["robots"])


def test_ungueltige_eingaben(payload):
    with pytest.raises(ValueError):
        build_instance(payload["tasks"], payload["fleet"], [], "kandidaten")
    with pytest.raises(ValueError):
        build_instance(payload["tasks"], payload["fleet"], list(range(1, 9)), "kandidaten")
    with pytest.raises(ValueError):
        build_instance(payload["tasks"], payload["fleet"], [99999], "kandidaten")


def test_api_endpunkt(payload):
    from fastapi.testclient import TestClient

    from webapp.server import create_app

    client = TestClient(create_app())
    ok = client.get(f"/api/runs/{RUN}/one-hot", params={"tasks": "1,2"})
    assert ok.status_code == 200
    body = ok.json()
    assert body["formulation"]["n"] == 8 and len(body["instance"]["tasks"]) == 2
    assert client.get(f"/api/runs/{RUN}/one-hot", params={"tasks": "1,x"}).status_code == 400
    assert client.get(f"/api/runs/{RUN}/one-hot", params={"tasks": "1,2,3,4,5,6,7"}).status_code == 400
    assert client.get("/api/runs/gibtsnicht/one-hot", params={"tasks": "1"}).status_code == 404
