"""One-Hot-Kodierung: erzeugt die Abbildungen für README.md und rechnet alle Zahlen nach.

Aufruf (aus dem Projektordner):
    python encodings/one_hot/illustrate.py

Jede Zahl im README wird hier per Brute Force über alle Zustände geprüft (assert),
damit Text, Abbildungen und Mathematik garantiert zusammenpassen.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Patch, Rectangle  # noqa: E402

from common import (  # noqa: E402
    ACCENT, AXIS, BAD, GOOD, GRID, INK, INK2, MUTED, ROBOT_POS, ROBOTS, SERIES, SURFACE, TASKS, TINT_ACCENT,
    TINT_SERIES, all_states, bits_str, blank, costs, draw_bits, fig_title, qubo_energy,
)

OUT = Path(__file__).resolve().parent / "abbildungen"

A_SMALL = 5  # zu kleine Strafe: kleiner als die kürzeste Distanz
A = 50  # ausreichende Strafe: größer als jede Distanz im Beispiel
B = 50  # Strafe, wenn ein Roboter zwei Aufträge bekäme

R = len(ROBOTS)
C1 = costs("A1")
C2 = costs("A2")


# ---------------------------------------------------------------- QUBO-Bausteine
def one_task_qubo(c: np.ndarray, a: float) -> tuple[np.ndarray, float]:
    """E(x) = Σ c_r x_r + a·(1 − Σ x_r)²  →  Diagonale c_r − a, Paare +2a, Konstante a."""
    n = len(c)
    Q = np.zeros((n, n))
    Q[np.triu_indices(n, 1)] = 2 * a
    Q[np.diag_indices(n)] = c - a
    return Q, float(a)


def two_task_qubo(c1: np.ndarray, c2: np.ndarray, a: float, b: float) -> tuple[np.ndarray, float]:
    """Zwei Aufträge: je eine One-Hot-Gruppe + Strafe b, wenn ein Roboter beide bekommt.

    Variablenreihenfolge: x[A1,61..64], x[A2,61..64].
    """
    Q = np.zeros((2 * R, 2 * R))
    const = 0.0
    for t, c in enumerate([c1, c2]):
        Qt, kt = one_task_qubo(c, a)
        Q[t * R:(t + 1) * R, t * R:(t + 1) * R] = Qt
        const += kt
    for r in range(R):
        Q[r, R + r] += b
    return Q, const


def check() -> dict:
    """Rechnet alle im README genannten Zahlen nach (Brute Force über alle Zustände)."""
    X = all_states(R)
    results = {}
    for a in (A_SMALL, A):
        Q, k = one_task_qubo(C1, a)
        direct = X @ C1 + a * (1 - X.sum(axis=1)) ** 2
        assert np.allclose(qubo_energy(Q, k, X), direct), "QUBO-Matrix stimmt nicht mit Formel überein"
        E = qubo_energy(Q, k, X)
        results[a] = (bits_str(X[E.argmin()]), float(E.min()))
    assert results[A_SMALL] == ("0000", A_SMALL), results[A_SMALL]
    assert results[A] == ("0100", float(C1.min())), results[A]

    X8 = all_states(2 * R)
    Q, k = two_task_qubo(C1, C2, A, B)
    x1, x2 = X8[:, :R], X8[:, R:]
    direct = (x1 @ C1 + x2 @ C2 + A * (1 - x1.sum(1)) ** 2 + A * (1 - x2.sum(1)) ** 2
              + B * (x1 * x2).sum(1))
    assert np.allclose(qubo_energy(Q, k, X8), direct)
    E = qubo_energy(Q, k, X8)
    best = X8[E.argmin()]
    results["zwei"] = (bits_str(best[:R]), bits_str(best[R:]), float(E.min()))
    assert results["zwei"] == ("0010", "0100", 26.0), results["zwei"]
    n_edges = int((np.triu(Q, 1) != 0).sum())
    assert n_edges == 2 * R * (R - 1) // 2 + R
    results["kanten_zwei"] = n_edges
    # Für den Vergleich der Kodierungen: größter Betrag eines QUBO-Koeffizienten
    results["max_koeff"] = float(np.abs(Q).max())
    assert results["max_koeff"] == 2 * A
    return results


# ---------------------------------------------------------------- Abbildungen
def fig_szenario(path: Path) -> None:
    fig, ax = plt.subplots(figsize=(12, 3.4))
    p1, p2 = TASKS["A1"]["xy"], TASKS["A2"]["xy"]
    for r, c in zip(ROBOTS, C1):
        rx, ry = ROBOT_POS[r]
        ax.plot([rx, p1[0]], [ry, p1[1]], color=AXIS, lw=1.6, zorder=1)
        ax.text((rx + p1[0]) / 2, (ry + p1[1]) / 2, str(c), ha="center", va="center", fontsize=10.5,
                color=INK, zorder=2, bbox=dict(boxstyle="round,pad=0.3", facecolor=SURFACE, edgecolor=GRID))
        ax.scatter(rx, ry, marker="P", s=170, color=INK, edgecolor=SURFACE, linewidth=1.5, zorder=3)
        ax.annotate(f"R{r}", (rx, ry), xytext=(0, 11), textcoords="offset points", ha="center",
                    fontsize=11, fontweight="semibold")
    ax.scatter(*p1, marker="s", s=160, color=SERIES, edgecolor=SURFACE, linewidth=1.5, zorder=3)
    ax.annotate("A1 abholen\n(Zwischenlager 5502)", p1, xytext=(-6, -14), textcoords="offset points",
                ha="right", va="top", color=SERIES, fontsize=10, fontweight="semibold")
    ax.scatter(*p2, marker="s", s=120, color=AXIS, edgecolor=SURFACE, linewidth=1.5, zorder=3)
    ax.annotate("A2 (kommt in Schritt 6 dazu)", p2, xytext=(6, -14), textcoords="offset points",
                ha="left", va="top", color=MUTED, fontsize=9.5)
    ax.set_xlim(0, 65)
    ax.set_ylim(9, 22)
    ax.set_aspect("equal")
    ax.grid(True)
    ax.set_axisbelow(True)
    ax.set_xlabel("x (Gitterfelder)")
    ax.set_ylabel("y")
    fig_title(fig, "Schritt 1 · Das Szenario: Wer holt Auftrag A1 ab?",
              "Echte Positionen bei t = 0 s · Zahl an der Linie = Manhattan-Distanz |Δx| + |Δy| zum Abholort = Kosten")
    fig.subplots_adjust(top=0.80, bottom=0.14)
    fig.savefig(path)
    plt.close(fig)


def fig_codebuch(path: Path) -> None:
    fig, ax = plt.subplots(figsize=(10, 4.6))
    blank(ax)
    labels = [f"$x_{{{r}}}$" for r in ROBOTS]
    for i, r in enumerate(ROBOTS):
        y = -i * 1.2
        bits = [int(j == i) for j in range(R)]
        ax.text(0, y, f"„Roboter {r} übernimmt A1“", ha="left", va="center", fontsize=11)
        ax.annotate("", xy=(6.3, y), xytext=(5.0, y), arrowprops=dict(arrowstyle="-|>", color=MUTED, lw=1.2))
        draw_bits(ax, bits, 7.2, y, labels=labels if i == 0 else None)
        ax.text(7.2 + R + 0.1, y, bits_str(bits), ha="left", va="center", fontsize=12, family="monospace", color=INK2)
    ax.set_xlim(-0.2, 13)
    ax.set_ylim(-4.2, 1.4)
    fig_title(fig, "Schritt 2 · Für jeden Roboter ein Schalter",
              "Jede mögliche Antwort auf „Wer übernimmt A1?“ wird eine Reihe aus 4 Bits – genau eines steht auf 1.")
    fig.subplots_adjust(top=0.84)
    fig.savefig(path)
    plt.close(fig)


def fig_zustaende_strafe(path: Path) -> None:
    X = all_states(R)
    k_on = X.sum(axis=1)
    centers = np.arange(R + 1) * 5.0
    spacing, radius = 0.8, 0.28

    fig = plt.figure(figsize=(12, 7.4))
    ax = fig.add_axes([0.05, 0.40, 0.92, 0.48])
    blank(ax)
    for k in range(R + 1):
        group = X[k_on == k][::-1]  # gleiche Reihenfolge wie im Codebuch (1000, 0100, …)
        x0 = centers[k] - spacing * (R - 1) / 2
        valid = k == 1
        if valid:
            ax.add_patch(FancyBboxPatch((x0 - 0.6, -(len(group) - 1) * 0.9 - 0.55), spacing * (R - 1) + 1.2,
                                        (len(group) - 1) * 0.9 + 1.1, boxstyle="round,pad=0.1",
                                        facecolor=GOOD, alpha=0.08, edgecolor="none", zorder=0))
        ax.text(centers[k], 1.25, f"{k} an", ha="center", va="bottom", fontsize=11, fontweight="semibold")
        ax.text(centers[k], 0.8, "✓ gültig" if valid else "✗ ungültig", ha="center", va="bottom",
                fontsize=10, color=GOOD if valid else BAD)
        for j, bits in enumerate(group):
            draw_bits(ax, bits, x0, -j * 0.9, spacing=spacing, radius=radius, fontsize=8.5)
    ax.set_xlim(centers[0] - 2.5, centers[-1] + 2.5)
    ax.set_ylim(-5.0, 1.9)

    fig.canvas.draw()
    pos = ax.get_position()
    ax2 = fig.add_axes([pos.x0, 0.08, pos.width, 0.24])
    pen = (1 - np.arange(R + 1)) ** 2
    bars = ax2.bar(centers, pen, width=2.6, color=[GOOD if k == 1 else AXIS for k in range(R + 1)])
    for bar, p, k in zip(bars, pen, range(R + 1)):
        label = "0  ← Talsohle" if p == 0 else ("A" if p == 1 else f"{p}A")
        ax2.text(bar.get_x() + bar.get_width() / 2, p + 0.25, label, ha="center", va="bottom", fontsize=10,
                 color=INK if k == 1 else INK2)
    ax2.set_xlim(ax.get_xlim())
    ax2.set_ylim(0, 11)
    ax2.set_xticks(centers, [f"{k} an" for k in range(R + 1)])
    ax2.set_yticks([0, 1, 4, 9], ["0", "A", "4A", "9A"])
    ax2.grid(True, axis="y")
    ax2.set_axisbelow(True)
    ax2.set_title(r"Strafe  $P = A \cdot (1 - \sum_r x_r)^2$  – hängt nur davon ab, wie viele Schalter an sind",
                  fontsize=10.5, fontweight="normal", color=INK2)
    fig_title(fig, "Schritt 3 · Alle 16 Schalterstellungen – und eine Strafe für die ungültigen",
              "Oben: alle 2⁴ = 16 Bitmuster, sortiert nach Anzahl eingeschalteter Schalter. "
              "Unten: die Strafe, die jede Spalte bekommt.")
    fig.savefig(path)
    plt.close(fig)


def fig_qubo(path: Path) -> None:
    fig, (ax, axg) = plt.subplots(1, 2, figsize=(12, 5.2), gridspec_kw={"width_ratios": [1, 1]})
    blank(ax)
    names = [f"$x_{{{r}}}$" for r in ROBOTS]
    for i in range(R):
        ax.text(i + 0.5, R + 0.25, names[i], ha="center", va="bottom", fontsize=11)
        ax.text(-0.25, R - i - 0.5, names[i], ha="right", va="center", fontsize=11)
        for j in range(R):
            y = R - i - 1
            if i == j:
                face, text = TINT_SERIES, "−A"
            elif j > i:
                face, text = TINT_ACCENT, "+2A"
            else:
                face, text = SURFACE, ""
            ax.add_patch(Rectangle((j, y), 1, 1, facecolor=face, edgecolor=GRID, linewidth=1.2))
            ax.text(j + 0.5, y + 0.5, text, ha="center", va="center", fontsize=12, color=INK)
    ax.text(0, -0.45, "Konstante: +A\n"
                      "Diagonale (blau): Belohnung fürs Einschalten\n"
                      "oben rechts (orange): Strafe, wenn zwei gleichzeitig an",
            ha="left", va="top", fontsize=9.5, color=INK2, linespacing=1.6)
    ax.set_xlim(-1.2, R + 0.3)
    ax.set_ylim(-2.2, R + 0.9)
    ax.set_title("QUBO-Matrix der Strafe", fontsize=11, pad=4)

    blank(axg)
    angles = np.pi / 2 + np.arange(R) * 2 * np.pi / R
    pts = np.c_[np.cos(angles), np.sin(angles)] * 1.6
    for i in range(R):
        for j in range(i + 1, R):
            axg.plot(*zip(pts[i], pts[j]), color=ACCENT, lw=2.2, zorder=1)
    for i, (x, y) in enumerate(pts):
        axg.add_patch(plt.Circle((x, y), 0.36, facecolor=TINT_SERIES, edgecolor=SERIES, lw=1.6, zorder=2))
        axg.text(x, y, names[i], ha="center", va="center", fontsize=12, zorder=3)
    axg.text(0, -2.3, f"{R} Variablen · {R * (R - 1) // 2} Kopplungen\njeder Schalter hängt an jedem anderen",
             ha="center", va="top", fontsize=10, color=INK2)
    axg.set_xlim(-2.6, 2.6)
    axg.set_ylim(-2.9, 2.3)
    axg.set_title("Als Graph: Knoten = Qubits, Linien = Kopplungen (+2A)", fontsize=11, pad=4)
    fig_title(fig, "Schritt 4 · Aus der Strafe wird eine QUBO-Matrix",
              r"Ausmultipliziert:  $A(1-\sum x_r)^2 = A - A\sum_r x_r + 2A\sum_{r<s} x_r x_s$   (weil $x^2 = x$ für Bits)")
    fig.subplots_adjust(top=0.82, wspace=0.15)
    fig.savefig(path)
    plt.close(fig)


def fig_energie(path: Path) -> None:
    X = all_states(R)
    fig, axes = plt.subplots(1, 2, figsize=(13, 5.0), sharey=True)
    for ax, a in zip(axes, (A_SMALL, A)):
        Q, k = one_task_qubo(C1, a)
        E = qubo_energy(Q, k, X)
        order = np.argsort(E, kind="stable")[:8]
        valid = X[order].sum(axis=1) == 1
        bars = ax.bar(range(8), E[order], width=0.65, color=[SERIES if v else AXIS for v in valid])
        ticks = []
        for i, (idx, v) in enumerate(zip(order, valid)):
            bits = X[idx]
            who = f"✓ R{ROBOTS[int(bits.argmax())]}" if v else ("✗ keiner" if bits.sum() == 0 else f"✗ {bits.sum()} an")
            ticks.append(f"{bits_str(bits)}\n{who}")
            if i > 0:
                ax.text(i, E[idx] + 4, f"{E[idx]:g}", ha="center", va="bottom", fontsize=9.5, color=INK2)
        ax.set_xticks(range(8), ticks, fontsize=9)
        ax.annotate(f"Minimum\nE = {E[order[0]]:g}", (0, E[order[0]] + 1), xytext=(0, 38),
                    textcoords="offset points", ha="center",
                    fontsize=10, fontweight="semibold", color=INK,
                    arrowprops=dict(arrowstyle="-|>", color=INK, lw=1.2))
        ax.grid(True, axis="y")
        ax.set_axisbelow(True)
        ok = valid[0]
        sub = ("Strafe kleiner als die kürzeste Distanz (10) → „niemand fährt“ ist am billigsten"
               if not ok else "Strafe größer als jede Distanz → der nächste Roboter R62 gewinnt")
        ax.set_title(f"A = {a}", pad=22)
        ax.text(0, 1.02, sub, transform=ax.transAxes, fontsize=9.5, color=BAD if not ok else GOOD, va="bottom")
    axes[0].set_ylabel("Energie E = Kosten + Strafe")
    axes[0].set_ylim(0, 120)
    handles = [Patch(color=SERIES, label="gültige Zuweisung (genau 1 an)"), Patch(color=AXIS, label="ungültig")]
    fig.legend(handles=handles, loc="upper right", bbox_to_anchor=(0.99, 0.995), ncol=2)
    fig_title(fig, "Schritt 5 · Kosten + Strafe: der Solver sucht die niedrigste Energie",
              r"$E(x) = \sum_r c_r x_r + A\,(1-\sum_r x_r)^2$  · gezeigt: die 8 günstigsten der 16 Zustände")
    fig.subplots_adjust(top=0.78, wspace=0.08, bottom=0.17)
    fig.savefig(path)
    plt.close(fig)


def _board(ax, a1_bits, a2_bits, title: str, verdict: str, ok: bool) -> None:
    blank(ax)
    for t, (bits, c) in enumerate([(a1_bits, C1), (a2_bits, C2)]):
        y = -t * 1.5
        ax.text(-0.9, y, f"A{t + 1}", ha="right", va="center", fontsize=12, fontweight="semibold")
        draw_bits(ax, bits, 0, y, spacing=1.3, radius=0.38)
        for r in range(R):
            ax.text(r * 1.3, y - 0.52, f"{c[r]}", ha="center", va="top", fontsize=9, color=INK2)
        row_ok = sum(bits) == 1
        ax.text(R * 1.3 - 0.4, y, f"Σ = {sum(bits)} {'✓' if row_ok else '✗'}", ha="left", va="center",
                fontsize=10, color=GOOD if row_ok else BAD)
    for r in range(R):
        ax.text(r * 1.3, 0.62, f"R{ROBOTS[r]}", ha="center", va="bottom", fontsize=11, fontweight="semibold")
        col = a1_bits[r] + a2_bits[r]
        if col > 1:
            ax.add_patch(FancyBboxPatch((r * 1.3 - 0.55, -2.25), 1.1, 3.25, boxstyle="round,pad=0.05",
                                        facecolor="none", edgecolor=BAD, lw=2))
            ax.text(r * 1.3, -2.45, "✗ doppelt", ha="center", va="top", fontsize=10, color=BAD)
    ax.set_xlim(-1.6, R * 1.3 + 0.8)
    ax.set_ylim(-3.6, 1.3)
    ax.set_title(title, fontsize=11, pad=6)
    ax.text(-1.5, -3.25, verdict, ha="left", va="center", fontsize=10.5, color=GOOD if ok else BAD)


def fig_zwei_auftraege(path: Path) -> None:
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 4.8))
    greedy1, greedy2 = [0, 1, 0, 0], [0, 1, 0, 0]
    best1, best2 = [0, 0, 1, 0], [0, 1, 0, 0]
    e_greedy = C1[1] + C2[1] + B
    e_best = C1[2] + C2[1]
    _board(ax1, greedy1, greedy2, "Jeder Auftrag nimmt seinen nächsten Roboter …",
           f"✗ R62 hätte zwei Aufträge · E = {C1[1]} + {C2[1]} + B = {e_greedy:g}", ok=False)
    _board(ax2, best1, best2, "… besser: A1 weicht auf R63 aus",
           f"✓ alle Regeln erfüllt · E = {C1[2]} + {C2[1]} = {e_best:g}  (Minimum aller 256 Zustände)", ok=True)
    fig_title(fig, "Schritt 6 · Zwei Aufträge: aus der Schalterreihe wird ein Schachbrett",
              "Zeile = Auftrag (genau ein Schalter an) · Spalte = Roboter (höchstens ein Schalter an) · "
              "kleine Zahl = Distanz")
    fig.subplots_adjust(top=0.80, wspace=0.1)
    fig.savefig(path)
    plt.close(fig)


def fig_kopplungsgraph(path: Path, n_edges: int) -> None:
    fig, ax = plt.subplots(figsize=(9, 5.4))
    blank(ax)
    pos = {(t, r): (r * 2.2, -t * 3.0) for t in range(2) for r in range(R)}
    for t in range(2):
        sign = -1 if t == 0 else 1  # A1-Bögen nach oben, A2-Bögen nach unten
        for i in range(R):
            for j in range(i + 1, R):
                rad = sign * (0.0 if j == i + 1 else 0.35 + 0.1 * (j - i - 2))
                ax.add_patch(FancyArrowPatch(pos[(t, i)], pos[(t, j)], arrowstyle="-", color=SERIES, lw=2,
                                             shrinkA=14, shrinkB=14, connectionstyle=f"arc3,rad={rad}", zorder=1))
    for r in range(R):
        ax.add_patch(FancyArrowPatch(pos[(0, r)], pos[(1, r)], arrowstyle="-", color=ACCENT, lw=2.2,
                                     shrinkA=14, shrinkB=14, zorder=1))
    for (t, r), (x, y) in pos.items():
        ax.add_patch(plt.Circle((x, y), 0.42, facecolor=SURFACE, edgecolor=INK2, lw=1.4, zorder=2))
        ax.text(x, y, f"$x_{{{t + 1},{ROBOTS[r]}}}$", ha="center", va="center", fontsize=10.5, zorder=3)
    ax.text(-1.2, 0, "A1", ha="right", va="center", fontsize=12, fontweight="semibold")
    ax.text(-1.2, -3.0, "A2", ha="right", va="center", fontsize=12, fontweight="semibold")
    ax.set_xlim(-2.0, (R - 1) * 2.2 + 0.8)
    ax.set_ylim(-5.6, 2.6)
    handles = [Line2D([], [], color=SERIES, lw=2, label="Zeilenregel: genau ein Roboter je Auftrag (+2A)"),
               Line2D([], [], color=ACCENT, lw=2, label="Spaltenregel: kein Roboter doppelt (+B)")]
    ax.legend(handles=handles, loc="upper left", bbox_to_anchor=(0, -0.02), ncol=2)
    n_row = 2 * R * (R - 1) // 2
    fig_title(fig, "Schritt 7 · Was die Hardware verbinden muss",
              f"{2 * R} Variablen (Qubits) · {n_edges} Kopplungen: {n_row} aus den Zeilenregeln, "
              f"{R} aus der Spaltenregel")
    fig.subplots_adjust(top=0.86)
    fig.savefig(path)
    plt.close(fig)


def fig_skalierung(path: Path) -> None:
    rs = np.arange(2, 17)
    var = rs
    cpl = rs * (rs - 1) // 2
    fig, ax = plt.subplots(figsize=(10, 4.8))
    ax.plot(rs, cpl, color=ACCENT, lw=2, marker="o", markersize=5, label="Kopplungen = R(R−1)/2")
    ax.plot(rs, var, color=SERIES, lw=2, marker="o", markersize=5, label="Variablen = R")
    ax.annotate(f"{cpl[-1]} Kopplungen", (rs[-1], cpl[-1]), xytext=(6, 0), textcoords="offset points",
                va="center", color=INK2, fontsize=9.5)
    ax.annotate(f"{var[-1]} Variablen", (rs[-1], var[-1]), xytext=(6, 0), textcoords="offset points",
                va="center", color=INK2, fontsize=9.5)
    ax.axvline(4, color=AXIS, lw=1)
    ax.annotate("unser Beispiel: R = 4\n4 Variablen, 6 Kopplungen", (4, 6), xytext=(14, 40),
                textcoords="offset points", fontsize=9.5, color=INK2,
                arrowprops=dict(arrowstyle="-|>", color=INK2, lw=1))
    ax.set_xlabel("Anzahl Roboter R, die für einen Auftrag in Frage kommen")
    ax.set_ylabel("Anzahl pro Auftrag")
    ax.set_xlim(1.5, 17.8)
    ax.grid(True)
    ax.set_axisbelow(True)
    ax.legend(loc="upper left")
    fig_title(fig, "Schritt 8 · Wie One-Hot mit der Flottengröße wächst",
              "Pro Auftrag: Variablen wachsen linear, Kopplungen (die Clique) quadratisch")
    fig.subplots_adjust(top=0.85)
    fig.savefig(path)
    plt.close(fig)


def main() -> None:
    results = check()
    OUT.mkdir(parents=True, exist_ok=True)
    fig_szenario(OUT / "01_szenario.png")
    fig_codebuch(OUT / "02_codebuch.png")
    fig_zustaende_strafe(OUT / "03_zustaende_und_strafe.png")
    fig_qubo(OUT / "04_qubo_matrix.png")
    fig_energie(OUT / "05_energie.png")
    fig_zwei_auftraege(OUT / "06_zwei_auftraege.png")
    fig_kopplungsgraph(OUT / "07_kopplungsgraph.png", results["kanten_zwei"])
    fig_skalierung(OUT / "08_skalierung.png")
    print(f"Kosten A1 = {C1.tolist()}, A2 = {C2.tolist()}")
    print(f"Ein Auftrag, A = {A_SMALL}: Minimum {results[A_SMALL]}")
    print(f"Ein Auftrag, A = {A}: Minimum {results[A]}")
    print(f"Zwei Aufträge, A = B = {A}: Minimum A1={results['zwei'][0]}, A2={results['zwei'][1]}, "
          f"E={results['zwei'][2]:g}; Kopplungen: {results['kanten_zwei']}; max |Koeffizient|: {results['max_koeff']:g}")
    print(f"Abbildungen -> {OUT}")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    main()
