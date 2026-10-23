"""Stufe 1 – Simulations-Logs aufbereiten, prüfen und visualisieren.

Aufruf (aus dem Projektordner):
    python analysis/analysis.py                      # alle Läufe in data/transport_logs
    python analysis/analysis.py --run 2026-10-09_12-59-39
    python analysis/analysis.py --data-dir <ordner> --out <ordner>

Ergebnis pro Lauf in outputs/<run_id>/: Grafiken, bericht.md, Tabellen (CSV),
kennzahlen.json. Dazu outputs/laeufe_uebersicht.csv/.md über alle Läufe.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

from checks import WARNING, Finding, run_checks
from features import WINDOW_SIZES, run_summary, task_features, task_robot_matrix
from loader import PATH_SENTINEL_THRESHOLD, Run, find_runs, load_run
from plots import STATUS_LABELS, make_all_plots

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SUMMARY_FILE = "kennzahlen.json"

# Spalten der Lauf-Übersicht (Markdown); die CSV enthält alle Kennzahlen.
OVERVIEW_COLUMNS = {
    "run_id": "Lauf",
    "n_requests": "Anfragen",
    "duration_s": "Dauer (s)",
    "n_robots": "Roboter",
    "n_machines": "Maschinen",
    "n_machine_areas": "Bereiche",
    "mean_eligible": "Ø Kandidaten",
    "share_zero_eligible": "Anteil ohne Kandidat",
    "max_requests_same_time": "max. zeitgleich",
    "req_per_60s_max": "max. pro 60 s",
    "path_median": "Pfad Median",
    "n_distinct_aor": "AoR-Profile",
    "n_path_sentinel": "Sentinels",
}


def _md_table(df: pd.DataFrame) -> str:
    """Einfache Markdown-Tabelle (ohne Zusatzpaket)."""
    cols = [str(c) for c in df.columns]
    lines = ["| " + " | ".join(cols) + " |", "| " + " | ".join("---" for _ in cols) + " |"]
    for _, row in df.iterrows():
        lines.append("| " + " | ".join("" if pd.isna(v) else str(v) for v in row) + " |")
    return "\n".join(lines)


def _fmt(v: float) -> str:
    return f"{v:g}" if isinstance(v, float) else str(v)


def write_report(run: Run, summary: dict, findings: list[Finding],
                 plots: list[tuple[str, str, str]], out_dir: Path) -> Path:
    s = summary
    n_robots = s["n_robots"]
    key_figures = pd.DataFrame([
        ("Transportanfragen", s["n_requests"]),
        ("Simulationsdauer", f"{s['duration_s']:g} s ({s['duration_s'] / 60:.1f} min)"),
        ("Roboter", n_robots),
        ("Entitäten", f"{s['n_entities']} ({s['n_machines']} Maschinen in {s['n_machine_areas']} Bereichen)"),
        ("Produkte / Materialstufen", f"{s['n_products']} / {s['n_material_stages']}"),
        ("Max. Anfragen mit identischem Zeitstempel", s["max_requests_same_time"]),
        ("Ø verfügbare Roboter je Anfrage", f"{s['mean_available']} von {n_robots}"),
        ("Ø in Frage kommende Roboter je Anfrage", f"{s['mean_eligible']} von {n_robots}"),
        ("Anteil Anfragen ohne in Frage kommenden Roboter", f"{s['share_zero_eligible'] * 100:.1f} %"),
        ("Unterschiedliche Zuständigkeitsprofile (AoR)", s["n_distinct_aor"]),
        ("Pfadlänge Median / Ø / Max", f"{_fmt(s['path_median'])} / {_fmt(s['path_mean'])} / {_fmt(s['path_max'])}"),
        (f"Pfadlängen ≥ {PATH_SENTINEL_THRESHOLD} (Sentinel)", s["n_path_sentinel"]),
    ], columns=["Kennzahl", "Wert"])

    cand = pd.DataFrame(
        [["Anfragen"] + [s[f"candidates_{k}"] for k in range(n_robots + 1)]],
        columns=["In Frage kommende Roboter"] + [str(k) for k in range(n_robots + 1)],
    )
    windows = pd.DataFrame(
        [(f"{w} s", s[f"req_per_{w}s_mean"], s[f"req_per_{w}s_max"]) for w in WINDOW_SIZES],
        columns=["Fensterlänge Δt", "Ø Anfragen pro Fenster", "max. Anfragen pro Fenster"],
    )
    status_avail = pd.crosstab(run.fleet["status"], run.fleet["available"]).reset_index()
    status_avail["status"] = status_avail["status"].map(lambda x: f"{STATUS_LABELS.get(x, x)} (`{x}`)")
    status_avail.columns = ["Status"] + [f"available = {c}" for c in status_avail.columns[1:]]

    lines = [
        f"# Analysebericht – Lauf `{run.run_id}`",
        "",
        f"> Automatisch erzeugt von `analysis/analysis.py` am {datetime.now():%Y-%m-%d %H:%M}. "
        "Nicht von Hand bearbeiten – Änderungen gehen beim nächsten Lauf verloren.",
        "",
        "## Kennzahlen",
        "",
        _md_table(key_figures),
        "",
        "### Kandidatenmengen",
        "",
        "Wie viele Roboter kamen zum Anfragezeitpunkt für einen Auftrag in Frage (verfügbar und zuständig)?",
        "",
        _md_table(cand),
        "",
        "### Anfragen pro Zeitfenster",
        "",
        _md_table(windows),
        "",
        "### Status vs. Verfügbarkeit",
        "",
        "Welche Roboter-Status gelten in den Snapshots als `available`? (Anzahl Snapshot-Zeilen)",
        "",
        _md_table(status_avail),
        "",
        "## Datenqualität",
        "",
    ]
    if findings:
        for f in findings:
            marker = "**⚠ Warnung**" if f.level == WARNING else "Info"
            detail = f" – {f.detail}" if f.detail else ""
            lines.append(f"- {marker}: **{f.title}**{detail}")
    else:
        lines.append("Keine Auffälligkeiten gefunden.")
    lines += [
        "",
        "## Annahmen",
        "",
        "- **Bereich eines Auftrags:** Bereich der Abholmaschine; ist die Abholung keine Maschine "
        "(Lager, Quelle), der Bereich der Zielmaschine; sonst kein Bereich (jeder Roboter zuständig).",
        "- **In Frage kommender Roboter:** im Snapshot der Anfrage `available = True` *und* Auftragsbereich "
        "in seiner `area_of_responsibility`.",
        "- **Distanz Roboter → Abholort:** Manhattan-Distanz auf den geloggten Koordinaten (keine Pfadplanung).",
        f"- **Pfadlängen ≥ {PATH_SENTINEL_THRESHOLD}** gelten als Sentinel („unerreichbar“) und zählen als fehlend.",
        "",
        "## Grafiken",
        "",
    ]
    for i, (filename, title, hint) in enumerate(plots, start=1):
        lines += [f"### {i}. {title}", "", f"*{hint}*", "", f"![{title}]({filename})", ""]
    lines += [
        "## Tabellen",
        "",
        "- [`auftraege.csv`](auftraege.csv) – eine Zeile pro Transportanfrage mit allen abgeleiteten Größen",
        "- [`auftrag_roboter.csv`](auftrag_roboter.csv) – eine Zeile pro (Anfrage, Roboter): Status, "
        "Verfügbarkeit, Zuständigkeit, Distanz zum Abholort",
        f"- [`{SUMMARY_FILE}`]({SUMMARY_FILE}) – Kennzahlen dieses Laufs (Grundlage der Lauf-Übersicht)",
        "",
    ]
    path = out_dir / "bericht.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def write_overview(out_root: Path) -> pd.DataFrame:
    """Sammelt die Kennzahlen aller bisher analysierten Läufe in outputs/."""
    rows = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(out_root.glob(f"*/{SUMMARY_FILE}"))]
    overview = pd.DataFrame(rows)
    if overview.empty:
        return overview
    overview.to_csv(out_root / "laeufe_uebersicht.csv", sep=";", index=False)
    md = overview[list(OVERVIEW_COLUMNS)].rename(columns=OVERVIEW_COLUMNS)
    text = "\n".join([
        "# Übersicht aller Simulationsläufe",
        "",
        "> Automatisch erzeugt von `analysis/analysis.py`. Alle Kennzahlen: `laeufe_uebersicht.csv`.",
        "",
        _md_table(md),
        "",
        "Details je Lauf: `outputs/<Lauf>/bericht.md`.",
        "",
    ])
    (out_root / "laeufe_uebersicht.md").write_text(text, encoding="utf-8")
    return overview


def analyze_run(run_id: str, events_path: Path, fleet_path: Path, out_root: Path) -> dict:
    run = load_run(run_id, events_path, fleet_path)
    out_dir = out_root / run_id
    out_dir.mkdir(parents=True, exist_ok=True)

    matrix = task_robot_matrix(run)
    tasks = task_features(run, matrix)
    summary = run_summary(run, tasks)
    findings = run_checks(run)

    tasks.to_csv(out_dir / "auftraege.csv", sep=";", index=False)
    matrix.to_csv(out_dir / "auftrag_roboter.csv", sep=";", index=False)
    (out_dir / SUMMARY_FILE).write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    plots = make_all_plots(run, tasks, matrix, out_dir)
    report = write_report(run, summary, findings, plots, out_dir)

    n_warn = sum(f.level == WARNING for f in findings)
    print(f"[{run_id}] {summary['n_requests']} Anfragen, {summary['n_robots']} Roboter, "
          f"Ø {summary['mean_eligible']} Kandidaten/Anfrage, {n_warn} Warnung(en) -> {report.relative_to(out_root.parent)}")
    return summary


def main(argv: list[str] | None = None) -> int:
    # Windows-Konsolen (cp1252) können nicht alle Zeichen darstellen – nicht abstürzen.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    parser = argparse.ArgumentParser(description="Stufe 1: Simulations-Logs aufbereiten, prüfen und visualisieren.")
    parser.add_argument("--data-dir", type=Path, default=PROJECT_ROOT / "data" / "transport_logs",
                        help="Ordner mit transport_events_*.csv / transport_fleet_*.csv")
    parser.add_argument("--out", type=Path, default=PROJECT_ROOT / "outputs", help="Ausgabeordner")
    parser.add_argument("--run", action="append", metavar="RUN_ID",
                        help="Nur diesen Lauf verarbeiten (mehrfach angebbar). Standard: alle.")
    args = parser.parse_args(argv)

    runs = find_runs(args.data_dir)
    if args.run:
        unknown = set(args.run) - set(runs)
        if unknown:
            parser.error(f"Unbekannte Läufe: {', '.join(sorted(unknown))}. Gefunden: {', '.join(runs) or '—'}")
        runs = {r: runs[r] for r in args.run}
    if not runs:
        print(f"Keine Läufe in {args.data_dir} gefunden.")
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    for run_id, (events_path, fleet_path) in runs.items():
        analyze_run(run_id, events_path, fleet_path, args.out)

    overview = write_overview(args.out)
    print(f"Übersicht über {len(overview)} Lauf/Läufe -> {args.out / 'laeufe_uebersicht.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
