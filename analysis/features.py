"""Beschreibende Kennzahlen pro Auftrag, pro (Auftrag, Roboter) und pro Lauf.

Bewusst nur Beschreibung des Ursprungsproblems – noch keine Instanzbildung
und keine QUBO-Formulierung (siehe docs/ARCHITEKTUR.md, Stufen 2–4).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from loader import Run

# Zeitfenster (Sekunden), für die gezählt wird, wie viele Anfragen gemeinsam eintreffen.
WINDOW_SIZES = (30, 60, 120)


def task_robot_matrix(run: Run) -> pd.DataFrame:
    """Eine Zeile pro (Auftrag, Roboter) zum Zeitpunkt der Anfrage.

    available: Roboter laut Snapshot verfügbar
    eligible:  verfügbar UND Auftragsbereich in seinen Zuständigkeiten (oder Auftrag ohne Bereich)
    dist_to_pickup: Manhattan-Distanz Roboterposition → Abholort
    """
    ev = run.events[["transport_id", "time", "from_entity_x", "from_entity_y", "task_area"]]
    m = run.fleet[["transport_id", "robot_id", "status", "x", "y", "aor", "available"]].merge(
        ev, on="transport_id", how="inner"
    )
    m["in_aor"] = [area is None or area in aor for area, aor in zip(m["task_area"], m["aor"])]
    m["eligible"] = m["available"] & m["in_aor"]
    m["dist_to_pickup"] = (m["x"] - m["from_entity_x"]).abs() + (m["y"] - m["from_entity_y"]).abs()
    cols = ["transport_id", "time", "robot_id", "status", "x", "y", "available", "in_aor", "eligible", "dist_to_pickup"]
    return m[cols].sort_values(["transport_id", "robot_id"]).reset_index(drop=True)


def task_features(run: Run, matrix: pd.DataFrame) -> pd.DataFrame:
    """Eine Zeile pro Auftrag mit abgeleiteten Größen."""
    ev = run.events.copy()
    ev["manhattan"] = (ev["from_entity_x"] - ev["to_entity_x"]).abs() + (ev["from_entity_y"] - ev["to_entity_y"]).abs()
    ev["detour_factor"] = ev["path_steps"] / ev["manhattan"].replace(0, np.nan)
    ev["inter_arrival"] = ev["time"].diff()

    per_task = matrix.groupby("transport_id").agg(
        n_available=("available", "sum"),
        n_eligible=("eligible", "sum"),
    )
    nearest = (
        matrix[matrix["eligible"]].groupby("transport_id")["dist_to_pickup"].min().rename("nearest_eligible_dist")
    )
    ev = ev.merge(per_task, on="transport_id", how="left").merge(nearest, on="transport_id", how="left")
    ev[["n_available", "n_eligible"]] = ev[["n_available", "n_eligible"]].fillna(0).astype(int)

    cols = [
        "transport_id", "time", "inter_arrival", "material_id", "material_stage", "product", "qty",
        "from_entity", "from_kind", "from_area", "from_entity_x", "from_entity_y",
        "to_entity", "to_kind", "to_area", "to_entity_x", "to_entity_y", "task_area",
        "path_steps", "path_steps_raw", "path_unreachable", "manhattan", "detour_factor",
        "n_available", "n_eligible", "nearest_eligible_dist",
    ]
    # Lebenslauf (nur bei neueren Logs): wer hat den Auftrag tatsächlich übernommen, wann, mit welchem Ergebnis
    ev = ev[cols]
    if not run.lifecycle.empty:
        ev = ev.merge(run.lifecycle[["transport_id", *LIFECYCLE_COLS]], on="transport_id", how="left")
    else:
        for c in LIFECYCLE_COLS:
            ev[c] = None
    return ev


LIFECYCLE_COLS = ["assigned_agent", "assigned_robot", "t_assigned", "t_picked_up", "t_completed", "t_aborted",
                  "outcome", "abort_reason", "completed_by", "wait_until_assigned", "lead_time"]


def requests_per_window(tasks: pd.DataFrame, window: float) -> pd.Series:
    """Anzahl Anfragen je Zeitfenster [k*window, (k+1)*window), inklusive leerer Fenster."""
    t0 = tasks["time"].min()
    bins = ((tasks["time"] - t0) // window).astype(int)
    n_windows = int(bins.max()) + 1
    return bins.value_counts().reindex(range(n_windows), fill_value=0).sort_index()


def run_summary(run: Run, tasks: pd.DataFrame) -> dict:
    """Eine Zeile Kennzahlen pro Lauf – Grundlage für den Vergleich vieler Läufe."""
    n_robots = run.robots["robot_id"].nunique()
    candidate_sizes = tasks["n_eligible"].value_counts().reindex(range(n_robots + 1), fill_value=0)
    path = tasks["path_steps"].dropna()
    machines = run.entities[run.entities["kind"] == "Maschine"]

    summary = {
        "run_id": run.run_id,
        "n_requests": len(tasks),
        "duration_s": float(tasks["time"].max() - tasks["time"].min()),
        "n_robots": n_robots,
        "n_entities": len(run.entities),
        "n_machines": len(machines),
        "n_machine_areas": machines["area"].nunique(),
        "n_products": tasks["product"].nunique(),
        "n_material_stages": tasks["material_stage"].nunique(),
        "max_requests_same_time": int(tasks.groupby("time").size().max()),
        "mean_available": round(float(tasks["n_available"].mean()), 2),
        "mean_eligible": round(float(tasks["n_eligible"].mean()), 2),
        "share_zero_eligible": round(float((tasks["n_eligible"] == 0).mean()), 3),
        "n_distinct_aor": run.fleet["aor"].nunique(),
        "path_median": float(path.median()) if not path.empty else np.nan,
        "path_mean": round(float(path.mean()), 1) if not path.empty else np.nan,
        "path_max": float(path.max()) if not path.empty else np.nan,
        "n_path_sentinel": int(tasks["path_unreachable"].sum()),
    }
    for k, n in candidate_sizes.items():
        summary[f"candidates_{k}"] = int(n)
    for w in WINDOW_SIZES:
        counts = requests_per_window(tasks, w)
        summary[f"req_per_{w}s_mean"] = round(float(counts.mean()), 2)
        summary[f"req_per_{w}s_max"] = int(counts.max())

    # Lebenslauf-Kennzahlen (nur wenn das Log ASSIGNED/COMPLETED/… enthält)
    lc = run.lifecycle
    summary["has_lifecycle"] = not lc.empty
    if not lc.empty:
        robots = {f"R{r}" for r in run.robots["robot_id"]}
        mean = lambda s: round(float(s.mean()), 1) if s.notna().any() else np.nan  # noqa: E731
        summary.update({
            "n_completed": int((lc["outcome"] == "abgeschlossen").sum()),
            "n_aborted": int((lc["outcome"] == "abgebrochen").sum()),
            "n_open": int((lc["outcome"] == "offen").sum()),
            "n_by_other_agents": int((lc["assigned_agent"].notna() & ~lc["assigned_agent"].isin(robots)).sum()),
            "mean_wait_until_assigned": mean(lc["wait_until_assigned"]),
            "mean_lead_time": mean(lc["lead_time"]),
        })
    return summary
