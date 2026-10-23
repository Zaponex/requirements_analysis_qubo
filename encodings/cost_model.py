"""Kostenmodell: Was kostet es, wenn Roboter r Auftrag t übernimmt?

Liefert für jede Zuweisung (t, r) die Zahl c_tr, die in der QUBO auf der Diagonale landet –
je nach gewähltem **Bewertungskriterium**. Jede Zahl wird in ihre Einzelfaktoren zerlegt
(Wartezeit, Anfahrt, Beladen, Lastfahrt, …), damit nachvollziehbar ist, woraus sie besteht.

Zwei Arten von Kriterien:

- **Diagonal-Kriterien** (umgesetzt): Pro Zuweisung eine feste Zahl → nur die Diagonale der
  QUBO ändert sich, die Kopplungsstruktur bleibt gleich.
- **Struktur-Kriterien**: Sie brauchen neue Kopplungen oder Hilfsvariablen und verändern
  damit den Hardware-Bedarf. Umgesetzt ist die Summe der Erledigungszeiten mit Reihenfolge
  (SEQUENCE_CRITERIA, Formulierung in formulations.one_hot_sequence); Makespan, Auslastung,
  Durchsatz und Anzahl zugewiesener Aufträge sind geplant.

Wichtig: Die Diagonal-Kriterien gelten für die **Sofortzuweisung** (instantaneous assignment,
Gerkey & Matarić 2004) – jeder Roboter bekommt je Entscheidung höchstens einen Auftrag. Nur dann
ist c_tr eine feste Zahl. Fährt ein Roboter mehrere Aufträge nacheinander, hängen Anfahrt und
Erledigungszeit vom Vorgänger ab; eine Summe von Erledigungszeiten lässt sich dann nicht mehr
als eine Zahl je (Auftrag, Roboter) schreiben.

Alle Parameter sind Annahmen (nicht in den Simulationslogs enthalten) und in der Oberfläche
einstellbar. Die Fahrgeschwindigkeit ist aus den Flotten-Snapshots grob geschätzt
(90-%-Quantil der Verschiebung fahrender Roboter ≈ 1 Feld/s).
"""
from __future__ import annotations

PARAMS: dict[str, dict] = {
    "v": {"label": "Fahrgeschwindigkeit", "unit": "Felder/s", "default": 1.0, "min": 0.1, "step": 0.1},
    "t_lade": {"label": "Beladezeit", "unit": "s", "default": 10.0, "min": 0, "step": 1},
    "t_ent": {"label": "Entladezeit", "unit": "s", "default": 10.0, "min": 0, "step": 1},
    "t_rest": {"label": "Restzeit eines belegten Roboters", "unit": "s", "default": 60.0, "min": 0, "step": 5},
    "soll": {"label": "Soll-Durchlaufzeit je Auftrag (Fälligkeit)", "unit": "s", "default": 120.0, "min": 0, "step": 10},
    "e_leer": {"label": "Energie je Feld leer", "unit": "Wh/Feld", "default": 1.0, "min": 0, "step": 0.1},
    "f_last": {"label": "Traglast-Faktor beladen", "unit": "×", "default": 1.5, "min": 1, "step": 0.1},
    "e_warte": {"label": "Energie je s Warten", "unit": "Wh/s", "default": 0.05, "min": 0, "step": 0.01},
    "k_fix": {"label": "Fixkosten je Auftrag", "unit": "ct", "default": 5.0, "min": 0, "step": 1},
    "k_zeit": {"label": "Betriebskosten je s", "unit": "ct/s", "default": 0.5, "min": 0, "step": 0.1},
    "k_energie": {"label": "Energiekosten je Wh", "unit": "ct/Wh", "default": 0.03, "min": 0, "step": 0.01},
    "w_strecke": {"label": "Gewicht Fahrstrecke", "unit": "Punkte/Feld", "default": 1.0, "min": 0, "step": 0.1},
    "w_zeit": {"label": "Gewicht Erledigungszeit", "unit": "Punkte/s", "default": 0.5, "min": 0, "step": 0.1},
    "w_energie": {"label": "Gewicht Energie", "unit": "Punkte/Wh", "default": 0.5, "min": 0, "step": 0.1},
    "w_versp": {"label": "Gewicht Verspätung", "unit": "Punkte/s", "default": 2.0, "min": 0, "step": 0.1},
}

