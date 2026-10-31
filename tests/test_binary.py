"""Tests der Binary-Formulierung (encodings/formulations.py: binary & Co.).

Kernaussagen:
- Das Kapitel-Beispiel (encodings/binary/README.md) wird reproduziert: 6 Variablen (2 Hilfsbits),
  15 Kopplungen, Kostenpolynom 35 − 17 z₁ − 25 z₂ + 56 z₁z₂, M = 50 zu klein, M = 100 reicht.
- Mit ehrlichen Hilfsbits (w = x·y) ist die QUBO-Energie genau das ursprüngliche Polynom; mit den
  Standardgewichten ist das Minimum über die Hilfsbits für jede Bitstellung genau dieses Polynom.
- Das nötige M wächst mit der Zahl der Aufträge – M = 2B reicht nur im kleinen Beispiel.

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
    best_assignment, binary, binary_default_weights, binary_poly_energy, build_instance, coefficient, decode_binary,
    energy_qubo, honest_aux,
)
from webapp.data_service import DataService  # noqa: E402

RUN = "2026-10-09_12-59-39"


@pytest.fixture(scope="module")
def payload():
    service = DataService()
    if RUN not in service.run_ids():
        pytest.skip(f"Lauf {RUN} nicht vorhanden")
    return service.payload(RUN)


def all_energies(form: dict, A: float, B: float, M: float) -> tuple[np.ndarray, np.ndarray]:
    n = form["n"]
    Q = np.zeros((n, n))
    for e in form["entries"]:
        Q[e["i"], e["j"]] += coefficient(e, A, B, M)
    masks = np.arange(1 << n, dtype=np.int64)
    X = ((masks[:, None] >> np.arange(n)) & 1).astype(int)
    E = ((X @ Q) * X).sum(1) + coefficient(form["const"], A, B, M)
    return X, E


def brute_min(form: dict, A: float, B: float, M: float) -> tuple[float, list[int]]:
    X, E = all_energies(form, A, B, M)
    k = int(E.argmin())
    return float(E[k]), X[k].tolist()


def test_ohne_spaltenregel_keine_hilfsbits(payload):
    """Standard: Doppelbelegung zulässig – die Aufträge koppeln nicht, bei ≤ 4 Robotern bleibt alles Grad 2."""
    inst = build_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "leerfahrt")
    form = binary(inst)
    assert form["n"] == 4 and not form["aux"] and form["max_degree"] == 2
    w = binary_default_weights(inst, form)
    E, x = brute_min(form, w["A"], 0, w["M"])
    assert E == 18 and decode_binary(form, x)["assignment"] == {1: 62, 2: 62}


def test_kapitel_beispiel(payload):
    """Kapitel-Beispiel (encodings/binary/README.md) – strengere Variante mit Spaltenregel."""
    inst = build_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "leerfahrt")
    form = binary(inst, column_rule=True)
    assert form["n_task_bits"] == 4 and len(form["aux"]) == 2 and form["n"] == 6
    t1, t2 = form["tasks"]
    # Hilfsbits wie im Kapitel: gleiche Stelle beider Aufträge (w₁ = z₁,₁·z₂,₁, w₂ = z₁,₂·z₂,₂)
    assert [a["pair"] for a in form["aux"]] == [[t1["bits"][0], t2["bits"][0]], [t1["bits"][1], t2["bits"][1]]]
    assert sum(1 for e in form["entries"] if e["i"] != e["j"]) == 15  # alle Paare zwischen 6 Knoten
    # Kostenpolynom von #1: 35 − 17 z₁ − 25 z₂ + 56 z₁z₂
    poly1 = {tuple(t["vars"]): t["c"] for t in form["polynomial"]["kosten"] if set(t["vars"]) <= set(t1["bits"]) and t["vars"]}
    assert poly1 == {(t1["bits"][0],): -17, (t1["bits"][1],): -25, tuple(t1["bits"]): 56}
    # Spaltenregel vor der Quadratisierung: 4 / 6 / 4 / 1 Terme vom Grad 1 / 2 / 3 / 4
    degrees: dict[int, int] = {}
    for t in form["polynomial"]["spalte"]:
        if t["vars"]:  # die Konstante zählt nicht als Term
            degrees[len(t["vars"])] = degrees.get(len(t["vars"]), 0) + 1
    assert degrees == {1: 4, 2: 6, 3: 4, 4: 1}
    assert binary_poly_energy(form, [0, 1, 0, 1, 0, 0], 50, 50) == 68  # beide R62
    E, x = brute_min(form, 50, 50, 50)  # M zu klein: ein Hilfsbit lügt
    assert not decode_binary(form, x)["valid"] and decode_binary(form, x)["lies"]
    E, x = brute_min(form, 50, 50, 100)
    assert E == 26 and decode_binary(form, x)["assignment"] == {1: 63, 2: 62}


def test_ungueltiger_code_braucht_strafe(payload):
    """3 Roboter: Code 11 ist ein Phantomroboter mit Kosten 0 – ohne A wird er gewählt."""
    inst = build_instance(payload["tasks"], payload["fleet"], [1], "kandidaten", "leerfahrt")
    inst = {**inst, "variables": [v for v in inst["variables"] if v["robot_id"] != 64]}
    form = binary(inst)
    assert form["tasks"][0]["codes"][3]["robot_id"] is None
    E0, x0 = brute_min(form, 0, 0, 0)
    assert E0 == 0 and not decode_binary(form, x0)["valid"]
    E, x = brute_min(form, 50, 0, 0)
    assert E == 10 and decode_binary(form, x)["assignment"] == {1: 62}


@pytest.mark.parametrize("ids", [[1, 2], [1, 2, 3], [5, 6, 7]])
def test_ehrliche_hilfsbits_ergeben_genau_das_polynom(payload, ids):
    rng = random.Random(5)
    inst = build_instance(payload["tasks"], payload["fleet"], ids, "alle", "energie")
    form = binary(inst, "kosten", column_rule=True)
    for xs in itertools.product([0, 1], repeat=form["n_task_bits"]):
        x = honest_aux(form, list(xs) + [0] * (form["n"] - form["n_task_bits"]))
        A, B, M = rng.uniform(0, 90), rng.uniform(0, 90), rng.uniform(0, 300)
        assert energy_qubo(form, x, A, B, M) == pytest.approx(binary_poly_energy(form, x, A, B))


def test_standard_m_macht_die_quadratisierung_exakt(payload):
    """Für jede Stellung der Auftrags-Bits: Minimum über die Hilfsbits == Wert des Polynoms (mit Spaltenregel)."""
    inst = build_instance(payload["tasks"], payload["fleet"], [1, 2, 3], "alle", "leerfahrt")
    form = binary(inst, column_rule=True)
    w = binary_default_weights(inst, form)
    X, E = all_energies(form, w["A"], w["B"], w["M"])
    nt = form["n_task_bits"]
    keys = (X[:, :nt] * (1 << np.arange(nt))).sum(1)
    for key in np.unique(keys):
        rows = keys == key
        xs = X[rows][0].tolist()
        assert E[rows].min() == pytest.approx(binary_poly_energy(form, xs, w["A"], w["B"]))


def test_standardgewichte_finden_die_beste_zuweisung():
    service = DataService()
    checked = 0
    for run in service.run_ids():
        p = service.payload(run)
        by_time: dict[float, list[int]] = {}
        for t in p["tasks"]:
            by_time.setdefault(t["time"], []).append(t["transport_id"])
        for ids in [ids[:3] for ids in by_time.values() if len(ids) >= 2][:5]:
            for criterion in ("leerfahrt", "erledigungszeit"):
                inst = build_instance(p["tasks"], p["fleet"], ids, "alle", criterion)
                free = binary(inst)
                wf = binary_default_weights(inst, free)
                E, x = brute_min(free, wf["A"], 0, wf["M"])
                assert decode_binary(free, x)["valid"] and E == pytest.approx(best_assignment(inst)["value"])
                best = best_assignment(inst, distinct=True)
                form = binary(inst, column_rule=True)
                if best is None or form["n"] > 16:
                    continue
                w = binary_default_weights(inst, form)
                E, x = brute_min(form, w["A"], w["B"], w["M"])
                assert decode_binary(form, x)["valid"] and E == pytest.approx(best["value"])
                checked += 1
    assert checked >= 4


def test_noetiges_m_waechst_mit_den_auftraegen(payload):
    """Mit Spaltenregel: M = 2B reicht im Kapitel-Beispiel (2 Aufträge), bei 3 Aufträgen nicht mehr."""
    for ids, enough in (([1, 2], True), ([1, 2, 3], False)):
        inst = build_instance(payload["tasks"], payload["fleet"], ids, "alle", "leerfahrt")
        form = binary(inst, column_rule=True)
        w = binary_default_weights(inst, form)
        E, x = brute_min(form, w["A"], w["B"], 2 * w["B"])
        best = best_assignment(inst, distinct=True)
        assert (decode_binary(form, x)["valid"] and E == pytest.approx(best["value"])) == enough


def test_api_endpunkt(payload):
    from fastapi.testclient import TestClient

    from webapp.server import create_app

    client = TestClient(create_app())
    ok = client.get(f"/api/runs/{RUN}/binary", params={"tasks": "1,2", "kriterium": "leerfahrt"})
    assert ok.status_code == 200
    body = ok.json()
    assert body["formulation"]["n"] == 4 and body["compare"]["one_hot"]["n"] == 8 and body["compare"]["domain_wall"]["n"] == 6
    assert body["best"]["value"] == 18 and not body["formulation"]["aux"]
    assert client.get(f"/api/runs/{RUN}/binary", params={"tasks": "1,2", "reihenfolge": "zufall"}).status_code == 400
