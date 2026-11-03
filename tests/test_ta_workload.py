"""Tests der Lastverteilung in der TA (encodings/workload.py) und der Endpunkte /ta/one-hot, /ta/domain-wall, /ta/binary.

H = H_obj + A·H_pen + B·H_WB,  H_obj = Σ c x,  H_WB = Σ_r (L_r,0 + Σ_t c_tr x_tr)² – One-Hot, Domain Wall und Binary.

Aufruf (aus dem Projektordner):  python -m pytest tests
"""
from __future__ import annotations

import itertools
import math
import random
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "encodings"))

from formulations import coefficient, couplings, energy_qubo, honest_aux  # noqa: E402
from webapp.data_service import DataService  # noqa: E402
from workload import (  # noqa: E402
    ENCODINGS, best_plan, bound_value, build_wb_instance, decode_wb, energy_rules_wb, loads, recommend_A, wb_default_weights,
    wb_formulation, wb_plans, wb_sizes, weight_bound, x_values,
)

RUN = "2026-10-22_17-56-58"  # mit Lebenslauf (ASSIGNED …) – nötig für die Vorlast „aus Status“ und „aus dem Log“


@pytest.fixture(scope="module")
def payload():
    service = DataService()
    if RUN not in service.run_ids():
        pytest.skip(f"Lauf {RUN} nicht vorhanden")
    return service.payload(RUN)


def wb(payload, tasks, robots=None, variables="kandidaten", measure="zeit", parts=None, vorlast="status"):
    return build_wb_instance(payload["tasks"], payload["fleet"], tasks, robots, variables, measure, parts, vorlast)


def q_min(form: dict, A: float, B: float, M: float = 0.0) -> tuple[float, list[int]]:
    """Minimum der QUBO durch Aufzählen aller 2^n Zustände."""
    n = form["n"]
    Q = np.zeros((n, n))
    for e in form["entries"]:
        Q[e["i"], e["j"]] += coefficient(e, A, B, M)
    X = ((np.arange(2 ** n)[:, None] >> np.arange(n)) & 1).astype(float)
    E = np.einsum("ki,ij,kj->k", X, Q, X) + coefficient(form["const"], A, B, M)
    k = int(np.argmin(E))
    return float(E[k]), [int(v) for v in X[k]]


@pytest.mark.parametrize("encoding", ENCODINGS)
def test_qubo_equals_rules(payload, encoding):
    """xᵀQx + Konstante = H_obj + A·H_pen + B·H_WB für zufällige Zustände (Binary: Hilfsbits ehrlich)."""
    inst = wb(payload, [1, 2, 3, 4], [61, 62, 63])
    form = wb_formulation(inst, encoding)
    rng = random.Random(3)
    for _ in range(300):
        b = honest_aux(form, [rng.randint(0, 1) for _ in range(form["n"])])
        A, B, M = rng.uniform(1, 400), rng.uniform(0, 0.05), rng.uniform(1, 3000)
        assert energy_qubo(form, b, A, B, M) == pytest.approx(energy_rules_wb(form, inst, b, A, B), abs=1e-6)


def test_one_hot_wb_couplings_like_column_rule(payload):
    """H_WB koppelt genau die Paare am selben Roboter: mit der Zeilenregel T·C(R, 2) + R·C(T, 2) Kopplungen."""
    for T, R in [(2, 2), (3, 3), (4, 3), (5, 2)]:
        rows = wb_sizes(R, T)
        oh = rows[T - 1]["one_hot"]
        assert oh["n"] == T * R
        assert oh["couplings"] == T * math.comb(R, 2) + R * math.comb(T, 2)
        dw = rows[T - 1]["domain_wall"]
        assert dw["n"] == T * (R - 1)
        assert dw["couplings"] == T * max(0, R - 2) + math.comb(T, 2) * max(0, 3 * R - 5)