# Diagonal-Kriterien: Reihenfolge = Reihenfolge in der Auswahl
CRITERIA: list[dict] = [
    {"key": "leerfahrt", "label": "Leerfahrt-Distanz", "en": "Travel Distance (Anfahrt)", "unit": "Felder",
     "goal": "die Summe der Anfahrtswege (Leerfahrten) möglichst klein ist",
     "formula": "c = d_leer", "params": []},
    {"key": "fahrstrecke", "label": "Gesamte Fahrstrecke", "en": "Travel Distance", "unit": "Felder",
     "goal": "die gesamte Fahrstrecke (Anfahrt + Lastfahrt) möglichst klein ist",
     "formula": "c = d_leer + d_last", "params": []},
    {"key": "fahrzeit", "label": "Fahrzeit", "en": "Travel Time", "unit": "s",
     "goal": "die gesamte Fahrzeit möglichst klein ist",
     "formula": "c = (d_leer + d_last) / v", "params": ["v"]},
    {"key": "bearbeitungszeit", "label": "Bearbeitungszeit", "en": "Total Processing Time", "unit": "s",
     "goal": "die Summe der Bearbeitungszeiten (Anfahrt, Beladen, Lastfahrt, Entladen) möglichst klein ist",
     "formula": "c = d_leer/v + t_lade + d_last/v + t_ent", "params": ["v", "t_lade", "t_ent"]},
    {"key": "erledigungszeit", "label": "Erledigungszeit (ein Auftrag je Roboter)", "en": "Task Completion Time", "unit": "s",
     "goal": "die Summe der Erledigungszeitpunkte (inklusive Warten auf belegte Roboter) möglichst klein ist",
     "formula": "c = t_warte + d_leer/v + t_lade + d_last/v + t_ent", "params": ["v", "t_lade", "t_ent", "t_rest"],
     "sequence_note": True},
    {"key": "durchlaufzeit", "label": "Durchlaufzeit", "en": "Throughput Time", "unit": "s",
     "goal": "die Summe der Durchlaufzeiten (Anfrage bis Ablieferung) möglichst klein ist",
     "formula": "c = Alter der Anfrage + Erledigungszeit", "params": ["v", "t_lade", "t_ent", "t_rest"],
     "sequence_note": True},
    {"key": "verspaetung", "label": "Verspätung", "en": "Tardiness", "unit": "s",
     "goal": "die Summe der Verspätungen gegenüber der Soll-Durchlaufzeit möglichst klein ist",
     "formula": "c = max(0, Fertigstellung − (Anfragezeit + Soll))", "params": ["v", "t_lade", "t_ent", "t_rest", "soll"],
     "sequence_note": True},
    {"key": "energie", "label": "Energieverbrauch", "en": "Energy Consumption", "unit": "Wh",
     "goal": "der gesamte Energieverbrauch möglichst klein ist",
     "formula": "c = e_leer·d_leer + e_leer·f_last·d_last + e_warte·t_warte", "params": ["e_leer", "f_last", "e_warte", "t_rest"]},
    {"key": "betriebskosten", "label": "Betriebskosten", "en": "Assignment / Operating Cost", "unit": "ct",
     "goal": "die Betriebskosten aller Zuweisungen möglichst klein sind",
     "formula": "c = k_fix + k_zeit·Bearbeitungszeit + k_energie·Energie",
     "params": ["k_fix", "k_zeit", "k_energie", "v", "t_lade", "t_ent", "e_leer", "f_last", "e_warte", "t_rest"]},
    {"key": "gewichtet", "label": "Gewichtete Kombination", "en": "Weighted Sum", "unit": "Punkte",
     "goal": "die gewichtete Summe aus Strecke, Erledigungszeit, Energie und Verspätung möglichst klein ist",
     "formula": "c = w_strecke·(d_leer + d_last) + w_zeit·Erledigungszeit + w_energie·Energie + w_versp·Verspätung",
     "params": ["w_strecke", "w_zeit", "w_energie", "w_versp", "v", "t_lade", "t_ent", "t_rest", "soll", "e_leer", "f_last", "e_warte"],
     "sequence_note": True},
]
CRITERIA_BY_KEY = {c["key"]: c for c in CRITERIA}

# Hinweis für alle Kriterien mit "sequence_note": Summen von Zeitpunkten sind nur bei Sofortzuweisung diagonal
SEQUENCE_NOTE = ("Exakt nur, solange jeder Roboter höchstens einen Auftrag bekommt (Sofortzuweisung). Fährt ein Roboter "
                 "mehrere Aufträge nacheinander, hängt die Erledigungszeit von den Vorgängern ab – dann braucht die QUBO "
                 "Hilfsvariablen für die Reihenfolge.")

