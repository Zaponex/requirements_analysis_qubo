# Lernlabor – lokale Website

Eine Website zum **interaktiven Erkunden** der Pipeline, die lokal auf dem eigenen Rechner läuft. Eingabe sind dieselben Simulationsdaten wie für die PNG-Berichte (`data/transport_logs/`).

## Starten

```powershell
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt        # einmalig: fastapi, uvicorn, plotly
python -m webapp --open                # öffnet http://127.0.0.1:8003
```

| Option | Bedeutung |
| --- | --- |
| `--port 8080` | anderer Port |
| `--data-dir <ordner>` | anderer Datenordner (Standard: `data/transport_logs`) |
| `--open` | Browser automatisch öffnen |
| `--reload` | Server startet bei Code-Änderungen neu (zum Entwickeln) |

Der Server lauscht nur auf `127.0.0.1` und ist damit von außen nicht erreichbar. Beenden mit `Strg+C`. Ein Internetzugang ist nicht nötig, auch die Diagramm-Bibliothek kommt aus dem installierten Python-Paket.

**Neue Simulationsläufe:** Dateipaar in den Datenordner legen und die Seite neu laden. Der Lauf erscheint oben rechts in der Laufauswahl. Geänderte Dateien werden automatisch neu eingelesen.

## Was es gibt

### Reiter 1 · Daten ✅

| Ansicht | Wofür |
| --- | --- |
| **Überblick** | Kennzahlen mit Erklärungen (Symbol „i“), Größe der Kandidatenmengen, Datenqualität, Annahmen |
| **Zeitreise** | Die Simulation abspielen: Roboter bewegen sich, Anfragen erscheinen als Pfeile, Kandidaten mit Distanz. Schieberegler, Tempo, Spuren; Tastatur: Leertaste, ←, →. Direktlink auf einen Zeitpunkt: `#/daten/zeitreise?t=330` |
| **Auftrag × Roboter** | Matrix „wer kommt in Frage, wie weit entfernt“. Klick auf eine Spalte zeigt die Anfrage im Layout. Balken der Kandidatenmengen filtern die Matrix. |
| **Auswertungen** | Die Grafiken des PNG-Berichts interaktiv, mit Filtern nach Bereich, Materialstufe und Zeitraum, frei wählbarem Zeitfenster Δt und einer Tabellenansicht je Diagramm |
| **Lauf-Vergleich** | Kennzahlen aller Läufe nebeneinander; Klick auf eine Zeile wählt den Lauf aus |

### Reiter 2 · Kodierungen

| Ansicht | Wofür |
| --- | --- |
| **One-Hot** ✅ | Geführter Weg in 6 Schritten an echten Aufträgen, siehe unten |
| **One-Hot + Reihenfolge** ✅ | Ein Roboter fährt mehrere Aufträge: Platz-Hilfsvariablen, Ablaufplan, Hardware-Vergleich, siehe unten |
| **Formel-Baukasten** ✅ | Die Formel aus Bausteinen selbst zusammensetzen – auch falsch – mit Diagnose gegen das echte Problem, siehe unten |
| Domain Wall, Binary | als „bald“ markiert; Inhalt steht schon in den Lesekapiteln in [`encodings/`](../encodings/README.md) |

Der geführte Weg bei **One-Hot**:

1. **Szenario:** Einen Moment und bis zu 6 Aufträge aus dem Lauf wählen. Es gibt Beispiele wie „Kapitel-Beispiel“ und „Mehr Aufträge als Roboter“.
2. **Schalter:** Ein Schachbrett aus anklickbaren Bits $x_{t,r}$. Die Karte zeigt, welche Fahrt ein Bit bedeutet.
3. **Kosten:** Jeder Schalter kostet die Anfahrt. Ohne Regeln gewinnt „niemand fährt“.
4. **Zeilenregel:** Genau ein Roboter je Auftrag. Die Strafe A ist per Schieberegler einstellbar.
5. **Spaltenregel:** Kein Roboter bekommt zwei Aufträge. Die Strafe B ist per Schieberegler einstellbar.
6. **QUBO & Hardware:** Matrix, Kopplungsgraph und Kennzahlen. Aktive Terme leuchten auf.

