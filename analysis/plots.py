"""Visualisierungen eines Simulationslaufs (PNG).

Farben folgen festen Rollen und bleiben über Läufe hinweg stabil:
- Bereiche (Maschinentypen) und Roboter-Status haben feste, auf
  Farbfehlsichtigkeit geprüfte Farben (siehe AREA_COLORS / STATUS_COLORS).
- Eine einzelne Datenreihe nutzt immer SERIES.
- Größen (Distanzen, Anzahlen) nutzen eine einfarbige Blau-Skala hell → dunkel.
Unbekannte Bereiche/Status fallen auf Grau („Andere“) zurück, statt neue Farben zu erzeugen.
"""
from __future__ import annotations

import logging
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
logging.getLogger("matplotlib.font_manager").setLevel(logging.ERROR)
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402
from matplotlib.ticker import MaxNLocator  # noqa: E402

from features import WINDOW_SIZES, requests_per_window  # noqa: E402
from loader import Run  # noqa: E402

# ---------------------------------------------------------------- Farben & Stil
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
AXIS = "#c3c2b7"
SERIES = "#2a78d6"

# Prozessreihenfolge der Bereiche; Farbsatz mit validate_palette (alle Paare) geprüft.
AREA_ORDER = ["ENTPACKUNG", "VERBLISTERUNG", "AUFROLLER", "KONTROLLE", "KOMMISSIONIERUNG"]
AREA_COLORS = dict(zip(AREA_ORDER, ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7"]))

STATUS_ORDER = ["IDLE", "MOVING_TO_PICKUP", "LOADING", "MOVING_TO_DROP_OFF", "MOVING_TO_BASE"]
STATUS_COLORS = {
    "IDLE": AXIS,  # Leerlauf tritt bewusst zurück
    "MOVING_TO_PICKUP": "#2a78d6",
    "LOADING": "#eb6834",
    "MOVING_TO_DROP_OFF": "#1baf7a",
    "MOVING_TO_BASE": "#4a3aa7",
}
STATUS_LABELS = {
    "IDLE": "Leerlauf",
    "MOVING_TO_PICKUP": "Fahrt zur Abholung",
    "LOADING": "Beladen",
    "MOVING_TO_DROP_OFF": "Fahrt zur Abgabe",
    "MOVING_TO_BASE": "Rückfahrt zur Basis",
}
OTHER_COLOR = INK2

# Reihenfolge der Kategorien entlang des Materialflusses (für Achsen).
FLOW_ORDER = ["Quelle", "ENTPACKUNG", "Zwischenlager", "VERBLISTERUNG", "AUFROLLER", "KONTROLLE", "KOMMISSIONIERUNG", "Senke"]
STAGE_ORDER = ["Roh", "Entpackt", "Ungerollt_Unkontr_Verpackt", "Unkontr_Verpackt", "Kontr_Verpackt", "Kommiss_Kontr_Verpackt"]

KIND_MARKERS = {"Maschine": "o", "Zwischenlager": "s", "Quelle": "^", "Senke": "v"}

SEQ_RAMP = ["#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
            "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"]
SEQ_CMAP = LinearSegmentedColormap.from_list("seq_blau", SEQ_RAMP)

plt.rcParams.update({
    "figure.facecolor": SURFACE,
    "axes.facecolor": SURFACE,
    "savefig.facecolor": SURFACE,
    "font.family": ["Segoe UI", "DejaVu Sans"],
    "font.size": 9.5,
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
    "grid.linestyle": "-",
    "legend.frameon": False,
    "legend.fontsize": 8.5,
    "lines.linewidth": 2,
    "savefig.dpi": 150,
    "savefig.bbox": "tight",
})


def _title(ax, title: str, subtitle: str | None = None) -> None:
    ax.set_title(title, pad=20 if subtitle else 8)
    if subtitle:
        ax.text(0, 1.02, subtitle, transform=ax.transAxes, color=INK2, fontsize=8.5, va="bottom")


def _fig_title(fig, title: str, top: float) -> None:
    """Gesamttitel oben links; Achsen beginnen unterhalb von `top` (Anteil der Figurhöhe)."""
    fig.tight_layout(rect=(0, 0, 1, top))
    fig.text(0.01, 0.985, title, ha="left", va="top", fontsize=11.5, fontweight="semibold", color=INK)


def _category(kind: str, area: str | None) -> str:
    return area if kind == "Maschine" and area else kind


def _category_label(cat: str) -> str:
    return cat.capitalize() if cat.isupper() else cat


def _area_color(area: str | None) -> str:
    return AREA_COLORS.get(area, OTHER_COLOR)


def _status_color(status: str) -> str:
    return STATUS_COLORS.get(status, OTHER_COLOR)


def _ordered(values, order: list[str]) -> list[str]:
    present = list(dict.fromkeys(values))
    return [v for v in order if v in present] + sorted(v for v in present if v not in order)


def _hbar_labels(ax, bars, values) -> None:
    for bar, v in zip(bars, values):
        ax.text(bar.get_width(), bar.get_y() + bar.get_height() / 2, f" {v}", va="center", color=INK2, fontsize=8.5)


def _vbar_labels(ax, bars, values) -> None:
    for bar, v in zip(bars, values):
        if v > 0:
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height(), f"{v}", ha="center", va="bottom", color=INK2, fontsize=8.5)


def _draw_entities(ax, entities: pd.DataFrame, muted: bool = False, size: float = 55) -> None:
    for _, e in entities.iterrows():
        color = AXIS if muted else (_area_color(e["area"]) if e["kind"] == "Maschine" else INK2)
        ax.scatter(e["x"], e["y"], marker=KIND_MARKERS.get(e["kind"], "D"), s=size, color=color,
                   edgecolor=SURFACE, linewidth=1.5, zorder=3)


# ---------------------------------------------------------------- 1 Layout
def plot_layout(run: Run, tasks: pd.DataFrame, matrix: pd.DataFrame, path: Path) -> None:
    ent = run.entities
    coords = ent.set_index("entity")[["x", "y"]]
    flows = tasks.groupby(["from_entity", "to_entity"]).size()
    max_flow = flows.max()

    fig, ax = plt.subplots(figsize=(13, 6.2))
    for (a, b), n in flows.items():
        (x0, y0), (x1, y1) = coords.loc[a].to_numpy(), coords.loc[b].to_numpy()
        ax.annotate(
            "", xy=(x1, y1), xytext=(x0, y0), zorder=1,
            arrowprops=dict(arrowstyle="-|>,head_length=0.45,head_width=0.22", lw=0.5 + 2.5 * n / max_flow,
                            color=MUTED, alpha=0.6, shrinkA=6, shrinkB=6, connectionstyle="arc3,rad=0.12"),
        )
    _draw_entities(ax, ent, size=70)

    # Maschinennummern klein, Bereichsnamen einmal pro Cluster
    for _, e in ent.iterrows():
        short = e["entity"].split(":")[-1].strip()
        if e["kind"] == "Maschine":
            ax.annotate(short, (e["x"], e["y"]), xytext=(4, -9), textcoords="offset points", fontsize=6.5, color=MUTED)
        else:
            label = {"Zwischenlager": f"ZL {short}"}.get(e["kind"], e["kind"])
            ax.annotate(label, (e["x"], e["y"]), xytext=(5, 4), textcoords="offset points", fontsize=7.5, color=INK2)
    machines = ent[ent["kind"] == "Maschine"]
    for area, grp in machines.groupby("area"):
        # Über dem Cluster platzieren – und über benachbarten fremden Entitäten, damit deren Labels frei bleiben.
        near = ent[ent["x"].between(grp["x"].min() - 2, grp["x"].max() + 2)
                   & ent["y"].between(grp["y"].min(), grp["y"].max() + 2)]
        top = max(near["y"].max(), grp["y"].max())
        offset = 9 if top == grp["y"].max() else 18
        ax.annotate(_category_label(area), (grp["x"].mean(), top), xytext=(0, offset),
                    textcoords="offset points", ha="center", fontsize=8.5, color=INK, fontweight="semibold",
                    bbox=dict(facecolor=SURFACE, edgecolor="none", alpha=0.85, pad=1.5), zorder=6)

    for _, r in run.robots.iterrows():
        ax.scatter(r["base_x"], r["base_y"], marker="P", s=80, color=INK, edgecolor=SURFACE, linewidth=1.5, zorder=4)
        ax.annotate(f"R{r['robot_id']}", (r["base_x"], r["base_y"]), xytext=(5, -10), textcoords="offset points",
                    fontsize=7.5, color=INK)

    ax.set_aspect("equal")
    xs = pd.concat([ent["x"], run.robots["base_x"]])
    ys = pd.concat([ent["y"], run.robots["base_y"]])
    ax.set_xlim(xs.min() - 2, xs.max() + 3)
    ax.set_ylim(ys.min() - 2, ys.max() + 3)
    ax.grid(True)
    ax.set_axisbelow(True)
    ax.set_xlabel("x (Gitterzellen)")
    ax.set_ylabel("y (Gitterzellen)")

    handles = [Line2D([], [], marker="o", ls="", color=AREA_COLORS[a], markersize=7, label=_category_label(a))
               for a in AREA_ORDER if a in set(machines["area"])]
    if (machines["area"].map(lambda a: a not in AREA_COLORS)).any():
        handles.append(Line2D([], [], marker="o", ls="", color=OTHER_COLOR, markersize=7, label="Anderer Bereich"))
    handles += [Line2D([], [], marker=KIND_MARKERS[k], ls="", color=INK2, markersize=7, label=k)
                for k in ["Zwischenlager", "Quelle", "Senke"] if k in set(ent["kind"])]
    handles += [Line2D([], [], marker="P", ls="", color=INK, markersize=8, label="Roboter-Basis"),
                Line2D([], [], color=MUTED, lw=2, label="Transportfluss")]
    ax.legend(handles=handles, loc="upper left", bbox_to_anchor=(1.01, 1), borderaxespad=0)
    _title(ax, "Layout & Materialfluss",
           f"{len(tasks)} Transportanfragen · Pfeilstärke = Anzahl Transporte zwischen zwei Entitäten (max. {max_flow})")
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------- 2 Übergänge
def plot_transitions(run: Run, tasks: pd.DataFrame, matrix: pd.DataFrame, path: Path) -> None:
    src = [_category(k, a) for k, a in zip(tasks["from_kind"], tasks["from_area"])]
    dst = [_category(k, a) for k, a in zip(tasks["to_kind"], tasks["to_area"])]
    cats = _ordered(src + dst, FLOW_ORDER)
    counts = pd.crosstab(pd.Series(src, name="von"), pd.Series(dst, name="nach")).reindex(index=cats, columns=cats, fill_value=0)

    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(13, 5.2), gridspec_kw={"width_ratios": [1.15, 1]})
    data = np.ma.masked_equal(counts.to_numpy(), 0)
    ax.imshow(data, cmap=SEQ_CMAP.with_extremes(bad=SURFACE), vmin=0, vmax=counts.to_numpy().max(), aspect="auto")
    vmax = counts.to_numpy().max()
    for i in range(len(cats)):
        for j in range(len(cats)):
            v = counts.iat[i, j]
            if v:
                ax.text(j, i, str(v), ha="center", va="center", fontsize=9,
                        color=SURFACE if v > 0.45 * vmax else INK)
    labels = [_category_label(c) for c in cats]
    ax.set_xticks(range(len(cats)), labels, rotation=35, ha="right")
    ax.set_yticks(range(len(cats)), labels)
    ax.set_xticks(np.arange(-0.5, len(cats)), minor=True)
    ax.set_yticks(np.arange(-0.5, len(cats)), minor=True)
    ax.grid(which="minor", color=GRID, linewidth=0.8)
    ax.tick_params(which="both", length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_xlabel("nach (Ziel)")
    ax.set_ylabel("von (Abholung)")
    _title(ax, "Übergänge zwischen Bereichen", "Anzahl Transportanfragen je Kombination Abholung → Ziel")

    stages = tasks["material_stage"].value_counts()
    order = _ordered(stages.index, STAGE_ORDER)
    vals = [int(stages[s]) for s in order]
    bars = ax2.barh(range(len(order)), vals, color=SERIES, height=0.6)
    ax2.set_yticks(range(len(order)), [s.replace("_", " ") for s in order])
    ax2.invert_yaxis()
    _hbar_labels(ax2, bars, vals)
    ax2.set_xlabel("Anzahl Transportanfragen")
    ax2.grid(True, axis="x")
    ax2.set_axisbelow(True)
    ax2.tick_params(axis="y", length=0)
    _title(ax2, "Materialstufen", "Prozessstufe des transportierten Materials (aus material_id)")
    fig.tight_layout(w_pad=4)
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------- 3 Zeitlinie
def plot_timeline(run: Run, tasks: pd.DataFrame, matrix: pd.DataFrame, path: Path) -> None:
    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(13, 4.4), gridspec_kw={"width_ratios": [1.4, 1]})
    t = tasks["time"].to_numpy()
    ax.step(np.r_[t, t.max()], np.r_[np.arange(1, len(t) + 1), len(t)], where="post", color=SERIES)
    ax.plot(t, np.zeros_like(t), "|", color=SERIES, markersize=10, alpha=0.6, clip_on=False)
    ax.set_ylim(0, len(t) * 1.05)
    ax.set_xlabel("Simulationszeit (s)")
    ax.set_ylabel("Anfragen kumuliert")
    ax.grid(True)
    ax.set_axisbelow(True)
    _title(ax, "Eingang der Transportanfragen", "Kumulierte Anzahl · Striche unten = einzelne Anfragen")

    ia = tasks["inter_arrival"].dropna()
    bins = np.arange(0, ia.max() + 5, 5)
    ax2.hist(ia, bins=bins, color=SERIES, edgecolor=SURFACE, linewidth=1)
    med = ia.median()
    ax2.axvline(med, color=INK2, lw=1)
    ax2.annotate(f"Median {med:.0f} s", (med, ax2.get_ylim()[1]), xytext=(4, -12), textcoords="offset points",
                 color=INK2, fontsize=8.5)
    ax2.set_xlabel("Zeit zwischen zwei Anfragen (s)")
    ax2.set_ylabel("Anzahl")
    ax2.grid(True, axis="y")
    ax2.set_axisbelow(True)
    n_zero = int((ia == 0).sum())
    _title(ax2, "Zwischenankunftszeiten", f"Klassenbreite 5 s · {n_zero} Anfragen zeitgleich mit der vorherigen")
    fig.tight_layout(w_pad=4)
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------- 4 Flottenzustand
def plot_fleet_state(run: Run, tasks: pd.DataFrame, matrix: pd.DataFrame, path: Path) -> None:
    fl = run.fleet.sort_values(["time", "transport_id"])
    robots = sorted(fl["robot_id"].unique())
    n = len(robots)
    # Drei Blöcke untereinander: Status (Gantt) · Akku je Roboter · Anzahl verfügbarer Roboter
    fig = plt.figure(figsize=(13, 2.6 + 1.2 * n))
    outer = fig.add_gridspec(3, 1, height_ratios=[0.6 * n, 0.6 * n, 1.1], hspace=0.38, top=0.9)
    ax = fig.add_subplot(outer[0])
    bat_gs = outer[1].subgridspec(n, 1, hspace=0.55)
    bat_axes = [fig.add_subplot(bat_gs[i], sharex=ax) for i in range(n)]
    ax2 = fig.add_subplot(outer[2], sharex=ax)

    statuses = _ordered(fl["status"], STATUS_ORDER)
    for row, rid in enumerate(robots):
        r = fl[fl["robot_id"] == rid].drop_duplicates("time", keep="last")
        times = r["time"].to_numpy()
        for i in range(len(r) - 1):
            ax.broken_barh([(times[i], times[i + 1] - times[i])], (row - 0.36, 0.72),
                           facecolors=_status_color(r["status"].iat[i]), edgecolor=SURFACE, linewidth=0.8)
    ax.set_yticks(range(len(robots)), [f"R{r}" for r in robots])
    ax.invert_yaxis()
    ax.tick_params(axis="y", length=0)
    ax.spines["left"].set_visible(False)
    handles = [Patch(color=_status_color(s), label=STATUS_LABELS.get(s, s)) for s in statuses]
    ax.legend(handles=handles, loc="upper left", bbox_to_anchor=(1.01, 1), borderaxespad=0, handlelength=1.2)
    _title(ax, "Flottenzustand über die Zeit", "Status nur zu Anfragezeitpunkten bekannt, dazwischen fortgeschrieben")
    ax.tick_params(axis="x", labelbottom=False)

    # Akkustand: neutrale Farbe, damit er nicht mit den Statusfarben verwechselt wird.
    battery = fl["battery_percent"]
    if battery.nunique() == 1:
        note = f"in allen Snapshots konstant {battery.iloc[0]:g} %"
    else:
        note = f"Spannweite {battery.min():g}–{battery.max():g} %"
    for bax, rid in zip(bat_axes, robots):
        r = fl[fl["robot_id"] == rid].drop_duplicates("time", keep="last")
        bax.fill_between(r["time"], r["battery_percent"], step="post", color=INK2, alpha=0.12, linewidth=0)
        bax.step(r["time"], r["battery_percent"], where="post", color=INK2, lw=1.5)
        last = r["battery_percent"].iloc[-1]
        bax.annotate(f"{last:g} %", (r["time"].iloc[-1], last), xytext=(4, 0), textcoords="offset points",
                     va="center", color=INK2, fontsize=8)
        bax.set_ylim(0, 100)
        bax.set_yticks([0, 100], ["0 %", "100 %"])
        bax.tick_params(axis="y", labelsize=7.5)
        bax.tick_params(axis="x", labelbottom=False)
        bax.set_ylabel(f"R{rid}", rotation=0, ha="right", va="center", color=INK2, fontsize=9.5)
        bax.grid(True, axis="y")
        bax.set_axisbelow(True)
    bat_axes[0].set_title(f"Akkustand je Roboter (battery_percent) · {note}",
                          fontsize=9.5, fontweight="normal", color=INK2)

    snap = tasks.drop_duplicates("time", keep="last")
    ax2.step(snap["time"], snap["n_available"], where="post", color=SERIES)
    ax2.set_yticks(range(len(robots) + 1))
    ax2.set_ylim(-0.2, len(robots) + 0.2)
    ax2.set_ylabel("verfügbar")
    ax2.set_xlabel("Simulationszeit (s)")
    ax2.grid(True, axis="y")
    ax2.set_axisbelow(True)
    ax2.set_title("Anzahl verfügbarer Roboter (available = True)", fontsize=9.5, fontweight="normal", color=INK2)
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------- 5 Kandidaten
def plot_candidates(run: Run, tasks: pd.DataFrame, matrix: pd.DataFrame, path: Path) -> None:
    robots = sorted(matrix["robot_id"].unique())
    order = tasks["transport_id"].tolist()
    dist = matrix.pivot(index="robot_id", columns="transport_id", values="dist_to_pickup").reindex(index=robots, columns=order)
    elig = matrix.pivot(index="robot_id", columns="transport_id", values="eligible").reindex(index=robots, columns=order)
    data = np.ma.masked_where(~elig.fillna(False).to_numpy(bool), dist.to_numpy(float))

    fig = plt.figure(figsize=(13, 6.6))
    gs = fig.add_gridspec(2, 2, height_ratios=[1, 1.15], hspace=0.75, wspace=0.25)
    ax = fig.add_subplot(gs[0, :])
    im = ax.imshow(data, cmap=SEQ_CMAP.with_extremes(bad=GRID), aspect="auto", interpolation="nearest")
    ax.set_yticks(range(len(robots)), [f"R{r}" for r in robots])
    step = max(1, len(order) // 20)
    ax.set_xticks(range(0, len(order), step), [str(order[i]) for i in range(0, len(order), step)])
    ax.set_xticks(np.arange(-0.5, len(order)), minor=True)
    ax.set_yticks(np.arange(-0.5, len(robots)), minor=True)
    ax.grid(which="minor", color=SURFACE, linewidth=1)
    ax.tick_params(which="minor", length=0)
    ax.tick_params(axis="y", length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_xlabel("Transportanfrage (transport_id, zeitlich sortiert)")
    cb = fig.colorbar(im, ax=ax, fraction=0.025, pad=0.01)
    cb.set_label("Distanz zum Abholort (Manhattan)", color=INK2)
    cb.outline.set_visible(False)
    ax.legend(handles=[Patch(color=GRID, label="nicht in Frage kommend (nicht verfügbar / falscher Bereich)")],
              loc="lower right", bbox_to_anchor=(1, 1.02), borderaxespad=0)
    _title(ax, "Auftrag × Roboter: wer kommt in Frage?",
           "Farbe = Distanz des Roboters zum Abholort zum Anfragezeitpunkt")

    ax2 = fig.add_subplot(gs[1, 0])
    sizes = tasks["n_eligible"].value_counts().reindex(range(len(robots) + 1), fill_value=0)
    bars = ax2.bar(sizes.index, sizes.values, color=SERIES, width=0.6)
    _vbar_labels(ax2, bars, sizes.values)
    ax2.set_xticks(sizes.index)
    ax2.set_xlabel("Anzahl in Frage kommender Roboter")
    ax2.set_ylabel("Anzahl Anfragen")
    ax2.grid(True, axis="y")
    ax2.set_axisbelow(True)
    _title(ax2, "Größe der Kandidatenmenge", f"Ø {tasks['n_eligible'].mean():.2f} Roboter je Anfrage")

    ax3 = fig.add_subplot(gs[1, 1])
    d = matrix.loc[matrix["eligible"], "dist_to_pickup"]
    nearest = tasks["nearest_eligible_dist"].dropna()
    bins = np.arange(0, d.max() + 5, 5)
    ax3.hist(d, bins=bins, color=SERIES, edgecolor=SURFACE, linewidth=1)
    ax3.set_xlabel("Distanz Roboter → Abholort (Manhattan)")
    ax3.set_ylabel("Anzahl Paare")
    ax3.grid(True, axis="y")
    ax3.set_axisbelow(True)
    _title(ax3, "Distanzen aller Kandidatenpaare",
           f"{len(d)} Paare · Spannweite {d.min():.0f}–{d.max():.0f} · Ø nächster Kandidat {nearest.mean():.1f}")
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------- 6 Pfadlängen
def plot_paths(run: Run, tasks: pd.DataFrame, matrix: pd.DataFrame, path: Path) -> None:
    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(13, 4.8))
    p = tasks["path_steps"].dropna()
    n_sent = int(tasks["path_unreachable"].sum())
    ax.hist(p, bins=np.arange(0, p.max() + 5, 5), color=SERIES, edgecolor=SURFACE, linewidth=1)
    ax.set_xlabel("Pfadlänge (shortest_path_number_of_steps_in_path)")
    ax.set_ylabel("Anzahl Anfragen")
    ax.grid(True, axis="y")
    ax.set_axisbelow(True)
    sub = f"Klassenbreite 5 · Median {p.median():.0f}"
    if n_sent:
        sub += f" · {n_sent} Sentinel-Wert(e) ausgeschlossen"
    _title(ax, "Verteilung der Pfadlängen", sub)

    valid = tasks.dropna(subset=["path_steps"])
    lim = max(valid["manhattan"].max(), valid["path_steps"].max()) * 1.05
    ax2.plot([0, lim], [0, lim], color=AXIS, lw=1)
    ax2.annotate("Pfad = Manhattan", (lim * 0.72, lim * 0.72), xytext=(-4, 6), textcoords="offset points",
                 rotation=0, color=MUTED, fontsize=8, ha="right")
    ax2.scatter(valid["manhattan"], valid["path_steps"], s=30, color=SERIES, alpha=0.8, edgecolor=SURFACE, linewidth=1)
    ax2.set_xlim(0, lim)
    ax2.set_ylim(0, lim)
    ax2.set_aspect("equal")
    ax2.set_xlabel("Manhattan-Distanz Abholung → Ziel (Entitätskoordinaten)")
    ax2.set_ylabel("Pfadlänge")
    ax2.grid(True)
    ax2.set_axisbelow(True)
    n_below = int((valid["path_steps"] < valid["manhattan"]).sum())
    _title(ax2, "Pfadlänge vs. Luftlinie im Gitter", f"{n_below} von {len(valid)} Punkten unterhalb der Diagonalen")
    fig.tight_layout(w_pad=4)
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------- 7 Roboterpositionen
def plot_robot_positions(run: Run, tasks: pd.DataFrame, matrix: pd.DataFrame, path: Path) -> None:
    robots = run.robots.sort_values("robot_id")
    n = len(robots)
    ncols = 2
    nrows = int(np.ceil(n / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(13, 2.7 * nrows + 0.9), sharex=True, sharey=True, squeeze=False)
    ent = run.entities
    for ax, (_, r) in zip(axes.flat, robots.iterrows()):
        _draw_entities(ax, ent, muted=True, size=30)
        pos = run.fleet[run.fleet["robot_id"] == r["robot_id"]]
        ax.scatter(pos["x"], pos["y"], s=22, color=SERIES, alpha=0.35, edgecolor="none", zorder=4)
        ax.scatter(r["base_x"], r["base_y"], marker="P", s=80, color=INK, edgecolor=SURFACE, linewidth=1.5, zorder=5)
        ax.set_aspect("equal")
        ax.grid(True)
        ax.set_axisbelow(True)
        ax.set_title(f"R{r['robot_id']} · Basis ({r['base_x']}, {r['base_y']})", fontsize=10)
    for ax in axes.flat[n:]:
        ax.set_visible(False)
    handles = [Line2D([], [], marker="o", ls="", color=SERIES, alpha=0.5, markersize=6, label="Position in einem Snapshot"),
               Line2D([], [], marker="P", ls="", color=INK, markersize=8, label="Basis"),
               Line2D([], [], marker="o", ls="", color=AXIS, markersize=6, label="Entitäten")]
    top = 1 - 0.75 / fig.get_figheight()
    _fig_title(fig, "Roboterpositionen in den Flotten-Snapshots", top)
    fig.legend(handles=handles, loc="upper left", bbox_to_anchor=(0.005, 1 - 0.3 / fig.get_figheight()), ncol=3,
               borderaxespad=0)
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------- 8 Zeitfenster
def plot_windows(run: Run, tasks: pd.DataFrame, matrix: pd.DataFrame, path: Path) -> None:
    # Ein Balken = ein Zeitfenster auf der Zeitachse; Höhe = Anzahl Anfragen in diesem Fenster.
    fig, axes = plt.subplots(len(WINDOW_SIZES), 1, figsize=(13, 2.4 * len(WINDOW_SIZES) + 0.5), sharex=True)
    t0 = tasks["time"].min()
    for ax, w in zip(axes, WINDOW_SIZES):
        counts = requests_per_window(tasks, w)
        starts = t0 + counts.index.to_numpy() * w
        bars = ax.bar(starts, counts.values, width=w * 0.88, align="edge", color=SERIES)
        peak = counts.max()
        for bar, v in zip(bars, counts.values):
            if v == peak:
                ax.text(bar.get_x() + bar.get_width() / 2, v, f"max {v}", ha="center", va="bottom",
                        color=INK2, fontsize=8.5)
        ax.set_ylim(0, peak * 1.22)
        ax.set_ylabel("Anfragen")
        ax.grid(True, axis="y")
        ax.set_axisbelow(True)
        ax.yaxis.set_major_locator(MaxNLocator(integer=True))
        _title(ax, f"Fensterlänge Δt = {w} s",
               f"{len(counts)} Fenster · Ø {counts.mean():.2f} Anfragen pro Fenster · max {peak}")
    axes[-1].set_xlabel("Simulationszeit (s) – jeder Balken ist ein Zeitfenster")
    _fig_title(fig, "Anfragen pro Zeitfenster", top=1 - 0.4 / fig.get_figheight())
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------- Registry
# (Dateiname, Titel, Funktion, Lesehilfe für den Bericht)
PLOTS = [
    ("01_layout_materialfluss.png", "Layout & Materialfluss", plot_layout,
     "Wo liegen Maschinen, Lager, Quelle, Senke und Roboter-Basen, und welche Transportbeziehungen sind häufig?"),
    ("02_uebergaenge.png", "Übergänge & Materialstufen", plot_transitions,
     "Welche Bereichskombinationen erzeugen Transporte? Die Diagonale zeigt Transporte innerhalb eines Bereichs."),
    ("03_zeitlinie.png", "Zeitlinie der Anfragen", plot_timeline,
     "Treffen Anfragen gleichmäßig oder in Schüben ein? Schübe sind später Kandidaten für gemeinsame Zuweisungsprobleme."),
    ("04_flottenzustand.png", "Flottenzustand", plot_fleet_state,
     "Wie ausgelastet ist die Flotte, und wie entwickelt sich der Akkustand? Phasen ohne verfügbaren Roboter "
     "bedeuten, dass sich Anfragen stauen."),
    ("05_kandidaten.png", "Auftrag × Roboter", plot_candidates,
     "Kernbeziehung Auftrag ↔ in Frage kommende Roboter. Die Größe der Kandidatenmenge bestimmt später, "
     "wie viele Entscheidungsvariablen ein Auftrag braucht; die Distanzspannweite bestimmt den Wertebereich der Kosten."),
    ("06_pfadlaengen.png", "Pfadlängen", plot_paths,
     "Wie lang sind Transporte, und passt die geloggte Pfadlänge zu den Koordinaten?"),
    ("07_roboterpositionen.png", "Roboterpositionen", plot_robot_positions,
     "Wo halten sich die einzelnen Roboter auf? Teilen sie sich das Layout oder gibt es Reviere?"),
    ("08_zeitfenster.png", "Anfragen pro Zeitfenster", plot_windows,
     "Die Simulationszeit wird in aufeinanderfolgende Fenster der Länge Δt geschnitten; jeder Balken zeigt, "
     "wie viele Anfragen in sein Fenster fallen. Größere Fenster bündeln mehr Anfragen. Wo die Fenstergrenzen "
     "liegen, entscheidet mit, welches Fenster am vollsten ist. Rein beschreibend – noch keine Instanzbildung."),
]


def make_all_plots(run: Run, tasks: pd.DataFrame, matrix: pd.DataFrame, out_dir: Path) -> list[tuple[str, str, str]]:
    """Erzeugt alle Grafiken; gibt (Dateiname, Titel, Lesehilfe) zurück."""
    out_dir.mkdir(parents=True, exist_ok=True)
    made = []
    for filename, title, func, hint in PLOTS:
        func(run, tasks, matrix, out_dir / filename)
        made.append((filename, title, hint))
    return made