# Kriterien der Zuweisung mit Reihenfolge (formulations.one_hot_sequence). Gewicht eines Platzes:
# q = Platz von hinten (Erledigungszeiten summieren sich auf) oder 1 (jede Fahrt zählt genau einmal).
SEQUENCE_CRITERIA: list[dict] = [
    {"key": "erledigungszeit", "label": "Summe der Erledigungszeiten", "en": "Total Completion Time", "unit": "s",
     "goal": "die Summe der Erledigungszeitpunkte aller Aufträge möglichst klein ist",
     "formula": "Σ_t C_t, C_t = Warten + alle Fahrten und Ladezeiten bis zur Ablieferung von t",
     "position_weight": True, "release": True, "params": ["v", "t_lade", "t_ent", "t_rest"]},
    {"key": "bearbeitungszeit", "label": "Summe der Arbeitszeiten", "en": "Total Processing Time (inkl. Anfahrten)", "unit": "s",
     "goal": "die gesamte Arbeitszeit der Roboter (Anfahrten, Beladen, Lastfahrten, Entladen) möglichst klein ist",
     "formula": "Σ_r (alle Anfahrten + Ladezeiten + Lastfahrten von r)",
     "position_weight": False, "release": False, "params": ["v", "t_lade", "t_ent"]},
]
SEQUENCE_CRITERIA_BY_KEY = {c["key"]: c for c in SEQUENCE_CRITERIA}

# Kriterien, die sich nicht als eine Zahl je Zuweisung schreiben lassen
STRUCTURAL: list[dict] = [
    {"key": "gesamterledigungszeit", "label": "Erledigungszeit mit Reihenfolge", "en": "Total Completion Time (time-extended)",
     "page": "reihenfolge",
     "why": "Fährt ein Roboter mehrere Aufträge nacheinander, ist die Erledigungszeit eines Auftrags die Summe aller Fahrten "
            "und Ladezeiten davor – sie hängt davon ab, welche Aufträge vorher auf demselben Roboter liegen.",
     "qubo": "Hilfsvariablen x_trq für den Platz q in der Reihenfolge: n·m·K statt n·m Qubits, Kopplungen zwischen "
             "benachbarten Plätzen desselben Roboters und eine Lückenregel. Umgesetzt auf der Seite „One-Hot + Reihenfolge“."},
    {"key": "makespan", "label": "Makespan", "en": "Makespan",
     "why": "Minimiert das Maximum der Fertigstellungszeiten – ein Maximum ist weder linear noch quadratisch.",
     "qubo": "Hilfsvariablen für eine Schranke M (z.B. binär kodiert) plus Strafen „Fertigstellung ≤ M“ → zusätzliche Qubits und Kopplungen zu allen Schaltern."},
    {"key": "auslastung", "label": "Auslastung / Workload Balancing", "en": "Resource Utilization / Workload Balancing",
     "why": "Bewertet die Verteilung der Last über die Roboter, nicht einzelne Zuweisungen.",
     "qubo": "Quadratische Abweichung Σ_r (Last_r − Ø)² → Kopplungen zwischen Aufträgen auf demselben Roboter; sinnvoll erst, wenn ein Roboter mehrere Aufträge nacheinander bekommen darf."},
    {"key": "durchsatz", "label": "Durchsatz", "en": "System Throughput",
     "why": "Aufträge pro Zeit ist ein Quotient – nicht direkt als QUBO darstellbar.",
     "qubo": "Näherung über „möglichst viele Aufträge im Horizont“: Belohnung je Zuweisung und eine Zeilenregel „höchstens ein Roboter“ statt „genau einer“."},
    {"key": "anzahl", "label": "Anzahl zugewiesener Aufträge", "en": "Number of Allocated / Completed Tasks",
     "why": "Ist nur sinnvoll, wenn Aufträge auch unversorgt bleiben dürfen.",
     "qubo": "Belohnung −w je eingeschaltetem Schalter (Diagonale) und Zeilenregel „höchstens eins“: A·Σ x·x′ statt A·(1 − Σx)² → andere Kopplungswerte, keine Konstante."},
]


def resolve_params(overrides: dict | None) -> dict[str, float]:
    """Standardwerte mit Benutzerwerten überschreiben; Werte auf ihren Mindestwert begrenzen."""
    out = {k: float(p["default"]) for k, p in PARAMS.items()}
    for k, v in (overrides or {}).items():
        if k not in PARAMS:
            raise ValueError(f"Unbekannter Parameter: {k}")
        try:
            out[k] = max(float(PARAMS[k]["min"]), float(v))
        except (TypeError, ValueError):
            raise ValueError(f"Parameter {k} muss eine Zahl sein") from None
    return out


