"""Tests des Formel-Baukastens (encodings/baukasten.py).

Kernaussagen:
- Die Voreinstellung „standard“ ergibt exakt die festen Formulierungen aus formulations.py –
  One-Hot, One-Hot mit Reihenfolge, Domain Wall und Binary (mit denselben Hilfsbits).
- Für jede Bausteinliste – auch unsinnige, mit jeder Kodierung und gemischt – stimmt die Energie über
  die Regeln mit der Energie über die QUBO-Einträge überein, solange die Hilfsbits ehrlich sind.
- Mit den empfohlenen Gewichten ist das Minimum für jede Kodierung ein gültiger, bester Plan.
- Die Formen der Gruppenregel haben die erwarteten Minima.

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

import formulations as fm  # noqa: E402
from baukasten import (  # noqa: E402
    BIT_GROUPS, ENCODINGS, FORMS, GROUPS, build, build_baukasten_instance, default_term_weights, encode_plan,
    energy_qubo, energy_rules, form_coefficients, honest_aux, indicator_values, presets, read_plan, resolve_encodings,
    valid_plans,
)
from webapp.data_service import DataService  # noqa: E402

RUN = "2026-10-09_12-59-39"


@pytest.fixture(scope="module")
def payload():
    service = DataService()
    if RUN not in service.run_ids():
        pytest.skip(f"Lauf {RUN} nicht vorhanden")
    return service.payload(RUN)


def weights_for(terms, **by_symbol):
    by_symbol = {"λ": 1.0, "λ_V": 1.0, **by_symbol}
    return {t["id"]: by_symbol.get(t.get("symbol"), by_symbol.get("A", 50.0)) for t in terms}


def standard(inst, encoding):
    enc = resolve_encodings(inst, encoding)
    return build(inst, presets(inst, enc)["standard"], enc)


def brute_min(form, weights):
    n = form["n"]
    Q = np.zeros((n, n))
    for e in form["entries"]:
        Q[e["i"], e["j"]] += sum(p["v"] * weights[p["term"]] for p in e["parts"])
    masks = np.arange(1 << n, dtype=np.int64)
    X = ((masks[:, None] >> np.arange(n)) & 1).astype(float)
    E = ((X @ Q) * X).sum(1)
    return X[int(E.argmin())].astype(int).tolist()


def test_one_hot_preset_ist_die_feste_formulierung(payload):
    """K = 1 und Kriterium der Sofortzuweisung: gleiche Energie wie formulations.one_hot – für jeden Zustand."""
    for criterion in ("leerfahrt", "erledigungszeit", "energie"):
        inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", criterion, 1)
        form = standard(inst, "one_hot")
        fixed = fm.one_hot(fm.build_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", criterion))
        assert form["n"] == fixed["n"]
        w = weights_for(form["terms"], A=50, B=70)
        for x in itertools.product([0, 1], repeat=form["n"]):
            assert energy_qubo(form, list(x), w) == pytest.approx(fm.energy_qubo(fixed, list(x), 50, 70))


def test_reihenfolge_preset_ist_die_feste_formulierung(payload):
    rng = random.Random(3)
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2, 3], "alle", "erledigungszeit", 3)
    form = standard(inst, "one_hot")
    assert [t["id"] for t in form["terms"]] == ["kosten", "vorgaenger", "zeile", "platz", "luecke"]
    fixed = fm.one_hot_sequence(fm.build_sequence_instance(payload["tasks"], payload["fleet"], [1, 2, 3], "alle", "erledigungszeit", 3))
    w = weights_for(form["terms"], A=60, B=90, D=40)
    for _ in range(500):
        x = [int(rng.random() < 0.3) for _ in range(form["n"])]
        assert energy_qubo(form, x, w) == pytest.approx(fm.energy_qubo(fixed, x, 60, 90, 40))


@pytest.mark.parametrize("ids", [[1, 2], [1, 2, 3], [3, 4, 5]])
def test_domain_wall_preset_ist_die_feste_formulierung(payload, ids):
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], ids, "alle", "leerfahrt", 1)
    form = standard(inst, "domain_wall")
    assert [t["id"] for t in form["terms"]] == ["kosten", "kette"]
    fixed = fm.domain_wall(fm.build_instance(payload["tasks"], payload["fleet"], ids, "alle", "leerfahrt"), "nummer")
    assert form["n"] == fixed["n"]
    w = weights_for(form["terms"], A=80, B=40)
    for x in itertools.product([0, 1], repeat=form["n"]):
        assert energy_qubo(form, list(x), w) == pytest.approx(fm.energy_qubo(fixed, list(x), 80, 40))


@pytest.mark.parametrize("ids", [[1, 2], [1, 2, 3], [3, 4, 5]])
def test_binary_preset_ist_die_feste_formulierung(payload, ids):
    """Gleiche Formulierung wie formulations.binary – gleiche Energie für jeden Zustand."""
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], ids, "alle", "leerfahrt", 1)
    form = standard(inst, "binary")
    assert [t["id"] for t in form["terms"]] == ["kosten", "ungueltig"]  # ≤ 4 Roboter, keine Spaltenregel: Grad 2
    fixed = fm.binary(fm.build_instance(payload["tasks"], payload["fleet"], ids, "alle", "leerfahrt"), "nummer")
    assert form["n"] == fixed["n"] and [a["pair"] for a in form["aux"]] == [a["pair"] for a in fixed["aux"]]
    w = weights_for(form["terms"], A=80, B=40, M=300)
    for x in itertools.product([0, 1], repeat=form["n"]):
        assert energy_qubo(form, list(x), w) == pytest.approx(fm.energy_qubo(fixed, list(x), 80, 40, 300))


def random_terms(rng):
    terms = [{"id": "kosten", "type": "kosten", "gewichtung": rng.choice(["q", "eins", "vorne"]),
              "wartezeit": rng.random() < 0.5, "anfahrt": rng.random() < 0.5, "bloecke": rng.choice(["alle", *ENCODINGS])},
             {"id": "vorg", "type": "vorgaenger", "variante": rng.choice(["differenz", "ohne_abzug"]),
              "gewichtung": rng.choice(["q", "eins", "vorne"])},
             {"id": "nb", "type": "nachbar", "form": "eigene", **{k: rng.uniform(-3, 3) for k in "abcd"}},
             {"id": "kette", "type": "bitnachbar", "form": rng.choice(["kette", "eigene"]), **{k: rng.uniform(-3, 3) for k in "abcd"},
              "bloecke": rng.choice(["alle", *ENCODINGS])},
             {"id": "phantom", "type": "ungueltig", "bloecke": "alle"},
             {"id": "bits", "type": "bitgruppe", "gruppe": rng.choice(BIT_GROUPS), "form": rng.choice(FORMS),
              "k": rng.randint(0, 2), **{c: rng.uniform(-4, 4) for c in "abc"}}]
    for k in range(2):
        terms.append({"id": f"g{k}", "type": "gruppe", "gruppe": rng.choice(GROUPS), "form": rng.choice(FORMS),
                      "k": rng.randint(0, 3), **{c: rng.uniform(-4, 4) for c in "abc"}, "bloecke": rng.choice(["alle", *ENCODINGS])})
    return terms


def test_ausmultiplizieren_stimmt_fuer_beliebige_bausteine_und_kodierungen(payload):
    """Zufällige, auch unsinnige Bausteine auf gemischten Kodierungen: Regeln und QUBO-Einträge liefern
    dieselbe Energie (mit ehrlichen Hilfsbits)."""
    rng = random.Random(11)
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2, 3], "kandidaten", "erledigungszeit", 2)
    for trial in range(24):
        spec = {str(t["transport_id"]): rng.choice(ENCODINGS) for t in inst["tasks"]}
        terms = random_terms(rng)
        form = build(inst, terms, spec, rng.choice(["nummer", "kosten"]))
        weights = {t["id"]: rng.uniform(0, 5) for t in form["terms"]}
        active = {t["id"] for t in form["terms"] if rng.random() < 0.8}
        for _ in range(30):
            x = honest_aux(form, [int(rng.random() < 0.4) for _ in range(form["n"])])
            assert energy_qubo(form, x, weights, active) == pytest.approx(energy_rules(form, x, weights, active)), (trial, spec)


def test_zeilenregel_auf_domain_wall_belohnt_kettenbrueche(payload):
    """Mit I² = I ausmultipliziert ist (1 − Σδ)² auf einer Kette 1 − Anzahl Wände: 0 für intakte, −2 je Bruch."""
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1], "alle", "leerfahrt", 1)
    form = build(inst, [{"id": "zeile", "type": "gruppe", "gruppe": "auftrag", "form": "genau", "k": 1}], "domain_wall")
    assert "belohnt" in form["terms"][0]["note"]
    for x in itertools.product([0, 1], repeat=form["n"]):
        walls = sum(abs(v) for v in indicator_values(form, list(x)).values())
        assert energy_qubo(form, list(x), {"zeile": 1.0}) == pytest.approx(1 - walls)


def test_kodierungen_lesen_gueltige_plaene_zurueck(payload):
    """encode_plan und read_plan sind invers – in jeder Kodierung, auch gemischt."""
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2, 3], "kandidaten", "erledigungszeit", 2)
    plans = valid_plans(inst)
    exact = fm.exact_optimum(inst)
    assert plans["count"] == exact["count"] and plans["plans"][0]["value"] == pytest.approx(exact["value"])
    for spec in ("one_hot", "domain_wall", "binary", {"1": "binary", "2": "domain_wall", "3": "one_hot"}):
        form = build(inst, [{"id": "k", "type": "kosten"}], spec)
        for p in plans["plans"][:200]:
            plan = read_plan(inst, form, encode_plan(form, p["opts"]))
            assert plan["valid"] and plan["value"] == pytest.approx(p["value"]) and not plan["lies"]


def test_empfohlene_gewichte_liefern_den_besten_plan(payload):
    """Für jede Kodierung (und gemischt) ist das Minimum mit den empfohlenen Gewichten gültig und optimal."""
    cases = [([1, 2, 3], "leerfahrt", 1), ([4, 5, 6], "energie", 1), ([1, 2], "erledigungszeit", 2), ([7, 8], "erledigungszeit", 2)]
    for ids, criterion, K in cases:
        inst = build_baukasten_instance(payload["tasks"], payload["fleet"], ids, "alle", criterion, K)
        best = fm.exact_optimum(inst)["value"]
        mixed = {str(t["transport_id"]): ENCODINGS[k % 3] for k, t in enumerate(inst["tasks"])}
        for spec in (*ENCODINGS, mixed):
            form = standard(inst, spec)
            if form["n"] > 20:
                continue
            plan = read_plan(inst, form, brute_min(form, {t["id"]: t["recommended"] for t in form["terms"]}))
            assert plan["valid"] and plan["value"] == pytest.approx(best), (ids, spec, plan["issues"])


def test_hilfsbits_nur_bei_grad_ueber_zwei(payload):
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2], "alle", "erledigungszeit", 2)
    assert not standard(inst, "domain_wall")["aux"]  # Domain Wall: δ ist linear, Produkte bleiben quadratisch
    form = standard(inst, "binary")
    assert form["aux"] and form["max_degree"] > 2
    rec = {t["id"]: t["recommended"] for t in form["terms"]}
    assert rec["hilfsbit"] > rec["platz"]  # M muss die Gewinne einer Lüge überbieten


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
    form = build(inst, presets(inst)["nur_kosten"])
    w = weights_for(form["terms"])
    best = min(itertools.product([0, 1], repeat=form["n"]), key=lambda x: energy_qubo(form, list(x), w))
    assert sum(best) == 0
    assert form["terms"][0]["covers"] == "ziel"


def test_kriterium_der_sofortzuweisung_nur_mit_einem_platz(payload):
    with pytest.raises(ValueError):
        build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "leerfahrt", 2)
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "leerfahrt", 1)
    assert inst["objective"] == "zuweisung"
    exact = fm.exact_optimum(inst)
    assert exact["value"] == 18 and exact["sequences"] == {62: [1, 2]}  # Doppelbelegung zulässig: beide R62
    assert fm.exact_optimum(inst, max_per_robot=1)["value"] == 26  # strenger: wie im One-Hot-Kapitel
    assert default_term_weights(inst)["A"] > 0


def test_ungueltige_bausteine(payload):
    inst = build_baukasten_instance(payload["tasks"], payload["fleet"], [1, 2], "kandidaten", "erledigungszeit", 2)
    for bad in ([], [{"id": "x", "type": "zauber"}], [{"id": "g", "type": "gruppe", "gruppe": "mond"}],
                [{"id": "g", "type": "gruppe", "form": "eigene", "a": "viel"}],
                [{"id": "a", "type": "kosten"}, {"id": "a", "type": "kosten"}],
                [{"id": "b", "type": "bitgruppe", "gruppe": "platz"}], [{"id": "k", "type": "kosten", "bloecke": "ternaer"}]):
        with pytest.raises(ValueError):
            build(inst, bad)
    with pytest.raises(ValueError):
        build(inst, [{"id": "k", "type": "kosten"}], "ternaer")


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
    assert body["plans"]["count"] == body["exact"]["count"]
    custom = client.post(url, json={"tasks": [1, 2], "plaetze": 2, "terms": [{"id": "k", "type": "kosten"}]})
    assert custom.status_code == 200 and len(custom.json()["formulation"]["terms"]) == 1
    mixed = client.post(url, json={"tasks": [1, 2], "plaetze": 1, "kriterium": "leerfahrt", "kodierung": {"1": "binary", "2": "domain_wall"}})
    assert mixed.status_code == 200
    assert [t["id"] for t in mixed.json()["terms"]] == ["kosten", "kette", "ungueltig"]
    assert client.post(url, json={"tasks": [1, 2], "terms": [{"id": "k", "type": "unsinn"}]}).status_code == 400
    assert client.post(url, json={"tasks": [1, 2], "plaetze": 2, "kriterium": "leerfahrt"}).status_code == 400
    assert client.post(url, json={"tasks": [1, 2], "kodierung": "ternaer"}).status_code == 400
