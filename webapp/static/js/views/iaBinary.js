// Reiter „Kodierungen IA“ › Binary: Sofortzuweisung mit Codes. Wie bei Domain Wall liegt der Code auf der Seite, die
// vollständig zugewiesen wird: T ≤ R je Auftrag über die Roboter, T > R je Roboter über die Aufträge (K = ⌈log₂ ·⌉ Bits).
// y = Produkt der K Bits (Grad K), die Querregel multipliziert zwei y (Grad 2K) – ab Grad 3 erst Hilfsbits (H_Aux)
// machen daraus eine QUBO. Schritte 3–5 rechnen deshalb mit dem echten Polynom, ab Schritt 6 mit der QUBO.
// Formulierung: encodings/formulations.py (binary_ia) · Aufbau wie iaDomainWall.js und binary.js
import { el, fill, nf, withTip, tipHtml, escapeHtml } from '../util.js';
import { C, TERM_COLORS, statusColor, plot } from '../theme.js';
import { createLayoutMap } from '../components/layoutMap.js';
import { autoWeights, createWeightControls, weightsFromParams } from '../components/weightControls.js';
import { initialScenario, renderScenario, shortName } from '../components/scenario.js';
import { CASE_LABELS, CASE_TEXTS, applyCase, renderCaseCards, robotPicker, toggledRobots } from '../components/iaScenario.js';
import { MAX_SEARCH_BITS, MAX_STORE_BITS, anneal, energy, fromMask, makeModel, rankOf, search, toMask } from '../qubo/engine.js';
import { createMatrixView } from '../qubo/matrixView.js';
import { createGraphView } from '../qubo/graphView.js';
import { createLandscape } from '../components/landscape.js';
import { createCriterionPanel, formulaHtml } from './onehotCriterion.js';
import { CROSS_EXACT, SIDE, crossText, crossTitle } from './iaDomainWallFormula.js';
import {
  AUX_NAME, BIN_IA_DEFAULT_TAB, BIN_IA_TABS, TERMS, bitText, codeText, createIaBinFormulaPanel, crossName, decodeIaBin, objName,
  penName, polyEnergy, termName, termTitle, yName,
} from './iaBinaryFormula.js';

const ALL = { kosten: true, ungueltig: true, quer: true, hilfsbit: true };
const STEPS = [
  { title: 'Szenario', terms: {} },
  { title: 'Codes', terms: {} },
  { title: 'Kosten', terms: { kosten: true } },
  { title: 'Ungültige Codes', terms: { kosten: true, ungueltig: true } },
  { title: 'Querregel', terms: { kosten: true, ungueltig: true, quer: true } }, // Titel je Fall: Roboter- oder Auftragsregel
  { title: 'Hilfsbits', terms: ALL },
  { title: 'QUBO & Hardware', terms: ALL },
];
const POLY_MAX_BITS = 16; // Polynom (Grad > 2) wird bis hierhin durchprobiert
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (s) => String(s).replace(/\d/g, (d) => SUB[d]);
const fmtE = (v) => nf(v, 1).replace('-', '−');

