// Reiter „Kodierungen TA“: Zuweisung mit Reihenfolge, Ziel Lastausgleich (Workload Balancing) – One-Hot, Domain Wall, Binary.
// H = H_obj + A·H_pen + B·H_WB, H_WB = Σ_r (L_r,0 + Σ_t c_tr x_tr)². Ein Roboter darf mehrere Aufträge fahren; gezählt wird
// nur seine Last, nicht die Reihenfolge – darum kommen die Seiten ohne Positionen und Zeitraster aus.
// Eine Seite für alle drei Kodierungen; was sie unterscheidet, steht in taWorkloadEncodings.js.
// Formulierung: encodings/workload.py · Aufbau wie die IA-Seiten (Schritte, Brett, Energie, QUBO, Formel, Rangliste)
import { el, fill, nf, withTip, tipHtml, escapeHtml } from '../util.js';
import { C, TERM_COLORS, plot } from '../theme.js';
import { createLayoutMap } from '../components/layoutMap.js';
import { autoWeights, createWeightControls, weightsFromParams } from '../components/weightControls.js';
import { initialScenario, renderScenario } from '../components/scenario.js';
import { robotPicker, toggledRobots } from '../components/iaScenario.js';
import { MAX_SEARCH_BITS, MAX_STORE_BITS, anneal, energy, fromMask, makeModel, partValue, rankOf, search, toMask } from '../qubo/engine.js';
import { createMatrixView } from '../qubo/matrixView.js';
import { createGraphView } from '../qubo/graphView.js';
import { createLandscape } from '../components/landscape.js';
import { niceCeil, formulaHtml } from './onehotCriterion.js';
import {
  bestPlan, boundValue, drawTradeoff, enumeratePlans, loadStats, planText, planValue, recommendA, renderLoadBars, renderLoadSetup,
  robotLoads, sizesTable, xValues,
} from '../components/workload.js';
import { TA_ENCODINGS, makeHonest, setChain, setCode } from './taWorkloadEncodings.js';
import { WB_TABS, createWbFormulaPanel } from './taWorkloadFormula.js';

const POLY_MAX_BITS = 16; // Binary vor den Hilfsbits: Code-Bits werden bis hierhin durchprobiert
const fmtE = (v) => nf(v, 1).replace('-', '−');
const fmtB = (v) => nf(v, 4);
const DEFAULT_FORMULA_TAB = { 1: 'formel', 3: 'formel', 4: 'eingesetzt', 5: 'wirkung' };

export const renderTaOneHot = (root, ctx) => renderTaWorkload(root, ctx, TA_ENCODINGS.one_hot);
export const renderTaDomainWall = (root, ctx) => renderTaWorkload(root, ctx, TA_ENCODINGS.domain_wall);
export const renderTaBinary = (root, ctx) => renderTaWorkload(root, ctx, TA_ENCODINGS.binary);