def components(task: dict, robot: dict, t0: float, p: dict[str, float], d_leer: float) -> dict:
    """Alle Einzelgrößen einer Zuweisung – Grundlage jedes Kriteriums."""
    d_last = float(task["loaded_distance"])
    t_warte = 0.0 if robot["available"] else p["t_rest"]
    t_leer = d_leer / p["v"]
    t_last = d_last / p["v"]
    t_handling = p["t_lade"] + p["t_ent"]
    t_proc = t_leer + p["t_lade"] + t_last + p["t_ent"]
    completion = t_warte + t_proc
    start = max(t0, task["time"])  # ein Auftrag kann erst nach seiner Anfrage beginnen
    alter = start - task["time"]
    finish = start + completion
    durchlauf = finish - task["time"]
    due = task["time"] + p["soll"]
    versp = max(0.0, finish - due)
    e_fahrt_leer = p["e_leer"] * d_leer
    e_fahrt_last = p["e_leer"] * p["f_last"] * d_last
    e_warten = p["e_warte"] * t_warte
    energie = e_fahrt_leer + e_fahrt_last + e_warten
    return dict(d_leer=d_leer, d_last=d_last, t_warte=t_warte, t_leer=t_leer, t_last=t_last, t_handling=t_handling,
                t_proc=t_proc, completion=completion, alter=alter, finish=finish, durchlauf=durchlauf, due=due,
                versp=versp, e_fahrt_leer=e_fahrt_leer, e_fahrt_last=e_fahrt_last, e_warten=e_warten, energie=energie)


def criterion_parts(key: str, c: dict, p: dict[str, float]) -> list[dict]:
    """Zerlegung von c_tr in Teile. const=True: für alle Roboter dieses Auftrags gleich."""
    def part(name, value, const=False):
        return {"name": name, "value": round(float(value), 4), "const": const}

    if key == "leerfahrt":
        return [part("Anfahrt", c["d_leer"])]
    if key == "fahrstrecke":
        return [part("Anfahrt", c["d_leer"]), part("Lastfahrt", c["d_last"], True)]
    if key == "fahrzeit":
        return [part("Anfahrt", c["t_leer"]), part("Lastfahrt", c["t_last"], True)]
    if key == "bearbeitungszeit":
        return [part("Anfahrt", c["t_leer"]), part("Beladen", p["t_lade"], True), part("Lastfahrt", c["t_last"], True),
                part("Entladen", p["t_ent"], True)]
    if key == "erledigungszeit":
        return [part("Warten", c["t_warte"]), part("Anfahrt", c["t_leer"]), part("Beladen", p["t_lade"], True),
                part("Lastfahrt", c["t_last"], True), part("Entladen", p["t_ent"], True)]
    if key == "durchlaufzeit":
        return [part("Alter der Anfrage", c["alter"], True), part("Warten", c["t_warte"]), part("Anfahrt", c["t_leer"]),
                part("Beladen", p["t_lade"], True), part("Lastfahrt", c["t_last"], True), part("Entladen", p["t_ent"], True)]
    if key == "verspaetung":
        return [part("Verspätung", c["versp"])]
    if key == "energie":
        return [part("Leerfahrt", c["e_fahrt_leer"]), part("Lastfahrt (Traglast)", c["e_fahrt_last"], True),
                part("Warten", c["e_warten"])]
    if key == "betriebskosten":
        return [part("Fixkosten", p["k_fix"], True), part("Betriebszeit", p["k_zeit"] * c["t_proc"]),
                part("Energie", p["k_energie"] * c["energie"])]
    if key == "gewichtet":
        return [part("Strecke", p["w_strecke"] * (c["d_leer"] + c["d_last"])), part("Erledigungszeit", p["w_zeit"] * c["completion"]),
                part("Energie", p["w_energie"] * c["energie"]), part("Verspätung", p["w_versp"] * c["versp"])]
    raise ValueError(f"Unbekanntes Kriterium: {key}")


def assignment_cost(key: str, task: dict, robot: dict, t0: float, p: dict[str, float], d_leer: float) -> tuple[float, list[dict], dict]:
    """c_tr für ein Kriterium, mit Zerlegung und allen Einzelgrößen."""
    if key not in CRITERIA_BY_KEY:
        raise ValueError(f"Unbekanntes Kriterium: {key}")
    comp = components(task, robot, t0, p, d_leer)
    parts = criterion_parts(key, comp, p)
    cost = round(sum(x["value"] for x in parts), 4)
    return cost, parts, {k: round(v, 4) for k, v in comp.items()}
