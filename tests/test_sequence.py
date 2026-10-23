"""Tests der Zuweisung mit Reihenfolge (encodings/formulations.py: one_hot_sequence & Co.).

Kernaussagen:
- Für jeden gültigen Ablaufplan ist die QUBO-Energie genau die Summe nach dem Kriterium
  (Summe der Erledigungszeiten bzw. Arbeitszeiten) – die Positions-Hilfsvariablen bilden
  die Reihenfolge also exakt ab.
- Mit den Standard-Strafgewichten ist das QUBO-Minimum das exakte Optimum.
- K = 1 ist genau die Sofortzuweisung (One-Hot mit Kriterium Erledigungszeit).

Aufruf (aus dem Projektordner):  python -m pytest tests
"""
from __future__ import annotations

import itertools
import random
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "encodings"))

from formulations import (  # noqa: E402
    build_instance, build_sequence_instance, coefficient, decode_schedule, default_weights, energy_qubo,
    energy_rules, exact_optimum, one_hot, one_hot_sequence, simulate,
)
from webapp.data_service import DataService  # noqa: E402

RUN = "2026-10-09_12-59-39"


@pytest.fixture(scope="module")
def payload():
    service = DataService()
    if RUN not in service.run_ids():
        pytest.skip(f"Lauf {RUN} nicht vorhanden")
    return service.payload(RUN)


def brute_min(form: dict, A: float, B: float, D: float) -> tuple[float, list[int]]:
    """Minimum über alle 2^n Zustände (numpy, für n ≤ 20)."""
    n = form["n"]
    Q = np.zeros((n, n))
    for e in form["entries"]:
        Q[e["i"], e["j"]] += coefficient(e, A, B, D)
    const = coefficient(form["const"], A, B, D)
    best = (np.inf, None)
    chunk = 1 << min(n, 16)
    for start in range(0, 1 << n, chunk):
        masks = np.arange(start, start + chunk, dtype=np.int64)
        X = ((masks[:, None] >> np.arange(n)) & 1).astype(np.float64)
        E = ((X @ Q) * X).sum(1) + const
        k = int(E.argmin())
        if E[k] < best[0]:
            best = (float(E[k]), X[k].astype(int).tolist())
    return best


def all_schedules(inst: dict):
    """Alle gültigen Ablaufpläne mit höchstens K Aufträgen je Roboter."""
    task_ids = [t["transport_id"] for t in inst["tasks"]]
    options = {t: sorted({v["robot_id"] for v in inst["variables"] if v["task_id"] == t}) for t in task_ids}
    for robots in itertools.product(*(options[t] for t in task_ids)):
        groups: dict[int, list[int]] = {}
        for t, r in zip(task_ids, robots):
            groups.setdefault(r, []).append(t)
        if any(len(g) > inst["slots"] for g in groups.values()):
            continue
        for perms in itertools.product(*(itertools.permutations(g) for g in groups.values())):
            yield dict(zip(groups, (list(p) for p in perms)))


def bits_of(inst: dict, sequences: dict) -> list[int]:
    idx = {(v["task_id"], v["robot_id"], v["slot"]): v["index"] for v in inst["variables"]}
    x = [0] * len(inst["variables"])
    for r, seq in sequences.items():
        for k, t in enumerate(seq):
            x[idx[(t, r, len(seq) - k)]] = 1
    return x


def synthetic():
    """Zwei Roboter, drei Aufträge – so gelegt, dass eine Lücke in den Plätzen „billiger“ aussieht."""
    def task(i, px, py, dx, dy):
        d = abs(px - dx) + abs(py - dy)
        return {"transport_id": i, "time": 0.0, "task_area": None, "material_stage": "Roh", "from_entity": f"A{i}",
                "to_entity": f"B{i}", "from_entity_x": px, "from_entity_y": py, "to_entity_x": dx, "to_entity_y": dy,
                "path_steps": d, "manhattan": d}

    def robot(r, x, y):
        return {"transport_id": 1, "robot_id": r, "x": x, "y": y, "status": "IDLE", "available": True, "aor": [],
                "battery_percent": 50}

    return [task(1, 0, 0, 0, 30), task(2, 20, 0, 20, 30), task(3, 100, 0, 100, 5)], [robot(1, 10, 0), robot(2, 100, 2)]


