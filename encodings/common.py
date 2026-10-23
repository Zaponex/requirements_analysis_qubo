"""Gemeinsame Bausteine für die Kodierungs-Illustrationen.

Enthält
- das laufende Beispiel (echte Daten aus der Simulation),
- den Grafikstil (gleiche Farbrollen wie in analysis/plots.py),
- kleine Rechen- und Zeichenhilfen (alle Zustände aufzählen, QUBO-Energie, Schalter zeichnen).

Alle Kodierungen (One-Hot, Domain Wall, Binary) nutzen dieses Beispiel, damit sie
direkt vergleichbar sind.
"""
from __future__ import annotations

import itertools
import logging

import matplotlib

matplotlib.use("Agg")
logging.getLogger("matplotlib.font_manager").setLevel(logging.ERROR)
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

# ---------------------------------------------------------------- Laufendes Beispiel
# Lauf 2026-10-09_12-59-39, Snapshot zu transport_id 1 (t = 0 s): alle vier Roboter
# sind frei, die Aufträge 1 und 2 gehen gleichzeitig ein.
RUN_ID = "2026-10-09_12-59-39"
ROBOTS = [61, 62, 63, 64]
ROBOT_POS = {61: (48, 17), 62: (21, 19), 63: (5, 19), 64: (61, 18)}
TASKS = {
    "A1": {"transport_id": 1, "pickup": "Zwischenlager 5502", "xy": (17, 13)},
    "A2": {"transport_id": 2, "pickup": "Zwischenlager 5508", "xy": (23, 13)},
}


