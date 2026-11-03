# Kodierungen – bildlich erklärt

Wie wird aus der Frage „Welcher Roboter übernimmt welchen Auftrag?“ ein Problem, das ein Quantenoptimierer lösen kann? Dieser Ordner erklärt die drei Kodierungen **One-Hot**, **Domain Wall** und **Binary** Schritt für Schritt – an demselben echten Beispiel aus der Simulation, mit Bildern und nachgerechneten Zahlen.

> **Interaktiv:** One-Hot, Domain Wall und Binary lassen sich im Lernlabor an beliebigen echten Aufträgen selbst ausprobieren: `python -m webapp --open`, dann Reiter **3 · Kodierungen TA** (Lastausgleich $\sum_r (L_{r,0} + \sum_t c_{t,r}x_{t,r})^2$, [`workload.py`](workload.py); die Seiten ohne Spaltenregel im Archiv) oder **2 · Kodierungen IA** (Sofortzuweisung mit Spaltenregel, One-Hot, Domain Wall und Binary in den Fällen T = R, T < R, T > R, `formulations.one_hot_ia`, `formulations.domain_wall_ia`, `formulations.binary_ia`). Grundlage ist [`formulations.py`](formulations.py); Qubits und Kopplungen je Kodierung rechnet [`resources.py`](resources.py) für den Reiter **4 · Qubits & Kopplungen** (dort auch Varianten mit Slack, Kapazität und Makespan, bisher ohne Oberfläche). Für das Kapitel-Beispiel liefert sie dieselben Zahlen wie dieses Kapitel, das prüft [`tests/test_one_hot.py`](../tests/test_one_hot.py).

## Lesereihenfolge

| Kapitel | Kernidee | Status |
| --- | --- | --- |
| [One-Hot](one_hot/README.md) | ein Bit pro Roboter, genau eines ist 1 | ✅ fertig |
| [Domain Wall](domain_wall/README.md) | $R-1$ Bits wie ein Thermometer, die Antwort steckt in der Position einer „Wand“ | ✅ fertig |
| [Binary](binary/README.md) | Roboternummer als Binärzahl, $\lceil \log_2 R \rceil$ Bits | ✅ fertig |
| [One-Hot mit Reihenfolge](reihenfolge/README.md) | ein Roboter fährt mehrere Aufträge: Hilfsvariablen für den Platz, $T \cdot R \cdot K$ Bits | ✅ fertig, interaktiv |

Am besten in dieser Reihenfolge lesen – jedes Kapitel baut auf dem vorherigen auf und vergleicht sich damit.

**Formel-Baukasten:** Im Lernlabor (Reiter **3 · Kodierungen TA › Formel-Baukasten**) lässt sich jede dieser Formeln aus Bausteinen umbauen – auch falsch –, und eine Diagnose misst das Ergebnis am echten Problem. Der Kern steht in [`baukasten.py`](baukasten.py): Jede quadratische Funktion der Anzahl $n$ eingeschalteter Bits einer Gruppe, $f(n) = a + b\,n + c\,n^2$, ist eine QUBO, weil $x^2 = x$:

$$f\Big(\sum_{i \in G} x_i\Big) = a + (b + c)\sum_{i \in G} x_i + 2c \sum_{i<j \in G} x_i x_j$$

„Genau $k$“ ist $(k - n)^2$, also $a = k^2, b = -2k, c = 1$. „Höchstens eins“ ist $n(n-1)/2$, also $a = 0, b = -\tfrac12, c = \tfrac12$. Eine lineare Regel $k - n$ hat $c = 0$ und belohnt jedes weitere Bit – der typische Fehler. Die festen Formulierungen aus [`formulations.py`](formulations.py) – One-Hot, Reihenfolge, Domain Wall und Binary – sind Voreinstellungen des Baukastens (geprüft in [`tests/test_baukasten.py`](../tests/test_baukasten.py)).

Der Baukasten trennt dabei **Kodierung** und **Regel**. Jeder Auftrag $t$ wählt eine Option $o$ (Roboter bzw. Roboter-Platz); die Regeln der Zuweisung rechnen mit dem Indikator $I_{t,o}$ = „$t$ nimmt $o$“, und erst die Kodierung sagt, welches Polynom der Bits das ist:

