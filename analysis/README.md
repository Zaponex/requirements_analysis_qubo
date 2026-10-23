# Stufe 1 – Aufbereitung & Analyse

Liest die Simulationslogs, normalisiert sie, prüft die Datenqualität und erzeugt pro Lauf einen Bericht mit Kennzahlen und Grafiken. Hier wird bewusst **nur beschrieben**: Es entstehen noch keine QUBO-Instanzen (siehe [docs/ARCHITEKTUR.md](../docs/ARCHITEKTUR.md)).

## Aufruf

Aus dem Projektordner, mit aktivierter venv:

```powershell
python analysis/analysis.py                                  # alle Läufe
python analysis/analysis.py --run 2026-10-09_12-59-39        # nur ein Lauf (mehrfach angebbar)
python analysis/analysis.py --data-dir <ordner> --out <ordner>
```

| Option | Standard | Bedeutung |
| --- | --- | --- |
| `--data-dir` | `data/transport_logs` | Ordner mit den CSV-Paaren |
| `--out` | `outputs` | Ausgabeordner |
| `--run` | alle | nur bestimmte Läufe verarbeiten |

## Ausgaben

Pro Lauf in `outputs/<run_id>/`:

| Datei | Inhalt |
| --- | --- |
| `bericht.md` | **Einstiegspunkt:** Kennzahlen, Datenqualität, Annahmen, alle Grafiken mit Lesehilfe |
| `01_layout_materialfluss.png` | Layout der Fabrik mit Transportflüssen und Roboter-Basen |
| `02_uebergaenge.png` | Übergangsmatrix Bereich → Bereich, Anzahl je Materialstufe |
| `03_zeitlinie.png` | Eingang der Anfragen über die Zeit, Zwischenankunftszeiten |
| `04_flottenzustand.png` | Status je Roboter über die Zeit, Akkustand je Roboter, Anzahl verfügbarer Roboter |
| `05_kandidaten.png` | Matrix Auftrag × Roboter (wer kommt in Frage, wie weit entfernt), Größe der Kandidatenmengen |
| `06_pfadlaengen.png` | Verteilung der Pfadlängen, Pfadlänge vs. Manhattan-Distanz |
| `07_roboterpositionen.png` | Positionen jedes Roboters über alle Snapshots |
| `08_zeitfenster.png` | Anfragen pro Zeitfenster über die Simulationszeit, für Δt = 30 / 60 / 120 s |
| `auftraege.csv` | eine Zeile pro Anfrage mit allen abgeleiteten Größen |
| `auftrag_roboter.csv` | eine Zeile pro (Anfrage, Roboter): Status, Verfügbarkeit, Zuständigkeit, Distanz |
| `kennzahlen.json` | Kennzahlen des Laufs |

Über alle Läufe: `outputs/laeufe_uebersicht.md` (Auswahl) und `outputs/laeufe_uebersicht.csv` (alle Kennzahlen). Gebaut werden sie aus allen vorhandenen `kennzahlen.json`. Ein Lauf mit `--run` überschreibt die anderen also nicht.

## Module

| Modul | Aufgabe | Wichtige Funktionen |
| --- | --- | --- |
| `analysis.py` | Einstiegspunkt: steuert den Ablauf, schreibt Bericht und Übersicht | `main`, `analyze_run`, `write_report`, `write_overview` |
| `loader.py` | Läufe finden, CSVs als Text einlesen, Typen umwandeln, Namen parsen | `find_runs`, `load_run`, `parse_entity`, `parse_material`, `task_area` |
| `checks.py` | Datenqualitätsprüfungen, liefert eine Liste von Befunden | `run_checks` |
| `features.py` | abgeleitete Größen und Kennzahlen | `task_robot_matrix`, `task_features`, `run_summary`, `requests_per_window` |
| `plots.py` | Grafiken mit festen Farbrollen | `make_all_plots`, Registry `PLOTS` |

Ablauf je Lauf:

```text
find_runs → load_run → task_robot_matrix → task_features → run_summary
                                                         → run_checks
                                                         → make_all_plots → write_report
alle Läufe → write_overview
```

## Konventionen

- **Spaltennamen englisch** wie in der Simulation (`transport_id`, `path_steps`, …), **Texte für Menschen deutsch** (Kommentare, Grafiken, Berichte).
- **Annahmen an einer Stelle:** `loader.task_area` (Bereich eines Auftrags), `loader.PATH_SENTINEL_THRESHOLD` und `features.WINDOW_SIZES`. Wer eine Annahme ändert, passt auch den Abschnitt „Annahmen“ in `analysis.write_report` an.
- **Feste Farbrollen** in `plots.py`: `AREA_COLORS` und `STATUS_COLORS` sind auf Farbfehlsichtigkeit geprüft. Unbekannte Bereiche oder Status erscheinen grau („Andere“). Eine neue Farbe ergänzt man erst nach Prüfung gegen die bestehenden.

## Erweitern

- **Neue Grafik:** Funktion `plot_xyz(run, tasks, matrix, path)` in `plots.py` schreiben und einen Eintrag `(dateiname, titel, funktion, lesehilfe)` in `PLOTS` ergänzen. Sie erscheint dann automatisch im Bericht.
- **Neue Kennzahl:** in `features.run_summary` ergänzen. Soll sie auch in der Markdown-Übersicht stehen, zusätzlich in `analysis.OVERVIEW_COLUMNS` eintragen. In der CSV-Übersicht steht sie automatisch.
- **Neue Prüfung:** Funktion in `checks.py` schreiben, die `list[Finding]` liefert, und in `run_checks` aufnehmen.
