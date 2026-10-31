"""Tests der Binary-Formulierung der Sofortzuweisung (formulations.binary_ia) und des Endpunkts /ia/binary.

Der Code liegt auf der Seite, die „genau eins“ braucht (H = H_obj_B + A·H_pen_B + B·Querregel + M·H_Aux):
    T = R: Code je Auftrag + H_pen2,   T < R: Code je Auftrag + H'_pen2,   T > R: Code je Roboter + H'_pen1
Ab Grad 3 ersetzen Hilfsbits (Rosenberg) Bitpaare desselben Codes.

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
    IA_BINARY_KINDS, binary_ia, binary_lie_gains, binary_poly_energy, build_ia_instance, coefficient, decode_binary_ia,
    energy_qubo, energy_rules_bin_ia, honest_aux, ia_bin_default_weights, ia_sizes, ia_valid_plans,
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


def code_states(form: dict):
    """Alle Stellungen der Code-Bits, Hilfsbits ehrlich."""
    for bits in itertools.product([0, 1], repeat=form["n_code_bits"]):
        yield honest_aux(form, list(bits) + [0] * len(form["aux"]))


def q_min(form: dict, A: float, B: float, M: float) -> tuple[float, list[int]]:
    """Minimum der QUBO (mit Hilfsbits) durch Aufzählen aller 2^n Zustände."""
    n = form["n"]
    Q = np.zeros((n, n))
    for e in form["entries"]:
        Q[e["i"], e["j"]] += coefficient(e, A, B, M)
    X = ((np.arange(2 ** n)[:, None] >> np.arange(n)) & 1).astype(float)
    E = np.einsum("ki,ij,kj->k", X, Q, X) + coefficient(form["const"], A, B, M)
    k = int(np.argmin(E))
    return float(E[k]), [int(v) for v in X[k]]


@pytest.mark.parametrize("tasks, robots, case, side", [
    ([1, 2, 3], [61, 62, 63], "T=R", "zeile"),
    ([1, 2], [61, 62, 63, 64], "T<R", "zeile"),
    ([1, 2, 3, 4, 5], [61, 62], "T>R", "spalte"),
])
def test_fall_code_und_groesse(payload, tasks, robots, case, side):
    """Code auf der „genau eins“-Seite: G Codes zu K Bits, je Code 2^K − K − 1 Hilfsbits → G(2^K − 1) Qubits."""
    form = binary_ia(ia(payload, tasks, robots))
    T, R = len(tasks), len(robots)
    G, L = (T, R) if T <= R else (R, T)
    K = math.ceil(math.log2(L))
    assert form["case"] == case and form["side"] == side and form["K"] == K and len(form["groups"]) == G
    assert form["n_code_bits"] == G * K
    assert len(form["aux"]) == G * (2 ** K - K - 1)
    assert form["n"] == G * (2 ** K - 1)
    assert form["max_degree"] == 2 * K


def test_hilfsbits_nur_innerhalb_eines_codes(payload):
    """Jedes Hilfsbit steht für ein Produkt von Bits desselben Codes – und ist ehrlich gesetzt genau dieses Produkt."""
    form = binary_ia(ia(payload, [1, 2, 3, 4, 5], [61, 62]))  # K = 3: vier Hilfsbits je Code
    by_group = {g["key"]: set(g["bits"]) for g in form["groups"]}
    for a in form["aux"]:
        assert a["group"] is not None and set(a["covers"]) <= by_group[a["group"]] and len(a["covers"]) >= 2
    for b in code_states(form):
        for a in form["aux"]:
            assert b[a["index"]] == math.prod(b[i] for i in a["covers"])


@pytest.mark.parametrize("tasks, robots", [([1, 2, 3], [61, 62, 63]), ([1, 2], [61, 62, 63]), ([1, 2, 3, 4, 5], [61, 62])])
def test_regeln_gleich_polynom_gleich_qubo(payload, tasks, robots):
    """Regeln = Polynom (beliebiger Grad) = QUBO mit ehrlichen Hilfsbits – für jede Stellung der Code-Bits."""
    form = binary_ia(ia(payload, tasks, robots, "betriebskosten"))
    for b in code_states(form):
        rules = energy_rules_bin_ia(form, b, 37, 53)
        assert binary_poly_energy(form, b, 37, 53, IA_BINARY_KINDS) == pytest.approx(rules)
        assert energy_qubo(form, b, 37, 53, 101) == pytest.approx(rules)


@pytest.mark.parametrize("tasks, robots", [([1, 2, 3], [61, 62, 63]), ([1, 2], [61, 62, 63, 64]), ([1, 2, 3, 4, 5], [61, 62])])
def test_gueltige_stellungen_sind_die_gueltigen_plaene(payload, tasks, robots):
    """Jede gültige Stellung der Code-Bits ist genau ein gültiger Plan der Sofortzuweisung – und umgekehrt."""
    inst = ia(payload, tasks, robots)
    form = binary_ia(inst)
    plans = {tuple(sorted(p["assignment"].items())) for p in ia_valid_plans(inst)}
    found = {tuple(sorted(dict(d["pairs"]).items())) for d in map(lambda b: decode_binary_ia(form, b), code_states(form)) if d["valid"]}
    assert found == plans


def _moments(payload):
    """Echte Momente: je Startanfrage die nächsten T Anfragen und jede Robotermenge (bis 12 Qubits mit Hilfsbits)."""
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
                    yield ids, list(robots)


def test_empfohlene_gewichte_ergeben_den_besten_plan(payload):
    """A = 1,5·c_max, B = 1,5·Spannweite, M = 1,1·größter Lügengewinn: Das QUBO-Minimum ist gültig und der beste Plan."""
    seen = set()
    for ids, robots in _moments(payload):
        for crit in IA_CRITERIA:
            inst = ia(payload, ids, robots, crit)
            form = binary_ia(inst)
            if not 0 < form["n"] <= 12:
                continue
            w = ia_bin_default_weights(inst, form)
            E, b = q_min(form, w["A"], w["B"], w["M"])
            assert decode_binary_ia(form, b)["valid"]
            assert E == pytest.approx(ia_valid_plans(inst)[0]["value"])
            seen.add((form["case"], bool(form["aux"])))
    assert {"T=R", "T<R", "T>R"} == {c for c, _ in seen} and any(aux for _, aux in seen)


def test_b_unter_der_spannweite_reicht_nicht(payload):
    """B muss die Spannweite übersteigen: Mit B = 0,9 × Spannweite fahren zwei Roboter Auftrag #3 (wie bei Domain Wall)."""
    inst = ia(payload, [1, 2, 3], [61, 64], "bearbeitungszeit")
    form = binary_ia(inst)
    w = ia_bin_default_weights(inst, form)
    E, b = q_min(form, w["A"], 0.9 * w["spread"], w["M"])
    assert E < ia_valid_plans(inst)[0]["value"] - 1e-6
    assert decode_binary_ia(form, b)["issues"] == ["#3: 2"]


