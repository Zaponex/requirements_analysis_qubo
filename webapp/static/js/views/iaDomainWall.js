// Reiter „Kodierungen IA“ › Domain Wall: Sofortzuweisung mit Ketten. Eine Kette drückt nur „genau eins“ aus – sie liegt
// auf der Seite, die vollständig zugewiesen wird: T ≤ R je Auftrag über die Roboter, T > R je Roboter über die Aufträge.
// Die Regel der anderen Seite (Querregel) ist die One-Hot-Regel mit x = Differenz zweier Bits.
// Formulierung: encodings/formulations.py (domain_wall_ia) · Aufbau wie iaOnehot.js
import { el, fill, nf, withTip, tipHtml, escapeHtml } from '../util.js';
import { C, TERM_COLORS, statusColor, plot } from '../theme.js';
import { createLayoutMap } from '../components/layoutMap.js';
import { autoWeights, createWeightControls, weightsFromParams } from '../components/weightControls.js';
import { initialScenario, renderScenario, shortName } from '../components/scenario.js';
import { CASE_LABELS, CASE_TEXTS, applyCase, renderCaseCards, robotPicker, toggledRobots } from '../components/iaScenario.js';
import { MAX_SEARCH_BITS, MAX_STORE_BITS, energy, fromMask, makeModel, rankOf, search, toMask } from '../qubo/engine.js';
import { createMatrixView } from '../qubo/matrixView.js';
import { createGraphView } from '../qubo/graphView.js';
import { createLandscape } from '../components/landscape.js';
import { createCriterionPanel, formulaHtml } from './onehotCriterion.js';
import {
  CROSS_EXACT, DW_IA_DEFAULT_TAB, DW_IA_TABS, SIDE, TERMS, chainFormula, chainName, chainText, createIaDwFormulaPanel, crossFormula,
  crossName, crossText, crossTitle, decodeIa, objFormula, objName, termName, xDef,
} from './iaDomainWallFormula.js';

const STEPS = [
  { title: 'Szenario', terms: {} },
  { title: 'Ketten', terms: {} },
  { title: 'Kosten', terms: { kosten: true } },
  { title: 'Kettenregel', terms: { kosten: true, kette: true } },
  { title: 'Querregel', terms: { kosten: true, kette: true, quer: true } }, // Titel je Fall: Roboter- oder Auftragsregel
  { title: 'QUBO & Hardware', terms: { kosten: true, kette: true, quer: true } },
];
const ALL_TERMS = { kosten: true, kette: true, quer: true };
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (s) => String(s).replace(/\d/g, (d) => SUB[d]);
const fmtE = (v) => nf(v, 1).replace('-', '−');
const signed = (v) => (v < 0 ? `−${fmtE(-v)}` : `+${fmtE(v)}`);
const pairCount = (k) => (k > 1 ? (k * (k - 1)) / 2 : 0);

