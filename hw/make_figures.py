"""Abbildung der Hardware-Abbildung: eine Spalte je Hardware, eine Zeile je Modell, eine Markerreihe je Kodierung.

Liest nur results/<hardware>.json, rechnet nichts. x = Aufträge n (Flotte m = n/2); y = physische Qubits (Annealer) bzw. Zwei-Qubit-Gatter
je QAOA-Lage (Gatter, Ionen). Punkt = bestes Ergebnis über die Seeds, Balken = Streuung (kleinster bis größter gelungener Seed),
Kreuz am oberen Rand = Instanz nicht abgebildet („not mapped“; not_found ist kein Beweis). Stil wie encodings/paper_figures.py:
Serifenschrift, Schwarzweiß mit geometrisch verschiedenen Markern, Text als Pfade im SVG.
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

from matplotlib.figure import Figure
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.ticker import FuncFormatter

from . import common
from .models import ENCODINGS, ORDERS

sys.path.insert(0, str(common.RESULTS.parent / "encodings"))
import paper_figures as pf  # noqa: E402

FIGURES = common.RESULTS / "figures"
TITLES = {"advantage_pegasus": "Advantage (Pegasus)", "advantage2_zephyr": "Advantage2 (Zephyr)", "heron": "Heron",
          "nighthawk": "Nighthawk", "helios": "Helios"}
SHORT = {"advantage_pegasus": "Advantage", "advantage2_zephyr": "Advantage2", "heron": "Heron", "nighthawk": "Nighthawk",
         "helios": "Helios"}  # Beschriftung der Referenzlinien in den Trend-Abbildungen
# Messgröße je Hardware: Feld im Datensatz und Achsenbeschriftung
METRIC = {"advantage_pegasus": ("physical_qubits", "physical qubits"), "advantage2_zephyr": ("physical_qubits", "physical qubits"),
          "heron": ("two_qubit_gates", "two-qubit gates per layer"), "nighthawk": ("two_qubit_gates", "two-qubit gates per layer"),
          "helios": ("two_qubit_gates", "two-qubit gates per layer")}
ENC_LABEL = {"OH": "One-hot", "DW": "Domain wall", "BIN": "Binary"}
ENC_KEY = {"OH": "one_hot", "DW": "domain_wall", "BIN": "binary"}


def available() -> list[str]:
    """Hardware mit Ergebnisdatei, in der Reihenfolge der Spalten (Plan: Pegasus, Zephyr, Heron, Nighthawk, Helios)."""
    return [h for h in TITLES if common.results_path(h).exists()]


def render(hardware: list[str], fmt: str = "svg", grayscale: bool = True) -> bytes:
    """Die Abbildung aus results/<hardware>.json (rechnet nichts): eine Spalte je Hardware mit Ergebnissen."""
    have = [h for h in available() if h in hardware]
    if not have:
        raise ValueError("Keine Ergebnisse für diese Hardware in results/ – zuerst run_all.py ausführen")
    agg = {h: common.aggregate(common.load_results(h)["records"]) for h in have}
    buf = io.BytesIO()
    _figure(have, agg, grayscale).savefig(buf, format=fmt, dpi=600 if fmt == "png" else None,
                                          metadata={"Creator": "QUBO-MRTA hardware mapping"} if fmt == "svg" else None)
    return buf.getvalue()


def draw(hardware: list[str], grayscale: bool = True) -> list[str]:
    """Schreibt die Abbildung als SVG und PNG nach results/figures/ und gibt die Pfade zurück."""
    try:
        have = [h for h in available() if h in hardware]
        FIGURES.mkdir(parents=True, exist_ok=True)
        paths = []
        for fmt in ("svg", "png"):
            path = FIGURES / ("mapping_" + "_".join(have) + "." + fmt)
            path.write_bytes(render(hardware, fmt, grayscale))
            paths.append(str(path))
        return paths
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc


def _figure(have: list[str], agg: dict, grayscale: bool) -> Figure:
    with pf._LOCK, pf.matplotlib.rc_context(pf._rc("serif", 8.0)):
        fig = Figure(figsize=(max(5.6, 3.6 * len(have)), 5.2), layout="constrained")
        FigureCanvasAgg(fig)
        axes = fig.subplots(2, len(have), squeeze=False, sharex=True)
        letters = iter("abcdefghij")
        for col, h in enumerate(have):
            field, ylabel = METRIC[h]
            # eine gemeinsame y-Skala je Spalte, damit A und B direkt vergleichbar sind
            vals = [a[field]["max"] for a in agg[h].values() if field in a]
            top = max(vals) if vals else 10
            for row, model in enumerate("AB"):
                ax = axes[row][col]
                for k, enc in enumerate(ENCODINGS):
                    st, sty = pf.ENC_STYLE[ENC_KEY[enc]], pf.SIZE_STYLE[ENC_KEY[enc]]
                    color = st["gray"] if grayscale else st["color"]
                    pts = [(n, agg[h].get((model, enc, n))) for n in ORDERS]
                    ok = [(n, a[field]) for n, a in pts if a and field in a]
                    if ok:
                        ax.errorbar([n for n, _ in ok], [m["best"] for _, m in ok],
                                    yerr=[[m["best"] - m["min"] for _, m in ok], [m["max"] - m["best"] for _, m in ok]],
                                    linestyle=sty["linestyle"], marker=sty["marker"], color=color, linewidth=1.0, markersize=4.5,
                                    markerfacecolor=color if sty["filled"] else "white", markeredgecolor=color, markeredgewidth=0.9,
                                    elinewidth=0.6, capsize=1.5, label=ENC_LABEL[enc], zorder=3)
                    bad = [n for n, a in pts if a and a["status"] != "mapped"]
                    if bad:  # Kreuz am oberen Rand, je Kodierung eine eigene Höhe
                        ax.plot(bad, [0.965 - 0.055 * k] * len(bad), linestyle="none", marker="x", markersize=5, markeredgewidth=1.1,
                                color=color, transform=ax.get_xaxis_transform(), clip_on=False, zorder=4)
                ax.set_yscale("log")
                ax.set_ylim(top=top * 4)
                ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}"))
                ax.set_title(f"({next(letters)}) {TITLES[h]}, model {model}", fontsize=8.5)
                ax.set_ylabel(ylabel)
                ax.set_xticks(ORDERS)
                if row == 1:
                    ax.set_xlabel("orders n (fleet m = n/2)")
                for side in ("top", "right"):
                    ax.spines[side].set_visible(False)
                ax.grid(True, color="#d9d9d9", linewidth=0.4, zorder=0)
        handles, names = axes[0][0].get_legend_handles_labels()
        from matplotlib.lines import Line2D
        handles.append(Line2D([], [], linestyle="none", marker="x", color="#000000", markersize=5, markeredgewidth=1.1))
        names.append("not mapped")
        fig.legend(handles, names, loc="outside lower center", ncols=len(names), frameon=False, handlelength=2.6)
    return fig