Dazu kommen:

- eine **Energie-Zerlegung**, die jeden Term in Worten erklärt,
- Schalter, um Regeln an- und abzuschalten,
- eine **Rangliste** aller Zustände: Alle Stellungen werden durchprobiert, bis 22 Schalter. Ein Klick lädt einen Zustand.

Ab Schritt 3 legt die Karte **„Bewertungskriterium“** fest, wonach das QUBO bewertet, also welche Zahl $c_{t,r}$ auf der Diagonale steht. Standard ist die **Leerfahrt-Distanz** (Manhattan-Distanz Roboter → Abholort in Gitterfeldern).

- **Wählbar, füllt nur die Diagonale:** Leerfahrt, gesamte Fahrstrecke, Fahrzeit, Bearbeitungszeit, Erledigungszeit, Durchlaufzeit, Verspätung, Energie, Betriebskosten und eine gewichtete Kombination.
- **Annahmen:** Fahrgeschwindigkeit, Be- und Entladezeit, Restzeit belegter Roboter, Soll-Durchlaufzeit, Energie- und Kostensätze sowie Gewichte. Sie sind mit Einheit einstellbar, die Standardwerte stehen in [`encodings/cost_model.py`](../encodings/cost_model.py).
- **Zerlegung:** Ein gestapeltes Balkendiagramm zeigt, woraus jede Diagonal-Zahl besteht. Schraffierte Teile, zum Beispiel die Lastfahrt, sind für alle Roboter eines Auftrags gleich: Sie ändern die Entscheidung nicht, machen die Koeffizienten aber größer.
- **Sofortzuweisung:** Die Seite rechnet eine Sofortzuweisung (jeder Roboter höchstens ein Auftrag). Bei Zeit-Summen wie der Erledigungszeit warnt sie, dass das nur dann exakt ist, und verweist auf **One-Hot + Reihenfolge**.
- **Struktur-Kriterien:** „Erledigungszeit mit Reihenfolge“ springt auf die eigene Seite. Makespan, Auslastung, Durchsatz und Anzahl zugewiesener Aufträge sind als „geplant“ aufgeführt, mit Erklärung, welche Kopplungen oder Hilfsvariablen sie bräuchten.
- **Strafgewichte:** Beim Kriterienwechsel passen sich A und B an den Kostenbereich an (1,5 × größte Kosten).

Danach erklärt die Karte **„Die Formel dahinter“**, wie die Mathematik wirkt. Fährst du über einen Formelteil, leuchten die betroffenen Schalter im Schachbrett auf.

| Register | Was man sieht |
| --- | --- |
| ① Formel & Symbole | die drei Terme farbig, jeweils mit „was bewirkt er“, dazu eine Symboltabelle mit den Werten des Szenarios |
| ② Eingesetzt | je Term: Formel mit Zahlen, eingesetzt mit dem aktuellen x und der Wert, bis zur Summe E |
| ③ Ausmultipliziert → QUBO | Herleitung A(1−Σx)² = A − A·Σx + 2A·Σx_i x_j (weil x² = x); am gewählten Auftrag ausgeschrieben; welcher Teil wohin in die Matrix wandert; die fertige QUBO-Form mit Probe |
| ④ Wirkung der Terme | Zeilenstrafe zerlegt in Konstante, Belohnung und Paarstrafe; Spaltenstrafe je Roboter; Kurven „ab welchem A bzw. B wird das Minimum gültig?“ (Klick setzt den Regler) |

Direktlinks funktionieren auch, zum Beispiel `#/kodierungen/one-hot?schritt=5&auftraege=1,2,3&kriterium=erledigungszeit&zustand=minimum&formel=eingesetzt`. Der Parameter `formel` nimmt die Werte `formel`, `eingesetzt`, `qubo` oder `wirkung` an, `kriterium` die Schlüssel aus `cost_model.CRITERIA`.

