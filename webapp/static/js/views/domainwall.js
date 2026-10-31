// Reiter „Kodierungen“ › Domain Wall: dieselbe Zuweisung wie bei One-Hot, aber je Auftrag eine Kette aus
// R − 1 Bits (Thermometer). Die Wand – der Wechsel von 1 auf 0 – zeigt den Roboter.
// Formulierung: encodings/formulations.py (domain_wall) · Lesekapitel: encodings/domain_wall/README.md
import { el, fill, nf, withTip, tipHtml, escapeHtml } from '../util.js';
import { C, TERM_COLORS, plot, statusColor, statusLabel } from '../theme.js';
import { createLayoutMap } from '../components/layoutMap.js';
import { autoWeights, createWeightControls, weightsFromParams } from '../components/weightControls.js';
import { initialScenario, renderScenario, shortName } from '../components/scenario.js';
import { MAX_SEARCH_BITS, MAX_STORE_BITS, energy, fromMask, makeModel, rankOf, search, toMask } from '../qubo/engine.js';
import { createMatrixView } from '../qubo/matrixView.js';
import { createGraphView } from '../qubo/graphView.js';
import { createLandscape } from '../components/landscape.js';
import { createCriterionPanel, formulaHtml } from './onehotCriterion.js';
import { DW_DEFAULT_TAB, DW_FORMULA_TABS, createDwFormulaPanel, decodeChains } from './domainWallFormula.js';

const TERMS = ['kosten', 'kette']; // keine Spaltenregel: Doppelbelegung ist zulässig
export const DW_LABELS = {
  kosten: 'Kosten (Teleskopsumme)',
  kette: 'Kettenregel: keine Wand 0 → 1',
};
const SHORT = { kosten: 'Kosten', kette: 'Kettenregel' };
const STEPS = [
  { title: 'Szenario', terms: {} },
  { title: 'Ketten', terms: {} },
  { title: 'Kosten', terms: { kosten: true } },
  { title: 'Kettenregel', terms: { kosten: true, kette: true } },
  { title: 'QUBO & Hardware', terms: { kosten: true, kette: true } },
];
const ALL = { kosten: true, kette: true };
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (s) => String(s).replace(/\d/g, (d) => SUB[d]);
const fmtE = (v) => nf(v, 1).replace('-', '−');
const signed = (v) => (v < 0 ? `−${fmtE(-v)}` : `+${fmtE(v)}`);

