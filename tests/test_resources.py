"""Tests der Ressourcen-Rechnung (encodings/resources.py) für den Reiter Qubits & Kopplungen: Fälle aus Klasse × Kodierung ×
Variante, Kennzahlen, Selbstprüfung des Minimums, Verlauf und Landkarte.

Aufruf (aus dem Projektordner):  python -m pytest tests
"""
from __future__ import annotations

import itertools
import math
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "encodings"))

import resources as rs  # noqa: E402
import workload  # noqa: E402
from formulations import _poly_mul, binary_ia, couplings, domain_wall_ia, one_hot_ia  # noqa: E402
from webapp.data_service import DataService  # noqa: E402

RUN = "2026-10-22_17-56-58"
MOMENTS = [([1, 2, 3], [61, 62]), ([1, 2], [61, 62, 63]), ([1, 2, 3], [61, 62, 63]), ([6, 7], [61, 62, 63]), ([4, 5, 6], [62, 63])]


@pytest.fixture(scope="module")
def payload():
    service = DataService()
    if RUN not in service.run_ids():
        pytest.skip(f"Lauf {RUN} nicht vorhanden")
    return service.payload(RUN)


def inst_of(payload, cls, tasks, robots, variables="alle"):
    return rs.case_instance(payload, {"cls": cls, "tasks": tasks, "robots": robots, "variables": variables})


@pytest.mark.parametrize("tasks, robots", MOMENTS)
def test_default_variants_match_encoding_pages(payload, tasks, robots):
    """IA mit Paarstrafe = formulations.*_ia, TA mit Lastausgleich = workload.wb_formulation (Qubits und Kopplungen)."""
    ia = inst_of(payload, "IA", tasks, robots)
    for enc, f in (("one_hot", one_hot_ia), ("domain_wall", domain_wall_ia), ("binary", binary_ia)):
        ref = f(ia)
        m = rs.metrics(ia, rs.build_case(ia, "IA", enc, "paar"), full=False)
        assert (m["n"], m["couplings"]) == (ref["n"], couplings(ref)), enc
    ta = inst_of(payload, "TA", tasks, robots)
    for enc in rs.ENCODINGS:
        ref = workload.wb_formulation(ta, enc)
        m = rs.metrics(ta, rs.build_case(ta, "TA", enc, "wb"), full=False)
        assert (m["n"], m["couplings"]) == (ref["n"], couplings(ref)), enc


def test_slack_counts():
    """Slack-Bits: IA eins je Ungleichung (T ≠ R), Kapazität ⌈log₂(K+1)⌉ je Roboter, Makespan je Roboter so viele wie C_max."""
    for T, R in [(2, 3), (4, 2), (3, 3)]:
        inst = rs.structure_instance(T, R)
        m = rs.metrics(inst, rs.build_case(inst, "IA", "one_hot", "slack"), full=False)
        assert m["types"]["slack"] == (0 if T == R else abs(R - T) and (R if T < R else T))
    inst = rs.structure_instance(5, 2)
    for K in (1, 2, 3, 4, 7):
        f = rs.build_case(inst, "TA", "one_hot", "kap_slack", {"kap": K})
        assert rs.metrics(inst, f, full=False)["types"]["slack"] == 2 * math.ceil(math.log2(K + 1))
        assert sum(rs._slack_weights(K)) == K
    f = rs.build_case(inst, "TA", "domain_wall", "makespan", {"delta": 10})
    m = rs.metrics(inst, f, full=False)
    assert m["types"]["schranke"] == f["weights"]["Kc"] and m["types"]["slack"] == 2 * f["weights"]["Kc"]


def test_unbalanced_with_capacity_one_is_pair_penalty():
    """Unbalanciert mit K = 1 (λ2 = λ1/K): g²/K − g = Σx(Σx − 1) = 2·Σ_{i<j} x_i x_j – die Paarstrafe der IA."""
    xs = [{frozenset([i]): 1.0} for i in range(4)]
    g = rs._sum_lin([(x, -1.0) for x in xs], 1.0)
    poly = rs._sum_lin([(_poly_mul(g, g), 1.0), (g, -1.0)])
    assert {m: round(c, 9) for m, c in poly.items()} == {frozenset(p): 2.0 for p in itertools.combinations(range(4), 2)}


