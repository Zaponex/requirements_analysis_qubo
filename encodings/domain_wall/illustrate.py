"""Domain-Wall-Kodierung: erzeugt die Abbildungen für README.md und rechnet alle Zahlen nach.

Aufruf (aus dem Projektordner):
    python encodings/domain_wall/illustrate.py

Jede Zahl im README wird hier per Brute Force über alle Zustände geprüft (assert).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import FancyBboxPatch, Patch  # noqa: E402

from common import (  # noqa: E402
    ACCENT, AXIS, BAD, GOOD, GRID, INK, INK2, MUTED, ROBOTS, SERIES, SURFACE, TINT_ACCENT, TINT_SERIES,
    all_states, bits_str, blank, costs, couplings, draw_bits, draw_matrix, fig_title, p_add, p_const, p_eval,
    p_mul, p_scale, p_to_qubo, p_var, qubo_energy,
)

OUT = Path(__file__).resolve().parent / "abbildungen"

A = 50  # Strafe für eine „falsch herum“ stehende Wand (0 links, 1 rechts)
B = 50  # Strafe, wenn ein Roboter zwei Aufträge bekäme
R = len(ROBOTS)
NB = R - 1  # Bits pro Auftrag
C1 = costs("A1")
C2 = costs("A2")
COUNTER = np.array([10, 50, 5, 50])  # Gegenbeispiel: der zweite Roboter in der Kette ist sehr weit weg


# ---------------------------------------------------------------- Kodierung als Polynome
def names(t: int) -> list[str]:
    return [f"b{t}_{i}" for i in range(1, R)]


def chain(t: int) -> list:
    """Kette mit festen Rändern: [1, b1, …, b_{R-1}, 0]."""
    return [p_const(1)] + [p_var(n) for n in names(t)] + [p_const(0)]


def delta(t: int) -> list:
    """δ_k = b_k − b_{k+1}: ist 1 genau für den Roboter, vor dem die Wand steht (bei gültigen Ketten)."""
    b = chain(t)
    return [p_add(b[k], p_scale(b[k + 1], -1)) for k in range(R)]


def penalty(t: int) -> dict:
    """Σ b_{i+1}(1 − b_i) über innere Nachbarpaare: zählt Wände der Art 0 → 1."""
    b = chain(t)
    return p_add(*[p_add(b[i + 1], p_scale(p_mul(b[i], b[i + 1]), -1)) for i in range(1, R - 1)])


def cost(t: int, c: np.ndarray) -> dict:
    return p_add(*[p_scale(d, float(c[k])) for k, d in enumerate(delta(t))])


def column_rule() -> dict:
    """Σ_k δ_k(A1)·δ_k(A2): ist 1, wenn beide Aufträge denselben Roboter wählen."""
    d1, d2 = delta(1), delta(2)
    return p_add(*[p_mul(d1[k], d2[k]) for k in range(R)])


def code(robot: int) -> list[int]:
    k = ROBOTS.index(robot)
    return [1] * k + [0] * (NB - k)


def is_valid(bits) -> bool:
    return all(bits[i] >= bits[i + 1] for i in range(len(bits) - 1))


def robot_of(bits) -> int:
    return ROBOTS[int(sum(bits))]


def n_walls(bits) -> int:
    ext = [1, *bits, 0]
    return sum(ext[i] != ext[i + 1] for i in range(len(ext) - 1))


def full_two_task() -> dict:
    return p_add(cost(1, C1), cost(2, C2), p_scale(penalty(1), A), p_scale(penalty(2), A),
                 p_scale(column_rule(), B))


def check() -> dict:
    res = {}
    X = all_states(NB)
    n1 = names(1)
    valid = np.array([is_valid(b) for b in X])
    pen = p_eval(penalty(1), n1, X)
    assert valid.sum() == R and len(X) == 2 ** NB
    assert np.all(pen[valid] == 0) and np.all(pen[~valid] >= 1)
    assert all(n_walls(b) == 1 for b in X[valid]) and all(n_walls(b) == 3 for b in X[~valid])

    # δ liefert für jeden Code genau den richtigen Roboter
    for r in ROBOTS:
        d = [p_eval(dk, n1, np.array([code(r)]))[0] for dk in delta(1)]
        assert d == [1.0 if rr == r else 0.0 for rr in ROBOTS], (r, d)

    # Kosten: auf gültigen Ketten exakt die Distanzen; linear mit Differenzen als Koeffizienten
    Qc, kc = p_to_qubo(cost(1, C1), n1)
    assert kc == C1[0] and np.allclose(np.diag(Qc), np.diff(C1)) and not couplings(Qc)
    for a in (0, A):
        E = p_eval(p_add(cost(1, C1), p_scale(penalty(1), a)), n1, X)
        assert np.allclose(E[valid], [C1[ROBOTS.index(robot_of(b))] for b in X[valid]])
        res[f"min_A{a}"] = (bits_str(X[E.argmin()]), float(E.min()))
    assert res["min_A0"] == ("100", 10.0) and res[f"min_A{A}"] == ("100", 10.0)
    res["min_ungueltig_A0"] = float(p_eval(cost(1, C1), n1, X)[~valid].min())
    assert res["min_ungueltig_A0"] == 41.0

    # Gegenbeispiel: ohne Strafe gewinnt eine ungültige Kette
    for a in (0, A):
        E = p_eval(p_add(cost(1, COUNTER), p_scale(penalty(1), a)), n1, X)
        res[f"gegen_A{a}"] = (bits_str(X[E.argmin()]), float(E.min()))
    assert res["gegen_A0"] == ("010", -35.0) and res[f"gegen_A{A}"] == ("110", 5.0)
    assert A > COUNTER.max() - COUNTER.min()

    # QUBO der Strafe: Diagonale [0, A, A], Nachbarn −A, sonst nichts
    Qp, _ = p_to_qubo(p_scale(penalty(1), A), n1)
    assert np.allclose(Qp, [[0, -A, 0], [0, A, -A], [0, 0, A]])
    assert couplings(Qp) == [(0, 1), (1, 2)]

    # Zwei Aufträge
    n2 = names(1) + names(2)
    X6 = all_states(2 * NB)
    full = full_two_task()
    Q, k = p_to_qubo(full, n2)
    E = p_eval(full, n2, X6)
    assert np.allclose(qubo_energy(Q, k, X6), E)
    best = X6[E.argmin()]
    res["zwei"] = (bits_str(best[:NB]), bits_str(best[NB:]), float(E.min()))
    assert res["zwei"] == ("110", "100", 26.0)
    greedy = np.array([code(62) + code(62)])
    res["gierig"] = float(p_eval(full, n2, greedy)[0])
    assert res["gierig"] == C1[1] + C2[1] + B
    cpl = couplings(Q)
    intra = [(i, j) for i, j in cpl if (i < NB) == (j < NB)]
    res["kopplungen"], res["kopplungen_kette"], res["kopplungen_spalte"] = len(cpl), len(intra), len(cpl) - len(intra)
    assert (len(cpl), len(intra)) == (11, 4)
    # Bei ungültigen Ketten kann die Spaltenregel negativ werden (Belohnung statt Strafe)
    res["spalte_min"] = float(p_eval(column_rule(), n2, X6).min())
    assert res["spalte_min"] < 0
    res["max_koeff"] = float(np.abs(Q).max())
    res["Q_spalte"] = p_to_qubo(p_scale(column_rule(), B), n2)[0]
    return res


# ---------------------------------------------------------------- Zeichnen
def draw_chain(ax, bits, x0: float, y: float, spacing: float = 1.0, radius: float = 0.34,
               labels: list[str] | None = None, fontsize: float = 11) -> None:
    """Kette [feste 1 | Bits | feste 0] mit eingezeichneten Wänden (schwarz: 1→0, rot: 0→1)."""
    n = len(bits)
    for x, v in [(x0, 1), (x0 + (n + 1) * spacing, 0)]:
        ax.add_patch(plt.Circle((x, y), radius * 0.85, facecolor=TINT_SERIES if v else SURFACE, edgecolor=AXIS,
                                linewidth=1.2, zorder=3))
        ax.text(x, y, str(v), ha="center", va="center", fontsize=fontsize * 0.85, color=MUTED, zorder=4)
    draw_bits(ax, bits, x0 + spacing, y, spacing=spacing, radius=radius, fontsize=fontsize)
    ext = [1, *bits, 0]
    for i in range(len(ext) - 1):
        if ext[i] != ext[i + 1]:
            xw = x0 + (i + 0.5) * spacing
            color = INK if ext[i] > ext[i + 1] else BAD
            ax.plot([xw, xw], [y - radius * 1.45, y + radius * 1.45], color=color, lw=3.2, solid_capstyle="round",
                    zorder=5)
    if labels:
        all_labels = ["fest", *labels, "fest"]
        for i, lab in enumerate(all_labels):
            ax.text(x0 + i * spacing, y + radius + 0.2, lab, ha="center", va="bottom", fontsize=8.5,
                    color=MUTED if lab == "fest" else INK2)


def bit_labels(t: int | None = None) -> list[str]:
    return [f"$b_{{{i}}}$" if t is None else f"$b_{{{t},{i}}}$" for i in range(1, R)]


# ---------------------------------------------------------------- Abbildungen
def fig_codebuch(path: Path) -> None:
    fig, ax = plt.subplots(figsize=(10.5, 4.8))
    blank(ax)
    for i, r in enumerate(ROBOTS):
        y = -i * 1.25
        ax.text(0, y, f"„Roboter {r} übernimmt A1“", ha="left", va="center", fontsize=11)
        ax.annotate("", xy=(6.2, y), xytext=(5.0, y), arrowprops=dict(arrowstyle="-|>", color=MUTED, lw=1.2))
        draw_chain(ax, code(r), 7.0, y, labels=bit_labels() if i == 0 else None)
        ax.text(7.0 + R + 0.6, y, bits_str(code(r)), ha="left", va="center", fontsize=12, family="monospace",
                color=INK2)
        ax.text(7.0 + R + 1.9, y, f"Wand nach Position {i}", ha="left", va="center", fontsize=9.5, color=MUTED)
    ax.set_xlim(-0.2, 15.6)
    ax.set_ylim(-4.4, 1.5)
    fig_title(fig, "Schritt 2 · Eine Reihe aus 1en und 0en – die Antwort steckt in der Wand",
              "Links steht immer eine feste 1, rechts eine feste 0. Dazwischen genau ein Wechsel von 1 zu 0: "
              "die Wand. Ihre Position ist die Antwort.")
    fig.subplots_adjust(top=0.84)
    fig.savefig(path)
    plt.close(fig)


def fig_zustaende(path: Path) -> None:
    X = all_states(NB)
    groups = [[code(r) for r in ROBOTS], [list(b) for b in X if not is_valid(b)]]
    fig, ax = plt.subplots(figsize=(11, 5.6))
    blank(ax)
    centers = [0.0, 7.5]
    heads = [("1 Wand", "✓ gültig · Strafe 0", GOOD), ("3 Wände", "✗ ungültig · Strafe A", BAD)]
    for g, (cx, (h1, h2, color)) in enumerate(zip(centers, heads)):
        x0 = cx - (NB + 1) / 2
        if g == 0:
            ax.add_patch(FancyBboxPatch((x0 - 0.6, -(len(groups[g]) - 1) * 1.1 - 0.65), NB + 2.2,
                                        (len(groups[g]) - 1) * 1.1 + 1.3, boxstyle="round,pad=0.1",
                                        facecolor=GOOD, alpha=0.08, edgecolor="none", zorder=0))
        ax.text(cx, 1.45, h1, ha="center", va="bottom", fontsize=11, fontweight="semibold")
        ax.text(cx, 0.95, h2, ha="center", va="bottom", fontsize=10, color=color)
        for j, bits in enumerate(groups[g]):
            draw_chain(ax, bits, x0, -j * 1.1, radius=0.3, fontsize=9.5)
            label = f"→ R{robot_of(bits)}" if g == 0 else ""
            ax.text(x0 + NB + 1.6, -j * 1.1, label, ha="left", va="center", fontsize=10, color=INK2)
    handles = [Line2D([], [], color=INK, lw=3, label="Wand 1 → 0 (erlaubt)"),
               Line2D([], [], color=BAD, lw=3, label="Wand 0 → 1 (kostet A)")]
    ax.legend(handles=handles, loc="upper left", bbox_to_anchor=(0, 0.02), ncol=2)
    ax.set_xlim(-3.2, 11.5)
    ax.set_ylim(-4.2, 2.1)
    fig_title(fig, "Schritt 3 · Alle 8 Stellungen – ungültig ist nur, was mehr als eine Wand hat",
              f"{NB} Bits → 2³ = 8 Stellungen (One-Hot: 16). Davon sind {R} gültig und nur {2 ** NB - R} ungültig "
              f"(One-Hot: 12).")
    fig.subplots_adjust(top=0.84, bottom=0.08)
    fig.savefig(path)
    plt.close(fig)


def fig_qubo(path: Path) -> None:
    fig, (ax, axg) = plt.subplots(1, 2, figsize=(12, 5.2))
    blank(ax)
    cells = [["0", "−A", "0"], ["", "+A", "−A"], ["", "", "+A"]]
    tints = [[SURFACE, TINT_SERIES, SURFACE], [SURFACE, TINT_ACCENT, TINT_SERIES], [SURFACE, SURFACE, TINT_ACCENT]]
    draw_matrix(ax, cells, bit_labels(), tints)
    ax.text(0, -0.45, "Diagonale (orange): eine 1 kostet A …\n"
                      "Nachbar-Kopplung (blau): … außer links steht auch eine 1 (−A)\n"
                      "Das linke Bit b₁ ist frei: links von ihm steht die feste 1",
            ha="left", va="top", fontsize=9.5, color=INK2, linespacing=1.6)
    ax.set_xlim(-1.2, NB + 0.3)
    ax.set_ylim(-2.2, NB + 0.9)
    ax.set_title("QUBO-Matrix der Strafe", fontsize=11, pad=4)

    blank(axg)
    xs = np.arange(NB + 2) * 1.5
    for i in range(1, NB):
        axg.plot([xs[i], xs[i + 1]], [0, 0], color=SERIES, lw=2.4, zorder=1)
    for i, x in enumerate(xs):
        fixed = i in (0, NB + 1)
        axg.add_patch(plt.Circle((x, 0), 0.42 if not fixed else 0.34,
                                 facecolor=SURFACE if fixed else TINT_SERIES,
                                 edgecolor=AXIS if fixed else SERIES, lw=1.6, zorder=2))
        label = ("1" if i == 0 else "0") if fixed else bit_labels()[i - 1]
        axg.text(x, 0, label, ha="center", va="center", fontsize=12 if not fixed else 10,
                 color=MUTED if fixed else INK, zorder=3)
        if fixed:
            axg.text(x, -0.62, "fest", ha="center", va="top", fontsize=9, color=MUTED)
    axg.text(xs.mean(), -1.5, f"{NB} Variablen · {NB - 1} Kopplungen\nnur direkte Nachbarn sind verbunden – eine Kette",
             ha="center", va="top", fontsize=10, color=INK2)
    axg.set_xlim(-0.8, xs[-1] + 0.8)
    axg.set_ylim(-2.6, 1.4)
    axg.set_title("Als Graph: Knoten = Qubits, Linien = Kopplungen (−A)", fontsize=11, pad=4)
    fig_title(fig, "Schritt 4 · Die Strafe braucht nur Nachbarn",
              r"$P = A \sum_{i=1}^{R-2} b_{i+1}\,(1 - b_i) = A \sum_i (b_{i+1} - b_i\,b_{i+1})$"
              "   – nur das Muster „0 links, 1 rechts“ kostet")
    fig.subplots_adjust(top=0.74, wspace=0.15)
    fig.savefig(path)
    plt.close(fig)


def fig_treppe(path: Path) -> None:
    fig, ax = plt.subplots(figsize=(11, 4.8))
    xs = np.arange(R)
    ax.bar(xs, C1, width=0.55, color=SERIES)
    for k in range(R):
        ax.text(k, C1[k] + 1.5, f"{C1[k]}", ha="center", va="bottom", fontsize=10.5, color=INK)
    for k in range(1, R):
        diff = C1[k] - C1[k - 1]
        y0, y1 = C1[k - 1], C1[k]
        ax.annotate("", xy=(k - 0.3, y1), xytext=(k - 0.7, y0),
                    arrowprops=dict(arrowstyle="-|>", color=ACCENT, lw=1.8, connectionstyle="arc3,rad=-0.25"))
        ax.text(k - 0.5, max(y0, y1) + 7, f"b{'₁₂₃'[k - 1]} = 1:\n{diff:+d}".replace("-", "−"), ha="center", va="bottom",
                fontsize=10, color=ACCENT, fontweight="semibold")
    ax.set_xticks(xs, [f"R{r}\n{bits_str(code(r))}" for r in ROBOTS])
    ax.set_ylabel("Distanz zu A1 (Kosten)")
    ax.set_ylim(0, 72)
    ax.grid(True, axis="y")
    ax.set_axisbelow(True)
    terms = " ".join(f"{d:+d}·b{'₁₂₃'[i]}" for i, d in enumerate(np.diff(C1)))
    fig_title(fig, "Schritt 5 · Kosten: die Wand wandert eine Treppe entlang",
              f"Jedes Bit, das auf 1 springt, schiebt die Wand einen Roboter weiter. "
              f"Kosten = {C1[0]} {terms.replace('+', '+ ').replace('-', '− ')}")
    fig.subplots_adjust(top=0.84)
    fig.savefig(path)
    plt.close(fig)


def fig_energie(path: Path) -> None:
    X = all_states(NB)
    n1 = names(1)
    fig, axes = plt.subplots(1, 2, figsize=(13, 5.0), sharey=True)
    for ax, a in zip(axes, (0, A)):
        E = p_eval(p_add(cost(1, C1), p_scale(penalty(1), a)), n1, X)
        order = np.argsort(E, kind="stable")
        valid = np.array([is_valid(X[i]) for i in order])
        ax.bar(range(len(order)), E[order], width=0.65, color=[SERIES if v else AXIS for v in valid])
        ticks = []
        for i, (idx, v) in enumerate(zip(order, valid)):
            ticks.append(f"{bits_str(X[idx])}\n" + (f"✓ R{robot_of(X[idx])}" if v else "✗"))
            if i > 0:
                ax.text(i, E[idx] + 3, f"{E[idx]:g}", ha="center", va="bottom", fontsize=9.5, color=INK2)
        ax.set_xticks(range(len(order)), ticks, fontsize=9)
        ax.annotate(f"Minimum\nE = {E[order[0]]:g}", (0, E[order[0]] + 1), xytext=(0, 38),
                    textcoords="offset points", ha="center", fontsize=10, fontweight="semibold",
                    arrowprops=dict(arrowstyle="-|>", color=INK, lw=1.2))
        ax.grid(True, axis="y")
        ax.set_axisbelow(True)
        ax.set_title(f"A = {a}", pad=22)
        sub = ("Auch ohne Strafe gewinnt R62 – die ungültigen Ketten sind hier „zufällig“ teuer"
               if a == 0 else "Mit Strafe: ungültige Ketten sind sicher teurer als jede gültige")
        ax.text(0, 1.02, sub, transform=ax.transAxes, fontsize=9.5, color=INK2, va="bottom")
    axes[0].set_ylabel("Energie E = Kosten + Strafe")
    axes[0].set_ylim(0, 140)
    handles = [Patch(color=SERIES, label="gültige Kette (1 Wand)"), Patch(color=AXIS, label="ungültig (3 Wände)")]
    fig.legend(handles=handles, loc="upper right", bbox_to_anchor=(0.99, 0.995), ncol=2)
    fig_title(fig, "Schritt 6 · Energie aller 8 Stellungen – mit und ohne Strafe",
              "Bei ungültigen Ketten ergibt die Kostenformel „Phantasiewerte“ – ob sie hoch oder niedrig sind, "
              "hängt von den Kosten ab")
    fig.subplots_adjust(top=0.78, wspace=0.08, bottom=0.17)
    fig.savefig(path)
    plt.close(fig)


def _board(ax, a1_bits, a2_bits, title: str, verdict: str, ok: bool) -> None:
    blank(ax)
    for t, bits in enumerate([a1_bits, a2_bits]):
        y = -t * 1.5
        ax.text(-0.8, y, f"A{t + 1}", ha="right", va="center", fontsize=12, fontweight="semibold")
        draw_chain(ax, bits, 0, y, spacing=1.15, radius=0.36, labels=bit_labels(t + 1) if t == 0 else None)
        ax.text((NB + 1) * 1.15 + 0.7, y, f"→ R{robot_of(bits)}", ha="left", va="center", fontsize=11.5,
                color=INK, fontweight="semibold")
    if robot_of(a1_bits) == robot_of(a2_bits):
        ax.text((NB + 1) * 1.15 + 0.7, -2.3, f"✗ R{robot_of(a1_bits)} doppelt", ha="left", va="center",
                fontsize=10.5, color=BAD)
    ax.set_xlim(-1.6, (NB + 1) * 1.15 + 3.2)
    ax.set_ylim(-3.6, 1.3)
    ax.set_title(title, fontsize=11, pad=6)
    ax.text(-1.5, -3.2, verdict, ha="left", va="center", fontsize=10.5, color=GOOD if ok else BAD)


def fig_zwei_auftraege(path: Path, res: dict) -> None:
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 4.6))
    _board(ax1, code(62), code(62), "Jeder Auftrag nimmt seinen nächsten Roboter …",
           f"✗ E = {C1[1]} + {C2[1]} + B = {res['gierig']:g}", ok=False)
    _board(ax2, code(63), code(62), "… besser: A1 weicht auf R63 aus",
           f"✓ E = {C1[2]} + {C2[1]} = {res['zwei'][2]:g}  (Minimum aller 64 Stellungen)", ok=True)
    fig_title(fig, "Schritt 7 · Zwei Aufträge: zwei Ketten",
              "Jeder Auftrag bekommt seine eigene Kette aus 3 Bits. Die Spaltenregel „kein Roboter doppelt“ "
              "vergleicht die Wandpositionen.")
    fig.subplots_adjust(top=0.80, wspace=0.1)
    fig.savefig(path)
    plt.close(fig)


def fig_kopplungsgraph(path: Path, res: dict) -> None:
    Qs = res["Q_spalte"]
    fig, ax = plt.subplots(figsize=(9, 5.6))
    blank(ax)
    pos = {i: ((i % NB) * 2.6, 0 if i < NB else -3.2) for i in range(2 * NB)}
    for i in range(NB - 1):
        for off in (0, NB):
            ax.plot(*zip(pos[off + i], pos[off + i + 1]), color=SERIES, lw=2.4, zorder=1)
    for i, j in couplings(Qs):
        (x0, y0), (x1, y1) = pos[i], pos[j]
        coef = Qs[i, j] / B
        ax.plot([x0, x1], [y0, y1], color=ACCENT, lw=2.2 if coef > 0 else 1.6, zorder=1)
        lab = "+2B" if coef == 2 else ("−B" if coef == -1 else f"{coef:+g}B")
        tx, ty = x0 + 0.3 * (x1 - x0), y0 + 0.3 * (y1 - y0)
        ax.text(tx, ty, lab, ha="center", va="center", fontsize=8.5, color=ACCENT, zorder=3,
                bbox=dict(boxstyle="round,pad=0.15", facecolor=SURFACE, edgecolor="none"))
    for i, (x, y) in pos.items():
        t, b = (1, i + 1) if i < NB else (2, i - NB + 1)
        ax.add_patch(plt.Circle((x, y), 0.45, facecolor=SURFACE, edgecolor=INK2, lw=1.4, zorder=2))
        ax.text(x, y, f"$b_{{{t},{b}}}$", ha="center", va="center", fontsize=11, zorder=3)
    ax.text(-1.2, 0, "A1", ha="right", va="center", fontsize=12, fontweight="semibold")
    ax.text(-1.2, -3.2, "A2", ha="right", va="center", fontsize=12, fontweight="semibold")
    ax.set_xlim(-2.0, (NB - 1) * 2.6 + 0.9)
    ax.set_ylim(-4.3, 1.0)
    handles = [Line2D([], [], color=SERIES, lw=2.4, label="Kette: nur eine Wand (−A)"),
               Line2D([], [], color=ACCENT, lw=2.2, label="Spaltenregel: kein Roboter doppelt")]
    ax.legend(handles=handles, loc="upper left", bbox_to_anchor=(0, -0.02), ncol=2)
    fig_title(fig, "Schritt 8 · Was die Hardware verbinden muss",
              f"{2 * NB} Variablen · {res['kopplungen']} Kopplungen: {res['kopplungen_kette']} in den Ketten, "
              f"{res['kopplungen_spalte']} aus der Spaltenregel (One-Hot: 8 Variablen, 16 Kopplungen)")
    fig.subplots_adjust(top=0.86)
    fig.savefig(path)
    plt.close(fig)


def fig_skalierung(path: Path) -> None:
    rs = np.arange(2, 17)
    fig, ax = plt.subplots(figsize=(10, 4.8))
    ax.plot(rs, rs * (rs - 1) // 2, color=ACCENT, lw=1.5, alpha=0.35)
    ax.plot(rs, rs, color=SERIES, lw=1.5, alpha=0.35)
    ax.plot(rs, rs - 2, color=ACCENT, lw=2.2, marker="o", markersize=5, label="Kopplungen = R − 2")
    ax.plot(rs, rs - 1, color=SERIES, lw=2.2, marker="o", markersize=5, label="Variablen = R − 1")
    ax.annotate("One-Hot: R(R−1)/2 Kopplungen", (rs[-1], rs[-1] * (rs[-1] - 1) // 2), xytext=(-8, 0),
                textcoords="offset points", ha="right", va="center", fontsize=9, color=MUTED)
    ax.annotate(f"{rs[-1] - 1} Variablen\n{rs[-1] - 2} Kopplungen", (rs[-1], rs[-1] - 1), xytext=(6, 2),
                textcoords="offset points", va="bottom", fontsize=9.5, color=INK2)
    ax.set_xlabel("Anzahl Roboter R, die für einen Auftrag in Frage kommen")
    ax.set_ylabel("Anzahl pro Auftrag")
    ax.set_xlim(1.5, 18.2)
    ax.grid(True)
    ax.set_axisbelow(True)
    ax.legend(loc="upper left")
    fig_title(fig, "Schritt 9 · Wie Domain Wall mit der Flottengröße wächst",
              "Pro Auftrag wachsen Variablen und Kopplungen nur linear · blass im Hintergrund: One-Hot zum Vergleich")
    fig.subplots_adjust(top=0.85)
    fig.savefig(path)
    plt.close(fig)


def main() -> None:
    res = check()
    OUT.mkdir(parents=True, exist_ok=True)
    fig_codebuch(OUT / "02_codebuch.png")
    fig_zustaende(OUT / "03_zustaende.png")
    fig_qubo(OUT / "04_qubo_matrix.png")
    fig_treppe(OUT / "05_kosten_treppe.png")
    fig_energie(OUT / "06_energie.png")
    fig_zwei_auftraege(OUT / "07_zwei_auftraege.png", res)
    fig_kopplungsgraph(OUT / "08_kopplungsgraph.png", res)
    fig_skalierung(OUT / "09_skalierung.png")
    print(f"Ein Auftrag: Minimum A=0 {res['min_A0']}, A={A} {res[f'min_A{A}']}; "
          f"günstigste ungültige Kette ohne Strafe: {res['min_ungueltig_A0']:g}")
    print(f"Gegenbeispiel {COUNTER.tolist()}: A=0 {res['gegen_A0']}, A={A} {res[f'gegen_A{A}']}")
    print(f"Zwei Aufträge: Minimum {res['zwei']}, gierig {res['gierig']:g}; Kopplungen {res['kopplungen']} "
          f"({res['kopplungen_kette']} Kette, {res['kopplungen_spalte']} Spalte); Spaltenregel min "
          f"{res['spalte_min']:g}; max |Koeffizient| {res['max_koeff']:g}")
    print(f"Abbildungen -> {OUT}")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    main()