export function renderDomainWall(root, { run, api, params }) {
  const tasks = run.tasks;
  const st = {
    step: Math.min(STEPS.length, Math.max(1, Number(params.schritt) || 1)),
    showAll: false,
    ...initialScenario(tasks, params),
    mode: 'kandidaten',
    order: params.reihenfolge === 'kosten' ? 'kosten' : 'nummer',
    criterion: params.kriterium || 'leerfahrt',
    costParams: {},
    A: 100,
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
  const togglesHost = el('div');
  const weightsHost = el('div');
  controlsHost.append(togglesHost, weightsHost);
  const linkedWeights = weightsFromParams(params, st, ['A']);
  let firstLoad = true;
  const weights = createWeightControls(weightsHost, { onChange: (key, value) => { st[key] = value; scheduleUpdate(); } });
  const rankHost = el('div');
  const stripHost = el('div', { class: 'chart short' });
  const matrixHost = el('div');
  const graphHost = el('div');
  const metricsHost = el('div');
  const formulaHost = el('div');
  const criterionHost = el('div');
  const normHost = el('div');
  const landHost = el('div');
  const section = (minStep, node) => { node.dataset.minStep = String(minStep); return node; };
  const cardEl = (title, sub2, ...body) => el('section', { class: 'card' },
    el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, title), sub2 ? el('div', { class: 'card-sub', html: sub2 }) : null)),
    ...body);

  root.append(el('p', {
    class: 'intro',
    html: `Dieselbe Aufgabe wie bei <a href="#/ta/one-hot">One-Hot</a>, anders in Bits: je Auftrag eine <b>Kette</b> aus <i>R</i> − 1 Bits
      wie ein Thermometer; die <b>Wand</b> (1 → 0) zeigt den gewählten Roboter. Lesekapitel: <code>encodings/domain_wall/README.md</code>.`,
  }));
  root.append(el('section', { class: 'card guide' }, stepper,
    el('label', { class: 'filter-group', for: 'dw-all', style: { marginTop: '6px' } }, showAllBox, el('span', { class: 'hint' }, 'Alles auf einmal zeigen')),
    explain));

  const layout = el('div', { class: 'grid', style: { marginTop: '16px' } },
    el('div', { class: 'grid grid-2' },
      cardEl('Szenario', 'Echter Moment der Simulation', scenarioBody),
      cardEl('Lage in der Fabrik', 'Roboter im Snapshot · <b>#</b> = Abholort · dunkle Linie = Roboter an der Wand', mapHost)),
    section(2, el('div', { class: 'grid oh-main' },
      cardEl('Die Ketten', 'Feste 1 · Bits · feste 0, zwischen Nachbarn ein Roboter · <b>grün</b> = Wand 1→0 (gewählt), <b>rot</b> = falsche Wand 0→1 · Klick schaltet',
        quickHost, boardHost),
      section(3, cardEl('Energie dieses Zustands', 'Jeder Beitrag einzeln', controlsHost, energyHost)))),
    section(3, el('div', { class: 'grid grid-2' },
      cardEl('QUBO-Matrix', 'Summe aus Kosten und Kettenregel · Hover erklärt · umrandet = zählt jetzt', matrixHost),
      cardEl('Kopplungsgraph & Hardware', 'Knoten = Qubits (Zeile = Auftrag, Spalte = Kettenposition), Linien = Kopplungen', graphHost, metricsHost))),
    section(3, el('div', { class: 'grid grid-2' },
      cardEl('Normierte QUBO-Matrix', 'Q / max|Q| · blau = Belohnung, rot = Strafe', normHost),
      cardEl('Energielandschaft', 'Alle Zustände als Fläche · Ziehen dreht, Scrollen zoomt', landHost))),
    section(3, cardEl('Bewertungskriterium', 'Kosten c<sub>t,r</sub> wie bei One-Hot – auf der Diagonale stehen ihre <b>Differenzen</b>', criterionHost)),
    section(3, cardEl('Die Formel dahinter', 'Hover über Formelteile hebt Bits hervor', formulaHost)),
    section(3, cardEl('Die günstigsten Zustände', 'Alle Stellungen nach Energie · Klick lädt', rankHost, stripHost)));
  root.append(layout);

  const map = createLayoutMap(mapHost, { entities: run.entities, robots: run.robots, entityLabels: false });
  const landscape = createLandscape(normHost, landHost);
  let matrixView = null;
  let graphView = null;
  const formula = createDwFormulaPanel(formulaHost, {
    getState: () => ({ data: st.data, x: st.x, A: st.A, B: 0, terms: st.terms, step: st.step, model: st.model }),
    highlight: (sel) => highlightBoard(sel),
    clearHighlight: () => highlightBoard(null),
    setWeight: (key, value) => { st[key] = value; update(); },
    describe: (x) => describeState(x),
  });
  if (DW_DEFAULT_TAB[st.step]) formula.setTab(DW_DEFAULT_TAB[st.step], false);
  if (DW_FORMULA_TABS.some((t) => t.key === params.formel)) formula.setTab(params.formel, false);
  const criterionPanel = createCriterionPanel(criterionHost, {
    getState: () => ({ data: st.data, weightNote: st.weightNote, selected: st.selected,
      diagonalHint: `Auf der Diagonale steht die <b>Differenz zum nächsten Roboter der Kette</b> (Teleskopsumme):
        Q[<i>b</i><sub>t,k</sub>] = <i>c</i><sub>t,k+1</sub> − <i>c</i><sub>t,k</sub>; die Kosten des ersten Roboters werden Konstante.` }),
    setCriterion: (key) => { st.criterion = key; load(); },
    setParam: (key, value) => { st.costParams = { ...st.costParams, [key]: value }; load(); },
    resetParams: () => { st.costParams = {}; load(); },
  });

  // ---------------------------------------------------------------- Szenario
  function drawScenario(error) {
    const snap = st.data ? st.data.instance.snapshot : null;
    const orderBox = el('div', { class: 'filter-group', style: { marginTop: '8px' } }, el('span', { class: 'filter-label' }, 'Roboter in der Kette'),
      ...[['nummer', 'nach Nummer (Kapitel)'], ['kosten', 'billigster zuerst']].map(([v, label]) => {
        const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(st.order === v) }, label);
        b.addEventListener('click', () => { st.order = v; load(); });
        return b;
      }));
    renderScenario(scenarioBody, {
      tasks, st, load, error, extra: orderBox,
      note: snap ? `Vereinfachung: Alle Aufträge sehen die Flotte von Anfrage #${snap.transport_id} (t = ${nf(snap.time)} s).` : null,
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
    // Empfohlene Gewichte übernehmen – außer per Link gesetzt oder Automatik aus
    if (!(firstLoad && linkedWeights) && autoWeights()) st.A = d.weights.A;
    firstLoad = false;
    st.weightNote = `Empfehlung: A = 1,5 × größte Kostenspannweite (${fmtE(d.weights.spread)}) → ${nf(d.weights.A)} – ein Kettenbruch spart höchstens die Spannweite.`;
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
    st.model = makeModel(f, { A: st.A, B: 0, terms: st.terms });
    const key = `${st.A}|${TERMS.map((k) => (st.terms[k] ? 1 : 0)).join('')}|${f.n}|${st.selected}|${st.mode}|${st.order}|${st.criterion}|${JSON.stringify(st.costParams)}`;
    if (key !== st.resultKey) {
      const r = search(st.model, 12);
      st.result = r ? { min: { E: r.min.E, x: fromMask(r.min.mask, f.n) }, top: r.top, all: r.all, total: r.total } : null;
      st.resultKey = key;
    }
  }
  function minUnder(terms) {
    const m = makeModel(form(), { A: st.A, B: 0, terms });
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
    if (st.step >= 3 || st.showAll) {
      matrixView.update(st.model, st.x);
      graphView.update(st.model, st.x);
      renderMetrics();
      landscape.update({ model: st.model, labels: form().bits.map((b, i) => bitLabel(i)), x: st.x, minX: st.result?.min.x, isValid, cacheKey: st.result });
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
    const next = st.step < STEPS.length ? ` <button class="btn small primary" type="button" data-next>Weiter: ${st.step + 1} · ${STEPS[st.step].title} →</button>` : '';
    const ohN = st.data.one_hot.n;
    let html = '';
    if (st.step === 1) {
      html = `<b>${T} Auftrag${T === 1 ? '' : 'e'}</b> (${d.tasks.map((t) => `#${t.transport_id}`).join(', ')}), <b>${free.length} von ${d.robots.length} Robotern frei</b>.
        Frage wie bei One-Hot: <b>Welcher Roboter übernimmt welchen Auftrag, damit ${escapeHtml(crit().goal)}?</b> Neu ist nur die Schreibweise in Bits.
        ${T > free.length ? '<br>Mehr Aufträge als freie Roboter – zulässig: Ein Roboter übernimmt dann mehrere.' : ''}`;
    } else if (st.step === 2) {
      html = `Je Auftrag eine <b>Kette</b>: feste 1, <i>R</i> − 1 Bits, feste 0; zwischen zwei Nachbarn steht ein Roboter. Der Wechsel 1 → 0, die <b>Wand</b>,
        zeigt den gewählten Roboter (grün). Hier ${perTask} → <b>${f.n} Bits</b> (One-Hot: ${ohN}). „Alle aus“ ist gültig: jeder nimmt seinen ersten Roboter.
        <code>110</code> = dritter Roboter; <code>010</code> hat drei Wände (rot = falsch herum) – ungültig.
        <b>„Niemand“ oder „zwei Roboter“ sind gar nicht darstellbar</b> – jede gültige Kette ist genau ein Roboter.
        ${lonely.length ? `<br>${lonely.map((c) => `#${c.task_id}`).join(', ')}: nur ein möglicher Roboter – 0 Bits, die Antwort steht fest.` : ''}
        ${f.unrepresentable.length ? `<br><span class="warnline">⚠ ${f.unrepresentable.map((t) => `#${t}`).join(', ')}: kein Roboter frei – in Domain Wall nicht darstellbar (One-Hot: Zeilenregel kostet immer A).</span>` : ''}`;
    } else if (st.step === 3) {
      const m = minUnder({ kosten: true });
      const dec = m ? decode(m.x) : null;
      const sortedOk = st.order === 'kosten';
      html = `Kosten <i>c</i><sub>t,r</sub> wie bei One-Hot (${escapeHtml(crit().label)}: ${formulaHtml(crit().formula)}), gewählt mit <b>δ</b> = linker − rechter Nachbar
        (1 genau an der Wand). Σ <i>c</i>·δ ist eine Teleskopsumme: <b>Kosten des ersten Roboters als Konstante</b>, je Bit die <b>Differenz zum nächsten
        Roboter</b> (kleine Zahl im Bit) – jede 1 schiebt die Wand einen Roboter weiter. Minimum nur mit Kosten: <b>${m ? describeState(m.x) : '–'}</b> (E = ${m ? fmtE(m.E) : '–'}).
        ${dec && !dec.valid ? `<br><span class="warnline">⚠ Ungültige Ketten bekommen Phantasiewerte – hier ist eine sogar das Minimum. Es braucht eine Regel.</span>`
    : `<br>Zufällig gültig${sortedOk ? ' – bei Sortierung nach Kosten kein Zufall: alle Differenzen ≥ 0, „alle aus“ ist das Minimum' : ' – Glück, kein Prinzip (Gegenbeispiel im Lesekapitel, Schritt 6)'}.`}`;
    } else if (st.step === 4) {
      const m = minUnder({ kosten: true, kette: true });
      const dec = m ? decode(m.x) : null;
      const doubles = dec ? [...dec.used].filter(([, ts]) => ts.length > 1) : [];
      const best = st.data.best;
      const opt = dec && dec.valid && best && Math.abs(m.E - best.value) < 1e-6;
      html = `Regel: <b>Keine falsche Wand.</b> Eine 1 rechts einer 0 (rot) kostet <b>A·<i>b</i><sub>i+1</sub>(1 − <i>b</i><sub>i</sub>)</b>. Weil die Ränder fest sind,
        gibt es ohne falsche Wand genau eine Wand, also genau einen Roboter. Gekoppelt sind <b>nur direkte Nachbarn</b> – eine Kette statt der One-Hot-Clique.
        Minimum bei A = ${nf(st.A)}: <b>${m ? describeState(m.x) : '–'}</b> (E = ${m ? fmtE(m.E) : '–'})
        ${opt ? '<span class="okline">✓ beste Zuweisung – je Auftrag der billigste Roboter.</span>' : dec && !dec.valid ? `<span class="warnline">✗ ${dec.issues.map(violationText).join(', ')}</span>` : ''}
        Faustregel: A > Kostenspannweite eines Auftrags (hier ${fmtE(st.data.weights.spread)}) – ein Kettenbruch spart höchstens sie.
        ${doubles.length ? `<br>${doubles.map(([r, ts]) => `R${r} übernimmt ${ts.map((t) => `#${t}`).join(', ')}`).join(', ')} – <b>Doppelbelegung ist zulässig</b>.` : ''}
        ${!best ? '<br><span class="warnline">Ein Auftrag ohne möglichen Roboter ist in Domain Wall nicht darstellbar.</span>' : ''}`;
    } else {
      const mc = metrics();
      html = `Ausmultipliziert: <b>QUBO-Matrix</b> mit <b>${mc.n} Qubits</b> und <b>${mc.couplings} Kopplungen</b> – nur Kettennachbarn;
        One-Hot: ${st.data.one_hot.n} / ${st.data.one_hot.couplings}. Ohne Spaltenregel sind die Ketten <b>nicht gekoppelt</b>: je Auftrag ein Block,
        und Domain Wall braucht immer weniger Qubits und Kopplungen als One-Hot (Tabelle beim Kopplungsgraph).`;
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
    const usage = el('div', { class: 'dw-usage' }, el('span', { class: 'filter-label', title: 'Doppelbelegung ist zulässig' }, 'Aufträge je Roboter'),
      robots.map((r) => {
        const n = (dec.used.get(r.robot_id) || []).length;
        return el('span', { class: 'sum col-sum', 'data-robot': r.robot_id },
          el('span', { class: 'dot-inline', style: { background: statusColor(r.status) } }), ` R${r.robot_id}: ${n}`);
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
el('a', { class: 'btn small', href: `#/ta/baukasten?auftraege=${st.selected.join(',')}&plaetze=1&kriterium=${st.criterion}${st.mode === 'alle' ? '&modus=alle' : ''}&kodierung=domain_wall${st.order === 'kosten' ? '&reihenfolge=kosten' : ''}`,
        title: 'Dieselben Aufträge im Formel-Baukasten: Bausteine verändern, Kodierungen mischen, falsch machen' }, 'Formel verändern → Baukasten'),
      el('a', { class: 'btn small', href: `#/ta/one-hot?auftraege=${st.selected.join(',')}&kriterium=${st.criterion}&schritt=${st.step}`,
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
    fill(togglesHost, toggles);
    const w = st.data.weights;
    const items = [];
    if (st.step >= 4 || st.showAll) items.push({ key: 'A', label: 'A · Kettenregel', color: TERM_COLORS.kette, value: st.A, recommended: w.A, hint: '> Kostenspannweite eines Auftrags' });
    weightsHost.hidden = !items.length;
    if (items.length) weights.render({ items, note: st.weightNote });
  }
  let pending = null;
  function scheduleUpdate() { clearTimeout(pending); pending = setTimeout(update, 60); }

  function renderEnergy() {
    if (!(st.step >= 3 || st.showAll)) return;
    const dec = decode(st.x);
    const parts = { kosten: [], kette: [] };
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
    const sums = Object.fromEntries(TERMS.map((k) => [k, st.terms[k] ? parts[k].reduce((s, p) => s + p.v, 0) : 0]));
    const E = TERMS.reduce((s, k) => s + sums[k], 0);
    const Eq = energy(st.model, st.x);
    const rank = st.result ? rankOf(st.result, toMask(st.x)) : null;
    const bar = el('div', { class: 'ebar' }, TERMS.filter((k) => sums[k] > 0).map((k) => withTip(
      el('div', { style: { flex: `${sums[k]} 0 0`, background: TERM_COLORS[k] } }), tipHtml(DW_LABELS[k], [fmtE(sums[k])]))));
    const empty = { kosten: 'keine Kette', kette: 'keine falsche Wand ✓' };
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
      rankHost.replaceChildren(el('p', { class: 'hint' }, `${n} Bits = ${nf(2 ** n)} Stellungen – zu viele für den Browser (max. ${MAX_SEARCH_BITS}).`));
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
    const coefs = st.model.entries.filter((e) => e.activeParts.length).map((e) => Math.abs(e.value));
    return { n: form().n, couplings: offs.length, maxCoef: coefs.length ? Math.max(...coefs) : 0 };
  }

  function renderMetrics() {
    const mc = metrics();
    const oh = st.data.one_hot;
    const R = Math.max(1, ...form().chains.map((c) => c.robots.length));
    const T = form().chains.length;
    const rows = Array.from({ length: 8 }, (_, k) => k + 1).map((t) => {
      const dw = t * Math.max(0, R - 2);
      const ohc = (t * R * (R - 1)) / 2;
      return el('tr', { class: t === T ? 'selected' : '' }, el('td', { class: 'num' }, t),
        el('td', { class: 'num' }, `${t * (R - 1)} / ${dw}`), el('td', { class: 'num' }, `${t * R} / ${ohc}`),
        el('td', { class: dw < ohc ? 'ok' : 'no' }, dw < ohc ? 'Domain Wall sparsamer' : dw === ohc ? 'gleich' : 'One-Hot sparsamer'));
    });
    fill(metricsHost,
      el('div', { class: 'kpis', style: { marginTop: '10px' } },
        kpiSmall('Variablen (Qubits)', nf(mc.n), `One-Hot: ${nf(oh.n)} – ein Bit weniger je Auftrag`),
        kpiSmall('Kopplungen', nf(mc.couplings), `nur Kettennachbarn · One-Hot: ${nf(oh.couplings)}`),
        kpiSmall('Größter |Koeffizient|', fmtE(mc.maxCoef), 'A treibt ihn hoch')),
      el('h4', {}, `Domain Wall gegen One-Hot – ${R} Roboter je Auftrag`),
      el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'Aufträge T'), el('th', { class: 'num' }, 'Domain Wall: Bits / Kopplungen'),
          el('th', { class: 'num' }, 'One-Hot: Bits / Kopplungen'), el('th', {}, ''))),
        el('tbody', {}, rows)),
      el('p', { class: 'hint', html: `Domain Wall: <i>T</i>(<i>R</i> − 2) Kopplungen, One-Hot: <i>T</i>·<i>R</i>(<i>R</i> − 1)/2 – ohne Spaltenregel wächst beides nur linear mit <i>T</i>.
        (Mit Spaltenregel kämen je konkurrierendem Auftragspaar 3<i>R</i> − 5 bzw. <i>R</i> dazu.) Hervorgehoben: dein Szenario (${T}).` }),
      el('div', { class: 'legend' }, ['kette'].map((k) => el('span', { class: 'legend-item' },
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
