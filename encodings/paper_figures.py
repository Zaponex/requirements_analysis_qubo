"""Abbildungen fürs Paper: Qubits gegen Kopplungen je Problemklasse × Kodierung über frei gewählte Instanzgrößen (T, R).

Eine Linie je Serie (Klasse, Kodierung), ein Punkt je Instanzgröße – in der gewählten Reihenfolge verbunden. Gezählt wird die
Struktur (volle Zuständigkeit, allgemeine Kosten, resources.structure_instance): Qubits = Binärvariablen der fertigen QUBO inklusive
Hilfsbits, Kopplungen = Einträge Q_ij ≠ 0 mit i ≠ j. IA mit Paarstrafe (wie formulations.*_ia), TA mit Lastausgleich (wie
workload.wb_formulation) – dieselben Zahlen wie im Reiter „Qubits & Kopplungen“ bei voller Zuständigkeit.

Gerendert mit matplotlib ohne pyplot (thread-sicher) als PDF, SVG oder PNG; dazu die Daten als CSV. Beschriftungen auf Englisch
(Paper), Schriften eingebettet (PDF Type 42, SVG als Pfade).
"""
from __future__ import annotations

import csv
import io
import threading
from functools import lru_cache

import matplotlib
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from resources import MAX_STRUCT_R, MAX_STRUCT_T, build_case, metrics, structure_instance

CLASS_VARIANT = {"IA": "paar", "TA": "wb"}
ENC_STYLE = {
    "one_hot": {"label": "One-hot", "color": "#2a78d6", "gray": "#000000", "marker": "o"},
    "domain_wall": {"label": "Domain wall", "color": "#eb6834", "gray": "#4d4d4d", "marker": "s"},
    "binary": {"label": "Binary", "color": "#1baf7a", "gray": "#8c8c8c", "marker": "^"},
}
# IA: durchgezogen, gefüllte Marker; TA: gestrichelt, größere offene Marker – liegen beide auf demselben Punkt (z.B. bei T = R koppeln
# Spaltenregel und H_WB dieselben Paare), bleibt ein Ring um einen Punkt sichtbar.
CLASS_STYLE = {"IA": {"linestyle": "-", "filled": True, "size": 4.0}, "TA": {"linestyle": "--", "filled": False, "size": 6.5}}
FORMATS = {"pdf": "application/pdf", "svg": "image/svg+xml", "png": "image/png", "csv": "text/csv"}
MAX_T, MAX_R, MAX_SIZES, MAX_SERIES = MAX_STRUCT_T, MAX_STRUCT_R, 30, 6
DEFAULTS = {
    "width": 3.5, "height": 3.0,            # Zoll: eine Spalte (IEEE/ACM ≈ 3,5 in)
    "font": "serif", "font_size": 8.0,
    "log": False, "reference": True, "annotate": False, "legend": "above", "grayscale": False, "grid": True,
    "title": "", "xlabel": "Number of qubits", "ylabel": "Number of couplings",
}
_LOCK = threading.Lock()  # rcParams sind global


def default_label(cls: str, encoding: str) -> str:
    return f"{ENC_STYLE[encoding]['label']} ({cls})"


@lru_cache(maxsize=4096)
def counts(cls: str, encoding: str, T: int, R: int) -> dict:
    """Qubits (davon Hilfsbits), Kopplungen und Dichte einer Instanzgröße – Struktur, zwischengespeichert."""
    inst = structure_instance(T, R)
    form = build_case(inst, cls, encoding, CLASS_VARIANT[cls], exact_M=False)
    m = metrics(inst, form, full=False)
    return {"qubits": m["n"], "aux": m["types"]["hilfsbit"], "couplings": m["couplings"], "density": round(m["density"], 4)}


def validate(series: list[dict], sizes: list) -> tuple[list[dict], list[tuple[int, int]]]:
    """Serien (Klasse, Kodierung, optionales Label) und Größen (T, R) prüfen und vereinheitlichen."""
    if not series or len(series) > MAX_SERIES:
        raise ValueError(f"1 bis {MAX_SERIES} Serien wählen")
    if not sizes or len(sizes) > MAX_SIZES:
        raise ValueError(f"1 bis {MAX_SIZES} Instanzgrößen wählen")
    out_s = []
    for s in series:
        cls, enc = s.get("cls"), s.get("encoding")
        if cls not in CLASS_VARIANT or enc not in ENC_STYLE:
            raise ValueError(f"Unbekannte Serie: {cls} / {enc}")
        out_s.append({"cls": cls, "encoding": enc, "label": str(s.get("label") or default_label(cls, enc))[:80]})
    out_z = []
    for z in sizes:
        try:
            T, R = int(z[0]), int(z[1])
        except (TypeError, ValueError, IndexError):
            raise ValueError("Größen als [[T, R], …] angeben") from None
        if not (1 <= T <= MAX_T and 1 <= R <= MAX_R):
            raise ValueError(f"Instanzgröße außerhalb 1 ≤ T ≤ {MAX_T}, 1 ≤ R ≤ {MAX_R}: T = {T}, R = {R}")
        out_z.append((T, R))
    return out_s, out_z


