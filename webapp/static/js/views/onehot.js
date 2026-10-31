// Reiter „Kodierungen TA“ › One-Hot: die Formulierung Schritt für Schritt an echten Aufträgen erleben.
// Ohne Spaltenregel: Ein Roboter darf mehrere Aufträge übernehmen (Sofortzuweisung mit Spaltenregel: views/iaOnehot.js).
// Schalter anklicken, Regeln zuschalten, Strafgewichte verschieben – jede Energie-Zahl wird erklärt.
import { el, fill, nf, withTip, tipHtml, escapeHtml } from '../util.js';
import {
  C, TERM_COLORS, TERM_LABELS, TERM_ORDER, TERM_SHORT, areaColor, areaLabel, plot, statusColor, statusLabel,
} from '../theme.js';
import { createLayoutMap } from '../components/layoutMap.js';
import { autoWeights, createWeightControls, weightsFromParams } from '../components/weightControls.js';
import { initialScenario, renderScenario, shortName } from '../components/scenario.js';
import { MAX_SEARCH_BITS, MAX_STORE_BITS, energy, fromMask, makeModel, rankOf, search, toMask } from '../qubo/engine.js';
import { createMatrixView } from '../qubo/matrixView.js';
import { createGraphView } from '../qubo/graphView.js';
import { createLandscape } from '../components/landscape.js';
import { DEFAULT_FORMULA_TAB, createFormulaPanel } from './onehotFormula.js';
import { createCriterionPanel, formulaHtml, niceCeil } from './onehotCriterion.js';

const STEPS = [
  { title: 'Szenario', terms: {} },
  { title: 'Schalter', terms: {} },
  { title: 'Kosten', terms: { kosten: true } },
  { title: 'Zeilenregel', terms: { kosten: true, zeile: true } },
  { title: 'QUBO & Hardware', terms: { kosten: true, zeile: true } },
];
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (s) => String(s).replace(/\d/g, (d) => SUB[d]);
const fmtE = (v) => nf(v, 1).replace('-', '−');

