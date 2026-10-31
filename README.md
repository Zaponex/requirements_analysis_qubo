# requirements_analysis_qubo

**Wie verändern reale Aufgabenverteilungen in der Multi-Robot Task Allocation (MRTA) die Anforderungen an Quantenhardware – und welche QUBO-Formulierung passt zu welchem Problem?**

## Worum geht es?

Die Zuweisung von Transportaufträgen an Roboter lässt sich als QUBO (Quadratic Unconstrained Binary Optimization) formulieren. Wie groß und wie stark gekoppelt ein solches QUBO wird, hängt von zwei Dingen ab:

- **vom Problem selbst:** wie viele Aufträge gleichzeitig offen sind, wie viele Roboter jeweils in Frage kommen und wie stark die Kosten streuen,
- **von der Kodierung der Zuweisungsvariablen:** One-Hot, Domain Wall oder Binary Encoding.

Beides zusammen bestimmt die Anforderungen an die Hardware: Anzahl Qubits, Konnektivität und Koeffizienten-Präzision.

Statt synthetischer Instanzen nutzt dieses Projekt **Transportaufträge aus Fabrik-Simulationen**. Mit jedem neuen Simulationslauf wächst die Datenbasis. Ziel ist es, Problemklassen systematisch passenden Formulierungen und passender Hardware zuzuordnen.

## Stand

| Stufe | Inhalt | Status |
| --- | --- | --- |
| 1 | Simulationsdaten aufbereiten, prüfen, visualisieren | ✅ umgesetzt in [`analysis/`](analysis/) |
| 2 | Instanzbildung: Zuweisungsprobleme aus den Logs schneiden | geplant |
| 3 | QUBO-Formulierung: One-Hot / Domain Wall / Binary | geplant |
| 4 | Hardware-Mapping | geplant |
| 5 | Vergleich & Requirements-Mapping über alle Läufe | geplant |