export function renderIaDomainWall(root, { run, api, params }) {
  const tasks = run.tasks;
  const linkedRobots = String(params.roboter || '').split(',').map(Number).filter((id) => id > 0);
  const st = {
    step: Math.min(STEPS.length, Math.max(1, Number(params.schritt) || 1)),
    showAll: false,
    ...initialScenario(tasks, params, 4),
    robots: linkedRobots.length ? linkedRobots : null, // null = alle freien Roboter
    mode: params.modus === 'alle' ? 'alle' : 'kandidaten',
    A: 90,
    B: 30,
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
  const showAllBox = el('input', { type: 'checkbox', id: 'iadw-all' });
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
    html: `<strong>Sofortzuweisung mit Domain Wall:</strong> Eine Kette aus Bits drückt nur „genau eins“ aus. Sie liegt auf der Seite, die vollständig
      zugewiesen wird: bei <i>T</i> ≤ <i>R</i> je Auftrag, bei <i>T</i> &gt; <i>R</i> je Roboter. Die andere Seite regelt die One-Hot-Regel mit <i>x</i> = Differenz zweier Bits.
      Vergleich: <a href="#/ia/one-hot">One-Hot (IA)</a>.`,
  }));
  root.append(el('section', { class: 'card guide' }, stepper, caseHost,
    el('label', { class: 'filter-group', for: 'iadw-all', style: { marginTop: '6px' } }, showAllBox, el('span', { class: 'hint' }, 'Alles auf einmal zeigen')),
    explain));

  const layout = el('div', { class: 'grid', style: { marginTop: '16px' } },
    el('div', { class: 'grid grid-2' },
      cardEl('Szenario', 'Echter Moment der Simulation · Aufträge <i>T</i> und Roboter <i>R</i> wählen', scenarioBody),
      cardEl('Lage in der Fabrik', 'Roboter im Snapshot (blass = nicht in <i>R</i>) · <b>#</b> = Abholort · dunkle Linie = gewählt (Wand)', mapHost)),
    section(2, el('div', { class: 'grid oh-main' },
      cardEl('Die Ketten', 'Feste 1 · Bits · feste 0 · <b>grün</b> = Wand 1→0 (gewählt), <b>rot</b> = falsche Wand 0→1 · Klick schaltet ein Bit',
        quickHost, boardHost),
      section(3, cardEl('Energie dieses Zustands', 'Jeder Beitrag einzeln', controlsHost, energyHost)))),
    section(3, el('div', { class: 'grid grid-2' },
      cardEl('QUBO-Matrix', 'Summe aus Kosten, Kettenregel und Querregel · Hover erklärt · umrandet = zählt jetzt', matrixHost),
      cardEl('Kopplungsgraph & Hardware', 'Knoten = Qubits (Zeile = Kette, Spalte = Position), Linien = Kopplungen', graphHost, metricsHost))),
    section(3, el('div', { class: 'grid grid-2' },
      cardEl('Normierte QUBO-Matrix', 'Q / max|Q| · blau = Belohnung, rot = Strafe', normHost),
      cardEl('Energielandschaft', 'Alle Zustände als Fläche · Ziehen dreht, Scrollen zoomt', landHost))),
    section(3, cardEl('Bewertungskriterium', 'Kosten <i>c</i><sub>t,r</sub> wie bei One-Hot – auf der Diagonale stehen ihre <b>Differenzen</b>', criterionHost)),
    section(3, cardEl('Die Formel dahinter', 'Hover über Formelteile hebt die Bits hervor', formulaHost)),
    section(3, cardEl('Die günstigsten Zustände', 'Alle Stellungen nach Energie · Klick lädt', rankHost, stripHost)));
  root.append(layout);

  const map = createLayoutMap(mapHost, { entities: run.entities, robots: run.robots, entityLabels: false });
  const landscape = createLandscape(normHost, landHost);
  let matrixView = null;
  let graphView = null;
  const formula = createIaDwFormulaPanel(formulaHost, {
    getState: () => ({ data: st.data, x: st.x, A: st.A, B: st.B, terms: st.terms, step: st.step, model: st.model,
      criterion: st.data?.instance.criterion }),
    highlight: (sel) => highlightBoard(sel),
    clearHighlight: () => highlightBoard(null),
    setWeight: (key, value) => { st[key] = value; update(); },
    describe: (x) => describeState(x),
  });
  if (DW_IA_DEFAULT_TAB[st.step]) formula.setTab(DW_IA_DEFAULT_TAB[st.step], false);
  if (DW_IA_TABS.some((t) => t.key === params.formel)) formula.setTab(params.formel, false);
  // Gewichte per Link (?A=90&B=30) haben Vorrang vor der automatischen Anpassung
  if (weightsFromParams(params, st, ['A', 'B'])) st.adjustWeights = false;
  const weights = createWeightControls(weightsHost, { onChange: (key, value) => { st[key] = value; scheduleUpdate(); } });
  const criterionPanel = createCriterionPanel(criterionHost, {
    getState: () => ({ data: st.data, weightNote: st.weightNote, selected: st.selected, overview: st.data?.overview,
      diagonalHint: `Auf der <b>Diagonale</b> steht die Differenz zum nächsten Mitglied der Kette (Teleskopsumme):
        Q[<i>b</i><sub>i</sub>] = <i>c</i><sub>i+1</sub> − <i>c</i><sub>i</sub>, dazu Beiträge von A und B; die Kosten des ersten Mitglieds werden Konstante.
        <b>Exakt</b>: Jeder Roboter fährt höchstens einen Auftrag.` }),
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
      st.data = await api(`/api/runs/${encodeURIComponent(run.run_id)}/ia/domain-wall?${q}`);
    } catch (err) {
      drawScenario(`Konnte die Formulierung nicht laden: ${err.message}`);
      return;
    }
    const f = st.data.formulation;
    const n = f.n;
    const scenario = `${st.selected}|${robotIds()}|${st.mode}`;
    if (lastScenario !== null && scenario !== lastScenario) st.adjustWeights = true;
    lastScenario = scenario;
    if (st.adjustWeights && autoWeights()) {
      st.A = st.data.weights.A;
      st.B = st.data.weights.B;
      st.weightNote = `B = 1,5 × größte Kostenspannweite einer Kette (${nf(st.data.weights.spread, 1)}) → ${nf(st.B)}, A = 3B = ${nf(st.A)}.`;
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
      if (params.zustand === 'gierig') st.x = nearest();
      if (params.zustand === 'bester') st.x = planState(st.data.best);
      if (params.zustand === 'minimum') {
        compute();
        if (st.result) st.x = fromMask(st.result.min.mask, n);
      }
    }
    matrixView = createMatrixView(matrixHost, { labels: f.bits.map((b, i) => bitLabel(i)), varName: bitLabel, describePart, onCellClick: flashBits });
    const maxPos = Math.max(1, ...f.bits.map((b) => b.pos));
    graphView = createGraphView(graphHost, {
      variables: f.bits.map((b) => ({ ...b, cost: diagCost(b.index), row: b.chain, col: b.pos })),
      rowKeys: f.chains.map((ch) => ch.key), colKeys: Array.from({ length: maxPos }, (_, k) => k + 1),
      rowLabel: chainLabel, colLabel: (k) => `${zeile() ? 'd' : 'e'}·${k}`, varName: bitLabel,
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
  const taskOf = (id) => inst().tasks.find((t) => t.transport_id === id);
  const robotOf = (id) => inst().fleet.find((r) => r.robot_id === id);
  const member = (m) => (zeile() ? `R${m}` : `#${m}`);
  const chainLabel = (key) => (zeile() ? `#${key}` : `R${key}`);
  const stepTitle = (k) => (k === 5 && st.data ? crossTitle(caseKey()) : STEPS[k - 1].title);
  const termShort = (k) => ({ kosten: 'Kosten', kette: 'Kettenregel', quer: crossTitle(caseKey()) }[k]);
  const termLabel = (k) => `${k === 'quer' ? 'B·' : k === 'kette' ? 'A·' : ''}${termName(k, caseKey()).replace(/<[^>]+>/g, '')} · ${k === 'kosten' ? crit().en : k === 'kette' ? chainText(form().side) : crossText(caseKey())}`;
  const termHtml = (k) => (k === 'kosten' ? `${objName(form().side)} · ${escapeHtml(crit().label)} [${escapeHtml(unit())}]`
    : `${k === 'kette' ? 'A' : 'B'}·${termName(k, caseKey())} · ${k === 'kette' ? `Kettenregel: ${chainText(form().side)}` : `${crossTitle(caseKey())}: ${crossText(caseKey())}`}`);
  function bitLabel(i) {
    const b = form().bits[i];
    return zeile() ? `d${sub(b.task_id)},${sub(b.pos)}` : `e${sub(b.pos)},${sub(b.robot_id)}`;
  }
  /** Kosten-Beitrag eines Bits auf der Diagonale: Differenz der Nachbarn in der Kette (Teleskopsumme). */
  function diagCost(i) {
    const b = form().bits[i];
    const ch = form().chains.find((h) => h.key === b.chain);
    return ch.costs[b.pos] - ch.costs[b.pos - 1];
  }
  function describePart(p, A, B) {
    if (p.kind === 'kosten') return `Kosten ${chainLabel(p.chain)}: Wand wandert von ${member(p.left)} zu ${member(p.right)} → ${signed(p.c)} ${unit()}`;
    if (p.kind === 'kette') {
      return p.A > 0 ? `Kettenregel ${chainLabel(p.chain)}: eine 1 kostet +A = ${fmtE(A)} …` : `Kettenregel ${chainLabel(p.chain)}: … außer ihr linker Nachbar ist auch 1: −A = ${fmtE(-A)}`;
    }
    const where = p.robot_id != null ? `R${p.robot_id}` : `#${p.task_id}`;
    return `${crossTitle(caseKey())} ${where}: ${p.B > 0 ? '+' : '−'}${Math.abs(p.B) === 1 ? '' : Math.abs(p.B)}B = ${fmtE(p.B * B)}`;
  }
  const decode = (x) => decodeIa(form(), x);
  function describeState(x) {
    const dec = decode(x);
    return dec.chains.map((c) => {
      if (!c.valid) return `${c.name}: ✗ Kette`;
      return zeile() ? `#${c.task}→R${c.robot}` : `R${c.robot}→#${c.task}`;
    }).join(' · ');
  }
  const isValid = (x) => decode(x).valid;
  const planText = (p) => (p ? Object.entries(p.assignment).map(([t, r]) => `#${t}→R${r}`).join(' · ') : '–');
  /** Bits einer Kette so setzen, dass die Wand vor Mitglied k steht: k Einsen, dann Nullen. */
  function setChain(x, ch, k) {
    ch.bits.forEach((i, pos) => { x[i] = pos < k ? 1 : 0; });
  }
  /** Jede Kette zeigt auf ihr billigstes Mitglied – bei T ≤ R „jeder Auftrag den nächsten Roboter“. */
  function nearest() {
    const x = new Uint8Array(form().n);
    for (const ch of form().chains) {
      if (!ch.members.length) continue;
      let best = 0;
      ch.costs.forEach((c, k) => { if (c < ch.costs[best]) best = k; });
      setChain(x, ch, best);
    }
    return x;
  }
  /** Ein Plan {Auftrag: Roboter} als Bits. */
  function planState(p) {
    const x = new Uint8Array(form().n);
    if (!p) return x;
    const pairs = Object.entries(p.assignment).map(([t, r]) => [Number(t), r]);
    for (const ch of form().chains) {
      const k = ch.task_ids.findIndex((t, i) => pairs.some(([pt, pr]) => pt === t && pr === ch.robot_ids[i]));
      if (k >= 0) setChain(x, ch, k);
    }
    return x;
  }

  // ---------------------------------------------------------------- Rechnen
  function compute() {
    const f = form();
    st.model = makeModel(f, { A: st.A, B: st.B, terms: st.terms });
    const key = `${st.A}|${st.B}|${TERMS.map((k) => (st.terms[k] ? 1 : 0)).join('')}|${f.n}|${st.selected}|${robotIds()}|${st.mode}|${crit().key}|${JSON.stringify(inst().params)}`;
    if (key !== st.resultKey) {
      st.result = search(st.model, 12);
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
      landscape.update({ model: st.model, labels: form().bits.map((b, i) => bitLabel(i)), x: st.x, cacheKey: st.result,
        minX: st.result ? fromMask(st.result.min.mask, form().n) : null, isValid });
      criterionPanel.render();
      formula.render();
    }
  }

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
    st.terms = st.showAll ? { ...ALL_TERMS } : { ...STEPS[k - 1].terms };
    if (DW_IA_DEFAULT_TAB[k]) formula.setTab(DW_IA_DEFAULT_TAB[k], false);
    update();
  }
  function applyVisibility() {
    layout.querySelectorAll('[data-min-step]').forEach((n) => {
      n.hidden = !st.showAll && st.step < Number(n.dataset.minStep);
    });
    layout.querySelector('.oh-main').classList.toggle('single', !st.showAll && st.step < 3);
  }

  function renderCases() {
    renderCaseCards(caseHost, { cur: caseKey(), T: inst().tasks.length, R: inst().robots.length, note: st.caseNote, onPick: goCase,
      termsHtml: (k) => `${chainName(SIDE[k])} + ${crossName(k)} <span class="hint">· Kette je ${SIDE[k] === 'zeile' ? 'Auftrag' : 'Roboter'}</span>` });
  }

  function renderExplain() {
    const d = inst();
    const f = form();
    const T = d.tasks.length;
    const R = d.robots.length;
    const side = f.side;
    const ck = caseKey();
    const best = st.data.best;
    const n = f.n;
    const oh = st.data.one_hot;
    const next = st.step < STEPS.length ? ` <button class="btn small primary" type="button" data-next>Weiter: ${st.step + 1} · ${stepTitle(st.step + 1)} →</button>` : '';
    const rest = T > R ? `<b>${T - R} Auftr${T - R === 1 ? 'ag bleibt' : 'äge bleiben'}</b> für die nächste Runde liegen.`
      : T < R ? `<b>${R - T} Roboter bleib${R - T === 1 ? 't' : 'en'} frei.</b>` : 'Jeder Roboter bekommt genau einen Auftrag.';
    const chainWord = side === 'zeile' ? 'Auftrag' : 'Roboter';
    const memberWord = side === 'zeile' ? 'Roboter' : 'Aufträge';
    let html = '';
    if (st.step === 1) {
      html = `<b>T = ${T}</b> Aufträge (${d.tasks.map((t) => `#${t.transport_id}`).join(', ')}), <b>R = ${R}</b> Roboter (${d.robots.map((r) => `R${r.robot_id}`).join(', ')})
        → <b>Fall ${CASE_LABELS[ck]}</b>: ${CASE_TEXTS[ck]}. ${rest}
        <br>Eine Domain-Wall-Kette kann nur „genau eins“ – darum liegt sie hier <b>je ${chainWord}</b> (${chainText(side)}).
        Frage: <b>Welcher Roboter übernimmt welchen Auftrag, damit ${escapeHtml(crit().goal)}?</b> – ${nf(st.data.n_valid)} gültige Pläne.
        <span class="hint">Fall oben umstellen oder Roboter im Szenario wählen.</span>`;
    } else if (st.step === 2) {
      const lonely = f.chains.filter((ch) => ch.members.length === 1);
      html = `Je ${chainWord} eine <b>Kette</b>: feste 1, ${side === 'zeile' ? '<i>R</i>' : '<i>T</i>'} − 1 Bits, feste 0; zwischen zwei Nachbarn steht ein ${side === 'zeile' ? 'Roboter' : 'Auftrag'}.
        Die <b>Wand</b> 1 → 0 zeigt die Wahl: ${xDef(side)}. ${side === 'zeile' ? `${T} × (${R} − 1)` : `${R} × (${T} − 1)`} → <b>${n} Qubits</b> (One-Hot: ${oh.n}).
        <br>Entlang einer Kette ist Σ <i>x</i> = 1 für <b>jede</b> Stellung (Teleskop) – „${chainText(side)}“ ist eingebaut. Gebrochene Ketten (rot) erzeugen <i>x</i> = −1 (Tabelle unter den Ketten).
        ${lonely.length ? `<br>${lonely.map((ch) => chainLabel(ch.key)).join(', ')}: nur ein Mitglied – 0 Bits, die Wahl steht fest.` : ''}
        ${f.unrepresentable.length ? `<br><span class="warnline">⚠ ${f.unrepresentable.map(chainLabel).join(', ')}: keine ${memberWord} – nicht darstellbar.</span>` : ''}
        <b>Noch fehlt die Bewertung.</b>`;
    } else if (st.step === 3) {
      const m = minUnder({ kosten: true });
      const dec = m ? decode(m.x) : null;
      html = `${objName(side)} = ${objFormula(side)}: die Teleskopsumme von Σ <i>c</i>·<i>x</i> nach <b>${escapeHtml(crit().en)}</b> (${escapeHtml(unit())}): ${formulaHtml(crit().formula)}.
        Kosten des ersten Mitglieds als <b>Konstante</b>, je Bit die <b>Differenz zum nächsten</b> (kleine Zahl im Bit).
        Minimum nur mit Kosten: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'}).
        ${dec && dec.chains.some((c) => !c.valid) ? '<br><span class="warnline">⚠ Gebrochene Ketten bekommen Phantasiewerte – hier ist eine sogar das Minimum. Es braucht die Kettenregel.</span>'
    : `<br>Anders als bei One-Hot „fährt“ hier immer jemand: Jede Kette wählt genau ein Mitglied.${dec && !dec.valid ? ` <span class="warnline">⚠ ${dec.issues.map((i) => i.text).join(', ')} – das regelt erst die ${crossTitle(ck)}.</span>` : ''}`}`;
    } else if (st.step === 4) {
      const m = minUnder({ kosten: true, kette: true });
      const dec = m ? decode(m.x) : null;
      const broken = dec ? dec.issues.filter((i) => i.kind === 'kette') : [];
      const cross = dec ? dec.issues.filter((i) => i.kind === 'quer') : [];
      html = `<i>A</i>·${chainName(side)} = <i>A</i>·${chainFormula(side)}: <b>keine falsche Wand</b>. Eine 1 rechts einer 0 kostet A; ohne sie gibt es genau eine Wand.
        Gekoppelt sind <b>nur direkte Nachbarn</b>. Minimum bei A = ${nf(st.A)}: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'}).
        ${broken.length ? `<br><span class="warnline">⚠ ${broken.map((i) => i.text).join(', ')} – A erhöhen.</span>` : ''}
        ${cross.length ? `<br><span class="warnline">⚠ ${cross.map((i) => i.text).join(', ')} – das verbietet erst die ${crossTitle(ck)}.</span>` : ''}`;
    } else if (st.step === 5) {
      const m = minUnder(ALL_TERMS);
      const dec = m ? decode(m.x) : null;
      const valid = dec && dec.valid;
      const g = nearest();
      const gv = decode(g).issues.filter((i) => i.kind === 'quer');
      const optimal = valid && best && Math.abs(m.E - best.value) < 1e-6;
      html = `<i>B</i>·${crossName(ck)} = <i>B</i>·${crossFormula(ck)}: <b>${crossText(ck)}</b> – die One-Hot-Regel mit <i>x</i> = Differenz. Sie <b>koppelt verschiedene Ketten</b>. ${rest}
        ${gv.length ? `<br>„Jede Kette nimmt das billigste Mitglied“ (${describeState(g)}) bricht sie: ${gv.map((i) => i.text).join(', ')}.` : ''}
        ${CROSS_EXACT[ck] ? '' : '<br>Vorsicht: An einer gebrochenen Kette ist <i>x</i> = −1 – dann wird <i>x</i>·<i>x</i>′ = −1 und die Regel <b>belohnt</b>. Darum braucht die Kettenregel A deutlich über B (Empfehlung A = 3B).'}
        <br>Minimum bei A = ${nf(st.A)}, B = ${nf(st.B)}: <b>${m ? describeState(m.x) : '–'}</b> (H = ${m ? fmtE(m.E) : '–'})
        ${valid ? `<span class="okline">✓ gültig${optimal ? ' und gleich dem besten Plan durch Aufzählen' : ''}</span>`
    : `<span class="warnline">✗ ${dec ? dec.issues.map((i) => i.text).join(', ') : ''} – Gewichte erhöhen</span>`}
        ${best ? '' : '<br><span class="warnline">Kein gültiger Plan möglich (Zuständigkeiten).</span>'}`;
    } else {
      const mc = metrics();
      html = `Ausmultipliziert: <b>${mc.n} Qubits</b> (One-Hot: ${oh.n}), <b>${mc.couplings} Kopplungen</b> (One-Hot: ${oh.couplings}) –
        ${mc.within} <span style="color:${TERM_COLORS.kette}">innerhalb einer Kette</span> (Nachbarn), ${mc.between} <span style="color:${TERM_COLORS.quer}">zwischen Ketten</span> (${crossTitle(ck)}).
        Domain Wall spart immer ${side === 'zeile' ? 'T' : 'R'} Qubits, die Querregel kostet aber bis zu 3·(Kettenlänge) − 5 Kopplungen je Kettenpaar –
        bei <i>T</i> ≈ <i>R</i> mehr als One-Hot (Tabelle beim Kopplungsgraph). Größter |Koeffizient| <b>${fmtE(mc.maxCoef)}</b> – A = 3B treibt ihn hoch.`;
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
    map.setLines(dec.chains.filter((c) => c.valid).map((c) => {
      const r = robotOf(c.robot);
      return { from: { x: r.x, y: r.y }, to: taskOf(c.task).pickup, label: nf(c.cost, 1), color: C.ink, opacity: 1 };
    }));
  }

  // ---------------------------------------------------------------- Ketten und x-Tabelle
  function renderBoard() {
    const f = form();
    const dec = decode(st.x);
    const showCost = st.step >= 3 || st.showAll;
    const rows = dec.chains.map((c) => {
      const ch = c.ch;
      const head = zeile()
        ? el('div', { class: 'dw-head', 'data-task': ch.key }, el('div', {}, el('strong', {}, `#${ch.key}`)),
          el('div', { class: 'hint' }, `${shortName(taskOf(ch.key).from_entity)} → ${shortName(taskOf(ch.key).to_entity)}`))
        : el('div', { class: 'dw-head', 'data-robot': ch.key }, el('div', {}, el('strong', {}, `R${ch.key}`)),
          el('div', { class: 'hint' }, el('span', { class: 'dot-inline', style: { background: statusColor(robotOf(ch.key).status) } }), robotOf(ch.key).available ? ' frei' : ' belegt'));
      if (!ch.members.length) {
        return el('div', { class: 'dw-row' }, head, el('div', { class: 'hint' }, 'niemand möglich – nicht darstellbar'), el('div', { class: 'dw-result bad' }, '✗'));
      }
      const parts = [el('span', { class: 'dw-fixed' }, '1')];
      ch.members.forEach((m, k) => {
        const x = c.b[k] - c.b[k + 1];
        const t = ch.task_ids[k];
        const r = ch.robot_ids[k];
        parts.push(withTip(el('span', { class: `dw-gap${x === 1 ? ' wall' : x === -1 ? ' wall bad' : ''}`, 'data-task': t, 'data-robot': r, 'data-gap': k },
          el('span', { class: 'dw-robot' }, member(m)),
          showCost ? el('span', { class: 'dw-cost' }, nf(ch.costs[k], 1)) : null,
          el('span', { class: 'dw-delta' }, `x = ${x < 0 ? '−1' : x}`)),
        tipHtml(`x${sub(t)},${sub(r)} – R${r} für #${t}`, [
          `x = ${k === 0 ? '1' : bitLabel(ch.bits[k - 1])} − ${k === ch.members.length - 1 ? '0' : bitLabel(ch.bits[k])} = ${x}`,
          x === 1 ? '<b>Wand 1 → 0: gewählt</b>' : x === -1 ? '<b>falsche Wand 0 → 1: x = −1</b>' : 'keine Wand',
          `Kosten c = ${fmtE(ch.costs[k])} ${unit()}`])));
        if (k < ch.bits.length) {
          const i = ch.bits[k];
          const b = el('button', { class: `cell dw-bit switch${st.x[i] ? ' on' : ''}`, type: 'button', 'data-var': i, 'data-chain': ch.key,
            'aria-pressed': String(Boolean(st.x[i])), 'aria-label': `${bitLabel(i)} umschalten` },
          el('span', { class: 'bit' }, st.x[i] ? '1' : '0'),
          el('span', { class: 'var' }, bitLabel(i)),
          showCost ? el('span', { class: 'cost' }, signed(diagCost(i))) : null);
          withTip(b, () => tipHtml(`${bitLabel(i)} – zwischen ${member(ch.members[k])} und ${member(ch.members[k + 1])}`,
            [`1 schiebt die Wand weiter zu ${member(ch.members[k + 1])}: Kosten ${signed(diagCost(i))} ${unit()}`]));
          b.addEventListener('click', () => { st.x[i] = st.x[i] ? 0 : 1; update(); });
          parts.push(b);
        }
      });
      parts.push(el('span', { class: 'dw-fixed zero' }, '0'));
      const result = c.valid
        ? el('div', { class: 'dw-result good' }, `→ ${member(ch.members[c.k])}`, showCost ? el('span', { class: 'hint' }, ` (${fmtE(c.cost)})`) : null)
        : el('div', { class: 'dw-result bad' }, `✗ ${c.down.length + c.up.length} Wände`);
      return el('div', { class: 'dw-row' }, head, el('div', { class: 'dw-chain' }, parts), result);
    });

    // x-Tabelle: Auftrag × Roboter, x = Differenz der Kettenbits; Summen nach den Regeln des Falls
    const d = inst();
    const varAt = new Map(d.variables.map((v) => [`${v.task_id}|${v.robot_id}`, v.index]));
    const crossBy = new Map(dec.cross.map((q) => [q.key, q]));
    const chainBy = new Map(dec.chains.map((c) => [c.ch.key, c]));
    const judgeCross = st.terms.quer || st.step >= 5 || st.showAll;
    const sumCell = (attrs, text, good, judge = true) => el('td', { class: `sum ${attrs.class}${judge ? (good ? ' good' : ' bad') : ''}`, ...attrs.data }, text);
    const chainSum = (key, attrs) => {
      const c = chainBy.get(key);
      return sumCell(attrs, c && c.ch.members.length ? `1 ${c.valid ? '✓' : '✗'}` : '–', c && c.valid);
    };
    const crossSum = (key, attrs) => {
      const q = crossBy.get(key);
      if (!q) return el('td');
      return sumCell(attrs, judgeCross ? `${fmtE(q.sum)} ${q.ok ? '✓' : '✗'}` : fmtE(q.sum), q.ok, judgeCross);
    };
    const exactCross = CROSS_EXACT[caseKey()];
    const sumHead = (isChain) => (isChain ? 'Σ = 1 (Kette)' : exactCross ? 'Σ = 1' : 'Σ ≤ 1');
    const xTable = el('table', { class: 'board xgrid' },
      el('thead', {}, el('tr', {}, el('th', { class: 'corner' }, 'x: Auftrag ╲ Roboter'),
        d.robots.map((r) => el('th', { 'data-robot': r.robot_id }, `R${r.robot_id}`)),
        el('th', { title: zeile() ? 'immer 1 entlang der Kette (Teleskop)' : crossText(caseKey()) }, sumHead(zeile())))),
      el('tbody', {}, d.tasks.map((t) => el('tr', {},
        el('th', { class: 'rowhead', 'data-task': t.transport_id }, `#${t.transport_id}`),
        d.robots.map((r) => {
          const v = varAt.get(`${t.transport_id}|${r.robot_id}`);
          if (v == null) return el('td', { class: 'x-cell none' }, '–');
          const xv = dec.xs[v];
          const td = el('td', { class: `x-cell${xv === 1 ? ' on' : xv < 0 ? ' neg' : ''}`, 'data-task': t.transport_id, 'data-robot': r.robot_id,
            title: `x${sub(t.transport_id)},${sub(r.robot_id)} = ${xv} · Klick: Wand auf R${r.robot_id} für #${t.transport_id}` }, xv < 0 ? '−1' : String(xv));
          td.addEventListener('click', () => pickPair(t.transport_id, r.robot_id));
          return td;
        }),
        zeile() ? chainSum(t.transport_id, { class: 'row-sum', data: { 'data-task': t.transport_id } })
          : crossSum(t.transport_id, { class: 'row-sum', data: { 'data-task': t.transport_id } })))),
      el('tfoot', {}, el('tr', {}, el('th', { title: zeile() ? crossText(caseKey()) : 'immer 1 entlang der Kette (Teleskop)' }, sumHead(!zeile())),
        d.robots.map((r) => (zeile() ? crossSum(r.robot_id, { class: 'col-sum', data: { 'data-robot': r.robot_id } })
          : chainSum(r.robot_id, { class: 'col-sum', data: { 'data-robot': r.robot_id } }))),
        el('td'))));
    fill(boardHost, el('div', { class: 'dw-board' }, rows),
      el('h4', { style: { marginTop: '14px' }, html: `Daraus: <i>x</i><sub>t,r</sub> = Differenz der Kettenbits <span class="hint">· Klick setzt die Wand · rot = −1</span>` }),
      el('div', { class: 'table-wrap' }, xTable));

    fill(quickHost,
      el('button', { class: 'btn small', type: 'button', title: 'Alle Bits 0: jede Kette wählt ihr erstes Mitglied',
        onclick: () => { st.x = new Uint8Array(f.n); update(); } }, 'Alle aus'),
      el('button', { class: 'btn small', type: 'button', title: zeile() ? 'Jeder Auftrag nimmt den nächsten Roboter – auch doppelt' : 'Jeder Roboter nimmt seinen billigsten Auftrag – auch doppelt',
        onclick: () => { st.x = nearest(); update(); } }, zeile() ? 'Jeder nimmt den nächsten' : 'Jeder Roboter das Billigste'),
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = Uint8Array.from(f.bits, () => (Math.random() < 0.5 ? 1 : 0)); update(); } }, 'Zufall'),
      st.step >= 3 || st.showAll
        ? el('button', { class: 'btn small primary', type: 'button', disabled: !st.result, title: 'Den Zustand mit der niedrigsten Energie laden',
          onclick: () => { st.x = fromMask(st.result.min.mask, f.n); update(); } }, 'Minimum laden')
        : null,
      st.step >= 3 || st.showAll
        ? el('button', { class: 'btn small', type: 'button', disabled: !st.data.best, title: `Bester gültiger Plan durch Aufzählen aller ${nf(st.data.n_valid)} gültigen Pläne`,
          onclick: () => { st.x = planState(st.data.best); update(); } }, 'Bester gültiger Plan')
        : null,
      el('a', { class: 'btn small', href: `#/ia/one-hot?auftraege=${st.selected.join(',')}&roboter=${robotIds().join(',')}&kriterium=${st.criterion}${st.mode === 'alle' ? '&modus=alle' : ''}&schritt=${st.step}`,
        title: 'Dieselben Aufträge und Roboter mit One-Hot' }, 'Vergleich: IA-One-Hot →'));
  }
  /** Klick in die x-Tabelle: Wand der passenden Kette auf dieses Paar setzen. */
  function pickPair(task, robot) {
    const ch = form().chains.find((h) => h.key === (zeile() ? task : robot));
    const k = ch ? ch.task_ids.findIndex((t, i) => t === task && ch.robot_ids[i] === robot) : -1;
    if (k < 0) return;
    setChain(st.x, ch, k);
    update();
  }

  function renderControls() {
    fill(togglesHost, el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Terme'),
      TERMS.map((k) => {
        const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(Boolean(st.terms[k])), title: termLabel(k) },
          el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }),
          el('span', { html: termName(k, caseKey()) }));
        b.addEventListener('click', () => { st.terms[k] = !st.terms[k]; update(); });
        return b;
      })));
    const rec = st.data.weights;
    const items = [];
    if (st.step >= 4 || st.showAll) {
      items.push({ key: 'A', label: `A · Kettenregel ${termName('kette', caseKey()).replace(/<[^>]+>/g, '')}`, color: TERM_COLORS.kette, value: st.A, recommended: rec.A,
        hint: CROSS_EXACT[caseKey()] ? '> Kostenspannweite einer Kette' : '> B + 2 × Spannweite' });
    }
    if (st.step >= 5 || st.showAll) {
      items.push({ key: 'B', label: `B · ${crossTitle(caseKey())} ${crossName(caseKey()).replace(/<[^>]+>/g, '')}`, color: TERM_COLORS.quer, value: st.B, recommended: rec.B,
        hint: '> Kostenspannweite einer Kette' });
    }
    weightsHost.hidden = !items.length;
    if (items.length) weights.render({ items, note: 'Empfehlung B = 1,5 × Spannweite, A = 3B – per Brute Force an echten Momenten geprüft.' });
  }
  let pending = null;
  function scheduleUpdate() {
    clearTimeout(pending);
    pending = setTimeout(update, 60);
  }

  function renderEnergy() {
    if (!(st.step >= 3 || st.showAll)) return;
    const dec = decode(st.x);
    const parts = { kosten: [], kette: [], quer: [] };
    for (const c of dec.chains) {
      const ch = c.ch;
      if (!ch.members.length) continue;
      const value = ch.costs.reduce((s, cost, k) => s + cost * (c.b[k] - c.b[k + 1]), 0);
      if (c.valid) parts.kosten.push({ v: value, text: `${c.name} → ${member(ch.members[c.k])}: ${fmtE(value)} ${unit()}` });
      else {
        const terms = ch.costs.map((cost, k) => [cost, c.b[k] - c.b[k + 1]]).filter(([, dl]) => dl !== 0);
        parts.kosten.push({ v: value, ok: false, text: `${c.name}: gebrochene Kette → Phantasiewert ${terms.map(([cost, dl]) => `${dl < 0 ? '−' : ''}${fmtE(cost)}`).join(' + ').replaceAll('+ −', '− ')} = ${fmtE(value)}` });
      }
      ch.bits.slice(1).forEach((i, k) => {
        const left = ch.bits[k];
        if (st.x[i] && !st.x[left]) parts.kette.push({ v: st.A, ok: false, text: `${c.name}: ${bitLabel(left)} = 0, ${bitLabel(i)} = 1 → falsche Wand: A = ${fmtE(st.A)}` });
      });
    }
    for (const q of dec.cross) {
      const val = st.B * q.penalty;
      const formulaText = q.rule.exact ? `Σx = ${fmtE(q.sum)} → B·(1 − ${fmtE(q.sum)})²` : `Σ x·x′ = ${fmtE(q.prod)} → B·${fmtE(q.prod)}`;
      parts.quer.push({ v: val, ok: q.ok && val >= 0, text: `${q.name}: ${formulaText} = ${fmtE(val)}${q.ok ? ' ✓' : ''}${val < 0 ? ' – Belohnung durch x = −1!' : ''}` });
    }
    const sums = Object.fromEntries(TERMS.map((k) => [k, st.terms[k] ? parts[k].reduce((s, p) => s + p.v, 0) : 0]));
    const E = TERMS.reduce((s, k) => s + sums[k], 0);
    const Eq = energy(st.model, st.x);
    const rank = st.result ? rankOf(st.result, toMask(st.x)) : null;
    const bar = el('div', { class: 'ebar' }, TERMS.filter((k) => sums[k] > 0).map((k) => withTip(
      el('div', { style: { flex: `${sums[k]} 0 0`, background: TERM_COLORS[k] } }), tipHtml(termLabel(k), [fmtE(sums[k])]))));
    const empty = { kosten: 'keine Kette', kette: 'keine falsche Wand ✓', quer: 'keine Gruppe' };
    const group = (k) => el('div', { class: `egroup${st.terms[k] ? '' : ' off'}` },
      el('div', { class: 'egroup-head' }, el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }),
        el('span', { html: termHtml(k) }), el('strong', {}, st.terms[k] ? fmtE(sums[k]) : 'aus')),
      parts[k].length ? el('ul', {}, parts[k].map((p) => el('li', { class: p.ok === false ? 'bad' : p.ok ? 'good' : '' }, p.text))) : el('div', { class: 'hint' }, empty[k]));
    fill(energyHost,
      el('div', { class: 'etotal' },
        el('div', {}, el('div', { class: 'hint' }, 'Energie H'), el('div', { class: 'ebig' }, fmtE(E))),
        el('div', { class: 'erank' },
          rank ? el('div', {}, `Platz ${nf(rank)} von ${nf(st.result.total)}`) : null,
          el('div', { class: dec.valid ? 'okline' : 'warnline' }, dec.valid ? '✓ gültige Zuweisung' : `✗ ${dec.issues.map((i) => i.text).join(' · ')}`))),
      bar, ...TERMS.map(group),
      el('p', { class: 'hint' }, `Probe über die Matrix: xᵀQx + Konstante = ${fmtE(Eq)} ${Math.abs(Eq - E) < 1e-6 ? '✓ identisch' : '✗ ABWEICHUNG'}`));
  }

  function renderRanking() {
    if (!(st.step >= 3 || st.showAll)) return;
    const n = form().n;
    if (!st.result) {
      rankHost.replaceChildren(el('p', { class: 'hint' }, `${n} Bits = ${nf(2 ** n)} Stellungen – zu viele für den Browser (max. ${MAX_SEARCH_BITS}). Weniger Aufträge oder Roboter wählen.`));
      Plotly.purge(stripHost);
      return;
    }
    const cur = toMask(st.x);
    const rows = st.result.top.map((r, k) => {
      const x = fromMask(r.mask, n);
      const dec = decode(x);
      const tr = el('tr', { class: `clickable${r.mask === cur ? ' selected' : ''}` },
        el('td', { class: 'num' }, k + 1), el('td', { class: 'num' }, fmtE(r.E)), el('td', {}, describeState(x)),
        el('td', { class: dec.valid ? 'ok' : 'no' }, dec.valid ? '✓ gültig' : `✗ ${dec.issues.map((i) => i.text).join(' · ')}`));
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
      stripHost.replaceChildren(el('p', { class: 'hint' }, `Energie-Treppe nur bis ${MAX_STORE_BITS} Bits – die Rangliste gilt für alle ${nf(st.result.total)} Zustände.`));
    }
  }

  function metrics() {
    const f = form();
    const offs = st.model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const coefs = st.model.entries.filter((e) => e.activeParts.length).map((e) => Math.abs(e.value));
    const within = offs.filter((e) => f.bits[e.i].chain === f.bits[e.j].chain).length;
    return { n: f.n, couplings: offs.length, within, between: offs.length - within, maxCoef: coefs.length ? Math.max(...coefs) : 0 };
  }

  /** Qubits und Kopplungen bei voller Zuständigkeit (geprüft gegen den Python-Code). */
  function sizes(T, R) {
    const [L, K] = T <= R ? [R, T] : [T, R]; // Kettenlänge L, Anzahl Ketten K
    return { dw: K * (L - 1), dwc: K * Math.max(0, L - 2) + pairCount(K) * Math.max(0, 3 * L - 5), oh: T * R, ohc: T * pairCount(R) + R * pairCount(T) };
  }

  function renderMetrics() {
    const mc = metrics();
    const oh = st.data.one_hot;
    const T = inst().tasks.length;
    const R = inst().robots.length;
    const rows = Array.from({ length: 6 }, (_, k) => k + 1).map((t) => {
      const z = sizes(t, R);
      const ck = t === R ? 'T=R' : t < R ? 'T<R' : 'T>R';
      return el('tr', { class: t === T ? 'selected' : '' }, el('td', { class: 'num' }, t), el('td', {}, CASE_LABELS[ck]),
        el('td', { class: 'num' }, `${z.dw} / ${z.dwc}`), el('td', { class: 'num' }, `${z.oh} / ${z.ohc}`),
        el('td', { class: z.dwc < z.ohc ? 'ok' : 'no' }, z.dwc < z.ohc ? 'Domain Wall' : z.dwc === z.ohc ? 'gleich' : 'One-Hot'));
    });
    fill(metricsHost,
      el('div', { class: 'kpis', style: { marginTop: '10px' } },
        kpiSmall('Variablen (Qubits)', nf(mc.n), `${zeile() ? `T(R − 1) = ${T}·${R - 1}` : `R(T − 1) = ${R}·${T - 1}`} · One-Hot: ${nf(oh.n)}`),
        kpiSmall('Kopplungen', nf(mc.couplings), `${mc.within} in Ketten + ${mc.between} zwischen Ketten · One-Hot: ${nf(oh.couplings)}`),
        kpiSmall('Größter |Koeffizient|', fmtE(mc.maxCoef), 'bestimmt die nötige Präzision')),
      el('h4', {}, `Qubits / Kopplungen: Domain Wall gegen One-Hot – ${R} Roboter, volle Zuständigkeit`),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'T'), el('th', {}, 'Fall'), el('th', { class: 'num' }, 'Domain Wall'),
          el('th', { class: 'num' }, 'One-Hot'), el('th', {}, 'weniger Kopplungen'))),
        el('tbody', {}, rows))),
      el('p', { class: 'hint', html: `Mit <i>K</i> Ketten der Länge <i>L</i> (<i>T</i> ≤ <i>R</i>: <i>K</i> = <i>T</i>, <i>L</i> = <i>R</i>; sonst umgekehrt):
        Domain Wall <i>K</i>(<i>L</i> − 1) Qubits und <i>K</i>(<i>L</i> − 2) + C(<i>K</i>, 2)·(3<i>L</i> − 5) Kopplungen, One-Hot <i>T</i>·C(<i>R</i>, 2) + <i>R</i>·C(<i>T</i>, 2).
        Hervorgehoben: dein Szenario (T = ${T}).` }),
      el('div', { class: 'legend' }, ['kette', 'quer'].map((k) => el('span', { class: 'legend-item' },
        el('span', { class: 'swatch', style: { background: TERM_COLORS[k], height: '3px' } }), termLabel(k)))));
  }

  /** Hebt Bits, Ketten, Aufträge oder Roboter hervor (von der Formel aus). */
  function highlightBoard(sel) {
    boardHost.querySelectorAll('.hl').forEach((n) => n.classList.remove('hl'));
    if (!sel) return;
    const q = [];
    (sel.vars || []).forEach((i) => q.push(`[data-var="${i}"]`));
    if (sel.task != null) q.push(`[data-task="${sel.task}"]`, ...(zeile() ? [`.dw-bit[data-chain="${sel.task}"]`] : []));
    if (sel.robot != null) q.push(`[data-robot="${sel.robot}"]`, ...(zeile() ? [] : [`.dw-bit[data-chain="${sel.robot}"]`]));
    if (sel.kind === 'kosten' || sel.all) q.push('.dw-bit');
    if (sel.kind === 'kette') q.push('.dw-gap.wall');
    if (sel.kind === 'quer') q.push(zeile() ? '.col-sum' : '.row-sum');
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