Die Formulierung selbst kommt aus [`encodings/formulations.py`](../encodings/formulations.py), der Browser rechnet nur die Energien. Eine Vereinfachung fürs Lernen: Alle gewählten Aufträge sehen den Flottenzustand der ersten gewählten Anfrage.

#### One-Hot + Reihenfolge

Hier darf ein Roboter bis zu $K$ Aufträge nacheinander fahren. Die Schalter sind $x_{t,r,q}$: „Roboter $r$ fährt Auftrag $t$ als $q$-letzten“. Die Herleitung steht in [`encodings/reihenfolge/README.md`](../encodings/reihenfolge/README.md).

| Karte | Was man sieht |
| --- | --- |
| Warum reicht die Diagonale nicht? | derselbe Auftrag allein und nach einem Vorgänger, mit Zeitbalken und echten Zahlen |
| Szenario | Aufträge wie bei One-Hot, dazu Plätze je Roboter $K$ (1 = Sofortzuweisung), Kriterium (Summe der Erledigungszeiten oder der Arbeitszeiten) und Annahmen |
| Schachbrett mit Plätzen | je Roboter eine Spaltengruppe, Plätze in Fahrreihenfolge; Zeilen-, Platz- und Lückenprüfung |
| Ablaufplan | Gantt-Diagramm der aktuellen Schalterstellung mit jeder Erledigungszeit $C_t$ |
| Energie | fünf Terme einzeln (Kosten je Platz, Vorgänger-Korrektur, Zeilen-, Platz-, Lückenregel); Probe: Kosten + Korrektur = Summe aus dem Ablaufplan |
| Die Formel dahinter | Formel, Herleitung des Gewichts $q$ und der Vorgänger-Korrektur am aktuellen Beispiel, „wohin wandert welcher Teil“ |
| Optimum und Probe | QUBO-Minimum (bis 22 Schalter durchprobiert, darüber Simulated Annealing mit Tausch-Zügen) gegen das exakte Optimum (alle Ablaufpläne aufgezählt); reicht $K$?; Vergleich mit der Sofortzuweisung; Schwellen für A, B, D |
| Hardware | Qubits, Kopplungen, Dichte, größter Koeffizient; Vergleich mit Sofortzuweisung, Zeitraster und expliziten Fertigstellungszeiten |

Direktlink: `#/kodierungen/reihenfolge?auftraege=1,2,3,4,5&plaetze=2&kriterium=erledigungszeit&schwellen=1`. `schwellen=1` berechnet die Schwellen sofort (bis 16 Schalter).

#### Formel-Baukasten

Auf den beiden One-Hot-Seiten ist die Formel fest. Im Baukasten besteht sie aus **Bausteinen**, die man an- und abschalten, gewichten, umbauen, ergänzen und entfernen kann – ausdrücklich auch so, dass die QUBO unzulässige oder schlechte Lösungen liefert. Beide Seiten haben einen Knopf **„Formel verändern → Baukasten“**, der dieselben Aufträge mitnimmt. Die Mathematik steht in [`encodings/baukasten.py`](../encodings/baukasten.py).

| Baustein | Was man verändern kann |
| --- | --- |
| Kosten (Ziel) | Gewicht je Platz w(q): q (von hinten), 1 oder K + 1 − q (von vorne); Wartezeit ρ und Anfahrt s⁰ an/aus. Bei Kriterien der Sofortzuweisung (K = 1) die festen c_t,r |
| Vorgänger-Kopplung (Ziel) | s − s⁰ (ersetzt die Anfahrt, richtig) oder s (kommt dazu, doppelt gezählt); Gewicht je Platz |
| Gruppenregel | Gruppe: je Auftrag, je Roboter-Platz, je Roboter, je Auftrag und Roboter, alle Schalter. Form f(n): genau k, höchstens eins, linear k − n, eigene a + b·n + c·n² |
| Nachbarplatz-Regel | Lücke o₁·(1 − o₂) oder eigene a + b·o₁ + c·o₂ + d·o₁o₂ |

