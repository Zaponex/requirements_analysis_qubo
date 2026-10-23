// Reiter „Kodierungen“ › Domain Wall: dieselbe Zuweisung wie bei One-Hot, aber je Auftrag eine Kette aus
// R − 1 Bits (Thermometer). Die Wand – der Wechsel von 1 auf 0 – zeigt den Roboter.
// Formulierung: encodings/formulations.py (domain_wall) · Lesekapitel: encodings/domain_wall/README.md
import { el, fill, nf, withTip, tipHtml, escapeHtml } from '../util.js';
import { C, TERM_COLORS, plot, statusColor, statusLabel } from '../theme.js';
import { createLayoutMap } from '../components/layoutMap.js';
import { initialScenario, renderScenario, shortName } from '../components/scenario.js';
import { MAX_SEARCH_BITS, MAX_STORE_BITS, energy, fromMask, makeModel, rankOf, search, toMask } from '../qubo/engine.js';
import { createMatrixView } from '../qubo/matrixView.js';
import { createGraphView } from '../qubo/graphView.js';
import { createCriterionPanel, formulaHtml } from './onehotCriterion.js';
import { DW_DEFAULT_TAB, DW_FORMULA_TABS, createDwFormulaPanel, decodeChains } from './domainWallFormula.js';

const TERMS = ['kosten', 'kette', 'spalte'];
export const DW_LABELS = {
  kosten: 'Kosten (Teleskopsumme)',
  kette: 'Kettenregel: keine Wand 0 → 1',
  spalte: 'Spaltenregel: kein Roboter doppelt',
};
const SHORT = { kosten: 'Kosten', kette: 'Kettenregel', spalte: 'Spaltenregel' };
const STEPS = [
  { title: 'Szenario', terms: {} },
  { title: 'Ketten', terms: {} },
  { title: 'Kosten', terms: { kosten: true } },
  { title: 'Kettenregel', terms: { kosten: true, kette: true } },
  { title: 'Spaltenregel', terms: { kosten: true, kette: true, spalte: true } },
  { title: 'QUBO & Hardware', terms: { kosten: true, kette: true, spalte: true } },
];
const ALL = { kosten: true, kette: true, spalte: true };
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (s) => String(s).replace(/\d/g, (d) => SUB[d]);
const fmtE = (v) => nf(v, 1).replace('-', '−');
const signed = (v) => (v < 0 ? `−${fmtE(-v)}` : `+${fmtE(v)}`);

