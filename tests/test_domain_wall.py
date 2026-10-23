"""Tests der Domain-Wall-Formulierung (encodings/formulations.py: domain_wall & Co.).

Kernaussagen:
- Das Kapitel-Beispiel (encodings/domain_wall/README.md) wird exakt reproduziert.
- Regel-Energie == QUBO-Energie für alle Zustände.
- Für gültige Ketten ist der Kosten-Term genau die Summe der Zuweisungskosten (Teleskopsumme).
- Mit den Standardgewichten (A = 2B) ist das Minimum die beste gültige Zuweisung; mit A = B oft nicht.

Aufruf (aus dem Projektordner):  python -m pytest tests
"""
from __future__ import annotations

import itertools
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "encodings"))

from formulations import (  # noqa: E402
    DW_ORDERS, best_assignment, build_instance, coefficient, decode_domain_wall, domain_wall, dw_default_weights,
    energy_qubo, energy_rules_dw, one_hot,
)
from webapp.data_service import DataService  # noqa: E402

RUN = "2026-10-09_12-59-39"


@pytest.fixture(scope="module")
def payload():
    service = DataService()
    if RUN not in service.run_ids():
        pytest.skip(f"Lauf {RUN} nicht vorhanden")
    return service.payload(RUN)


def brute_min(form: dict, A: float, B: float) -> tuple[float, list[int]]:
    n = form["n"]
    Q = np.zeros((n, n))
    for e in form["entries"]:
        Q[e["i"], e["j"]] += coefficient(e, A, B)
    const = coefficient(form["const"], A, B)
    if n == 0:
        return const, []
    masks = np.arange(1 << n, dtype=np.int64)
    X = ((masks[:, None] >> np.arange(n)) & 1).astype(float)
    E = ((X @ Q) * X).sum(1) + const
    k = int(E.argmin())
    return float(E[k]), X[k].astype(int).tolist()


def test_kapitel_beispiel(payload):
    """Zahlen aus encodings/domain_wall/README.md: 6 Bits, 11 Kopplungen, Minimum 26, „jeder den nächsten“ 68."""
    inst = build_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "leerfahrt")
    form = domain_wall(inst)
    assert form["n"] == 6
    assert sum(1 for e in form["entries"] if e["i"] != e["j"]) == 11
    # Teleskopsumme für #1: 35 − 25 b1 + 8 b2 + 31 b3
    chain = next(c for c in form["chains"] if c["task_id"] == 1)
    assert chain["costs"] == [35, 10, 18, 49]
    diag = {e["i"]: e["c"] for e in form["entries"] if e["i"] == e["j"]}
    assert [diag[i] for i in chain["bits"]] == [-25, 8, 31]
    E, x = brute_min(form, 50, 50)
    assert E == 26 and decode_domain_wall(form, x)["assignment"] == {1: 63, 2: 62}
    assert energy_qubo(form, [1, 0, 0, 1, 0, 0], 50, 50) == 68  # beide fahren mit R62


@pytest.mark.parametrize("order", DW_ORDERS)
@pytest.mark.parametrize("mode", ["kandidaten", "alle"])
def test_regeln_und_matrix_stimmen_ueberein(payload, order, mode):
    for ids in ([1, 2], [1, 2, 3]):
        inst = build_instance(payload["tasks"], payload["fleet"], ids, mode, "erledigungszeit")
        form = domain_wall(inst, order)
        for x in itertools.product([0, 1], repeat=form["n"]):
            for A, B in ((50, 50), (7, 90), (0, 0)):
                assert energy_qubo(form, list(x), A, B) == pytest.approx(energy_rules_dw(form, list(x), A, B))


def test_gueltige_ketten_kosten_genau_die_zuweisung(payload):
    inst = build_instance(payload["tasks"], payload["fleet"], [1, 2, 3], "alle", "energie")
    form = domain_wall(inst, "kosten")
    cost = {(v["task_id"], v["robot_id"]): v["cost"] for v in inst["variables"]}
    checked = 0
    for x in itertools.product([0, 1], repeat=form["n"]):
        dec = decode_domain_wall(form, list(x))
        if len(dec["assignment"]) != len(form["chains"]):
            continue  # eine Kette ungültig
        expected = sum(cost[(t, r)] for t, r in dec["assignment"].items())
        # nur Kosten: A = B = 0
        assert energy_qubo(form, list(x), 0, 0) == pytest.approx(expected)
        checked += 1
    assert checked == 4 ** 3  # jede Kombination von Thermometer-Ketten