def test_m_unter_dem_luegengewinn_reicht_nicht(payload):
    """K = 3, ein Roboter: Schon die Kosten haben Grad 3 und brauchen ein Hilfsbit. Mit M = 0,5 × größter Lügengewinn lügt es."""
    inst = ia(payload, [1, 2, 3, 4, 5], [61], "bearbeitungszeit")
    form = binary_ia(inst)
    assert form["K"] == 3 and len(form["aux"]) == 1
    w = ia_bin_default_weights(inst, form)
    gain = max(binary_lie_gains(form, w["A"], w["B"]).values())
    E, b = q_min(form, w["A"], w["B"], 0.5 * gain)
    assert E < ia_valid_plans(inst)[0]["value"] - 1e-6
    assert decode_binary_ia(form, b)["issues"] == ["1 Hilfsbit(s) ≠ Produkt"]


def test_groessen_gegen_one_hot_und_domain_wall():
    """Mit Hilfsbits braucht Binary nie weniger Qubits (gleich bei L = 2^K) und stets mehr Kopplungen als Domain Wall.
    Gegen One-Hot ist es gemischt: R = 2, T = 4 hat Binary 15 Kopplungen, One-Hot 16 – bei T = R = 4 aber 66 gegen 48."""
    for R in (2, 3, 4, 5, 8):
        for row in ia_sizes(R):
            T = row["T"]
            G, L = (T, R) if T <= R else (R, T)
            b, dw = row["binary"], row["domain_wall"]
            if G >= 2 and b["K"] >= 2:
                assert b["n"] == G * (2 ** b["K"] - 1) >= dw["n"]
                assert (b["n"] == dw["n"]) == (L == 2 ** b["K"])
                assert b["couplings"] > dw["couplings"]
    two = {r["T"]: r for r in ia_sizes(2)}[4]
    assert two["binary"]["couplings"] < two["one_hot"]["couplings"]
    four = {r["T"]: r for r in ia_sizes(4)}[4]
    assert (four["binary"]["n"], four["binary"]["couplings"], four["one_hot"]["couplings"]) == (12, 66, 48)


def test_api(payload):
    from fastapi.testclient import TestClient

    from webapp.server import create_app

    client = TestClient(create_app())
    url = f"/api/runs/{RUN}/ia/binary"
    body = client.get(url, params={"tasks": "1,2,3", "robots": "61,62,63", "kriterium": "fahrzeit"}).json()
    f = body["formulation"]
    assert f["case"] == "T=R" and f["side"] == "zeile" and f["K"] == 2 and f["n"] == 9 and len(f["aux"]) == 3
    assert set(body["weights"]) >= {"A", "B", "M"} and body["compare"]["one_hot"]["n"] == 9
    assert [r["T"] for r in body["sizes"]] == [1, 2, 3, 4, 5, 6]
    assert [o["key"] for o in body["overview"]] == IA_CRITERIA and body["n_valid"] == 6
    assert client.get(url, params={"tasks": "1,2", "kriterium": "leerfahrt"}).status_code == 400
    assert client.get(url, params={"tasks": "1,2", "robots": "x"}).status_code == 400