Jeder Baustein hat ein eigenes Gewicht (Zahl in der Formelzeile oder Regler im Bearbeitungsfeld). Gewichte und An/Aus wirken sofort im Browser; Form und Gruppe gehen an den Server.

Was die Seite zeigt:

- **Das echte Problem:** die Anforderungen (jeder Auftrag genau einmal, kein Platz doppelt, keine Lücke) und das Ziel – geprüft für das Minimum der QUBO und für den Zustand im Schachbrett, verglichen mit dem besten gültigen Plan (alle Pläne aufgezählt).
- **Formelzeilen:** jeder Baustein als Formel, ein Satz „was er tut“ und ein Abzeichen ✓/⚠, ob er zum Problem passt. Das Bearbeitungsfeld zeigt die Wertetabelle f(n) bzw. g(o₁, o₂), die Beurteilung der Form und wie der Baustein ausmultipliziert in der QUBO landet.
- **Diagnose „Was fehlt? Was wirkt?“:**
  - fehlende Regel für eine verletzte Anforderung, mit Knopf „+ Standardregel“;
  - Form lässt den Verstoß zu (z.B. linear statt quadratisch);
  - Gewicht zu klein, mit der Schwelle, ab der es kippt, und Knopf zum Setzen;
  - Regel bestraft den besten gültigen Plan selbst (z.B. „höchstens ein Auftrag je Roboter“ bei K ≥ 2) – dann hilft kein Gewicht;
  - Ziel-Bausteine bewerten Pläne falsch (Gewichtung, fehlende oder doppelte Anfahrt).
- **„Jeden Baustein einzeln weglassen“:** Für jeden Baustein wird ohne ihn gelöst. Das Fazit sagt, ob er nötig ist, hier ohne Wirkung ist (und wie viele Kopplungen er kostet) oder sogar schadet. Bis 16 Qubits automatisch, darüber auf Knopfdruck.
- **Schachbrett, Energie je Baustein, Ablaufplan, QUBO-Matrix und Kopplungsgraph:** Farbe = Baustein; die Hardware-Tabelle zählt Diagonal-Einträge und Kopplungen je Baustein.

Die URL enthält die ganze Formel (`formel=…`). Ein Link reproduziert also genau den Stand, z.B. zum Teilen oder für die Doku. `offen=zeile,luecke` öffnet Bearbeitungsfelder, `preset=one_hot|reihenfolge|nur_kosten` lädt eine Voreinstellung.

### Reiter 3 · Hardware

Als „bald“ markiert.

## Aufbau

```text
webapp/
├── __main__.py         ← Start: python -m webapp
├── server.py           ← FastAPI: JSON-API unter /api, Oberfläche als statische Dateien
├── data_service.py     ← lädt Läufe über analysis/ (loader, features, checks), Cache je Dateistand
└── static/
    ├── index.html      ← Gerüst: Kopfzeile, Reiter, Laufauswahl
    ├── css/style.css   ← Stil (Farbrollen wie analysis/plots.py)
    └── js/
        ├── main.js     ← Router (#/daten/<ansicht>), Laufauswahl
        ├── theme.js    ← Farben, Beschriftungen, Plotly-Grundeinstellungen
        ├── util.js     ← DOM-, Zahlen- und Tooltip-Helfer
        ├── components/ ← layoutMap.js (Fabrik-Karte), card.js (Karte + Tabellenansicht), scenario.js (Auftragsauswahl der Kodierungsseiten)
        ├── qubo/       ← engine.js (Energie, alle Zustände per Gray-Code, Simulated Annealing), matrixView.js, graphView.js
        └── views/      ← Daten: overview, replay, matrix, charts, compare · Kodierungen: onehot (+ onehotFormula, onehotCriterion), sequence (One-Hot + Reihenfolge)
```