def test_binary_aux_per_code_and_full_coupling():
    """Binary: Hilfsbits nur innerhalb eines Codes (≤ 2^K − K − 1 je Auftrag); bei R = 3 ist der Graph vollständig."""
    for R in (3, 4, 5):
        K = math.ceil(math.log2(R))
        for row in wb_sizes(R, 4):
            b = row["binary"]
            T = row["T"]
            assert b["aux"] <= T * (2 ** K - K - 1)
            assert b["max_degree"] == (2 * K if T > 1 else K)
    row = wb_sizes(3, 4)[3]
    assert row["binary"]["couplings"] == math.comb(row["binary"]["n"], 2)


def test_wb_square_expansion(payload):
    """One-Hot: Diagonale B·(c² + 2·L₀·c), Kopplung am selben Roboter 2B·c·c′, Konstante B·L₀²."""
    inst = wb(payload, [6, 7, 8], None, "alle", vorlast="pauschal")
    assert any(r["load0"] > 0 for r in inst["robots"])
    form = wb_formulation(inst, "one_hot")
    L0 = {r["robot_id"]: r["load0"] for r in inst["robots"]}
    vs = inst["variables"]
    for e in form["entries"]:
        wb_part = sum(p.get("B", 0.0) for p in e["parts"] if p["kind"] == "last")
        vi, vj = vs[e["i"]], vs[e["j"]]
        if e["i"] == e["j"]:
            assert wb_part == pytest.approx(vi["cost"] ** 2 + 2 * L0[vi["robot_id"]] * vi["cost"])
        elif vi["robot_id"] == vj["robot_id"]:
            assert wb_part == pytest.approx(2 * vi["cost"] * vj["cost"])
        else:
            assert wb_part == 0
    assert form["const"]["B"] == pytest.approx(sum(v * v for v in L0.values()))


def test_vorlast_modes(payload):
    """Vorlast nur für belegte Roboter; „aus dem Log“ = tatsächliche Restdauer, sonst aus Status oder pauschal."""
    for mode in ("keine", "pauschal", "status", "log"):
        inst = wb(payload, [6, 7], None, "alle", vorlast=mode)
        for r in inst["robots"]:
            if mode == "keine" or r["available"]:
                assert r["load0"] == 0
            else:
                assert r["load0"] > 0
        if mode == "log":
            t0 = inst["snapshot"]["time"]
            by_id = {t["transport_id"]: t for t in payload["tasks"]}
            for r in inst["robots"]:
                if r["load0_source"] == "log":
                    assert r["load0"] == pytest.approx(by_id[r["current_task"]]["t_completed"] - t0)


def test_parts_and_measures(payload):
    """Ohne Anfahrt ist c_tr für alle Roboter gleich – die Gesamtlast ist dann für jeden gültigen Plan dieselbe."""
    inst = wb(payload, [1, 2, 3], [61, 62, 63], parts=["beladen", "lastfahrt", "entladen"])
    for t in inst["tasks"]:
        assert len({v["cost"] for v in inst["variables"] if v["task_id"] == t["transport_id"]}) == 1
    assert len({p["obj"] for p in wb_plans(inst)}) == 1
    for measure in ("strecke", "energie"):
        inst = wb(payload, [1, 2], [61, 62], measure=measure)
        assert inst["measure"]["key"] == measure and all(v["cost"] > 0 for v in inst["variables"])
    with pytest.raises(ValueError):
        wb(payload, [1, 2], [61, 62], parts=[])


def test_weight_bound_follows_B(payload):
    """Die Schranke für A wächst linear mit B; bei B = 0 ist sie wie ohne Lastausgleich (billigster bzw. Spannweite)."""
    inst = wb(payload, [1, 2, 3], [61, 62, 63])
    oh = weight_bound(inst, wb_formulation(inst, "one_hot"))
    cheapest = max(min(v["cost"] for v in inst["variables"] if v["task_id"] == t["transport_id"]) for t in inst["tasks"])
    assert bound_value(oh, 0) == pytest.approx(cheapest)
    assert bound_value(oh, 0.02) > bound_value(oh, 0.01) > bound_value(oh, 0)
    dw = weight_bound(inst, wb_formulation(inst, "domain_wall"))
    spread = max(max(c) - min(c) for c in ([v["cost"] for v in inst["variables"] if v["task_id"] == t["transport_id"]] for t in inst["tasks"]))
    assert bound_value(dw, 0) == pytest.approx(spread)