@pytest.mark.parametrize("tasks, robots", MOMENTS)
def test_valid_count_matches_enumeration(payload, tasks, robots):
    """K6: Zahl der gültigen Bitmuster = Abzählen aller Zustände (Regeln der Klasse, Kapazität, Hilfsbits ehrlich)."""
    for cls, variants in (("IA", ("paar", "slack")), ("TA", ("wb", "kap_slack"))):
        inst = inst_of(payload, cls, tasks, robots)
        for enc in rs.ENCODINGS:
            for var in variants:
                form = rs.build_case(inst, cls, enc, var)
                n = form["n"]
                if n > 14:
                    continue
                slack = [b["index"] for b in form["bits"] if b["type"] == "slack"]
                count = 0
                for mask in range(2 ** n):
                    b = [(mask >> i) & 1 for i in range(n)]
                    dec = rs._decode(inst, form, b)
                    if dec is None or not rs._plan_eval(inst, form, dec)["ok"]:
                        continue
                    if slack and not _slack_exact(inst, form, b):
                        continue
                    count += 1
                assert count == rs.valid_count(inst, form), (cls, enc, var)


def _slack_exact(inst, form, b):
    """Jede Gleichung mit Slack-Bits geht genau auf: IA Σx + s = 1 je Ungleichung, Kapazität Σx + Σ w·s = K je Roboter."""
    xs = [0.0 if p is None else sum(c for m, c in p.items() if all(b[i] for i in m)) for p in form["x_polys"]]
    cross = "robot_id" if form["side"] == "zeile" else "task_id"
    groups: dict[str, list[int]] = {}
    for bit in form["bits"]:
        if bit["type"] == "slack":
            groups.setdefault(bit["group"], []).append(bit["index"])
    for name, idx in groups.items():
        key = int(name[1:])
        if name[0] == "q":
            total = sum(xs[v["index"]] for v in inst["variables"] if v[cross] == key) + b[idx[0]] - 1
        else:
            K = form["weights"]["kap"]
            total = sum(xs[v["index"]] for v in inst["variables"] if v["robot_id"] == key) + sum(w * b[i] for i, w in zip(idx, rs._slack_weights(K))) - K
        if abs(total) > 1e-9:
            return False
    return True


@pytest.mark.parametrize("variant", ["paar", "slack"])
def test_ia_minimum_is_best_plan(payload, variant):
    for tasks, robots in MOMENTS:
        inst = inst_of(payload, "IA", tasks, robots)
        for enc in rs.ENCODINGS:
            form = rs.build_case(inst, "IA", enc, variant)
            if form["n"] <= rs.CHECK_MAX_BITS:
                assert rs.check_minimum(inst, form)["status"] == "ok", (tasks, robots, enc)


@pytest.mark.parametrize("variant", ["wb", "kap_slack", "makespan"])
def test_ta_minimum_is_best_plan(payload, variant):
    """Lastausgleich, Kapazität mit Slack und Makespan: Minimum gültig und optimal (Makespan im Raster δ = 30 s)."""
    checked = 0
    for tasks, robots in MOMENTS + [([1, 2], [61, 62]), ([7, 8], [62, 63])]:
        inst = inst_of(payload, "TA", tasks, robots)
        for enc in rs.ENCODINGS:
            form = rs.build_case(inst, "TA", enc, variant, {"delta": 30.0, "kap": 2})
            if form["n"] <= rs.CHECK_MAX_BITS:
                assert rs.check_minimum(inst, form)["status"] == "ok", (tasks, robots, enc)
                checked += 1
    assert checked >= 6


def test_unbalanced_capacity_is_only_approximate(payload):
    """Unbalanciert ist eine Näherung: Das Minimum ist immer zulässig oder sichtbar markiert – nie still falsch."""
    statuses = set()
    for tasks, robots in MOMENTS:
        inst = inst_of(payload, "TA", tasks, robots)
        for enc in rs.ENCODINGS:
            form = rs.build_case(inst, "TA", enc, "kap_unbal")
            if form["n"] <= rs.CHECK_MAX_BITS:
                statuses.add(rs.check_minimum(inst, form)["status"])
    assert statuses <= {"ok", "suboptimal", "ungueltig"}


def test_structure_scaling_and_landscape():
    rows = rs.scaling([{"cls": "TA", "encoding": "one_hot", "variant": "wb"}], "T", 3, 6)[0]["rows"]
    assert [r["n"] for r in rows] == [3 * T for T in range(1, 7)]
    assert [r["couplings"] for r in rows] == [T * 3 + 3 * math.comb(T, 2) for T in range(1, 7)]
    land = rs.landscape({"IA": "paar", "TA": "wb"})
    cell = next(c for c in land["grid"] if c["cls"] == "IA" and c["T"] == 4 and c["R"] == 4)
    assert cell["one_hot"]["n"] == 16 and cell["domain_wall"]["n"] == 12