export function renderOneHot(root, { run, api, params }) {
  const tasks = run.tasks;
  const st = {
    step: Math.min(STEPS.length, Math.max(1, Number(params.schritt) || 1)),
    showAll: false,
    ...initialScenario(tasks, params), // start, window, selected – auch per Link ?auftraege=1,2,3
    mode: 'kandidaten',
    A: 50,
    terms: { ...STEPS[0].terms },
    data: null,
    x: new Uint8Array(0),
    model: null,
    result: null,
    resultKey: '',
    criterion: params.kriterium || 'leerfahrt', // Bewertungskriterium → bestimmt c_tr (Diagonale)
    costParams: {}, // Annahmen des Kostenmodells, die vom Standard abweichen
    adjustWeights: Boolean(params.kriterium && params.kriterium !== 'leerfahrt'), // A=B=50 passen zur Leerfahrt
    weightNote: '',
  };
  // ---------------------------------------------------------------- Gerüst
  const stepper = el('div', { class: 'stepper' });
  const explain = el('div', { class: 'explain' });
  const showAllBox = el('input', { type: 'checkbox', id: 'oh-all' });
  const scenarioBody = el('div');
  const mapHost = el('div');
  const boardHost = el('div');
  const quickHost = el('div', { class: 'quick' });
  const energyHost = el('div');
  const controlsHost = el('div');
  const togglesHost = el('div');
  const weightsHost = el('div');
  controlsHost.append(togglesHost, weightsHost); // Gewichte bleiben stehen, damit ein Eingabefeld beim Tippen den Fokus behält
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
    html: `Aus echten Aufträgen entsteht Schritt für Schritt eine <strong>One-Hot-QUBO</strong> – alles live: Schalter klicken,
      Regeln schalten, Gewichte ändern. Ohne Spaltenregel: Ein Roboter darf mehrere Aufträge übernehmen –
      jeder höchstens einer: <a href="#/ia/one-hot">Kodierungen IA</a>. Lesekapitel: <code>encodings/one_hot/README.md</code>.`,
  }));
  root.append(el('section', { class: 'card guide' }, stepper,
    el('label', { class: 'filter-group', for: 'oh-all', style: { marginTop: '6px' } }, showAllBox, el('span', { class: 'hint' }, 'Alles auf einmal zeigen')),
    explain));

  const layout = el('div', { class: 'grid', style: { marginTop: '16px' } },
    el('div', { class: 'grid grid-2' },
      cardEl('Szenario', 'Echter Moment der Simulation', scenarioBody),
      cardEl('Lage in der Fabrik', 'Roboter im Snapshot · <b>#</b> = Abholort · dunkle Linie = Schalter an', mapHost)),
    section(2, el('div', { class: 'grid oh-main' },
      cardEl('Schachbrett der Schalter', 'Zeile = Auftrag, Spalte = Roboter · Klick: x 0 ↔ 1 · kleine Zahl = Kosten <i>c</i><sub>t,r</sub>', quickHost, boardHost),
      section(3, cardEl('Energie dieses Zustands', 'Jeder Beitrag einzeln', controlsHost, energyHost)))),
    section(3, el('div', { class: 'grid grid-2' },
      cardEl('QUBO-Matrix', 'Summe aus Kosten und Zeilenregel · Hover erklärt · umrandet = zählt jetzt', matrixHost),
      cardEl('Kopplungsgraph & Hardware', 'Knoten = Qubits, Linien = Kopplungen · dick = beide an', graphHost, metricsHost))),
    section(3, el('div', { class: 'grid grid-2' },
      cardEl('Normierte QUBO-Matrix', 'Q / max|Q| · blau = Belohnung, rot = Strafe', normHost),
      cardEl('Energielandschaft', 'Alle Zustände als Fläche · Ziehen dreht, Scrollen zoomt', landHost))),
    section(3, cardEl('Bewertungskriterium', 'Bestimmt <i>c</i><sub>t,r</sub> – die Diagonale der QUBO', criterionHost)),
    section(3, cardEl('Die Formel dahinter', 'Hover über Formelteile hebt die Schalter hervor', formulaHost)),
    section(3, cardEl('Die günstigsten Zustände', 'Alle Stellungen nach Energie · Klick lädt', rankHost, stripHost)));
  root.append(layout);

  const map = createLayoutMap(mapHost, { entities: run.entities, robots: run.robots, entityLabels: false });
  const landscape = createLandscape(normHost, landHost);
  let matrixView = null;
  let graphView = null;
  const formula = createFormulaPanel(formulaHost, {
    getState: () => ({ data: st.data, x: st.x, A: st.A, B: 0, terms: st.terms, step: st.step, model: st.model,
      criterion: st.data?.instance.criterion }),
    highlight: (sel) => highlightBoard(sel),
    clearHighlight: () => highlightBoard(null),
    setWeight: (key, value) => { st[key] = value; update(); },
    violations: (x) => violations(x),
    describe: (x) => describeState(x),
  });
  if (DEFAULT_FORMULA_TAB[st.step]) formula.setTab(DEFAULT_FORMULA_TAB[st.step], false);
  // Gewichte per Link (?A=80&B=40) haben Vorrang vor der automatischen Anpassung
  if (weightsFromParams(params, st, ['A'])) st.adjustWeights = false;
  const weights = createWeightControls(weightsHost, { onChange: (key, value) => { st[key] = value; scheduleUpdate(); } });
  /** Empfehlung für A: 1,5 × größte Kosten – A muss die billigste Zuweisung jedes Auftrags überbieten. */
  const recommended = () => niceCeil(Math.max(10, 1.5 * Math.max(0, ...st.data.instance.variables.map((v) => v.cost))));
  let lastScenario = null;
  const criterionPanel = createCriterionPanel(criterionHost, {
    getState: () => ({ data: st.data, weightNote: st.weightNote, selected: st.selected }),
    setCriterion: (key) => { st.criterion = key; st.adjustWeights = true; load(); },
    setParam: (key, value) => { st.costParams = { ...st.costParams, [key]: value }; st.adjustWeights = true; load(); },
    resetParams: () => { st.costParams = {}; st.adjustWeights = true; load(); },
  });
  // Register per Link: #/ta/one-hot?schritt=4&formel=qubo
  if (['formel', 'eingesetzt', 'qubo', 'wirkung'].includes(params.formel)) formula.setTab(params.formel, false);

  // ---------------------------------------------------------------- Szenario-Auswahl
  function drawScenario(error) {
    const snap = st.data ? st.data.instance.snapshot : null;
    renderScenario(scenarioBody, {
      tasks, st, load, error,
      note: snap ? `Vereinfachung: Alle Aufträge sehen die Flotte von Anfrage #${snap.transport_id} (t = ${nf(snap.time)} s). Wie echte Teilprobleme aus dem Log geschnitten werden, ist offen (Stufe 2).` : null,
    });
  }

  // ---------------------------------------------------------------- Daten laden
  async function load() {
    drawScenario();
    try {
      st.data = await api(`/api/runs/${encodeURIComponent(run.run_id)}/one-hot?tasks=${st.selected.join(',')}&variables=${st.mode}`
        + `&kriterium=${encodeURIComponent(st.criterion)}&params=${encodeURIComponent(JSON.stringify(st.costParams))}`);
    } catch (err) {
      drawScenario(`Konnte die Formulierung nicht laden: ${err.message}`);
      return;
    }
    const n = st.data.formulation.n;
    // Strafgewichte an den Kostenbereich anpassen, wenn Kriterium, Annahmen oder Aufträge geändert wurden –
    // nur, solange die Automatik an ist (sonst bleiben deine Werte stehen)
    const scenario = `${st.selected}|${st.mode}`;
    if (lastScenario !== null && scenario !== lastScenario) st.adjustWeights = true;
    lastScenario = scenario;
    if (st.adjustWeights && autoWeights()) {
      const maxC = Math.max(0, ...st.data.instance.variables.map((v) => v.cost));
      st.A = recommended();
      st.weightNote = `A an den Kostenbereich angepasst: 1,5 × größte Kosten (${nf(maxC, 1)}) → ${nf(st.A)}.`;
    } else {
      st.weightNote = '';
    }
    st.adjustWeights = false;
    const prevX = st.x;
    st.x = new Uint8Array(n);
    if (prevX.length === n) st.x.set(prevX); // gleiche Schalter (nur Kriterium geändert) → Zustand behalten
    st.resultKey = '';
    // Startzustand per Link: #/ta/one-hot?schritt=5&zustand=gierig|minimum (nur beim ersten Laden)
    if (params.zustand && !st.initialStateApplied) {
      st.initialStateApplied = true;
      if (params.zustand === 'gierig') st.x = greedy();
      if (params.zustand === 'minimum') {
        compute();
        if (st.result) st.x = fromMask(st.result.min.mask, n);
      }
    }
    const vars = st.data.instance.variables;
    const labels = vars.map((v, i) => varLabel(i));
    matrixView = createMatrixView(matrixHost, { labels, varName: varLabel, describePart, onCellClick: flashVars });
    const taskIds = st.data.instance.tasks.map((t) => t.transport_id);
    const robotIds = st.data.instance.robots.map((r) => r.robot_id);
    graphView = createGraphView(graphHost, {
      variables: vars.map((v) => ({ ...v, row: v.task_id, col: v.robot_id })),
      rowKeys: taskIds, colKeys: robotIds, rowLabel: (t) => `#${t}`, colLabel: (r) => `R${r}`, varName: varLabel,
    });
    drawScenario();
    update();
  }

  // ---------------------------------------------------------------- Hilfen zur Beschreibung
  const vars = () => st.data.instance.variables;
  const crit = () => st.data.instance.criterion;
  const unit = () => crit().unit;
  const taskOf = (id) => st.data.instance.tasks.find((t) => t.transport_id === id);
  const robotOf = (id) => st.data.instance.robots.find((r) => r.robot_id === id);
  function varLabel(i) {
    const v = vars()[i];
    return `x${sub(v.task_id)},${sub(v.robot_id)}`;
  }
  function describePart(p, A, B) {
    if (p.kind === 'kosten') return `Kosten (${crit().label}): R${p.robot_id} für #${p.task_id} → +${fmtE(p.c)} ${unit()}`;
    if (p.kind === 'zeile') {
      return p.A < 0
        ? `Zeilenregel #${p.task_id}: Belohnung fürs Einschalten −A = ${fmtE(-A)}`
        : `Zeilenregel #${p.task_id}: zwei Roboter für einen Auftrag +2A = ${fmtE(2 * A)}`;
    }
    return `Spaltenregel R${p.robot_id}: zwei Aufträge für einen Roboter +B = ${fmtE(B)}`;
  }
  function assignments(x) {
    return vars().filter((v, i) => x[i]).map((v) => ({ task: v.task_id, robot: v.robot_id, cost: v.cost }));
  }
  function describeState(x) {
    const a = assignments(x);
    return a.length ? a.map((s) => `#${s.task}→R${s.robot}`).join(' · ') : 'alle Schalter aus';
  }
  /** Regelverstöße eines Zustands (unabhängig davon, ob die Regel gerade aktiv ist). */
  function violations(x) {
    const out = [];
    for (const t of st.data.instance.tasks) {
      const idx = vars().map((v, i) => (v.task_id === t.transport_id ? i : -1)).filter((i) => i >= 0);
      const on = idx.filter((i) => x[i]).length;
      if (on !== 1) out.push({ kind: 'zeile', task: t.transport_id, on, possible: idx.length > 0 });
    }
    return out; // Doppelbelegung ist zulässig – kein Verstoß
  }
  const isValid = (x) => violations(x).length === 0;
  const valid4 = (m) => Boolean(m && isValid(m.x));
  /** Aufträge je Roboter (Doppelbelegung ist zulässig). */
  function robotLoads(x) {
    const by = new Map();
    vars().forEach((v, i) => { if (x[i]) by.set(v.robot_id, [...(by.get(v.robot_id) || []), v.task_id]); });
    return [...by].map(([robot, ts]) => ({ robot, tasks: ts }));
  }
  function violationText(v) {
    if (v.kind === 'zeile') {
      if (!v.possible) return `#${v.task}: kein freier Roboter – Regel nicht erfüllbar`;
      return v.on === 0 ? `#${v.task}: niemand übernimmt` : `#${v.task}: ${v.on} Roboter fahren`;
    }
    return `R${v.robot}: ${v.on} Aufträge gleichzeitig`;
  }
  function greedy() {
    const x = new Uint8Array(vars().length);
    for (const t of st.data.instance.tasks) {
      let best = -1;
      vars().forEach((v, i) => { if (v.task_id === t.transport_id && (best < 0 || v.cost < vars()[best].cost)) best = i; });
      if (best >= 0) x[best] = 1;
    }
    return x;
  }

  // ---------------------------------------------------------------- Rechnen
  function compute() {
    const form = st.data.formulation;
    st.model = makeModel(form, { A: st.A, B: 0, terms: st.terms });
    const key = `${st.A}|${TERM_ORDER.map((k) => (st.terms[k] ? 1 : 0)).join('')}|${form.n}|${st.selected}|${st.mode}`;
    if (key !== st.resultKey) {
      st.result = search(st.model, 12);
      st.resultKey = key;
    }
  }

  function minUnder(terms) {
    const m = makeModel(st.data.formulation, { A: st.A, B: 0, terms });
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
      landscape.update({ model: st.model, labels: vars().map((v, i) => varLabel(i)), x: st.x, cacheKey: st.result,
        minX: st.result ? fromMask(st.result.min.mask, vars().length) : null, isValid });
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
    st.terms = { ...STEPS[k - 1].terms };
    if (DEFAULT_FORMULA_TAB[k]) formula.setTab(DEFAULT_FORMULA_TAB[k], false);
    if (st.showAll) st.terms = { kosten: true, zeile: true };
    update();
  }
  function applyVisibility() {
    layout.querySelectorAll('[data-min-step]').forEach((n) => {
      n.hidden = !st.showAll && st.step < Number(n.dataset.minStep);
    });
    // Ohne Energie-Spalte nutzt das Schachbrett die volle Breite
    layout.querySelector('.oh-main').classList.toggle('single', !st.showAll && st.step < 3);
  }

  function renderExplain() {
    const d = st.data.instance;
    const T = d.tasks.length;
    const free = d.robots.filter((r) => r.available);
    const nVars = vars().length;
    const perTask = d.tasks.map((t) => `#${t.transport_id}: ${vars().filter((v) => v.task_id === t.transport_id).length}`).join(', ');
    const cmin = nVars ? Math.min(...vars().map((v) => v.cost)) : 0;
    const noCand = d.tasks.filter((t) => !vars().some((v) => v.task_id === t.transport_id));
    const next = st.step < STEPS.length ? ` <button class="btn small primary" type="button" data-next>Weiter: ${st.step + 1} · ${STEPS[st.step].title} →</button>` : '';
    let html = '';
    if (st.step === 1) {
      html = `<b>${T} Auftrag${T === 1 ? '' : 'e'}</b> (${d.tasks.map((t) => `#${t.transport_id}`).join(', ')}),
        <b>${free.length} von ${d.robots.length} Robotern frei</b>${free.length ? ` (${free.map((r) => `R${r.robot_id}`).join(', ')})` : ''}.
        Frage: <b>Welcher Roboter übernimmt welchen Auftrag, damit ${escapeHtml(crit().goal)}?</b>
        <span class="hint">(Kriterium ${escapeHtml(crit().label)}, wählbar ab Schritt 3)</span>
        ${T > free.length ? '<br>Mehr Aufträge als freie Roboter – zulässig: Ein Roboter übernimmt dann mehrere.' : ''}`;
    } else if (st.step === 2) {
      html = `Ein Optimierer versteht nur <b>Bits</b>: je Auftrag × möglichem Roboter ein Schalter x<sub>t,r</sub> („r fährt t“, 1 = ja).
        Hier ${perTask} → <b>${nVars} Qubits</b>. ${st.mode === 'kandidaten' ? 'Belegte Roboter: kein Schalter (grau).' : 'Auch belegte Roboter bekommen Schalter – mehr Qubits.'}
        Die Karte zeigt die Fahrt jedes Schalters. <b>Noch fehlt die Bewertung.</b>`;
    } else if (st.step === 3) {
      const m3 = minUnder({ kosten: true });
      html = `Jeder Schalter bekommt einen <b>Preis <i>c</i><sub>t,r</sub></b> nach <b>${escapeHtml(crit().label)}</b>
        (${escapeHtml(crit().en)}, ${escapeHtml(unit())}): ${formulaHtml(crit().formula)} – die kleine Zahl im Schachbrett, einstellbar unter „Bewertungskriterium“.
        <b>Energie</b> = Summe der Preise eingeschalteter Schalter. Minimum über alle ${nf(2 ** nVars)} Stellungen:
        <b>${m3 ? describeState(m3.x) : '–'}</b>, E = ${m3 ? fmtE(m3.E) : '–'} – <b>niemand fährt</b>. Kosten allein reichen nicht.`;
    } else if (st.step === 4) {
      const m = minUnder({ kosten: true, zeile: true });
      const v = m ? violations(m.x) : [];
      const none = v.filter((x) => x.kind === 'zeile' && x.on === 0 && x.possible);
      const doubles = m ? robotLoads(m.x).filter((r) => r.tasks.length > 1) : [];
      html = `Regel: <b>Jeder Auftrag genau ein Roboter</b> – Strafe <b>A·(1 − Σ Zeile)²</b>: genau einer → 0, sonst ≥ A.
        Minimum bei A = ${nf(st.A)}: <b>${m ? describeState(m.x) : '–'}</b> (E = ${m ? fmtE(m.E) : '–'}) – je Auftrag der billigste Roboter.
        ${none.length ? `<br><span class="warnline">⚠ A zu klein gegenüber der günstigsten Zuweisung (${fmtE(cmin)} ${escapeHtml(unit())}): Liegenlassen ist billiger – A erhöhen.</span>` : ''}
        ${doubles.length ? `<br>${doubles.map((r) => `R${r.robot} übernimmt ${r.tasks.map((t) => `#${t}`).join(', ')}`).join(', ')} – <b>Doppelbelegung ist zulässig</b>.
          Die Kosten zählen fest je Auftrag; dass der zweite erst nach dem ersten startet, bildet <a href="#/ta/reihenfolge?auftraege=${st.selected.join(',')}">One-Hot + Reihenfolge</a> ab.` : ''}
        ${!valid4(m) && noCand.length ? `<br>${noCand.map((t) => `#${t.transport_id}`).join(', ')} hat keinen Schalter – seine Zeilenregel kostet immer A.` : ''}`;
    } else {
      const mc = metrics();
      html = `Ausmultipliziert: eine <b>QUBO-Matrix</b> mit <b>${mc.n} Qubits</b> und <b>${mc.couplings} Kopplungen</b> – alle aus der
        <span style="color:${TERM_COLORS.zeile}">Zeilenregel</span>, also nur innerhalb eines Auftrags. Ohne Spaltenregel sind die Aufträge <b>nicht gekoppelt</b>:
        Die Matrix zerfällt in einen Block je Auftrag. Größter Koeffizient <b>${fmtE(mc.maxCoef)}</b>: je größer A, desto feiner muss die Hardware auflösen (→ normierte Matrix).`;
    }
    explain.innerHTML = `<div class="explain-title">Schritt ${st.step} · ${STEPS[st.step - 1].title}</div><div>${html}</div>${next ? `<div style="margin-top:8px">${next}</div>` : ''}`;
    const nb = explain.querySelector('[data-next]');
    if (nb) nb.addEventListener('click', () => goStep(st.step + 1));
  }

  function renderMap() {
    const d = st.data.instance;
    map.setRobots(d.robots.map((r) => ({ ...r, dim: st.mode === 'kandidaten' && !r.available })));
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
    const d = st.data.instance;
    const idx = new Map(vars().map((v, i) => [`${v.task_id}|${v.robot_id}`, i]));
    const showRow = st.terms.zeile || st.step >= 4 || st.showAll;
    const showCol = st.step >= 4 || st.showAll;
    const table = el('table', { class: 'board' },
      el('thead', {}, el('tr', {}, el('th', { class: 'corner' }, 'Auftrag ╲ Roboter'),
        d.robots.map((r) => el('th', { 'data-robot': r.robot_id }, el('div', {}, `R${r.robot_id}`),
          el('div', { class: 'hint' }, el('span', { class: 'dot-inline', style: { background: statusColor(r.status) } }), r.available ? ' frei' : ' belegt'))),
        showRow ? el('th', {}, 'Σ Zeile') : null)),
      el('tbody', {}, d.tasks.map((t) => {
        const rowIdx = d.robots.map((r) => idx.get(`${t.transport_id}|${r.robot_id}`));
        const on = rowIdx.filter((i) => i != null && st.x[i]).length;
        const possible = rowIdx.some((i) => i != null);
        return el('tr', {},
          el('th', { class: 'rowhead', 'data-task': t.transport_id }, el('div', {}, `#${t.transport_id}`), el('div', { class: 'hint' }, `${shortName(t.from_entity)} → ${shortName(t.to_entity)}`)),
          d.robots.map((r) => {
            const i = idx.get(`${t.transport_id}|${r.robot_id}`);
            if (i == null) {
              return withTip(el('td', { class: 'cell none', 'data-task': t.transport_id, 'data-robot': r.robot_id }, '–'), tipHtml(`Kein Schalter für R${r.robot_id} → #${t.transport_id}`,
                [r.available ? 'Roboter ist nicht zuständig für diesen Bereich' : `R${r.robot_id} war belegt (${statusLabel(r.status)})`, 'Umschalten oben: „alle Roboter“']));
            }
            const v = vars()[i];
            const b = el('button', { class: `cell switch${st.x[i] ? ' on' : ''}`, type: 'button', 'data-var': i, 'data-task': v.task_id, 'data-robot': v.robot_id, 'aria-pressed': String(Boolean(st.x[i])),
              'aria-label': `${varLabel(i)} umschalten` },
            el('span', { class: 'bit' }, st.x[i] ? '1' : '0'),
            el('span', { class: 'var' }, varLabel(i)),
            st.step >= 3 || st.showAll ? el('span', { class: 'cost' }, nf(v.cost, 1)) : null);
            b.addEventListener('click', () => { st.x[i] = st.x[i] ? 0 : 1; update(); });
            return el('td', {}, b);
          }),
          showRow ? el('td', { class: `sum row-sum ${!possible ? 'bad' : on === 1 ? 'good' : 'bad'}`, 'data-task': t.transport_id }, `${on} ${on === 1 ? '✓' : '✗'}`) : null);
      })),
      showCol ? el('tfoot', {}, el('tr', {}, el('th', { title: 'Doppelbelegung ist zulässig' }, 'Aufträge je Roboter'), d.robots.map((r) => {
        const on = vars().filter((v, i) => v.robot_id === r.robot_id && st.x[i]).length;
        return el('td', { class: 'sum col-sum', 'data-robot': r.robot_id }, String(on));
      }), showRow ? el('td') : null)) : null);
    boardHost.replaceChildren(el('div', { class: 'table-wrap' }, table));

    fill(quickHost, 
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = new Uint8Array(vars().length); update(); } }, 'Alle aus'),
      el('button', { class: 'btn small', type: 'button', title: 'Jeder Auftrag nimmt den nächsten Roboter', onclick: () => { st.x = greedy(); update(); } }, 'Jeder nimmt den nächsten'),
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = Uint8Array.from(vars(), () => (Math.random() < 0.3 ? 1 : 0)); update(); } }, 'Zufall'),
      st.step >= 3 || st.showAll
        ? el('button', { class: 'btn small primary', type: 'button', disabled: !st.result, title: 'Den Zustand mit der niedrigsten Energie laden',
          onclick: () => { st.x = fromMask(st.result.min.mask, vars().length); update(); } }, 'Minimum laden')
        : null,
      el('a', { class: 'btn small', href: `#/ta/baukasten?auftraege=${st.selected.join(',')}&plaetze=1&kriterium=${st.criterion}${st.mode === 'alle' ? '&modus=alle' : ''}`,
        title: 'Dieselben Aufträge im Formel-Baukasten: Regeln verändern, weglassen, falsch machen' }, 'Formel verändern → Baukasten'),
      el('a', { class: 'btn small', href: `#/ta/domain-wall?auftraege=${st.selected.join(',')}&kriterium=${st.criterion}&schritt=${st.step}`,
        title: 'Dieselben Aufträge mit Domain Wall: R − 1 Bits je Auftrag, Kette statt Clique' }, 'Vergleich: Domain Wall →'));
  }

  function renderControls() {
    const toggles = el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Regeln'),
      TERM_ORDER.map((k) => {
        const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(Boolean(st.terms[k])), title: TERM_LABELS[k] },
          el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }), TERM_SHORT[k]);
        b.addEventListener('click', () => { st.terms[k] = !st.terms[k]; update(); });
        return b;
      }));
    fill(togglesHost, toggles);
    const rec = recommended();
    const items = [];
    if (st.step >= 4 || st.showAll) items.push({ key: 'A', label: 'A · Zeilenregel', color: TERM_COLORS.zeile, value: st.A, recommended: rec, hint: '> billigste Zuweisung eines Auftrags' });
    weightsHost.hidden = !items.length;
    if (items.length) weights.render({ items });
  }
  let pending = null;
  function scheduleUpdate() {
    clearTimeout(pending);
    pending = setTimeout(update, 60);
  }

  function renderEnergy() {
    if (!(st.step >= 3 || st.showAll)) return;
    const d = st.data.instance;
    const parts = { kosten: [], zeile: [] };
    vars().forEach((v, i) => { if (st.x[i]) parts.kosten.push({ v: v.cost, text: `#${v.task_id} → R${v.robot_id}: ${fmtE(v.cost)} ${unit()}` }); });
    for (const t of d.tasks) {
      const idx = vars().map((v, i) => (v.task_id === t.transport_id ? i : -1)).filter((i) => i >= 0);
      const on = idx.filter((i) => st.x[i]).length;
      const val = st.A * (1 - on) ** 2;
      const why = !idx.length ? 'kein Schalter möglich' : on === 0 ? 'niemand übernimmt' : on === 1 ? 'genau einer ✓' : `${on} Roboter fahren`;
      parts.zeile.push({ v: val, text: `#${t.transport_id}: ${on} an → A·(1−${on})² = ${fmtE(val)} · ${why}`, ok: on === 1 });
    }
    const sums = Object.fromEntries(TERM_ORDER.map((k) => [k, st.terms[k] ? parts[k].reduce((s, p) => s + p.v, 0) : 0]));
    const E = TERM_ORDER.reduce((s, k) => s + sums[k], 0);
    const Eq = energy(st.model, st.x);
    const rank = st.result ? rankOf(st.result, toMask(st.x)) : null;
    const valid = isValid(st.x);

    const bar = el('div', { class: 'ebar' }, TERM_ORDER.filter((k) => sums[k] > 0).map((k) => withTip(
      el('div', { style: { flex: `${sums[k]} 0 0`, background: TERM_COLORS[k] } }), tipHtml(TERM_LABELS[k], [`${fmtE(sums[k])}`]))));
    const group = (k) => el('div', { class: `egroup${st.terms[k] ? '' : ' off'}` },
      el('div', { class: 'egroup-head' }, el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }),
        el('span', {}, k === 'kosten' ? `Kosten: ${crit().label} [${unit()}]` : TERM_LABELS[k]), el('strong', {}, st.terms[k] ? fmtE(sums[k]) : 'aus')),
      parts[k].length
        ? el('ul', {}, parts[k].map((p) => el('li', { class: p.ok === false ? 'bad' : p.ok ? 'good' : '' }, p.text)))
        : el('div', { class: 'hint' }, 'kein Schalter an – keine Kosten'));

    fill(energyHost, 
      el('div', { class: 'etotal' },
        el('div', {}, el('div', { class: 'hint' }, 'Energie E'), el('div', { class: 'ebig' }, fmtE(E))),
        el('div', { class: 'erank' },
          rank ? el('div', {}, `Platz ${nf(rank)} von ${nf(st.result.total)}`) : null,
          el('div', { class: valid ? 'okline' : 'warnline' }, valid ? '✓ gültige Zuweisung' : `✗ ${violations(st.x).map(violationText).join(' · ')}`))),
      bar,
      ...TERM_ORDER.map(group),
      st.step >= STEPS.length || st.showAll
        ? el('p', { class: 'hint' }, `Probe über die Matrix: xᵀQx + Konstante = ${fmtE(Eq)} ${Math.abs(Eq - E) < 1e-6 ? '✓ identisch' : '✗ ABWEICHUNG'}`)
        : null);
  }

  function renderRanking() {
    if (!(st.step >= 3 || st.showAll)) return;
    const n = vars().length;
    if (!st.result) {
      rankHost.replaceChildren(el('p', { class: 'hint' }, `${n} Schalter = ${nf(2 ** n)} Stellungen – zu viele für den Browser (max. ${MAX_SEARCH_BITS}). Weniger Aufträge wählen.`));
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
    rankHost.replaceChildren(el('div', { class: 'table-scroll' }, el('table', { class: 'data' },
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
          hovertemplate: 'Platz %{x}: E = %{y}<extra></extra>', name: 'Zustände' },
        { type: 'scatter', mode: 'markers', x: [curRank + 1], y: [all[cur]], marker: { size: 14, color: C.accent, line: { color: C.surface, width: 2 } },
          hovertemplate: 'dein Zustand: Platz %{x}, E = %{y}<extra></extra>', name: 'dein Zustand' },
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
    return { n: vars().length, couplings: offs.length, maxCoef: coefs.length ? Math.max(...coefs) : 0 };
  }

  function renderMetrics() {
    const mc = metrics();
    const R = st.data.instance.robots.length;
    fill(metricsHost, el('div', { class: 'kpis', style: { marginTop: '10px' } },
      kpiSmall('Variablen (Qubits)', nf(mc.n), 'ein Schalter je Auftrag × möglichem Roboter'),
      kpiSmall('Kopplungen', nf(mc.couplings), 'nur Zeilenregel – je Auftrag ein Block'),
      kpiSmall('Größter |Koeffizient|', fmtE(mc.maxCoef), 'bestimmt die nötige Präzision'),
      kpiSmall('Pro Auftrag bei R Robotern', `${R} / ${(R * (R - 1)) / 2}`, 'Variablen / Kopplungen der Clique (One-Hot)')),
    el('div', { class: 'legend' }, TERM_ORDER.slice(1).map((k) => el('span', { class: 'legend-item' },
      el('span', { class: 'swatch', style: { background: TERM_COLORS[k], height: '3px' } }), TERM_LABELS[k]))));
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
    st.terms = st.showAll ? { kosten: true, zeile: true } : { ...STEPS[st.step - 1].terms };
    update();
  });

  st.terms = { ...STEPS[st.step - 1].terms };
  load();
}

function kpiSmall(label, value, note) {
  return el('div', { class: 'kpi' }, el('div', { class: 'kpi-label' }, label), el('div', { class: 'kpi-value', style: { fontSize: '1.3rem' } }, value),
    el('div', { class: 'kpi-note' }, note));
}
