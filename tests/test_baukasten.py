"""Tests des Formel-Baukastens (encodings/baukasten.py).

Kernaussagen:
- Die Voreinstellungen ergeben exakt die festen Formulierungen aus formulations.py.
- Für jede Bausteinliste – auch unsinnige – stimmt die Energie über die Regeln mit der
  Energie über die QUBO-Einträge überein (das Ausmultiplizieren ist korrekt).
- Die Formen der Gruppenregel haben die erwarteten Minima.

Aufruf (aus dem Projektordner):  python -m pytest tests
"""
from __future__ import annotations

import itertools
import random
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "encodings"))

import formulations as fm  # noqa: E402
from baukasten import (  # noqa: E402
    FORMS, GROUPS, build, build_baukasten_instance, default_term_weights, energy_qubo, energy_rules,
    form_coefficients, presets,
)
from webapp.data_service import DataService  # noqa: E402

RUN = "2026-10-09_12-59-39"


@pytest.fixture(scope="module")
def payload():
    service = DataService()
    if RUN not in service.run_ids():
        pytest.skip(f"Lauf {RUN} nicht vorhanden")
    return service.payload(RUN)


def weights_for(terms, A=50.0, B=70.0, D=30.0):
    by_symbol = {"λ": 1.0, "λ_V": 1.0, "A": A, "B": B, "D": D}
    return {t["id"]: by_symbol.get(t.get("symbol"), A) for t in terms}


def test_one_hot_preset_ist_die_feste_formulierung(payload):
    """K = 1 und Kriterium der Sofortzuweisung: gleiche Energie wie formulations.one_hot – für jeden Zustand."""
    for criterion in ("leerfahrt", "erledigungszeit", "energie"):
        inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", criterion, 1)
        terms = presets(inst)["one_hot"]
        form = build(inst, terms)
        fixed = fm.one_hot(fm.build_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", criterion))
        assert form["n"] == fixed["n"]
        w = weights_for(terms, A=50, B=70)
        for x in itertools.product([0, 1], repeat=form["n"]):
            assert energy_qubo(form, list(x), w) == pytest.approx(fm.energy_qubo(fixed, list(x), 50, 70))


def test_reihenfolge_preset_ist_die_feste_formulierung(payload):
    rng = random.Random(3)
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2, 3], "alle", "erledigungszeit", 3)
    terms = presets(inst)["reihenfolge"]
    form = build(inst, terms)
    fixed = fm.one_hot_sequence(fm.build_sequence_instance(payload["tasks"], payload["fleet"], [1, 2, 3], "alle", "erledigungszeit", 3))
    w = weights_for(terms, A=60, B=90, D=40)
    for _ in range(500):
        x = [int(rng.random() < 0.3) for _ in range(form["n"])]
        assert energy_qubo(form, x, w) == pytest.approx(fm.energy_qubo(fixed, x, 60, 90, 40))


def test_ausmultiplizieren_stimmt_fuer_beliebige_bausteine(payload):
    """Zufällige, auch unsinnige Bausteine: Regeln und QUBO-Einträge liefern dieselbe Energie."""
    rng = random.Random(11)
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2, 3], "alle", "erledigungszeit", 2)
    for trial in range(30):
        terms = [{"id": "kosten", "type": "kosten", "gewichtung": rng.choice(["q", "eins", "vorne"]),
                  "wartezeit": rng.random() < 0.5, "anfahrt": rng.random() < 0.5},
                 {"id": "vorg", "type": "vorgaenger", "variante": rng.choice(["differenz", "ohne_abzug"]),
                  "gewichtung": rng.choice(["q", "eins", "vorne"])},
                 {"id": "nb", "type": "nachbar", "form": "eigene", **{k: rng.uniform(-3, 3) for k in "abcd"}}]
        for k in range(3):
            form_name = rng.choice(FORMS)
            terms.append({"id": f"g{k}", "type": "gruppe", "gruppe": rng.choice(GROUPS), "form": form_name,
                          "k": rng.randint(0, 3), **{c: rng.uniform(-4, 4) for c in "abc"}})
        form = build(inst, terms)
        weights = {t["id"]: rng.uniform(0, 5) for t in terms}
        active = {t["id"] for t in terms if rng.random() < 0.8}
        for _ in range(40):
            x = [int(rng.random() < 0.35) for _ in range(form["n"])]
            assert energy_qubo(form, x, weights, active) == pytest.approx(energy_rules(form, x, weights, active)), trial


@pytest.mark.parametrize("form, k, minima", [
    ("genau", 1, {1}), ("genau", 2, {2}), ("hoechstens1", 1, {0, 1}), ("linear", 1, {4}),
])
def test_formen_haben_die_erwarteten_minima(form, k, minima):
    f = form_coefficients({"id": "t", "form": form, "k": k})
    values = {n: f["a"] + f["b"] * n + f["c"] * n * n for n in range(5)}
    best = min(values.values())
    assert {n for n, v in values.items() if abs(v - best) < 1e-9} == minima


def test_ohne_zeilenregel_bleibt_alles_aus(payload):
    """Nur Kosten: das Minimum ist „niemand fährt“ – die Diagnose muss die fehlende Regel finden können."""
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "erledigungszeit", 2)
    terms = presets(inst)["nur_kosten"]
    form = build(inst, terms)
    w = weights_for(terms)
    best = min(itertools.product([0, 1], repeat=form["n"]), key=lambda x: energy_qubo(form, list(x), w))
    assert sum(best) == 0
    assert form["terms"][0]["covers"] == "ziel"


def test_kriterium_der_sofortzuweisung_nur_mit_einem_platz(payload):
    with pytest.raises(ValueError):
        build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "leerfahrt", 2)
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "leerfahrt", 1)
    assert inst["objective"] == "zuweisung"
    exact = fm.exact_optimum(inst)
    assert exact["value"] == 26  # wie im One-Hot-Kapitel: #1 → R63, #2 → R62
    assert default_term_weights(inst)["A"] > 0


def test_ungueltige_bausteine(payload):
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "erledigungszeit", 2)
    for bad in ([], [{"id": "x", "type": "zauber"}], [{"id": "g", "type": "gruppe", "gruppe": "mond"}],
                [{"id": "g", "type": "gruppe", "form": "eigene", "a": "viel"}],
                [{"id": "a", "type": "kosten"}, {"id": "a", "type": "kosten"}]):
        with pytest.raises(ValueError):
            build(inst, bad)


def test_api_endpunkt(payload):
    from fastapi.testclient import TestClient

    from webapp.server import create_app

    client = TestClient(create_app())
    url = f"/api/runs/{RUN}/baukasten"
    ok = client.post(url, json={"tasks": [1, 2], "plaetze": 2})
    assert ok.status_code == 200
    body = ok.json()
    assert [t["id"] for t in body["terms"]] == ["kosten", "vorgaenger", "zeile", "platz", "luecke"]
    assert body["exact"]["value"] == pytest.approx(132)
    custom = client.post(url, json={"tasks": [1, 2], "plaetze": 2, "terms": [{"id": "k", "type": "kosten"}]})
    assert custom.status_code == 200 and len(custom.json()["formulation"]["terms"]) == 1
    assert client.post(url, json={"tasks": [1, 2], "terms": [{"id": "k", "type": "unsinn"}]}).status_code == 400
    assert client.post(url, json={"tasks": [1, 2], "plaetze": 2, "kriterium": "leerfahrt"}).status_code == 400