export function renderDomainWall(root, { run, api, params }) {
  const tasks = run.tasks;
  const st = {
    step: Math.min(6, Math.max(1, Number(params.schritt) || 1)),
    showAll: false,
    ...initialScenario(tasks, params),
    mode: 'kandidaten',
    order: params.reihenfolge === 'kosten' ? 'kosten' : 'nummer',
    criterion: params.kriterium || 'leerfahrt',
    costParams: {},
    A: 100,
    B: 50,
    terms: {},
    data: null,
    x: new Uint8Array(0),
    model: null,
    result: null,
    resultKey: '',
    weightNote: '',
  };

  // ---------------------------------------------------------------- Gerüst
  const stepper = el('div', { class: 'stepper' });
  const explain = el('div', { class: 'explain' });
  const showAllBox = el('input', { type: 'checkbox', id: 'dw-all' });
  const scenarioBody = el('div');
  const mapHost = el('div');
  const boardHost = el('div');
  const quickHost = el('div', { class: 'quick' });
  const energyHost = el('div');
  const controlsHost = el('div');
  const rankHost = el('div');
  const stripHost = el('div', { class: 'chart short' });
  const matrixHost = el('div');
  const graphHost = el('div');
  const metricsHost = el('div');
  const formulaHost = el('div');
  const criterionHost = el('div');
  const section = (minStep, node) => { node.dataset.minStep = String(minStep); return node; };
  const cardEl = (title, sub2, ...body) => el('section', { class: 'card' },
    el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, title), sub2 ? el('div', { class: 'card-sub', html: sub2 }) : null)),
    ...body);

  root.append(el('p', {
    class: 'intro',
    html: `Dieselbe Aufgabe wie bei <a href="#/kodierungen/one-hot">One-Hot</a> – welcher Roboter übernimmt welchen Auftrag? –, aber anders
      in Bits übersetzt: Jeder Auftrag bekommt eine <b>Kette</b> aus <i>R</i> − 1 Bits wie ein Thermometer. Wo die Einsen in Nullen
      übergehen, steht die <b>Wand</b> – das ist der gewählte Roboter. Geh die Schritte der Reihe nach durch; alle Zahlen sind live.
      Die Lese-Version steht in <code>encodings/domain_wall/README.md</code>.`,
  }));
  root.append(el('section', { class: 'card guide' }, stepper,
    el('label', { class: 'filter-group', for: 'dw-all', style: { marginTop: '6px' } }, showAllBox, el('span', { class: 'hint' }, 'Alles auf einmal zeigen')),
    explain));

  const layout = el('div', { class: 'grid', style: { marginTop: '16px' } },
    el('div', { class: 'grid grid-2' },
      cardEl('Szenario: welche Aufträge?', 'Ein echter Moment aus der Simulation', scenarioBody),
      cardEl('Lage in der Fabrik', 'Roboter im Snapshot · <b>#</b> = Abholort · dunkle Linie = Roboter, auf den die Wand zeigt', mapHost)),
    section(2, el('div', { class: 'grid oh-main' },
      cardEl('Die Ketten', 'Je Auftrag: feste 1 · Bits · feste 0 · zwischen zwei Nachbarn steht ein Roboter · <b>grün</b> = Wand 1→0 (gewählt), <b>rot</b> = falsche Wand 0→1 · Klick schaltet ein Bit',
        quickHost, boardHost),
      section(3, cardEl('Energie dieses Zustands', 'Jeder Beitrag einzeln erklärt', controlsHost, energyHost)))),
    section(3, cardEl('Bewertungskriterium: Wonach bewertet das QUBO?', 'Dieselben Kosten c<sub>t,r</sub> wie bei One-Hot – bei Domain Wall landen ihre <b>Differenzen</b> auf der Diagonale', criterionHost)),
    section(3, cardEl('Die Formel dahinter', 'Wie die Domain-Wall-Formulierung wirkt – und wie die Zahlen eingesetzt werden · über Formelteile fahren hebt Bits hervor', formulaHost)),
    section(3, cardEl('Die günstigsten Zustände', 'Alle Bitstellungen durchprobiert und nach Energie sortiert · Zeile anklicken zum Laden', rankHost, stripHost)),
    section(6, el('div', { class: 'grid grid-2' },
      cardEl('QUBO-Matrix', 'Jede Zahl ist eine Summe aus Kosten, Ketten- und Spaltenregel · Hover erklärt · umrandet = zählt gerade', matrixHost),
      cardEl('Kopplungsgraph & Hardware-Bedarf', 'Knoten = Qubits (Zeile = Auftrag, Spalte = Position in der Kette), Linien = Kopplungen', graphHost, metricsHost))));
  root.append(layout);

  const map = createLayoutMap(mapHost, { entities: run.entities, robots: run.robots, entityLabels: false });
  let matrixView = null;
  let graphView = null;
  const formula = createDwFormulaPanel(formulaHost, {
    getState: () => ({ data: st.data, x: st.x, A: st.A, B: st.B, terms: st.terms, step: st.step, model: st.model }),
    highlight: (sel) => highlightBoard(sel),
    clearHighlight: () => highlightBoard(null),
    setWeight: (key, value) => { st[key] = value; update(); },
    describe: (x) => describeState(x),
  });
  if (DW_DEFAULT_TAB[st.step]) formula.setTab(DW_DEFAULT_TAB[st.step], false);
  if (DW_FORMULA_TABS.some((t) => t.key === params.formel)) formula.setTab(params.formel, false);
  const criterionPanel = createCriterionPanel(criterionHost, {
    getState: () => ({ data: st.data, weightNote: st.weightNote, selected: st.selected,
      diagonalHint: `Bei Domain Wall steht nicht <i>c</i><sub>t,r</sub> selbst auf der Diagonale, sondern die <b>Differenz zum nächsten Roboter der Kette</b>
        (Teleskopsumme): Q[<i>b</i><sub>t,k</sub>] = <i>c</i><sub>t,k+1</sub> − <i>c</i><sub>t,k</sub>; die Kosten des ersten Roboters werden zur Konstanten.` }),
    setCriterion: (key) => { st.criterion = key; load(); },
    setParam: (key, value) => { st.costParams = { ...st.costParams, [key]: value }; load(); },
    resetParams: () => { st.costParams = {}; load(); },
  });

  // ---------------------------------------------------------------- Szenario
  function drawScenario(error) {
    const snap = st.data ? st.data.instance.snapshot : null;
    const orderBox = el('div', { class: 'filter-group', style: { marginTop: '8px' } }, el('span', { class: 'filter-label' }, 'Roboter in der Kette'),
      ...[['nummer', 'nach Nummer (wie im Kapitel)'], ['kosten', 'nach Kosten – billigster zuerst']].map(([v, label]) => {
        const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(st.order === v) }, label);
        b.addEventListener('click', () => { st.order = v; load(); });
        return b;
      }));
    renderScenario(scenarioBody, {
      tasks, st, load, error, extra: orderBox,
      note: snap ? `Vereinfachung fürs Lernen: Alle gewählten Aufträge sehen die Flotte im Snapshot von Anfrage #${snap.transport_id} (t = ${nf(snap.time)} s).` : null,
    });
  }

  // ---------------------------------------------------------------- Daten laden
  async function load() {
    drawScenario();
    try {
      st.data = await api(`/api/runs/${encodeURIComponent(run.run_id)}/domain-wall?tasks=${st.selected.join(',')}&variables=${st.mode}`
        + `&kriterium=${encodeURIComponent(st.criterion)}&reihenfolge=${st.order}&params=${encodeURIComponent(JSON.stringify(st.costParams))}`);
    } catch (err) {
      drawScenario(`Konnte die Formulierung nicht laden: ${err.message}`);
      return;
    }
    const d = st.data;
    ({ A: st.A, B: st.B } = d.weights);
    st.weightNote = `Strafgewichte: B = 1,5 × größte Spannweite der Kosten (${fmtE(d.weights.spread)}) → ${nf(st.B)}, A = 2·B = ${nf(st.A)} (warum doppelt: siehe Schritt 5).`;
    const n = d.formulation.n;
    const prevX = st.x;
    st.x = new Uint8Array(n);
    if (prevX.length === n) st.x.set(prevX);
    st.resultKey = '';
    if (params.zustand && !st.initialStateApplied) {
      st.initialStateApplied = true;
      if (params.zustand === 'naechster') st.x = nearest();
      if (params.zustand === 'minimum') { compute(); st.x = Uint8Array.from(st.result.min.x); }
    }
    const f = d.formulation;
    matrixView = createMatrixView(matrixHost, { labels: f.bits.map((b, i) => bitLabel(i)), varName: bitLabel, describePart, onCellClick: flashBits });
    const maxPos = Math.max(1, ...f.bits.map((b) => b.pos));
    graphView = createGraphView(graphHost, {
      variables: f.bits.map((b) => ({ ...b, cost: diagCost(b.index), row: b.task_id, col: b.pos })),
      rowKeys: f.chains.map((c) => c.task_id), colKeys: Array.from({ length: maxPos }, (_, k) => k + 1),
      rowLabel: (t) => `#${t}`, colLabel: (k) => `b·${k}`, varName: bitLabel,
    });
    drawScenario();
    update();
  }

  // ---------------------------------------------------------------- Hilfen
  const form = () => st.data.formulation;
  const crit = () => st.data.instance.criterion;
  const unit = () => crit().unit;
  const taskOf = (id) => st.data.instance.tasks.find((t) => t.transport_id === id);
  const robotOf = (id) => st.data.instance.robots.find((r) => r.robot_id === id);
  const chainOf = (id) => form().chains.find((c) => c.task_id === id);
  function bitLabel(i) {
    const b = form().bits[i];
    return `b${sub(b.task_id)},${sub(b.pos)}`;
  }
  /** Kosten-Beitrag eines Bits auf der Diagonale: Differenz der Nachbarroboter (Teleskopsumme). */
  function diagCost(i) {
    const b = form().bits[i];
    const ch = chainOf(b.task_id);
    return ch.costs[b.pos] - ch.costs[b.pos - 1];
  }
  function describePart(p, A, B) {
    if (p.kind === 'kosten') return `Kosten #${p.task_id}: Wand wandert von R${p.left} zu R${p.right} → ${signed(p.c)} ${unit()}`;
    if (p.kind === 'kette') {
      return p.A > 0 ? `Kettenregel #${p.task_id}: eine 1 kostet +A = ${fmtE(A)} …` : `Kettenregel #${p.task_id}: … außer ihr linker Nachbar ist auch 1: −A = ${fmtE(-A)}`;
    }
    return `Spaltenregel R${p.robot_id} (#${p.tasks[0]}, #${p.tasks[1]}): ${p.B > 0 ? '+' : '−'}${Math.abs(p.B) === 1 ? '' : Math.abs(p.B)}B = ${fmtE(p.B * B)}`;
  }
  const decode = (x) => decodeChains(form(), x);
  function describeState(x) {
    const dec = decode(x);
    return dec.chains.map((c) => (c.valid ? `#${c.ch.task_id}→R${c.robot}` : `#${c.ch.task_id}: ${c.ch.robots.length ? '✗ Kette' : '–'}`)).join(' · ');
  }
  function violationText(i) { return i.text; }
  const isValid = (x) => decode(x).valid;
  /** Bits einer Kette so setzen, dass die Wand vor Roboter k steht: k Einsen, dann Nullen. */
  function setChain(x, ch, k) {
    ch.bits.forEach((i, pos) => { x[i] = pos < k ? 1 : 0; });
  }
  function nearest() {
    const x = new Uint8Array(form().n);
    for (const ch of form().chains) {
      if (!ch.robots.length) continue;
      let best = 0;
      ch.costs.forEach((c, k) => { if (c < ch.costs[best]) best = k; });
      setChain(x, ch, best);
    }
    return x;
  }

  // ---------------------------------------------------------------- Rechnen
  function compute() {
    const f = form();
    st.model = makeModel(f, { A: st.A, B: st.B, terms: st.terms });
    const key = `${st.A}|${st.B}|${TERMS.map((k) => (st.terms[k] ? 1 : 0)).join('')}|${f.n}|${st.selected}|${st.mode}|${st.order}|${st.criterion}|${JSON.stringify(st.costParams)}`;
    if (key !== st.resultKey) {
      const r = search(st.model, 12);
      st.result = r ? { min: { E: r.min.E, x: fromMask(r.min.mask, f.n) }, top: r.top, all: r.all, total: r.total } : null;
      st.resultKey = key;
    }
  }
  function minUnder(terms) {
    const m = makeModel(form(), { A: st.A, B: st.B, terms });
    const r = search(m, 1);
    return r ? { x: fromMask(r.min.mask, m.n), E: r.min.E } : null;
  }

  // ---------------------------------------------------------------- Zeichnen
  function update() {
    if (!st.data) return;
    compute();
    renderStepper();
    applyVisibility();
    renderExplain();
    renderMap();
    renderBoard();
    renderControls();
    renderEnergy();
    renderRanking();
    if (st.step >= 6 || st.showAll) {
      matrixView.update(st.model, st.x);
      graphView.update(st.model, st.x);
      renderMetrics();
    }
    if (st.step >= 3 || st.showAll) {
      criterionPanel.render();
      formula.render();
    }
  }

  function renderStepper() {
    stepper.replaceChildren(...STEPS.map((s, k) => {
      const b = el('button', { class: `step${st.step === k + 1 ? ' current' : ''}${st.step > k + 1 ? ' done' : ''}`, type: 'button' },
        el('span', { class: 'step-n' }, k + 1), s.title);
      b.addEventListener('click', () => goStep(k + 1));
      return b;
    }));
  }
  function goStep(k) {
    st.step = k;
    st.terms = st.showAll ? { ...ALL } : { ...STEPS[k - 1].terms };
    if (DW_DEFAULT_TAB[k]) formula.setTab(DW_DEFAULT_TAB[k], false);
    update();
  }
  function applyVisibility() {
    layout.querySelectorAll('[data-min-step]').forEach((n) => { n.hidden = !st.showAll && st.step < Number(n.dataset.minStep); });
    layout.querySelector('.oh-main').classList.toggle('single', !st.showAll && st.step < 3);
  }

  function renderExplain() {
    const d = st.data.instance;
    const f = form();
    const T = d.tasks.length;
    const free = d.robots.filter((r) => r.available);
    const perTask = f.chains.map((c) => `#${c.task_id}: ${c.robots.length} Roboter → ${Math.max(0, c.robots.length - 1)} Bits`).join(', ');
    const lonely = f.chains.filter((c) => c.robots.length === 1);
    const next = st.step < 6 ? ` <button class="btn small primary" type="button" data-next>Weiter: ${st.step + 1} · ${STEPS[st.step].title} →</button>` : '';
    const ohN = st.data.one_hot.n;
    let html = '';
    if (st.step === 1) {
      html = `Im gewählten Moment liegen <b>${T} Auftrag${T === 1 ? '' : 'e'}</b> vor (${d.tasks.map((t) => `#${t.transport_id}`).join(', ')}),
        <b>${free.length} von ${d.robots.length} Robotern sind frei</b>. Die Frage ist dieselbe wie bei One-Hot:
        <b>Welcher Roboter übernimmt welchen Auftrag, damit ${escapeHtml(crit().goal)}?</b> Neu ist nur, <b>wie</b> wir die Antwort in Bits schreiben.
        ${T > free.length ? '<br><span class="warnline">⚠ Mehr Aufträge als freie Roboter – bei Domain Wall wird das besonders interessant (Schritt 5).</span>' : ''}`;
    } else if (st.step === 2) {
      html = `Jeder Auftrag bekommt eine <b>Kette</b>: links eine feste 1, rechts eine feste 0, dazwischen <i>R</i> − 1 Bits. Zwischen zwei Nachbarn
        steht jeweils ein Roboter. Irgendwo muss die Kette von 1 auf 0 wechseln – diese <b>Wand</b> zeigt den gewählten Roboter (grün).
        Hier: ${perTask} → <b>${f.n} Bits</b> (One-Hot: ${ohN}). „Alle aus“ ist schon gültig: jeder nimmt den ersten Roboter seiner Kette.
        Klick Bits an: <code>110</code> heißt dritter Roboter; <code>010</code> hat drei Wände (rot = falsch herum) – ungültig.
        Und: <b>„niemand“ oder „zwei Roboter“ lassen sich gar nicht ausdrücken</b> – jede gültige Kette ist genau ein Roboter.
        ${lonely.length ? `<br>${lonely.map((c) => `#${c.task_id}`).join(', ')} hat nur einen möglichen Roboter: 0 Bits, die Antwort steht fest.` : ''}
        ${f.unrepresentable.length ? `<br><span class="warnline">⚠ ${f.unrepresentable.map((t) => `#${t}`).join(', ')}: kein Roboter frei – Domain Wall kann diesen Auftrag gar nicht darstellen (One-Hot: Zeilenregel kostet immer A).</span>` : ''}`;
    } else if (st.step === 3) {
      const m = minUnder({ kosten: true });
      const dec = m ? decode(m.x) : null;
      const sortedOk = st.order === 'kosten';
      html = `Wie bei One-Hot zahlt jede Zuweisung ihre Kosten <i>c</i><sub>t,r</sub> (${escapeHtml(crit().label)}: ${formulaHtml(crit().formula)}).
        Der Roboter an der Wand wird mit <b>δ</b> = (linker Nachbar) − (rechter Nachbar) ausgewählt – das ist 1 genau an der Wand.
        In Σ <i>c</i>·δ hebt sich fast alles auf (Teleskopsumme): Es bleiben die <b>Kosten des ersten Roboters als Konstante</b> und je Bit die
        <b>Differenz zum nächsten Roboter</b> – die kleine Zahl im Bit. Jedes Bit, das auf 1 springt, schiebt die Wand einen Roboter weiter.
        Nur mit Kosten ist das Minimum <b>${m ? describeState(m.x) : '–'}</b> (E = ${m ? fmtE(m.E) : '–'}).
        ${dec && !dec.valid ? `<br><span class="warnline">⚠ Ungültige Ketten bekommen „Phantasiewerte“ aus der Formel – hier ist eine davon sogar das Minimum. Wir brauchen eine Regel.</span>`
    : `<br>Zufällig gültig${sortedOk ? ' – kein Zufall bei Sortierung nach Kosten: alle Differenzen sind ≥ 0, also ist „alle aus“ (jeder seinen billigsten) das Minimum' : ' – das ist Glück, kein Prinzip (Gegenbeispiel im Lesekapitel, Schritt 6)'}.
          ${dec && dec.issues.some((i) => i.kind === 'spalte') ? ' Aber zwei Aufträge teilen sich einen Roboter.' : ''}`}`;
    } else if (st.step === 4) {
      const m = minUnder({ kosten: true, kette: true });
      const dec = m ? decode(m.x) : null;
      const dbl = dec ? dec.issues.filter((i) => i.kind === 'spalte') : [];
      html = `Regel 1: <b>Keine Wand der falschen Art.</b> Eine 1 rechts von einer 0 (0 → 1, rot) kostet <b>A·<i>b</i><sub>i+1</sub>(1 − <i>b</i><sub>i</sub>)</b>.
        Weil der linke und rechte Rand fest sind, bringt jede falsche Wand eine weitere echte mit – ohne falsche Wand gibt es genau eine Wand, also genau einen Roboter.
        Die Regel verbindet <b>nur direkte Nachbarn</b>: eine Kette statt der Clique von One-Hot.
        Mit A = ${nf(st.A)} ist das Minimum <b>${m ? describeState(m.x) : '–'}</b> (E = ${m ? fmtE(m.E) : '–'}).
        Faustregel: A größer als die Spannweite der Kosten eines Auftrags (hier ${fmtE(st.data.weights.spread)}).
        ${dbl.length ? `<br><span class="warnline">⚠ Aber: ${dbl.map((i) => i.text).join(', ')} – das verbietet noch niemand. Weiter zur Spaltenregel.</span>` : ''}`;
    } else if (st.step === 5) {
      const m = minUnder(ALL);
      const g = nearest();
      const gv = decode(g).issues.filter((i) => i.kind === 'spalte');
      const dec = m ? decode(m.x) : null;
      const best = st.data.best;
      const opt = dec && dec.valid && best && Math.abs(m.E - best.value) < 1e-6;
      html = `Regel 2: <b>Kein Roboter fährt zwei Aufträge.</b> Für jedes Paar von Aufträgen, die denselben Roboter in ihrer Kette haben, gibt es
        <b>B·δ·δ′</b> – nur 1, wenn beide Wände vor diesem Roboter stehen. Weil jedes δ linear ist (Differenz zweier Bits), bleibt das Produkt quadratisch.
        ${gv.length ? `„Jeder nimmt den nächsten“ (${describeState(g)}) verletzt das: ${gv.map(violationText).join(', ')}.` : ''}
        Mit A = ${nf(st.A)}, B = ${nf(st.B)} ist das Minimum <b>${m ? describeState(m.x) : '–'}</b> (E = ${m ? fmtE(m.E) : '–'})
        ${opt ? '<span class="okline">✓ die beste gültige Zuweisung.</span>' : dec && !dec.valid ? `<span class="warnline">✗ ${dec.issues.map(violationText).join(', ')}</span>` : ''}
        <br><b>Feinheit:</b> An einer falschen Wand ist δ = −1. Dann wird B·δ·δ′ negativ – aus der Strafe wird eine Belohnung. Deshalb muss die Kettenregel
        die Spaltenregel überstimmen: <b>A = 2·B</b>. Mit A = B war das Minimum in rund 40 % der geprüften echten Momente unzulässig (Test in <code>tests/test_domain_wall.py</code>) –
        probier es mit dem A-Regler aus.
        ${!best ? '<br><span class="warnline">Es gibt keine gültige Zuweisung: Domain Wall kann keinen Auftrag liegen lassen – irgendein Roboter muss doppelt fahren oder eine Kette bricht.</span>' : ''}`;
    } else {
      const mc = metrics();
      html = `Ausmultipliziert ist das eine <b>QUBO-Matrix</b> mit <b>${mc.n} Variablen</b> und <b>${mc.couplings} Kopplungen</b>
        (${mc.chain} aus Ketten, ${mc.col} aus der Spaltenregel). One-Hot braucht für dieselben Aufträge ${st.data.one_hot.n} Variablen und ${st.data.one_hot.couplings} Kopplungen.
        Die Ketten sind sehr hardwarefreundlich – aber zwei Ketten, die um dieselben Roboter konkurrieren, brauchen <b>3R − 5</b> Kopplungen (One-Hot nur R).
        Unten steht, ab wie vielen Aufträgen Domain Wall deshalb <b>mehr</b> Kopplungen braucht als One-Hot.`;
    }
    explain.innerHTML = `<div class="explain-title">Schritt ${st.step} · ${STEPS[st.step - 1].title}</div><div>${html}</div>${next ? `<div style="margin-top:8px">${next}</div>` : ''}`;
    const nb = explain.querySelector('[data-next]');
    if (nb) nb.addEventListener('click', () => goStep(st.step + 1));
  }

  function renderMap() {
    const d = st.data.instance;
    const dec = decode(st.x);
    map.setRobots(d.robots.map((r) => ({ ...r, dim: st.mode === 'kandidaten' && !r.available })));
    map.setHalos(d.tasks.map((t) => ({ ...t.pickup, color: C.accent })));
    map.setLabels(d.tasks.map((t) => ({ ...t.pickup, text: `#${t.transport_id}`, color: C.accent })));
    map.setArrows(d.tasks.map((t) => ({ from: t.pickup, to: t.drop, color: C.accent, width: 1.6, opacity: 0.6,
      tip: tipHtml(`Auftrag #${t.transport_id}`, [`${escapeHtml(t.from_entity)} → ${escapeHtml(t.to_entity)}`]) })));
    map.setLines(dec.chains.filter((c) => c.valid).map((c) => {
      const r = robotOf(c.robot);
      return { from: { x: r.x, y: r.y }, to: taskOf(c.ch.task_id).pickup, label: nf(c.cost, 1), color: C.ink, opacity: 1 };
    }));
  }

  // ---------------------------------------------------------------- Ketten (Schachbrett)
  function renderBoard() {
    const dec = decode(st.x);
    const showCost = st.step >= 3 || st.showAll;
    const rows = dec.chains.map((c) => {
      const t = taskOf(c.ch.task_id);
      const head = el('div', { class: 'dw-head', 'data-task': t.transport_id }, el('div', {}, el('strong', {}, `#${t.transport_id}`)),
        el('div', { class: 'hint' }, `${shortName(t.from_entity)} → ${shortName(t.to_entity)}`));
      if (!c.ch.robots.length) {
        return el('div', { class: 'dw-row' }, head, el('div', { class: 'hint' }, 'kein Roboter frei – in Domain Wall nicht darstellbar'), el('div', { class: 'dw-result bad' }, '✗'));
      }
      const parts = [el('span', { class: 'dw-fixed' }, '1')];
      c.ch.robots.forEach((r, k) => {
        const dlt = c.b[k] - c.b[k + 1];
        const robot = robotOf(r);
        parts.push(withTip(el('span', { class: `dw-gap${dlt === 1 ? ' wall' : dlt === -1 ? ' wall bad' : ''}`, 'data-robot': r, 'data-task': t.transport_id, 'data-gap': k },
          el('span', { class: 'dw-robot' }, `R${r}`),
          showCost ? el('span', { class: 'dw-cost' }, nf(c.ch.costs[k], 1)) : null,
          el('span', { class: 'dw-delta' }, `δ = ${dlt < 0 ? '−1' : dlt}`)),
        tipHtml(`R${r} für #${t.transport_id}`, [`δ = ${k === 0 ? '1' : sub(`b${k}`)} − ${k === c.ch.robots.length - 1 ? '0' : `b${sub(k + 1)}`} = ${dlt}`,
          dlt === 1 ? '<b>Wand 1 → 0: dieser Roboter ist gewählt</b>' : dlt === -1 ? '<b>falsche Wand 0 → 1</b>' : 'keine Wand',
          `Kosten c = ${fmtE(c.ch.costs[k])} ${unit()}`, robot ? `${statusLabel(robot.status)}${robot.available ? '' : ' (belegt)'}` : null])));
        if (k < c.ch.bits.length) {
          const i = c.ch.bits[k];
          const b = el('button', { class: `cell dw-bit switch${st.x[i] ? ' on' : ''}`, type: 'button', 'data-var': i, 'data-task': t.transport_id,
            'aria-pressed': String(Boolean(st.x[i])), 'aria-label': `${bitLabel(i)} umschalten` },
          el('span', { class: 'bit' }, st.x[i] ? '1' : '0'),
          el('span', { class: 'var' }, bitLabel(i)),
          showCost ? el('span', { class: 'cost' }, signed(diagCost(i))) : null);
          withTip(b, () => tipHtml(`${bitLabel(i)} – zwischen R${c.ch.robots[k]} und R${c.ch.robots[k + 1]}`,
            [`1 schiebt die Wand von R${c.ch.robots[k]} weiter zu R${c.ch.robots[k + 1]}: Kosten ${signed(diagCost(i))} ${unit()}`]));
          b.addEventListener('click', () => { st.x[i] = st.x[i] ? 0 : 1; update(); });
          parts.push(b);
        }
      });
      parts.push(el('span', { class: 'dw-fixed zero' }, '0'));
      const result = c.valid
        ? el('div', { class: 'dw-result good' }, `→ R${c.robot}`, showCost ? el('span', { class: 'hint' }, ` (${fmtE(c.cost)})`) : null)
        : el('div', { class: 'dw-result bad' }, `✗ ${c.down.length + c.up.length} Wände`);
      return el('div', { class: 'dw-row' }, head, el('div', { class: 'dw-chain' }, parts), result);
    });
    const robots = st.data.instance.robots.filter((r) => form().chains.some((c) => c.robots.includes(r.robot_id)));
    const usage = el('div', { class: 'dw-usage' }, el('span', { class: 'filter-label' }, 'Σ je Roboter'),
      robots.map((r) => {
        const n = (dec.used.get(r.robot_id) || []).length;
        return el('span', { class: `sum col-sum ${n <= 1 ? 'good' : 'bad'}`, 'data-robot': r.robot_id },
          el('span', { class: 'dot-inline', style: { background: statusColor(r.status) } }), ` R${r.robot_id}: ${n} ${n <= 1 ? '✓' : '✗'}`);
      }));
    fill(boardHost, el('div', { class: 'dw-board' }, rows), usage);

    fill(quickHost,
      el('button', { class: 'btn small', type: 'button', title: 'Alle Bits 0: jeder Auftrag nimmt den ersten Roboter seiner Kette',
        onclick: () => { st.x = new Uint8Array(form().n); update(); } }, 'Alle aus'),
      el('button', { class: 'btn small', type: 'button', title: 'Jede Kette zeigt auf den Roboter mit den kleinsten Kosten', onclick: () => { st.x = nearest(); update(); } }, 'Jeder nimmt den nächsten'),
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = Uint8Array.from(form().bits, () => (Math.random() < 0.5 ? 1 : 0)); update(); } }, 'Zufall'),
      st.step >= 3 || st.showAll
        ? el('button', { class: 'btn small primary', type: 'button', disabled: !st.result, onclick: () => { st.x = Uint8Array.from(st.result.min.x); update(); } }, 'Minimum laden')
        : null,
      el('a', { class: 'btn small', href: `#/kodierungen/one-hot?auftraege=${st.selected.join(',')}&kriterium=${st.criterion}&schritt=${st.step}`,
        title: 'Dieselben Aufträge mit One-Hot' }, 'Vergleich: One-Hot →'));
  }

  function renderControls() {
    const toggles = el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Regeln'),
      TERMS.map((k) => {
        const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(Boolean(st.terms[k])), title: DW_LABELS[k] },
          el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }), SHORT[k]);
        b.addEventListener('click', () => { st.terms[k] = !st.terms[k]; update(); });
        return b;
      }));
    const max = Math.max(200, 4 * st.data.weights.A, st.A, st.B);
    const slider = (name, key, color, minStep) => {
      if (!(st.step >= minStep || st.showAll)) return null;
      const input = el('input', { type: 'range', min: 0, max, step: 1, value: st[key], 'aria-label': name });
      const val = el('strong', { style: { color } }, nf(st[key]));
      input.addEventListener('input', () => { st[key] = Number(input.value); val.textContent = nf(st[key]); scheduleUpdate(); });
      return el('div', { class: 'slider-row' }, el('span', { class: 'filter-label', style: { minWidth: '150px' } }, name), input, val);
    };
    fill(controlsHost, toggles,
      slider('Strafgewicht A (Kette)', 'A', TERM_COLORS.kette, 4),
      slider('Strafgewicht B (Spalte)', 'B', TERM_COLORS.spalte, 5),
      st.step >= 4 || st.showAll ? el('p', { class: 'hint' }, st.weightNote) : null);
  }
  let pending = null;
  function scheduleUpdate() { clearTimeout(pending); pending = setTimeout(update, 60); }

  function renderEnergy() {
    if (!(st.step >= 3 || st.showAll)) return;
    const dec = decode(st.x);
    const parts = { kosten: [], kette: [], spalte: [] };
    for (const c of dec.chains) {
      if (!c.ch.robots.length) continue;
      const value = c.ch.costs.reduce((s, cost, k) => s + cost * (c.b[k] - c.b[k + 1]), 0);
      if (c.valid) parts.kosten.push({ v: value, text: `#${c.ch.task_id} → R${c.robot}: ${fmtE(value)} ${unit()}` });
      else {
        const terms = c.ch.costs.map((cost, k) => [cost, c.b[k] - c.b[k + 1]]).filter(([, dl]) => dl !== 0);
        parts.kosten.push({ v: value, ok: false, text: `#${c.ch.task_id}: ungültige Kette → Phantasiewert ${terms.map(([cost, dl]) => `${dl < 0 ? '−' : ''}${fmtE(cost)}`).join(' + ').replace('+ −', '− ')} = ${fmtE(value)}` });
      }
      c.ch.bits.slice(1).forEach((i, k) => {
        const left = c.ch.bits[k];
        if (st.x[i] && !st.x[left]) parts.kette.push({ v: st.A, ok: false, text: `#${c.ch.task_id}: ${bitLabel(left)} = 0, ${bitLabel(i)} = 1 → falsche Wand: A = ${fmtE(st.A)}` });
      });
    }
    for (const r of form().rules.filter((rr) => rr.kind === 'spalte')) {
      const lin = (e) => e.const + Object.entries(e.terms).reduce((s, [i, c]) => s + c * st.x[Number(i)], 0);
      const d1 = lin(r.deltas[0]);
      const d2 = lin(r.deltas[1]);
      if (d1 * d2 === 0) continue;
      parts.spalte.push({ v: st.B * d1 * d2, ok: d1 * d2 < 0 ? undefined : false,
        text: `R${r.robot_id}: #${r.tasks[0]} und #${r.tasks[1]} → δ·δ′ = ${d1}·${d2} → ${fmtE(st.B * d1 * d2)}${d1 * d2 < 0 ? ' (Belohnung an falscher Wand!)' : ''}` });
    }
    const sums = Object.fromEntries(TERMS.map((k) => [k, st.terms[k] ? parts[k].reduce((s, p) => s + p.v, 0) : 0]));
    const E = TERMS.reduce((s, k) => s + sums[k], 0);
    const Eq = energy(st.model, st.x);
    const rank = st.result ? rankOf(st.result, toMask(st.x)) : null;
    const bar = el('div', { class: 'ebar' }, TERMS.filter((k) => sums[k] > 0).map((k) => withTip(
      el('div', { style: { flex: `${sums[k]} 0 0`, background: TERM_COLORS[k] } }), tipHtml(DW_LABELS[k], [fmtE(sums[k])]))));
    const empty = { kosten: 'keine Kette', kette: 'keine falsche Wand ✓', spalte: 'kein Roboter doppelt ✓' };
    const group = (k) => el('div', { class: `egroup${st.terms[k] ? '' : ' off'}` },
      el('div', { class: 'egroup-head' }, el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }),
        el('span', {}, k === 'kosten' ? `Kosten: ${crit().label} [${unit()}]` : DW_LABELS[k]), el('strong', {}, st.terms[k] ? fmtE(sums[k]) : 'aus')),
      parts[k].length ? el('ul', {}, parts[k].map((p) => el('li', { class: p.ok === false ? 'bad' : '' }, p.text))) : el('div', { class: 'hint' }, empty[k]));
    fill(energyHost,
      el('div', { class: 'etotal' },
        el('div', {}, el('div', { class: 'hint' }, 'Energie E'), el('div', { class: 'ebig' }, fmtE(E))),
        el('div', { class: 'erank' },
          rank ? el('div', {}, `Platz ${nf(rank)} von ${nf(st.result.total)}`) : null,
          el('div', { class: dec.valid ? 'okline' : 'warnline' }, dec.valid ? '✓ gültige Zuweisung' : `✗ ${dec.issues.map(violationText).join(' · ')}`))),
      bar, ...TERMS.map(group),
      el('p', { class: 'hint' }, `Probe über die Matrix: xᵀQx + Konstante = ${fmtE(Eq)} ${Math.abs(Eq - E) < 1e-6 ? '✓ identisch' : '✗ ABWEICHUNG'}`));
  }

  function renderRanking() {
    if (!(st.step >= 3 || st.showAll)) return;
    const n = form().n;
    if (!st.result) {
      rankHost.replaceChildren(el('p', { class: 'hint' }, `${n} Bits = ${nf(2 ** n)} Stellungen – zu viele zum Durchprobieren im Browser (Grenze: ${MAX_SEARCH_BITS}).`));
      Plotly.purge(stripHost);
      return;
    }
    const cur = toMask(st.x);
    rankHost.replaceChildren(el('div', { class: 'table-scroll' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'Platz'), el('th', { class: 'num' }, 'Energie'), el('th', {}, 'Zuweisung'), el('th', {}, 'Regeln'))),
      el('tbody', {}, st.result.top.map((r, k) => {
        const x = fromMask(r.mask, n);
        const dec = decode(x);
        const tr = el('tr', { class: `clickable${r.mask === cur ? ' selected' : ''}` },
          el('td', { class: 'num' }, k + 1), el('td', { class: 'num' }, fmtE(r.E)), el('td', {}, describeState(x)),
          el('td', { class: dec.valid ? 'ok' : 'no' }, dec.valid ? '✓ gültig' : `✗ ${dec.issues.map(violationText).join(' · ')}`));
        tr.addEventListener('click', () => { st.x = x; update(); });
        return tr;
      })))));
    if (st.result.all && n <= MAX_STORE_BITS) {
      const all = st.result.all;
      const order = Array.from(all.keys()).sort((a, b) => all[a] - all[b]);
      const valid = order.map((m) => isValid(fromMask(m, n)));
      const curRank = order.indexOf(cur);
      stripHost.style.minHeight = '';
      if (stripHost.querySelector('p')) stripHost.replaceChildren();
      plot(stripHost, [
        { type: 'scattergl', mode: 'markers', x: order.map((_, k) => k + 1), y: order.map((m) => all[m]),
          marker: { size: n > 12 ? 3 : 6, color: valid.map((ok) => (ok ? C.series : C.axis)) }, customdata: order,
          hovertemplate: 'Platz %{x}: E = %{y}<extra></extra>', name: 'Zustände' },
        { type: 'scatter', mode: 'markers', x: [curRank + 1], y: [all[cur]], marker: { size: 14, color: C.accent, line: { color: C.surface, width: 2 } },
          hovertemplate: 'dein Zustand: Platz %{x}, E = %{y}<extra></extra>', name: 'dein Zustand' },
      ], {
        showlegend: false, margin: { l: 56, r: 10, t: 30, b: 44 },
        xaxis: { title: { text: `Platz (alle ${nf(all.length)} Zustände, nach Energie sortiert)` } }, yaxis: { title: { text: 'Energie' } },
        annotations: [{ xref: 'paper', yref: 'paper', x: 0, y: 1.06, xanchor: 'left', showarrow: false,
          text: `<span style="color:${C.series}">●</span> gültig  <span style="color:${C.axis}">●</span> ungültig  <span style="color:${C.accent}">●</span> dein Zustand · Klick lädt einen Zustand`, font: { color: C.ink2 } }],
      });
      stripHost.removeAllListeners?.('plotly_click');
      stripHost.on('plotly_click', (ev) => {
        const p = ev.points && ev.points[0];
        if (p && p.customdata != null) { st.x = fromMask(p.customdata, n); update(); }
      });
    } else {
      Plotly.purge(stripHost);
      stripHost.style.minHeight = '0';
      stripHost.replaceChildren(el('p', { class: 'hint' }, `Die Energie-Treppe wird bis ${MAX_STORE_BITS} Bits gezeigt.`));
    }
  }

  function metrics() {
    const offs = st.model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const chain = offs.filter((e) => e.activeParts.some((p) => p.kind === 'kette')).length;
    const col = offs.filter((e) => e.activeParts.some((p) => p.kind === 'spalte') && !e.activeParts.some((p) => p.kind === 'kette')).length;
    const coefs = st.model.entries.filter((e) => e.activeParts.length).map((e) => Math.abs(e.value));
    return { n: form().n, couplings: offs.length, chain, col, maxCoef: coefs.length ? Math.max(...coefs) : 0 };
  }

  function renderMetrics() {
    const mc = metrics();
    const oh = st.data.one_hot;
    const R = Math.max(1, ...form().chains.map((c) => c.robots.length));
    const T = form().chains.length;
    const rows = Array.from({ length: 8 }, (_, k) => k + 1).map((t) => {
      const pairs = (t * (t - 1)) / 2;
      const dw = t * Math.max(0, R - 2) + pairs * Math.max(0, 3 * R - 5);
      const ohc = (t * R * (R - 1)) / 2 + R * pairs;
      return el('tr', { class: t === T ? 'selected' : '' }, el('td', { class: 'num' }, t),
        el('td', { class: 'num' }, `${t * (R - 1)} / ${dw}`), el('td', { class: 'num' }, `${t * R} / ${ohc}`),
        el('td', { class: dw < ohc ? 'ok' : 'no' }, dw < ohc ? 'Domain Wall sparsamer' : dw === ohc ? 'gleich' : 'One-Hot sparsamer'));
    });
    fill(metricsHost,
      el('div', { class: 'kpis', style: { marginTop: '10px' } },
        kpiSmall('Variablen (Qubits)', nf(mc.n), `One-Hot: ${nf(oh.n)} – ein Bit weniger je Auftrag`),
        kpiSmall('Kopplungen', nf(mc.couplings), `${mc.chain} Kette · ${mc.col} Spalte · One-Hot: ${nf(oh.couplings)}`),
        kpiSmall('Größter |Koeffizient|', fmtE(mc.maxCoef), 'A = 2B treibt ihn hoch')),
      el('h4', {}, `Wann lohnt sich Domain Wall? – ${R} Roboter, alle Aufträge konkurrieren um alle`),
      el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'Aufträge T'), el('th', { class: 'num' }, 'Domain Wall: Bits / Kopplungen'),
          el('th', { class: 'num' }, 'One-Hot: Bits / Kopplungen'), el('th', {}, ''))),
        el('tbody', {}, rows)),
      el('p', { class: 'hint', html: `Domain Wall: <i>T</i>(<i>R</i> − 2) Kettenkopplungen + Paare·(3<i>R</i> − 5); One-Hot: <i>T</i>·<i>R</i>(<i>R</i> − 1)/2 + <i>R</i>·Paare.
        Die Kette spart je Auftrag, aber jedes konkurrierende Auftragspaar kostet bei Domain Wall 3<i>R</i> − 5 statt <i>R</i> Kopplungen.
        Mit Zuständigkeitsbereichen konkurrieren weniger Paare – dann verschiebt sich die Grenze. Hervorgehoben: dein Szenario (${T} Aufträge).` }),
      el('div', { class: 'legend' }, ['kette', 'spalte'].map((k) => el('span', { class: 'legend-item' },
        el('span', { class: 'swatch', style: { background: TERM_COLORS[k], height: '3px' } }), DW_LABELS[k]))));
  }

  /** Hebt Bits, Ketten oder Roboter hervor (von der Formel aus). */
  function highlightBoard(sel) {
    boardHost.querySelectorAll('.hl').forEach((n) => n.classList.remove('hl'));
    if (!sel) return;
    const q = [];
    (sel.vars || []).forEach((i) => q.push(`[data-var="${i}"]`));
    if (sel.task != null) q.push(`.dw-bit[data-task="${sel.task}"]`, `.dw-head[data-task="${sel.task}"]`);
    if (sel.robot != null) q.push(`.dw-gap[data-robot="${sel.robot}"]`, `.col-sum[data-robot="${sel.robot}"]`);
    if (sel.kind === 'kosten' || sel.all) q.push('.dw-bit');
    if (sel.kind === 'kette') q.push('.dw-gap.wall');
    if (sel.kind === 'spalte') q.push('.col-sum');
    if (q.length) boardHost.querySelectorAll(q.join(',')).forEach((n) => n.classList.add('hl'));
  }
  function flashBits(i, j) {
    for (const k of new Set([i, j])) {
      const b = boardHost.querySelector(`[data-var="${k}"]`);
      if (b) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
    }
  }

  showAllBox.addEventListener('change', () => {
    st.showAll = showAllBox.checked;
    st.terms = st.showAll ? { ...ALL } : { ...STEPS[st.step - 1].terms };
    update();
  });

  st.terms = { ...STEPS[st.step - 1].terms };
  load();
}

function kpiSmall(label, value, note) {
  return el('div', { class: 'kpi' }, el('div', { class: 'kpi-label' }, label), el('div', { class: 'kpi-value', style: { fontSize: '1.3rem' } }, value),
    el('div', { class: 'kpi-note' }, note));
}
