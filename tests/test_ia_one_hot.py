"""Tests der One-Hot-Formulierung der Sofortzuweisung (formulations.one_hot_ia) und des Endpunkts /ia/one-hot.

Drei Fälle je nach T : R (H = H_obj + A·H_pen1 + B·H_pen2):
    T = R: H_pen1 + H_pen2,   T < R: H_pen1 + H'_pen2,   T > R: H'_pen1 + H_pen2

Aufruf (aus dem Projektordner):  python -m pytest tests
"""
from __future__ import annotations

import itertools
import math
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "encodings"))

from cost_model import IA_CRITERIA  # noqa: E402
from formulations import (  # noqa: E402
    build_ia_instance, coefficient, energy_qubo, energy_rules, ia_default_weights, ia_valid_plans, one_hot_ia,
)
from webapp.data_service import DataService  # noqa: E402

RUN = "2026-10-09_12-59-39"
ROBOTS = [61, 62, 63, 64]  # bei Anfrage #1 (t = 0) alle frei und für alle Bereiche zuständig


@pytest.fixture(scope="module")
def payload():
    service = DataService()
    if RUN not in service.run_ids():
        pytest.skip(f"Lauf {RUN} nicht vorhanden")
    return service.payload(RUN)


def ia(payload, tasks, robots=None, criterion="fahrstrecke", variables="kandidaten"):
    return build_ia_instance(payload["tasks"], payload["fleet"], tasks, robots, variables, criterion)


def q_min(form: dict, A: float, B: float) -> tuple[float, np.ndarray]:
    """Minimum der QUBO durch Aufzählen aller 2^n Zustände."""
    n = form["n"]
    Q = np.zeros((n, n))
    for e in form["entries"]:
        Q[e["i"], e["j"]] += coefficient(e, A, B)
    X = ((np.arange(2 ** n)[:, None] >> np.arange(n)) & 1).astype(float)
    E = np.einsum("ki,ij,kj->k", X, Q, X) + coefficient(form["const"], A, B)
    k = int(np.argmin(E))
    return float(E[k]), X[k]


@pytest.mark.parametrize("tasks, robots, case", [
    ([1, 2, 3], [61, 62, 63], "T=R"),
    ([1, 2], [61, 62, 63], "T<R"),
    ([1, 2, 3, 4], [61, 62], "T>R"),
])
def test_fall_und_struktur(payload, tasks, robots, case):
    """Fall aus T : R; Kopplungen T·C(R, 2) + R·C(T, 2) in jedem Fall; Diagonale und Konstante je nach Form."""
    inst = ia(payload, tasks, robots)
    form = one_hot_ia(inst)
    T, R = len(tasks), len(robots)
    assert inst["case"] == form["case"] == case and form["n"] == T * R
    assert sum(1 for e in form["entries"] if e["i"] != e["j"]) == T * math.comb(R, 2) + R * math.comb(T, 2)
    ex = form["exact"]
    for e in form["entries"]:
        if e["i"] == e["j"]:
            assert e["A"] == (-1.0 if ex["zeile"] else 0.0) and e["B"] == (-1.0 if ex["spalte"] else 0.0)
        else:
            assert e["A"] + e["B"] in ({2.0} if ex["zeile"] and ex["spalte"] else {1.0, 2.0})
    assert form["const"]["A"] == (T if ex["zeile"] else 0) and form["const"]["B"] == (R if ex["spalte"] else 0)


@pytest.mark.parametrize("tasks, robots", [([1, 2], [61, 62]), ([1, 2], [61, 62, 63]), ([1, 2, 3], [61, 62])])
def test_regeln_gleich_qubo(payload, tasks, robots):
    """Strafform (Regeln) und QUBO-Form ergeben für jedes x dieselbe Energie – in allen drei Fällen."""
    form = one_hot_ia(ia(payload, tasks, robots, "betriebskosten"))
    for x in itertools.product([0, 1], repeat=form["n"]):
        assert energy_qubo(form, list(x), 37, 53) == pytest.approx(energy_rules(form, list(x), 37, 53))


def test_gueltige_plaene_zaehlen(payload):
    """T ≤ R: R!/(R−T)! Pläne (jeder Auftrag ein eigener Roboter); T > R: T!/(T−R)!."""
    assert len(ia_valid_plans(ia(payload, [1, 2, 3, 4], ROBOTS))) == 24
    assert len(ia_valid_plans(ia(payload, [1, 2], ROBOTS))) == 12
    assert len(ia_valid_plans(ia(payload, [1, 2, 3, 4, 5], [61, 62]))) == 20
    plans = ia_valid_plans(ia(payload, [1, 2, 3], [61, 62]))
    assert all(len(p["assignment"]) == 2 and len(set(p["assignment"].values())) == 2 for p in plans)
    assert plans == sorted(plans, key=lambda p: p["value"])