**Datenfluss:** Der Browser holt einen Lauf einmal komplett als JSON (`GET /api/runs/<run_id>`, etwa 180 KB). Alle Filter, die Zeitreise und die Matrix rechnen danach im Browser. Die Zahlen stammen aus denselben Funktionen wie der PNG-Bericht, deshalb stimmen beide immer überein.

| Endpunkt | Inhalt |
| --- | --- |
| `GET /api/runs` | Kennzahlen aller Läufe |
| `GET /api/runs/<run_id>` | Aufträge, Flotten-Snapshots, Entitäten, Roboter, Auftrag×Roboter-Matrix, Befunde, Annahmen |
| `GET /api/runs/<run_id>/one-hot?tasks=1,2&variables=kandidaten&kriterium=leerfahrt&params={}` | Lern-Instanz mit Kosten nach Kriterium, One-Hot-Formulierung (Regeln und QUBO-Einträge mit symbolischen A, B), Katalog der Kriterien und Parameter |
| `GET /api/runs/<run_id>/reihenfolge?tasks=1,2,3&plaetze=2&kriterium=erledigungszeit&variables=kandidaten&params={}` | Instanz mit Anfahrten, Formulierung mit Platz-Hilfsvariablen (symbolische A, B, D), Standardgewichte, exaktes Optimum (mit und ohne Platzgrenze, Sofortzuweisung), Hilfsvariablen-Vergleich |
| `POST /api/runs/<run_id>/baukasten` mit `{"tasks": [1, 2], "plaetze": 2, "kriterium": "erledigungszeit", "terms": [...] oder "preset": "reihenfolge"}` | Echtes Problem (Instanz, Anforderungen, exaktes Optimum – zwischengespeichert) und die Formulierung aus den Bausteinen: Regeln und QUBO-Einträge mit Beiträgen je Baustein |
| `GET /api/docs` | automatische API-Dokumentation |

## Tests

```powershell
python -m pytest tests
```

Die Tests prüfen unter anderem:

- Die Website-Formulierung reproduziert die Zahlen des One-Hot-Kapitels.
- Die Energie über die Regeln ist für jeden Zustand gleich der Energie über die QUBO-Matrix.
- Mit Reihenfolge ist die QUBO-Energie jedes gültigen Plans genau die Summe aus dem Ablaufplan, und das QUBO-Minimum ist das exakte Optimum.
- Die Voreinstellungen des Baukastens ergeben exakt die festen Formulierungen, und für beliebige (auch unsinnige) Bausteine stimmt das Ausmultiplizieren.

## Erweitern

- **Neue Ansicht im Reiter Daten:** Datei in `static/js/views/` mit `export function renderXyz(root, ctx)` anlegen und in `VIEWS` in `main.js` eintragen. `ctx` enthält `run`, `runs`, `params`, `selectRun`. Gibt die Funktion eine Aufräum-Funktion zurück (Timer, Tastatur), wird diese beim Verlassen der Ansicht aufgerufen.
- **Neuer Reiter (z.B. Kodierungen):** In `index.html` das `disabled`-Element durch einen Link ersetzen und in `main.js` eine eigene Ansichtsgruppe ergänzen.
- **Neue Daten vom Server:** in `data_service.py` dem Payload hinzufügen. Die Berechnung gehört nach `analysis/`, damit PNG-Bericht und Website gleich bleiben.

## Gestaltung

- **Farben** haben feste Rollen und sind identisch mit den PNG-Berichten: Bereiche, Roboter-Status, Blau für Größen, Orange für die Auswahl. Bereichs- und Statusfarben sind auf Farbfehlsichtigkeit geprüft.
- **Bewusst nur heller Modus:** Für einen dunklen Hintergrund besteht keine Kombination aus 5 Bereichsfarben die Prüfung. Ein Dunkelmodus bräuchte eine eigene Farbabstimmung.
- Jedes Diagramm hat Hover-Details und eine **Tabellenansicht** mit den Zahlen dahinter.