def test_size_series():
    for s in rs.size_series("TA", "wb", "halb", 3)["series"]:
        pts = s["points"]
        assert [(p["T"], p["R"]) for p in pts] == [(2 * r, r) for r in range(1, 10)]  # bis 18 Aufträge, R = T/2
        assert [p["T"] * p["R"] for p in pts] == sorted(p["T"] * p["R"] for p in pts)
        assert all(0 <= p["density"] <= 1 and p["couplings"] <= p["n"] * (p["n"] - 1) / 2 for p in pts)
    fixed = rs.size_series("IA", "paar", "fest", 3)["series"][0]["points"]
    assert [(p["T"], p["R"]) for p in fixed] == [(T, 3) for T in range(2, 19, 2)]
    assert [p["T"] for p in rs.size_series("IA", "paar", "quadrat")["series"][0]["points"]] == list(range(2, 10))
    with pytest.raises(ValueError):
        rs.size_series("IA", "wb")
    with pytest.raises(ValueError):
        rs.structure_instance(19, 3)


def test_binary_counts_are_stable():
    """Referenzwerte aus der Rechnung vor der Beschleunigung der Quadratisierung (_quadratize_groups mit Paar-Index)."""
    for T, R, n, couplings in [(6, 4, 28, 342), (12, 8, 120, 6564)]:
        m = rs.structure_metrics("IA", "binary", "paar", T, R, valid=False)
        assert (m["n"], m["couplings"]) == (n, couplings)


def test_size_figure_is_svg():
    import paper_figures as pf

    svg = pf.render_sizes(rs.size_series("IA", "paar", "halb", 3), 3, True, "svg").decode("utf-8")
    assert svg.lstrip().startswith("<?xml") and "<svg" in svg


def test_size_axes_are_fixed(monkeypatch):
    """Feste y-Achsen: gleich für IA und TA, mit und ohne Referenzlinien, und sie decken alle Werte der Folge bis 18 × 9 ab."""
    import paper_figures as pf
    from matplotlib.figure import Figure

    seen = []

    class Recorded(Figure):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            seen.append(self)

    monkeypatch.setattr(pf, "Figure", Recorded)
    ia, ta = rs.size_series("IA", "paar", "halb", 3), rs.size_series("TA", "wb", "halb", 3)
    pf.render_sizes(ia, 3, True, "svg")
    pf.render_sizes(ta, 3, True, "svg", [{"label": "X", "qubits": 100.0, "couplings": 5000.0, "density": 0.5}])
    expected = [pf.SIZE_YLIM[field] for field, _, _ in pf.SIZE_PANELS]
    assert [[ax.get_ylim() for ax in fig.axes] for fig in seen] == [expected, expected]
    for data in (ia, ta):
        for field, (low, high) in pf.SIZE_YLIM.items():
            values = [p[field] for s in data["series"] for p in s["points"] if p[field] > 0]
            assert low < min(values) and max(values) < high


def test_timeline(payload):
    tl = rs.timeline(payload, [{"cls": "IA", "encoding": "one_hot", "variant": "paar"}], "fenster", 60, "frei")
    assert len(tl["points"]) == len(payload["tasks"])
    for p, v in zip(tl["points"], tl["series"][0]["values"]):
        if v is not None:
            assert v["n"] == min(p["T"], tl["t_cap"]) * p["R"]
    off = rs.timeline(payload, [{"cls": "TA", "encoding": "binary", "variant": "wb"}], "offen", 0, "alle")
    assert max(p["T"] for p in off["points"]) >= 1


def test_endpoints():
    from fastapi.testclient import TestClient
    from webapp.server import create_app

    client = TestClient(create_app())
    assert client.get("/api/ressourcen/katalog").status_code == 200
    res = client.post(f"/api/runs/{RUN}/ressourcen", json={"cases": [
        {"cls": "TA", "encoding": "domain_wall", "variant": "kap_slack", "tasks": [1, 2, 3], "robots": [61, 62], "vparams": {"kap": 2}},
        {"cls": "IA", "encoding": "binary", "variant": "unbekannt", "tasks": [1, 2]},
    ]})
    assert res.status_code == 200
    a, b = res.json()["cases"]
    assert a["check"]["status"] == "ok" and a["types"]["slack"] == 4
    assert "error" in b
    short = client.post(f"/api/runs/{RUN}/ressourcen", json={"cases": [
        {"cls": "IA", "encoding": "domain_wall", "variant": "paar", "tasks": [1, 2, 3, 4], "robots": [61, 62, 63], "kurz": True}]}).json()["cases"][0]
    assert short["n"] == 9 and short["couplings"] == 27 and "check" not in short
