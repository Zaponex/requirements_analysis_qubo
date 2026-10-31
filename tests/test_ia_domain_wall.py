"""Tests der Domain-Wall-Formulierung der Sofortzuweisung (formulations.domain_wall_ia) und des Endpunkts /ia/domain-wall.

Die Kette liegt auf der Seite, die „genau eins“ braucht (H = H_obj_DW + A·H_pen_DW + B·Querregel):
    T = R: Kette je Auftrag + H_pen2,   T < R: Kette je Auftrag + H'_pen2,   T > R: Kette je Roboter + H'_pen1

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
    _lin_eval, build_ia_instance, coefficient, decode_domain_wall_ia, domain_wall_ia, energy_qubo, energy_rules_dw_ia,
    ia_dw_default_weights, ia_valid_plans,
)
from webapp.data_service import DataService  # noqa: E402

RUN = "2026-10-09_12-59-39"


@pytest.fixture(scope="module")
def payload():
    service = DataService()
    if RUN not in service.run_ids():
        pytest.skip(f"Lauf {RUN} nicht vorhanden")
    return service.payload(RUN)


def ia(payload, tasks, robots=None, criterion="fahrstrecke", variables="kandidaten"):
    return build_ia_instance(payload["tasks"], payload["fleet"], tasks, robots, variables, criterion)


def states(n: int):
    return [list(x) for x in itertools.product([0, 1], repeat=n)]


def q_min(form: dict, A: float, B: float) -> tuple[float, list[int]]:
    """Minimum der QUBO durch Aufzählen aller 2^n Zustände."""
    n = form["n"]
    Q = np.zeros((n, n))
    for e in form["entries"]:
        Q[e["i"], e["j"]] += coefficient(e, A, B)
    X = ((np.arange(2 ** n)[:, None] >> np.arange(n)) & 1).astype(float)
    E = np.einsum("ki,ij,kj->k", X, Q, X) + coefficient(form["const"], A, B)
    k = int(np.argmin(E))
    return float(E[k]), [int(v) for v in X[k]]


@pytest.mark.parametrize("tasks, robots, case, side", [
    ([1, 2, 3], [61, 62, 63], "T=R", "zeile"),
    ([1, 2], [61, 62, 63, 64], "T<R", "zeile"),
    ([1, 2, 3, 4, 5], [61, 62], "T>R", "spalte"),
])
def test_fall_kette_und_groesse(payload, tasks, robots, case, side):
    """Kette auf der „genau eins“-Seite: K Ketten der Länge L → K(L − 1) Qubits, K(L − 2) + C(K, 2)(3L − 5) Kopplungen."""
    form = domain_wall_ia(ia(payload, tasks, robots))
    T, R = len(tasks), len(robots)
    K, L = (T, R) if T <= R else (R, T)
    assert form["case"] == case and form["side"] == side and len(form["chains"]) == K
    assert form["n"] == K * (L - 1)
    couplings = sum(1 for e in form["entries"] if e["i"] != e["j"] and abs(coefficient(e, 30, 10)) > 1e-9)
    assert couplings == K * (L - 2) + math.comb(K, 2) * (3 * L - 5)


@pytest.mark.parametrize("tasks, robots", [([1, 2, 3], [61, 62, 63]), ([1, 2], [61, 62, 63]), ([1, 2, 3, 4], [61, 62])])
def test_regeln_gleich_qubo_und_teleskop(payload, tasks, robots):
    """Regelform = QUBO für jede Stellung; entlang jeder Kette ist Σ x = 1 – auch bei gebrochenen Ketten."""
    form = domain_wall_ia(ia(payload, tasks, robots, "betriebskosten"))
    for b in states(form["n"]):
        assert energy_qubo(form, b, 37, 53) == pytest.approx(energy_rules_dw_ia(form, b, 37, 53))
        for ch in form["chains"]:
            assert sum(_lin_eval(form["x_forms"][v], b) for v in ch["vars"]) == pytest.approx(1.0)


@pytest.mark.parametrize("tasks, robots", [([1, 2, 3], [61, 62, 63]), ([1, 2], [61, 62, 63, 64]), ([1, 2, 3, 4], [61, 62])])
def test_gueltige_stellungen_sind_die_gueltigen_plaene(payload, tasks, robots):
    """Jede gültige Bitstellung ist genau ein gültiger Plan der Sofortzuweisung – und umgekehrt."""
    inst = ia(payload, tasks, robots)
    form = domain_wall_ia(inst)
    plans = {tuple(sorted(p["assignment"].items())) for p in ia_valid_plans(inst)}
    found = set()
    for b in states(form["n"]):
        dec = decode_domain_wall_ia(form, b)
        if dec["valid"]:
            found.add(tuple(sorted(dict(dec["pairs"]).items())))
    assert found == plans


def _moments(payload):
    """Echte Momente: je Startanfrage die nächsten T Anfragen und jede Robotermenge (bis 12 Bits)."""
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
                    K, L = (T, R) if T <= R else (R, T)
                    if 0 < K * (L - 1) <= 12:
                        yield ids, list(robots)


def test_empfohlene_gewichte_ergeben_den_besten_plan(payload):
    """B = 1,5 × Spannweite, A = 3B: Das QUBO-Minimum ist gültig und der beste Plan – alle Fälle und Kriterien."""
    seen = set()
    for ids, robots in _moments(payload):
        for crit in IA_CRITERIA:
            inst = ia(payload, ids, robots, crit)
            form = domain_wall_ia(inst)
            w = ia_dw_default_weights(inst, form)
            E, b = q_min(form, w["A"], w["B"])
            assert decode_domain_wall_ia(form, b)["valid"]
            assert E == pytest.approx(ia_valid_plans(inst)[0]["value"])
            seen.add(form["case"])
    assert seen == {"T=R", "T<R", "T>R"}


def test_a_gleich_2b_reicht_nicht(payload):
    """Gegenbeispiel aus echten Daten: Mit A = 2B bricht Kette #23 – ihr x = −1 an R63 hebt eine Doppelbelegung auf."""
    inst = ia(payload, [22, 23, 24], [61, 62, 63, 64], "bearbeitungszeit", "alle")
    form = domain_wall_ia(inst)
    w = ia_dw_default_weights(inst, form)
    E, b = q_min(form, 2 * w["B"], w["B"])
    assert E < ia_valid_plans(inst)[0]["value"] - 1e-6
    issues = decode_domain_wall_ia(form, b)["issues"]
    assert "#23: Kette gebrochen" in issues and "R63: 2" in issues


