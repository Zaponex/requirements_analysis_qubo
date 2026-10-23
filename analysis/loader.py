"""Laden und Normalisieren der Simulations-Logs (Stufe 1).

Ein Simulationslauf besteht aus zwei CSV-Dateien mit gleichem Zeitstempel-Suffix:
  transport_events_<run_id>.csv  – eine Zeile pro Transportanfrage
  transport_fleet_<run_id>.csv   – Flotten-Snapshot (alle Roboter) je Transportanfrage

Konvention: Spaltennamen bleiben englisch (wie in der Simulation), Texte für
Menschen (Kommentare, Plots, Berichte) sind deutsch.
"""
from __future__ import annotations

import re
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

EVENTS_PREFIX = "transport_events_"
FLEET_PREFIX = "transport_fleet_"

# Pfadlängen ab diesem Wert behandelt die Simulation offenbar als "unerreichbar" (Sentinel).
PATH_SENTINEL_THRESHOLD = 10_000

# Präfixe der Entitätsnamen → lesbare Art.
ENTITY_KINDS = {
    "Ma": "Maschine",
    "IntermediateStore": "Zwischenlager",
    "Source": "Quelle",
    "Sink": "Senke",
}

_MACHINE_RE = re.compile(r"^Ma:\s*(?P<area>[^:]+?)\s*:\s*(?P<num>\d+)$")
_SIMPLE_ENTITY_RE = re.compile(r"^(?P<prefix>[A-Za-z]+):\s*(?P<num>\d+)$")
_MATERIAL_RE = re.compile(r"^(?:(?P<stage>.+)_)?(?P<product>\d+)(?:x(?P<qty>\d+))?$")
_ROBOT_RE = re.compile(r"(\d+)\s*$")


@dataclass
class Run:
    """Ein normalisierter Simulationslauf."""

    run_id: str
    events: pd.DataFrame  # eine Zeile pro Transportanfrage (Event REQUESTED)
    fleet: pd.DataFrame  # eine Zeile pro (Transportanfrage, Roboter)
    entities: pd.DataFrame  # eine Zeile pro Entität (Maschine, Lager, Quelle, Senke)
    robots: pd.DataFrame  # eine Zeile pro Roboter (Basis, Zuständigkeiten)
    raw_events: pd.DataFrame  # unverändert als Text – für Datenqualitätsprüfungen
    raw_fleet: pd.DataFrame
    lifecycle: pd.DataFrame  # eine Zeile pro Auftrag: Zuweisung, Abholung, Abschluss/Abbruch (leer bei alten Logs)


def find_runs(data_dir: str | Path) -> dict[str, tuple[Path, Path]]:
    """Findet alle vollständigen Läufe (Events + Flotte) im Verzeichnis."""
    data_dir = Path(data_dir)
    runs: dict[str, tuple[Path, Path]] = {}
    for events_path in sorted(data_dir.glob(f"{EVENTS_PREFIX}*.csv")):
        run_id = events_path.stem.removeprefix(EVENTS_PREFIX)
        fleet_path = data_dir / f"{FLEET_PREFIX}{run_id}.csv"
        if not fleet_path.exists():
            warnings.warn(f"Lauf {run_id}: {fleet_path.name} fehlt – Lauf wird übersprungen")
            continue
        runs[run_id] = (events_path, fleet_path)
    for fleet_path in data_dir.glob(f"{FLEET_PREFIX}*.csv"):
        run_id = fleet_path.stem.removeprefix(FLEET_PREFIX)
        if run_id not in runs:
            warnings.warn(f"Lauf {run_id}: Events-Datei fehlt – Lauf wird übersprungen")
    return runs


def parse_entity(name: str) -> dict:
    """Zerlegt z.B. 'Ma: Verblisterung:1202' in Art, Bereich und Nummer."""
    name = str(name).strip()
    if m := _MACHINE_RE.match(name):
        return {"kind": "Maschine", "area": m["area"].strip().upper(), "num": m["num"]}
    if m := _SIMPLE_ENTITY_RE.match(name):
        return {"kind": ENTITY_KINDS.get(m["prefix"], m["prefix"]), "area": None, "num": m["num"]}
    return {"kind": "Unbekannt", "area": None, "num": None}


def parse_material(material_id: str) -> dict:
    """Zerlegt z.B. 'Kontr_Verpackt_18424930x1' in Prozessstufe, Produkt und Menge.

    Eine reine Produktnummer ohne Präfix (z.B. '18424930') ist Rohmaterial aus der Quelle.
    """
    m = _MATERIAL_RE.match(str(material_id).strip())
    if not m:
        return {"stage": "Unbekannt", "product": None, "qty": None}
    return {
        "stage": m["stage"] or "Roh",
        "product": m["product"],
        "qty": int(m["qty"]) if m["qty"] else None,
    }