def test_zwei_auftraege_nacheinander_von_hand(payload):
    """R62 fährt erst #1, dann #2: Erledigungszeiten von Hand nachgerechnet."""
    inst = build_sequence_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "erledigungszeit", 2)
    s0 = {(s["robot_id"], s["task_id"]): s["time"] for s in inst["setup"]["start"]}
    sb = {(s["from"], s["to"]): s["time"] for s in inst["setup"]["between"]}
    p = {t["transport_id"]: t["p"] for t in inst["tasks"]}
    c1 = s0[(62, 1)] + p[1]
    c2 = c1 + sb[(1, 2)] + p[2]  # #2 startet am Abgabeort von #1
    sim = simulate(inst, {62: [1, 2]})
    assert sim["total"] == pytest.approx(c1 + c2)
    # Platz von hinten: #1 zählt doppelt (es verzögert #2), #2 einfach
    assert sim["total"] == pytest.approx(2 * (s0[(62, 1)] + p[1]) + sb[(1, 2)] + p[2])

    form = one_hot_sequence(inst)
    x = bits_of(inst, {62: [1, 2]})
    assert energy_qubo(form, x, 999, 999, 999) == pytest.approx(c1 + c2)


@pytest.mark.parametrize("criterion", ["erledigungszeit", "bearbeitungszeit"])
@pytest.mark.parametrize("mode", ["kandidaten", "alle"])
def test_energie_ist_genau_die_summe_des_ablaufplans(payload, criterion, mode):
    """Für jeden gültigen Plan: QUBO-Energie == Summe der Erledigungs- bzw. Arbeitszeiten (Strafen = 0)."""
    for ids in ([1, 2], [1, 2, 3]):
        inst = build_sequence_instance(payload["tasks"], payload["fleet"], ids, mode, criterion, 2)
        form = one_hot_sequence(inst)
        n_checked = 0
        for seqs in all_schedules(inst):
            x = bits_of(inst, seqs)
            assert decode_schedule(inst, x)["valid"]
            assert energy_qubo(form, x, 77, 55, 33) == pytest.approx(simulate(inst, seqs)["total"])
            n_checked += 1
        assert n_checked > 0


def test_regeln_und_matrix_stimmen_ueberein(payload):
    """Für zufällige Zustände (auch ungültige): Regel-Energie == QUBO-Energie."""
    rng = random.Random(7)
    inst = build_sequence_instance(payload["tasks"], payload["fleet"], [1, 2, 3], "alle", "erledigungszeit", 3)
    form = one_hot_sequence(inst)
    for _ in range(400):
        x = [int(rng.random() < 0.25) for _ in range(form["n"])]
        for A, B, D in ((100, 200, 100), (5, 0, 40), (0, 0, 0)):
            assert energy_qubo(form, x, A, B, D) == pytest.approx(energy_rules(form, x, A, B, D))


def test_qubo_minimum_ist_das_exakte_optimum():
    """Über viele echte Momente beider Läufe: Minimum mit Standardgewichten == Aufzählung aller Pläne."""
    service = DataService()
    checked = 0
    for run in service.run_ids():
        p = service.payload(run)
        by_time: dict[float, list[int]] = {}
        for t in p["tasks"]:
            by_time.setdefault(t["time"], []).append(t["transport_id"])
        groups = [ids[:3] for ids in by_time.values() if len(ids) >= 2][:6]
        for ids in groups:
            for criterion in ("erledigungszeit", "bearbeitungszeit"):
                inst = build_sequence_instance(p["tasks"], p["fleet"], ids, "kandidaten", criterion, 2)
                form = one_hot_sequence(inst)
                if not 0 < form["n"] <= 18:
                    continue
                exact = exact_optimum(inst)
                w = default_weights(inst)
                E, x = brute_min(form, w["A"], w["B"], w["D"])
                if exact is None:  # mehr Aufträge als Plätze: dann muss eine Regel brechen
                    assert not decode_schedule(inst, x)["valid"]
                else:
                    assert decode_schedule(inst, x)["valid"]
                    assert E == pytest.approx(exact["value"])
                checked += 1
    assert checked >= 5