$$I^{\text{One-Hot}}_{t,o} = x_{t,o}, \qquad I^{\text{DW}}_{t,k} = b_{t,k} - b_{t,k+1}, \qquad I^{\text{Bin}}_{t,k} = \prod_j \begin{cases} z_{t,j} & \text{Stelle } j \text{ von } k \text{ ist } 1 \\ 1 - z_{t,j} & \text{sonst} \end{cases}$$

Eine Spaltenregel $\sum I_{t,r} I_{t',r}$ (höchstens ein Auftrag je Roboter) wäre deshalb bei One-Hot eine Kopplung, bei Domain Wall ein Produkt zweier Differenzen ($3R - 5$ Kopplungen je Auftragspaar) und bei Binary ein Term vom Grad $2\lceil\log_2 R\rceil$, der Hilfsbits braucht. **Seit 26.10.2026 verzichtet das Projekt auf sie:** Doppelbelegung ist zulässig, die Aufträge koppeln bei der Sofortzuweisung nicht mehr, und jede Kodierung zerfällt in einen Block je Auftrag. Die Kapitel unten beschreiben die Spaltenregel weiter als strengere Variante (`column_rule=True`). Die Kodierung kann je Auftrag verschieden sein. Ausmultipliziert wird mit $I^2 = I$ – das stimmt für One-Hot-Bits und Binär-Indikatoren, aber nicht für Domain-Wall-Differenzen an gebrochenen Ketten ($\delta = -1$). Deshalb ist die Zeilenregel $(1 - \sum_k \delta_k)^2$ auf einer Kette ausmultipliziert $1 - W$ mit $W$ = Anzahl Wände: Sie belohnt Kettenbrüche, statt sie zu verhindern. Jede Kodierung braucht ihre eigene Gültigkeitsregel – Zeilenregel, Kettenregel oder Phantom-Codes.

**Wichtig für die Kriterien:** Die ersten drei Kapitel rechnen eine **Sofortzuweisung**, bei der jeder Roboter höchstens einen Auftrag bekommt. Nur dort ist jede Zuweisung eine feste Zahl $c_{t,r}$ auf der Diagonale. Summen von Erledigungszeiten mit mehreren Aufträgen je Roboter brauchen Hilfsvariablen, siehe [One-Hot mit Reihenfolge](reihenfolge/README.md).

## Die drei Kodierungen im Vergleich

Für das laufende Beispiel (2 Aufträge, 4 Roboter, Strafgewichte $A = B = 50$, bei Binary Hilfsbit-Strafe $M = 100$). Alle drei finden dasselbe Optimum: **A1 → R63, A2 → R62** mit Energie 26.

| | One-Hot | Domain Wall | Binary |
| --- | --- | --- | --- |
| Bits pro Auftrag | $R$ = 4 | $R-1$ = 3 | $\lceil \log_2 R \rceil$ = 2 |
| Hilfsbits | – | – | 2 |
| Variablen gesamt | 8 | 6 | 6 |
| Kopplungen | 16 | 11 | 15 (alle Paare) |
| Kopplungen der Regel „genau ein Roboter“ pro Auftrag | $R(R-1)/2$ – Clique | $R-2$ – Kette | keine nötig, wenn $R$ Zweierpotenz |
| Höchster Grad vor Umformung | 2 | 2 | 4 |
| Größter Koeffizient | 100 | 100 | 400 |

Kurz gesagt:

- **One-Hot** ist am anschaulichsten, braucht aber die meisten Variablen und die dichtesten Kopplungen.
- **Domain Wall** spart vor allem Kopplungen (Kette statt Clique) bei fast gleicher Variablenzahl – solange wenige Aufträge um dieselben Roboter konkurrieren. Jedes konkurrierende Paar kostet $3R - 5$ statt $R$ Kopplungen, bei $R = 4$ kippt der Vorteil ab 4 Aufträgen (siehe Nachtrag im [Domain-Wall-Kapitel](domain_wall/README.md)). Die Kettenstrafe muss doppelt so stark sein wie die Spaltenstrafe.
- **Binary** spart die meisten Variablen. Dafür entstehen Terme höheren Grades, Hilfsbits und große Koeffizienten, also höhere Präzisionsanforderungen. Die Hilfsbit-Strafe muss mit der Zahl der Aufträge wachsen (siehe Nachtrag im [Binary-Kapitel](binary/README.md)).

Welche Kodierung für welche Hardware passt, ist Thema der späteren Stufen (siehe [docs/ARCHITEKTUR.md](../docs/ARCHITEKTUR.md)).

## Das laufende Beispiel

Alle Kapitel nutzen denselben Moment aus Lauf `2026-10-09_12-59-39`: **t = 0 s**, alle vier Roboter sind frei, die Aufträge 1 und 2 gehen gleichzeitig ein. Kosten sind die Manhattan-Distanzen der Roboter zum Abholort:

| | R61 | R62 | R63 | R64 |
| --- | --- | --- | --- | --- |
| Position | (48, 17) | (21, 19) | (5, 19) | (61, 18) |
| **A1** – Zwischenlager 5502 (17, 13) | 35 | 10 | 18 | 49 |
| **A2** – Zwischenlager 5508 (23, 13) | 29 | 8 | 24 | 43 |

Beide Aufträge haben R62 als nächsten Roboter – dieser Konflikt macht das Beispiel interessant. Die optimale Zuweisung ist **A1 → R63, A2 → R62** (Gesamtkosten 26).

## Einheitliche Schreibweise

| Symbol | Bedeutung |
| --- | --- |
| $R$, $T$ | Anzahl Roboter bzw. Aufträge |
| $x_i \in \{0, 1\}$ | ein Bit (Variable, später ein Qubit) |
| $c_{t,r}$ | Kosten, wenn Roboter $r$ Auftrag $t$ übernimmt |
| $A$, $B$ | Strafgewichte für verletzte Regeln |
| $E(x)$ | Energie: die Zahl, die der Optimierer minimiert |
| QUBO | $E(x) = \sum_i Q_{ii} x_i + \sum_{i<j} Q_{ij} x_i x_j + \text{const}$ – nur einzelne Bits und Bit-Paare |

## Aufbau

```text
encodings/
├── README.md          ← diese Übersicht
├── common.py          ← laufendes Beispiel, Grafikstil, Rechenhilfen (für alle Kapitel)
├── one_hot/
│   ├── README.md      ← das Kapitel (Text + Bilder)
│   ├── illustrate.py  ← erzeugt die Bilder und rechnet alle Zahlen nach
│   └── abbildungen/   ← erzeugte PNGs
├── domain_wall/       ← gleiches Schema
├── binary/            ← gleiches Schema
├── reihenfolge/       ← One-Hot mit Reihenfolge: nur README, interaktiv im Lernlabor
├── formulations.py    ← feste Formulierungen (One-Hot, mit Reihenfolge), exaktes Optimum
├── baukasten.py       ← Formulierungen aus Bausteinen, Kodierung je Auftrag (One-Hot, Domain Wall, Binary, gemischt)
└── cost_model.py      ← Bewertungskriterien
```

Jedes Kapitel hat ein eigenes `illustrate.py`. Es erzeugt die Abbildungen und prüft alle Zahlen im Text per Brute Force über alle Zustände:

```powershell
python encodings/one_hot/illustrate.py
```

## Literatur

- A. Lucas, „Ising formulations of many NP problems“, *Frontiers in Physics* 2, 5 (2014). [doi:10.3389/fphy.2014.00005](https://doi.org/10.3389/fphy.2014.00005)
- N. Chancellor, „Domain wall encoding of discrete variables for quantum annealing and QAOA“, *Quantum Science and Technology* 4, 045004 (2019). [doi:10.1088/2058-9565/ab33c2](https://doi.org/10.1088/2058-9565/ab33c2)
- J. Chen, T. Stollenwerk, N. Chancellor, „Performance of domain-wall encoding for quantum annealing“, *IEEE Transactions on Quantum Engineering* 2 (2021). [doi:10.1109/TQE.2021.3094280](https://doi.org/10.1109/TQE.2021.3094280)
- A. Glos, A. Krawiec, Z. Zimborás, „Space-efficient binary optimization for variational quantum computing“, *npj Quantum Information* 8, 39 (2022). [doi:10.1038/s41534-022-00546-y](https://doi.org/10.1038/s41534-022-00546-y)
- I. G. Rosenberg, „Reduction of bivalent maximization to the quadratic case“, *Cahiers du Centre d'Études de Recherche Opérationnelle* 17, 71–74 (1975) – Hilfsbits zur Reduktion auf Grad 2