def task_area(from_kind: str, from_area: str | None, to_kind: str, to_area: str | None) -> str | None:
    """Bereich, dem ein Auftrag zugeordnet wird (Annahme, siehe docs/DATENFORMAT.md).

    Bereich der Abholmaschine; ist die Abholung keine Maschine, der Bereich der
    Zielmaschine; sonst None (= jeder Roboter darf den Auftrag übernehmen).
    """
    if from_kind == "Maschine":
        return from_area
    if to_kind == "Maschine":
        return to_area
    return None


LIFECYCLE_EVENTS = ("ASSIGNED", "PICKED_UP", "COMPLETED", "ABORTED")


def _read_raw(path: Path) -> pd.DataFrame:
    # Alles als Text lesen: erhält führende Nullen in Material-IDs und macht
    # gemischte Zahlformate ('0' vs. '1.0') sichtbar. utf-8-sig entfernt ein evtl. BOM am Dateianfang.
    return pd.read_csv(path, sep=";", dtype=str, keep_default_na=False, na_values=[""], encoding="utf-8-sig")


def _requests(raw: pd.DataFrame) -> pd.DataFrame:
    """Nur die Anfragen. Ältere Logs enthalten ausschließlich REQUESTED, neuere den ganzen Lebenslauf."""
    if "event" not in raw:
        return raw
    return raw[raw["event"].str.strip() == "REQUESTED"]


def _robot_number(series: pd.Series) -> pd.Series:
    """Nummer nur für Transportroboter (andere Agenten wie Werker → leer)."""
    nums = series.str.extract(_ROBOT_RE, expand=False).astype("Int64")
    return nums.where(series.str.startswith("TransportRobot"))


AGENT_PREFIX = {"TransportRobot": "R", "Worker": "W"}


def agent_label(vehicle_id) -> str | None:
    """'TransportRobot: 61' → 'R61', 'Worker: 42' → 'W42' (Werker), sonst der Originaltext."""
    if vehicle_id is None or (isinstance(vehicle_id, float) and pd.isna(vehicle_id)) or not str(vehicle_id).strip():
        return None
    kind, _, num = str(vehicle_id).partition(":")
    return f"{AGENT_PREFIX[kind.strip()]}{num.strip()}" if kind.strip() in AGENT_PREFIX and num.strip() else str(vehicle_id).strip()


def _build_lifecycle(raw: pd.DataFrame, requests: pd.DataFrame) -> pd.DataFrame:
    """Eine Zeile pro Auftrag mit den Zeitpunkten seines Lebenslaufs (leer, wenn das Log keine Lifecycle-Events hat)."""
    if "event" not in raw or not raw["event"].isin(LIFECYCLE_EVENTS).any():
        return pd.DataFrame()
    ev = raw[raw["event"].isin(LIFECYCLE_EVENTS)].copy()
    ev["transport_id"] = ev["transport_id"].astype(int)
    ev["time"] = ev["time"].astype(float)
    ev["robot_id"] = _robot_number(ev["vehicle_id"].fillna(""))
    ev["agent"] = ev["vehicle_id"].map(agent_label)
    ev = ev.sort_values(["transport_id", "time"])

    out = requests[["transport_id", "time"]].rename(columns={"time": "t_requested"}).set_index("transport_id")
    for name, col in [("ASSIGNED", "t_assigned"), ("PICKED_UP", "t_picked_up"), ("COMPLETED", "t_completed"), ("ABORTED", "t_aborted")]:
        first = ev[ev["event"] == name].groupby("transport_id")["time"].min()
        out[col] = first
    assigned = ev[ev["event"] == "ASSIGNED"]
    out["assigned_agent"] = assigned.groupby("transport_id")["agent"].last()  # z.B. R61 oder W42 (Werker)
    out["assigned_robot"] = assigned.groupby("transport_id")["robot_id"].last().astype("Int64")  # nur Roboter
    out["n_assigned"] = assigned.groupby("transport_id").size()
    out["n_assigned"] = out["n_assigned"].fillna(0).astype(int)
    done = ev[ev["event"] == "COMPLETED"].groupby("transport_id").last()
    out["completed_by"] = done.apply(
        lambda r: r["agent"] if pd.notna(r["agent"]) else (str(r["info"]) if pd.notna(r["info"]) else "unbekannt"), axis=1
    ) if not done.empty else None
    aborted = ev[ev["event"] == "ABORTED"].groupby("transport_id").last()
    out["abort_reason"] = aborted["info"] if not aborted.empty else None
    out["outcome"] = "offen"
    out.loc[out["t_aborted"].notna(), "outcome"] = "abgebrochen"
    out.loc[out["t_completed"].notna(), "outcome"] = "abgeschlossen"
    out["wait_until_assigned"] = out["t_assigned"] - out["t_requested"]
    out["lead_time"] = out["t_completed"] - out["t_requested"]
    return out.reset_index()


