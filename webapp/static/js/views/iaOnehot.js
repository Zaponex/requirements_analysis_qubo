// Reiter „Kodierungen IA“ › One-Hot: Sofortzuweisung (instantaneous assignment) – jeder Roboter höchstens ein Auftrag.
// Die Formulierung hängt vom Verhältnis T : R ab (T = R, T < R, T > R); die Spaltenregel gehört wieder dazu.
// Aufbau wie die One-Hot-Seite der TA: Schritte, Schachbrett, Energie, QUBO, Kriterium, Formel, Rangliste.
import { el, fill, nf, withTip, tipHtml, escapeHtml } from '../util.js';
import { C, TERM_COLORS, statusColor, plot } from '../theme.js';
import { createLayoutMap } from '../components/layoutMap.js';
import { autoWeights, createWeightControls, weightsFromParams } from '../components/weightControls.js';
import { initialScenario, renderScenario, shortName } from '../components/scenario.js';
import { applyCase, renderCaseCards, robotPicker, toggledRobots } from '../components/iaScenario.js';
import { MAX_SEARCH_BITS, MAX_STORE_BITS, energy, fromMask, makeModel, rankOf, search, toMask } from '../qubo/engine.js';
import { createMatrixView } from '../qubo/matrixView.js';
import { createGraphView } from '../qubo/graphView.js';
import { createLandscape } from '../components/landscape.js';
import {
  CASES, DEFAULT_FORMULA_TAB, H_OBJ, TERMS, WEIGHT, createIaFormulaPanel, pairs, penFormula, penName, penalty, ruleText,
  satisfied,
} from './iaOnehotFormula.js';
import { createCriterionPanel, formulaHtml } from './onehotCriterion.js';

const STEPS = [
  { title: 'Szenario', terms: {} },
  { title: 'Schalter', terms: {} },
  { title: 'Kosten', terms: { kosten: true } },
  { title: 'Auftragsregel', terms: { kosten: true, zeile: true } },
  { title: 'Roboterregel', terms: { kosten: true, zeile: true, spalte: true } },
  { title: 'QUBO & Hardware', terms: { kosten: true, zeile: true, spalte: true } },
];
const ALL_TERMS = { kosten: true, zeile: true, spalte: true };
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (s) => String(s).replace(/\d/g, (d) => SUB[d]);
const fmtE = (v) => nf(v, 1).replace('-', '−');