def test_b_unter_der_spannweite_reicht_nicht(payload):
    """B muss die Spannweite übersteigen: Mit B = 0,9 × Spannweite fahren zwei Roboter Auftrag #3 (auch mit großem A)."""
    inst = ia(payload, [1, 2, 3], [61, 64], "bearbeitungszeit")
    form = domain_wall_ia(inst)
    s = ia_dw_default_weights(inst, form)["spread"]
    E, b = q_min(form, 10 * s, 0.9 * s)
    assert E < ia_valid_plans(inst)[0]["value"] - 1e-6
    assert decode_domain_wall_ia(form, b)["issues"] == ["#3: 2"]


def test_api(payload):
    from fastapi.testclient import TestClient

    from webapp.server import create_app

    client = TestClient(create_app())
    url = f"/api/runs/{RUN}/ia/domain-wall"
    body = client.get(url, params={"tasks": "1,2,3,4,5", "robots": "61,62", "kriterium": "fahrzeit"}).json()
    f = body["formulation"]
    assert f["case"] == "T>R" and f["side"] == "spalte" and f["n"] == 8
    assert body["weights"]["A"] == 3 * body["weights"]["B"] and body["one_hot"]["n"] == 10
    assert [o["key"] for o in body["overview"]] == IA_CRITERIA and body["n_valid"] == 20
    assert client.get(url, params={"tasks": "1,2", "kriterium": "leerfahrt"}).status_code == 400
    assert client.get(url, params={"tasks": "1,2", "robots": "x"}).status_code == 400