Das Gesamtkonzept steht in [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

Dazu kommen zwei Wege zum Lernen und Erkunden:

- **[Lernlabor (Website)](webapp/README.md):** eine lokale Website, auf der die Pipeline Schritt für Schritt interaktiv aufgebaut wird. Reiter 1 · Daten ✅, Reiter 2 · Kodierungen IA (Sofortzuweisung, drei Fälle T : R) mit One-Hot, Domain Wall und Binary ✅, Reiter 3 · Kodierungen TA (mit Reihenfolge) mit One-Hot, Reihenfolge, Domain Wall, Binary und Formel-Baukasten ✅, Reiter 4 · Hardware folgt.
- **[Kodierungen bildlich erklärt](encodings/README.md):** One-Hot, Domain Wall und Binary als Lesekapitel mit nachgerechneten Abbildungen.

## Schnellstart (PowerShell, aus dem Projektordner)

```powershell
.\venv\Scripts\Activate.ps1          # falls die venv fehlt: python -m venv venv
pip install -r requirements.txt
python -m webapp --open              # Lernlabor im Browser: http://127.0.0.1:8003
python analysis/analysis.py          # PNG-Berichte für alle Läufe in data/transport_logs/
```

Die **Website** ist der interaktive Einstieg: Zeitreise durch die Simulation, Auftrag × Roboter, filterbare Auswertungen und Lauf-Vergleich.

Die **PNG-Berichte** liegen danach in `outputs/<run_id>/bericht.md` (in VS Code: Markdown-Vorschau mit `Strg+Shift+V`). Eine Übersicht über alle Läufe steht in `outputs/laeufe_uebersicht.md`.

## Neuen Simulationslauf hinzufügen

1. Das Dateipaar `transport_events_<run_id>.csv` und `transport_fleet_<run_id>.csv` nach `data/transport_logs/` kopieren. Beide Dateien müssen dasselbe Suffix haben.
2. Die Website neu laden – der Lauf erscheint in der Laufauswahl. Für den PNG-Bericht `python analysis/analysis.py` ausführen.

Details stehen in [data/README.md](data/README.md).

## Projektstruktur

```text
requirements_analysis_qubo/
├── README.md               ← diese Datei: Überblick & Einstieg
├── requirements.txt        ← Python-Abhängigkeiten (pandas, numpy, matplotlib, fastapi, uvicorn, plotly)
├── docs/
│   ├── ARCHITEKTUR.md      ← Pipeline-Stufen, Datenfluss, Designprinzipien, offene Fragen
│   └── DATENFORMAT.md      ← Aufbau der Simulations-CSVs, Namensschemata, bekannte Auffälligkeiten
├── data/
│   ├── README.md           ← Ablagekonvention für Simulationsläufe
│   └── transport_logs/     ← Rohdaten aus der Simulation (werden nie verändert)
├── analysis/               ← Stufe 1: Aufbereitung, Prüfung, Visualisierung
│   ├── README.md           ← Module, Aufruf, Ausgaben, Erweiterung
│   ├── analysis.py         ← Einstiegspunkt (CLI), schreibt Berichte
│   ├── loader.py           ← Läufe finden, CSVs laden & normalisieren
│   ├── checks.py           ← Datenqualitätsprüfungen
│   ├── features.py         ← Kennzahlen pro Auftrag, (Auftrag, Roboter) und Lauf
│   └── plots.py            ← Grafiken
├── webapp/                 ← Lernlabor: lokale Website (python -m webapp)
│   ├── README.md           ← Start, Ansichten, Aufbau, Erweiterung
│   ├── server.py           ← FastAPI-Server (JSON-API + Oberfläche)
│   ├── data_service.py     ← lädt Läufe über analysis/ – gleiche Zahlen wie die PNG-Berichte
│   └── static/             ← HTML, CSS, JavaScript (Reiter, Zeitreise, Diagramme)
├── encodings/              ← Lernmaterial: die drei Kodierungen bildlich erklärt
│   ├── README.md           ← Übersicht, laufendes Beispiel, Schreibweise, Literatur
│   ├── common.py           ← gemeinsames Beispiel & Stil für alle Kapitel
│   ├── formulations.py     ← One-Hot (Sofortzuweisung und mit Reihenfolge) als Regeln + QUBO-Einträge
│   ├── cost_model.py       ← Bewertungskriterien: was kostet eine Zuweisung?
│   ├── baukasten.py        ← Formel-Baukasten: Bausteine × Kodierung je Auftrag (auch falsch) + Diagnose-Grundlagen
│   ├── one_hot/            ← Kapitel One-Hot (README + illustrate.py + abbildungen/)
│   ├── domain_wall/        ← Kapitel Domain Wall (gleicher Aufbau)
│   ├── binary/             ← Kapitel Binary (gleicher Aufbau)
│   └── reihenfolge/        ← One-Hot mit Reihenfolge: Hilfsvariablen für die Summe der Erledigungszeiten
├── tests/                  ← python -m pytest tests (Formulierung, Website-API)
├── outputs/                ← generiert, nicht versioniert (siehe .gitignore)
│   ├── <run_id>/           ← bericht.md, Grafiken, Tabellen, kennzahlen.json
│   └── laeufe_uebersicht.* ← Vergleich aller Läufe
└── venv/                   ← lokale Python-Umgebung (nicht versioniert)
```

## Dokumentation

| Dokument | Wofür |
| --- | --- |
| [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) | Wie das Projekt aufgebaut ist und wohin es sich entwickelt |
| [docs/DATENFORMAT.md](docs/DATENFORMAT.md) | Was in den Simulationsdaten steht und was fehlt |
| [data/README.md](data/README.md) | Wie neue Simulationsläufe abgelegt werden |
| [analysis/README.md](analysis/README.md) | Wie die Analyse funktioniert und erweitert wird |
| [webapp/README.md](webapp/README.md) | Wie das Lernlabor gestartet, bedient und erweitert wird |
| [encodings/README.md](encodings/README.md) | Wie One-Hot, Domain Wall und Binary funktionieren – Schritt für Schritt am echten Beispiel |