def figure_data(series: list[dict], sizes: list) -> list[dict]:
    """Eine Zeile je Serie und Größe – in der Reihenfolge der Größenliste (so werden die Punkte verbunden)."""
    series, sizes = validate(series, sizes)
    return [{"series": s["label"], "cls": s["cls"], "encoding": s["encoding"], "T": T, "R": R, **counts(s["cls"], s["encoding"], T, R)}
            for s in series for T, R in sizes]


def to_csv(rows: list[dict]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["series", "problem_class", "encoding", "tasks_T", "amrs_R", "qubits", "auxiliary_qubits", "couplings", "density"])
    for r in rows:
        w.writerow([r["series"], r["cls"], r["encoding"], r["T"], r["R"], r["qubits"], r["aux"], r["couplings"], r["density"]])
    return buf.getvalue().encode("utf-8")


def options_of(raw: dict | None) -> dict:
    """Optionen mit Standardwerten auffüllen und begrenzen."""
    o = {**DEFAULTS, **{k: v for k, v in (raw or {}).items() if k in DEFAULTS}}
    o["width"] = min(10.0, max(1.5, float(o["width"])))
    o["height"] = min(10.0, max(1.2, float(o["height"])))
    o["font_size"] = min(16.0, max(5.0, float(o["font_size"])))
    if o["font"] not in ("serif", "sans"):
        o["font"] = "serif"
    if o["legend"] not in ("best", "above", "right", "none"):
        o["legend"] = "best"
    for k in ("log", "reference", "annotate", "grayscale", "grid"):
        o[k] = bool(o[k])
    for k in ("title", "xlabel", "ylabel"):
        o[k] = str(o[k])[:120]
    return o


def _rc(font: str, fs: float) -> dict:
    """Paper-Stil: Serifenschrift, Ticks nach innen, dünne Achsen; Schrift eingebettet (PDF Type 42, SVG als Pfade)."""
    return {
        "font.family": "serif" if font == "serif" else "sans-serif",
        "font.serif": ["Times New Roman", "Times", "STIXGeneral", "DejaVu Serif"],
        "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
        "mathtext.fontset": "stix" if font == "serif" else "dejavusans",
        "font.size": fs, "axes.labelsize": fs, "xtick.labelsize": fs - 1, "ytick.labelsize": fs - 1, "legend.fontsize": fs - 1,
        "axes.linewidth": 0.6, "xtick.major.width": 0.6, "ytick.major.width": 0.6, "xtick.direction": "in", "ytick.direction": "in",
        "pdf.fonttype": 42, "ps.fonttype": 42, "svg.fonttype": "path", "svg.hashsalt": "qubo-mrta",
    }


# Linienstil und Marker je Kodierung: in Schwarzweiß nur an Form und Strich zu unterscheiden (Kreis voll, Quadrat voll, Dreieck offen)
SIZE_STYLE = {
    "one_hot": {"linestyle": "-", "marker": "o", "filled": True},
    "domain_wall": {"linestyle": "--", "marker": "s", "filled": True},
    "binary": {"linestyle": ":", "marker": "^", "filled": False},
}
SIZE_PANELS = (("n", "qubits", True), ("couplings", "couplings", True), ("density", "density", False))
# Feste y-Grenzen je Feld, gleich für IA und TA, jede Reihe und mit oder ohne Referenzlinien, damit Abbildungen direkt vergleichbar sind.
# Sie decken die ganze Folge bis 18 × 9 ab (1…279 Qubits, 1…35 298 Kopplungen, Dichte 0,12…1); tests/test_resources.py prüft das.
SIZE_YLIM = {"n": (0.8, 500.0), "couplings": (0.8, 1e5), "density": (0.0, 1.05)}
RATIO_LABEL = {"halb": "fleet R = T/2", "fest": "fleet R = {R}", "quadrat": "R = T"}
REF_STYLE = {"color": "#888780", "linewidth": 0.7, "linestyle": (0, (5, 1.6, 1, 1.6))}  # Strich-Punkt: in Schwarzweiß nicht mit der gepunkteten Binary-Kurve zu verwechseln
REF_LABEL = {"fontsize": 5.8, "color": "#5f5e5a"}
REF_LEADER = {"arrowstyle": "-", "color": "#b4b2a9", "linewidth": 0.4, "shrinkA": 0, "shrinkB": 0}