export function renderIaBinary(root, { run, api, params }) {
  const tasks = run.tasks;
  const linkedRobots = String(params.roboter || '').split(',').map(Number).filter((id) => id > 0);
  const st = {
    step: Math.min(STEPS.length, Math.max(1, Number(params.schritt) || 1)),
    showAll: false,
    ...initialScenario(tasks, params, 3), // ohne Link: drei Anfragen – bei vier freien Robotern T < R, K = 2
    robots: linkedRobots.length ? linkedRobots : null, // null = alle freien Roboter
    mode: params.modus === 'alle' ? 'alle' : 'kandidaten',
    A: 100, B: 40, M: 750,
    honest: true, // Hilfsbits beim Klicken automatisch ehrlich halten
    terms: {},
    data: null,
    x: new Uint8Array(0),
    model: null,
    result: null,
    resultKey: '',
    criterion: params.kriterium || 'fahrstrecke',
    costParams: {},
    adjustWeights: true,
    weightNote: '',
    caseNote: '',
  };
  // ---------------------------------------------------------------- Gerüst
  const stepper = el('div', { class: 'stepper' });
  const caseHost = el('div', { class: 'case-pick' });
  const explain = el('div', { class: 'explain' });
  const showAllBox = el('input', { type: 'checkbox', id: 'iabin-all' });
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
    html: `<strong>Sofortzuweisung mit Binary:</strong> Die Seite, die vollständig zugewiesen wird, trägt einen <b>Code</b> aus <i>K</i> = ⌈log₂ ·⌉ Bits –
      bei <i>T</i> ≤ <i>R</i> je Auftrag, bei <i>T</i> &gt; <i>R</i> je Roboter. Die wenigsten Bits, aber Produkte: Die Querregel hat Grad 2<i>K</i>, ab Grad 3
      braucht es <b>Hilfsbits</b>. Vergleich: <a href="#/ia/one-hot">One-Hot (IA)</a>, <a href="#/ia/domain-wall">Domain Wall (IA)</a>.`,
  }));
  root.append(el('section', { class: 'card guide' }, stepper, caseHost,
    el('label', { class: 'filter-group', for: 'iabin-all', style: { marginTop: '6px' } }, showAllBox, el('span', { class: 'hint' }, 'Alles auf einmal zeigen')),
    explain));

  const layout = el('div', { class: 'grid', style: { marginTop: '16px' } },
    el('div', { class: 'grid grid-2' },
      cardEl('Szenario', 'Echter Moment der Simulation · Aufträge <i>T</i> und Roboter <i>R</i> wählen', scenarioBody),
      cardEl('Lage in der Fabrik', 'Roboter im Snapshot (blass = nicht in <i>R</i>) · <b>#</b> = Abholort · dunkle Linie = gewählt (Code)', mapHost)),
    section(2, el('div', { class: 'grid oh-main' },
      cardEl('Die Codes', 'Bits mit Stellenwert · Codebuch: blau = gewählt, rot gestrichelt = ungenutzt · Klick schaltet', quickHost, boardHost),
      section(3, cardEl('Energie dieses Zustands', 'Jeder Beitrag einzeln', togglesHost, weightsHost, energyHost)))),
    section(6, el('div', { class: 'grid grid-2' },
      cardEl('QUBO-Matrix', 'Nach den Hilfsbits · Hover erklärt · umrandet = zählt jetzt', matrixHost),
      cardEl('Kopplungsgraph & Hardware', 'Knoten = Qubits (Zeile = Code, links Code-Bits, rechts Hilfsbits), Linien = Kopplungen', graphHost, metricsHost))),
    section(6, el('div', { class: 'grid grid-2' },
      cardEl('Normierte QUBO-Matrix', 'Q / max|Q| · blau = Belohnung, rot = Strafe', normHost),
      cardEl('Energielandschaft', 'Alle Zustände als Fläche · Ziehen dreht, Scrollen zoomt', landHost))),
    section(3, cardEl('Bewertungskriterium', 'Kosten <i>c</i><sub>t,r</sub> wie bei One-Hot – hier verteilt auf die Produkte eines Codes', criterionHost)),
    section(3, cardEl('Die Formel dahinter', 'Indikator-Produkte, Grad, Hilfsbits · Hover hebt Bits hervor', formulaHost)),
    section(3, cardEl('Die günstigsten Zustände', 'Alle Stellungen nach Energie · Klick lädt', rankHost, stripHost)));
  root.append(layout);

  const map = createLayoutMap(mapHost, { entities: run.entities, robots: run.robots, entityLabels: false });
  const landscape = createLandscape(normHost, landHost);
  let matrixView = null;
  let graphView = null;
  const formula = createIaBinFormulaPanel(formulaHost, {
    getState: () => ({ data: st.data, x: st.x, A: st.A, B: st.B, M: st.M, terms: st.terms, step: st.step, model: st.model, qubo: quboMode() }),
    highlight: (sel) => highlightBoard(sel),
    clearHighlight: () => highlightBoard(null),
    setWeight: (key, value) => { st[key] = value; update(); },
    describe: (x) => describeState(x),
  });
  if (BIN_IA_DEFAULT_TAB[st.step]) formula.setTab(BIN_IA_DEFAULT_TAB[st.step], false);
  if (BIN_IA_TABS.some((t) => t.key === params.formel)) formula.setTab(params.formel, false);
  // Gewichte per Link (?A=100&B=40&M=750) haben Vorrang vor der automatischen Anpassung
  if (weightsFromParams(params, st, ['A', 'B', 'M'])) st.adjustWeights = false;
  const weights = createWeightControls(weightsHost, { onChange: (key, value) => { st[key] = value; scheduleUpdate(); } });
  const criterionPanel = createCriterionPanel(criterionHost, {
    getState: () => ({ data: st.data, weightNote: st.weightNote, selected: st.selected, overview: st.data?.overview,
      diagonalHint: `Kein Bit heißt „Roboter r gewählt“: Die Kosten stecken im Indikator-Produkt des Codes und verteilen sich auf Konstante, Bits und
        Bit-Produkte. <b>Exakt</b>: Jeder Roboter fährt höchstens einen Auftrag.` }),
    setCriterion: (key) => { st.criterion = key; st.adjustWeights = true; load(); },
    setParam: (key, value) => { st.costParams = { ...st.costParams, [key]: value }; st.adjustWeights = true; load(); },
    resetParams: () => { st.costParams = {}; st.adjustWeights = true; load(); },
  });
  let lastScenario = null;

  // ---------------------------------------------------------------- Szenario-Auswahl
  function drawScenario(error) {
    const d = st.data?.instance;
    renderScenario(scenarioBody, {
      tasks, st, load, error,
      extra: d ? robotPicker(d, st.mode, toggleRobot) : null,
      note: d ? `Alle Aufträge sehen die Flotte von Anfrage #${d.snapshot.transport_id} (t = ${nf(d.snapshot.time)} s).${d.robots_fallback ? ' Die gewählten Roboter sind hier belegt – R = alle freien.' : ''}` : null,
    });
  }
  const robotIds = () => st.data.instance.robots.map((r) => r.robot_id);
  const pool = () => st.data.instance.fleet.filter((r) => st.mode === 'alle' || r.available).map((r) => r.robot_id);
  function toggleRobot(id) {
    const next = toggledRobots(robotIds(), id);
    if (!next) return; // mindestens ein Roboter
    st.robots = next;
    st.caseNote = '';
    load();
  }
  function goCase(key) {
    st.caseNote = applyCase(key, { st, tasks, robotIds: robotIds(), pool: pool() });
    if (st.caseNote) update(); else load();
  }

  // ---------------------------------------------------------------- Daten laden
  async function load() {
    drawScenario();
    const q = new URLSearchParams({ tasks: st.selected.join(','), variables: st.mode, kriterium: st.criterion, params: JSON.stringify(st.costParams) });
    if (st.robots) q.set('robots', st.robots.join(','));
    try {
      st.data = await api(`/api/runs/${encodeURIComponent(run.run_id)}/ia/binary?${q}`);
    } catch (err) {
      drawScenario(`Konnte die Formulierung nicht laden: ${err.message}`);
      return;
    }
    const f = st.data.formulation;
    const scenario = `${st.selected}|${robotIds()}|${st.mode}`;
    if (lastScenario !== null && scenario !== lastScenario) st.adjustWeights = true;
    lastScenario = scenario;
    if (st.adjustWeights && autoWeights()) {
      ({ A: st.A, B: st.B, M: st.M } = st.data.weights);
      st.weightNote = `A = 1,5 × größte Kosten (${nf(st.data.weights.c_max, 1)}) → ${nf(st.A)}, B = 1,5 × größte Kostenspannweite eines Codes (${nf(st.data.weights.spread, 1)}) → ${nf(st.B)}`
        + (f.aux.length ? `, M = 1,1 × größter Gewinn eines lügenden Hilfsbits → ${nf(st.M)}.` : '.');
    } else {
      st.weightNote = '';
    }
    st.adjustWeights = false;
    const prevX = st.x;
    st.x = new Uint8Array(f.n);
    if (prevX.length === f.n) st.x.set(prevX);
    makeHonest(st.x);
    st.resultKey = '';
    if (params.zustand && !st.initialStateApplied) {
      st.initialStateApplied = true;
      if (params.zustand === 'gierig') st.x = nearest();
      if (params.zustand === 'bester') st.x = planState(st.data.best);
      if (params.zustand === 'minimum') {
        compute();
        if (st.result) st.x = Uint8Array.from(st.result.min.x);
      }
    }
    matrixView = createMatrixView(matrixHost, { labels: f.bits.map((b, i) => bitLabel(i)), varName: bitLabel, describePart, onCellClick: flashBits });
    // Graph: Zeile = Code (Gruppe), links die Code-Bits, rechts die Hilfsbits dieser Gruppe
    const auxCol = new Map();
    for (const g of f.groups) f.aux.filter((a) => a.group === g.key).forEach((a, k) => auxCol.set(a.index, f.K + k + 1));
    const nCols = Math.max(1, ...f.bits.map((b) => (b.aux ? auxCol.get(b.index) ?? f.K + 1 : b.pos)));
    graphView = createGraphView(graphHost, {
      variables: f.bits.map((b) => ({ ...b, cost: 0, row: b.group ?? 'a', col: b.aux ? auxCol.get(b.index) ?? f.K + 1 : b.pos })),
      rowKeys: [...f.groups.map((g) => g.key), ...(f.aux.some((a) => a.group == null) ? ['a'] : [])],
      colKeys: Array.from({ length: nCols }, (_, k) => k + 1),
      rowLabel: (k) => (k === 'a' ? 'Hilfs' : groupLabel(k)), colLabel: (k) => (k <= f.K ? `Bit ${k}` : `a·${k - f.K}`), varName: bitLabel,
    });
    drawScenario();
    update();
  }

  // ---------------------------------------------------------------- Hilfen zur Beschreibung
  const inst = () => st.data.instance;
  const form = () => st.data.formulation;
  const crit = () => st.data.instance.criterion;
  const unit = () => crit().unit;
  const caseKey = () => form().case;
  const zeile = () => form().side === 'zeile';
  const quboMode = () => st.showAll || st.step >= 6;
  const taskOf = (id) => inst().tasks.find((t) => t.transport_id === id);
  const robotOf = (id) => inst().fleet.find((r) => r.robot_id === id);
  const member = (m) => (zeile() ? `R${m}` : `#${m}`);
  const groupLabel = (key) => (zeile() ? `#${key}` : `R${key}`);
  const stepTitle = (k) => (k === 5 && st.data ? crossTitle(caseKey()) : STEPS[k - 1].title);
  const bitLabel = (i) => bitText(form(), i);
  const termLabel = (k) => `${{ ungueltig: 'A·', quer: 'B·', hilfsbit: 'M·' }[k] || ''}${termName(k, caseKey()).replace(/<[^>]+>/g, '')} · ${termTitle(k, caseKey())}`;
  const termHtml = (k) => (k === 'kosten' ? `${objName(form().side)} · ${escapeHtml(crit().label)} [${escapeHtml(unit())}]`
    : `${{ ungueltig: 'A', quer: 'B', hilfsbit: 'M' }[k]}·${termName(k, caseKey())} · ${k === 'quer' ? `${crossTitle(caseKey())}: ${crossText(caseKey())}` : k === 'ungueltig' ? 'Ungültige Codes: kein Phantom' : 'Hilfsbits: a muss x·y sein'}`);
  function describePart(p) {
    const val = (p.c || 0) + (p.A || 0) * st.A + (p.B || 0) * st.B + (p.D || 0) * st.M;
    if (p.kind === 'hilfsbit') return `Hilfsbit ${bitLabel(p.aux)} = ${bitLabel(p.pair[0])}·${bitLabel(p.pair[1])}: ${fmtE(val)}`;
    return `${termTitle(p.kind, caseKey())}: ${fmtE(val)}`;
  }
  const decode = (x) => decodeIaBin(form(), x, quboMode());
  function describeState(x) {
    const dec = decode(x);
    return dec.groups.map((g) => {
      if (!g.gr.vars.length) return `${g.name}: –`;
      if (!g.ok) return `${g.name}: ✗ ${g.c.pattern}`;
      return zeile() ? `#${g.task}→R${g.robot}` : `R${g.robot}→#${g.task}`;
    }).join(' · ') + (dec.lies.length ? ` · ${dec.lies.length} Hilfsbit(s) lügen` : '');
  }
  const isValid = (x) => decode(x).valid;
  const planText = (p) => (p ? Object.entries(p.assignment).map(([t, r]) => `#${t}→R${r}`).join(' · ') : '–');
  /** Hilfsbits ehrlich setzen: a = x·y, in Reihenfolge (Hilfsbits können auf Hilfsbits aufbauen). */
  function makeHonest(x) {
    for (const a of form().aux) x[a.index] = x[a.pair[0]] * x[a.pair[1]];
    return x;
  }
  function setCode(x, gr, code) {
    gr.bits.forEach((i, j) => { x[i] = (code >> (form().K - 1 - j)) & 1; });
  }
  /** Jeder Code zeigt auf sein billigstes Mitglied – bei T ≤ R „jeder Auftrag den nächsten Roboter“. */
  function nearest() {
    const x = new Uint8Array(form().n);
    for (const gr of form().groups) {
      const ok = gr.codes.filter((c) => c.var != null);
      if (!ok.length) continue;
      setCode(x, gr, ok.reduce((b, c) => (c.cost < b.cost ? c : b)).code);
    }
    return makeHonest(x);
  }
  /** Ein Plan {Auftrag: Roboter} als Bits. */
  function planState(p) {
    const x = new Uint8Array(form().n);
    if (!p) return x;
    const pairs = Object.entries(p.assignment).map(([t, r]) => [Number(t), r]);
    for (const gr of form().groups) {
      const c = gr.codes.find((cc) => cc.var != null && pairs.some(([t, r]) => (zeile() ? t === gr.key && r === cc.member : t === cc.member && r === gr.key)));
      if (c) setCode(x, gr, c.code);
    }
    return makeHonest(x);
  }

  // ---------------------------------------------------------------- Rechnen
  /** Energie des aktuellen Modells: Polynom (Schritte 3–5) oder QUBO mit Hilfsbits. */
  const currentEnergy = (x) => (quboMode() ? energy(st.model, x) : polyEnergy(form(), x, st.A, st.B, st.terms));
  function compute() {
    const f = form();
    st.model = makeModel(f, { A: st.A, B: st.B, D: st.M, terms: st.terms });
    const key = `${quboMode()}|${st.A}|${st.B}|${st.M}|${TERMS.map((k) => (st.terms[k] ? 1 : 0)).join('')}|${f.n}|${st.selected}|${robotIds()}|${st.mode}|${crit().key}|${JSON.stringify(inst().params)}`;
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
  /** Polynom höheren Grades: nur die Code-Bits durchprobieren, Hilfsbits ehrlich. */
  function solvePoly() {
    const f = form();
    const nt = f.n_code_bits;
    if (nt > POLY_MAX_BITS) return null;
    const total = 2 ** nt;
    const all = new Float64Array(total);
    const x = new Uint8Array(f.n);
    const top = [];
    for (let mask = 0; mask < total; mask += 1) {
      for (let i = 0; i < nt; i += 1) x[i] = (mask >> i) & 1;
      const E = polyEnergy(f, x, st.A, st.B, st.terms);
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
      all, total, codeMask: (xx) => { let m = 0; for (let i = 0; i < nt; i += 1) if (xx[i]) m |= 1 << i; return m; } };
  }
  function minUnder(terms, qubo) {
    const prev = { terms: st.terms, resultKey: st.resultKey, result: st.result, showAll: st.showAll };
    st.terms = terms;
    if (qubo) st.showAll = true;
    st.resultKey = '';
    compute();
    const out = st.result ? { x: st.result.min.x, E: st.result.min.E } : null;
    Object.assign(st, prev);
    st.model = makeModel(form(), { A: st.A, B: st.B, D: st.M, terms: st.terms });
    return out;
  }

  // ---------------------------------------------------------------- Zeichnen
  function update() {
    if (!st.data) return;
    compute();
    renderStepper();
    renderCases();
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
        el('span', { class: 'step-n' }, k + 1), stepTitle(k + 1));
      b.addEventListener('click', () => goStep(k + 1));
      return b;
    }));
  }
  function goStep(k) {
    st.step = k;
    st.terms = st.showAll ? { ...ALL } : { ...STEPS[k - 1].terms };
    if (BIN_IA_DEFAULT_TAB[k]) formula.setTab(BIN_IA_DEFAULT_TAB[k], false);
    makeHonest(st.x);
    update();
  }
  function applyVisibility() {
    layout.querySelectorAll('[data-min-step]').forEach((n) => { n.hidden = !st.showAll && st.step < Number(n.dataset.minStep); });
    layout.querySelector('.oh-main').classList.toggle('single', !st.showAll && st.step < 3);
  }

  function renderCases() {
    renderCaseCards(caseHost, { cur: caseKey(), T: inst().tasks.length, R: inst().robots.length, note: st.caseNote, onPick: goCase,
      termsHtml: (k) => `${penName(SIDE[k])} + ${crossName(k)} + ${AUX_NAME} <span class="hint">· Code je ${SIDE[k] === 'zeile' ? 'Auftrag' : 'Roboter'}</span>` });
  }

  function renderExplain() {
    const d = inst();
    const f = form();
    const T = d.tasks.length;
    const R = d.robots.length;
    const side = f.side;
    const ck = caseKey();
    const best = st.data.best;
    const cmp = st.data.compare;
    const K = f.K;
    const L = f.members.length;
    const y = yName(side);
    const next = st.step < STEPS.length ? ` <button class="btn small primary" type="button" data-next>Weiter: ${st.step + 1} · ${stepTitle(st.step + 1)} →</button>` : '';
    const rest = T > R ? `<b>${T - R} Auftr${T - R === 1 ? 'ag bleibt' : 'äge bleiben'}</b> für die nächste Runde liegen.`
      : T < R ? `<b>${R - T} Roboter bleib${R - T === 1 ? 't' : 'en'} frei.</b>` : 'Jeder Roboter bekommt genau einen Auftrag.';
    const groupWord = side === 'zeile' ? 'Auftrag' : 'Roboter';
    const verdict = (m, dec) => (dec && dec.valid
      ? `<span class="okline">✓ gültig${best && Math.abs(m.E - best.value) < 1e-6 ? ' und gleich dem besten Plan durch Aufzählen' : ''}</span>`
      : `<span class="warnline">✗ ${dec ? dec.issues.map((i) => i.text).join(', ') : ''}</span>`);
    let html = '';
    if (st.step === 1) {
      html = `<b>T = ${T}</b> Aufträge (${d.tasks.map((t) => `#${t.transport_id}`).join(', ')}), <b>R = ${R}</b> Roboter (${d.robots.map((r) => `R${r.robot_id}`).join(', ')})
        → <b>Fall ${CASE_LABELS[ck]}</b>: ${CASE_TEXTS[ck]}. ${rest}
        <br>Ein Binärcode kann nur „genau eins“ – darum liegt er hier <b>je ${groupWord}</b> (${codeText(side)}).
        Frage: <b>Welcher Roboter übernimmt welchen Auftrag, damit ${escapeHtml(crit().goal)}?</b> – ${nf(st.data.n_valid)} gültige Pläne.
        <span class="hint">Fall oben umstellen oder Roboter im Szenario wählen.</span>`;
    } else if (st.step === 2) {
      const unused = 2 ** K - L;
      html = `Die ${side === 'zeile' ? 'Roboter' : 'Aufträge'} bekommen Nummern (${f.members.map((m, k) => `${member(m)} = ${f.groups[0]?.codes[k]?.pattern ?? k}`).join(', ')}),
        je ${groupWord} steht die gewählte Nummer im Zweiersystem: <b>K = ⌈log₂ ${L}⌉ = ${K} Bits</b> × ${f.groups.length} → <b>${f.n_code_bits} Bits</b>
        (One-Hot: ${cmp.one_hot.n}, Domain Wall: ${cmp.domain_wall.n}).
        <br>Jede Stellung ist genau ein Code – „${codeText(side)}“ ist eingebaut. ${y} = Produkt der Bits: 1 genau beim eigenen Code (Tabelle unter den Codes).
        ${unused ? `<br><span class="warnline">⚠ ${unused} Code${unused === 1 ? '' : 's'} ohne ${side === 'zeile' ? 'Roboter' : 'Auftrag'} (${f.groups[0].codes.filter((c) => c.status === 'ungenutzt').map((c) => c.pattern).join(', ')}) – rot im Codebuch.</span>` : ''}
        ${f.unrepresentable.length ? `<br><span class="warnline">⚠ ${f.unrepresentable.map(groupLabel).join(', ')}: niemand zuständig – nicht darstellbar.</span>` : ''}
        <b>Noch fehlt die Bewertung.</b>`;
    } else if (st.step === 3) {
      const m = minUnder({ kosten: true });
      const dec = m ? decode(m.x) : null;
      html = `${objName(side)} = Σ <i>c</i>·${y} nach <b>${escapeHtml(crit().en)}</b> (${escapeHtml(unit())}): ${formulaHtml(crit().formula)}.
        Jedes ${y} ist ein <b>Indikator-Produkt</b> (Code <code>01</code> = (1 − <i>b</i><sub>1</sub>)·<i>b</i><sub>2</sub>) – ein Polynom vom Grad ${K}.
        Minimum nur mit Kosten: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'}).
        ${dec && dec.issues.some((i) => i.kind === 'ungueltig') ? '<br><span class="warnline">⚠ Ungenutzte Codes haben keinen Kostenterm – sie kosten 0 und schlagen jeden echten.</span>'
    : dec && !dec.valid ? `<br><span class="warnline">⚠ ${dec.issues.map((i) => i.text).join(', ')} – das regelt erst die ${crossTitle(ck)}.</span>` : ''}`;
    } else if (st.step === 4) {
      const m = minUnder({ kosten: true, ungueltig: true });
      const dec = m ? decode(m.x) : null;
      const cross = dec ? dec.issues.filter((i) => i.kind === 'quer') : [];
      html = `<i>A</i>·${penName(side)}: je ungenutztem Code <b>A · Indikator</b>. ${2 ** K - L ? `Hier ${2 ** K - L} je ${groupWord}${K > 2 ? ' – schon Terme mit drei Bits' : ''}.`
    : `Hier ist ${L} eine Zweierpotenz – keine ungenutzten Codes, die Regel ist leer.`}
        Minimum: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'}).
        ${cross.length ? `<br><span class="warnline">⚠ ${cross.map((i) => i.text).join(', ')} – das verbietet erst die ${crossTitle(ck)}.</span>` : ''}`;
    } else if (st.step === 5) {
      const m = minUnder({ kosten: true, ungueltig: true, quer: true });
      const dec = m ? decode(m.x) : null;
      const g = nearest();
      const gv = decode(g).issues.filter((i) => i.kind === 'quer');
      html = `<i>B</i>·${crossName(ck)} = <b>${crossText(ck)}</b> – die One-Hot-Regel mit <i>x</i> = ${y}. Sie <b>multipliziert zwei Codes</b>: Grad bis 2K = ${2 * K}. ${rest}
        ${gv.length ? `<br>„Jeder Code nimmt das billigste Mitglied“ (${describeState(g)}) bricht sie: ${gv.map((i) => i.text).join(', ')}.` : ''}
        <br>Minimum des Polynoms bei A = ${nf(st.A)}, B = ${nf(st.B)}: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'}) ${verdict(m, dec)}
        ${f.max_degree > 2 ? `<br><span class="warnline">Grad ${f.max_degree} – das ist noch keine QUBO. Es fehlen die Hilfsbits.</span>` : '<br>Höchster Grad 2 – schon eine QUBO, keine Hilfsbits nötig.'}`;
    } else if (st.step === 6) {
      const m = minUnder(ALL, true);
      const dec = m ? decode(m.x) : null;
      html = f.aux.length
        ? `${AUX_NAME}: Ein Hilfsbit <b>a</b> ersetzt ein Bitpaar desselben Codes und kostet <b>M·(xy − 2xa − 2ya + 3a)</b> – 0 bei a = x·y, sonst ≥ M.
        Hier <b>${f.aux.length} Hilfsbits</b> (${f.aux.slice(0, 6).map((a) => `${bitLabel(a.index)} = ${bitLabel(a.pair[0])}·${bitLabel(a.pair[1])}`).join(', ')}${f.aux.length > 6 ? ', …' : ''}),
        je Code höchstens 2<sup>${K}</sup> − ${K} − 1 = ${2 ** K - K - 1} – zusammen <b>${f.n} Qubits</b>.
        <br>QUBO-Minimum bei M = ${nf(st.M)}: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'}) ${verdict(m, dec)}
        <br>Zu kleines M: ein Hilfsbit <b>lügt</b> und dreht eine Strafe in eine Belohnung. Empfehlung M = ${nf(st.data.weights.M)} – ${nf(st.data.weights.M / Math.max(1, st.B), 0)}× B.`
        : `<b>Keine Hilfsbits nötig:</b> höchster Grad ${f.max_degree} (${K < 2 ? 'K = 1: jedes y ist linear' : 'nur ein Code – keine Querregel'}).
        Minimum: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'}) ${verdict(m, dec)}`;
    } else {
      const mc = metrics();
      html = `<b>${mc.n} Qubits</b> (${f.n_code_bits} Code-Bits + ${f.aux.length} Hilfsbits) und <b>${mc.couplings} Kopplungen</b>, davon ${mc.byKind.hilfsbit} aus ${AUX_NAME}.
        One-Hot ${cmp.one_hot.n} / ${cmp.one_hot.couplings}, Domain Wall ${cmp.domain_wall.n} / ${cmp.domain_wall.couplings}.
        Mit Hilfsbits braucht jeder Code 2<sup>K</sup> − 1 Qubits – nie weniger als eine Domain-Wall-Kette (L − 1), gleich bei L = 2<sup>K</sup>.
        Größter |Koeffizient| <b>${fmtE(mc.maxCoef)}</b> – M treibt die nötige Präzision hoch.`;
    }
    explain.innerHTML = `<div class="explain-title">Schritt ${st.step} · ${stepTitle(st.step)}</div><div>${html}</div>${next ? `<div style="margin-top:8px">${next}</div>` : ''}`;
    const nb = explain.querySelector('[data-next]');
    if (nb) nb.addEventListener('click', () => goStep(st.step + 1));
  }

  function renderMap() {
    const d = inst();
    const dec = decode(st.x);
    const inR = new Set(robotIds());
    map.setRobots(d.fleet.map((r) => ({ ...r, dim: !inR.has(r.robot_id) })));
    map.setHalos(d.tasks.map((t) => ({ ...t.pickup, color: C.accent })));
    map.setLabels(d.tasks.map((t) => ({ ...t.pickup, text: `#${t.transport_id}`, color: C.accent })));
    map.setArrows(d.tasks.map((t) => ({ from: t.pickup, to: t.drop, color: C.accent, width: 1.6, opacity: 0.6,
      tip: tipHtml(`Auftrag #${t.transport_id}`, [`${escapeHtml(t.from_entity)} → ${escapeHtml(t.to_entity)}`]) })));
    map.setLines(dec.groups.filter((g) => g.ok).map((g) => {
      const r = robotOf(g.robot);
      return { from: { x: r.x, y: r.y }, to: taskOf(g.task).pickup, label: nf(g.cost, 1), color: C.ink, opacity: 1 };
    }));
  }

  // ---------------------------------------------------------------- Codes, y-Tabelle und Hilfsbits
  function renderBoard() {
    const f = form();
    const dec = decode(st.x);
    const showCost = st.step >= 3 || st.showAll;
    const keepHonest = () => { if (st.honest || !quboMode()) makeHonest(st.x); };
    const rows = dec.groups.map((g) => {
      const gr = g.gr;
      const head = zeile()
        ? el('div', { class: 'dw-head', 'data-task': gr.key }, el('div', {}, el('strong', {}, `#${gr.key}`)),
          el('div', { class: 'hint' }, `${shortName(taskOf(gr.key).from_entity)} → ${shortName(taskOf(gr.key).to_entity)}`))
        : el('div', { class: 'dw-head', 'data-robot': gr.key }, el('div', {}, el('strong', {}, `R${gr.key}`)),
          el('div', { class: 'hint' }, el('span', { class: 'dot-inline', style: { background: statusColor(robotOf(gr.key).status) } }), robotOf(gr.key).available ? ' frei' : ' belegt'));
      if (!gr.vars.length) return el('div', { class: 'bin-row' }, head, el('div', { class: 'hint' }, 'niemand zuständig – nicht darstellbar'));
      const bitsEl = el('div', { class: 'bin-bits' }, f.K
        ? gr.bits.map((i, j) => {
          const b = el('button', { class: `cell dw-bit switch${st.x[i] ? ' on' : ''}`, type: 'button', 'data-var': i, 'data-group': gr.key,
            'aria-pressed': String(Boolean(st.x[i])), 'aria-label': `${bitLabel(i)} umschalten` },
          el('span', { class: 'bit' }, st.x[i] ? '1' : '0'), el('span', { class: 'var' }, bitLabel(i)), el('span', { class: 'cost' }, `×${2 ** (f.K - 1 - j)}`));
          b.addEventListener('click', () => { st.x[i] = st.x[i] ? 0 : 1; keepHonest(); update(); });
          return b;
        })
        : el('span', { class: 'hint' }, '0 Bits – nur ein Mitglied'));
      const result = el('div', { class: `bin-code ${g.ok ? 'good' : 'bad'}` },
        el('div', { class: 'hint' }, `Code ${g.c.pattern || '–'}`),
        el('div', {}, g.ok ? `→ ${member(g.c.member)}` : `✗ ${g.c.status}`),
        showCost && g.ok ? el('div', { class: 'hint' }, `${fmtE(g.cost)} ${unit()}`) : null);
      const book = el('div', { class: 'bin-book' }, gr.codes.map((c) => {
        const chip = el('button', { class: `bin-chip${c.code === g.code ? ' current' : ''}${c.var == null ? ' phantom' : ''}`, type: 'button',
          'data-member': c.member ?? '', title: 'Code laden' },
        el('span', { class: 'mono' }, c.pattern || '–'), el('span', {}, c.member != null ? member(c.member) + (c.var == null ? ' ✗' : '') : 'ungenutzt'),
        showCost ? el('span', { class: 'hint' }, c.var != null ? fmtE(c.cost) : (st.terms.ungueltig ? `A = ${nf(st.A)}` : '0 (!)')) : null);
        chip.addEventListener('click', () => { setCode(st.x, gr, c.code); keepHonest(); update(); });
        return chip;
      }));
      return el('div', { class: 'bin-row' }, head, bitsEl, result, book);
    });

    // y-Tabelle: Auftrag × Roboter, y = 1 genau beim eigenen Code; Summen nach den Regeln des Falls
    const d = inst();
    const varAt = new Map(d.variables.map((v) => [`${v.task_id}|${v.robot_id}`, v.index]));
    const crossBy = new Map(dec.cross.map((q) => [q.key, q]));
    const groupBy = new Map(dec.groups.map((g) => [g.gr.key, g]));
    const judgeCross = st.terms.quer || st.step >= 5 || st.showAll;
    const sumCell = (attrs, text, good, judge = true) => el('td', { class: `sum ${attrs.class}${judge ? (good ? ' good' : ' bad') : ''}`, ...attrs.data }, text);
    const codeSum = (key, attrs) => {
      const g = groupBy.get(key);
      return sumCell(attrs, g && g.gr.vars.length ? `${g.ok ? 1 : 0} ${g.ok ? '✓' : '✗'}` : '–', g && g.ok);
    };
    const crossSum = (key, attrs) => {
      const q = crossBy.get(key);
      if (!q) return el('td');
      return sumCell(attrs, judgeCross ? `${q.n} ${q.ok ? '✓' : '✗'}` : String(q.n), q.ok, judgeCross);
    };
    const exactCross = CROSS_EXACT[caseKey()];
    const sumHead = (isCode) => (isCode ? 'Σ = 1 (Code)' : exactCross ? 'Σ = 1' : 'Σ ≤ 1');
    const y = yName(f.side);
    const yTable = el('table', { class: 'board xgrid' },
      el('thead', {}, el('tr', {}, el('th', { class: 'corner' }, `${y}: Auftrag ╲ Roboter`),
        d.robots.map((r) => el('th', { 'data-robot': r.robot_id }, `R${r.robot_id}`)),
        el('th', { title: zeile() ? 'genau ein Code je Auftrag' : crossText(caseKey()) }, sumHead(zeile())))),
      el('tbody', {}, d.tasks.map((t) => el('tr', {},
        el('th', { class: 'rowhead', 'data-task': t.transport_id }, `#${t.transport_id}`),
        d.robots.map((r) => {
          const v = varAt.get(`${t.transport_id}|${r.robot_id}`);
          if (v == null) return el('td', { class: 'x-cell none' }, '–');
          const yv = dec.ys[v] || 0;
          const td = el('td', { class: `x-cell${yv ? ' on' : ''}`, 'data-task': t.transport_id, 'data-robot': r.robot_id,
            title: `${y}${sub(t.transport_id)},${sub(r.robot_id)} = ${yv} · Klick: Code von ${zeile() ? `R${r.robot_id}` : `#${t.transport_id}`} setzen` }, String(yv));
          td.addEventListener('click', () => pickPair(t.transport_id, r.robot_id));
          return td;
        }),
        zeile() ? codeSum(t.transport_id, { class: 'row-sum', data: { 'data-task': t.transport_id } })
          : crossSum(t.transport_id, { class: 'row-sum', data: { 'data-task': t.transport_id } })))),
      el('tfoot', {}, el('tr', {}, el('th', { title: zeile() ? crossText(caseKey()) : 'genau ein Code je Roboter' }, sumHead(!zeile())),
        d.robots.map((r) => (zeile() ? crossSum(r.robot_id, { class: 'col-sum', data: { 'data-robot': r.robot_id } })
          : codeSum(r.robot_id, { class: 'col-sum', data: { 'data-robot': r.robot_id } }))),
        el('td'))));

    const auxEl = quboMode() && f.aux.length
      ? el('div', { class: 'bin-aux' },
        el('div', { class: 'filter-label' }, `Hilfsbits ${f.aux.length} (Qubits für Paare):`),
        f.aux.map((a) => {
          const honestVal = st.x[a.pair[0]] * st.x[a.pair[1]];
          const lies = st.x[a.index] !== honestVal;
          const b = el('button', { class: `cell dw-bit switch${st.x[a.index] ? ' on' : ''}${lies ? ' lie' : ''}`, type: 'button', 'data-var': a.index,
            'data-group': a.group ?? '', 'aria-label': `${bitLabel(a.index)} umschalten` },
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
    fill(boardHost, el('div', { class: 'dw-board' }, rows), auxEl,
      el('h4', { style: { marginTop: '14px' }, html: `Daraus: <i>x</i><sub>t,r</sub> = <i>${y}</i><sub>t,r</sub> = Produkt der Code-Bits <span class="hint">· Klick setzt den Code · immer 0 oder 1</span>` }),
      el('div', { class: 'table-wrap' }, yTable));

    fill(quickHost,
      el('button', { class: 'btn small', type: 'button', title: 'Alle Bits 0: jeder Code wählt Nummer 0',
        onclick: () => { st.x = makeHonest(new Uint8Array(f.n)); update(); } }, 'Alle aus'),
      el('button', { class: 'btn small', type: 'button', title: zeile() ? 'Jeder Auftrag nimmt den nächsten Roboter – auch doppelt' : 'Jeder Roboter nimmt seinen billigsten Auftrag – auch doppelt',
        onclick: () => { st.x = nearest(); update(); } }, zeile() ? 'Jeder nimmt den nächsten' : 'Jeder Roboter das Billigste'),
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = Uint8Array.from(f.bits, () => (Math.random() < 0.5 ? 1 : 0)); keepHonest(); update(); } }, 'Zufall'),
      st.step >= 3 || st.showAll
        ? el('button', { class: 'btn small primary', type: 'button', disabled: !st.result, title: 'Den Zustand mit der niedrigsten Energie laden',
          onclick: () => { st.x = Uint8Array.from(st.result.min.x); update(); } }, 'Minimum laden')
        : null,
      st.step >= 3 || st.showAll
        ? el('button', { class: 'btn small', type: 'button', disabled: !st.data.best, title: `Bester gültiger Plan durch Aufzählen aller ${nf(st.data.n_valid)} gültigen Pläne`,
          onclick: () => { st.x = planState(st.data.best); update(); } }, 'Bester gültiger Plan')
        : null,
      quboMode() && f.aux.length ? el('button', { class: 'btn small', type: 'button', onclick: () => { makeHonest(st.x); update(); } }, 'Hilfsbits ehrlich setzen') : null,
      ...['one-hot', 'domain-wall'].map((v) => el('a', { class: 'btn small',
        href: `#/ia/${v}?auftraege=${st.selected.join(',')}&roboter=${robotIds().join(',')}&kriterium=${st.criterion}${st.mode === 'alle' ? '&modus=alle' : ''}&schritt=${Math.min(st.step, 6)}`,
        title: `Dieselben Aufträge und Roboter mit ${v === 'one-hot' ? 'One-Hot' : 'Domain Wall'}` }, `Vergleich: ${v === 'one-hot' ? 'One-Hot' : 'Domain Wall'} →`)));
  }
  /** Klick in die y-Tabelle: Code der passenden Gruppe auf dieses Paar setzen. */
  function pickPair(task, robot) {
    const gr = form().groups.find((g) => g.key === (zeile() ? task : robot));
    const c = gr?.codes.find((cc) => cc.var != null && cc.member === (zeile() ? robot : task));
    if (!c) return;
    setCode(st.x, gr, c.code);
    if (st.honest || !quboMode()) makeHonest(st.x);
    update();
  }

  function renderControls() {
    fill(togglesHost, el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Terme'),
      TERMS.filter((k) => k !== 'hilfsbit' || quboMode()).map((k) => {
        const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(Boolean(st.terms[k])), title: termLabel(k) },
          el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }), el('span', { html: termName(k, caseKey()) }));
        b.addEventListener('click', () => { st.terms[k] = !st.terms[k]; update(); });
        return b;
      })));
    const rec = st.data.weights;
    const items = [];
    if (st.step >= 4 || st.showAll) items.push({ key: 'A', label: `A · ungültige Codes ${penName(form().side).replace(/<[^>]+>/g, '')}`, color: TERM_COLORS.ungueltig, value: st.A, recommended: rec.A, hint: '> größte Kosten' });
    if (st.step >= 5 || st.showAll) items.push({ key: 'B', label: `B · ${crossTitle(caseKey())} ${crossName(caseKey()).replace(/<[^>]+>/g, '')}`, color: TERM_COLORS.quer, value: st.B, recommended: rec.B, hint: '> Kostenspannweite eines Codes' });
    if (quboMode() && form().aux.length) items.push({ key: 'M', label: 'M · Hilfsbits H_Aux', color: TERM_COLORS.hilfsbit, value: st.M, recommended: rec.M, hint: '> Gewinn eines lügenden Hilfsbits' });
    weightsHost.hidden = !items.length;
    if (items.length) weights.render({ items, note: 'Empfehlung A = 1,5 × c_max, B = 1,5 × Spannweite, M = 1,1 × größter Lügengewinn – per Brute Force an echten Momenten geprüft.' });
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
        for (const p of e.activeParts) sums[p.kind] += (p.c || 0) + (p.A || 0) * st.A + (p.B || 0) * st.B + (p.D || 0) * st.M;
      }
      for (const p of f.const_parts) if (st.terms[p.kind]) sums[p.kind] += (p.c || 0) + (p.A || 0) * st.A + (p.B || 0) * st.B + (p.D || 0) * st.M;
    } else {
      for (const k of ['kosten', 'ungueltig', 'quer']) if (st.terms[k]) sums[k] = polyEnergy(f, st.x, st.A, st.B, { [k]: true });
    }
    const items = { kosten: [], ungueltig: [], quer: [], hilfsbit: [] };
    for (const g of dec.groups) {
      if (!g.gr.vars.length) continue;
      if (g.ok) items.kosten.push({ text: `${g.name} → ${member(g.c.member)}: ${fmtE(g.cost)} ${unit()}` });
      else {
        items.kosten.push({ ok: false, text: `${g.name}: Code ${g.c.pattern} ${g.c.status} – kein Kostenterm, kostet 0` });
        items.ungueltig.push({ ok: false, text: `${g.name}: Code ${g.c.pattern} → A = ${fmtE(st.A)}` });
      }
    }
    for (const q of dec.cross) {
      const val = st.B * q.penalty;
      const ys = q.vals.join(' + ');
      items.quer.push({ ok: q.ok, text: `${q.name}: Σ${yName(f.side)} = ${ys || 0} = ${q.n} → ${q.rule.exact ? `B·(1 − ${q.n})²` : `B·${q.penalty} Paar${q.penalty === 1 ? '' : 'e'}`} = ${fmtE(val)}${q.ok ? ' ✓' : ''}` });
    }
    if (qubo) {
      for (const a of f.aux) {
        const h = st.x[a.pair[0]] * st.x[a.pair[1]];
        const w = st.x[a.index];
        const pen = h - 2 * st.x[a.pair[0]] * w - 2 * st.x[a.pair[1]] * w + 3 * w;
        if (w !== h) items.hilfsbit.push({ ok: false, text: `${bitLabel(a.index)} = ${w}, aber ${bitLabel(a.pair[0])}·${bitLabel(a.pair[1])} = ${h} → lügt: M·${pen} = ${fmtE(st.M * pen)}` });
      }
    }
    const shown = TERMS.filter((k) => k !== 'hilfsbit' || qubo);
    const E = shown.reduce((s, k) => s + (st.terms[k] ? sums[k] : 0), 0);
    const truth = polyEnergy(f, st.x, st.A, st.B, st.terms);
    const rank = st.result?.all ? rankOf(st.result, st.result.kind === 'poly' ? st.result.codeMask(st.x) : toMask(st.x)) : null;
    const empty = { kosten: 'keine Codes', ungueltig: 'kein ungenutzter Code ✓', quer: 'keine Gruppe', hilfsbit: f.aux.length ? 'alle Hilfsbits ehrlich ✓' : 'keine Hilfsbits nötig' };
    const group = (k) => el('div', { class: `egroup${st.terms[k] ? '' : ' off'}` },
      el('div', { class: 'egroup-head' }, el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }),
        el('span', { html: termHtml(k) }), el('strong', {}, st.terms[k] ? fmtE(sums[k]) : 'aus')),
      items[k].length ? el('ul', {}, items[k].map((p) => el('li', { class: p.ok === false ? 'bad' : p.ok ? 'good' : '' }, p.text))) : el('div', { class: 'hint' }, empty[k]));
    fill(energyHost,
      el('div', { class: 'etotal' },
        el('div', {}, el('div', { class: 'hint' }, qubo ? 'Energie der QUBO' : `Energie des Polynoms (Grad ${f.max_degree})`), el('div', { class: 'ebig' }, fmtE(E))),
        el('div', { class: 'erank' },
          rank ? el('div', {}, `Platz ${nf(rank)} von ${nf(st.result.total)}`) : null,
          el('div', { class: dec.valid ? 'okline' : 'warnline' }, dec.valid ? '✓ gültige Zuweisung' : `✗ ${dec.issues.map((i) => i.text).join(' · ')}`))),
      el('div', { class: 'ebar' }, shown.filter((k) => st.terms[k] && sums[k] > 0).map((k) => withTip(
        el('div', { style: { flex: `${sums[k]} 0 0`, background: TERM_COLORS[k] } }), tipHtml(termLabel(k), [fmtE(sums[k])])))),
      ...shown.map(group),
      qubo ? el('p', { class: Math.abs(E - truth) < 1e-6 ? 'hint' : 'warnline' },
        Math.abs(E - truth) < 1e-6 ? `Probe: QUBO = Polynom = ${fmtE(truth)} ✓ (Hilfsbits ehrlich)`
          : `QUBO ${fmtE(E)}, wahres Polynom ${fmtE(truth)} – der Unterschied kommt von lügenden Hilfsbits.`) : null,
      qubo ? el('p', { class: 'hint' }, `Probe über die Matrix: xᵀQx + Konstante = ${fmtE(currentEnergy(st.x))} ${Math.abs(currentEnergy(st.x) - E) < 1e-6 ? '✓ identisch' : '✗ ABWEICHUNG'}`) : null);
  }

  function renderRanking() {
    if (!(st.step >= 3 || st.showAll)) return;
    const f = form();
    if (!st.result) {
      rankHost.replaceChildren(el('p', { class: 'hint' }, `${f.n_code_bits} Code-Bits – das Polynom wird bis ${POLY_MAX_BITS} Bits durchprobiert.`));
      Plotly.purge(stripHost);
      return;
    }
    const res = st.result;
    const cur = res.kind === 'poly' ? res.codeMask(st.x) : (f.n <= 31 ? toMask(st.x) : -1);
    rankHost.replaceChildren(
      st.data.best ? el('p', { class: 'hint' }, `Bester gültiger Plan durch Aufzählen (${nf(st.data.n_valid)} gültige Pläne): ${planText(st.data.best)}, Σ c = ${fmtE(st.data.best.value)} ${unit()}.`) : null,
      el('p', { class: 'hint' }, res.kind === 'poly' ? `Polynom: alle ${nf(res.total)} Stellungen der Code-Bits durchprobiert (Hilfsbits ab Schritt 6).`
        : res.exhaustive ? `QUBO: alle ${nf(res.total)} Zustände inkl. Hilfsbits durchprobiert.` : `QUBO mit ${f.n} Qubits: Simulated Annealing (Heuristik).`),
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
    const nBits = res.kind === 'poly' ? f.n_code_bits : f.n;
    if (res.all && nBits <= MAX_STORE_BITS) {
      const all = res.all;
      const order = Array.from(all.keys()).sort((a, b) => all[a] - all[b]);
      const xOf = (m) => {
        if (res.kind === 'qubo') return fromMask(m, f.n);
        const xx = new Uint8Array(f.n);
        for (let i = 0; i < f.n_code_bits; i += 1) xx[i] = (m >> i) & 1;
        return makeHonest(xx);
      };
      const valid = order.map((m) => isValid(xOf(m)));
      const curRank = order.indexOf(cur);
      stripHost.style.minHeight = '';
      if (stripHost.querySelector('p')) stripHost.replaceChildren();
      plot(stripHost, [
        { type: 'scattergl', mode: 'markers', x: order.map((_, k) => k + 1), y: order.map((m) => all[m]),
          marker: { size: nBits > 12 ? 3 : 6, color: valid.map((ok) => (ok ? C.series : C.axis)) }, customdata: order,
          hovertemplate: 'Platz %{x}: H = %{y}<extra></extra>', name: 'Zustände' },
        ...(curRank >= 0 ? [{ type: 'scatter', mode: 'markers', x: [curRank + 1], y: [all[cur]], marker: { size: 14, color: C.accent, line: { color: C.surface, width: 2 } },
          hovertemplate: 'dein Zustand: Platz %{x}, H = %{y}<extra></extra>', name: 'dein Zustand' }] : []),
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
    const T = inst().tasks.length;
    const R = inst().robots.length;
    const qk = (z) => `${z.n} / ${z.couplings}`;
    const sizeRows = st.data.sizes.map((z) => {
      const best = Math.min(z.one_hot.couplings, z.domain_wall.couplings, z.binary.couplings);
      const fewest = [['One-Hot', z.one_hot], ['Domain Wall', z.domain_wall], ['Binary', z.binary]].filter(([, v]) => v.couplings === best).map(([k]) => k).join(', ');
      return el('tr', { class: z.T === T ? 'selected' : '' }, el('td', { class: 'num' }, z.T), el('td', {}, CASE_LABELS[z.case]),
        el('td', { class: 'num' }, qk(z.one_hot)), el('td', { class: 'num' }, qk(z.domain_wall)),
        el('td', { class: 'num' }, `${qk(z.binary)}${z.binary.aux ? ` (${z.binary.aux} Hilfsbits)` : ''}`), el('td', {}, fewest));
    });
    const degRows = Object.entries(f.degrees_before).map(([dg, n]) => el('tr', { class: Number(dg) > 2 ? 'warnrow' : '' },
      el('td', { class: 'num' }, dg), el('td', { class: 'num' }, nf(n)), el('td', {}, Number(dg) > 2 ? 'kein QUBO-Term → Hilfsbits' : 'QUBO-tauglich')));
    fill(metricsHost,
      el('div', { class: 'kpis', style: { marginTop: '10px' } },
        kpiSmall('Variablen (Qubits)', nf(mc.n), `${f.n_code_bits} Code-Bits + ${f.aux.length} Hilfsbits · One-Hot ${cmp.one_hot.n}, Domain Wall ${cmp.domain_wall.n}`),
        kpiSmall('Kopplungen', nf(mc.couplings), `davon ${mc.byKind.hilfsbit} aus Hilfsbits · One-Hot ${cmp.one_hot.couplings}, Domain Wall ${cmp.domain_wall.couplings}`),
        kpiSmall('Größter |Koeffizient|', fmtE(mc.maxCoef), `M = ${nf(st.M)} treibt ihn hoch`)),
      el('h4', {}, `Qubits / Kopplungen der drei Kodierungen – ${R} Roboter, volle Zuständigkeit`),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'T'), el('th', {}, 'Fall'), el('th', { class: 'num' }, 'One-Hot'),
          el('th', { class: 'num' }, 'Domain Wall'), el('th', { class: 'num' }, 'Binary'), el('th', {}, 'weniger Kopplungen'))),
        el('tbody', {}, sizeRows))),
      el('p', { class: 'hint', html: `Binary mit <i>G</i> Codes zu je <i>K</i> Bits: <i>G·K</i> Code-Bits; koppelt die Querregel mindestens zwei Codes, kommen je Code
        2<sup><i>K</i></sup> − <i>K</i> − 1 Hilfsbits dazu → <i>G</i>(2<sup><i>K</i></sup> − 1) Qubits, Domain Wall <i>G</i>(<i>L</i> − 1). Gleich nur bei <i>L</i> = 2<sup><i>K</i></sup>.
        Hervorgehoben: dein Szenario (T = ${T}).` }),
      el('h4', {}, 'Terme vor den Hilfsbits nach Grad'),
      el('table', { class: 'data' }, el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'Grad'), el('th', { class: 'num' }, 'Terme'), el('th', {}, ''))),
        el('tbody', {}, degRows)),
      el('div', { class: 'legend' }, ['ungueltig', 'quer', 'hilfsbit'].map((k) => el('span', { class: 'legend-item' },
        el('span', { class: 'swatch', style: { background: TERM_COLORS[k], height: '3px' } }), termLabel(k)))));
  }

  /** Hebt Bits, Codes, Aufträge oder Roboter hervor (von der Formel aus). */
  function highlightBoard(sel) {
    boardHost.querySelectorAll('.hl').forEach((n) => n.classList.remove('hl'));
    if (!sel) return;
    const q = [];
    (sel.vars || []).forEach((i) => q.push(`[data-var="${i}"]`));
    if (sel.task != null) q.push(`[data-task="${sel.task}"]`, ...(zeile() ? [`.bin-bits [data-group="${sel.task}"]`] : [`.bin-chip[data-member="${sel.task}"]`]));
    if (sel.robot != null) q.push(`[data-robot="${sel.robot}"]`, ...(zeile() ? [`.bin-chip[data-member="${sel.robot}"]`] : [`.bin-bits [data-group="${sel.robot}"]`]));
    if (sel.kind === 'kosten' || sel.all) q.push('.bin-bits .dw-bit');
    if (sel.kind === 'ungueltig') q.push('.bin-chip.phantom');
    if (sel.kind === 'quer') q.push(zeile() ? '.col-sum' : '.row-sum');
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
