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

### Reiter 2 · Kodierungen IA

Sofortzuweisung (instantaneous assignment, Gerkey & Matarić 2004): Jeder Roboter fährt höchstens einen Auftrag. Die Spaltenregel gehört hier
wieder zur Formulierung. Welche Regel „genau eins“ und welche „höchstens eins“ ist, hängt vom Verhältnis der Aufträge T zu den Robotern R ab:

| Fall | Strafterme | Bedeutung |
| --- | --- | --- |
| T = R | $H_{pen1} + H_{pen2}$ | jeder Auftrag genau einen Roboter, jeder Roboter genau einen Auftrag |
| T < R | $H_{pen1} + H'_{pen2}$ | jeder Auftrag genau einen Roboter, jeder Roboter höchstens einen Auftrag; R − T Roboter bleiben frei |
| T > R | $H'_{pen1} + H_{pen2}$ | jeder Auftrag höchstens einen Roboter, jeder Roboter genau einen Auftrag; T − R Aufträge warten auf die nächste Runde |

mit $H = H_{obj} + A\,H_{pen1} + B\,H_{pen2}$, $H_{obj} = \sum_t \sum_r c_{t,r} x_{t,r}$, $H_{pen1} = \sum_t (1 - \sum_r x_{t,r})^2$,
$H'_{pen1} = \sum_t \sum_{r<r'} x_{t,r} x_{t,r'}$, $H_{pen2} = \sum_r (1 - \sum_t x_{t,r})^2$, $H'_{pen2} = \sum_r \sum_{t<t'} x_{t,r} x_{t',r}$.

| Ansicht | Wofür |
| --- | --- |
| **One-Hot** ✅ | Geführter Weg in 6 Schritten: Szenario (mit Fallwahl und Robotermenge R) → Schalter → Kosten $H_{obj}$ → Auftragsregel → Roboterregel → QUBO & Hardware |
| **Domain Wall** ✅ | Geführter Weg in 6 Schritten: Szenario (Fallwahl, R) → Ketten → Kosten $H_{obj\_DW}$ → Kettenregel → Roboter- bzw. Auftragsregel → QUBO & Hardware |
| **Binary** ✅ | Geführter Weg in 7 Schritten: Szenario (Fallwahl, R) → Codes → Kosten $H_{obj\_B}$ → ungültige Codes $H_{pen\_B}$ → Roboter- bzw. Auftragsregel → Hilfsbits $H_{Aux}$ → QUBO & Hardware |

- **Fallwahl:** Drei Karten zeigen T = R, T < R und T > R mit ihren Straftermen. Ein Klick stellt R um (Auswahl behalten, auffüllen oder kürzen) und, wenn die Roboter nicht reichen, die Aufträge. Roboter lassen sich im Szenario auch einzeln an- und abwählen.
- **Schachbrett:** Zeilen- und Spaltensummen mit ✓/✗ nach der Regel des Falls (Σ = 1 oder Σ ≤ 1).
- **Bewertungskriterium:** Alle in der Sofortzuweisung zulässigen Kriterien mit ihrem Kostenkoeffizienten $c_{t,r}$ in einer Tabelle: Total Processing Time, Total Completion Time, Travel Time, Travel Distance, Waiting Time, Energy Consumption, Operating Cost, Tardiness, Throughput Time (`cost_model.IA_CRITERIA`). Je Kriterium stehen die Spanne der $c_{t,r}$ im Moment und der beste gültige Plan; ein Klick wählt es. Exakt, weil kein Roboter einen Vorgänger hat.
- **Strafgewichte:** Empfehlung A = B = 1,5 × größte Kosten. Brute Force an echten Momenten (beide Läufe, alle Fälle, beide Modi, alle 9 Kriterien, 56 160 Momente bis 16 Qubits): immer der beste gültige Plan. Die Schwelle liegt bei etwa c_max: Bei T ≠ R belohnt nur eine Regel das Einschalten, schon 0,75·c_max lässt dann oft Aufträge bzw. Roboter liegen. Bei T = R belohnen beide (−A − B auf der Diagonale).
- **Formel dahinter:** ① Formel & Fälle (Tabelle der drei Fälle) · ② Eingesetzt · ③ Ausmultipliziert (nur „genau eins“ wird ausmultipliziert, „höchstens eins“ ist schon quadratisch) · ④ Wirkung mit Kurven für A und B.
- **Kopplungen:** in jedem Fall T·C(R, 2) + R·C(T, 2). Die Roboterregel koppelt verschiedene Aufträge, die Matrix zerfällt also nicht in Blöcke.

Direktlink: `#/ia/one-hot?schritt=5&auftraege=1,2,3,4,5&roboter=61,62,63&kriterium=wartezeit&zustand=minimum&formel=wirkung` (`zustand` auch `gierig` oder `bester`, `modus=alle` für belegte Roboter).

#### Domain Wall in der Sofortzuweisung

Eine Domain-Wall-Kette drückt nur „genau eins“ aus (entlang der Kette ist $\sum x = 1$ für jede Stellung). Darum liegt sie auf der Seite,
die vollständig zugewiesen wird, und ersetzt dort die „genau eins“-Regel. Die andere Seite regelt die One-Hot-Regel, eingesetzt mit
$x$ = Differenz zweier Bits („Querregel“):

| Fall | Kette | Qubits | $H$ |
| --- | --- | --- | --- |
| T = R | je Auftrag, $x_{t,r} = d_{t,r-1} - d_{t,r}$ | $T(R-1)$ | $H_{obj\_DW} + A\,H_{pen\_DW} + B\,H_{pen2}$ |
| T < R | je Auftrag | $T(R-1)$ | $H_{obj\_DW} + A\,H_{pen\_DW} + B\,H'_{pen2}$ |
| T > R | je Roboter, $x_{t,r} = e_{t-1,r} - e_{t,r}$ | $R(T-1)$ | $H'_{obj\_DW} + A\,H'_{pen\_DW} + B\,H'_{pen1}$ |

mit $d_{t,0} = 1$, $d_{t,R} = 0$ (bzw. $e_{0,r} = 1$, $e_{T,r} = 0$), $H_{obj\_DW} = \sum_t \big(c_{t,1} + \sum_{i=1}^{R-1} (c_{t,i+1} - c_{t,i})\, d_{t,i}\big)$
(Teleskopsumme von $\sum c\,x$) und $H_{pen\_DW} = \sum_t \sum_{i=1}^{R-2} d_{t,i+1}(1 - d_{t,i})$ (keine Wand 0 → 1). Roboter stehen nach
Nummer, Aufträge in Anfrage-Reihenfolge in der Kette.

- **Ketten und x-Tabelle:** Unter den Ketten zeigt eine Tabelle Auftrag × Roboter das daraus folgende $x_{t,r}$ – an einer gebrochenen Kette
  auch −1 (rot). Ein Klick in die Tabelle setzt die Wand.
- **Querregel belohnt gebrochene Ketten:** Bei T ≠ R ist sie „höchstens eins“, $\sum x\,x'$. Hat eine gebrochene Kette $x = -1$ an einem
  Mitglied, das ein anderer belegt, wird das Produkt −1 – Belohnung −B. Mit Phantasiewert und gespartem Ausweichen (je ≤ Kostenspannweite
  $s$ einer Kette) gewinnt ein Bruch bis $B + 2s$. Bei T = R ist $(1 - \sum x)^2 \ge 0$, aber $x^2 = x$ gilt nicht mehr (Differenz zweier Bits).
- **Strafgewichte:** Empfehlung **B = 1,5 × s, A = 3B** (`formulations.ia_dw_default_weights`). Brute Force an echten Momenten (beide Läufe,
  alle Fälle, beide Modi, alle 9 Kriterien, 25 299 Momente bis 16 Qubits): immer gültig und der beste Plan, ohne Gleichstand. A = 2B (wie
  Domain Wall mit Spaltenregel in der TA) scheitert bei T ≠ R in 9 Momenten, gebraucht wurde A − B bis 1,65·s; B = 0,9·s scheitert.
  Bei T = R reicht B ≈ s/2. Gegenbeispiele stehen in `tests/test_ia_domain_wall.py`.
- **Qubits und Kopplungen** bei voller Zuständigkeit, mit K Ketten der Länge L: $K(L-1)$ Qubits, $K(L-2) + \binom{K}{2}(3L-5)$ Kopplungen
  (One-Hot: $TR$ und $T\binom{R}{2} + R\binom{T}{2}$). Domain Wall spart immer K Qubits, braucht bei T ≈ R aber **mehr Kopplungen**:
  T = R = 4 → 50 statt 48, T = 5, R = 4 → 72 statt 70. Die Tabelle beim Kopplungsgraph zeigt das für T = 1 … 6.
- **Formel dahinter:** ① Formel & Fälle · ② Eingesetzt (jedes $x$ als Differenz) · ③ Ausmultipliziert (Teleskopsumme, Kettenregel,
  Querregel mit ihrem Beitrag je Roboter bzw. Auftrag) · ④ Wirkung (alle Stellungen einer Kette, Kurven für A und B).

Direktlink: `#/ia/domain-wall?schritt=5&auftraege=1,2,3,4,5&roboter=61,62&zustand=minimum&formel=wirkung` (wie One-Hot: `zustand`,
`modus=alle`, `A`, `B`).

#### Binary in der Sofortzuweisung

Auch ein Binärcode drückt nur „genau eins“ aus: Jede Stellung der $K$ Bits ist genau ein Code. Er liegt deshalb wie die Kette auf der Seite,
die vollständig zugewiesen wird; die andere Seite regelt die One-Hot-Regel, eingesetzt mit $x = y$:

| Fall | Code | Bits | $H$ |
| --- | --- | --- | --- |
| T = R | je Auftrag, $K = \lceil \log_2 R \rceil$ | $T K$ | $H_{obj\_B} + A\,H_{pen\_B} + B\,H_{pen2} + M\,H_{Aux}$ |
| T < R | je Auftrag | $T K$ | $H_{obj\_B} + A\,H_{pen\_B} + B\,H'_{pen2} + M\,H_{Aux}$ |
| T > R | je Roboter, $K = \lceil \log_2 T \rceil$ | $R K$ | $H'_{obj\_B} + A\,H'_{pen\_B} + B\,H'_{pen1} + M\,H_{Aux}$ |

mit $x_{t,r} = y_{t,r} = \prod_{k=1}^{K} \big(u_{k,r}\, b_{t,k} + (1 - u_{k,r})(1 - b_{t,k})\big)$ ($u_r$ = Code von Roboter $r$: Platz in $R$ nach
Nummer, höchste Stelle zuerst), $H_{obj\_B} = \sum_t \sum_r c_{t,r}\, y_{t,r}$ und
$H_{pen\_B} = \sum_t \sum_{u \in U_f} \prod_k \big(u_k b_{t,k} + (1 - u_k)(1 - b_{t,k})\big)$ für die $2^K - R$ ungenutzten Codes $U_f$.
Bei T > R analog mit $g_{r,k}$, $v_t$ (Anfrage-Reihenfolge), $w_{t,r}$ und $V_f$. Codes von Robotern, die für einen Auftrag nicht zuständig
sind, zählen wie ungenutzte.

**$H_{Aux}$ (Hilfsbits, ab $K \ge 2$).** Für $K \ge 2$ ist $y_{t,r}$ ein Produkt aus $K$ Faktoren, also ein Polynom vom Grad $K$ in den Bits eines
Codes. Die Querregel multipliziert zwei solche Produkte verschiedener Codes und erreicht Grad $2K \ge 4$; ab $K = 3$ haben schon $H_{obj\_B}$ und
$H_{pen\_B}$ Grad 3. Eine QUBO erlaubt nur Grad 2. Deshalb wird jedes Bitpaar $x\,y$ eines Codes, das in einem Term vom Grad > 2 vorkommt, durch
ein Hilfsbit $a$ ersetzt, und $H_{Aux} = \sum_{a = xy} (xy - 2xa - 2ya + 3a)$ erzwingt $a = xy$: Der Term ist genau dann 0, sonst mindestens 1
(Rosenberg 1975). Hilfsbits dürfen selbst Teil eines Paares sein ($a_{t,123} = a_{t,12}\, b_{t,3}$), bis jeder Term höchstens zwei Variablen hat.
Ersetzt werden nur Paare **desselben Codes**. Das reicht immer: Ein Term berührt höchstens zwei Codes, und bei Grad > 2 trägt einer davon
mindestens zwei Variablen bei. Koppelt die Querregel mindestens zwei Codes, wird so jedes $y$ linear in Bits und Hilfsbits seines Codes; dafür
braucht es je Code $2^K - K - 1$ Hilfsbits ($K = 2$: eines, $K = 3$: vier). Ein Greedy, der auch Paare über zwei Codes wählt, brauchte bei
$K = 3$ bis doppelt so viele. Das Gewicht $M$ muss größer sein als der größte Energiegewinn, den ein falsch gesetztes Hilfsbit bringen kann.

- **Codes und y-Tabelle:** Je Code Bits mit Stellenwert und Codebuch (ungenutzte Codes rot gestrichelt); darunter Auftrag × Roboter mit
  $y_{t,r}$. Es ist immer 0 oder 1, die Querregel belohnt also nie (anders als bei Domain Wall). Ab Schritt 6 die Hilfsbits, die man lügen lassen kann.
- **Polynom, dann QUBO:** Schritte 3–5 rechnen mit dem echten Polynom (Grad bis $2K$, nur Code-Bits), ab Schritt 6 mit der QUBO samt Hilfsbits.
  Probe: QUBO mit ehrlichen Hilfsbits = Polynom = Regeln.
- **Strafgewichte:** Empfehlung **A = 1,5 × größte Kosten, B = 1,5 × Kostenspannweite s eines Codes, M = 1,1 × größter Gewinn eines lügenden
  Hilfsbits** (`formulations.ia_bin_default_weights`). Brute Force an echten Momenten (beide Läufe, alle Fälle, beide Modi, alle 9 Kriterien,
  22 968 Momente bis 14 Qubits, dazu 15 Stichproben mit 21 Qubits): immer gültig und der beste Plan, ohne Gleichstand. A = 0,9·c_max,
  B = 0,9·s und bei K = 3 auch M = 0,5 × Lügengewinn scheitern; bei T = R reicht B ≈ s/2. M ist ein Vielfaches von B (in den Stichproben
  12- bis 45-fach) und bestimmt den größten Koeffizienten. Gegenbeispiele stehen in `tests/test_ia_binary.py`.
- **Qubits und Kopplungen:** $G$ Codes zu je $K$ Bits. Koppelt die Querregel mindestens zwei Codes, sind es $G(2^K - 1)$ Qubits – nie weniger
  als Domain Wall ($G(L - 1)$, gleich bei $L = 2^K$) und stets mehr Kopplungen (T = R = 4: Binary 12 / 66, Domain Wall 12 / 50, One-Hot 16 / 48).
  Gegen One-Hot ist es gemischt (R = 2, T = 4: Binary 15 Kopplungen, One-Hot 16). Weniger Qubits als Domain Wall braucht Binary nur ohne
  Querregel (T = 1 oder R = 1, z. B. T = 1, R = 4: 2 statt 3); bei K = 1 sind beide gleich. Die Tabelle beim Kopplungsgraph vergleicht alle
  drei Kodierungen für T = 1 … 6 (`formulations.ia_sizes`).
- **Formel dahinter:** ① Formel & Fälle (mit $H_{Aux}$ in Worten) · ② Eingesetzt · ③ Ausmultipliziert (y je Code, Kosten, Produkt zweier Codes,
  Grad-Tabelle, Hilfsbits, fertige QUBO) · ④ Wirkung (Codebuch, Rosenberg-Tabelle, Kurven für A, B und M).

Direktlink: `#/ia/binary?schritt=6&auftraege=1,2,3,4,5&roboter=61,62&zustand=minimum&formel=wirkung` (wie Domain Wall: `zustand`,
`modus=alle`, `A`, `B`, `M`).

### Reiter 3 · Kodierungen TA

Zuweisung mit Reihenfolge (time-extended assignment, ST-SR-TA): Ein Roboter darf mehrere Aufträge übernehmen. Seit 31.10.2026 ist das
Ziel hier nur der **Lastausgleich (Workload Balancing)**: Die Last eines Roboters ist die Summe der Arbeit seiner Aufträge – egal in welcher
Reihenfolge. Darum kommen die Seiten ohne Positionen und Zeitraster aus; Zeitkriterien (Erledigungszeit, Makespan, Verspätung) bräuchten sie.
Alte Links `#/kodierungen/…` führen hierher.

| Ansicht | Wofür |
| --- | --- |
| **One-Hot** ✅ | $H = H_{obj\_OH} + A\,H_{pen1\_OH} + B\,H_{OH\_WB}$ in 6 Schritten: Szenario, Schalter, Kosten, Auftragsregel, Lastausgleich, QUBO & Hardware |
| **Domain Wall** ✅ | Kette je Auftrag über die Roboter, $x_{t,r} = d_{t,r-1} - d_{t,r}$; 6 Schritte (Ketten, Kettenregel) |
| **Binary** ✅ | Code je Auftrag ($K = \lceil\log_2 R\rceil$ Bits), $x_{t,r} = y_{t,r}$; 7 Schritte (Codes, ungültige Codes, Hilfsbits) |
| Archiv: One-Hot (diagonal), One-Hot + Reihenfolge, Domain Wall (diagonal), Binary (diagonal), Formel-Baukasten ✅ | die früheren Seiten unter `#/ta/alt-one-hot`, `#/ta/reihenfolge`, `#/ta/alt-domain-wall`, `#/ta/alt-binary`, `#/ta/baukasten` |

**Formulierung** ([`encodings/workload.py`](../encodings/workload.py), Notation des Users):

$$H_{obj} = \sum_t\sum_r c_{t,r}\,x_{t,r},\qquad H_{WB} = \sum_r \Big(L_{r,0} + \sum_t c_{t,r}\,x_{t,r}\Big)^2$$

Ausmultipliziert (One-Hot, $x^2 = x$): $B L_0^2 + B\sum (2L_0c + c^2)\,x + 2B\sum_{t<t'} c\,c'\,x\,x'$. Die Paare koppeln Aufträge am
selben Roboter – dieselben Paare wie die Spaltenregel der IA, aber mit $2B\,c\,c'$ statt $B$. Wegen
$\sum_r L_r^2 = (\sum_r L_r)^2/R + \sum_r (L_r - \bar L)^2$ bestraft das Quadrat Gesamtlast **und** Ungleichheit.

**Was in die Last einfließt** (Karte neben den Lastbalken, Server-Parameter `last`, `anteile`, `vorlast`):

- Lastmaß: Arbeitszeit (s), Fahrstrecke (Felder) oder Energie (Wh). $c_{t,r}$ gilt in $H_{obj}$ und $H_{WB}$.
- Anteile von $c_{t,r}$: Anfahrt (je Roboter, ab der aktuellen Position – exakt nur für den ersten Auftrag eines Roboters), Beladen,
  Lastfahrt, Entladen. Ohne Anfahrt ist $c_{t,r} = c_t$, die Gesamtlast fest und $H_{WB}$ die Zahlenpartitionierung auf $R$ Roboter.
- Vorlast $L_{r,0}$ eines belegten Roboters: keine, pauschal ($t_{rest}$), **aus Status** (Rest des laufenden Auftrags aus Status, Position
  und Lebenslauf, mit den gewählten Anteilen) oder **aus dem Log** (tatsächliche Restdauer, Rückschau, nur Arbeitszeit). Ohne Lebenslauf
  im Log gilt pauschal. Die Batterie taugt nicht: Sie steht in beiden Läufen konstant auf 15 %.

**Befunde zur Hardware** (Tabelle beim Kopplungsgraph, `workload.wb_sizes`, volle Zuständigkeit):

- One-Hot: $T\cdot R$ Qubits, $T\binom{R}{2} + R\binom{T}{2}$ Kopplungen – so viele wie die IA mit Spaltenregel.
- Domain Wall: $T(R-1)$ Qubits, $T(R-2) + \binom{T}{2}(3R-5)$ Kopplungen. Eine gebrochene Kette erzeugt $x = -1$ und zieht Last ab –
  die Schranke für A wächst deshalb mit B.
- Binary: Hilfsbits nur innerhalb eines Codes, je Code höchstens $2^K - K - 1$; $y\,y'$ hat Grad $2K$. Bei $R = 3$ ist der Graph
  **vollständig** (T = 4: 12 Qubits, 66 Kopplungen; One-Hot 12 / 30, Domain Wall 8 / 28).
- Die Varianz $\sum_r (L_r - \bar L)^2$ statt $\sum_r L_r^2$ koppelt über $(\sum L)^2$ jedes Paar von Variablen ($\binom{TR}{2}$).
- Die Last-Terme wachsen mit $c^2$, und A muss mit B mitwachsen – der Dynamikbereich der Koeffizienten steigt.

**Gewichte** (`workload.wb_default_weights`, Regler mit Empfehlung; A folgt live dem eingestellten B):

- $B = 1/(2\bar c)$: Ein Auftrag auf einem Roboter, der schon einen gleich großen fährt, kostet um seine eigene Last mehr als auf einem leeren.
- A = 1,1 × Schranke: One-Hot und Binary $\max_t \min_r \big(c_{t,r} + B(c_{t,r}^2 + 2c_{t,r}(L_{r,0} + \sum_{t' \ne t} c_{t',r}))\big)$ –
  Liegenlassen bzw. ein gesperrter Code lohnt nie, selbst wenn alle anderen Aufträge auf demselben Roboter liegen. Domain Wall
  $\max_t (s_t + B\max_r (2c_{t,r}L_r - c_{t,r}^2))$ für den Kettenbruch. Sicher, aber großzügig (Kurve „Wie groß muss A sein?“ in ④).
- M = 1,1 × größter Gewinn eines lügenden Hilfsbits (wie in der IA).
- Brute Force (31.10.2026, beide Läufe, 1 848 verschiedene Momente bis 14 Bits, je Kodierung B = 0, Empfehlung und dreifach, sechs
  Varianten von Lastmaß, Anteilen und Vorlast): In allen 15 726 Fällen ist das QUBO-Minimum gültig und gleich dem besten Plan durch Aufzählen.
  Die A-Empfehlung ist bei One-Hot 1,1- bis 3,1-mal so groß wie nötig (Median 1,6). Bei Domain Wall und Binary reicht oft ein sehr kleines A
  (R = 2: keine Kettenregel; $R = 2^K$ ohne gesperrte Codes: keine ungültigen Codes).

**Aufbau jeder Seite:** Schritte mit Erklärung · Szenario und Karte (Robotermenge R wie in der IA) · Brett der Kodierung mit Fußzeile
„Last $L_r$“ · Energie je Term · **Last je Roboter** (Vorlast schraffiert, Aufträge blau, $x = -1$ rot; gestrichelt der beste Plan für B) ·
**Was fließt in die Last ein?** · **Gesamtlast gegen Ausgleich** (alle gültigen Pläne, Pareto-Front, Gerade $H_{obj} + B\,\Sigma L^2$ = konst.) ·
QUBO-Matrix, Kopplungsgraph und Größentabelle · normierte Matrix und Energielandschaft · Formel (① Formel · ② Eingesetzt ·
③ Ausmultipliziert → QUBO · ④ Wirkung von B und A) · Rangliste. Gemeinsamer Code: `views/taWorkload.js`, Unterschiede der Kodierungen in
`views/taWorkloadEncodings.js`, Formel in `views/taWorkloadFormula.js`, Lastbausteine in `components/workload.js`.

Direktlink: `#/ta/one-hot?schritt=5&auftraege=6,7,8&roboter=61,62,63&modus=alle&last=zeit&anteile=anfahrt,beladen,lastfahrt,entladen&vorlast=status&zustand=minimum&formel=wirkung`
(weiter `A`, `B`, `M`; `zustand` = `gierig` | `bester` | `minimum`).

#### Archiv: die früheren TA-Seiten

Sie rechnen mit Diagonal-Kriterien (feste $c_{t,r}$ ohne Spaltenregel) bzw. mit Positions-Hilfsvariablen und bleiben zum Nachschlagen.

| Ansicht | Wofür |
| --- | --- |
| **One-Hot (diagonal)** | Geführter Weg in 5 Schritten an echten Aufträgen, siehe unten |
| **One-Hot + Reihenfolge** | Ein Roboter fährt mehrere Aufträge: Platz-Hilfsvariablen, Ablaufplan, Hardware-Vergleich, siehe unten |
| **Domain Wall (diagonal)** | Derselbe geführte Weg wie bei One-Hot, mit Ketten statt Schachbrett, siehe unten |
| **Binary (diagonal)** | Derselbe Weg in 6 Schritten, mit Codes, Indikator-Produkten und – ab Grad 3 – Hilfsbits, siehe unten |
| **Formel-Baukasten** | Die Formel selbst zusammensetzen: Kodierung je Auftrag frei wählbar (auch gemischt), Bausteine auf Zuweisungs- und Bit-Ebene, auch unsinnige – mit Energiebilanz und Diagnose gegen das echte Problem, siehe unten |

**Keine Spaltenregel (TA, seit 26.10.2026):** Doppelbelegung ist zulässig – ein Roboter darf mehrere Aufträge übernehmen. Alle Kodierungen
prüfen nur noch „jeder Auftrag genau ein Roboter“. Bei der Sofortzuweisung (K = 1) zählt jeder Auftrag dann, als startete sein Roboter sofort;
mehrere Aufträge eines Roboters werden in Anfrage-Reihenfolge gelesen. Für Zeit-Kriterien fehlt dabei die Wartezeit auf den Vorgänger – die
rechnet erst **One-Hot + Reihenfolge** (K ≥ 2). Die Platzregel dort bleibt: Sie verbietet keine Doppelbelegung, nur zwei Aufträge auf
*demselben* Platz.

Der geführte Weg bei **One-Hot**:

1. **Szenario:** Einen Moment und bis zu 6 Aufträge aus dem Lauf wählen. Es gibt Beispiele wie „Kapitel-Beispiel“ und „Mehr Aufträge als Roboter“.
2. **Schalter:** Ein Schachbrett aus anklickbaren Bits $x_{t,r}$. Die Karte zeigt, welche Fahrt ein Bit bedeutet.
3. **Kosten:** Jeder Schalter kostet die Anfahrt. Ohne Regeln gewinnt „niemand fährt“.
4. **Zeilenregel:** Genau ein Roboter je Auftrag (Strafe A per Regler). Das Minimum nimmt je Auftrag den billigsten Roboter – auch denselben.
5. **QUBO & Hardware:** Matrix, Kopplungsgraph und Kennzahlen. Ohne Spaltenregel zerfällt die Matrix in einen Block je Auftrag.

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

Direktlinks funktionieren auch, zum Beispiel `#/ta/alt-one-hot?schritt=5&auftraege=1,2,3&kriterium=erledigungszeit&zustand=minimum&formel=eingesetzt`. Der Parameter `formel` nimmt die Werte `formel`, `eingesetzt`, `qubo` oder `wirkung` an, `kriterium` die Schlüssel aus `cost_model.CRITERIA`.

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

Direktlink: `#/ta/reihenfolge?auftraege=1,2,3,4,5&plaetze=2&kriterium=erledigungszeit&schwellen=1`. `schwellen=1` berechnet die Schwellen sofort (bis 16 Schalter).

#### Domain Wall

Gleicher Aufbau wie One-Hot (5 Schritte: Szenario → Ketten → Kosten → Kettenregel → QUBO & Hardware), gleiche Szenarien und Kriterien. Was anders ist:

- **Die Ketten:** Je Auftrag eine Reihe aus *R* − 1 Bits zwischen einer festen 1 und einer festen 0. Zwischen zwei Nachbarn steht jeweils ein Roboter mit seinen Kosten und seinem δ. Grün = Wand 1 → 0 (gewählter Roboter), rot = falsche Wand 0 → 1. Die Reihenfolge der Roboter in der Kette ist wählbar (nach Nummer wie im Kapitel, oder billigster zuerst).
- **Die Formel dahinter:** dieselben vier Register. ③ zeigt die Teleskopsumme der Kosten und die Kettenregel als Nachbarkopplung. ④ listet alle Stellungen einer Kette mit „Phantasiewerten“ und zeigt den **Gültigkeitsbereich** von A.
- **Strafgewicht:** A = 1,5 × größte Spannweite der Kosten – ein Kettenbruch spart höchstens die Spannweite. (Mit Spaltenregel brauchte es A = 2·B, weil δ = −1 die Spaltenregel zur Belohnung macht.)
- **Hardware:** Vergleich mit One-Hot für dieselben Aufträge: Kopplungen T(R − 2) gegenüber T·R(R − 1)/2 – ohne Spaltenregel ist Domain Wall immer sparsamer. (Mit Spaltenregel kämen je konkurrierendem Auftragspaar 3R − 5 bzw. R dazu; dann wäre Domain Wall bei 4 Robotern nur bis 3 Aufträge sparsamer.)

Direktlink: `#/ta/alt-domain-wall?schritt=5&auftraege=1,2&kriterium=leerfahrt&reihenfolge=kosten&zustand=minimum&formel=wirkung`.

#### Binary

6 Schritte: Szenario → Codes → Kosten → Ungültige Codes → Hilfsbits → QUBO & Hardware.

- **Die Codes:** Je Auftrag ⌈log₂ R⌉ Bits mit Stellenwert, daneben das Codebuch (blau = gewählt, rot gestrichelt = Phantomcode ohne Roboter). Ein Klick auf einen Code setzt die Bits.
- **Schritte 3–4 rechnen mit dem echten Polynom** (Grad ⌈log₂ R⌉). Ab Schritt 5 ist es die QUBO; **Hilfsbits** braucht es erst ab Grad 3, also ab 5 Robotern je Auftrag – ohne Spaltenregel koppeln die Aufträge nicht. Hilfsbits lassen sich einzeln umschalten („lügen“) oder automatisch ehrlich halten.
- **Die Formel dahinter:** Indikator-Produkte, Kostenpolynom mit gemischten Koeffizienten, Terme nach Grad, welches Paar jedes Hilfsbit ersetzt, Rosenberg-Tabelle (8 Fälle) und der Gültigkeitsbereich von A (und M).
- **Hardware:** Variablen und Kopplungen im Vergleich mit One-Hot und Domain Wall für dieselben Aufträge, Terme nach Grad.

Die Quadratisierung ist allgemein (`formulations.binary`): Das Paar, das in den meisten Termen vom Grad > 2 steckt, wird durch ein Hilfsbit ersetzt, bis alles höchstens Grad 2 hat. Die empfohlene Hilfsbit-Strafe M ist der größte Gewinn, den ein lügendes Hilfsbit bringen kann (alle Belegungen seiner Nachbarn durchprobiert), × 1,1.

#### Strafgewichte einstellen (alle Kodierungsseiten)

Jedes Strafgewicht hat einen **Schieberegler und ein Eingabefeld** – das Feld nimmt auch Werte über das Reglerende hinaus. Daneben steht die **Empfehlung** (Klick übernimmt sie) mit einer kurzen Begründung.

- **„bei neuem Szenario oder Kriterium automatisch anpassen“:** Ist der Haken aus, bleiben deine Gewichte bei jedem Wechsel stehen. Die Wahl gilt für alle Seiten und wird im Browser gemerkt.
- **Per Link:** `?A=80&B=40` (One-Hot, Domain Wall), `?A=…&B=…&D=…` (Reihenfolge), `?A=…&B=…&M=…` (Binary). Im Formel-Baukasten stehen die Gewichte ohnehin in der Formelzeile und im Link.

#### Matrix, Kopplungsgraph und Energielandschaft (alle Kodierungsseiten)

Direkt unter Schalterbrett und „Energie dieses Zustands“ stehen auf jeder Kodierungsseite **QUBO-Matrix** und **Kopplungsgraph** (One-Hot, Domain Wall, Reihenfolge ab Schritt 3; Binary ab Schritt 6, wenn es eine QUBO ist), darunter nebeneinander ([`components/landscape.js`](static/js/components/landscape.js)):

- **Normierte QUBO-Matrix:** Q / max|Q| als Heatmap, blau = Belohnung, rot = Strafe. Darüber max |Q|, kleinster |Q| ≠ 0 und der Dynamikbereich in Bit – die Auflösung, die die Hardware für die Koeffizienten braucht.
- **Energielandschaft (3D):** Die Bits liegen auf zwei Achsen, je in Gray-Reihenfolge (Nachbarzellen unterscheiden sich in einem Bit); Höhe = Energie. Bis 16 Qubits alle Zustände exakt, bis 22 je Zelle die kleinste Energie über die übrigen Bits, darüber ein Schnitt durch das Minimum. Markiert: gültige Zustände (grün), Minimum, dein Zustand. Optional logarithmische Höhe, damit Täler neben hohen Strafwänden sichtbar bleiben.

#### Formel-Baukasten

Auf den anderen Seiten ist die Formel fest. Im Baukasten (letzter Unterreiter) wählt man **je Auftrag die Kodierung** und setzt die QUBO aus **Bausteinen** zusammen, die man an- und abschalten, gewichten, umbauen, ergänzen und entfernen kann – ausdrücklich auch unsinnig. Jede Seite (One-Hot, Reihenfolge, Domain Wall, Binary) hat einen Knopf **„Formel verändern → Baukasten“**, der Aufträge und Kodierung mitnimmt. Die Mathematik steht in [`encodings/baukasten.py`](../encodings/baukasten.py).

**Kodierung je Auftrag.** Jeder Auftrag wählt eine *Option* – einen Roboter, bei K ≥ 2 einen Roboter-Platz. Wie diese Wahl in Bits steht, legt die Kodierung fest:

| Kodierung | Bits je Auftrag (m Optionen) | Indikator I = „Auftrag t nimmt Option o“ |
| --- | --- | --- |
| One-Hot | m | das Bit selbst, Grad 1 |
| Domain Wall | m − 1 | δ = b_k − b_{k+1} (Kette mit Rändern 1 und 0), linear – an Kettenbrüchen auch −1 |
| Binary | ⌈log₂ m⌉ | Produkt Π z bzw. (1 − z) für den Code k, Grad ⌈log₂ m⌉ |

Die Kodierung wählt man für alle (Chips im Szenario), „reihum gemischt“ oder je Zeile im Bit-Brett. „Optionen in Kette/Code“ ordnet sie nach Roboter und Platz oder billigste zuerst.

**Zwei Ebenen von Bausteinen:**

| Ebene | Baustein | Was man verändern kann |
| --- | --- | --- |
| Zuweisung (über die Indikatoren) | Kosten (Ziel) | Gewicht je Platz w(q): q (von hinten), 1 oder K + 1 − q (von vorne); Wartezeit ρ und Anfahrt s⁰ an/aus. Bei Kriterien der Sofortzuweisung (K = 1) die festen c_t,r |
| | Vorgänger-Kopplung (Ziel) | s − s⁰ (ersetzt die Anfahrt, richtig) oder s (kommt dazu, doppelt gezählt); Gewicht je Platz |
| | Gruppenregel | Gruppe: je Auftrag, je Roboter-Platz, je Roboter, je Auftrag und Roboter, alle Optionen. Form f(n): genau k, höchstens eins, linear k − n, eigene a + b·n + c·n² |
| | Nachbarplatz-Regel | Lücke o₁·(1 − o₂) oder eigene a + b·o₁ + c·o₂ + d·o₁o₂ |
| Bits (direkt auf den Bits eines Blocks) | Bit-Gruppe | Gruppe: je Block, je Bitstelle über alle Aufträge, alle Bits. Form f(n) wie oben |
| | Bit-Nachbarn / Kettenregel | Kette z_{j+1}·(1 − z_j) – die Domain-Wall-Regel – oder eigene g für je zwei benachbarte Bits |
| | Phantom-Codes | Binärcodes ohne Option kosten (wirkt nur auf Binär-Blöcke) |
| | Hilfsbit-Strafe M | Rosenberg xy − 2xw − 2yw + 3w; wird automatisch ergänzt, solange Terme vom Grad > 2 entstehen |

Jeder Baustein „gilt für“ alle Aufträge oder nur für die Blöcke einer Kodierung – so lässt sich auch die Zeilenregel auf Domain-Wall-Ketten oder die Kettenregel auf One-Hot-Bits anwenden. Gewichte und An/Aus wirken sofort im Browser; Form, Gruppe, Geltungsbereich und Kodierung gehen an den Server.

**Voreinstellung „Standard“:** Je Kodierung die Regel, die ihre Bits zu genau einer Option macht – Zeilenregel (One-Hot), Kettenregel (Domain Wall), Phantom-Codes (Binary) –, bei K ≥ 2 dazu Vorgänger, Platz- und Lückenregel, bei Bedarf die Hilfsbit-Strafe. Keine Spaltenregel: Doppelbelegung ist zulässig (eine „Gruppe je Roboter, höchstens eine Option“ lässt sich als strengere Regel trotzdem bauen – die Diagnose meldet dann, dass sie den besten Plan bestraft). Gemischt gilt jede Gültigkeitsregel nur für ihre Blöcke (Symbole A, A_K, A_C). Jeder Baustein bekommt ein **empfohlenes Gewicht** nach seiner Rolle (Knopf „Empfehlung“ im Bearbeitungsfeld): Kettenregel = A bei K = 1, sonst 2 × max(B, D); M = 1,1 × größter Gewinn eines lügenden Hilfsbits.

Was die Seite zeigt:

- **Das echte Problem:** die Anforderungen und das Ziel, dazu grau die Bedingungen der Kodierung (gültige Codewörter, ehrliche Hilfsbits) – geprüft für das Minimum der QUBO und für den Zustand im Bit-Brett, verglichen mit dem besten gültigen Plan.
- **Formelzeilen:** jeder Baustein als Formel (mit x bei reinem One-Hot, sonst mit I), ein Satz „was er tut“ und ein Abzeichen ✓/⚠, ob er passt. Bit-Bausteine sind grau schraffiert. Darüber steht, wie I in den gewählten Kodierungen aussieht.
- **Diagnose „Was fehlt? Was wirkt?“:**
  - fehlende Regel für eine Anforderung, getrennt nach Kodierung, mit Knopf „+ Standardregel“ (Zeilen-, Ketten- oder Phantom-Regel);
  - Form lässt den Verstoß zu; Gewicht zu klein mit Kipp-Schwelle und Knopf; lügende Hilfsbits mit der Schwelle für M;
  - Regel bestraft den besten gültigen Plan oder mischt sich ins Ziel ein (kostet bei gültigen Plänen unterschiedlich viel);
  - Ziel-Bausteine bewerten Pläne falsch.
- **Energiebilanz:** Zwei Zustände Baustein für Baustein: Wer macht den einen billiger (*zieht*), wer teurer (*wehrt sich*)? Bei unzulässigem Minimum gegen den gültigen Plan, den die QUBO am billigsten findet; bei gültigem, nicht optimalem Minimum gegen den besten Plan; sonst der billigste Regelbruch gegen das Minimum – der Sicherheitsabstand der Strafen.
- **„Was kostet jeder Baustein bei gültigen Plänen?“:** Alle gültigen Pläne (bis zu den 4000 besten) werden in die gewählten Bits kodiert. Eine reine Strafe ist bei jedem gültigen Plan gleich teuer (✓ neutral); sonst verschiebt sie die Rangfolge. Dazu: treffen die Ziel-Bausteine das echte Ziel, und welchen gültigen Plan hält die QUBO für den besten?
- **„Jeden Baustein einzeln weglassen“:** wie bisher, bis 16 Qubits automatisch.
- **Bit-Brett:** je Auftrag eine Zeile in seiner Kodierung – One-Hot-Bits mit Optionsknöpfen, Domain-Wall-Kette mit δ je Option, Binär-Bits mit Codebuch (Phantom-Codes gestrichelt) –, rechts die Lesart. Darunter Σ I je Roboter-Platz und die Hilfsbits (lügende rot, „beim Klicken ehrlich halten“).
- **Energie je Baustein, Ablaufplan, QUBO-Matrix (bis 64 Qubits), Kopplungsgraph und Hardware** (Qubits = Bits + Hilfsbits, Kopplungen, größter Koeffizient, Grad vor den Hilfsbits).

Gesucht wird bis 22 Qubits durch Aufzählen aller Zustände. Darüber läuft Simulated Annealing mit Tausch-Zügen in One-Hot-Blöcken, und alle gültigen Pläne werden als Kandidaten mitgeprüft – eine Heuristik, so beschriftet.

Die URL enthält Szenario, Kodierung und Formel: `kodierung=binary` oder `kodierung=1:one_hot,2:domain_wall`, `reihenfolge=kosten`, `formel=…`, `offen=zeile,kette` (Bearbeitungsfelder), `preset=standard|nur_kosten`.

**Was man damit sieht** (Lauf `2026-10-09_12-59-39`, alle Roboter, Standard mit empfohlenen Gewichten):

| Aufträge | K | Kodierung | Bits + Hilfsbits | Kopplungen | Grad vorher | größter Koeffizient |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | 1 | One-Hot | 12 | 18 | 2 | 150 |
| 3 | 1 | Domain Wall | 9 | 6 | 2 | 106 |
| 3 | 1 | Binary | 6 | 3 | 2 | 56 |
| 4 | 2 | One-Hot | 32 | 208 | 2 | 800 |
| 4 | 2 | Domain Wall | 28 | 170 | 2 | 3205 |
| 4 | 2 | Binary | 12 + 16 | 342 | 6 | 450000 |

Ohne Spaltenregel koppeln die Aufträge bei K = 1 gar nicht – jede Kodierung zerfällt in einen Block je Auftrag, und Binary ist bei bis zu 4 Robotern am sparsamsten. Mit Reihenfolge (K = 2) koppeln Vorgänger-, Platz- und Lückenregel die Aufträge weiter: Dann braucht Binary so viele Qubits wie Domain Wall, die meisten Kopplungen und Koeffizienten, die um mehr als das 100-Fache größer sind (die Empfehlung für M ist eine sichere Schranke, bei mehr als 16 Nachbarn eines Hilfsbits grob). Brute-Force-Prüfung der empfohlenen Gewichte (beide Läufe, jede Kodierung und gemischt): mit festen Kosten (K = 1) und mit Reihenfolge (K = 2) immer der beste gültige Plan. Bei K = 1 mit Erledigungszeit wählt die QUBO in 13 von 46 Momenten eine Doppelbelegung, die gültig, aber nicht optimal ist – sie zählt den zweiten Auftrag, als startete er sofort (dafür gibt es K ≥ 2). Und ein Beispiel für „falsch kombiniert“: Die Zeilenregel (1 − Σδ)² auf einer Domain-Wall-Kette ist ausmultipliziert 1 − Anzahl Wände – sie *belohnt* jeden Kettenbruch mit 2 × A.

### Reiter 4 · Qubits & Kopplungen

Für **eine Instanz** (Aufträge und Roboter aus der Liste, wie auf den Kodierungsseiten) zwei Diagramme „Qubits gegen Kopplungen“: links die
Sofortzuweisung (IA, Paarstrafe wie `formulations.*_ia`), rechts die TA mit Lastausgleich (`workload.wb_formulation`) – je ein Punkt für
One-Hot, Domain Wall und Binary. Beide Diagramme haben dieselbe Skala; die gepunktete Linie ist der vollständig verbundene Graph C(n, 2).
Darunter je eine Tabelle (Qubits, davon Hilfsbits, Kopplungen, Dichte, Ø Grad) und ein Satz zum Vergleich mit One-Hot.

Gezählt wird die fertige QUBO (Binary mit Hilfsbits) mit allgemeinen Gewichten: Kopplung = Eintrag $Q_{ij} \neq 0$ mit $i \neq j$.
Rechnung: [`encodings/resources.py`](../encodings/resources.py), `POST /api/runs/<run_id>/ressourcen` mit `"kurz": true`.
Beispiel Lauf 22.10., #1–#4, R61–R63 (IA-Fall T > R): IA One-Hot 12 | 30, Domain Wall 9 | 27, Binary 9 | 36; TA One-Hot 12 | 30, Domain Wall 8 | 28, Binary 12 | 66.

`resources.py` kann außerdem Varianten (IA mit Slack; TA mit Kapazität per Slack oder unbalanciert, Makespan), Skalierung, Fall-Landkarte und
den Verlauf über einen Lauf rechnen (Endpunkte unten, getestet in `tests/test_resources.py`). Die Karten haben den Button
*Trend over instance sizes* (Paper-Abbildung mit SVG-Download, Folge bis 18 Aufträge; feste y-Achsen – Qubits 0,8…500 und Kopplungen 0,8…10⁵ logarithmisch, Dichte 0…1,05 –, gleich für IA und TA und jede Reihe, `SIZE_YLIM` in `encodings/paper_figures.py`; Schalter *Largest mapped on hardware*: je Hardware eine Strich-Punkt-Linie für das größte abgebildete Problem – Qubits, Kopplungen, Dichte – aus `results/*.json`, Modell A für IA, B für TA) und den Modus *Nur Struktur* (T bis 18, R bis 9).

Direktlink: `#/kopplungen/instanz?auftraege=1,2,3,4&roboter=61,62,63` (`modus=alle` für belegte Roboter).

### Reiter 5 · Hardware

Ab welcher Instanzgröße lässt sich jede Kodierung auf heutige Quantenhardware abbilden? Der Reiter **liest nur** die gespeicherten Ergebnisse
`results/<hardware>.json` und rechnet nichts; erzeugt werden sie mit `python run_all.py --hardware advantage_pegasus` (Paket `hw/`, je Hardware ein
Modul mit `map_<hardware>(bqm, seed)`; fehlende Läufe werden nachgeholt, gespeichert wird nach jedem Lauf). Instanzen: Model A = IA, Model B = TA,
n = 4 … 18 Aufträge, Flotte m = n/2, jede Kodierung mit 10 Seeds; das Gitter steht einmal in `results/instances.json`.

Die Ansicht zeigt die Abbildung im Paper-Stil (eine Spalte je Hardware mit Ergebnissen, Zeilen Model A und B, SVG-Download), die Grenze je
Kodierung (größtes abgebildetes n, kleinstes nicht abgebildetes n), die Ergebnisse je Instanz und die Messbedingungen. Begriffe: *abgebildet* =
gültige Einbettung gefunden (Ebene 1, nicht „lösbar“); *nicht abgebildet* = die Heuristik hat in allen Seeds im Zeitlimit nichts gefunden
(kein Beweis); *Limit überschritten* = ein hartes Limit ist verletzt (sicher). Hardware (je ein Modul in `hw/`, Ergebnis `results/<name>.json`):
Advantage (Pegasus P16, idealer Graph, obere Schranke), Advantage2 (Zephyr Z12 mit 4800 Qubits – das gelieferte System hat 4400+),
Heron (FakeFez, 156 Qubits; alle Heron-Fakes haben dieselbe Kopplungskarte, die Gatterzahlen gelten für r2 wie r3), Nighthawk (FakeNighthawk,
120 Qubits, 218 Koppler, nur Topologie) und Helios (98 Qubits, all-to-all, nur gezählt; das native ZZ-Gatter ist nicht offiziell belegt). Gatterbasierte Hardware:
eine QAOA-Lage mit `optimization_level=3`, Messgröße Zwei-Qubit-Gatter; „abgebildet“ hängt dort nur an der Qubitzahl (hartes Limit). Quellen und
Abrufdatum stehen in `meta.sources` der Ergebnisdatei und im Reiter unter *Messbedingungen*. Die Trend-Abbildung des Reiters 4 zeichnet je Hardware
eine Referenzlinie (`hw.common.reach`); solange die Läufe einer Hardware unvollständig sind, steht „(partial)“ am Namen.

Direktlink: `#/hardware/abbildung`.

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
        ├── main.js     ← Router (#/daten, #/ia, #/ta + Ansicht), Laufauswahl
        ├── theme.js    ← Farben, Beschriftungen, Plotly-Grundeinstellungen
        ├── util.js     ← DOM-, Zahlen- und Tooltip-Helfer
        ├── components/ ← layoutMap.js (Fabrik-Karte), card.js (Karte + Tabellenansicht), scenario.js (Auftragsauswahl der Kodierungsseiten), iaScenario.js (Robotermenge und Fälle der IA-Seiten), workload.js (Pläne, Lastbalken, Pareto, Lastanteile der TA-Seiten)
        ├── qubo/       ← engine.js (Energie, alle Zustände per Gray-Code, Simulated Annealing), matrixView.js, graphView.js
        └── views/      ← Daten: overview, replay, matrix, charts, compare · IA: iaOnehot (+ iaOnehotFormula), iaDomainWall (+ iaDomainWallFormula), iaBinary (+ iaBinaryFormula) · TA: taWorkload (+ taWorkloadEncodings, taWorkloadFormula) · Qubits & Kopplungen: couplings · Hardware: hardware · TA-Archiv: onehot (+ onehotFormula, onehotCriterion), sequence (One-Hot + Reihenfolge), domainwall, binary, baukasten
```

**Datenfluss:** Der Browser holt einen Lauf einmal komplett als JSON (`GET /api/runs/<run_id>`, etwa 180 KB). Alle Filter, die Zeitreise und die Matrix rechnen danach im Browser. Die Zahlen stammen aus denselben Funktionen wie der PNG-Bericht, deshalb stimmen beide immer überein.

| Endpunkt | Inhalt |
| --- | --- |
| `GET /api/runs` | Kennzahlen aller Läufe |
| `GET /api/runs/<run_id>` | Aufträge, Flotten-Snapshots, Entitäten, Roboter, Auftrag×Roboter-Matrix, Befunde, Annahmen |
| `GET /api/runs/<run_id>/one-hot?tasks=1,2&variables=kandidaten&kriterium=leerfahrt&params={}` | Lern-Instanz mit Kosten nach Kriterium, One-Hot-Formulierung (Regeln und QUBO-Einträge mit symbolischen A, B), Katalog der Kriterien und Parameter |
| `GET /api/runs/<run_id>/ia/binary?tasks=1,2,3&robots=61,62,63&kriterium=fahrstrecke` | Sofortzuweisung mit Binary: wie `/ia/one-hot`, aber Codes je Auftrag (T ≤ R) bzw. je Roboter (T > R), Polynom je Termart, Hilfsbits (nur innerhalb eines Codes), QUBO-Einträge mit symbolischen A, B, D (= M), Empfehlung A, B, M, Vergleich mit One-Hot und Domain Wall (dieser Moment und `sizes` für T = 1 … 6) |
| `GET /api/runs/<run_id>/ia/domain-wall?tasks=1,2,3,4,5&robots=61,62&kriterium=fahrstrecke` | Sofortzuweisung mit Domain Wall: wie `/ia/one-hot`, aber Ketten je Auftrag (T ≤ R) bzw. je Roboter (T > R), `x_forms` (x je Variable als Differenz der Bits), Querregel, Empfehlung A = 3B, Vergleich mit One-Hot |
| `GET /api/runs/<run_id>/ia/one-hot?tasks=1,2,3&robots=61,62&kriterium=fahrstrecke&variables=kandidaten&params={}` | Sofortzuweisung: Instanz mit Robotermenge R (leer = alle freien) und Fall, One-Hot mit Spaltenregel (Regeln, QUBO-Einträge mit symbolischen A, B, Konstante je Termart), Empfehlung A = B, bester gültiger Plan, Anzahl gültiger Pläne, für jedes IA-Kriterium Spanne und bester Plan |
| `GET /api/runs/<run_id>/ta/one-hot?tasks=1,2,3,4&robots=61,62,63&last=zeit&anteile=anfahrt,lastfahrt&vorlast=status&variables=kandidaten&params={}` | TA mit Lastausgleich (auch `/ta/domain-wall`, `/ta/binary`): Instanz mit $c_{t,r}$ (Anteile) und Vorlast $L_{r,0}$ je Roboter, Formulierung (`x_polys` = x je Variable als Polynom der Bits, Polynom je Term, Hilfsbits, QUBO-Einträge mit symbolischen A, B, D = M), Empfehlung A, B, M samt Schranke `bound` (A als Funktion von B), Vergleich der drei Kodierungen, `sizes` für T = 1 … 6, Zahl der Pläne |
| `POST /api/runs/<run_id>/ressourcen` mit `{"cases": [{"cls": "TA", "encoding": "binary", "variant": "kap_slack", "vparams": {"kap": 2}, "tasks": [1, 2, 3], "robots": [61, 62]} …]}` (oder `"struktur": true, "T": 4, "R": 3`) | Kennzahlen je Fall (Qubits nach Typ, Kopplungen nach Herkunft, Dichte, Grad, Präzision; ohne `"kurz": true` auch gültige Zustände und Brute-Force-Prüfung); fehlerhafte Fälle liefern `error` |
| `POST /api/ressourcen/skalierung` mit `{"templates": [...], "axis": "T", "fixed": 3, "upto": 6}` | Kennzahlen je Vorlage über T bzw. R (nur Struktur, zwischengespeichert) |
| `POST /api/ressourcen/groessen` mit `{"cls": "IA" \| "TA", "ratio": "halb" \| "fest" \| "quadrat", "R": 3, "schwarzweiss": true, "hardware_limits": true}` | Verlauf über gemischte Instanzgrößen T × R bis T = 18 (halb: R = T/2, fest: R bleibt, quadrat: T = R), nach T·R sortiert, nur Struktur: Qubits, Hilfsbits, Kopplungen, Dichte je Kodierung (ohne Prüfung) und `svg` – die Abbildung im Paper-Stil (matplotlib, englisch beschriftet, Legende unten) und `limits` (größtes je Hardware abgebildetes Problem, als Referenzlinien in der Abbildung) |
| `GET /api/hardware` | Hardware-Abbildung je Hardware mit Ergebnissen: Metadaten, Fortschritt, Zeilen je Instanz, Grenze je (Modell, Kodierung) – nur aus `results/*.json` |
| `GET /api/hardware/abbildung?hardware=advantage_pegasus&schwarzweiss=true` | `{"svg": …}`: Abbildung aus den gespeicherten Ergebnissen, eine Spalte je Hardware (leer = alle) |
| `GET /api/ressourcen/landkarte?ia=paar&ta=wb` | Fall-Landkarte T × R = 1 … 6, alle Kodierungen für IA und TA |
| `POST /api/runs/<run_id>/ressourcen/verlauf` mit `{"templates": [...], "schnitt": "fenster" \| "offen", "fenster": 60, "roboter": "frei" \| "alle"}` | je Anfrage T, R und die Kennzahlen je Vorlage |
| `GET /api/ressourcen/katalog` | Klassen, Kodierungen, Varianten |
| `GET /api/runs/<run_id>/reihenfolge?tasks=1,2,3&plaetze=2&kriterium=erledigungszeit&variables=kandidaten&params={}` | Instanz mit Anfahrten, Formulierung mit Platz-Hilfsvariablen (symbolische A, B, D), Standardgewichte, exaktes Optimum (mit und ohne Platzgrenze, Sofortzuweisung), Hilfsvariablen-Vergleich |
| `GET /api/runs/<run_id>/domain-wall?tasks=1,2&kriterium=leerfahrt&reihenfolge=nummer&variables=kandidaten&params={}` | Lern-Instanz wie bei One-Hot, Domain-Wall-Formulierung (Ketten, Bits, Regeln, QUBO-Einträge mit symbolischen A, B, Konstante je Termart), Standardgewichte, beste gültige Zuweisung, One-Hot-Vergleich |
| `GET /api/runs/<run_id>/binary?tasks=1,2&kriterium=leerfahrt&reihenfolge=nummer&variables=kandidaten&params={}` | Binary-Formulierung: Codes, Polynom je Termart (vor den Hilfsbits), Hilfsbits, QUBO-Einträge mit symbolischen A, B, D (= M), Standardgewichte, beste Zuweisung, Vergleich mit One-Hot und Domain Wall |
| `POST /api/runs/<run_id>/baukasten` mit `{"tasks": [1, 2], "plaetze": 2, "kriterium": "erledigungszeit", "kodierung": "binary" oder {"1": "one_hot", "2": "domain_wall"}, "reihenfolge": "nummer", "terms": [...] oder "preset": "standard"}` | Echtes Problem (Instanz, exaktes Optimum, die bis zu 4000 besten gültigen Pläne – zwischengespeichert) und die Formulierung: Bit-Blöcke je Auftrag, Hilfsbits, Regeln, QUBO-Einträge mit Beiträgen je Baustein, empfohlene Gewichte, Anforderungen samt Bedingungen der Kodierung |
| `GET /api/docs` | automatische API-Dokumentation |

## Tests

```powershell
python -m pytest tests
```

Die Tests prüfen unter anderem:

- Die Website-Formulierung reproduziert die Zahlen des One-Hot-Kapitels.
- Die Energie über die Regeln ist für jeden Zustand gleich der Energie über die QUBO-Matrix.
- Hardware-Abbildung (`tests/test_hw_instances.py`): Gitterexport = Zählung aus `resources.py`, isolierte Knoten, Gültigkeitsprüfung der Einbettung, Reiter liest nur `results/` (leer ohne Ergebnisse).
- Qubits & Kopplungen (`tests/test_resources.py`): Standardvarianten = Kodierungsseiten, Slack-Zahlen, unbalanciert mit K = 1 = Paarstrafe, gültige Zustände = Abzählen, Minimum gültig und optimal (IA, Lastausgleich, Kapazität, Makespan), Verlauf, Landkarte.
- TA mit Lastausgleich (`tests/test_ta_workload.py`): QUBO = Regeln in allen drei Kodierungen, Kopplungszahlen, Ausmultiplizieren von $H_{WB}$, Vorlast-Arten, und per Brute Force an echten Momenten ist das Minimum mit den empfohlenen Gewichten (B = 0, Empfehlung, dreifach) gültig und gleich dem besten Plan.
- Mit Reihenfolge ist die QUBO-Energie jedes gültigen Plans genau die Summe aus dem Ablaufplan, und das QUBO-Minimum ist das exakte Optimum.
- Die Voreinstellung „standard“ des Baukastens ergibt exakt die festen Formulierungen (One-Hot, Reihenfolge, Domain Wall, Binary mit denselben Hilfsbits). Für beliebige, auch unsinnige Bausteine auf gemischten Kodierungen stimmt das Ausmultiplizieren, und die empfohlenen Gewichte liefern in jeder Kodierung den besten Plan.

## Erweitern

- **Neue Ansicht im Reiter Daten:** Datei in `static/js/views/` mit `export function renderXyz(root, ctx)` anlegen und in `VIEWS` in `main.js` eintragen. `ctx` enthält `run`, `runs`, `params`, `selectRun`. Gibt die Funktion eine Aufräum-Funktion zurück (Timer, Tastatur), wird diese beim Verlassen der Ansicht aufgerufen.
- **Neuer Reiter (z.B. Kodierungen):** In `index.html` das `disabled`-Element durch einen Link ersetzen und in `main.js` eine eigene Ansichtsgruppe ergänzen.
- **Neue Daten vom Server:** in `data_service.py` dem Payload hinzufügen. Die Berechnung gehört nach `analysis/`, damit PNG-Bericht und Website gleich bleiben.

## Gestaltung

- **Farben** haben feste Rollen und sind identisch mit den PNG-Berichten: Bereiche, Roboter-Status, Blau für Größen, Orange für die Auswahl. Bereichs- und Statusfarben sind auf Farbfehlsichtigkeit geprüft.
- **Bewusst nur heller Modus:** Für einen dunklen Hintergrund besteht keine Kombination aus 5 Bereichsfarben die Prüfung. Ein Dunkelmodus bräuchte eine eigene Farbabstimmung.
- Jedes Diagramm hat Hover-Details und eine **Tabellenansicht** mit den Zahlen dahinter.
