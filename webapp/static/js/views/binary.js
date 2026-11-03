// Reiter „Kodierungen“ › Binary: die Roboternummer als Binärzahl – ⌈log₂ R⌉ Bits je Auftrag.
// Kosten und ungültige Codes werden Polynome vom Grad ⌈log₂ R⌉; ab Grad 3 erst Hilfsbits (Rosenberg)
// machen daraus eine QUBO. Schritte 3–5 rechnen deshalb mit dem echten Polynom, ab Schritt 6 mit der QUBO.
// Formulierung: encodings/formulations.py (binary) · Lesekapitel: encodings/binary/README.md
import { el, fill, nf, withTip, tipHtml, escapeHtml } from '../util.js';
import { C, TERM_COLORS, plot, statusColor } from '../theme.js';
import { createLayoutMap } from '../components/layoutMap.js';
import { initialScenario, renderScenario, shortName } from '../components/scenario.js';
import { autoWeights, createWeightControls, weightsFromParams } from '../components/weightControls.js';
import { MAX_SEARCH_BITS, MAX_STORE_BITS, anneal, energy, fromMask, makeModel, rankOf, search, toMask } from '../qubo/engine.js';
import { createMatrixView } from '../qubo/matrixView.js';
import { createGraphView } from '../qubo/graphView.js';
import { createLandscape } from '../components/landscape.js';
import { createCriterionPanel, formulaHtml } from './onehotCriterion.js';
import { BIN_DEFAULT_TAB, BIN_FORMULA_TABS, createBinaryFormulaPanel, decodeBinary, polyEnergy } from './binaryFormula.js';

const TERMS = ['kosten', 'ungueltig', 'hilfsbit']; // keine Spaltenregel: Doppelbelegung ist zulässig
export const BIN_LABELS = {
  kosten: 'Kosten (Indikator-Produkte)',
  ungueltig: 'Ungültige Codes: kein Phantomroboter',
  hilfsbit: 'Hilfsbits: w muss x·y sein',
};
const SHORT = { kosten: 'Kosten', ungueltig: 'Ungültige Codes', hilfsbit: 'Hilfsbits' };
const STEPS = [
  { title: 'Szenario', terms: {} },
  { title: 'Codes', terms: {} },
  { title: 'Kosten', terms: { kosten: true } },
  { title: 'Ungültige Codes', terms: { kosten: true, ungueltig: true } },
  { title: 'Hilfsbits', terms: { kosten: true, ungueltig: true, hilfsbit: true } },
  { title: 'QUBO & Hardware', terms: { kosten: true, ungueltig: true, hilfsbit: true } },
];
const ALL = { kosten: true, ungueltig: true, hilfsbit: true };
const POLY_MAX_BITS = 16; // Polynom (Grad > 2) wird bis hierhin durchprobiert
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (s) => String(s).replace(/\d/g, (d) => SUB[d]);
const fmtE = (v) => nf(v, 1).replace('-', '−');