def _moments(payload, limit: int):
    """Echte Momente: Startanfrage, T = 2 … 4 Aufträge in 60 s, verschiedene Robotermengen R."""
    tasks = payload["tasks"]
    fleet_ids = sorted({r["robot_id"] for r in payload["fleet"]})
    out = []
    for k in range(0, len(tasks), 3):
        t0 = tasks[k]["time"]
        window = [t["transport_id"] for t in tasks[k:] if t["time"] <= t0 + 60][:4]
        for T in (2, 3, 4):
            if len(window) < T:
                continue
            for R in (2, 3, 4):
                out.append((window[:T], fleet_ids[:R]))
    random.Random(5).shuffle(out)
    return out[:limit]


@pytest.mark.parametrize("encoding", ENCODINGS)
def test_recommended_weights_give_best_plan(payload, encoding):
    """Brute Force an echten Momenten: Mit der Empfehlung (A aus der Schranke, M aus dem Lügengewinn) ist das Minimum der
    QUBO gültig und gleich dem besten Plan durch Aufzählen – für B = 0, die Empfehlung und das Dreifache."""
    checked = 0
    for tasks, robots in _moments(payload, 40):
        for variables, vorlast in (("kandidaten", "status"), ("alle", "status"), ("alle", "log")):
            try:
                inst = wb(payload, tasks, robots, variables, vorlast=vorlast)
            except ValueError:
                continue  # kein freier Roboter
            form = wb_formulation(inst, encoding)
            plans = wb_plans(inst)
            if not plans or form["n"] > 16 or form["n"] == 0:
                continue
            w = wb_default_weights(inst, form)
            for B in (0.0, w["B"], 3 * w["B"]):
                A = recommend_A(w["bound"], B)
                M = w["M"] if B == w["B"] else (wb_default_weights_at(inst, form, A, B) if form["aux"] else 0.0)
                E, b = q_min(form, A, B, M)
                dec = decode_wb(form, inst, b)
                bp = best_plan(plans, B)
                assert dec["valid"], (tasks, robots, variables, vorlast, B, dec["issues"])
                assert E == pytest.approx(bp["obj"] + B * bp["wb"], abs=1e-6)
                checked += 1
    assert checked > 30


def wb_default_weights_at(inst, form, A, B):
    from formulations import binary_lie_gains, nice_ceil
    gains = binary_lie_gains(form, A, B)
    return nice_ceil(max(10.0, 1.1 * max(gains.values(), default=0.0)))


def test_loads_and_x_values(payload):
    """Bester Plan als Bits: x = 1 genau beim gewählten Roboter, Lasten = Vorlast + Summe der c."""
    inst = wb(payload, [6, 7, 8], None, "alle", vorlast="status")
    for encoding in ENCODINGS:
        form = wb_formulation(inst, encoding)
        w = wb_default_weights(inst, form)
        if form["n"] > 16:
            continue
        _, b = q_min(form, w["A"], w["B"], w["M"])
        x = x_values(form, b)
        L = loads(inst, x)
        dec = decode_wb(form, inst, b)
        for r in inst["robots"]:
            mine = [v for v in inst["variables"] if v["robot_id"] == r["robot_id"] and dec["assignment"].get(v["task_id"]) == r["robot_id"]]
            assert L[r["robot_id"]] == pytest.approx(r["load0"] + sum(v["cost"] for v in mine))


def test_endpoints(payload):
    from fastapi.testclient import TestClient
    from webapp.server import create_app

    client = TestClient(create_app())
    for enc in ("one-hot", "domain-wall", "binary"):
        res = client.get(f"/api/runs/{RUN}/ta/{enc}", params={"tasks": "1,2,3", "robots": "61,62", "last": "zeit",
                                                              "anteile": "anfahrt,lastfahrt", "vorlast": "status"})
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["formulation"]["n"] > 0
        assert data["instance"]["load_parts"] == ["anfahrt", "lastfahrt"]
        assert {"A", "B", "bound"} <= set(data["weights"])
        assert len(data["sizes"]) == 6
    res = client.get(f"/api/runs/{RUN}/ta/one-hot", params={"tasks": "1,2", "last": "gewicht"})
    assert res.status_code == 400