def _reference_lines(ax, refs: list[tuple[str, float]]) -> None:
    """Strich-Punkt-Linien über die ganze Achse, beschriftet am rechten Rand mit kurzem Führungsstrich; liegen Linien
    dicht beieinander, werden die Namen auseinandergeschoben (die Linien bleiben, wo sie sind). Die y-Achse bleibt, wie sie ist."""
    if not refs:
        return
    for _, v in refs:
        ax.axhline(v, zorder=2, **REF_STYLE)
    inv = ax.transAxes.inverted()
    pos = sorted((inv.transform(ax.transData.transform((0.0, v)))[1], name) for name, v in refs)
    label_y: list[float] = []
    for y, _ in pos:
        label_y.append(max(y, label_y[-1] + 0.09) if label_y else y)
    over = label_y[-1] - 1.0
    if over > 0:  # oben nicht über den Rand hinaus
        label_y = [y - over for y in label_y]
    for (y, name), ty in zip(pos, label_y):
        ax.annotate(name, xy=(1.0, y), xycoords="axes fraction", xytext=(1.035, ty), textcoords="axes fraction", va="center", ha="left",
                    annotation_clip=False, arrowprops=REF_LEADER, **REF_LABEL)


def render_sizes(data: dict, R: int = 3, grayscale: bool = True, fmt: str = "svg", refs: list[dict] | None = None) -> bytes:
    """Qubits, Kopplungen und Dichte über gemischte Instanzgrößen T × R (resources.size_series) – drei Felder im Paper-Stil.

    Die Größen stehen gleichmäßig verteilt nach T·R sortiert auf der x-Achse; die Legende steht unter den Feldern.
    Die y-Achsen sind fest (SIZE_YLIM): IA und TA und jede Reihe teilen dieselben Grenzen.
    refs: je Hardware {"label", "qubits", "couplings", "density"} – das größte dort abgebildete Problem (hw.common.reach) als Strich-Punkt-
    Linie in jedem Feld, als Orientierung, wie weit die Kurven noch auf Hardware passen."""
    if fmt not in ("svg", "pdf", "png"):
        raise ValueError("Format muss svg, pdf oder png sein")
    from matplotlib.ticker import FuncFormatter, LogLocator, NullFormatter

    cls = data["cls"]
    first = data["series"][0]["points"]
    labels = [f"{p['T']}×{p['R']}" for p in first]
    xlabel = "instance size T×R (" + RATIO_LABEL[data["ratio"]].format(R=R) + ")"
    with _LOCK, matplotlib.rc_context(_rc("serif", 8.0)):
        fig = Figure(figsize=(8.0 if refs else 7.2, 2.95), layout="constrained")  # mit Referenzlinien Platz für die Namen rechts
        FigureCanvasAgg(fig)
        axes = fig.subplots(1, 3)
        for ax, (field, name, log), letter in zip(axes, SIZE_PANELS, "abc"):
            for s in data["series"]:
                st, sty = ENC_STYLE[s["encoding"]], SIZE_STYLE[s["encoding"]]
                color = st["gray"] if grayscale else st["color"]
                # Null (Log-Achse) und die Dichte bei weniger als zwei Qubits sind nicht darstellbar bzw. nicht definiert: Lücke statt Abfall
                y = [float("nan") if (log and p[field] <= 0) or (field == "density" and p["n"] < 2) else p[field] for p in s["points"]]
                ax.plot(range(len(first)), y, linestyle=sty["linestyle"], marker=sty["marker"], color=color,
                        linewidth=1.0, markersize=4.5, markerfacecolor=color if sty["filled"] else "white", markeredgecolor=color,
                        markeredgewidth=0.9, label=st["label"], zorder=3)
            if log:
                ax.set_yscale("log")
                if field == "n":
                    ax.yaxis.set_major_locator(LogLocator(base=10, subs=(1.0, 3.0)))
                    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}"))
                    ax.yaxis.set_minor_formatter(NullFormatter())
            ax.set_ylim(*SIZE_YLIM[field])
            if refs:
                _reference_lines(ax, [(r["label"], float(r["qubits" if field == "n" else field])) for r in refs
                                      if r.get("qubits" if field == "n" else field)])
            ax.set_xticks(range(len(first)), labels, rotation=45, ha="right", rotation_mode="anchor")
            ax.set_xlim(-0.5, len(first) - 0.5)
            ax.set_xlabel(xlabel)
            ax.set_ylabel(name)
            ax.set_title(f"({letter}) {cls}, {name}", fontsize=8.5)
            for side in ("top", "right"):
                ax.spines[side].set_visible(False)
            ax.grid(True, color="#d9d9d9", linewidth=0.4, zorder=0)
        handles, names = axes[0].get_legend_handles_labels()
        if refs:
            from matplotlib.lines import Line2D
            handles.append(Line2D([], [], **REF_STYLE))
            names.append("largest mapped problem")
        fig.legend(handles, names, loc="outside lower center", ncols=len(names), frameon=False, handlelength=2.6)
        buf = io.BytesIO()
        fig.savefig(buf, format=fmt, dpi=600 if fmt == "png" else None, metadata={"Creator": "QUBO-MRTA Lernlabor"} if fmt != "png" else None)
    return buf.getvalue()


