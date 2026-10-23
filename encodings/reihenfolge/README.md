# One-Hot mit Reihenfolge – wenn ein Roboter mehrere Aufträge fährt

> **Interaktiv:** Lernlabor, Reiter **2 · Kodierungen › One-Hot + Reihenfolge** (`python -m webapp --open`). Dort lassen sich alle Zahlen dieses Kapitels an beliebigen Aufträgen nachklicken.
> **Code:** [`formulations.py`](../formulations.py) (`build_sequence_instance`, `one_hot_sequence`, `simulate`, `exact_optimum`). Geprüft wird alles in [`tests/test_sequence.py`](../../tests/test_sequence.py).

Im One-Hot-Kapitel bekommt jeder Roboter **höchstens einen** Auftrag. Das ist die **Sofortzuweisung** (instantaneous assignment, Gerkey & Matarić 2004). Nur dort ist jede Zuweisung eine feste Zahl $c_{t,r}$, die auf der Diagonale der QUBO steht.

Sobald ein Roboter **mehrere Aufträge nacheinander** fahren darf (time-extended assignment), stimmt das nicht mehr. Die Erledigungszeit eines Auftrags hängt dann davon ab, was der Roboter vorher fährt. Die **Summe der Erledigungszeiten** (Total Completion Time) lässt sich daher nicht mit $c_{t,r}$ auf der Diagonale schreiben. Man braucht **Hilfsvariablen**.

Dieses Kapitel zeigt, welche Hilfsvariablen das sind, warum die QUBO damit quadratisch bleibt und was das an Qubits und Kopplungen kostet.

## 1. Warum die Diagonale nicht mehr reicht

Laufendes Beispiel aus Lauf `2026-10-09_12-59-39`, t = 0 s, Annahmen: 1 Feld/s, je 10 s Be- und Entladen.

| | Anfahrt von R62 $s^0_{62,t}$ | Bearbeitung $p_t$ (Beladen + Lastfahrt + Entladen) |
| --- | --- | --- |
| Auftrag #1 | 10 s | 51 s |
| Auftrag #2 | 8 s | 55 s |

Vom Abgabeort von #1 zum Abholort von #2 sind es $s_{1,2}$ = 19 s.

- **R62 fährt nur #2:** Die Erledigungszeit ist $C_2 = 8 + 55 = 63$ s. Diese Zahl gehört fest zum Schalter „R62 fährt #2“.
- **R62 fährt erst #1, dann #2:** #2 wartet, bis #1 abgeliefert ist (61 s), und die Anfahrt beginnt am Abgabeort von #1. Dann ist $C_2 = 61 + 19 + 55 = 135$ s.

Dieselbe Entscheidung „R62 fährt #2“ kostet also 63 s oder 135 s, je nachdem, was davor liegt. Eine feste Zahl je Auftrag und Roboter gibt es nicht mehr.

## 2. Die Hilfsvariablen: ein Schalter je Platz

Statt $x_{t,r}$ gibt es $x_{t,r,q}$ = „Roboter $r$ fährt Auftrag $t$ als **$q$-letzten**“. Der Platz $q$ ist die Hilfsvariable. Bei höchstens $K$ Aufträgen je Roboter braucht es $T \cdot R \cdot K$ Schalter statt $T \cdot R$.

Warum zählt man **von hinten**? Ein Roboter fährt $\pi_1, \dots, \pi_n$ mit Anfahrten $s$ und Bearbeitungen $p$. Er ist ab $\rho_r$ frei ($\rho_r = 0$ für einen freien Roboter).

$$C_{\pi_k} = \rho_r + \sum_{l \le k} \left(s_{\pi_{l-1}\pi_l} + p_{\pi_l}\right) \quad\Rightarrow\quad \sum_k C_{\pi_k} = n\,\rho_r + \sum_l (n - l + 1)\left(s_{\pi_{l-1}\pi_l} + p_{\pi_l}\right)$$