def _moments(payload):
    """Echte Momente: je Startanfrage die nächsten T Anfragen und jede Robotermenge (bis 12 Schalter)."""
    tasks = payload["tasks"]
    for k0 in range(0, len(tasks), max(1, len(tasks) // 8)):
        for T in (1, 2, 3, 4, 5):
            ids = [t["transport_id"] for t in tasks[k0:k0 + T]]
            if len(ids) < T:
                continue
            try:
                pool = [r["robot_id"] for r in ia(payload, ids)["robots"]]
            except ValueError:  # kein freier Roboter
                continue
            for R in range(1, len(pool) + 1):
                for robots in itertools.combinations(pool, R):
                    if T * R <= 12:
                        yield ids, list(robots)


def test_empfohlene_gewichte_ergeben_den_besten_plan(payload):
    """A = B = 1,5·c_max (und schon 1,01·c_max): Das QUBO-Minimum ist der beste gültige Plan – alle Fälle und Kriterien."""
    seen = set()
    for ids, robots in _moments(payload):
        for crit in IA_CRITERIA:
            inst = ia(payload, ids, robots, crit)
            form = one_hot_ia(inst)
            best = ia_valid_plans(inst)[0]["value"]
            w = ia_default_weights(inst)
            assert q_min(form, w["A"], w["B"])[0] == pytest.approx(best)
            tight = 1.01 * max(w["c_max"], 1e-9)
            assert q_min(form, tight, tight)[0] == pytest.approx(best)
            seen.add(form["case"])
    assert seen == {"T=R", "T<R", "T>R"}


def test_zu_kleine_gewichte_brechen_regeln_bei_ungleichem_verhaeltnis(payload):
    """Bei T ≠ R belohnt nur eine Regel das Einschalten: 0,75·c_max lässt Aufträge bzw. Roboter liegen."""
    broken = {"T<R": 0, "T>R": 0, "T=R": 0}
    for ids, robots in _moments(payload):
        inst = ia(payload, ids, robots, "bearbeitungszeit")
        form = one_hot_ia(inst)
        low = 0.75 * ia_default_weights(inst)["c_max"]
        if q_min(form, low, low)[0] < ia_valid_plans(inst)[0]["value"] - 1e-6:
            broken[form["case"]] += 1
    assert broken["T<R"] > 0 and broken["T>R"] > 0


def test_wartezeit(payload):
    """Waiting Time = Alter der Anfrage + Warten auf den Roboter + Anfahrt (bis zur Abholung)."""
    inst = build_ia_instance(payload["tasks"], payload["fleet"], [1, 2], None, "alle", "wartezeit", {"t_rest": 40, "v": 2})
    for v in inst["variables"]:
        c = v["components"]
        assert [p["name"] for p in v["parts"]] == ["Alter der Anfrage", "Warten", "Anfahrt"]
        assert v["cost"] == pytest.approx(c["alter"] + c["t_warte"] + c["d_leer"] / 2)


def test_robotermenge(payload):
    inst = ia(payload, [1, 2], [64, 62])
    assert [r["robot_id"] for r in inst["robots"]] == [62, 64] and len(inst["fleet"]) == 4
    assert [v["index"] for v in inst["variables"]] == list(range(4))
    assert {v["robot_id"] for v in inst["variables"]} == {62, 64}
    with pytest.raises(ValueError):
        ia(payload, [1, 2], [99])


def test_api(payload):
    from fastapi.testclient import TestClient

    from webapp.server import create_app

    client = TestClient(create_app())
    url = f"/api/runs/{RUN}/ia/one-hot"
    body = client.get(url, params={"tasks": "1,2,3", "robots": "61,62", "kriterium": "wartezeit"}).json()
    assert body["instance"]["case"] == "T>R" and body["formulation"]["case"] == "T>R"
    assert [c["key"] for c in body["catalog"]["criteria"]] == IA_CRITERIA
    assert [o["key"] for o in body["overview"]] == IA_CRITERIA and body["n_valid"] == 6
    assert body["best"] == next(o["best"] for o in body["overview"] if o["key"] == "wartezeit")
    assert client.get(url, params={"tasks": "1,2"}).json()["instance"]["case"] == "T<R"  # alle 4 freien Roboter
    assert client.get(url, params={"tasks": "1,2", "kriterium": "leerfahrt"}).status_code == 400
    assert client.get(url, params={"tasks": "1,2", "robots": "a,b"}).status_code == 400