def test_ohne_lueckenregel_waere_eine_luecke_billiger():
    """Arbeitszeit-Kriterium: ohne D tun zwei Aufträge so, als starteten beide am Standort des Roboters."""
    tasks, fleet = synthetic()
    inst = build_sequence_instance(tasks, fleet, [1, 2, 3], "kandidaten", "bearbeitungszeit", 3)
    form = one_hot_sequence(inst)
    w = default_weights(inst)
    exact = exact_optimum(inst)

    E0, x0 = brute_min(form, w["A"], w["B"], 0)
    assert not decode_schedule(inst, x0)["valid"]
    assert E0 < exact["value"]  # „Schein-Optimum“ mit Lücke

    E, x = brute_min(form, w["A"], w["B"], w["D"])
    assert decode_schedule(inst, x)["valid"]
    assert E == pytest.approx(exact["value"])


def test_ein_platz_ist_die_sofortzuweisung(payload):
    """K = 1: gleiche Energie wie One-Hot mit Kriterium Erledigungszeit – für jeden Zustand."""
    ids = [1, 2]
    seq = build_sequence_instance(payload["tasks"], payload["fleet"], ids, "alle", "erledigungszeit", 1)
    ia = build_instance(payload["tasks"], payload["fleet"], ids, "alle", "erledigungszeit")
    f_seq, f_ia = one_hot_sequence(seq), one_hot(ia)
    assert f_seq["n"] == f_ia["n"]
    assert [(v["task_id"], v["robot_id"]) for v in seq["variables"]] == [(v["task_id"], v["robot_id"]) for v in ia["variables"]]
    for x in itertools.product([0, 1], repeat=f_seq["n"]):
        assert energy_qubo(f_seq, list(x), 60, 40, 10) == pytest.approx(energy_qubo(f_ia, list(x), 60, 40))


def test_mehr_plaetze_sind_nie_schlechter(payload):
    inst = build_sequence_instance(payload["tasks"], payload["fleet"], [1, 2, 3], "alle", "erledigungszeit", 2)
    k2 = exact_optimum(inst)
    free = exact_optimum(inst, max_per_robot=3)
    k1 = exact_optimum(inst, max_per_robot=1)
    assert free["value"] <= k2["value"] <= k1["value"]


def test_ungueltige_eingaben(payload):
    with pytest.raises(ValueError):
        build_sequence_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "erledigungszeit", 0)
    with pytest.raises(ValueError):
        build_sequence_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "erledigungszeit", 4)
    with pytest.raises(ValueError):
        build_sequence_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "makespan", 2)


def test_api_endpunkt(payload):
    from fastapi.testclient import TestClient

    from webapp.server import create_app

    client = TestClient(create_app())
    ok = client.get(f"/api/runs/{RUN}/reihenfolge", params={"tasks": "1,2", "plaetze": 2})
    assert ok.status_code == 200
    body = ok.json()
    assert body["formulation"]["n"] == 16
    assert body["exact"]["value"] == pytest.approx(132)
    assert {e["key"] for e in body["estimates"]} == {"sofort", "plaetze", "zeitraster", "zeiten"}
    assert client.get(f"/api/runs/{RUN}/reihenfolge", params={"tasks": "1,2", "plaetze": 9}).status_code == 400
    assert client.get(f"/api/runs/{RUN}/reihenfolge", params={"tasks": "1,2", "kriterium": "leerfahrt"}).status_code == 400