def _normalize_events(raw: pd.DataFrame) -> pd.DataFrame:
    ev = _requests(raw).copy()
    ev["transport_id"] = ev["transport_id"].astype(int)
    ev["time"] = ev["time"].astype(float)
    for col in ["from_entity_x", "from_entity_y", "to_entity_x", "to_entity_y"]:
        ev[col] = ev[col].astype(int)

    for side in ["from", "to"]:
        parsed = pd.DataFrame([parse_entity(n) for n in ev[f"{side}_entity"]], index=ev.index)
        ev[f"{side}_kind"] = parsed["kind"]
        ev[f"{side}_area"] = parsed["area"]

    material = pd.DataFrame([parse_material(m) for m in ev["material_id"]], index=ev.index)
    ev["material_stage"] = material["stage"]
    ev["product"] = material["product"]
    ev["qty"] = material["qty"].astype("Int64")

    steps = pd.to_numeric(ev["shortest_path_number_of_steps_in_path"], errors="coerce")
    ev["path_steps_raw"] = steps
    ev["path_unreachable"] = steps >= PATH_SENTINEL_THRESHOLD
    ev["path_steps"] = steps.where(~ev["path_unreachable"], np.nan)

    ev["task_area"] = [
        task_area(fk, fa, tk, ta)
        for fk, fa, tk, ta in zip(ev["from_kind"], ev["from_area"], ev["to_kind"], ev["to_area"])
    ]
    return ev.sort_values(["time", "transport_id"]).reset_index(drop=True)


def _normalize_fleet(raw: pd.DataFrame) -> pd.DataFrame:
    fl = raw.copy()
    fl["transport_id"] = fl["transport_id"].astype(int)
    fl["time"] = fl["time"].astype(float)
    fl["robot_id"] = fl["vehicle_id"].str.extract(_ROBOT_RE, expand=False).astype(int)
    fl["x"] = fl["x"].astype(int)
    fl["y"] = fl["y"].astype(int)
    fl["battery_percent"] = fl["battery_percent"].astype(float)
    fl["aor"] = fl["area_of_responsibility"].fillna("").map(
        lambda s: tuple(sorted(a.strip().upper() for a in s.split("|") if a.strip()))
    )
    fl["available"] = fl["available"].str.strip().str.lower().map({"true": True, "false": False})
    if "reserved_for_transport_id" in fl:  # neuere Logs: für welchen Auftrag der Roboter reserviert ist
        fl["reserved_for_transport_id"] = pd.to_numeric(fl["reserved_for_transport_id"], errors="coerce").astype("Int64")
    return fl.sort_values(["transport_id", "robot_id"]).reset_index(drop=True)


def _build_entities(ev: pd.DataFrame) -> pd.DataFrame:
    """Sammelt alle Entitäten mit Koordinaten aus Abhol- und Zielseite."""
    parts = []
    for side, role in [("from", "pickups"), ("to", "dropoffs")]:
        part = ev[[f"{side}_entity", f"{side}_entity_x", f"{side}_entity_y", f"{side}_kind", f"{side}_area"]]
        part = part.set_axis(["entity", "x", "y", "kind", "area"], axis=1)
        part = part.assign(role=role)
        parts.append(part)
    both = pd.concat(parts, ignore_index=True)
    counts = both.pivot_table(index="entity", columns="role", values="x", aggfunc="size", fill_value=0)
    first = both.drop_duplicates("entity").set_index("entity")[["kind", "area", "x", "y"]]
    n_coords = both.groupby("entity")[["x", "y"]].nunique().max(axis=1).rename("n_coordinates")
    entities = first.join(counts).join(n_coords).reset_index()
    for col in ["pickups", "dropoffs"]:
        if col not in entities:
            entities[col] = 0
    return entities.sort_values(["kind", "area", "entity"], na_position="last").reset_index(drop=True)


def _build_robots(fl: pd.DataFrame) -> pd.DataFrame:
    """Ein Eintrag pro Roboter; Basis = häufigste Position im Zustand IDLE."""
    rows = []
    for robot_id, grp in fl.groupby("robot_id"):
        idle = grp[grp["status"] == "IDLE"]
        source = idle if not idle.empty else grp
        base = source.groupby(["x", "y"]).size().idxmax()
        rows.append({
            "robot_id": robot_id,
            "vehicle_id": grp["vehicle_id"].iloc[0],
            "base_x": base[0],
            "base_y": base[1],
            "aor": grp["aor"].iloc[0],
            "n_distinct_aor": grp["aor"].nunique(),
        })
    return pd.DataFrame(rows)


def load_run(run_id: str, events_path: Path, fleet_path: Path) -> Run:
    raw_events = _read_raw(events_path)
    raw_fleet = _read_raw(fleet_path)
    events = _normalize_events(raw_events)
    fleet = _normalize_fleet(raw_fleet)
    return Run(
        run_id=run_id,
        events=events,
        fleet=fleet,
        entities=_build_entities(events),
        robots=_build_robots(fleet),
        raw_events=raw_events,
        raw_fleet=raw_fleet,
        lifecycle=_build_lifecycle(raw_events, events),
    )