Jede Fahrt zählt so oft, wie ab ihr noch Aufträge warten, denn sie verzögert sich selbst und alle danach. Mit dem Platz von hinten, $q = n - l + 1$, ist dieses Gewicht **eine feste Zahl je Schalter**.

Von vorne gezählt hinge es von $n$ ab, also davon, wie viele andere Schalter des Roboters an sind. Das gäbe kubische Terme. Die Idee stammt aus der Maschinenbelegung: Horn (1973) und Bruno, Coffman & Sethi (1974) lösen die Summe der Fertigstellungszeiten auf parallelen Maschinen als Zuordnung von Jobs zu „Positionen von hinten“.

Am Beispiel „R62 fährt #1 → #2“:

$$C_1 + C_2 = 61 + 135 = 196 = 2\cdot(10 + 51) + 1\cdot(19 + 55)$$

Der Schalter $x_{1,62,2}$ trägt also $2 \cdot (s^0 + p)$, der Schalter $x_{2,62,1}$ trägt $1 \cdot (s + p)$.

## 3. Die Vorgänger-Korrektur

Eine Abhängigkeit bleibt: Die Anfahrt $s$ beginnt am Abgabeort des **direkten Vorgängers**, oder am Standort, wenn es keinen gibt. Das lässt sich als Diagonal-Teil plus Kopplung schreiben:

$$q \cdot s_{\to t'} = \underbrace{q\, s^0_{r,t'}}_{\text{Diagonale}} + \sum_t \underbrace{q\,(s_{t,t'} - s^0_{r,t'})}_{\text{Kopplung}}\; x_{t,r,q+1}\, x_{t',r,q}$$

Im Beispiel liegt #1 direkt vor #2 auf R62 ($q = 1$). Die Kopplung ist $1 \cdot (19 - 8) = +11$ s, denn vom Abgabeort von #1 ist es 11 s weiter als vom Standort. Ist der Abgabeort näher als der Standort, wird die Kopplung negativ und „lockt“ die beiden Aufträge hintereinander.

Wichtig: Gekoppelt sind nur **benachbarte Plätze desselben Roboters**. Alles bleibt quadratisch, es braucht keine weiteren Hilfsbits.

## 4. Die Regeln

| Regel | Formel | Wofür |
| --- | --- | --- |
| Zeilenregel ($A$) | $A \sum_t \left(1 - \sum_{r,q} x_{t,r,q}\right)^2$ | Jeder Auftrag bekommt genau einen Platz bei genau einem Roboter. |
| Platzregel ($B$) | $B \sum_{r,q} \sum_{t<t'} x_{t,r,q}\,x_{t',r,q}$ | Auf jedem Platz liegt höchstens ein Auftrag. Mit $K = 1$ ist das die Spaltenregel der Sofortzuweisung. |
| Lückenregel ($D$) | $D \sum_{r,q} o_{r,q+1}\,(1 - o_{r,q})$, mit $o_{r,q} = \sum_t x_{t,r,q}$ | Platz $q+1$ darf nur belegt sein, wenn Platz $q$ belegt ist. |

**Warum die Lückenregel?** Ist Platz $q+1$ belegt und $q$ leer, gilt der Auftrag auf $q+1$ als „erster“ und fährt vom Standort los. Das ist ein Schein-Plan.

- Bei der **Summe der Arbeitszeiten** (jeder Platz zählt einfach) kann ein solcher Schein-Plan billiger sein als jeder echte. Der Test `test_ohne_lueckenregel_waere_eine_luecke_billiger` zeigt das an einem konstruierten Beispiel: 147 s statt 187 s.
- Bei der **Summe der Erledigungszeiten** mit $K \le 3$ macht die Dreiecksungleichung Lücken meist unattraktiv. In den echten Läufen war $D$ dort nie nötig.

Für die Garantie bleibt $D$ trotzdem drin. Es kostet Kopplungen.

**Warum $B > D$?** Liegen auf Platz $q$ zwei Aufträge, wird die Lückenregel negativ ($1 - 2 = -1$), und die Platzregel muss das überstimmen.

**Standardgewichte** in `default_weights()`:

- $U$ ist eine obere Schranke für den Zuwachs des Ziels durch einen weiteren Auftrag: alle Fahrten hintereinander auf einem Roboter.
- Daraus folgen $A = D \ge 1{,}1\,U$ (auf eine glatte Zahl aufgerundet) und $B = 2A$.

Damit war das QUBO-Minimum in 120 geprüften Momenten beider Läufe immer der beste Ablaufplan. Die Kehrseite: Die Strafgewichte wachsen mit der **Summe aller Fahrten**. Größere Instanzen brauchen also mehr Präzision.

## 5. Die komplette Formulierung

$$
\begin{aligned}
E(x) = {} & \sum_{t,r,q} \left[\rho_r + q\,(s^0_{r,t} + p_t)\right] x_{t,r,q} && \text{Kosten je Platz} \\
& + \sum_{r,q} \sum_{t \ne t'} q\,(s_{t,t'} - s^0_{r,t'})\; x_{t,r,q+1}\, x_{t',r,q} && \text{Vorgänger-Korrektur} \\
& + A \sum_t \Big(1 - \sum_{r,q} x_{t,r,q}\Big)^2 + B \sum_{r,q}\sum_{t<t'} x_{t,r,q}x_{t',r,q} + D \sum_{r,q} o_{r,q+1}(1 - o_{r,q})
\end{aligned}
$$

Für jeden gültigen Zustand ist die Summe der ersten beiden Zeilen **genau** die Summe der Erledigungszeiten. Der Test `test_energie_ist_genau_die_summe_des_ablaufplans` prüft das für alle Pläne.

Für die Summe der Arbeitszeiten ersetzt man $q$ durch 1 und lässt $\rho_r$ weg. Mit $K = 1$ wird alles exakt zur Sofortzuweisung, das prüft `test_ein_platz_ist_die_sofortzuweisung`.

## 6. Was kostet das an Hardware?

Gleiche Aufträge, verschiedene Wege, die Reihenfolge abzubilden. Lauf `2026-10-09_12-59-39`, t = 0, nur freie Roboter, $K = 2$. Zeitraster und Big-M sind Abschätzungen mit Δt = 5 s.

| | 2 Aufträge (#1, #2) | 5 Aufträge (#1–#5) |
| --- | --- | --- |
| Sofortzuweisung (One-Hot) $x_{t,r}$ | 8 Qubits · 16 Kopplungen | 20 · 70 – **unlösbar**: 5 Aufträge, 4 Roboter |
| **Plätze von hinten** $x_{t,r,q}$ | **16 · 72** | **40 · 300** |
| Zeitraster $x_{t,r,\tau}$ (time-indexed) | ≈ 320 · ≈ 30 240 | ≈ 1 660 · ≈ 350 000 |
| Explizite Fertigstellungszeiten (Big-M + Schlupfbits) | ≈ 133 · dicht | ≈ 865 · dicht, plus Quadratisierung |

Was die Tabelle zeigt:

- **Die Platz-Variablen sind der sparsamste exakte Weg.** Ihre Zahl hängt nur von Aufträgen × Robotern × Plätzen ab, nicht von einer Zeitauflösung.
- **Das Zeitraster** (Venturelli et al. 2015) macht das Ziel wieder diagonal, weil Startzeit + Dauer eine feste Zahl ist. Dafür wachsen die Qubits mit Horizont / Δt.
- **Explizite Zeiten** brauchen binär kodierte Fertigstellungszeiten und Schlupfbits für jede Ungleichung (Glover et al. 2019). Die Produkte darin sind kubisch und brauchen zusätzliche Quadratisierungs-Hilfsbits.

Mit 5 Aufträgen ist die Reihenfolge nicht nur genauer, sondern **nötig**. Das Optimum (337 s) lässt R62 zwei Aufträge nacheinander fahren: R61 #2 · R62 #4 → #3 · R63 #1 · R64 #5. Die Sofortzuweisung müsste einen Auftrag liegen lassen.

## 7. Lösen – und warum Annealer hier kämpfen

Bis 22 Schalter probiert das Lernlabor alle Zustände durch. Darüber nutzt es Simulated Annealing. `exact_optimum()` zählt zur Probe alle Ablaufpläne direkt auf; bei 5 Aufträgen sind das 1 920 Pläne.

Reines Einzelbit-Annealing verfehlt ab etwa 40 Qubits häufig das Optimum, im Beispiel mit 354 s statt 337 s. Der Grund:

- Um einen Auftrag zu verschieben, müssen **zwei** Bits kippen.
- Dazwischen liegt immer ein ungültiger Zustand, eine Barriere von etwa $A$.
- Weil $A$ mit der Summe aller Fahrten wächst, wird die Barriere mit der Instanzgröße höher.

Mit **Tausch-Zügen** innerhalb einer Zeile (ein Bit aus, eines an, in einem Schritt) findet die Heuristik bis 72 Qubits zuverlässig das Optimum. Für die Hardware heißt das: Penalty-basierte One-Hot-Formulierungen mit Reihenfolge erzeugen hohe Barrieren. Encodings oder Mixer, die die Regel von selbst einhalten, sind hier besonders interessant, etwa Domain Wall oder XY-Mixer bei QAOA.

## 8. Vereinfachungen

- **Ein Moment, alle verfügbar:** Alle gewählten Aufträge sehen den Flotten-Snapshot der ersten Anfrage und gelten ab dann als verfügbar. Spätere Anfragezeiten (release dates) sind nicht abgebildet; dafür bräuchte es das Zeitraster.
- **Belegte Roboter** (Modus „alle Roboter“) werden nach der angenommenen Restzeit $\rho_r$ frei und starten an ihrer aktuellen Position.
- **Distanzen:**
  - Anfahrten sind Manhattan-Distanzen.
  - Lastfahrten sind Pfadlängen aus dem Log; fehlt die Pfadlänge (Sentinel), wird die Manhattan-Distanz verwendet.
- **Die Platzgrenze $K$** kann das Optimum abschneiden. Die Seite vergleicht deshalb mit dem Optimum ohne Platzgrenze („Reichen K Plätze?“).

## Literatur

- B. P. Gerkey, M. J. Matarić, „A formal analysis and taxonomy of task allocation in multi-robot systems“, *The International Journal of Robotics Research* 23(9), 939–954 (2004). [doi:10.1177/0278364904045564](https://doi.org/10.1177/0278364904045564) – Sofortzuweisung (IA) vs. Zuweisung mit Zeitbezug (TA)
- W. A. Horn, „Minimizing average flow time with parallel machines“, *Operations Research* 21(3), 846–847 (1973) – Positionen von hinten
- J. Bruno, E. G. Coffman, R. Sethi, „Scheduling independent tasks to reduce mean finishing time“, *Communications of the ACM* 17(7), 382–387 (1974)
- A. Lucas, „Ising formulations of many NP problems“, *Frontiers in Physics* 2, 5 (2014) – Positionsvariablen beim Handlungsreisenden
- D. Venturelli, D. J. J. Marchand, G. Rojo, „Quantum annealing implementation of job-shop scheduling“, arXiv:1506.08479 (2015) – Zeitraster
- F. Glover, G. Kochenberger, Y. Du, „Quantum Bridge Analytics I: a tutorial on formulating and using QUBO models“, *4OR* 17, 335–371 (2019). [doi:10.1007/s10288-019-00424-y](https://doi.org/10.1007/s10288-019-00424-y) – Ungleichungen mit Schlupfvariablen