export function renderBinary(root, { run, api, params }) {
  const tasks = run.tasks;
  const st = {
    step: Math.min(STEPS.length, Math.max(1, Number(params.schritt) || 1)),
    showAll: false,
    ...initialScenario(tasks, params),
    mode: 'kandidaten',
    order: params.reihenfolge === 'kosten' ? 'kosten' : 'nummer',
    criterion: params.kriterium || 'leerfahrt',
    costParams: {},
    A: 75, M: 300,
    honest: true, // Hilfsbits beim Klicken automatisch ehrlich halten
    terms: {},
    data: null,
    x: new Uint8Array(0),
    model: null,
    result: null,
    resultKey: '',
  };
  const linkedWeights = weightsFromParams(params, st, ['A', 'M']);

  // ---------------------------------------------------------------- Gerüst
  const stepper = el('div', { class: 'stepper' });
  const explain = el('div', { class: 'explain' });
  const showAllBox = el('input', { type: 'checkbox', id: 'bin-all' });
  const scenarioBody = el('div');
  const mapHost = el('div');
  const boardHost = el('div');
  const quickHost = el('div', { class: 'quick' });
  const energyHost = el('div');
  const togglesHost = el('div');
  const weightsHost = el('div');
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
    html: `Dieselbe Aufgabe wie bei <a href="#/ta/alt-one-hot">One-Hot</a> und <a href="#/ta/alt-domain-wall">Domain Wall</a> mit den wenigsten Bits:
      je Auftrag die <b>Roboternummer als Binärzahl</b>. Preis: Indikator-Produkte – ab 5 Robotern Terme mit drei und mehr Bits, die erst <b>Hilfsbits</b> zur QUBO machen.
      Lesekapitel: <code>encodings/binary/README.md</code>.`,
  }));
  root.append(el('section', { class: 'card guide' }, stepper,
    el('label', { class: 'filter-group', for: 'bin-all', style: { marginTop: '6px' } }, showAllBox, el('span', { class: 'hint' }, 'Alles auf einmal zeigen')),
    explain));

  const layout = el('div', { class: 'grid', style: { marginTop: '16px' } },
    el('div', { class: 'grid grid-2' },
      cardEl('Szenario', 'Echter Moment der Simulation', scenarioBody),
      cardEl('Lage in der Fabrik', 'Roboter im Snapshot · <b>#</b> = Abholort · dunkle Linie = Roboter im Code', mapHost)),
    section(2, el('div', { class: 'grid oh-main' },
      cardEl('Die Codes', 'Bits mit Stellenwert, Code = Roboternummer · Codebuch: blau = gewählt, rot = Phantom · Klick schaltet',
        quickHost, boardHost),
      section(3, cardEl('Energie dieses Zustands', 'Jeder Beitrag einzeln', togglesHost, weightsHost, energyHost)))),
    section(5, el('div', { class: 'grid grid-2' },
      cardEl('QUBO-Matrix', 'Nach den Hilfsbits · Hover erklärt · umrandet = zählt jetzt', matrixHost),
      cardEl('Kopplungsgraph & Hardware', 'Knoten = Qubits (Auftrags- und Hilfsbits), Linien = Kopplungen', graphHost, metricsHost))),
    section(5, el('div', { class: 'grid grid-2' },
      cardEl('Normierte QUBO-Matrix', 'Q / max|Q| · blau = Belohnung, rot = Strafe', normHost),
      cardEl('Energielandschaft', 'Alle Zustände als Fläche · Ziehen dreht, Scrollen zoomt', landHost))),
    section(3, cardEl('Bewertungskriterium', 'Kosten c<sub>t,r</sub> wie bei One-Hot – hier ein <b>Polynom</b> über die Bits eines Auftrags', criterionHost)),
    section(3, cardEl('Die Formel dahinter', 'Indikator-Produkte, Grad, Hilfsbits · Hover hebt Bits hervor', formulaHost)),
    section(3, cardEl('Die günstigsten Zustände', 'Alle Stellungen nach Energie · Klick lädt', rankHost, stripHost)));
  root.append(layout);

  const map = createLayoutMap(mapHost, { entities: run.entities, robots: run.robots, entityLabels: false });
  const landscape = createLandscape(normHost, landHost);
  let matrixView = null;
  let graphView = null;
  const weights = createWeightControls(weightsHost, {
    onChange: (key, value) => { st[key] = value; scheduleUpdate(); },
  });
  const formula = createBinaryFormulaPanel(formulaHost, {
    getState: () => ({ data: st.data, x: st.x, A: st.A, B: 0, M: st.M, terms: st.terms, step: st.step, model: st.model, qubo: quboMode() }),
    highlight: (sel) => highlightBoard(sel),
    clearHighlight: () => highlightBoard(null),
    setWeight: (key, value) => { st[key] = value; update(); },
    describe: (x) => describeState(x),
  });
  if (BIN_DEFAULT_TAB[st.step]) formula.setTab(BIN_DEFAULT_TAB[st.step], false);
  if (BIN_FORMULA_TABS.some((t) => t.key === params.formel)) formula.setTab(params.formel, false);
  const criterionPanel = createCriterionPanel(criterionHost, {
    getState: () => ({ data: st.data, selected: st.selected,
      diagonalHint: `Kein Bit heißt „Roboter r gewählt“: Die Kosten stecken im Indikator-Produkt des Codes und verteilen sich auf Konstante, Bits und
        Bit-Produkte – kein Koeffizient gehört mehr zu genau einem Roboter.` }),
    setCriterion: (key) => { st.criterion = key; load(); },
    setParam: (key, value) => { st.costParams = { ...st.costParams, [key]: value }; load(); },
    resetParams: () => { st.costParams = {}; load(); },
  });

  // ---------------------------------------------------------------- Szenario
  function drawScenario(error) {
    const snap = st.data ? st.data.instance.snapshot : null;
    const orderBox = el('div', { class: 'filter-group', style: { marginTop: '8px' } }, el('span', { class: 'filter-label' }, 'Nummerierung der Roboter'),
      ...[['nummer', 'nach Roboternummer (Kapitel)'], ['kosten', 'billigster = 0']].map(([v, label]) => {
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
  let firstLoad = true;
  async function load() {
    drawScenario();
    try {
      st.data = await api(`/api/runs/${encodeURIComponent(run.run_id)}/binary?tasks=${st.selected.join(',')}&variables=${st.mode}`
        + `&kriterium=${encodeURIComponent(st.criterion)}&reihenfolge=${st.order}&params=${encodeURIComponent(JSON.stringify(st.costParams))}`);
    } catch (err) {
      drawScenario(`Konnte die Formulierung nicht laden: ${err.message}`);
      return;
    }
    const d = st.data;
    // Gewichte: Empfehlung übernehmen – außer sie wurden per Link gesetzt oder die Automatik ist aus
    if (!(firstLoad && linkedWeights) && autoWeights()) ({ A: st.A, M: st.M } = d.weights);
    firstLoad = false;
    const f = d.formulation;
    const prevX = st.x;
    st.x = new Uint8Array(f.n);
    if (prevX.length === f.n) st.x.set(prevX);
    makeHonest(st.x);
    st.resultKey = '';
    if (params.zustand && !st.initialStateApplied) {
      st.initialStateApplied = true;
      if (params.zustand === 'naechster') st.x = nearest();
      if (params.zustand === 'minimum') { compute(); st.x = Uint8Array.from(st.result.min.x); }
    }
    matrixView = createMatrixView(matrixHost, { labels: f.bits.map((b, i) => bitLabel(i)), varName: bitLabel, describePart, onCellClick: flashBits });
    const maxPos = Math.max(1, ...f.bits.map((b) => b.pos));
    graphView = createGraphView(graphHost, {
      variables: f.bits.map((b) => ({ ...b, cost: 0, row: b.aux ? 'w' : b.task_id, col: b.pos })),
      rowKeys: [...f.tasks.map((t) => t.task_id), ...(f.aux.length ? ['w'] : [])], colKeys: Array.from({ length: maxPos }, (_, k) => k + 1),
      rowLabel: (t) => (t === 'w' ? 'Hilfs' : `#${t}`), colLabel: (k) => `${k}`, varName: bitLabel,
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
  const quboMode = () => st.showAll || st.step >= 5;
  function bitLabel(i) {
    const b = form().bits[i];
    return b.aux ? `w${sub(b.pos)}` : `z${sub(b.task_id)},${sub(b.pos)}`;
  }
  function describePart(p) {
    const val = (p.c || 0) + (p.A || 0) * st.A + (p.D || 0) * st.M;
    if (p.kind === 'hilfsbit') return `Hilfsbit ${bitLabel(p.aux)} = ${bitLabel(p.pair[0])}·${bitLabel(p.pair[1])}: ${fmtE(val)}`;
    return `${BIN_LABELS[p.kind]}: ${fmtE(val)}`;
  }
  const decode = (x) => decodeBinary(form(), x, quboMode());
  function describeState(x) {
    const dec = decode(x);
    return dec.tasks.map((t) => (t.robot != null ? `#${t.task_id}→R${t.robot}` : `#${t.task_id}: ${t.code != null ? `Phantom ${t.code}` : '–'}`)).join(' · ')
      + (dec.lies.length ? ` · ${dec.lies.length} Hilfsbit(s) lügen` : '');
  }
  const isValid = (x) => decode(x).valid;
  /** Hilfsbits ehrlich setzen: w = x·y, in Reihenfolge (Hilfsbits können auf Hilfsbits aufbauen). */
  function makeHonest(x) {
    for (const a of form().aux) x[a.index] = x[a.pair[0]] * x[a.pair[1]];
    return x;
  }
  function setCode(x, t, code) {
    t.bits.forEach((i, j) => { x[i] = (code >> (t.nb - 1 - j)) & 1; });
  }
  function nearest() {
    const x = new Uint8Array(form().n);
    for (const t of form().tasks) {
      if (!t.robots.length) continue;
      let best = 0;
      t.costs.forEach((c, k) => { if (c < t.costs[best]) best = k; });
      setCode(x, t, best);
    }
    return makeHonest(x);
  }

  // ---------------------------------------------------------------- Rechnen
  /** Energie des aktuellen Modells: Polynom (Schritte 3–5) oder QUBO mit Hilfsbits. */
  const currentEnergy = (x) => (quboMode() ? energy(st.model, x) : polyEnergy(form(), x, st.A, 0, st.terms));
  function compute() {
    const f = form();
    st.model = makeModel(f, { A: st.A, B: 0, D: st.M, terms: st.terms });
    const key = `${quboMode()}|${st.A}|${st.M}|${TERMS.map((k) => (st.terms[k] ? 1 : 0)).join('')}|${f.n}|${st.selected}|${st.mode}|${st.order}|${st.criterion}|${JSON.stringify(st.costParams)}`;
    if (key === st.resultKey) return;
    st.resultKey = key;
    st.result = quboMode() ? solveQubo(st.model) : solvePoly();
  }
  function solveQubo(model) {
    if (model.n <= MAX_SEARCH_BITS) {
      const r = search(model, 12);
      return { kind: 'qubo', exhaustive: true, min: { E: r.min.E, x: fromMask(r.min.mask, model.n) },
        top: r.top.map((t) => ({ E: t.E, x: fromMask(t.mask, model.n), mask: t.mask })), all: r.all, total: r.total };
    }
    const r = anneal(model, { restarts: 60, sweeps: 600, seed: 7, T0: Math.max(1, st.M), T1: 0.5 });
    return { kind: 'qubo', exhaustive: false, min: r.min, top: r.top, all: null, total: 2 ** model.n };
  }
  /** Polynom höheren Grades: nur die Auftrags-Bits durchprobieren, Hilfsbits ehrlich. */
  function solvePoly() {
    const f = form();
    const nt = f.n_task_bits;
    if (nt > POLY_MAX_BITS) return null;
    const total = 2 ** nt;
    const all = new Float64Array(total);
    const x = new Uint8Array(f.n);
    const top = [];
    for (let mask = 0; mask < total; mask += 1) {
      for (let i = 0; i < nt; i += 1) x[i] = (mask >> i) & 1;
      const E = polyEnergy(f, x, st.A, 0, st.terms);
      all[mask] = E;
      if (top.length < 12 || E < top[top.length - 1].E) {
        let k = top.length;
        while (k > 0 && top[k - 1].E > E) k -= 1;
        top.splice(k, 0, { E, mask });
        if (top.length > 12) top.pop();
      }
    }
    const toX = (mask) => {
      const xx = new Uint8Array(f.n);
      for (let i = 0; i < nt; i += 1) xx[i] = (mask >> i) & 1;
      return makeHonest(xx);
    };
    return { kind: 'poly', exhaustive: true, min: { E: top[0].E, x: toX(top[0].mask) }, top: top.map((t) => ({ E: t.E, x: toX(t.mask), mask: t.mask })),
      all, total, taskMask: (xx) => { let m = 0; for (let i = 0; i < nt; i += 1) if (xx[i]) m |= 1 << i; return m; } };
  }
  function minUnder(terms, qubo) {
    const prev = { terms: st.terms, key: st.resultKey, result: st.result, step: st.step, showAll: st.showAll };
    st.terms = terms;
    if (qubo) st.showAll = true;
    st.resultKey = '';
    compute();
    const out = st.result ? { x: st.result.min.x, E: st.result.min.E } : null;
    Object.assign(st, prev);
    st.model = makeModel(form(), { A: st.A, B: 0, D: st.M, terms: st.terms });
    return out;
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
    if (quboMode()) {
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
  let pending = null;
  function scheduleUpdate() { clearTimeout(pending); pending = setTimeout(update, 80); }

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
    if (BIN_DEFAULT_TAB[k]) formula.setTab(BIN_DEFAULT_TAB[k], false);
    makeHonest(st.x);
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
    const perTask = f.tasks.map((t) => `#${t.task_id}: ${t.robots.length} Roboter → ${t.nb} Bit${t.nb === 1 ? '' : 's'}`).join(', ');
    const phantoms = f.tasks.filter((t) => t.codes.some((c) => c.robot_id == null));
    const cmp = st.data.compare;
    const next = st.step < STEPS.length ? ` <button class="btn small primary" type="button" data-next>Weiter: ${st.step + 1} · ${STEPS[st.step].title} →</button>` : '';
    let html = '';
    if (st.step === 1) {
      html = `<b>${T} Auftrag${T === 1 ? '' : 'e'}</b> (${d.tasks.map((t) => `#${t.transport_id}`).join(', ')}), <b>${free.length} von ${d.robots.length} Robotern frei</b>.
        Gleiche Frage – <b>welcher Roboter übernimmt welchen Auftrag, damit ${escapeHtml(crit().goal)}?</b> –, mit möglichst <b>wenigen Bits</b>.`;
    } else if (st.step === 2) {
      html = `Die Roboter eines Auftrags werden nummeriert (0, 1, 2, …), die Nummer steht im Zweiersystem (erste Stelle zählt am meisten).
        Hier ${perTask} → <b>${f.n_task_bits} Bits</b> (One-Hot: ${cmp.one_hot.n}, Domain Wall: ${cmp.domain_wall.n}); das Codebuch zeigt den Roboter.
        Bei einer Zweierpotenz an Robotern ist <b>jede</b> Stellung ein Roboter – ein Auftrag allein braucht dann keine Regel.
        ${phantoms.length ? `<br><span class="warnline">⚠ ${phantoms.map((t) => `#${t.task_id} (${t.robots.length} Roboter, ${t.codes.length} Codes)`).join(', ')}: Codes ohne Roboter – „Phantomroboter“ (rot).</span>` : ''}
        ${f.unrepresentable.length ? `<br><span class="warnline">⚠ ${f.unrepresentable.map((t) => `#${t}`).join(', ')}: kein Roboter frei – nicht darstellbar.</span>` : ''}`;
    } else if (st.step === 3) {
      const m = minUnder({ kosten: true });
      const dec = m ? decode(m.x) : null;
      html = `Kein Bit heißt mehr „Roboter r gewählt“ – es entsteht aus allen Bits des Auftrags: Code <code>01</code> ist (1 − <i>z</i><sub>1</sub>)·<i>z</i><sub>2</sub>,
        ein <b>Indikator-Produkt</b> (1 genau bei diesem Code). Kosten (${escapeHtml(crit().label)}: ${formulaHtml(crit().formula)}) = Σ <i>c</i>·Indikator,
        ein <b>Polynom vom Grad ${Math.max(0, ...f.tasks.map((t) => t.nb))}</b>. Minimum nur mit Kosten: <b>${m ? describeState(m.x) : '–'}</b> (E = ${m ? fmtE(m.E) : '–'}).
        ${dec && dec.tasks.some((t) => t.code != null && t.robot == null) ? '<br><span class="warnline">⚠ Phantomroboter: Codes ohne Roboter haben keinen Kostenterm – kosten 0 und schlagen jeden echten.</span>' : ''}`;
    } else if (st.step === 4) {
      const m = minUnder({ kosten: true, ungueltig: true });
      const dec = m ? decode(m.x) : null;
      html = `Regel 1: <b>Kein Phantomroboter</b> – je Code ohne Roboter <b>A · Indikator</b>.
        ${phantoms.length ? `Betrifft ${phantoms.map((t) => `#${t.task_id}`).join(', ')}; bei 3 Robotern A·<i>z</i><sub>1</sub><i>z</i><sub>2</sub>, bei 5 schon ein Term mit drei Bits.`
    : 'Hier hat jeder Auftrag eine Zweierpotenz an Robotern – keine Phantomcodes, die Regel ist leer (anderer Moment oder „alle Roboter“ probieren).'}
        Minimum: <b>${m ? describeState(m.x) : '–'}</b> (E = ${m ? fmtE(m.E) : '–'}).
        ${dec && [...dec.used].some(([, ts]) => ts.length > 1) ? `<br>${[...dec.used].filter(([, ts]) => ts.length > 1).map(([r, ts]) => `R${r} übernimmt ${ts.map((t) => `#${t}`).join(', ')}`).join(', ')} – <b>Doppelbelegung ist zulässig</b>.` : ''}`;
    } else if (st.step === 5) {
      const m = minUnder(ALL, true);
      const dec = m ? decode(m.x) : null;
      const best = st.data.best;
      const ok = dec && dec.valid && best && Math.abs(m.E - best.value) < 1e-6;
      html = f.aux.length
        ? `Grad ${f.max_degree} > 2: Rosenberg (1975) – ein neues Bit <b>w</b> ersetzt ein Paar <i>x</i>·<i>y</i> und kostet <b>M·(xy − 2xw − 2yw + 3w)</b> – 0 bei w = x·y, sonst ≥ M.
        Hier <b>${f.aux.length} Hilfsbits</b> (${f.aux.map((a) => `${bitLabel(a.index)} = ${bitLabel(a.pair[0])}·${bitLabel(a.pair[1])}`).join(', ')}), zusammen ${f.n} Qubits.
        QUBO-Minimum bei M = ${nf(st.M)}: <b>${m ? describeState(m.x) : '–'}</b> (E = ${m ? fmtE(m.E) : '–'})
        ${ok ? '<span class="okline">✓ beste Zuweisung.</span>' : dec && !dec.valid ? `<span class="warnline">✗ ${dec.issues.map((i) => i.text).join(', ')}</span>` : ''}
        <br>Zu kleines M: ein Hilfsbit <b>lügt</b> und dreht eine Strafe in eine Belohnung. Empfehlung M = ${nf(st.data.weights.M)} (> größter Gewinn einer Lüge).`
        : `<b>Keine Hilfsbits nötig:</b> Ohne Spaltenregel koppeln die Aufträge nicht, jeder Term bleibt im eigenen Code – höchster Grad ${f.max_degree}.
        Erst ab 5 Robotern je Auftrag (3 Bits) haben schon die Kosten Grad 3 und brauchen Hilfsbits.
        Minimum: <b>${m ? describeState(m.x) : '–'}</b> (E = ${m ? fmtE(m.E) : '–'}) ${ok ? '<span class="okline">✓ beste Zuweisung.</span>' : ''}`;
    } else {
      const mc = metrics();
      html = `<b>QUBO-Matrix</b> mit <b>${mc.n} Qubits</b> (${f.n_task_bits} Auftrags- + ${f.aux.length} Hilfsbits) und <b>${mc.couplings} Kopplungen</b>; Polynom vorher Grad ${f.max_degree}.
        Qubits / Kopplungen: One-Hot ${st.data.compare.one_hot.n} / ${st.data.compare.one_hot.couplings}, Domain Wall ${st.data.compare.domain_wall.n} / ${st.data.compare.domain_wall.couplings}.
        Größter Koeffizient <b>${fmtE(mc.maxCoef)}</b> – M treibt die nötige Präzision hoch (→ normierte Matrix).`;
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
    map.setLines(dec.tasks.filter((t) => t.robot != null).map((t) => {
      const r = robotOf(t.robot);
      return { from: { x: r.x, y: r.y }, to: taskOf(t.task_id).pickup, label: nf(t.cost, 1), color: C.ink, opacity: 1 };
    }));
  }

  // ---------------------------------------------------------------- Codes (Schachbrett)
  function renderBoard() {
    const f = form();
    const dec = decode(st.x);
    const showCost = st.step >= 3 || st.showAll;
    const toggleBit = (i) => {
      st.x[i] = st.x[i] ? 0 : 1;
      if (st.honest || !quboMode()) makeHonest(st.x);
      update();
    };
    const rows = f.tasks.map((t) => {
      const info = dec.tasks.find((d) => d.task_id === t.task_id);
      const task = taskOf(t.task_id);
      const head = el('div', { class: 'dw-head', 'data-task': t.task_id }, el('div', {}, el('strong', {}, `#${t.task_id}`)),
        el('div', { class: 'hint' }, `${shortName(task.from_entity)} → ${shortName(task.to_entity)}`));
      if (!t.robots.length) return el('div', { class: 'bin-row' }, head, el('div', { class: 'hint' }, 'kein Roboter frei – nicht darstellbar'));
      const bitsEl = el('div', { class: 'bin-bits' }, t.nb
        ? t.bits.map((i, j) => {
          const b = el('button', { class: `cell dw-bit switch${st.x[i] ? ' on' : ''}`, type: 'button', 'data-var': i, 'data-task': t.task_id,
            'aria-pressed': String(Boolean(st.x[i])), 'aria-label': `${bitLabel(i)} umschalten` },
          el('span', { class: 'bit' }, st.x[i] ? '1' : '0'), el('span', { class: 'var' }, bitLabel(i)), el('span', { class: 'cost' }, `×${2 ** (t.nb - 1 - j)}`));
          b.addEventListener('click', () => toggleBit(i));
          return b;
        })
        : el('span', { class: 'hint' }, '0 Bits – nur ein Roboter'));
      const result = el('div', { class: `bin-code ${info.robot != null ? 'good' : 'bad'}` },
        el('div', { class: 'hint' }, `Code ${info.code ?? '–'}`),
        el('div', {}, info.robot != null ? `→ R${info.robot}` : '✗ Phantom'),
        showCost && info.robot != null ? el('div', { class: 'hint' }, `${fmtE(info.cost)} ${unit()}`) : null);
      const book = el('div', { class: 'bin-book' }, t.codes.map((c) => {
        const chip = el('button', { class: `bin-chip${c.code === info.code ? ' current' : ''}${c.robot_id == null ? ' phantom' : ''}`, type: 'button',
          'data-robot': c.robot_id ?? '', title: 'Code laden' },
        el('span', { class: 'mono' }, c.pattern || '–'), el('span', {}, c.robot_id != null ? `R${c.robot_id}` : 'Phantom'),
        showCost ? el('span', { class: 'hint' }, c.robot_id != null ? fmtE(c.cost) : (st.terms.ungueltig ? `A = ${nf(st.A)}` : '0 (!)')) : null);
        chip.addEventListener('click', () => { setCode(st.x, t, c.code); if (st.honest || !quboMode()) makeHonest(st.x); update(); });
        return chip;
      }));
      return el('div', { class: 'bin-row' }, head, bitsEl, result, book);
    });
    const robots = st.data.instance.robots.filter((r) => f.tasks.some((t) => t.robots.includes(r.robot_id)));
    const usage = el('div', { class: 'dw-usage' }, el('span', { class: 'filter-label', title: 'Doppelbelegung ist zulässig' }, 'Aufträge je Roboter'),
      robots.map((r) => {
        const n = (dec.used.get(r.robot_id) || []).length;
        return el('span', { class: 'sum col-sum', 'data-robot': r.robot_id },
          el('span', { class: 'dot-inline', style: { background: statusColor(r.status) } }), ` R${r.robot_id}: ${n}`);
      }));
    const auxEl = quboMode() && f.aux.length
      ? el('div', { class: 'bin-aux' },
        el('div', { class: 'filter-label' }, 'Hilfsbits (Qubits für Paare):'),
        f.aux.map((a) => {
          const honestVal = st.x[a.pair[0]] * st.x[a.pair[1]];
          const lies = st.x[a.index] !== honestVal;
          const b = el('button', { class: `cell dw-bit switch${st.x[a.index] ? ' on' : ''}${lies ? ' lie' : ''}`, type: 'button', 'data-var': a.index,
            'aria-label': `${bitLabel(a.index)} umschalten` },
          el('span', { class: 'bit' }, st.x[a.index] ? '1' : '0'), el('span', { class: 'var' }, bitLabel(a.index)),
          el('span', { class: 'cost' }, lies ? 'lügt!' : '✓'));
          withTip(b, () => tipHtml(`${bitLabel(a.index)} soll ${bitLabel(a.pair[0])}·${bitLabel(a.pair[1])} sein`,
            [`${bitLabel(a.pair[0])}·${bitLabel(a.pair[1])} = ${st.x[a.pair[0]]}·${st.x[a.pair[1]]} = ${honestVal}`, lies ? '<b>lügt – kostet M·Strafe</b>' : 'ehrlich – kostet nichts',
              `ersetzt das Paar in ${a.replaced} Term(en) vom Grad > 2`]));
          b.addEventListener('click', () => { st.x[a.index] = st.x[a.index] ? 0 : 1; update(); });
          return el('span', { class: 'bin-aux-item' }, b, el('span', { class: 'hint' }, `= ${bitLabel(a.pair[0])}·${bitLabel(a.pair[1])}`));
        }),
        (() => {
          const box = el('input', { type: 'checkbox', checked: st.honest });
          box.addEventListener('change', () => { st.honest = box.checked; if (st.honest) makeHonest(st.x); update(); });
          return el('label', { class: 'filter-group' }, box, el('span', { class: 'hint' }, 'beim Klicken ehrlich halten'));
        })())
      : null;
    fill(boardHost, el('div', { class: 'dw-board' }, rows), usage, auxEl);

    fill(quickHost,
      el('button', { class: 'btn small', type: 'button', title: 'Alle Bits 0: jeder Auftrag nimmt Roboter Nummer 0',
        onclick: () => { st.x = makeHonest(new Uint8Array(f.n)); update(); } }, 'Alle aus'),
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = nearest(); update(); } }, 'Jeder nimmt den nächsten'),
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = Uint8Array.from(f.bits, () => (Math.random() < 0.5 ? 1 : 0)); if (st.honest || !quboMode()) makeHonest(st.x); update(); } }, 'Zufall'),
      st.step >= 3 || st.showAll
        ? el('button', { class: 'btn small primary', type: 'button', disabled: !st.result, onclick: () => { st.x = Uint8Array.from(st.result.min.x); update(); } }, 'Minimum laden')
        : null,
      quboMode() && f.aux.length ? el('button', { class: 'btn small', type: 'button', onclick: () => { makeHonest(st.x); update(); } }, 'Hilfsbits ehrlich setzen') : null,
el('a', { class: 'btn small', href: `#/ta/baukasten?auftraege=${st.selected.join(',')}&plaetze=1&kriterium=${st.criterion}${st.mode === 'alle' ? '&modus=alle' : ''}&kodierung=binary${st.order === 'kosten' ? '&reihenfolge=kosten' : ''}`,
        title: 'Dieselben Aufträge im Formel-Baukasten: Bausteine verändern, Kodierungen mischen, falsch machen' }, 'Formel verändern → Baukasten'),
      el('a', { class: 'btn small', href: `#/ta/alt-one-hot?auftraege=${st.selected.join(',')}&kriterium=${st.criterion}`, title: 'Dieselben Aufträge mit One-Hot' }, 'One-Hot →'),
      el('a', { class: 'btn small', href: `#/ta/alt-domain-wall?auftraege=${st.selected.join(',')}&kriterium=${st.criterion}`, title: 'Dieselben Aufträge mit Domain Wall' }, 'Domain Wall →'));
  }

  function renderControls() {
    const toggles = el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Regeln'),
      TERMS.filter((k) => k !== 'hilfsbit' || quboMode()).map((k) => {
        const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(Boolean(st.terms[k])), title: BIN_LABELS[k] },
          el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }), SHORT[k]);
        b.addEventListener('click', () => { st.terms[k] = !st.terms[k]; update(); });
        return b;
      }));
    fill(togglesHost, toggles);
    const w = st.data.weights;
    const items = [];
    if (st.step >= 4 || st.showAll) items.push({ key: 'A', label: 'A · ungültige Codes', color: TERM_COLORS.ungueltig, value: st.A, recommended: w.A, hint: '> größte Kosten' });
    if (quboMode() && form().aux.length) items.push({ key: 'M', label: 'M · Hilfsbits', color: TERM_COLORS.hilfsbit, value: st.M, recommended: w.M, hint: '> Gewinn eines lügenden Hilfsbits' });
    weightsHost.hidden = !items.length;
    if (items.length) weights.render({ items });
  }

  function renderEnergy() {
    if (!(st.step >= 3 || st.showAll)) return;
    const f = form();
    const dec = decode(st.x);
    const qubo = quboMode();
    // Beiträge je Termart: im QUBO-Modus aus der Matrix (mit Hilfsbits), sonst aus dem Polynom
    const sums = Object.fromEntries(TERMS.map((k) => [k, 0]));
    if (qubo) {
      for (const e of st.model.entries) {
        if (!(st.x[e.i] && st.x[e.j])) continue;
        for (const p of e.activeParts) sums[p.kind] += (p.c || 0) + (p.A || 0) * st.A + (p.D || 0) * st.M;
      }
      for (const p of f.const_parts) if (st.terms[p.kind]) sums[p.kind] += (p.c || 0) + (p.A || 0) * st.A + (p.D || 0) * st.M;
    } else {
      for (const k of ['kosten', 'ungueltig']) if (st.terms[k]) sums[k] = polyEnergy(f, st.x, st.A, 0, { [k]: true });
    }
    const items = { kosten: [], ungueltig: [], hilfsbit: [] };
    for (const t of dec.tasks) {
      if (t.robot != null) items.kosten.push({ text: `#${t.task_id} → R${t.robot}: ${fmtE(t.cost)} ${unit()}` });
      else if (t.code != null) {
        items.kosten.push({ bad: true, text: `#${t.task_id}: Code ${t.code} ist ein Phantom – kein Kostenterm, kostet 0` });
        items.ungueltig.push({ bad: true, text: `#${t.task_id}: Code ${t.code} → A = ${fmtE(st.A)}` });
      }
    }
    if (qubo) {
      for (const a of f.aux) {
        const h = st.x[a.pair[0]] * st.x[a.pair[1]];
        const w = st.x[a.index];
        const pen = h - 2 * st.x[a.pair[0]] * w - 2 * st.x[a.pair[1]] * w + 3 * w;
        if (w !== h) items.hilfsbit.push({ bad: true, text: `${bitLabel(a.index)} = ${w}, aber ${bitLabel(a.pair[0])}·${bitLabel(a.pair[1])} = ${h} → lügt: M·${pen} = ${fmtE(st.M * pen)}` });
      }
    }
    const E = TERMS.reduce((s, k) => s + (st.terms[k] ? sums[k] : 0), 0);
    const truth = polyEnergy(f, st.x, st.A, 0, st.terms);
    const rank = st.result?.all ? rankOf(st.result, st.result.kind === 'poly' ? st.result.taskMask(st.x) : toMask(st.x)) : null;
    const shown = TERMS.filter((k) => k !== 'hilfsbit' || qubo);
    const empty = { kosten: 'keine Codes', ungueltig: 'kein Phantomroboter ✓', hilfsbit: f.aux.length ? 'alle Hilfsbits ehrlich ✓' : 'keine Hilfsbits nötig' };
    const group = (k) => el('div', { class: `egroup${st.terms[k] ? '' : ' off'}` },
      el('div', { class: 'egroup-head' }, el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }),
        el('span', {}, k === 'kosten' ? `Kosten: ${crit().label} [${unit()}]` : BIN_LABELS[k]), el('strong', {}, st.terms[k] ? fmtE(sums[k]) : 'aus')),
      items[k].length ? el('ul', {}, items[k].map((p) => el('li', { class: p.bad ? 'bad' : '' }, p.text))) : el('div', { class: 'hint' }, empty[k]));
    fill(energyHost,
      el('div', { class: 'etotal' },
        el('div', {}, el('div', { class: 'hint' }, qubo ? 'Energie der QUBO' : `Energie des Polynoms (Grad ${f.max_degree})`), el('div', { class: 'ebig' }, fmtE(E))),
        el('div', { class: 'erank' },
          rank ? el('div', {}, `Platz ${nf(rank)} von ${nf(st.result.total)}`) : null,
          el('div', { class: dec.valid ? 'okline' : 'warnline' }, dec.valid ? '✓ gültige Zuweisung' : `✗ ${dec.issues.map((i) => i.text).join(' · ')}`))),
      el('div', { class: 'ebar' }, shown.filter((k) => st.terms[k] && sums[k] > 0).map((k) => withTip(
        el('div', { style: { flex: `${sums[k]} 0 0`, background: TERM_COLORS[k] } }), tipHtml(BIN_LABELS[k], [fmtE(sums[k])])))),
      ...shown.map(group),
      qubo ? el('p', { class: Math.abs(E - truth) < 1e-6 ? 'hint' : 'warnline' },
        Math.abs(E - truth) < 1e-6 ? `Probe: QUBO = Polynom = ${fmtE(truth)} ✓ (Hilfsbits ehrlich)`
          : `QUBO ${fmtE(E)}, wahres Polynom ${fmtE(truth)} – der Unterschied kommt von lügenden Hilfsbits.`) : null,
      qubo ? el('p', { class: 'hint' }, `Probe über die Matrix: xᵀQx + Konstante = ${fmtE(energy(st.model, st.x))} ${Math.abs(energy(st.model, st.x) - E) < 1e-6 ? '✓ identisch' : '✗ ABWEICHUNG'}`) : null);
  }

  function renderRanking() {
    if (!(st.step >= 3 || st.showAll)) return;
    const f = form();
    if (!st.result) {
      rankHost.replaceChildren(el('p', { class: 'hint' }, `${f.n_task_bits} Auftrags-Bits – das Polynom wird bis ${POLY_MAX_BITS} Bits durchprobiert.`));
      Plotly.purge(stripHost);
      return;
    }
    const res = st.result;
    const cur = res.kind === 'poly' ? res.taskMask(st.x) : (f.n <= 31 ? toMask(st.x) : -1);
    rankHost.replaceChildren(
      el('p', { class: 'hint' }, res.kind === 'poly' ? `Polynom: alle ${nf(res.total)} Stellungen der Auftrags-Bits durchprobiert (Hilfsbits braucht es hier noch nicht).`
        : res.exhaustive ? `QUBO: alle ${nf(res.total)} Zustände inkl. Hilfsbits durchprobiert.` : 'QUBO: Simulated Annealing (Heuristik).'),
      el('div', { class: 'table-scroll' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'Platz'), el('th', { class: 'num' }, 'Energie'), el('th', {}, 'Zuweisung'), el('th', {}, 'Regeln'))),
        el('tbody', {}, res.top.map((r, k) => {
          const dec = decode(r.x);
          const tr = el('tr', { class: `clickable${r.mask === cur ? ' selected' : ''}` },
            el('td', { class: 'num' }, k + 1), el('td', { class: 'num' }, fmtE(r.E)), el('td', {}, describeState(r.x)),
            el('td', { class: dec.valid ? 'ok' : 'no' }, dec.valid ? '✓ gültig' : `✗ ${dec.issues.map((i) => i.text).join(' · ')}`));
          tr.addEventListener('click', () => { st.x = Uint8Array.from(r.x); update(); });
          return tr;
        })))));
    const nBits = res.kind === 'poly' ? f.n_task_bits : f.n;
    if (res.all && nBits <= MAX_STORE_BITS) {
      const all = res.all;
      const order = Array.from(all.keys()).sort((a, b) => all[a] - all[b]);
      const xOf = (m) => {
        if (res.kind === 'qubo') return fromMask(m, f.n);
        const xx = new Uint8Array(f.n);
        for (let i = 0; i < f.n_task_bits; i += 1) xx[i] = (m >> i) & 1;
        return makeHonest(xx);
      };
      const valid = order.map((m) => isValid(xOf(m)));
      const curRank = order.indexOf(cur);
      stripHost.style.minHeight = '';
      if (stripHost.querySelector('p')) stripHost.replaceChildren();
      plot(stripHost, [
        { type: 'scattergl', mode: 'markers', x: order.map((_, k) => k + 1), y: order.map((m) => all[m]),
          marker: { size: nBits > 12 ? 3 : 6, color: valid.map((ok) => (ok ? C.series : C.axis)) }, customdata: order,
          hovertemplate: 'Platz %{x}: E = %{y}<extra></extra>', name: 'Zustände' },
        ...(curRank >= 0 ? [{ type: 'scatter', mode: 'markers', x: [curRank + 1], y: [all[cur]], marker: { size: 14, color: C.accent, line: { color: C.surface, width: 2 } },
          hovertemplate: 'dein Zustand: Platz %{x}, E = %{y}<extra></extra>', name: 'dein Zustand' }] : []),
      ], {
        showlegend: false, margin: { l: 56, r: 10, t: 30, b: 44 },
        xaxis: { title: { text: `Platz (alle ${nf(all.length)} Zustände, nach Energie sortiert)` } }, yaxis: { title: { text: 'Energie' } },
        annotations: [{ xref: 'paper', yref: 'paper', x: 0, y: 1.06, xanchor: 'left', showarrow: false,
          text: `<span style="color:${C.series}">●</span> gültig  <span style="color:${C.axis}">●</span> ungültig  <span style="color:${C.accent}">●</span> dein Zustand · Klick lädt einen Zustand`, font: { color: C.ink2 } }],
      });
      stripHost.removeAllListeners?.('plotly_click');
      stripHost.on('plotly_click', (ev) => {
        const p = ev.points && ev.points[0];
        if (p && p.customdata != null) { st.x = xOf(p.customdata); update(); }
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
    const byKind = Object.fromEntries(TERMS.map((k) => [k, offs.filter((e) => e.activeParts.some((p) => p.kind === k)).length]));
    return { n: form().n, couplings: offs.length, byKind, maxCoef: coefs.length ? Math.max(...coefs) : 0 };
  }

  function renderMetrics() {
    const mc = metrics();
    const f = form();
    const cmp = st.data.compare;
    const degRows = Object.entries(f.degrees_before).map(([d, n]) => el('tr', { class: Number(d) > 2 ? 'warnrow' : '' },
      el('td', { class: 'num' }, d), el('td', { class: 'num' }, nf(n)), el('td', {}, Number(d) > 2 ? 'kein QUBO-Term → Hilfsbits' : 'QUBO-tauglich')));
    fill(metricsHost,
      el('div', { class: 'kpis', style: { marginTop: '10px' } },
        kpiSmall('Variablen (Qubits)', nf(mc.n), `${f.n_task_bits} Auftrags-Bits + ${f.aux.length} Hilfsbits`),
        kpiSmall('Kopplungen', nf(mc.couplings), `davon ${mc.byKind.hilfsbit} aus Hilfsbit-Strafen`),
        kpiSmall('Größter |Koeffizient|', fmtE(mc.maxCoef), `M = ${nf(st.M)} treibt ihn hoch`)),
      el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'für dieselben Aufträge'), el('th', { class: 'num' }, 'Variablen'), el('th', { class: 'num' }, 'Kopplungen'))),
        el('tbody', {},
          el('tr', {}, el('td', {}, 'One-Hot'), el('td', { class: 'num' }, nf(cmp.one_hot.n)), el('td', { class: 'num' }, nf(cmp.one_hot.couplings))),
          el('tr', {}, el('td', {}, 'Domain Wall'), el('td', { class: 'num' }, nf(cmp.domain_wall.n)), el('td', { class: 'num' }, nf(cmp.domain_wall.couplings))),
          el('tr', { class: 'selected' }, el('td', {}, 'Binary (mit Hilfsbits)'), el('td', { class: 'num' }, nf(mc.n)), el('td', { class: 'num' }, nf(mc.couplings))))),
      el('h4', {}, 'Terme vor den Hilfsbits nach Grad'),
      el('table', { class: 'data' }, el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'Grad'), el('th', { class: 'num' }, 'Terme'), el('th', {}, ''))),
        el('tbody', {}, degRows)),
      el('p', { class: 'hint' }, 'Binary spart Auftrags-Bits; jedes Paar in einem Term vom Grad > 2 braucht ein Hilfsbit, und M wächst mit den Aufträgen, die sich ein Hilfsbit teilen.'));
  }

  function highlightBoard(sel) {
    boardHost.querySelectorAll('.hl').forEach((n) => n.classList.remove('hl'));
    if (!sel) return;
    const q = [];
    (sel.vars || []).forEach((i) => q.push(`[data-var="${i}"]`));
    if (sel.task != null) q.push(`.dw-bit[data-task="${sel.task}"]`, `.dw-head[data-task="${sel.task}"]`);
    if (sel.robot != null) q.push(`.bin-chip[data-robot="${sel.robot}"]`, `.col-sum[data-robot="${sel.robot}"]`);
    if (sel.kind === 'kosten' || sel.all) q.push('.bin-bits .dw-bit');
    if (sel.kind === 'ungueltig') q.push('.bin-chip.phantom');
    if (sel.kind === 'spalte') q.push('.col-sum');
    if (sel.kind === 'hilfsbit') q.push('.bin-aux .dw-bit');
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