def render(series: list[dict], sizes: list, raw_options: dict | None, fmt: str) -> bytes:
    """Die Abbildung als PDF, SVG oder PNG (600 dpi) – oder die Daten als CSV."""
    if fmt not in FORMATS:
        raise ValueError(f"Format muss eines von {tuple(FORMATS)} sein")
    rows = figure_data(series, sizes)
    if fmt == "csv":
        return to_csv(rows)
    series, sizes = validate(series, sizes)
    o = options_of(raw_options)
    fs = o["font_size"]
    with _LOCK, matplotlib.rc_context(_rc(o["font"], fs)):
        fig = Figure(figsize=(o["width"], o["height"]), layout="constrained")
        FigureCanvasAgg(fig)
        ax = fig.add_subplot()
        xs_all, ys_all = [], []
        for s in sorted(series, key=lambda s: s["cls"]):  # IA zuerst, TA (offene Marker) darüber
            st = ENC_STYLE[s["encoding"]]
            cs = CLASS_STYLE[s["cls"]]
            pts = [counts(s["cls"], s["encoding"], T, R) for T, R in sizes]
            x = [p["qubits"] for p in pts]
            y = [p["couplings"] for p in pts]
            xs_all += x
            ys_all += y
            color = st["gray"] if o["grayscale"] else st["color"]
            ax.plot(x, y, linestyle=cs["linestyle"], marker=st["marker"], color=color, linewidth=1.1, markersize=cs["size"],
                    markerfacecolor=color if cs["filled"] else "none", markeredgecolor="white" if cs["filled"] else color,
                    markeredgewidth=0.5 if cs["filled"] else 1.0, label=s["label"], zorder=3 if cs["filled"] else 4)
        x_max, y_max = max(xs_all), max(ys_all)
        if o["reference"]:
            lo = 2 if o["log"] else 0
            n = [lo + (x_max * 1.15 - lo) * k / 200 for k in range(201)]
            ax.plot(n, [v * (v - 1) / 2 for v in n], color="#9a9a9a", linewidth=0.8, linestyle=":", label=r"Fully connected, $\binom{n}{2}$", zorder=1)
        if o["annotate"]:
            seen = set()
            for s in series:
                for (T, R) in sizes:
                    p = counts(s["cls"], s["encoding"], T, R)
                    key = (p["qubits"], p["couplings"])
                    if key in seen:
                        continue
                    seen.add(key)
                    ax.annotate(f"({T},{R})", key, xytext=(2.5, 2.5), textcoords="offset points", fontsize=fs - 2, color="#333333", zorder=4)
        if o["log"]:
            ax.set_xscale("log")
            ax.set_yscale("log")
            ax.set_xlim(min(xs_all) / 1.25, x_max * 1.25)
            ax.set_ylim(max(0.8, min(y for y in ys_all if y > 0) / 1.4) if any(y > 0 for y in ys_all) else 0.8, y_max * 1.4)
        else:
            ax.set_xlim(0, x_max * 1.08 + 1)
            ax.set_ylim(0, y_max * 1.1 + 1)
        ax.set_xlabel(o["xlabel"])
        ax.set_ylabel(o["ylabel"])
        if o["title"]:
            ax.set_title(o["title"], fontsize=fs + 1)
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
        if o["grid"]:
            ax.grid(True, color="#d9d9d9", linewidth=0.4, zorder=0)
        if o["legend"] == "best":
            ax.legend(frameon=False, loc="best", handlelength=2.4)
        elif o["legend"] == "above":
            fig.legend(loc="outside upper center", ncols=min(3, len(series) + o["reference"]), frameon=False, handlelength=2.4)
        elif o["legend"] == "right":
            fig.legend(loc="outside right upper", frameon=False, handlelength=2.4)
        buf = io.BytesIO()
        fig.savefig(buf, format=fmt, dpi=600 if fmt == "png" else None, metadata={"Creator": "QUBO-MRTA Lernlabor"} if fmt != "png" else None)
    return buf.getvalue()


def file_name(series: list[dict], fmt: str) -> str:
    classes = "-".join(sorted({s["cls"] for s in series}))
    encs = "-".join(e for e in ENC_STYLE if any(s["encoding"] == e for s in series))
    return f"qubits_vs_couplings_{classes}_{encs}.{fmt}"