export function renderIaOneHot(root, { run, api, params }) {
  const tasks = run.tasks;
  const linkedRobots = String(params.roboter || '').split(',').map(Number).filter((id) => id > 0);
  const st = {
    step: Math.min(STEPS.length, Math.max(1, Number(params.schritt) || 1)),
    showAll: false,
    ...initialScenario(tasks, params, 4), // ohne Link: die ersten vier Anfragen – bei vier freien Robotern T = R
    robots: linkedRobots.length ? linkedRobots : null, // null = alle freien Roboter
    mode: params.modus === 'alle' ? 'alle' : 'kandidaten',
    A: 50,
    B: 50,
    terms: { ...STEPS[0].terms },
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
  const showAllBox = el('input', { type: 'checkbox', id: 'ia-all' });
  const scenarioBody = el('div');
  const mapHost = el('div');
  const boardHost = el('div');
  const quickHost = el('div', { class: 'quick' });
  const energyHost = el('div');
  const controlsHost = el('div');
  const togglesHost = el('div');
  const weightsHost = el('div');
  controlsHost.append(togglesHost, weightsHost);
  const rankHost = el('div');
  const stripHost = el('div', { class: 'chart short' });
  const matrixHost = el('div');
  const graphHost = el('div');
  const metricsHost = el('div');
  const formulaHost = el('div');
  const criterionHost = el('div');
  const normHost = el('div');
  const landHost = el('div');

  const section = (minStep, node) => {
    node.dataset.minStep = String(minStep);
    return node;
  };
  const cardEl = (title, sub2, ...body) => el('section', { class: 'card' },
    el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, title), sub2 ? el('div', { class: 'card-sub', html: sub2 }) : null)),
    ...body);

  root.append(el('p', {
    class: 'intro',
    html: `<strong>Sofortzuweisung</strong> (instantaneous assignment): Jeder Roboter fährt höchstens einen Auftrag. Die One-Hot-QUBO hängt davon ab,
      ob es gleich viele, mehr Roboter oder mehr Aufträge gibt – <i>H</i> = <i>H</i><sub>obj</sub> + <i>A</i>·<i>H</i><sub>pen1</sub> + <i>B</i>·<i>H</i><sub>pen2</sub>.`,
  }));
  root.append(el('section', { class: 'card guide' }, stepper, caseHost,
    el('label', { class: 'filter-group', for: 'ia-all', style: { marginTop: '6px' } }, showAllBox, el('span', { class: 'hint' }, 'Alles auf einmal zeigen')),
    explain));

  const layout = el('div', { class: 'grid', style: { marginTop: '16px' } },
    el('div', { class: 'grid grid-2' },
      cardEl('Szenario', 'Echter Moment der Simulation · Aufträge <i>T</i> und Roboter <i>R</i> wählen', scenarioBody),
      cardEl('Lage in der Fabrik', 'Roboter im Snapshot (blass = nicht in <i>R</i>) · <b>#</b> = Abholort · dunkle Linie = Schalter an', mapHost)),
    section(2, el('div', { class: 'grid oh-main' },
      cardEl('Schachbrett der Schalter', 'Zeile = Auftrag, Spalte = Roboter aus <i>R</i> · Klick: x 0 ↔ 1 · kleine Zahl = Kosten <i>c</i><sub>t,r</sub>', quickHost, boardHost),
      section(3, cardEl('Energie dieses Zustands', 'Jeder Beitrag einzeln', controlsHost, energyHost)))),
    section(3, el('div', { class: 'grid grid-2' },
      cardEl('QUBO-Matrix', 'Summe aus Kosten, Auftrags- und Roboterregel · Hover erklärt · umrandet = zählt jetzt', matrixHost),
      cardEl('Kopplungsgraph & Hardware', 'Knoten = Qubits, Linien = Kopplungen · dick = beide an', graphHost, metricsHost))),
    section(3, el('div', { class: 'grid grid-2' },
      cardEl('Normierte QUBO-Matrix', 'Q / max|Q| · blau = Belohnung, rot = Strafe', normHost),
      cardEl('Energielandschaft', 'Alle Zustände als Fläche · Ziehen dreht, Scrollen zoomt', landHost))),
    section(3, cardEl('Bewertungskriterium', 'Bestimmt <i>c</i><sub>t,r</sub> in <i>H</i><sub>obj</sub> – die Diagonale der QUBO', criterionHost)),
    section(3, cardEl('Die Formel dahinter', 'Hover über Formelteile hebt die Schalter hervor', formulaHost)),
    section(3, cardEl('Die günstigsten Zustände', 'Alle Stellungen nach Energie · Klick lädt', rankHost, stripHost)));
  root.append(layout);

  const map = createLayoutMap(mapHost, { entities: run.entities, robots: run.robots, entityLabels: false });
  const landscape = createLandscape(normHost, landHost);
  let matrixView = null;
  let graphView = null;
  const formula = createIaFormulaPanel(formulaHost, {
    getState: () => ({ data: st.data, x: st.x, A: st.A, B: st.B, terms: st.terms, step: st.step, model: st.model,
      criterion: st.data?.instance.criterion }),
    highlight: (sel) => highlightBoard(sel),
    clearHighlight: () => highlightBoard(null),
    setWeight: (key, value) => { st[key] = value; update(); },
    violations: (x) => violations(x),
    describe: (x) => describeState(x),
  });
  if (DEFAULT_FORMULA_TAB[st.step]) formula.setTab(DEFAULT_FORMULA_TAB[st.step], false);
  if (['formel', 'eingesetzt', 'qubo', 'wirkung'].includes(params.formel)) formula.setTab(params.formel, false);
  // Gewichte per Link (?A=80&B=40) haben Vorrang vor der automatischen Anpassung
  if (weightsFromParams(params, st, ['A', 'B'])) st.adjustWeights = false;
  const weights = createWeightControls(weightsHost, { onChange: (key, value) => { st[key] = value; scheduleUpdate(); } });
  const criterionPanel = createCriterionPanel(criterionHost, {
    getState: () => ({ data: st.data, weightNote: st.weightNote, selected: st.selected, overview: st.data?.overview, diagonalHint: diagonalHint() }),
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
      st.data = await api(`/api/runs/${encodeURIComponent(run.run_id)}/ia/one-hot?${q}`);
    } catch (err) {
      drawScenario(`Konnte die Formulierung nicht laden: ${err.message}`);
      return;
    }
    const n = st.data.formulation.n;
    const scenario = `${st.selected}|${robotIds()}|${st.mode}`;
    if (lastScenario !== null && scenario !== lastScenario) st.adjustWeights = true;
    lastScenario = scenario;
    if (st.adjustWeights && autoWeights()) {
      st.A = st.data.weights.A;
      st.B = st.data.weights.B;
      st.weightNote = `A = B = 1,5 × größte Kosten (${nf(st.data.weights.c_max, 1)}) → ${nf(st.A)}.`;
    } else {
      st.weightNote = '';
    }
    st.adjustWeights = false;
    const prevX = st.x;
    st.x = new Uint8Array(n);
    if (prevX.length === n) st.x.set(prevX);
    st.resultKey = '';
    if (params.zustand && !st.initialStateApplied) {
      st.initialStateApplied = true;
      if (params.zustand === 'gierig') st.x = greedy();
      if (params.zustand === 'bester') st.x = planState(st.data.best);
      if (params.zustand === 'minimum') {
        compute();
        if (st.result) st.x = fromMask(st.result.min.mask, n);
      }
    }
    const vs = vars();
    matrixView = createMatrixView(matrixHost, { labels: vs.map((v, i) => varLabel(i)), varName: varLabel, describePart, onCellClick: flashVars });
    graphView = createGraphView(graphHost, {
      variables: vs.map((v) => ({ ...v, row: v.task_id, col: v.robot_id })),
      rowKeys: st.data.instance.tasks.map((t) => t.transport_id), colKeys: robotIds(), rowLabel: (t) => `#${t}`, colLabel: (r) => `R${r}`, varName: varLabel,
    });
    drawScenario();
    update();
  }

  // ---------------------------------------------------------------- Hilfen zur Beschreibung
  const inst = () => st.data.instance;
  const vars = () => st.data.instance.variables;
  const crit = () => st.data.instance.criterion;
  const unit = () => crit().unit;
  const caseKey = () => st.data.formulation.case;
  const ex = () => st.data.formulation.exact;
  const taskOf = (id) => inst().tasks.find((t) => t.transport_id === id);
  const robotOf = (id) => inst().fleet.find((r) => r.robot_id === id);
  const rowIdx = (t) => vars().map((v, i) => (v.task_id === t ? i : -1)).filter((i) => i >= 0);
  const colIdx = (r) => vars().map((v, i) => (v.robot_id === r ? i : -1)).filter((i) => i >= 0);
  const count = (idx, x) => idx.filter((i) => x[i]).length;
  const termLabel = (k) => (k === 'kosten' ? `H_obj · ${crit().en}` : `${WEIGHT[k]}·H${ex()[k] ? '' : '′'}_pen${k === 'zeile' ? 1 : 2} · ${ruleText(k, ex()[k])}`);
  const termHtml = (k) => (k === 'kosten' ? `<i>H</i><sub>obj</sub> · ${escapeHtml(crit().label)} [${escapeHtml(unit())}]` : `${WEIGHT[k]}·${penName(k, ex()[k])} · ${ruleText(k, ex()[k])}`);
  function varLabel(i) {
    const v = vars()[i];
    return `x${sub(v.task_id)},${sub(v.robot_id)}`;
  }
  function describePart(p, A, B) {
    if (p.kind === 'kosten') return `H_obj (${crit().label}): R${p.robot_id} für #${p.task_id} → +${fmtE(p.c)} ${unit()}`;
    const W = p.kind === 'zeile' ? A : B;
    const where = p.kind === 'zeile' ? `Auftrag #${p.task_id}` : `Roboter R${p.robot_id}`;
    const coef = p.A ?? p.B;
    if (coef < 0) return `${where}: Belohnung fürs Einschalten −${WEIGHT[p.kind]} = ${fmtE(-W)}`;
    return `${where}: beide an ${p.kind === 'zeile' ? '(zwei Roboter)' : '(zwei Aufträge)'} → +${coef === 2 ? '2' : ''}${WEIGHT[p.kind]} = ${fmtE(coef * W)}`;
  }
  function assignments(x) {
    return vars().filter((v, i) => x[i]).map((v) => ({ task: v.task_id, robot: v.robot_id, cost: v.cost }));
  }
  function describeState(x) {
    const a = assignments(x);
    return a.length ? a.map((s) => `#${s.task}→R${s.robot}`).join(' · ') : 'alle Schalter aus';
  }
  const planText = (p) => (p ? Object.entries(p.assignment).map(([t, r]) => `#${t}→R${r}`).join(' · ') : '–');
  function planState(p) {
    const x = new Uint8Array(vars().length);
    if (p) vars().forEach((v, i) => { if (p.assignment[v.task_id] === v.robot_id) x[i] = 1; });
    return x;
  }
  /** Regelverstöße eines Zustands gegen die Regeln des Falls (unabhängig davon, ob sie gerade aktiv sind). */
  function violations(x) {
    const out = [];
    for (const t of inst().tasks) {
      const idx = rowIdx(t.transport_id);
      const on = count(idx, x);
      if (!satisfied(ex().zeile, on)) out.push({ kind: 'zeile', task: t.transport_id, on, possible: idx.length > 0 });
    }
    for (const r of inst().robots) {
      const idx = colIdx(r.robot_id);
      const on = count(idx, x);
      if (!satisfied(ex().spalte, on)) out.push({ kind: 'spalte', robot: r.robot_id, on, possible: idx.length > 0 });
    }
    return out;
  }
  const isValid = (x) => violations(x).length === 0;
  function violationText(v) {
    if (v.kind === 'zeile') {
      if (!v.possible) return `#${v.task}: kein Roboter möglich`;
      return v.on === 0 ? `#${v.task}: niemand fährt` : `#${v.task}: ${v.on} Roboter`;
    }
    if (!v.possible) return `R${v.robot}: kein Auftrag möglich`;
    return v.on === 0 ? `R${v.robot}: ohne Auftrag` : `R${v.robot}: ${v.on} Aufträge`;
  }
  function greedy() {
    const x = new Uint8Array(vars().length);
    for (const t of inst().tasks) {
      let best = -1;
      vars().forEach((v, i) => { if (v.task_id === t.transport_id && (best < 0 || v.cost < vars()[best].cost)) best = i; });
      if (best >= 0) x[best] = 1;
    }
    return x;
  }
  function diagonalHint() {
    if (!st.data) return '';
    const e = ex();
    return `Steht auf der <b>Diagonale</b>: Q[<i>x</i><sub>t,r</sub>] = <i>c</i><sub>t,r</sub>${e.zeile ? ' − A' : ''}${e.spalte ? ' − B' : ''} (Fall ${CASES[caseKey()].label});
      die Kopplungen hängen nicht vom Kriterium ab. <b>Exakt</b>: Jeder Roboter fährt höchstens einen Auftrag.`;
  }

  // ---------------------------------------------------------------- Rechnen
  function compute() {
    const form = st.data.formulation;
    st.model = makeModel(form, { A: st.A, B: st.B, terms: st.terms });
    const key = `${st.A}|${st.B}|${TERMS.map((k) => (st.terms[k] ? 1 : 0)).join('')}|${form.n}|${st.selected}|${robotIds()}|${st.mode}|${crit().key}|${JSON.stringify(inst().params)}`;
    if (key !== st.resultKey) {
      st.result = search(st.model, 12);
      st.resultKey = key;
    }
  }
  function minUnder(terms) {
    const m = makeModel(st.data.formulation, { A: st.A, B: st.B, terms });
    const r = search(m, 1);
    return r ? { x: fromMask(r.min.mask, m.n), E: r.min.E } : null;
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
    if (st.step >= 3 || st.showAll) {
      matrixView.update(st.model, st.x);
      graphView.update(st.model, st.x);
      renderMetrics();
      landscape.update({ model: st.model, labels: vars().map((v, i) => varLabel(i)), x: st.x, cacheKey: st.result,
        minX: st.result ? fromMask(st.result.min.mask, vars().length) : null, isValid });
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
    st.terms = st.showAll ? { ...ALL_TERMS } : { ...STEPS[k - 1].terms };
    if (DEFAULT_FORMULA_TAB[k]) formula.setTab(DEFAULT_FORMULA_TAB[k], false);
    update();
  }
  function applyVisibility() {
    layout.querySelectorAll('[data-min-step]').forEach((n) => {
      n.hidden = !st.showAll && st.step < Number(n.dataset.minStep);
    });
    layout.querySelector('.oh-main').classList.toggle('single', !st.showAll && st.step < 3);
  }

  /** Die drei Fälle als Karten – der aktuelle ist markiert, ein Klick stellt Roboter bzw. Aufträge um. */
  function renderCases() {
    renderCaseCards(caseHost, { cur: caseKey(), T: inst().tasks.length, R: inst().robots.length, note: st.caseNote, onPick: goCase,
      termsHtml: (k) => `${penName('zeile', CASES[k].exact.zeile)} + ${penName('spalte', CASES[k].exact.spalte)}` });
  }

  function renderExplain() {
    const d = inst();
    const T = d.tasks.length;
    const R = d.robots.length;
    const e = ex();
    const c = CASES[caseKey()];
    const nVars = vars().length;
    const best = st.data.best;
    const next = st.step < STEPS.length ? ` <button class="btn small primary" type="button" data-next>Weiter: ${st.step + 1} · ${STEPS[st.step].title} →</button>` : '';
    const rest = T > R ? `<b>${T - R} Auftr${T - R === 1 ? 'ag bleibt' : 'äge bleiben'}</b> für die nächste Runde liegen.`
      : T < R ? `<b>${R - T} Roboter bleib${R - T === 1 ? 't' : 'en'} frei.</b>` : 'Jeder Roboter bekommt genau einen Auftrag.';
    let html = '';
    if (st.step === 1) {
      html = `<b>T = ${T}</b> Aufträge (${d.tasks.map((t) => `#${t.transport_id}`).join(', ')}), <b>R = ${R}</b> Roboter (${d.robots.map((r) => `R${r.robot_id}`).join(', ')})
        → <b>Fall ${c.label}</b>: ${c.text}. ${rest}
        <br>Frage: <b>Welcher Roboter übernimmt welchen Auftrag, damit ${escapeHtml(crit().goal)}?</b> – ${nf(st.data.n_valid)} gültige Pläne.
        <span class="hint">Fall oben umstellen oder Roboter im Szenario wählen.</span>`;
    } else if (st.step === 2) {
      html = `Je Auftrag × Roboter aus <i>R</i> ein Schalter <i>x</i><sub>t,r</sub> („r fährt t“, 1 = ja): ${T} × ${R} → <b>${nVars} Qubits</b>
        ${nVars < T * R ? `(${T * R - nVars} Paare ohne Schalter: Roboter nicht zuständig)` : ''}. Die Karte zeigt die Fahrt jedes Schalters. <b>Noch fehlt die Bewertung.</b>`;
    } else if (st.step === 3) {
      const m = minUnder({ kosten: true });
      html = `<i>H</i><sub>obj</sub> = ${H_OBJ}: jeder Schalter zahlt <i>c</i><sub>t,r</sub> nach <b>${escapeHtml(crit().en)}</b> (${escapeHtml(unit())}): ${formulaHtml(crit().formula)}.
        Minimum über alle ${nf(2 ** nVars)} Stellungen: <b>${m ? describeState(m.x) : '–'}</b>, H = ${m ? fmtE(m.E) : '–'} – <b>niemand fährt</b>. Kosten allein reichen nicht.`;
    } else if (st.step === 4) {
      const m = minUnder({ kosten: true, zeile: true });
      const doubles = m ? violations(m.x).filter((v) => v.kind === 'spalte' && v.on > 1) : [];
      const none = m ? violations(m.x).filter((v) => v.kind === 'zeile' && v.on === 0 && v.possible) : [];
      html = e.zeile
        ? `<i>A</i>·${penName('zeile', true)} = <i>A</i>·${penFormula('zeile', true)}: <b>${ruleText('zeile', true)}</b> – genau einer → 0, sonst ≥ A.
          Minimum bei A = ${nf(st.A)}: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'}).
          ${none.length ? `<br><span class="warnline">⚠ A zu klein: Liegenlassen ist billiger als der günstigste Roboter – A erhöhen.</span>` : ''}
          ${doubles.length ? `<br><span class="warnline">⚠ ${doubles.map(violationText).join(', ')} – das verbietet erst die Roboterregel.</span>` : ''}`
        : `<i>A</i>·${penName('zeile', false)} = <i>A</i>·${penFormula('zeile', false)}: <b>${ruleText('zeile', false)}</b> – Strafe A je Roboterpaar am selben Auftrag,
          <b>keine Belohnung</b>. Minimum: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'}). Bei T &gt; R darf ein Auftrag liegen bleiben – erst die Roboterregel zwingt die Roboter zu fahren.`;
    } else if (st.step === 5) {
      const m = minUnder(ALL_TERMS);
      const valid = m && isValid(m.x);
      const g = greedy();
      const gv = violations(g).filter((v) => v.kind === 'spalte');
      const optimal = valid && best && Math.abs(m.E - best.value) < 1e-6;
      html = `<i>B</i>·${penName('spalte', e.spalte)} = <i>B</i>·${penFormula('spalte', e.spalte)}: <b>${ruleText('spalte', e.spalte)}</b>
        – ${e.spalte ? 'genau einer → 0, sonst ≥ B' : 'Strafe B je Auftragspaar am selben Roboter'}. ${rest}
        ${gv.length ? `<br>„Jeder nimmt den nächsten“ (${describeState(g)}) bricht sie: ${gv.map(violationText).join(', ')}.` : ''}
        <br>Minimum bei A = ${nf(st.A)}, B = ${nf(st.B)}: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'})
        ${valid ? `<span class="okline">✓ gültig${optimal ? ' und gleich dem besten Plan durch Aufzählen' : ''}</span>`
    : `<span class="warnline">✗ ${m ? violations(m.x).map(violationText).join(', ') : ''} – Gewichte erhöhen</span>`}
        ${best ? '' : '<br><span class="warnline">Kein gültiger Plan möglich (Zuständigkeiten).</span>'}`;
    } else {
      const mc = metrics();
      html = `Ausmultipliziert: <b>${mc.n} Qubits</b>, <b>${mc.couplings} Kopplungen</b> – ${mc.row} aus der
        <span style="color:${TERM_COLORS.zeile}">Auftragsregel</span> (je Auftrag C(R, 2)), ${mc.col} aus der <span style="color:${TERM_COLORS.spalte}">Roboterregel</span> (je Roboter C(T, 2)).
        Die Roboterregel koppelt <b>verschiedene Aufträge</b>: Anders als TA-One-Hot ohne Spaltenregel zerfällt die Matrix nicht in Blöcke.
        Diagonale c${e.zeile ? ' − A' : ''}${e.spalte ? ' − B' : ''}, größter |Koeffizient| <b>${fmtE(mc.maxCoef)}</b> (→ normierte Matrix).`;
    }
    explain.innerHTML = `<div class="explain-title">Schritt ${st.step} · ${STEPS[st.step - 1].title}</div><div>${html}</div>${next ? `<div style="margin-top:8px">${next}</div>` : ''}`;
    const nb = explain.querySelector('[data-next]');
    if (nb) nb.addEventListener('click', () => goStep(st.step + 1));
  }

  function renderMap() {
    const d = inst();
    const inR = new Set(robotIds());
    map.setRobots(d.fleet.map((r) => ({ ...r, dim: !inR.has(r.robot_id) })));
    map.setHalos(d.tasks.map((t) => ({ ...t.pickup, color: C.accent })));
    map.setLabels(d.tasks.map((t) => ({ ...t.pickup, text: `#${t.transport_id}`, color: C.accent })));
    map.setArrows(d.tasks.map((t) => ({ from: t.pickup, to: t.drop, color: C.accent, width: 1.6, opacity: 0.6,
      tip: tipHtml(`Auftrag #${t.transport_id}`, [`${escapeHtml(t.from_entity)} → ${escapeHtml(t.to_entity)}`]) })));
    map.setLines(vars().map((v, i) => {
      const r = robotOf(v.robot_id);
      const t = taskOf(v.task_id);
      return { from: { x: r.x, y: r.y }, to: t.pickup, label: st.x[i] ? nf(v.cost, 1) : null, color: st.x[i] ? C.ink : C.axis, opacity: st.x[i] ? 1 : 0.45 };
    }));
  }

  function renderBoard() {
    const d = inst();
    const e = ex();
    const idx = new Map(vars().map((v, i) => [`${v.task_id}|${v.robot_id}`, i]));
    const showRow = st.terms.zeile || st.step >= 4 || st.showAll;
    const showCol = st.terms.spalte || st.step >= 4 || st.showAll;
    const judgeCol = st.terms.spalte || st.step >= 5 || st.showAll;
    const sumCell = (exact, on, possible, attrs, judge = true) => {
      const good = possible && satisfied(exact, on);
      return el('td', { class: `sum ${attrs.class}${judge ? (good ? ' good' : ' bad') : ''}`, ...attrs.data }, judge ? `${on} ${good ? '✓' : '✗'}` : String(on));
    };
    const table = el('table', { class: 'board' },
      el('thead', {}, el('tr', {}, el('th', { class: 'corner' }, 'Auftrag ╲ Roboter'),
        d.robots.map((r) => el('th', { 'data-robot': r.robot_id }, el('div', {}, `R${r.robot_id}`),
          el('div', { class: 'hint' }, el('span', { class: 'dot-inline', style: { background: statusColor(r.status) } }), r.available ? ' frei' : ' belegt'))),
        showRow ? el('th', { title: ruleText('zeile', e.zeile) }, e.zeile ? 'Σ = 1' : 'Σ ≤ 1') : null)),
      el('tbody', {}, d.tasks.map((t) => {
        const rowI = d.robots.map((r) => idx.get(`${t.transport_id}|${r.robot_id}`));
        const on = rowI.filter((i) => i != null && st.x[i]).length;
        return el('tr', {},
          el('th', { class: 'rowhead', 'data-task': t.transport_id }, el('div', {}, `#${t.transport_id}`), el('div', { class: 'hint' }, `${shortName(t.from_entity)} → ${shortName(t.to_entity)}`)),
          d.robots.map((r) => {
            const i = idx.get(`${t.transport_id}|${r.robot_id}`);
            if (i == null) {
              return withTip(el('td', { class: 'cell none', 'data-task': t.transport_id, 'data-robot': r.robot_id }, '–'),
                tipHtml(`Kein Schalter für R${r.robot_id} → #${t.transport_id}`, ['Roboter ist nicht zuständig für diesen Bereich']));
            }
            const v = vars()[i];
            const b = el('button', { class: `cell switch${st.x[i] ? ' on' : ''}`, type: 'button', 'data-var': i, 'data-task': v.task_id, 'data-robot': v.robot_id,
              'aria-pressed': String(Boolean(st.x[i])), 'aria-label': `${varLabel(i)} umschalten` },
            el('span', { class: 'bit' }, st.x[i] ? '1' : '0'),
            el('span', { class: 'var' }, varLabel(i)),
            st.step >= 3 || st.showAll ? el('span', { class: 'cost' }, nf(v.cost, 1)) : null);
            b.addEventListener('click', () => { st.x[i] = st.x[i] ? 0 : 1; update(); });
            return el('td', {}, b);
          }),
          showRow ? sumCell(e.zeile, on, rowI.some((i) => i != null), { class: 'row-sum', data: { 'data-task': t.transport_id } }) : null);
      })),
      showCol ? el('tfoot', {}, el('tr', {}, el('th', { title: ruleText('spalte', e.spalte) }, judgeCol ? (e.spalte ? 'Σ = 1' : 'Σ ≤ 1') : 'Aufträge je Roboter'),
        d.robots.map((r) => {
          const ci = colIdx(r.robot_id);
          return sumCell(e.spalte, count(ci, st.x), ci.length > 0, { class: 'col-sum', data: { 'data-robot': r.robot_id } }, judgeCol);
        }), showRow ? el('td') : null)) : null);
    boardHost.replaceChildren(el('div', { class: 'table-wrap' }, table));

    fill(quickHost,
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = new Uint8Array(vars().length); update(); } }, 'Alle aus'),
      el('button', { class: 'btn small', type: 'button', title: 'Jeder Auftrag nimmt den nächsten Roboter – auch doppelt', onclick: () => { st.x = greedy(); update(); } }, 'Jeder nimmt den nächsten'),
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = Uint8Array.from(vars(), () => (Math.random() < 0.3 ? 1 : 0)); update(); } }, 'Zufall'),
      st.step >= 3 || st.showAll
        ? el('button', { class: 'btn small primary', type: 'button', disabled: !st.result, title: 'Den Zustand mit der niedrigsten Energie laden',
          onclick: () => { st.x = fromMask(st.result.min.mask, vars().length); update(); } }, 'Minimum laden')
        : null,
      st.step >= 3 || st.showAll
        ? el('button', { class: 'btn small', type: 'button', disabled: !st.data.best, title: `Bester gültiger Plan durch Aufzählen aller ${nf(st.data.n_valid)} gültigen Pläne`,
          onclick: () => { st.x = planState(st.data.best); update(); } }, 'Bester gültiger Plan')
        : null,
      el('a', { class: 'btn small', href: `#/ta/one-hot?auftraege=${st.selected.join(',')}&roboter=${robotIds().join(',')}${st.mode === 'alle' ? '&modus=alle' : ''}&schritt=${Math.min(st.step, 6)}`,
        title: 'Dieselben Aufträge und Roboter in der TA: Ein Roboter darf mehrere Aufträge übernehmen, Ziel Lastausgleich' }, 'Vergleich: TA-One-Hot →'));
  }

  function renderControls() {
    fill(togglesHost, el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Terme'),
      TERMS.map((k) => {
        const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(Boolean(st.terms[k])), title: termLabel(k) },
          el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }),
          el('span', { html: k === 'kosten' ? '<i>H</i><sub>obj</sub>' : penName(k, ex()[k]) }));
        b.addEventListener('click', () => { st.terms[k] = !st.terms[k]; update(); });
        return b;
      })));
    const rec = st.data.weights;
    const items = [];
    if (st.step >= 4 || st.showAll) {
      items.push({ key: 'A', label: `A · ${ex().zeile ? 'H_pen1' : 'H′_pen1'}`, color: TERM_COLORS.zeile, value: st.A, recommended: rec.A,
        hint: ex().zeile ? '> teuerster nötiger Schalter' : '> Kostenspanne eines Roboters' });
    }
    if (st.step >= 5 || st.showAll) {
      items.push({ key: 'B', label: `B · ${ex().spalte ? 'H_pen2' : 'H′_pen2'}`, color: TERM_COLORS.spalte, value: st.B, recommended: rec.B,
        hint: ex().spalte ? '> teuerster nötiger Schalter' : '> Kostenspanne eines Auftrags' });
    }
    weightsHost.hidden = !items.length;
    if (items.length) weights.render({ items, note: 'Empfehlung A = B = 1,5 × größte Kosten – per Brute Force an echten Momenten geprüft.' });
  }
  let pending = null;
  function scheduleUpdate() {
    clearTimeout(pending);
    pending = setTimeout(update, 60);
  }

  function renderEnergy() {
    if (!(st.step >= 3 || st.showAll)) return;
    const d = inst();
    const e = ex();
    const parts = { kosten: [], zeile: [], spalte: [] };
    vars().forEach((v, i) => { if (st.x[i]) parts.kosten.push({ v: v.cost, text: `#${v.task_id} → R${v.robot_id}: ${fmtE(v.cost)} ${unit()}` }); });
    const groupPart = (kind, name, on, possible) => {
      const W = st[WEIGHT[kind]];
      const val = W * penalty(e[kind], on);
      const ok = possible && satisfied(e[kind], on);
      const formulaText = e[kind] ? `${WEIGHT[kind]}·(1−${on})²` : `${WEIGHT[kind]}·${pairs(on)} Paar${pairs(on) === 1 ? '' : 'e'}`;
      return { v: val, text: `${name}: ${on} an → ${formulaText} = ${fmtE(val)}${ok ? ' ✓' : ''}`, ok };
    };
    for (const t of d.tasks) {
      const idx = rowIdx(t.transport_id);
      parts.zeile.push(groupPart('zeile', `#${t.transport_id}`, count(idx, st.x), idx.length > 0));
    }
    for (const r of d.robots) {
      const idx = colIdx(r.robot_id);
      parts.spalte.push(groupPart('spalte', `R${r.robot_id}`, count(idx, st.x), idx.length > 0));
    }
    const sums = Object.fromEntries(TERMS.map((k) => [k, st.terms[k] ? parts[k].reduce((s, p) => s + p.v, 0) : 0]));
    const E = TERMS.reduce((s, k) => s + sums[k], 0);
    const Eq = energy(st.model, st.x);
    const rank = st.result ? rankOf(st.result, toMask(st.x)) : null;
    const valid = isValid(st.x);

    const bar = el('div', { class: 'ebar' }, TERMS.filter((k) => sums[k] > 0).map((k) => withTip(
      el('div', { style: { flex: `${sums[k]} 0 0`, background: TERM_COLORS[k] } }), tipHtml(termLabel(k), [fmtE(sums[k])]))));
    const group = (k) => el('div', { class: `egroup${st.terms[k] ? '' : ' off'}` },
      el('div', { class: 'egroup-head' }, el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }),
        el('span', { html: termHtml(k) }), el('strong', {}, st.terms[k] ? fmtE(sums[k]) : 'aus')),
      parts[k].length
        ? el('ul', {}, parts[k].map((p) => el('li', { class: p.ok === false ? 'bad' : p.ok ? 'good' : '' }, p.text)))
        : el('div', { class: 'hint' }, 'kein Schalter an – keine Kosten'));

    fill(energyHost,
      el('div', { class: 'etotal' },
        el('div', {}, el('div', { class: 'hint' }, 'Energie H'), el('div', { class: 'ebig' }, fmtE(E))),
        el('div', { class: 'erank' },
          rank ? el('div', {}, `Platz ${nf(rank)} von ${nf(st.result.total)}`) : null,
          el('div', { class: valid ? 'okline' : 'warnline' }, valid ? '✓ gültige Zuweisung' : `✗ ${violations(st.x).map(violationText).join(' · ')}`))),
      bar,
      ...TERMS.map(group),
      st.step >= STEPS.length || st.showAll
        ? el('p', { class: 'hint' }, `Probe über die Matrix: xᵀQx + Konstante = ${fmtE(Eq)} ${Math.abs(Eq - E) < 1e-6 ? '✓ identisch' : '✗ ABWEICHUNG'}`)
        : null);
  }

  function renderRanking() {
    if (!(st.step >= 3 || st.showAll)) return;
    const n = vars().length;
    if (!st.result) {
      rankHost.replaceChildren(el('p', { class: 'hint' }, `${n} Schalter = ${nf(2 ** n)} Stellungen – zu viele für den Browser (max. ${MAX_SEARCH_BITS}). Weniger Aufträge oder Roboter wählen.`));
      Plotly.purge(stripHost);
      return;
    }
    const cur = toMask(st.x);
    const rows = st.result.top.map((r, k) => {
      const x = fromMask(r.mask, n);
      const v = violations(x);
      const tr = el('tr', { class: `clickable${r.mask === cur ? ' selected' : ''}` },
        el('td', { class: 'num' }, k + 1), el('td', { class: 'num' }, fmtE(r.E)), el('td', {}, describeState(x)),
        el('td', { class: v.length ? 'no' : 'ok' }, v.length ? `✗ ${v.map(violationText).join(' · ')}` : '✓ gültig'));
      tr.addEventListener('click', () => { st.x = x; update(); });
      return tr;
    });
    rankHost.replaceChildren(
      st.data.best ? el('p', { class: 'hint' }, `Bester gültiger Plan durch Aufzählen (${nf(st.data.n_valid)} gültige Pläne): ${planText(st.data.best)}, Σ c = ${fmtE(st.data.best.value)} ${unit()}.`) : null,
      el('div', { class: 'table-scroll' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'Platz'), el('th', { class: 'num' }, 'Energie'), el('th', {}, 'Zuweisung'), el('th', {}, 'Regeln'))),
        el('tbody', {}, rows))));

    if (st.result.all && n <= MAX_STORE_BITS) {
      const all = st.result.all;
      const order = Array.from(all.keys()).sort((a, b) => all[a] - all[b]);
      const valid = order.map((m) => isValid(fromMask(m, n)));
      const curRank = order.indexOf(cur);
      if (stripHost.querySelector('p')) stripHost.replaceChildren();
      stripHost.style.minHeight = '';
      plot(stripHost, [
        { type: 'scattergl', mode: 'markers', x: order.map((_, k) => k + 1), y: order.map((m) => all[m]),
          marker: { size: n > 12 ? 3 : 6, color: valid.map((ok) => (ok ? C.series : C.axis)) }, customdata: order,
          hovertemplate: 'Platz %{x}: H = %{y}<extra></extra>', name: 'Zustände' },
        { type: 'scatter', mode: 'markers', x: [curRank + 1], y: [all[cur]], marker: { size: 14, color: C.accent, line: { color: C.surface, width: 2 } },
          hovertemplate: 'dein Zustand: Platz %{x}, H = %{y}<extra></extra>', name: 'dein Zustand' },
      ], {
        showlegend: false, margin: { l: 56, r: 10, t: 30, b: 44 },
        xaxis: { title: { text: `Platz (alle ${nf(all.length)} Zustände, nach Energie sortiert)` } },
        yaxis: { title: { text: 'Energie' } },
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
      stripHost.replaceChildren(el('p', { class: 'hint' }, `Energie-Treppe nur bis ${MAX_STORE_BITS} Schalter – die Rangliste gilt für alle ${nf(st.result.total)} Zustände.`));
    }
  }

  function metrics() {
    const offs = st.model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const coefs = st.model.entries.filter((e) => e.activeParts.length).map((e) => Math.abs(e.value));
    const byKind = (k) => offs.filter((e) => e.activeParts.some((p) => p.kind === k)).length;
    return { n: vars().length, couplings: offs.length, row: byKind('zeile'), col: byKind('spalte'), maxCoef: coefs.length ? Math.max(...coefs) : 0 };
  }

  function renderMetrics() {
    const mc = metrics();
    const T = inst().tasks.length;
    const R = inst().robots.length;
    fill(metricsHost, el('div', { class: 'kpis', style: { marginTop: '10px' } },
      kpiSmall('Variablen (Qubits)', nf(mc.n), `T · R = ${T} · ${R}`),
      kpiSmall('Kopplungen', nf(mc.couplings), `${mc.row} Auftragsregel + ${mc.col} Roboterregel`),
      kpiSmall('Größter |Koeffizient|', fmtE(mc.maxCoef), 'bestimmt die nötige Präzision'),
      kpiSmall('Formel bei voller Zuständigkeit', nf(T * pairs(R) + R * pairs(T)), 'T·C(R, 2) + R·C(T, 2) – in jedem Fall gleich')),
    el('div', { class: 'legend' }, ['zeile', 'spalte'].map((k) => el('span', { class: 'legend-item' },
      el('span', { class: 'swatch', style: { background: TERM_COLORS[k], height: '3px' } }), termLabel(k)))));
  }

  /** Hebt Schalter, Zeilen oder Spalten im Schachbrett hervor (von der Formel aus). */
  function highlightBoard(sel) {
    boardHost.querySelectorAll('.hl').forEach((n) => n.classList.remove('hl'));
    if (!sel) return;
    const q = [];
    (sel.vars || []).forEach((i) => q.push(`[data-var="${i}"]`));
    if (sel.task != null) q.push(`[data-task="${sel.task}"]`);
    if (sel.robot != null) q.push(`[data-robot="${sel.robot}"]`);
    if (sel.kind === 'zeile') q.push('.row-sum');
    if (sel.kind === 'spalte') q.push('.col-sum');
    if (sel.kind === 'kosten' || sel.all) q.push('.switch');
    if (q.length) boardHost.querySelectorAll(q.join(',')).forEach((n) => n.classList.add('hl'));
  }

  function flashVars(i, j) {
    for (const k of new Set([i, j])) {
      const b = boardHost.querySelector(`[data-var="${k}"]`);
      if (b) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
    }
  }

  showAllBox.addEventListener('change', () => {
    st.showAll = showAllBox.checked;
    st.terms = st.showAll ? { ...ALL_TERMS } : { ...STEPS[st.step - 1].terms };
    update();
  });

  st.terms = { ...STEPS[st.step - 1].terms };
  load();
}

function kpiSmall(label, value, note) {
  return el('div', { class: 'kpi' }, el('div', { class: 'kpi-label' }, label), el('div', { class: 'kpi-value', style: { fontSize: '1.3rem' } }, value),
    el('div', { class: 'kpi-note' }, note));
}
