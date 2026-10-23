"""Datenqualitätsprüfungen für einen Simulationslauf.

Jede Prüfung liefert Befunde (Finding). Diese landen im Bericht und sollen
Auffälligkeiten sichtbar machen, bevor auf den Daten modelliert wird.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from loader import PATH_SENTINEL_THRESHOLD, Run

INFO = "Info"
WARNING = "Warnung"


@dataclass
class Finding:
    level: str  # INFO oder WARNING
    title: str
    detail: str


def _empty_columns(df: pd.DataFrame, name: str) -> list[Finding]:
    empty = [c for c in df.columns if df[c].isna().all()]
    if not empty:
        return []
    return [Finding(INFO, f"Leere Spalten in {name}", ", ".join(f"`{c}`" for c in empty))]


def _constant_columns(df: pd.DataFrame, name: str) -> list[Finding]:
    const = [c for c in df.columns if df[c].notna().any() and df[c].nunique(dropna=True) == 1]
    if not const:
        return []
    detail = ", ".join(f"`{c}` = `{df[c].dropna().iloc[0]}`" for c in const)
    return [Finding(INFO, f"Konstante Spalten in {name}", detail)]


def _event_types(run: Run) -> list[Finding]:
    types = sorted(run.raw_events["event"].dropna().unique()) if "event" in run.raw_events else ["REQUESTED"]
    if types == ["REQUESTED"]:
        return [Finding(
            WARNING,
            "Nur Event-Typ REQUESTED",
            "Es fehlen Zuweisungs-/Abschluss-Events (z.B. ASSIGNED, COMPLETED) und `vehicle_id` ist leer. "
            "Welcher Roboter einen Auftrag übernommen hat und wie lange Aufträge offen waren, "
            "lässt sich daher nicht rekonstruieren.",
        )]
    counts = run.raw_events["event"].value_counts()
    return [Finding(INFO, "Event-Typen (Lebenslauf der Aufträge)", ", ".join(f"`{t}` × {counts[t]}" for t in types))]


def _lifecycle(run: Run) -> list[Finding]:
    """Befunde aus dem Lebenslauf (nur bei Logs mit ASSIGNED/PICKED_UP/COMPLETED/ABORTED)."""
    lc = run.lifecycle
    if lc.empty:
        return []
    findings = []
    aborted = lc[lc["outcome"] == "abgebrochen"]
    if not aborted.empty:
        reasons = aborted["abort_reason"].fillna("ohne Grund").value_counts()
        findings.append(Finding(WARNING, f"{len(aborted)} Aufträge abgebrochen",
                                ", ".join(f"`{r}` × {n}" for r, n in reasons.items())
                                + f" (transport_id {', '.join(map(str, aborted['transport_id']))})"))
    open_ = lc[lc["outcome"] == "offen"]
    if not open_.empty:
        findings.append(Finding(INFO, f"{len(open_)} Aufträge am Ende des Logs noch offen",
                                f"transport_id {', '.join(map(str, open_['transport_id']))} – Lauf vermutlich vor ihrem Abschluss beendet."))
    unassigned = lc[lc["n_assigned"] == 0]
    if not unassigned.empty:
        findings.append(Finding(INFO, "Aufträge ohne Zuweisung (ASSIGNED)", ", ".join(map(str, unassigned["transport_id"]))))
    fleet_agents = {f"R{r}" for r in run.fleet["robot_id"].unique()}
    others = lc[lc["assigned_agent"].notna() & ~lc["assigned_agent"].isin(fleet_agents)]
    if not others.empty:
        agents = ", ".join(sorted(others["assigned_agent"].unique()))
        findings.append(Finding(WARNING, "Auftragnehmer außerhalb der Flotten-Snapshots",
                                f"{agents} übernehmen {len(others)} Aufträge (`Worker` = Werker), tauchen aber in den Snapshots nicht auf – "
                                "für sie fehlen Position und Verfügbarkeit. Die Kandidaten-Analyse betrachtet nur die Roboter."))
    if "completed_by" in lc and (lc["completed_by"] == "conveyor").any():
        n = int((lc["completed_by"] == "conveyor").sum())
        findings.append(Finding(INFO, "Per Förderband abgeschlossen", f"{n} Aufträge mit `COMPLETED` ohne Fahrzeug (`info = conveyor`)."))
    return findings


def _path_sentinels(run: Run) -> list[Finding]:
    hits = run.events[run.events["path_unreachable"]]
    if hits.empty:
        return []
    ids = ", ".join(str(t) for t in hits["transport_id"])
    return [Finding(
        WARNING,
        f"Pfadlänge ≥ {PATH_SENTINEL_THRESHOLD} (vermutlich Sentinel „unerreichbar“)",
        f"{len(hits)} Auftrag/Aufträge (transport_id {ids}). In den Kennzahlen als fehlend behandelt.",
    )]


def _path_below_manhattan(run: Run) -> list[Finding]:
    ev = run.events
    manhattan = (ev["from_entity_x"] - ev["to_entity_x"]).abs() + (ev["from_entity_y"] - ev["to_entity_y"]).abs()
    below = ev[ev["path_steps"] < manhattan]
    if below.empty:
        return []
    return [Finding(
        INFO,
        "Pfadlänge kürzer als Manhattan-Distanz",
        f"{len(below)} von {len(ev)} Aufträgen. Die Pfadlänge bezieht sich vermutlich auf Zugangspunkte "
        "der Entitäten oder eine andere Metrik als die Entitätskoordinaten.",
    )]


def _snapshot_consistency(run: Run) -> list[Finding]:
    findings = []
    ev_ids = set(run.events["transport_id"])
    fl_ids = set(run.fleet["transport_id"])
    if missing := sorted(ev_ids - fl_ids):
        findings.append(Finding(WARNING, "Aufträge ohne Flotten-Snapshot", ", ".join(map(str, missing))))
    if orphan := sorted(fl_ids - ev_ids):
        findings.append(Finding(WARNING, "Snapshots ohne Auftrag", ", ".join(map(str, orphan))))

    sizes = run.fleet.groupby("transport_id")["robot_id"].nunique()
    if sizes.nunique() > 1:
        findings.append(Finding(WARNING, "Unterschiedliche Snapshot-Größen", sizes.value_counts().to_string()))

    merged = run.fleet.drop_duplicates("transport_id")[["transport_id", "time"]].merge(
        run.events[["transport_id", "time"]], on="transport_id", suffixes=("_fleet", "_event")
    )
    mismatch = merged[merged["time_fleet"] != merged["time_event"]]
    if not mismatch.empty:
        findings.append(Finding(
            WARNING,
            "Snapshot-Zeit weicht von Anfragezeit ab",
            ", ".join(map(str, mismatch["transport_id"])),
        ))
    return findings


def _time_checks(run: Run) -> list[Finding]:
    findings = []
    raw = run.raw_events
    req = raw[raw["event"] == "REQUESTED"] if "event" in raw else raw
    raw_times = req.sort_values("transport_id", key=lambda s: s.astype(int))["time"].astype(float)
    if not raw_times.is_monotonic_increasing:
        findings.append(Finding(WARNING, "Zeitstempel nicht monoton in transport_id-Reihenfolge", ""))
    times_txt = run.raw_events["time"]
    if times_txt.str.contains(".", regex=False).any() and not times_txt.str.contains(".", regex=False).all():
        findings.append(Finding(INFO, "Gemischtes Zeitformat", "Teils Ganzzahl (`90`), teils Gleitkomma (`1.0`). Wird als float gelesen."))
    return findings


def _duplicates(run: Run) -> list[Finding]:
    findings = []
    for name, df in [("Events", run.raw_events), ("Flotte", run.raw_fleet)]:
        if (n := int(df.duplicated().sum())) > 0:
            findings.append(Finding(WARNING, f"Doppelte Zeilen in {name}", str(n)))
    if (n := int(run.events["transport_id"].duplicated().sum())) > 0:
        findings.append(Finding(WARNING, "Doppelte transport_id in Events", str(n)))
    return findings


def _entities(run: Run) -> list[Finding]:
    findings = []
    multi = run.entities[run.entities["n_coordinates"] > 1]
    if not multi.empty:
        findings.append(Finding(WARNING, "Entitäten mit mehreren Koordinaten", ", ".join(multi["entity"])))
    unknown = run.entities[run.entities["kind"] == "Unbekannt"]
    if not unknown.empty:
        findings.append(Finding(WARNING, "Entitäten mit unbekanntem Namensschema", ", ".join(unknown["entity"])))
    if run.events["product"].str.startswith("0").any():
        findings.append(Finding(INFO, "Material-IDs mit führender Null", "Als Text eingelesen, Nullen bleiben erhalten."))
    return findings


def run_checks(run: Run) -> list[Finding]:
    findings: list[Finding] = []
    findings += _event_types(run)
    findings += _lifecycle(run)
    findings += _path_sentinels(run)
    findings += _snapshot_consistency(run)
    findings += _duplicates(run)
    findings += _time_checks(run)
    findings += _entities(run)
    findings += _path_below_manhattan(run)
    findings += _empty_columns(run.raw_events, "Events")
    findings += _empty_columns(run.raw_fleet, "Flotte")
    findings += _constant_columns(run.raw_events, "Events")
    findings += _constant_columns(run.raw_fleet, "Flotte")
    # Warnungen zuerst
    return sorted(findings, key=lambda f: f.level != WARNING)