def manhattan(a: tuple[int, int], b: tuple[int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def costs(task: str) -> np.ndarray:
    """Kosten = Manhattan-Distanz jedes Roboters zum Abholort (Reihenfolge wie ROBOTS)."""
    return np.array([manhattan(ROBOT_POS[r], TASKS[task]["xy"]) for r in ROBOTS])


# ---------------------------------------------------------------- Rechnen
def all_states(n: int) -> np.ndarray:
    """Alle 2^n Bitmuster der Länge n, Zeile für Zeile (0000, 0001, …)."""
    return np.array(list(itertools.product([0, 1], repeat=n)), dtype=int)


def qubo_energy(Q: np.ndarray, const: float, X: np.ndarray) -> np.ndarray:
    """Energie E(x) = xᵀQx + const für jede Zeile von X (Q obere Dreiecksmatrix)."""
    X = np.atleast_2d(X)
    return np.einsum("si,ij,sj->s", X, Q, X) + const


def bits_str(bits) -> str:
    return "".join(str(int(b)) for b in bits)


# ---------------------------------------------------------------- Polynome über Bits
# Ein Polynom ist ein dict {frozenset(Variablennamen): Koeffizient}; frozenset() ist die Konstante.
# Wegen x² = x für Bits ist jedes Monom einfach eine Menge von Variablen.
Poly = dict


def p_const(c: float) -> Poly:
    return {frozenset(): float(c)}


def p_var(name: str) -> Poly:
    return {frozenset([name]): 1.0}


def p_add(*polys: Poly) -> Poly:
    out: dict = {}
    for p in polys:
        for k, c in p.items():
            out[k] = out.get(k, 0.0) + c
    return {k: c for k, c in out.items() if abs(c) > 1e-12}


def p_scale(p: Poly, s: float) -> Poly:
    return {k: c * s for k, c in p.items()}


def p_mul(*polys: Poly) -> Poly:
    out = p_const(1)
    for q in polys:
        prod: dict = {}
        for k1, c1 in out.items():
            for k2, c2 in q.items():
                prod[k1 | k2] = prod.get(k1 | k2, 0.0) + c1 * c2
        out = {k: c for k, c in prod.items() if abs(c) > 1e-12}
    return out


def p_eval(p: Poly, names: list[str], X: np.ndarray) -> np.ndarray:
    """Wert des Polynoms für jede Zeile von X (Spalten in der Reihenfolge von names)."""
    X = np.atleast_2d(X)
    idx = {n: i for i, n in enumerate(names)}
    out = np.zeros(len(X))
    for k, c in p.items():
        term = np.ones(len(X))
        for v in k:
            term = term * X[:, idx[v]]
        out += c * term
    return out


def p_degree_counts(p: Poly) -> dict[int, int]:
    """Anzahl Terme je Grad (ohne Konstante), z.B. {1: 4, 2: 6, 3: 4, 4: 1}."""
    counts: dict[int, int] = {}
    for k in p:
        if k:
            counts[len(k)] = counts.get(len(k), 0) + 1
    return dict(sorted(counts.items()))


def p_to_qubo(p: Poly, names: list[str]) -> tuple[np.ndarray, float]:
    """Polynom vom Grad ≤ 2 → obere Dreiecksmatrix Q und Konstante."""
    idx = {n: i for i, n in enumerate(names)}
    Q = np.zeros((len(names), len(names)))
    const = 0.0
    for k, c in p.items():
        if len(k) > 2:
            raise ValueError(f"Term vom Grad {len(k)} ist kein QUBO-Term: {sorted(k)}")
        if not k:
            const += c
        elif len(k) == 1:
            (v,) = k
            Q[idx[v], idx[v]] += c
        else:
            i, j = sorted(idx[v] for v in k)
            Q[i, j] += c
    return Q, const


def couplings(Q: np.ndarray) -> list[tuple[int, int]]:
    """Alle Paare (i, j) mit i < j, die in Q gekoppelt sind."""
    return [(int(i), int(j)) for i, j in zip(*np.nonzero(np.triu(Q, 1)))]


# ---------------------------------------------------------------- Stil
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
AXIS = "#c3c2b7"
SERIES = "#2a78d6"  # Schalter „an“ / einzelne Datenreihe
ACCENT = "#eb6834"  # zweite Rolle (z.B. Spaltenregel), Slot 2 der geprüften Palette
GOOD = "#0ca30c"  # Status: gültig – immer mit ✓ und Text
BAD = "#d03b3b"  # Status: ungültig – immer mit ✗ und Text

plt.rcParams.update({
    "figure.facecolor": SURFACE,
    "axes.facecolor": SURFACE,
    "savefig.facecolor": SURFACE,
    "font.family": ["Segoe UI", "Segoe UI Symbol", "DejaVu Sans"],
    "font.size": 10,
    "text.color": INK,
    "axes.labelcolor": INK2,
    "axes.titlecolor": INK,
    "axes.titlesize": 11.5,
    "axes.titleweight": "semibold",
    "axes.titlelocation": "left",
    "axes.edgecolor": AXIS,
    "axes.linewidth": 0.8,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "xtick.color": AXIS,
    "ytick.color": AXIS,
    "xtick.labelcolor": INK2,
    "ytick.labelcolor": INK2,
    "grid.color": GRID,
    "grid.linewidth": 0.6,
    "legend.frameon": False,
    "legend.fontsize": 9,
    "mathtext.fontset": "dejavusans",
    "savefig.dpi": 150,
    "savefig.bbox": "tight",
})


def fig_title(fig, title: str, subtitle: str | None = None) -> None:
    """Titel (und Untertitel) oben links über der ganzen Abbildung."""
    fig.text(0.01, 0.995, title, ha="left", va="top", fontsize=12.5, fontweight="semibold", color=INK)
    if subtitle:
        # Fester Abstand in Zoll, damit Titel und Untertitel bei jeder Figurhöhe sauber untereinander stehen.
        fig.text(0.01, 0.995 - 0.30 / fig.get_figheight(), subtitle, ha="left", va="top", fontsize=9.5, color=INK2)


def blank(ax) -> None:
    """Achse ohne Rahmen und Ticks – für Schemazeichnungen."""
    ax.set_axis_off()
    ax.set_aspect("equal")


TINT_SERIES = "#cde2fb"
TINT_ACCENT = "#fbe0d4"


def draw_matrix(ax, cells: list[list[str]], names: list[str], tints: list[list[str]] | None = None,
                fontsize: float = 12) -> None:
    """Zeichnet eine (obere Dreiecks-)Matrix als Tabelle mit Text in den Zellen."""
    n = len(names)
    for i in range(n):
        ax.text(i + 0.5, n + 0.25, names[i], ha="center", va="bottom", fontsize=11)
        ax.text(-0.25, n - i - 0.5, names[i], ha="right", va="center", fontsize=11)
        for j in range(n):
            face = tints[i][j] if tints else SURFACE
            ax.add_patch(plt.Rectangle((j, n - i - 1), 1, 1, facecolor=face, edgecolor=GRID, linewidth=1.2))
            ax.text(j + 0.5, n - i - 0.5, cells[i][j], ha="center", va="center", fontsize=fontsize, color=INK)


def draw_bits(ax, bits, x0: float, y0: float, spacing: float = 1.0, radius: float = 0.34,
              labels: list[str] | None = None, on_color: str = SERIES, fontsize: float = 11) -> None:
    """Zeichnet eine Reihe Schalter: gefüllter Kreis = 1 (an), leerer Kreis = 0 (aus)."""
    for i, b in enumerate(bits):
        cx = x0 + i * spacing
        ax.add_patch(plt.Circle((cx, y0), radius, facecolor=on_color if b else SURFACE,
                                edgecolor=on_color if b else AXIS, linewidth=1.6, zorder=3))
        ax.text(cx, y0, str(int(b)), ha="center", va="center", fontsize=fontsize, fontweight="semibold",
                color=SURFACE if b else MUTED, zorder=4)
        if labels:
            ax.text(cx, y0 + radius + 0.18, labels[i], ha="center", va="bottom", fontsize=8.5, color=INK2)