function renderTaWorkload(root, { run, api, params }, E) {
  const tasks = run.tasks;
  const STEPS = E.steps;
  const LAST = STEPS.length;
  const ALL = { ...STEPS[LAST - 1].terms };
  const TERMS = Object.keys(ALL);
  const linkedRobots = String(params.roboter || '').split(',').map(Number).filter((id) => id > 0);
  const st = {
    step: Math.min(LAST, Math.max(1, Number(params.schritt) || 1)),
    showAll: false,
    ...initialScenario(tasks, params, 4),
    robots: null, // null = alle freien Roboter
    mode: params.modus === 'alle' ? 'alle' : 'kandidaten',
    measure: params.last || 'zeit',
    parts: params.anteile ? String(params.anteile).split(',') : null,
    vorlast: params.vorlast || 'status',
    costParams: {},
    A: 100, B: 0.01, M: 100,
    honest: true, // Binary: Hilfsbits beim Klicken ehrlich halten
    terms: {},
    data: null,
    plans: null,
    x: new Uint8Array(0),
    model: null,
    result: null,
    resultKey: '',
    adjustWeights: true,
    weightNote: '',
  };
  st.robots = linkedRobots.length ? linkedRobots : defaultRobots(run, tasks, st.selected, 3);

  // ---------------------------------------------------------------- Gerüst
  const stepper = el('div', { class: 'stepper' });
  const explain = el('div', { class: 'explain' });
  const showAllBox = el('input', { type: 'checkbox', id: `ta-${E.key}-all` });
  const scenarioBody = el('div');
  const mapHost = el('div');
  const boardHost = el('div');
  const quickHost = el('div', { class: 'quick' });
  const energyHost = el('div');
  const togglesHost = el('div');
  const weightsHost = el('div');
  const loadHost = el('div');
  const setupHost = el('div');
  const tradeHost = el('div', { class: 'chart' });
  const tradeNote = el('p', { class: 'hint' });
  const rankHost = el('div');
  const stripHost = el('div', { class: 'chart short' });
  const matrixHost = el('div');
  const graphHost = el('div');
  const metricsHost = el('div');
  const formulaHost = el('div');
  const normHost = el('div');
  const landHost = el('div');
  const section = (minStep, node) => { node.dataset.minStep = String(minStep); return node; };
  const cardEl = (title, sub2, ...body) => el('section', { class: 'card' },
    el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, title), sub2 ? el('div', { class: 'card-sub', html: sub2 }) : null)), ...body);

  const others = Object.values(TA_ENCODINGS).filter((o) => o !== E);
  root.append(el('p', {
    class: 'intro',
    html: `<strong>Zuweisung mit Reihenfolge (TA), Ziel Lastausgleich:</strong> Ein Roboter darf mehrere Aufträge fahren. Gezählt wird nur seine Last –
      ohne Positionen und Zeitraster. <i>H</i> = ${E.names.obj} + <i>A</i>·${E.names.pen} + <i>B</i>·${E.names.wb}${E.key === 'binary' ? ` + <i>M</i>·${E.names.aux}` : ''}.
      Vergleich: ${others.map((o) => `<a href="#/ta/${o.api}">${o.name}</a>`).join(', ')}, <a href="#/ia/${E.api}">${E.name} (IA)</a>.`,
  }));
  root.append(el('section', { class: 'card guide' }, stepper,
    el('label', { class: 'filter-group', for: `ta-${E.key}-all`, style: { marginTop: '6px' } }, showAllBox, el('span', { class: 'hint' }, 'Alles auf einmal zeigen')),
    explain));
  const qFrom = E.quboFrom;
  const layout = el('div', { class: 'grid', style: { marginTop: '16px' } },
    el('div', { class: 'grid grid-2' },
      cardEl('Szenario', 'Echter Moment der Simulation · Aufträge <i>T</i> und Roboter <i>R</i> wählen', scenarioBody),
      cardEl('Lage in der Fabrik', 'Roboter im Snapshot (blass = nicht in <i>R</i>) · <b>#</b> = Abholort · dunkle Linie = zugewiesen', mapHost)),
    section(2, el('div', { class: 'grid oh-main' },
      cardEl(E.boardTitle, E.boardSub, quickHost, boardHost),
      section(3, cardEl('Energie dieses Zustands', 'Jeder Beitrag einzeln', togglesHost, weightsHost, energyHost)))),
    section(3, el('div', { class: 'grid grid-2' },
      cardEl('Last je Roboter', '<i>L</i><sub>r</sub> = <i>L</i><sub>r,0</sub> (schraffiert) + Σ<sub>t</sub> <i>c</i><sub>t,r</sub> <i>x</i><sub>t,r</sub> · gestrichelt: bester Plan für B', loadHost),
      cardEl('Was fließt in die Last ein?', 'Bestimmt <i>c</i><sub>t,r</sub> und <i>L</i><sub>r,0</sub> – Lastmaß, Anteile, Vorlast', setupHost))),
    section(5, cardEl('Gesamtlast gegen Ausgleich', 'Jeder gültige Plan ein Punkt · blau = Pareto-Front · Klick lädt einen Plan', tradeHost, tradeNote)),
    section(qFrom, el('div', { class: 'grid grid-2' },
      cardEl('QUBO-Matrix', 'Hover erklärt · umrandet = zählt jetzt', matrixHost),
      cardEl('Kopplungsgraph & Hardware', 'Knoten = Qubits, Linien = Kopplungen · dick = beide an', graphHost, metricsHost))),
    section(qFrom, el('div', { class: 'grid grid-2' },
      cardEl('Normierte QUBO-Matrix', 'Q / max|Q| · blau = Belohnung, rot = Strafe', normHost),
      cardEl('Energielandschaft', 'Alle Zustände als Fläche · Ziehen dreht, Scrollen zoomt', landHost))),
    section(3, cardEl('Die Formel dahinter', 'Hover über Formelteile hebt Aufträge, Roboter und Bits hervor', formulaHost)),
    section(3, cardEl('Die günstigsten Zustände', 'Alle Stellungen nach Energie · Klick lädt', rankHost, stripHost)));
  root.append(layout);

  const map = createLayoutMap(mapHost, { entities: run.entities, robots: run.robots, entityLabels: false });
  const landscape = createLandscape(normHost, landHost);
  let matrixView = null;
  let graphView = null;
  const formula = createWbFormulaPanel(formulaHost, {
    getState: () => (st.data ? {
      data: st.data, E, x: st.x, A: st.A, B: st.B, M: st.M, terms: st.terms, step: st.step, model: st.model, qubo: quboMode(), dec: decode(st.x),
      plans: st.plans, bitLabel, cacheKey: scenarioKey(), ruleEnergy: ruleEnergy(st.x), quboEnergy: energy(fullModel(), st.x),
    } : { data: null }),
    highlight: (sel) => highlight(sel),
    clearHighlight: () => highlight(null),
    setWeight: (key, value) => { st[key] = value; update(); },
    describe: (x) => describeState(x),
    isValid: (x) => decode(x).valid,
  });
  if (DEFAULT_FORMULA_TAB[st.step]) formula.setTab(DEFAULT_FORMULA_TAB[st.step], false);
  if (WB_TABS.some((t) => t.key === params.formel)) formula.setTab(params.formel, false);
  // Gewichte per Link (?A=…&B=…&M=…) haben Vorrang vor der automatischen Anpassung
  if (weightsFromParams(params, st, ['A', 'B', 'M'])) st.adjustWeights = false;
  const weights = createWeightControls(weightsHost, { onChange: (key, value) => { st[key] = value; scheduleUpdate(); } });
  let lastScenario = null;

  // ---------------------------------------------------------------- Szenario
  function drawScenario(error) {
    const d = st.data?.instance;
    renderScenario(scenarioBody, {
      tasks, st, load, error,
      extra: d ? robotPicker(d, st.mode, toggleRobot) : null,
      note: d ? `Alle Aufträge sehen die Flotte von Anfrage #${d.snapshot.transport_id} (t = ${nf(d.snapshot.time)} s).${d.robots_fallback ? ' Die gewählten Roboter sind hier belegt – R = alle freien.' : ''}` : null,
    });
  }
  const robotIds = () => st.data.instance.robots.map((r) => r.robot_id);
  function toggleRobot(id) {
    const next = toggledRobots(robotIds(), id);
    if (!next) return;
    st.robots = next;
    load();
  }

  // ---------------------------------------------------------------- Laden
  async function load() {
    drawScenario();
    const q = new URLSearchParams({ tasks: st.selected.join(','), variables: st.mode, last: st.measure, vorlast: st.vorlast, params: JSON.stringify(st.costParams) });
    if (st.robots) q.set('robots', st.robots.join(','));
    if (st.parts) q.set('anteile', st.parts.join(','));
    try {
      st.data = await api(`/api/runs/${encodeURIComponent(run.run_id)}/ta/${E.api}?${q}`);
    } catch (err) {
      drawScenario(`Konnte die Formulierung nicht laden: ${err.message}`);
      return;
    }
    const f = form();
    const scenario = `${st.selected}|${robotIds()}|${st.mode}|${st.measure}|${inst().load_parts}|${st.vorlast}|${JSON.stringify(st.costParams)}`;
    if (lastScenario !== null && scenario !== lastScenario) st.adjustWeights = true;
    lastScenario = scenario;
    const w = st.data.weights;
    if (st.adjustWeights && autoWeights()) {
      st.A = w.A;
      st.B = w.B;
      st.M = w.M || st.M;
      st.weightNote = `B = 1 / (2·c̄) = 1 / (2·${fmtE(w.c_mean)}) → ${fmtB(st.B)}; A = 1,1 × Schranke bei diesem B → ${nf(st.A)}${f.aux.length ? `; M = 1,1 × größter Lügengewinn → ${nf(st.M)}` : ''}.`;
    } else {
      st.weightNote = '';
    }
    st.adjustWeights = false;
    st.plans = enumeratePlans(inst());
    const prevX = st.x;
    st.x = new Uint8Array(f.n);
    if (prevX.length === f.n) st.x.set(prevX);
    if (E.key === 'binary') makeHonest(f, st.x);
    st.resultKey = '';
    if (params.zustand && !st.initialStateApplied) {
      st.initialStateApplied = true;
      if (params.zustand === 'gierig') st.x = nearest();
      if (params.zustand === 'bester') st.x = planBits(bestPlan(st.plans, st.B));
      if (params.zustand === 'minimum') { compute(); if (st.result) st.x = Uint8Array.from(st.result.min.x); }
    }
    matrixView = createMatrixView(matrixHost, { labels: f.bits.map((b, i) => bitLabel(i)), varName: bitLabel, describePart, onCellClick: flash });
    graphView = createGraphView(graphHost, { ...E.graph(f, inst()), varName: bitLabel });
    drawScenario();
    update();
  }

  // ---------------------------------------------------------------- Hilfen
  const inst = () => st.data.instance;
  const form = () => st.data.formulation;
  const vars = () => st.data.instance.variables;
  const unit = () => inst().measure.unit;
  const quboMode = () => st.showAll || st.step >= E.quboFrom;
  const bitLabel = (i) => E.bitLabel(form(), i);
  const scenarioKey = () => `${st.selected}|${robotIds()}|${st.mode}|${st.measure}|${inst().load_parts}|${st.vorlast}|${JSON.stringify(inst().params)}`;
  const termName = (k) => ({ kosten: E.names.obj, last: E.names.wb, hilfsbit: E.names.aux }[k] || E.names.pen);
  const termTitle = (k) => ({ kosten: 'Gesamtlast', last: 'Lastausgleich', hilfsbit: 'Hilfsbits' }[k] || STEPS[3].title);
  const weightOf = (k) => ({ kosten: '', last: 'B·', hilfsbit: 'M·' }[k] ?? 'A·');
  const fullModel = () => makeModel(form(), { A: st.A, B: st.B, D: st.M, terms: ALL });

  /** Bits → x-Werte, Zuweisung je Auftrag und Verstöße (Doppelbelegung ist erlaubt). */
  function decode(bits) {
    const f = form();
    const xs = xValues(f, bits);
    const assignment = {};
    const issues = [];
    for (const t of inst().tasks) {
      const tid = t.transport_id;
      const mine = vars().filter((v) => v.task_id === tid);
      const on = mine.filter((v) => Math.abs(xs[v.index]) > 1e-9);
      if (!mine.length || f.unrepresentable.includes(tid)) issues.push({ task: tid, text: `#${tid}: kein Roboter möglich` });
      else if (on.length === 1 && Math.abs(xs[on[0].index] - 1) < 1e-9) assignment[tid] = on[0].robot_id;
      else issues.push({ task: tid, text: E.issueText(tid, on, f, bits) });
    }
    const lies = quboMode() ? f.aux.filter((a) => bits[a.index] !== bits[a.pair[0]] * bits[a.pair[1]]).map((a) => a.index) : [];
    if (lies.length) issues.push({ text: `${lies.length} Hilfsbit(s) lügen` });
    return { xs, assignment, issues, lies, valid: !issues.length };
  }
  function describeState(bits) {
    const dec = decode(bits);
    const parts = inst().tasks.map((t) => (dec.assignment[t.transport_id] != null ? `#${t.transport_id}→R${dec.assignment[t.transport_id]}` : null)).filter(Boolean);
    return [...parts, ...dec.issues.map((i) => `✗ ${i.text}`)].join(' · ') || '–';
  }
  const loadText = (bits) => robotLoads(inst(), decode(bits).xs).map((l) => `R${l.r.robot_id} ${fmtE(l.L)}`).join(', ');
  const planBits = (p) => (p ? E.planBits(form(), inst(), p.vars) : new Uint8Array(form().n));
  function nearest() {
    const pick = inst().tasks.map((t) => vars().filter((v) => v.task_id === t.transport_id).reduce((b, v) => (b == null || v.cost < b.cost ? v : b), null)).filter(Boolean);
    return planBits({ vars: pick.map((v) => v.index) });
  }
  function describePart(p) {
    const val = partValue(p, st.A, st.B, st.M);
    if (p.kind === 'hilfsbit') return `Hilfsbit ${bitLabel(p.aux)} = ${bitLabel(p.pair[0])}·${bitLabel(p.pair[1])}: ${fmtE(val)}`;
    if (p.kind === 'last') return `Lastausgleich R${p.robot_id} (B·…): ${fmtE(val)}`;
    return `${termTitle(p.kind)} #${p.task_id}: ${fmtE(val)}`;
  }

  // ---------------------------------------------------------------- Rechnen
  /** Energie nach Termart: QUBO (mit Hilfsbits) oder – Binary vor Schritt 6 – das Polynom höheren Grades. */
  function sumsByKind(bits, terms) {
    const f = form();
    const sums = Object.fromEntries(TERMS.map((k) => [k, 0]));
    if (quboMode()) {
      const m = makeModel(f, { A: st.A, B: st.B, D: st.M, terms });
      for (const e of m.entries) if (bits[e.i] && bits[e.j]) for (const p of e.activeParts) sums[p.kind] += partValue(p, st.A, st.B, st.M);
      for (const p of f.const_parts) if (terms[p.kind]) sums[p.kind] += partValue(p, st.A, st.B, st.M);
    } else {
      for (const blk of f.polynomial) {
        if (!terms[blk.kind]) continue;
        for (const t of blk.terms) if (t.vars.every((i) => bits[i])) sums[blk.kind] += partValue(t, st.A, st.B, st.M);
      }
    }
    return sums;
  }
  /** H aus den Regeln (ohne Hilfsbit-Strafe): Gesamtlast + A·Regel + B·Σ L². */
  function ruleEnergy(bits) {
    const dec = decode(bits);
    const obj = vars().reduce((s, v) => s + v.cost * dec.xs[v.index], 0);
    const pen = E.penItems(form(), inst(), bits, dec.xs, st.A).reduce((s, p) => s + p.v, 0);
    const wb = robotLoads(inst(), dec.xs).reduce((s, l) => s + l.L * l.L, 0);
    return obj + pen + st.B * wb;
  }
  function solve(terms, qubo, topK = 12) {
    const f = form();
    if (qubo) {
      const m = makeModel(f, { A: st.A, B: st.B, D: st.M, terms });
      if (m.n <= MAX_SEARCH_BITS) {
        const r = search(m, topK);
        return { exhaustive: true, min: { E: r.min.E, x: fromMask(r.min.mask, m.n) }, top: r.top.map((t) => ({ E: t.E, x: fromMask(t.mask, m.n), mask: t.mask })),
          all: r.all, total: r.total, maskOf: toMask };
      }
      const groups = E.key === 'one_hot' ? inst().tasks.map((t) => vars().filter((v) => v.task_id === t.transport_id).map((v) => v.index)) : [];
      const r = anneal(m, { restarts: 40, sweeps: 400, seed: 7, groups, ...(E.key === 'binary' ? { T0: Math.max(1, st.M), T1: 0.5 } : {}) });
      return { exhaustive: false, min: r.min, top: r.top, all: null, total: 2 ** m.n, maskOf: toMask };
    }
    const nt = f.n_code_bits;
    if (nt > POLY_MAX_BITS) return null;
    const total = 2 ** nt;
    const all = new Float64Array(total);
    const x = new Uint8Array(f.n);
    const top = [];
    for (let mask = 0; mask < total; mask += 1) {
      for (let i = 0; i < nt; i += 1) x[i] = (mask >> i) & 1;
      const sums = sumsByKind(x, terms);
      const Ev = Object.values(sums).reduce((a, b) => a + b, 0);
      all[mask] = Ev;
      if (top.length < topK || Ev < top[top.length - 1].E) {
        let k = top.length;
        while (k > 0 && top[k - 1].E > Ev) k -= 1;
        top.splice(k, 0, { E: Ev, mask });
        if (top.length > topK) top.pop();
      }
    }
    const toX = (mask) => {
      const xx = new Uint8Array(f.n);
      for (let i = 0; i < nt; i += 1) xx[i] = (mask >> i) & 1;
      return makeHonest(f, xx);
    };
    return { exhaustive: true, min: { E: top[0].E, x: toX(top[0].mask) }, top: top.map((t) => ({ E: t.E, x: toX(t.mask), mask: t.mask })), all, total,
      maskOf: (xx) => toMask(xx.slice(0, nt)) };
  }
  function compute() {
    st.model = makeModel(form(), { A: st.A, B: st.B, D: st.M, terms: st.terms });
    const key = `${quboMode()}|${st.A}|${st.B}|${st.M}|${TERMS.map((k) => (st.terms[k] ? 1 : 0)).join('')}|${scenarioKey()}`;
    if (key === st.resultKey) return;
    st.resultKey = key;
    st.result = solve(st.terms, quboMode());
  }
  // Binary ohne Hilfsbit-Strafe immer als Polynom (sonst lügen die Hilfsbits ungestraft); One-Hot und DW: Polynom = QUBO
  const minUnder = (terms) => {
    const r = solve(terms, E.key !== 'binary' || Boolean(terms.hilfsbit), 1);
    return r ? { x: r.min.x, E: r.min.E } : null;
  };

  // ---------------------------------------------------------------- Zeichnen
  function update() {
    if (!st.data) return;
    compute();
    renderStepper();
    applyVisibility();
    renderExplain();
    renderMap();
    renderBoard();
    if (st.step >= 3 || st.showAll) {
      renderControls();
      renderEnergy();
      renderLoads();
      renderLoadSetup(setupHost, { data: st.data, st, onChange: changeSetup });
      renderRanking();
      formula.render();
    }
    if (st.step >= 5 || st.showAll) renderTradeoff();
    if (quboMode()) {
      matrixView.update(st.model, st.x);
      graphView.update(st.model, st.x);
      renderMetrics();
      landscape.update({ model: st.model, labels: form().bits.map((b, i) => bitLabel(i)), x: st.x, minX: st.result?.min.x, isValid: (x) => decode(x).valid, cacheKey: st.result });
    }
  }
  let pending = null;
  function scheduleUpdate() { clearTimeout(pending); pending = setTimeout(update, 70); }

  function changeSetup(ch) {
    if (ch.measure) { st.measure = ch.measure; st.parts = null; if (ch.measure !== 'zeit' && st.vorlast === 'log') st.vorlast = 'status'; }
    if (ch.parts !== undefined && !ch.measure) st.parts = ch.parts;
    if (ch.vorlast) st.vorlast = ch.vorlast;
    if (ch.param) st.costParams = { ...st.costParams, [ch.param[0]]: ch.param[1] };
    if (ch.reset) st.costParams = {};
    st.adjustWeights = true;
    load();
  }

  function renderStepper() {
    stepper.replaceChildren(...STEPS.map((s, k) => {
      const b = el('button', { class: `step${st.step === k + 1 ? ' current' : ''}${st.step > k + 1 ? ' done' : ''}`, type: 'button' }, el('span', { class: 'step-n' }, k + 1), s.title);
      b.addEventListener('click', () => goStep(k + 1));
      return b;
    }));
  }
  function goStep(k) {
    st.step = k;
    st.terms = st.showAll ? { ...ALL } : { ...STEPS[k - 1].terms };
    if (DEFAULT_FORMULA_TAB[k]) formula.setTab(DEFAULT_FORMULA_TAB[k], false);
    if (k === LAST) formula.setTab('qubo', false);
    if (E.key === 'binary') makeHonest(form(), st.x);
    update();
  }
  function applyVisibility() {
    layout.querySelectorAll('[data-min-step]').forEach((n) => { n.hidden = !st.showAll && st.step < Number(n.dataset.minStep); });
    layout.querySelector('.oh-main').classList.toggle('single', !st.showAll && st.step < 3);
  }

  function renderExplain() {
    const d = inst();
    const f = form();
    const T = d.tasks.length;
    const R = d.robots.length;
    const c = { st, f, inst: d, data: st.data, T, R };
    const plans = st.plans;
    const best = bestPlan(plans, st.B);
    const best0 = bestPlan(plans, 0);
    const next = st.step < LAST ? `<button class="btn small primary" type="button" data-next>Weiter: ${st.step + 1} · ${STEPS[st.step].title} →</button>` : '';
    const verdict = (m, bp, B) => {
      const dec = decode(m.x);
      if (!dec.valid) return `<span class="warnline">✗ ${dec.issues.map((i) => i.text).join(', ')}</span>`;
      return `<span class="okline">✓ gültig${bp && Math.abs(m.E - planValue(bp, B)) < 1e-6 ? ' und gleich dem besten Plan durch Aufzählen' : ''}</span>`;
    };
    let html = '';
    if (st.step === 1) {
      const per = Math.ceil(T / R);
      html = `<b>T = ${T}</b> Aufträge (${d.tasks.map((t) => `#${t.transport_id}`).join(', ')}), <b>R = ${R}</b> Roboter (${d.robots.map((r) => `R${r.robot_id}${r.load0 ? ` · L₀ ${fmtE(r.load0)}` : ''}`).join(', ')}).
        In der TA darf ein Roboter mehrere Aufträge nacheinander fahren: <b>${nf(st.data.n_plans)} gültige Pläne</b> (je Auftrag ein zuständiger Roboter${T > R ? `, mindestens ${per} auf einem Roboter` : ''}).
        <br>Frage: <b>Wer übernimmt welche Aufträge, damit die Gesamtlast klein und die Last gleich verteilt ist?</b> Die Reihenfolge je Roboter bleibt offen.
        <span class="hint">Roboter im Szenario wählen; mit „alle Roboter“ kommen belegte mit ihrer Vorlast dazu.</span>`;
    } else if (st.step === 2) {
      html = `${E.step2(c)} <b>Noch fehlt die Bewertung.</b>`;
    } else if (st.step === 3) {
      const m = minUnder({ kosten: true });
      const dec = m ? decode(m.x) : null;
      html = `${E.names.obj} = Σ <i>c</i><sub>t,r</sub>·<i>x</i><sub>t,r</sub>: die <b>Gesamtlast</b> als ${escapeHtml(d.measure.label)} (${escapeHtml(unit())}), <i>c</i> = ${formulaHtml(d.criterion.formula.replace(/^c = /, ''))} – Anteile rechts wählbar.
        Minimum nur mit ${E.names.obj}: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'}).
        ${dec && !dec.valid ? `<br><span class="warnline">⚠ ${E.key === 'one_hot' ? 'Niemand fährt – Kosten allein reichen nicht.' : E.key === 'domain_wall' ? 'Gebrochene Ketten bekommen Phantasiewerte.' : 'Ungenutzte Codes kosten 0 und tragen keine Last.'} Es braucht die ${STEPS[3].title}.</span>` : ''}`;
    } else if (st.step === 4) {
      const m = minUnder(STEPS[3].terms);
      const ok = m && decode(m.x).valid;
      html = `${E.step4(c)} Minimum bei A = ${nf(st.A)}: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'}) ${m ? verdict(m, best0, 0) : ''}
        ${ok ? `<br>Lasten: ${loadText(m.x)} – jeder Auftrag nimmt seinen billigsten Roboter, <b>egal wie voll der schon ist</b>.` : '<br><span class="warnline">A erhöhen.</span>'}`;
    } else if (st.step === 5) {
      const m = minUnder(STEPS[4].terms);
      const gain = best && best0 ? { obj: best.obj - best0.obj, max: best0.max - best.max } : null;
      html = `<i>B</i>·${E.names.wb} = <i>B</i>·Σ<sub>r</sub> (<i>L</i><sub>r,0</sub> + Σ<sub>t</sub> <i>c</i><sub>t,r</sub>·<i>x</i><sub>t,r</sub>)²: Das Quadrat macht volle Roboter teuer – <b>Ausgleich</b>.
        Empfehlung B = 1/(2c̄) = ${fmtB(st.data.weights.B)}: Ein zweiter gleich großer Auftrag auf demselben Roboter kostet um seine Last mehr als auf einem leeren.
        <br>Minimum bei A = ${nf(st.A)}, B = ${fmtB(st.B)}: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'}) ${m ? verdict(m, best, st.B) : ''}
        ${m && decode(m.x).valid ? `<br>Lasten: ${loadText(m.x)}.` : ''}
        ${gain && (gain.obj > 1e-6 || gain.max > 1e-6) ? ` Gegenüber B = 0: Gesamtlast +${fmtE(gain.obj)}, größte Last −${fmtE(gain.max)} ${unit()}.` : ' Hier ist der billigste Plan schon ausgeglichen – B größer oder Aufträge wählen.'}
        ${E.key === 'binary' ? `<br><span class="warnline">Grad ${f.max_degree}${f.max_degree > 2 ? ' – noch keine QUBO, es fehlen die Hilfsbits.' : ''}</span>` : ''}`;
    } else if (E.key === 'binary' && st.step === 6) {
      const m = minUnder(ALL);
      html = f.aux.length
        ? `${E.names.aux}: Ein Hilfsbit <b>a</b> ersetzt ein Bitpaar desselben Codes, Strafe <b>M·(xy − 2xa − 2ya + 3a)</b> – 0 bei a = x·y, sonst ≥ M.
          <b>${f.aux.length} Hilfsbits</b> (je Code höchstens 2<sup>${f.K}</sup> − ${f.K} − 1 = ${2 ** f.K - f.K - 1}), zusammen <b>${f.n} Qubits</b>.
          H<sub>WB</sub> multipliziert zwei Codes am selben Roboter – darum braucht es sie schon bei K = 2.
          <br>QUBO-Minimum bei M = ${nf(st.M)}: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'}) ${m ? verdict(m, best, st.B) : ''}`
        : `<b>Keine Hilfsbits nötig:</b> höchster Grad ${f.max_degree}. Minimum: <b>${m ? describeState(m.x) : '–'}</b> ${m ? verdict(m, best, st.B) : ''}`;
    } else {
      const mc = metrics();
      const cmp = st.data.compare;
      html = `Ausmultipliziert: <b>${mc.n} Qubits</b>${f.aux.length ? ` (${f.n_code_bits} Code-Bits + ${f.aux.length} Hilfsbits)` : ''}, <b>${mc.couplings} Kopplungen</b> –
        ${mc.within} innerhalb eines Auftrags (${STEPS[3].title}${E.key === 'binary' ? ', Hilfsbits' : ''}), <span style="color:${TERM_COLORS.last}">${mc.between} zwischen Aufträgen</span> (${E.names.wb}, gleicher Roboter).
        ${E.key === 'one_hot' ? 'Ohne Lastausgleich zerfiele die Matrix in T Blöcke; H<sub>WB</sub> koppelt dieselben Paare wie die Spaltenregel der IA (R·C(T, 2)), nur mit 2B·c·c′.'
    : E.key === 'domain_wall' ? 'Je Auftragspaar koppeln die Nachbarpositionen beider Ketten – bis zu 3R − 5 Kopplungen.'
      : `y·y′ hat Grad 2K = ${2 * f.K}; mit den Hilfsbits ist der Graph ${mc.couplings === (mc.n * (mc.n - 1)) / 2 ? '<b>vollständig</b>' : 'sehr dicht'}.`}
        Größter |Koeffizient| <b>${fmtE(mc.maxCoef)}</b>, Verhältnis zum kleinsten <b>${nf(mc.range)} : 1</b>.
        Vergleich hier: One-Hot ${cmp.one_hot.n} / ${cmp.one_hot.couplings}, Domain Wall ${cmp.domain_wall.n} / ${cmp.domain_wall.couplings}, Binary ${cmp.binary.n} / ${cmp.binary.couplings} (Qubits / Kopplungen).`;
    }
    explain.innerHTML = `<div class="explain-title">Schritt ${st.step} · ${STEPS[st.step - 1].title}</div><div>${html}</div>${next ? `<div style="margin-top:8px">${next}</div>` : ''}`;
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
    map.setLines(Object.entries(dec.assignment).map(([t, r]) => {
      const rob = d.fleet.find((x) => x.robot_id === r);
      const v = vars().find((x) => x.task_id === Number(t) && x.robot_id === r);
      return { from: { x: rob.x, y: rob.y }, to: d.tasks.find((x) => x.transport_id === Number(t)).pickup, label: nf(v.cost, 1), color: C.ink, opacity: 1 };
    }));
  }

  function boardCtx() {
    const dec = decode(st.x);
    return {
      st, f: form(), inst: inst(), dec, unit: unit(), loads: robotLoads(inst(), dec.xs), bitLabel, qubo: quboMode(),
      showCost: st.step >= 3 || st.showAll, showPen: st.step >= 4 || st.showAll, judgePen: st.terms[E.pen] || st.step >= 4 || st.showAll,
      toggle: (i, aux = false) => { st.x[i] = st.x[i] ? 0 : 1; if (E.key === 'binary' && !aux && (st.honest || !quboMode())) makeHonest(form(), st.x); update(); },
      pick,
      setBits: (fn) => { fn(st.x); if (E.key === 'binary' && (st.honest || !quboMode())) makeHonest(form(), st.x); update(); },
    };
  }
  /** Auftrag t auf Roboter r legen – die anderen Aufträge bleiben, wie sie sind. */
  function pick(t, r) {
    const f = form();
    const v = vars().find((x) => x.task_id === t && x.robot_id === r);
    if (!v) return;
    if (E.key === 'one_hot') {
      vars().filter((w) => w.task_id === t).forEach((w) => { st.x[w.index] = 0; });
      st.x[v.index] = 1;
    } else if (E.key === 'domain_wall') {
      const ch = f.chains.find((x) => x.key === t);
      setChain(st.x, ch, ch.vars.indexOf(v.index));
    } else {
      const gr = f.groups.find((g) => g.key === t);
      setCode(f, st.x, gr, gr.codes.find((cc) => cc.var === v.index).code);
      makeHonest(f, st.x);
    }
    update();
  }

  function renderBoard() {
    E.renderBoard(boardHost, boardCtx());
    const f = form();
    const showSolve = st.step >= 3 || st.showAll;
    const best = bestPlan(st.plans, st.B);
    const q = (enc) => `#/${enc === 'ia' ? 'ia' : 'ta'}/${enc === 'ia' ? E.api : enc}?auftraege=${st.selected.join(',')}&roboter=${robotIds().join(',')}${st.mode === 'alle' ? '&modus=alle' : ''}`
      + `${enc === 'ia' ? '' : `&last=${st.measure}&vorlast=${st.vorlast}${st.parts ? `&anteile=${st.parts.join(',')}` : ''}&schritt=${Math.min(st.step, 6)}`}`;
    fill(quickHost,
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = E.key === 'binary' ? makeHonest(f, new Uint8Array(f.n)) : new Uint8Array(f.n); update(); } }, 'Alle aus'),
      el('button', { class: 'btn small', type: 'button', title: 'Jeder Auftrag nimmt seinen billigsten Roboter – auch doppelt', onclick: () => { st.x = nearest(); update(); } }, 'Jeder nimmt den billigsten'),
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = Uint8Array.from(f.bits, () => (Math.random() < 0.4 ? 1 : 0)); if (E.key === 'binary' && st.honest) makeHonest(f, st.x); update(); } }, 'Zufall'),
      showSolve ? el('button', { class: 'btn small primary', type: 'button', disabled: !st.result, title: 'Den Zustand mit der niedrigsten Energie laden',
        onclick: () => { st.x = Uint8Array.from(st.result.min.x); update(); } }, st.result && !st.result.exhaustive ? 'Bestes gefundenes laden' : 'Minimum laden') : null,
      showSolve ? el('button', { class: 'btn small', type: 'button', disabled: !best, title: `Bester gültiger Plan für B = ${fmtB(st.B)} durch Aufzählen aller ${nf(st.data.n_plans)} Pläne`,
        onclick: () => { st.x = planBits(best); update(); } }, 'Bester gültiger Plan') : null,
      E.key === 'binary' && quboMode() && f.aux.length ? el('button', { class: 'btn small', type: 'button', onclick: () => { makeHonest(f, st.x); update(); } }, 'Hilfsbits ehrlich setzen') : null,
      ...others.map((o) => el('a', { class: 'btn small', href: q(o.api), title: `Dieselben Aufträge, Roboter und Lasten mit ${o.name}` }, `${o.name} →`)),
      el('a', { class: 'btn small', href: q('ia'), title: 'Dieselben Aufträge und Roboter als Sofortzuweisung (jeder Roboter höchstens ein Auftrag)' }, 'IA →'));
  }

  function renderControls() {
    fill(togglesHost, el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Terme'),
      TERMS.filter((k) => k !== 'hilfsbit' || quboMode()).map((k) => {
        const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(Boolean(st.terms[k])), title: `${weightOf(k)}${termTitle(k)}` },
          el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }), el('span', { html: termName(k) }));
        b.addEventListener('click', () => { st.terms[k] = !st.terms[k]; update(); });
        return b;
      })));
    const w = st.data.weights;
    const items = [];
    if (st.step >= 4 || st.showAll) {
      const bound = boundValue(w.bound, st.terms.last ? st.B : 0);
      items.push({ key: 'A', label: `A · ${STEPS[3].title}`, color: TERM_COLORS[E.pen], value: st.A, recommended: recommendA(w.bound, st.terms.last ? st.B : 0),
        hint: `> Schranke ${fmtE(bound)}${st.terms.last ? ' (wächst mit B)' : ''}` });
    }
    if (st.step >= 5 || st.showAll) {
      items.push({ key: 'B', label: 'B · Lastausgleich H_WB', color: TERM_COLORS.last, value: st.B, recommended: w.B, step: 0.0001,
        max: niceCeil(5 * w.B), digits: 4, hint: `1/(2c̄) · Einheit 1/${unit()}` });
    }
    if (E.key === 'binary' && quboMode() && form().aux.length) {
      items.push({ key: 'M', label: 'M · Hilfsbits H_Aux', color: TERM_COLORS.hilfsbit, value: st.M, recommended: w.M, hint: '> Gewinn eines lügenden Hilfsbits' });
    }
    weightsHost.hidden = !items.length;
    if (items.length) {
      weights.render({ items, note: `${st.weightNote ? `${st.weightNote} ` : ''}A folgt B: Die Schranke rechnet mit allen anderen Aufträgen auf demselben Roboter – sicher, aber großzügig (Kurve in ④).` });
    }
  }

  function renderEnergy() {
    const d = inst();
    const f = form();
    const dec = decode(st.x);
    const sums = sumsByKind(st.x, st.terms);
    const items = { kosten: [], [E.pen]: E.penItems(f, d, st.x, dec.xs, st.A), last: [], hilfsbit: [] };
    for (const t of d.tasks) {
      const on = vars().filter((v) => v.task_id === t.transport_id && Math.abs(dec.xs[v.index]) > 1e-9);
      const val = on.reduce((s, v) => s + v.cost * dec.xs[v.index], 0);
      if (dec.assignment[t.transport_id] != null) items.kosten.push({ text: `#${t.transport_id} → R${dec.assignment[t.transport_id]}: ${fmtE(val)} ${unit()}` });
      else items.kosten.push({ ok: false, text: on.length ? `#${t.transport_id}: ${on.map((v) => `${dec.xs[v.index] < 0 ? '−' : ''}R${v.robot_id}`).join(' ')} → ${fmtE(val)} ${unit()}` : `#${t.transport_id}: niemand → 0` });
    }
    for (const l of robotLoads(d, dec.xs)) {
      const terms = [l.r.load0 ? `L₀ ${fmtE(l.r.load0)}` : null, ...l.items.map((it) => `${it.x < 0 ? '− ' : ''}${fmtE(it.v.cost)}`)].filter(Boolean);
      items.last.push({ text: `R${l.r.robot_id}: (${terms.join(' + ').replaceAll('+ −', '−') || '0'})² = ${fmtE(l.L)}² → B·${nf(l.L * l.L)} = ${fmtE(st.B * l.L * l.L)}` });
    }
    for (const i of dec.lies) items.hilfsbit.push({ ok: false, text: `${bitLabel(i)} lügt (≠ Produkt) – Strafe ≥ M` });
    const shown = TERMS.filter((k) => k !== 'hilfsbit' || quboMode());
    const E0 = shown.reduce((s, k) => s + sums[k], 0);
    const rank = st.result && st.result.all ? rankOf(st.result, st.result.maskOf(st.x)) : null;
    const bar = el('div', { class: 'ebar' }, shown.filter((k) => sums[k] > 0).map((k) => withTip(
      el('div', { style: { flex: `${sums[k]} 0 0`, background: TERM_COLORS[k] } }), tipHtml(`${weightOf(k)}${termTitle(k)}`, [fmtE(sums[k])]))));
    const empty = { kosten: 'keine Zuweisung', last: 'keine Last', hilfsbit: 'alle Hilfsbits ehrlich ✓', [E.pen]: 'keine Verstöße ✓' };
    const group = (k) => el('div', { class: `egroup${st.terms[k] ? '' : ' off'}` },
      el('div', { class: 'egroup-head' }, el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }),
        el('span', { html: `${weightOf(k)}${termName(k)} · ${termTitle(k)}${k === 'kosten' ? ` [${escapeHtml(unit())}]` : ''}` }),
        el('strong', {}, st.terms[k] ? fmtE(sums[k]) : 'aus')),
      items[k].length ? el('ul', {}, items[k].map((p) => el('li', { class: p.ok === false ? 'bad' : p.ok ? 'good' : '' }, p.text))) : el('div', { class: 'hint' }, empty[k]));
    const Eq = energy(fullModel(), st.x);
    const Er = ruleEnergy(st.x);
    fill(energyHost,
      el('div', { class: 'etotal' },
        el('div', {}, el('div', { class: 'hint' }, quboMode() ? 'Energie H' : 'Energie H (Polynom)'), el('div', { class: 'ebig' }, fmtE(E0))),
        el('div', { class: 'erank' },
          rank ? el('div', {}, `Platz ${nf(rank)} von ${nf(st.result.total)}`) : null,
          el('div', { class: dec.valid ? 'okline' : 'warnline' }, dec.valid ? '✓ gültige Zuweisung' : `✗ ${dec.issues.map((i) => i.text).join(' · ')}`))),
      bar, ...shown.map(group),
      el('p', { class: 'hint' }, `Probe (alle Terme): Regeln ${fmtE(Er)}, QUBO xᵀQx + Konstante ${fmtE(Eq)} ${Math.abs(Er - Eq) < 1e-6 ? '✓ identisch' : dec.lies.length ? '– Differenz = Strafe der lügenden Hilfsbits' : '✗ ABWEICHUNG'}`));
  }

  function renderLoads() {
    const dec = decode(st.x);
    const ref = st.step >= 5 || st.showAll ? bestPlan(st.plans, st.B) : null;
    renderLoadBars(loadHost, { inst: inst(), xs: dec.xs, unit: unit(), ref: ref ? ref.loads : null, refLabel: `bester Plan für B = ${fmtB(st.B)}`,
      B: st.terms.last ? st.B : null });
  }

  function renderTradeoff() {
    const dec = decode(st.x);
    let cur = null;
    if (dec.valid) {
      const L = robotLoads(inst(), dec.xs);
      cur = { obj: vars().reduce((s, v) => s + v.cost * dec.xs[v.index], 0), wb: loadStats(L).wb };
    }
    drawTradeoff(tradeHost, { plans: st.plans, B: st.B, cur, inst: inst(), unit: unit(), onPick: (p) => { st.x = planBits(p); update(); } });
    const best = bestPlan(st.plans, st.B);
    const best0 = bestPlan(st.plans, 0);
    tradeNote.innerHTML = best ? `Der beste Plan für B liegt dort, wo die gestrichelte Gerade <i>H</i><sub>obj</sub> + <i>B</i>·Σ<i>L</i>² = konst. die Wolke berührt – größeres B kippt sie flacher, zu ausgeglichenen Plänen.
      Hier: <b>${planText(inst(), best)}</b> (Gesamtlast ${fmtE(best.obj)}, größte Last ${fmtE(best.max)} ${unit()}); B = 0: ${planText(inst(), best0)} (${fmtE(best0.obj)}, ${fmtE(best0.max)}).
      Nur Punkte auf der unteren konvexen Hülle können für irgendein B optimal sein.` : '';
  }

  function renderRanking() {
    if (!st.result) {
      rankHost.replaceChildren(el('p', { class: 'hint' }, `${form().n} Bits – zu viele für den Browser. Weniger Aufträge oder Roboter wählen.`));
      Plotly.purge(stripHost);
      return;
    }
    const cur = st.result.maskOf(st.x);
    const rows = st.result.top.map((r, k) => {
      const dec = decode(r.x);
      const s = loadStats(robotLoads(inst(), dec.xs));
      const tr = el('tr', { class: `clickable${st.result.maskOf(r.x) === cur ? ' selected' : ''}` },
        el('td', { class: 'num' }, k + 1), el('td', { class: 'num' }, fmtE(r.E)), el('td', {}, describeState(r.x)), el('td', { class: 'num' }, fmtE(s.max)),
        el('td', { class: dec.valid ? 'ok' : 'no' }, dec.valid ? '✓ gültig' : '✗'));
      tr.addEventListener('click', () => { st.x = Uint8Array.from(r.x); update(); });
      return tr;
    });
    const best = bestPlan(st.plans, st.B);
    rankHost.replaceChildren(
      el('p', { class: 'hint' }, `${st.result.exhaustive ? 'Alle Stellungen durchprobiert' : `Simulated Annealing (${form().n} Bits – Heuristik)`}${quboMode() ? '' : ', Polynom (Hilfsbits ehrlich)'}.
        ${best ? ` Bester gültiger Plan durch Aufzählen (${nf(st.data.n_plans)} Pläne): ${planText(inst(), best)}, H = ${fmtE(planValue(best, st.B))}.` : ''}`),
      el('div', { class: 'table-scroll' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'Platz'), el('th', { class: 'num' }, 'Energie'), el('th', {}, 'Zuweisung'),
          el('th', { class: 'num' }, `größte Last [${unit()}]`), el('th', {}, 'Regeln'))),
        el('tbody', {}, rows))));
    const all = st.result.all;
    if (all && all.length <= 2 ** MAX_STORE_BITS) {
      const order = Array.from(all.keys()).sort((a, b) => all[a] - all[b]);
      const toBits = (m) => (quboMode() ? fromMask(m, form().n) : makeHonest(form(), fromMask(m, form().n)));
      const valid = order.map((m) => decode(toBits(m)).valid);
      const curRank = order.indexOf(cur);
      if (stripHost.querySelector('p')) stripHost.replaceChildren();
      stripHost.style.minHeight = '';
      plot(stripHost, [
        { type: 'scattergl', mode: 'markers', x: order.map((_, k) => k + 1), y: order.map((m) => all[m]), marker: { size: all.length > 4096 ? 3 : 6, color: valid.map((ok) => (ok ? C.series : C.axis)) },
          customdata: order, hovertemplate: 'Platz %{x}: H = %{y}<extra></extra>' },
        { type: 'scatter', mode: 'markers', x: [curRank + 1], y: [all[cur]], marker: { size: 14, color: C.accent, line: { color: C.surface, width: 2 } }, hovertemplate: 'dein Zustand<extra></extra>' },
      ], {
        showlegend: false, margin: { l: 56, r: 10, t: 30, b: 44 },
        xaxis: { title: { text: `Platz (alle ${nf(all.length)} Zustände${quboMode() ? '' : ' der Code-Bits'}, nach Energie sortiert)` } }, yaxis: { title: { text: 'Energie' } },
        annotations: [{ xref: 'paper', yref: 'paper', x: 0, y: 1.06, xanchor: 'left', showarrow: false, font: { color: C.ink2 },
          text: `<span style="color:${C.series}">●</span> gültig  <span style="color:${C.axis}">●</span> ungültig  <span style="color:${C.accent}">●</span> dein Zustand · Klick lädt` }],
      });
      stripHost.removeAllListeners?.('plotly_click');
      stripHost.on('plotly_click', (ev) => {
        const p = ev.points && ev.points[0];
        if (p && p.customdata != null) { st.x = toBits(p.customdata); update(); }
      });
    } else {
      Plotly.purge(stripHost);
      stripHost.style.minHeight = '0';
      stripHost.replaceChildren(el('p', { class: 'hint' }, `Energie-Treppe nur bis ${MAX_STORE_BITS} Bits.`));
    }
  }

  function metrics() {
    const f = form();
    const offs = st.model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const coefs = st.model.entries.filter((e) => e.activeParts.length && e.value !== 0).map((e) => Math.abs(e.value));
    const within = offs.filter((e) => f.bits[e.i].task_id != null && f.bits[e.i].task_id === f.bits[e.j].task_id).length;
    const maxCoef = coefs.length ? Math.max(...coefs) : 0;
    return { n: f.n, couplings: offs.length, within, between: offs.length - within, maxCoef, range: coefs.length ? maxCoef / Math.min(...coefs) : 0 };
  }

  function renderMetrics() {
    const mc = metrics();
    const T = inst().tasks.length;
    const R = inst().robots.length;
    fill(metricsHost,
      el('div', { class: 'kpis', style: { marginTop: '10px' } },
        kpiSmall('Variablen (Qubits)', nf(mc.n), E.key === 'one_hot' ? `T · R = ${T} · ${R}` : E.key === 'domain_wall' ? `T(R − 1) = ${T}·${R - 1}` : `T·K + Hilfsbits = ${form().n_code_bits} + ${form().aux.length}`),
        kpiSmall('Kopplungen', nf(mc.couplings), `${mc.within} im Auftrag + ${mc.between} durch H_WB`),
        kpiSmall('Größter |Koeffizient|', fmtE(mc.maxCoef), `Verhältnis max/min ${nf(mc.range)} : 1`)),
      el('h4', {}, `Qubits / Kopplungen mit H_WB – ${R} Roboter, volle Zuständigkeit`),
      sizesTable(st.data.sizes, T, E.key),
      el('p', { class: 'hint', html: `One-Hot: <i>T</i>·C(<i>R</i>, 2) + <i>R</i>·C(<i>T</i>, 2) – wie die IA mit Spaltenregel. Domain Wall: <i>T</i>(<i>R</i> − 2) + C(<i>T</i>, 2)·(3<i>R</i> − 5).
        Binary: Hilfsbits (H.) je Code 2<sup>K</sup> − K − 1. Varianz Σ(<i>L</i> − <i>L̄</i>)² statt Σ<i>L</i>²: alle Paare gekoppelt. Hervorgehoben: T = ${T}.` }),
      el('div', { class: 'legend' }, TERMS.filter((k) => k !== 'kosten').map((k) => el('span', { class: 'legend-item' },
        el('span', { class: 'swatch', style: { background: TERM_COLORS[k], height: '3px' } }), el('span', { html: `${weightOf(k)}${termName(k)} · ${termTitle(k)}` })))));
  }

  /** Hebt Bits, Aufträge, Roboter oder Regeln im Brett und in den Lastbalken hervor (von der Formel aus). */
  function highlight(sel) {
    for (const host of [boardHost, loadHost]) host.querySelectorAll('.hl').forEach((n) => n.classList.remove('hl'));
    if (!sel) return;
    const q = [];
    (sel.vars || []).forEach((i) => q.push(`[data-var="${i}"]`));
    if (sel.task != null) q.push(`[data-task="${sel.task}"]`, `[data-chain="${sel.task}"]`, `[data-group="${sel.task}"]`);
    if (sel.robot != null) q.push(`[data-robot="${sel.robot}"]`);
    if (sel.kind === 'kosten' || sel.all) q.push('.switch');
    if (sel.kind === E.pen) q.push('.row-sum');
    if (sel.kind === 'last') q.push('.col-sum', '.wl-row');
    if (!q.length) return;
    for (const host of [boardHost, loadHost]) host.querySelectorAll(q.join(',')).forEach((n) => n.classList.add('hl'));
  }
  function flash(i, j) {
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

/** Ohne Link: die ersten drei freien Roboter im Snapshot der ersten gewählten Anfrage (bei vier Aufträgen T > R). */
function defaultRobots(run, tasks, selected, count) {
  const first = tasks.filter((t) => selected.includes(t.transport_id)).sort((a, b) => a.time - b.time)[0];
  if (!first) return null;
  const free = run.fleet.filter((r) => r.transport_id === first.transport_id && r.available).map((r) => r.robot_id).sort((a, b) => a - b);
  return free.length > count ? free.slice(0, count) : null;
}

function kpiSmall(label, value, note) {
  return el('div', { class: 'kpi' }, el('div', { class: 'kpi-label' }, label), el('div', { class: 'kpi-value', style: { fontSize: '1.3rem' } }, value),
    el('div', { class: 'kpi-note' }, note));
}
