"""Binary-Kodierung: erzeugt die Abbildungen für README.md und rechnet alle Zahlen nach.

Aufruf (aus dem Projektordner):
    python encodings/binary/illustrate.py

Jede Zahl im README wird hier per Brute Force über alle Zustände geprüft (assert).
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import FancyBboxPatch, Patch  # noqa: E402

from common import (  # noqa: E402
    ACCENT, AXIS, BAD, GOOD, GRID, INK, INK2, MUTED, ROBOTS, SERIES, SURFACE, TINT_ACCENT, TINT_SERIES,
    all_states, bits_str, blank, costs, couplings, draw_bits, draw_matrix, fig_title, p_add, p_const,
    p_degree_counts, p_eval, p_mul, p_scale, p_to_qubo, p_var, qubo_energy,
)

OUT = Path(__file__).resolve().parent / "abbildungen"

A = 50  # Strafe für eine Nummer, die es nicht gibt (nur wenn R keine Zweierpotenz ist)
B = 50  # Strafe, wenn zwei Aufträge dieselbe Nummer haben
M_SMALL = 50  # zu kleine Strafe für die Hilfsbits
M = 100  # ausreichende Strafe für die Hilfsbits
R = len(ROBOTS)
NB = math.ceil(math.log2(R))  # Bits pro Auftrag
C1 = costs("A1")
C2 = costs("A2")
AQUA = "#1baf7a"  # dritte Farbe der geprüften Palette (für den Vergleich der drei Kodierungen)


# ---------------------------------------------------------------- Kodierung als Polynome
def names(t: int) -> list[str]:
    return [f"z{t}_{j}" for j in range(1, NB + 1)]


def code(k: int) -> list[int]:
    """Roboter mit Index k → Binärzahl mit NB Stellen (höchste Stelle zuerst)."""
    return [(k >> (NB - 1 - j)) & 1 for j in range(NB)]


def indicator(t: int, k: int) -> dict:
    """Produkt über alle Stellen: z_j, wenn die Stelle von k eine 1 ist, sonst (1 − z_j)."""
    z = [p_var(n) for n in names(t)]
    return p_mul(*[z[j] if b else p_add(p_const(1), p_scale(z[j], -1)) for j, b in enumerate(code(k))])


def cost(t: int, c: np.ndarray) -> dict:
    return p_add(*[p_scale(indicator(t, k), float(c[k])) for k in range(len(c))])


def same_number() -> dict:
    """Σ_k δ_k(A1)·δ_k(A2): 1, wenn beide Aufträge dieselbe Nummer haben."""
    return p_add(*[p_mul(indicator(1, k), indicator(2, k)) for k in range(R)])


def xnor(j: int) -> dict:
    """[z1_j = z2_j] = 1 − x − y + 2xy."""
    x, y = p_var(names(1)[j]), p_var(names(2)[j])
    return p_add(p_const(1), p_scale(x, -1), p_scale(y, -1), p_scale(p_mul(x, y), 2))


def aux_names() -> list[str]:
    return [f"w_{j}" for j in range(1, NB + 1)]


def rosenberg(x: dict, y: dict, w: dict) -> dict:
    """xy − 2xw − 2yw + 3w: genau dann 0, wenn w = x·y, sonst ≥ 1."""
    return p_add(p_mul(x, y), p_scale(p_mul(x, w), -2), p_scale(p_mul(y, w), -2), p_scale(w, 3))


def quadratized(m: float) -> dict:
    """Spaltenregel mit Hilfsbits w_j ≙ z1_j·z2_j – nur noch Terme mit höchstens zwei Bits."""
    e = []
    ros = []
    for j in range(NB):
        x, y, w = p_var(names(1)[j]), p_var(names(2)[j]), p_var(aux_names()[j])
        e.append(p_add(p_const(1), p_scale(x, -1), p_scale(y, -1), p_scale(w, 2)))
        ros.append(rosenberg(x, y, w))
    return p_add(cost(1, C1), cost(2, C2), p_scale(p_mul(*e), B), p_scale(p_add(*ros), m))


def check() -> dict:
    res = {}
    X = all_states(NB)
    n1 = names(1)
    # Codes und Indikatoren
    for k in range(R):
        vals = [p_eval(indicator(1, kk), n1, np.array([code(k)]))[0] for kk in range(R)]
        assert vals == [1.0 if kk == k else 0.0 for kk in range(R)]
    # Kostenpolynom eines Auftrags
    Qc, kc = p_to_qubo(cost(1, C1), n1)
    res["kosten_poly"] = (float(kc), float(Qc[0, 0]), float(Qc[1, 1]), float(Qc[0, 1]))
    assert res["kosten_poly"] == (35.0, -17.0, -25.0, 56.0)
    assert res["kosten_poly"][3] == C1[0] - C1[1] - C1[2] + C1[3]
    E = p_eval(cost(1, C1), n1, X)
    assert np.allclose(E, C1)  # alle 4 Stellungen gültig, Energie = Kosten
    res["min_einzel"] = (bits_str(X[E.argmin()]), float(E.min()))
    assert res["min_einzel"] == ("01", 10.0)

    # Variante mit 3 Robotern: Code 11 gibt es nicht
    c3 = C1[:3]
    pen3 = p_mul(*[p_var(n) for n in n1])
    for a in (0, A):
        E3 = p_eval(p_add(cost(1, c3), p_scale(pen3, a)), n1, X)
        res[f"r3_A{a}"] = (bits_str(X[E3.argmin()]), float(E3.min()))
    assert res["r3_A0"] == ("11", 0.0) and res[f"r3_A{A}"] == ("01", 10.0)

    # Ausblick auf größere Flotten (3 Bits): Strafe für ungültige Codes bzw. Kosten werden kubisch
    def ind3(k: int) -> dict:
        z = [p_var(f"u{j}") for j in range(3)]
        bits = [(k >> (2 - j)) & 1 for j in range(3)]
        return p_mul(*[z[j] if b else p_add(p_const(1), p_scale(z[j], -1)) for j, b in enumerate(bits)])
    res["grad_strafe_R5"] = max(p_degree_counts(p_add(*[ind3(k) for k in range(5, 8)])))
    res["grad_kosten_R8"] = max(p_degree_counts(p_add(*[p_scale(ind3(k), 2.0 ** k) for k in range(8)])))
    assert res["grad_strafe_R5"] == 3 and res["grad_kosten_R8"] == 3

    # Spaltenregel: Grad bis 4, identisch mit Produkt der XNORs
    same = same_number()
    res["grade"] = p_degree_counts(same)
    assert res["grade"] == {1: 4, 2: 6, 3: 4, 4: 1}
    assert p_add(same, p_scale(p_mul(*[xnor(j) for j in range(NB)]), -1)) == {}

    n2 = names(1) + names(2)
    X4 = all_states(2 * NB)
    full4 = p_add(cost(1, C1), cost(2, C2), p_scale(same, B))
    E4 = p_eval(full4, n2, X4)
    best = X4[E4.argmin()]
    res["zwei"] = (bits_str(best[:NB]), bits_str(best[NB:]), float(E4.min()))
    assert res["zwei"] == ("10", "01", 26.0)
    res["gierig"] = float(p_eval(full4, n2, np.array([code(1) + code(1)]))[0])
    assert res["gierig"] == C1[1] + C2[1] + B
    try:
        p_to_qubo(full4, n2)
        raise AssertionError("Polynom vom Grad 4 darf kein QUBO sein")
    except ValueError:
        pass

    # Rosenberg-Tabelle
    x, y, w = p_var("x"), p_var("y"), p_var("w")
    ros = rosenberg(x, y, w)
    X3 = all_states(3)
    pr = p_eval(ros, ["x", "y", "w"], X3)
    ok = X3[:, 2] == X3[:, 0] * X3[:, 1]
    assert np.all(pr[ok] == 0) and np.all(pr[~ok] >= 1)
    res["rosenberg"] = [(tuple(int(v) for v in s), float(p)) for s, p in zip(X3, pr)]

    # Mit Hilfsbits: zu kleines M schummelt, ausreichendes M ist exakt
    n6 = n2 + aux_names()
    X6 = all_states(2 * NB + NB)
    for m in (M_SMALL, M):
        q = quadratized(m)
        Q, k = p_to_qubo(q, n6)
        E6 = p_eval(q, n6, X6)
        assert np.allclose(qubo_energy(Q, k, X6), E6)
        exact = all(np.isclose(E6[(X6[:, :2 * NB] == z).all(axis=1)].min(), e) for z, e in zip(X4, E4))
        b6 = X6[E6.argmin()]
        res[f"M{m}"] = dict(exact=exact, z1=bits_str(b6[:NB]), z2=bits_str(b6[NB:2 * NB]),
                            w=bits_str(b6[2 * NB:]), E=float(E6.min()), n_cpl=len(couplings(Q)),
                            max_koeff=float(np.abs(Q).max()), Q=Q)
    small, ok_m = res[f"M{M_SMALL}"], res[f"M{M}"]
    assert not small["exact"] and (small["z1"], small["z2"], small["w"], small["E"]) == ("01", "01", "00", 18.0)
    assert small["E"] == C1[1] + C2[1] - B + M_SMALL
    assert ok_m["exact"] and (ok_m["z1"], ok_m["z2"], ok_m["E"]) == ("10", "01", 26.0)
    n_vars = len(n6)
    assert ok_m["n_cpl"] == n_vars * (n_vars - 1) // 2  # vollständiger Graph
    res["n_vars"] = n_vars
    return res


# ---------------------------------------------------------------- Abbildungen
def z_labels(t: int | None = None) -> list[str]:
    return [f"$z_{{{j}}}$" if t is None else f"$z_{{{t},{j}}}$" for j in range(1, NB + 1)]


def fig_codebuch(path: Path) -> None:
    fig, ax = plt.subplots(figsize=(10, 4.6))
    blank(ax)
    for k, r in enumerate(ROBOTS):
        y = -k * 1.2
        ax.text(0, y, f"„Roboter {r} übernimmt A1“", ha="left", va="center", fontsize=11)
        ax.annotate("", xy=(6.3, y), xytext=(5.0, y), arrowprops=dict(arrowstyle="-|>", color=MUTED, lw=1.2))
        draw_bits(ax, code(k), 7.2, y, labels=["$z_1$ (2er)", "$z_2$ (1er)"] if k == 0 else None)
        ax.text(7.2 + NB + 0.2, y, f"Nummer {k} = 2·{code(k)[0]} + {code(k)[1]}", ha="left", va="center",
                fontsize=10.5, color=INK2)
    ax.set_xlim(-0.2, 12.5)
    ax.set_ylim(-4.2, 1.4)
    fig_title(fig, "Schritt 2 · Die Roboternummer als Binärzahl",
              "Wir nummerieren die Roboter 0, 1, 2, 3 und schreiben die Nummer im Zweiersystem: "
              "2 Bits reichen für 4 Roboter.")
    fig.subplots_adjust(top=0.84)
    fig.savefig(path)
    plt.close(fig)


def fig_zustaende(path: Path) -> None:
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4.8))
    for ax, robots, title in [(ax1, ROBOTS, "4 Roboter: jede Stellung ist ein Roboter"),
                              (ax2, ROBOTS[:3], "3 Roboter (z.B. R64 fällt aus)")]:
        blank(ax)
        n = len(robots)
        for k in range(2 ** NB):
            y = -k * 1.1
            draw_bits(ax, code(k), 0, y, radius=0.34)
            if k < n:
                ax.text(NB + 0.1, y, f"✓ R{robots[k]}", ha="left", va="center", fontsize=11, color=GOOD)
            else:
                ax.text(NB + 0.1, y, "✗ Nummer 3 gibt es nicht", ha="left", va="center", fontsize=11, color=BAD)
                ax.text(NB + 0.1, y - 0.45, "→ Strafe  A · z₁ · z₂", ha="left", va="center", fontsize=10,
                        color=INK2)
        verdict = ("keine Strafe nötig" if n == 2 ** NB else "eine Strafe für den ungenutzten Code nötig")
        ax.text(-0.5, -4.6, verdict, ha="left", va="center", fontsize=10.5, color=GOOD if n == 2 ** NB else BAD)
        ax.set_xlim(-0.8, 7.5)
        ax.set_ylim(-5.0, 0.9)
        ax.set_title(title, fontsize=11, pad=6)
    fig_title(fig, "Schritt 3 · Alle Stellungen: bei 4 Robotern ist keine ungültig",
              f"{NB} Bits haben 2² = 4 Stellungen. Ist die Robotanzahl eine Zweierpotenz, ist jede Stellung "
              "ein echter Roboter – sonst bleiben Codes übrig.")
    fig.subplots_adjust(top=0.82, wspace=0.1)
    fig.savefig(path)
    plt.close(fig)


def fig_kosten(path: Path, res: dict) -> None:
    fig = plt.figure(figsize=(13, 5.0))
    gs = fig.add_gridspec(1, 3, width_ratios=[1.15, 0.9, 1.1], wspace=0.3)
    ax = fig.add_subplot(gs[0])
    blank(ax)
    forms = [r"$(1-z_1)\,(1-z_2)$", r"$(1-z_1)\cdot z_2$", r"$z_1\cdot(1-z_2)$", r"$z_1\cdot z_2$"]
    for k, (r, f) in enumerate(zip(ROBOTS, forms)):
        y = -k * 1.0
        ax.text(0, y, f"R{r}  ({bits_str(code(k))})", ha="left", va="center", fontsize=11, fontweight="semibold")
        ax.text(2.6, y, f, ha="left", va="center", fontsize=12)
        ax.text(6.4, y, f"× {C1[k]}", ha="left", va="center", fontsize=11, color=INK2)
    ax.text(0, -4.2, "Jeder Ausdruck ist 1 genau für „seinen“ Code,\nsonst 0 – ein Schalter aus zwei Bits.",
            ha="left", va="center", fontsize=9.5, color=INK2, linespacing=1.5)
    ax.set_xlim(-0.2, 8.0)
    ax.set_ylim(-4.9, 0.9)
    ax.set_title("Welcher Roboter? – als Produkt", fontsize=11, pad=6)

    axm = fig.add_subplot(gs[1])
    blank(axm)
    k0, q1, q2, q12 = res["kosten_poly"]
    cells = [[f"{q1:+g}".replace("-", "−"), f"{q12:+g}"], ["", f"{q2:+g}".replace("-", "−")]]
    tints = [[TINT_SERIES, TINT_ACCENT], [SURFACE, TINT_SERIES]]
    draw_matrix(axm, cells, ["$z_1$", "$z_2$"], tints, fontsize=13)
    axm.text(0, -0.4, f"Konstante: +{k0:g}\n{q12:+g} = {C1[0]} − {C1[1]} − {C1[2]} + {C1[3]}",
             ha="left", va="top", fontsize=9.5, color=INK2, linespacing=1.6)
    axm.set_xlim(-0.9, 2.3)
    axm.set_ylim(-1.6, 2.9)
    axm.set_title("QUBO-Matrix der Kosten", fontsize=11, pad=6)

    axe = fig.add_subplot(gs[2])
    xs = np.arange(R)
    axe.bar(xs, C1, width=0.6, color=SERIES)
    for k in range(R):
        if k != int(np.argmin(C1)):
            axe.text(k, C1[k] + 1.5, f"{C1[k]}", ha="center", va="bottom", fontsize=10, color=INK2)
    kmin = int(np.argmin(C1))
    axe.annotate(f"Minimum\nE = {C1[kmin]}", (kmin, C1[kmin] + 1), xytext=(0, 38), textcoords="offset points",
                 ha="center", fontsize=10, fontweight="semibold", arrowprops=dict(arrowstyle="-|>", color=INK, lw=1.2))
    axe.set_xticks(xs, [f"{bits_str(code(k))}\n✓ R{r}" for k, r in enumerate(ROBOTS)])
    axe.set_ylim(0, 62)
    axe.grid(True, axis="y")
    axe.set_axisbelow(True)
    axe.set_ylabel("Energie E")
    axe.set_title("Energie aller 4 Stellungen", fontsize=11, pad=6)
    fig_title(fig, "Schritt 4 · Kosten: jeder Roboter wird ein Produkt aus Bits",
              f"Kosten = {C1[0]}·(1−z₁)(1−z₂) + {C1[1]}·(1−z₁)z₂ + {C1[2]}·z₁(1−z₂) + {C1[3]}·z₁z₂  "
              f"=  {k0:g} − {abs(q1):g}·z₁ − {abs(q2):g}·z₂ + {q12:g}·z₁z₂")
    fig.subplots_adjust(top=0.80, bottom=0.14, left=0.03, right=0.98)
    fig.savefig(path)
    plt.close(fig)


def _board(ax, a1, a2, title: str, verdict: str, ok: bool) -> None:
    blank(ax)
    for t, k in enumerate([a1, a2]):
        y = -t * 1.5
        ax.text(-0.8, y, f"A{t + 1}", ha="right", va="center", fontsize=12, fontweight="semibold")
        draw_bits(ax, code(k), 0, y, spacing=1.2, radius=0.38, labels=z_labels(t + 1) if t == 0 else None)
        ax.text(NB * 1.2 + 0.2, y, f"Nummer {k} → R{ROBOTS[k]}", ha="left", va="center", fontsize=11.5,
                fontweight="semibold")
    if a1 == a2:
        ax.text(NB * 1.2 + 0.2, -2.3, "✗ gleiche Nummer", ha="left", va="center", fontsize=10.5, color=BAD)
    ax.set_xlim(-1.6, NB * 1.2 + 5.2)
    ax.set_ylim(-3.6, 1.3)
    ax.set_title(title, fontsize=11, pad=6)
    ax.text(-1.5, -3.2, verdict, ha="left", va="center", fontsize=10.5, color=GOOD if ok else BAD)


def fig_zwei_auftraege(path: Path, res: dict) -> None:
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 4.6))
    _board(ax1, 1, 1, "Jeder Auftrag nimmt seinen nächsten Roboter …",
           f"✗ E = {C1[1]} + {C2[1]} + B = {res['gierig']:g}", ok=False)
    _board(ax2, 2, 1, "… besser: A1 weicht auf R63 aus",
           f"✓ E = {C1[2]} + {C2[1]} = {res['zwei'][2]:g}  (Minimum aller 16 Stellungen)", ok=True)
    fig_title(fig, "Schritt 5 · Zwei Aufträge: nur 4 Bits",
              "Die Spaltenregel heißt jetzt: „Zwei Aufträge dürfen nicht dieselbe Nummer haben.“")
    fig.subplots_adjust(top=0.80, wspace=0.1)
    fig.savefig(path)
    plt.close(fig)


def fig_grad(path: Path, res: dict) -> None:
    fig, (ax, axb) = plt.subplots(1, 2, figsize=(13, 4.9), gridspec_kw={"width_ratios": [1.25, 1]})
    blank(ax)
    lines = [
        (r"$\mathrm{gleich}(A1, A2) \;=\; [z_{1,1} = z_{2,1}] \cdot [z_{1,2} = z_{2,2}]$", 13, INK),
        (r"$[x = y] \;=\; 1 - x - y + 2xy$     (1, wenn beide Bits gleich sind)", 11.5, INK2),
        (r"$\Rightarrow$  Produkt aus zwei Klammern mit je einem Paar-Term $xy$", 11.5, INK2),
        (r"$\Rightarrow$  ausmultipliziert entsteht u.a. $4\,z_{1,1}\,z_{2,1}\,z_{1,2}\,z_{2,2}$", 11.5, INK2),
    ]
    for i, (txt, fs, color) in enumerate(lines):
        ax.text(0, -i * 1.0, txt, ha="left", va="center", fontsize=fs, color=color)
    ax.text(0, -4.3, "Ein QUBO erlaubt aber nur einzelne Bits und Paare (Grad ≤ 2).",
            ha="left", va="center", fontsize=11, color=BAD)
    ax.set_xlim(-0.2, 10)
    ax.set_ylim(-4.9, 0.8)
    ax.set_title("Die Regel „nicht dieselbe Nummer“ als Formel", fontsize=11, pad=6)

    grades = res["grade"]
    xs = list(grades)
    vals = [grades[g] for g in xs]
    bars = axb.bar(xs, vals, width=0.6, color=[SERIES if g <= 2 else BAD for g in xs])
    for bar, v in zip(bars, vals):
        axb.text(bar.get_x() + bar.get_width() / 2, v + 0.1, str(v), ha="center", va="bottom", fontsize=10,
                 color=INK2)
    axb.set_xticks(xs, [f"{g} Bit{'s' if g > 1 else ''}" for g in xs])
    axb.set_ylabel("Anzahl Terme")
    axb.set_ylim(0, max(vals) + 1.5)
    axb.grid(True, axis="y")
    axb.set_axisbelow(True)
    axb.legend(handles=[Patch(color=SERIES, label="QUBO-tauglich"), Patch(color=BAD, label="zu hoher Grad")],
               loc="upper right")
    axb.set_title("Terme nach Anzahl beteiligter Bits", fontsize=11, pad=6)
    fig_title(fig, "Schritt 6 · Der Haken: Terme mit drei und vier Bits",
              "Bei One-Hot und Domain Wall blieb die Spaltenregel quadratisch. Bei Binary hängt die Nummer an "
              "mehreren Bits gleichzeitig – der Grad steigt.")
    fig.subplots_adjust(top=0.80, wspace=0.15)
    fig.savefig(path)
    plt.close(fig)


def fig_hilfsbits(path: Path, res: dict) -> None:
    fig = plt.figure(figsize=(13, 5.6))
    gs = fig.add_gridspec(1, 2, width_ratios=[0.85, 1.25], wspace=0.15)
    ax = fig.add_subplot(gs[0])
    blank(ax)
    heads = ["x", "y", "w", "Strafe", ""]
    xs = [0, 1, 2, 3.4, 4.6]
    for x, h in zip(xs, heads):
        ax.text(x, 0.6, h, ha="center", va="center", fontsize=11, fontweight="semibold")
    for i, ((x, y, w), p) in enumerate(res["rosenberg"]):
        yy = -i * 0.62
        ok = w == x * y
        if ok:
            ax.add_patch(FancyBboxPatch((-0.45, yy - 0.26), 4.5, 0.52, boxstyle="round,pad=0.02",
                                        facecolor=GOOD, alpha=0.08, edgecolor="none"))
        for xx, v in zip(xs[:3], (x, y, w)):
            ax.text(xx, yy, str(v), ha="center", va="center", fontsize=11)
        ax.text(xs[3], yy, f"{p:g}", ha="center", va="center", fontsize=11, color=INK if ok else BAD)
        ax.text(xs[4], yy, "✓ w = x·y" if ok else "✗", ha="left", va="center", fontsize=10,
                color=GOOD if ok else BAD)
    ax.set_xlim(-0.8, 6.2)
    ax.set_ylim(-4.9, 1.0)
    ax.set_title(r"Hilfsbit-Strafe  $xy - 2xw - 2yw + 3w$  (Rosenberg)", fontsize=10.5, pad=6)

    axr = fig.add_subplot(gs[1])
    blank(axr)
    small, ok_m = res[f"M{M_SMALL}"], res[f"M{M}"]
    rows = [(f"M = {M_SMALL}", small, False), (f"M = {M}", ok_m, True)]
    for i, (label, r, good) in enumerate(rows):
        y0 = -i * 2.6
        axr.text(-0.4, y0, label, ha="right", va="center", fontsize=12, fontweight="semibold")
        groups = [("A1", r["z1"]), ("A2", r["z2"]), ("Hilfsbits", r["w"])]
        x0 = 0.3
        for g, (name, bits) in enumerate(groups):
            bits_l = [int(b) for b in bits]
            labels = (z_labels(1) if g == 0 else z_labels(2) if g == 1 else ["$w_1$", "$w_2$"])
            draw_bits(axr, bits_l, x0, y0, spacing=0.9, radius=0.32, labels=labels, fontsize=10,
                      on_color=SERIES if g < 2 else ACCENT)
            axr.text(x0 + 0.45, y0 - 0.62, name, ha="center", va="top", fontsize=9, color=INK2)
            x0 += 2.6
        if good:
            txt = f"✓ korrekt: A1 → R63, A2 → R62 · E = {r['E']:g}"
        else:
            txt = (f"✗ w₂ = 0, obwohl z₁,₂ · z₂,₂ = 1 → Hilfsbit „lügt“ (Strafe M = {M_SMALL}),\n"
                   f"   dafür wird die Spaltenregel zur Belohnung (−B statt +B): E = {C1[1]} + {C2[1]} − {B} + "
                   f"{M_SMALL} = {r['E']:g}")
        axr.text(0.0, y0 - 1.25, txt, ha="left", va="center", fontsize=10, color=GOOD if good else BAD,
                 linespacing=1.4)
    axr.set_xlim(-1.6, 8.6)
    axr.set_ylim(-4.6, 1.2)
    axr.set_title("Was der Optimierer findet – je nach Strafgewicht M", fontsize=11, pad=6)
    fig_title(fig, "Schritt 7 · Der Trick: Hilfsbits ersetzen Paare",
              "Ein neues Bit w soll das Produkt x·y darstellen. Eine Strafe sorgt dafür, dass w nicht lügt. "
              "Dann wird aus jedem 4er-Term ein Paar-Term.")
    fig.subplots_adjust(top=0.82, left=0.04, right=0.98)
    fig.savefig(path)
    plt.close(fig)


def fig_kopplungsgraph(path: Path, res: dict) -> None:
    r = res[f"M{M}"]
    Q = r["Q"]
    n_names = names(1) + names(2) + aux_names()
    labels = [f"$z_{{1,{j}}}$" for j in (1, 2)] + [f"$z_{{2,{j}}}$" for j in (1, 2)] + ["$w_1$", "$w_2$"]
    order = [0, 1, 4, 3, 2, 5]  # Kreisreihenfolge: z1_1, z1_2, w_1 … damit Kanten gut sichtbar sind
    angles = np.pi / 2 - np.arange(len(order)) * 2 * np.pi / len(order)
    pos = {idx: (2.2 * np.cos(a), 2.2 * np.sin(a)) for idx, a in zip(order, angles)}
    aux = {n_names.index(n) for n in aux_names()}
    ros_pairs = set()
    for j in range(NB):
        tri = [n_names.index(names(1)[j]), n_names.index(names(2)[j]), n_names.index(aux_names()[j])]
        ros_pairs |= {tuple(sorted((a, b))) for a in tri for b in tri if a < b}
    fig, ax = plt.subplots(figsize=(8.5, 6.6))
    blank(ax)
    for i, j in couplings(Q):
        color = ACCENT if (i, j) in ros_pairs else SERIES
        ax.plot(*zip(pos[i], pos[j]), color=color, lw=2.0, zorder=1)
    for idx, (x, y) in pos.items():
        is_aux = idx in aux
        ax.add_patch(plt.Circle((x, y), 0.42, facecolor=TINT_ACCENT if is_aux else SURFACE,
                                edgecolor=ACCENT if is_aux else INK2, lw=1.5, zorder=2))
        ax.text(x, y, labels[idx], ha="center", va="center", fontsize=12, zorder=3)
    ax.set_xlim(-3.0, 3.0)
    ax.set_ylim(-3.1, 2.9)
    handles = [Line2D([], [], color=SERIES, lw=2, label="Kosten + Spaltenregel"),
               Line2D([], [], color=ACCENT, lw=2, label="Hilfsbit-Strafe (Rosenberg)")]
    ax.legend(handles=handles, loc="upper left", bbox_to_anchor=(0, -0.0), ncol=2)
    fig_title(fig, "Schritt 8 · Was die Hardware verbinden muss",
              f"{res['n_vars']} Variablen ({2 * NB} Auftrags-Bits + {NB} Hilfsbits) · {r['n_cpl']} Kopplungen – "
              "jedes Paar ist verbunden")
    fig.subplots_adjust(top=0.86)
    fig.savefig(path)
    plt.close(fig)


def fig_vergleich(path: Path) -> None:
    rs = np.arange(2, 17)
    nb = np.ceil(np.log2(rs)).astype(int)
    fig, (ax, axd) = plt.subplots(1, 2, figsize=(13, 4.9))
    series = [("One-Hot", rs, SERIES), ("Domain Wall", rs - 1, ACCENT), ("Binary", nb, AQUA)]
    for name, vals, color in series:
        ax.plot(rs, vals, color=color, lw=2.2, marker="o", markersize=4.5, label=name,
                drawstyle="steps-post" if name == "Binary" else "default")
        ax.annotate(f"{name}: {vals[-1]}", (rs[-1], vals[-1]), xytext=(6, 0), textcoords="offset points",
                    va="center", fontsize=9.5, color=INK2)
    ax.set_xlabel("Anzahl Roboter R")
    ax.set_ylabel("Bits pro Auftrag")
    ax.set_xlim(1.5, 19.5)
    ax.grid(True)
    ax.set_axisbelow(True)
    ax.legend(loc="upper left")
    ax.set_title("Variablen pro Auftrag", fontsize=11, pad=6)

    deg = [("One-Hot", np.full_like(rs, 2), SERIES), ("Domain Wall", np.full_like(rs, 2), ACCENT),
           ("Binary", 2 * nb, AQUA)]
    for (name, vals, color), offset in zip(deg, (0.08, -0.08, 0)):
        axd.plot(rs, vals + offset, color=color, lw=2.2, label=name, drawstyle="steps-post")
    axd.axhline(2, color=INK2, lw=1)
    axd.annotate("QUBO-Grenze: Grad 2", (2, 2), xytext=(4, -14), textcoords="offset points", fontsize=9.5,
                 color=INK2)
    axd.annotate(r"Binary: $2\,\lceil \log_2 R \rceil$", (rs[-1], 2 * nb[-1]), xytext=(-6, 8), textcoords="offset points",
                 ha="right", fontsize=9.5, color=INK2)
    axd.set_xlabel("Anzahl Roboter R")
    axd.set_ylabel("höchster Grad (Bits pro Term)")
    axd.set_ylim(0, 9)
    axd.set_xlim(1.5, 17)
    axd.grid(True)
    axd.set_axisbelow(True)
    axd.legend(loc="upper left")
    axd.set_title("Regel „kein Roboter doppelt“: höchster Grad vor Hilfsbits", fontsize=11, pad=6)
    fig_title(fig, "Schritt 9 · Binary im Vergleich: wenige Bits, hoher Grad",
              "Links: Binary braucht am wenigsten Bits. Rechts: dafür liegt nur Binary über der QUBO-Grenze und "
              "braucht Hilfsbits.")
    fig.subplots_adjust(top=0.80, wspace=0.22)
    fig.savefig(path)
    plt.close(fig)


def main() -> None:
    res = check()
    OUT.mkdir(parents=True, exist_ok=True)
    fig_codebuch(OUT / "02_codebuch.png")
    fig_zustaende(OUT / "03_zustaende.png")
    fig_kosten(OUT / "04_kosten.png", res)
    fig_zwei_auftraege(OUT / "05_zwei_auftraege.png", res)
    fig_grad(OUT / "06_grad.png", res)
    fig_hilfsbits(OUT / "07_hilfsbits.png", res)
    fig_kopplungsgraph(OUT / "08_kopplungsgraph.png", res)
    fig_vergleich(OUT / "09_vergleich.png")
    print(f"Kostenpolynom A1: Konstante, z1, z2, z1z2 = {res['kosten_poly']}; Minimum {res['min_einzel']}")
    print(f"3 Roboter: ohne Strafe {res['r3_A0']}, mit A={A} {res[f'r3_A{A}']}")
    print(f"Spaltenregel: Terme je Grad {res['grade']}; Minimum {res['zwei']}, gierig {res['gierig']:g}")
    for m in (M_SMALL, M):
        r = res[f"M{m}"]
        print(f"Hilfsbits M={m}: exakt={r['exact']}, Minimum A1={r['z1']} A2={r['z2']} w={r['w']} E={r['E']:g}; "
              f"{res['n_vars']} Variablen, {r['n_cpl']} Kopplungen, max |Koeffizient| {r['max_koeff']:g}")
    print(f"Abbildungen -> {OUT}")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    main()