def test_standardgewichte_finden_die_beste_zuweisung():
    """Über echte Momente beider Läufe: A = 2B trifft immer, A = B nicht immer (δ = −1 an falschen Wänden)."""
    service = DataService()
    checked, failures_equal = 0, 0
    for run in service.run_ids():
        p = service.payload(run)
        by_time: dict[float, list[int]] = {}
        for t in p["tasks"]:
            by_time.setdefault(t["time"], []).append(t["transport_id"])
        for ids in [ids[:4] for ids in by_time.values() if len(ids) >= 2][:6]:
            for criterion in ("leerfahrt", "erledigungszeit", "energie"):
                inst = build_instance(p["tasks"], p["fleet"], ids, "alle", criterion)
                best = best_assignment(inst)
                if best is None:
                    continue
                form = domain_wall(inst)
                if form["n"] > 16:
                    continue
                w = dw_default_weights(inst)
                E, x = brute_min(form, w["A"], w["B"])
                dec = decode_domain_wall(form, x)
                assert dec["valid"] and E == pytest.approx(best["value"])
                E_eq, x_eq = brute_min(form, w["B"], w["B"])
                failures_equal += not (decode_domain_wall(form, x_eq)["valid"] and E_eq == pytest.approx(best["value"]))
                checked += 1
    assert checked >= 5
    assert failures_equal > 0  # der Grund für A = 2B


@pytest.mark.parametrize("ids", [[1, 2], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5]])
def test_kopplungen_wachsen_mit_konkurrierenden_auftraegen(payload, ids):
    """T Aufträge, alle R Roboter: Domain Wall T(R−2) + Paare·(3R−5), One-Hot T·R(R−1)/2 + R·Paare.

    Domain Wall spart je Auftrag ein Bit und in der Kette Kopplungen – aber zwei Ketten brauchen
    3R − 5 Kopplungen (One-Hot nur R). Bei R = 4 ist Domain Wall nur bis T = 3 sparsamer.
    """
    inst = build_instance(payload["tasks"], payload["fleet"], ids, "alle", "leerfahrt")
    T, R = len(ids), len(inst["robots"])
    pairs = T * (T - 1) // 2
    dw, oh = domain_wall(inst), one_hot(inst)
    couplings = lambda f: sum(1 for e in f["entries"] if e["i"] != e["j"])  # noqa: E731
    assert dw["n"] == oh["n"] - T  # ein Bit weniger je Auftrag
    assert couplings(dw) == T * (R - 2) + pairs * (3 * R - 5)
    assert couplings(oh) == T * R * (R - 1) // 2 + R * pairs
    assert (couplings(dw) < couplings(oh)) == (T <= 3)


def test_auftrag_ohne_roboter_ist_nicht_darstellbar(payload):
    task = next(t for t in payload["tasks"] if t["n_eligible"] == 0)
    inst = build_instance(payload["tasks"], payload["fleet"], [task["transport_id"]], "kandidaten", "leerfahrt")
    form = domain_wall(inst)
    assert form["unrepresentable"] == [task["transport_id"]]
    assert not decode_domain_wall(form, [])["valid"]


def test_api_endpunkt(payload):
    from fastapi.testclient import TestClient

    from webapp.server import create_app

    client = TestClient(create_app())
    ok = client.get(f"/api/runs/{RUN}/domain-wall", params={"tasks": "1,2", "kriterium": "leerfahrt"})
    assert ok.status_code == 200
    body = ok.json()
    assert body["formulation"]["n"] == 6 and body["one_hot"]["n"] == 8
    assert body["best"]["value"] == 26
    assert body["weights"]["A"] == 2 * body["weights"]["B"]
    assert client.get(f"/api/runs/{RUN}/domain-wall", params={"tasks": "1,2", "reihenfolge": "zufall"}).status_code == 400
