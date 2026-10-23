// Reiter „Kodierungen“ › One-Hot: die Formulierung Schritt für Schritt an echten Aufträgen erleben.
// Schalter anklicken, Regeln zuschalten, Strafgewichte verschieben – jede Energie-Zahl wird erklärt.
import { el, fill, nf, withTip, tipHtml, escapeHtml } from '../util.js';
import {
  C, TERM_COLORS, TERM_LABELS, TERM_ORDER, TERM_SHORT, areaColor, areaLabel, plot, statusColor, statusLabel,
} from '../theme.js';
import { createLayoutMap } from '../components/layoutMap.js';
import { initialScenario, renderScenario, shortName } from '../components/scenario.js';
import { MAX_SEARCH_BITS, MAX_STORE_BITS, energy, fromMask, makeModel, rankOf, search, toMask } from '../qubo/engine.js';
import { createMatrixView } from '../qubo/matrixView.js';
import { createGraphView } from '../qubo/graphView.js';
import { DEFAULT_FORMULA_TAB, createFormulaPanel } from './onehotFormula.js';
import { createCriterionPanel, formulaHtml, niceCeil } from './onehotCriterion.js';

const STEPS = [
  { title: 'Szenario', terms: {} },
  { title: 'Schalter', terms: {} },
  { title: 'Kosten', terms: { kosten: true } },
  { title: 'Zeilenregel', terms: { kosten: true, zeile: true } },
  { title: 'Spaltenregel', terms: { kosten: true, zeile: true, spalte: true } },
  { title: 'QUBO & Hardware', terms: { kosten: true, zeile: true, spalte: true } },
];
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (s) => String(s).replace(/\d/g, (d) => SUB[d]);
const fmtE = (v) => nf(v, 1).replace('-', '−');

export function renderOneHot(root, { run, api, params }) {
  const tasks = run.tasks;
  const st = {
    step: Math.min(6, Math.max(1, Number(params.schritt) || 1)),
    showAll: false,
    ...initialScenario(tasks, params), // start, window, selected – auch per Link ?auftraege=1,2,3
    mode: 'kandidaten',
    A: 50,
    B: 50,
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
  const rankHost = el('div');
  const stripHost = el('div', { class: 'chart short' });
  const matrixHost = el('div');
  const graphHost = el('div');
  const metricsHost = el('div');
  const formulaHost = el('div');
  const criterionHost = el('div');

  const section = (minStep, node) => {
    node.dataset.minStep = String(minStep);
    return node;
  };
  const cardEl = (title, sub2, ...body) => el('section', { class: 'card' },
    el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, title), sub2 ? el('div', { class: 'card-sub', html: sub2 }) : null)),
    ...body);

  root.append(el('p', {
    class: 'intro',
    html: `Hier wird aus echten Aufträgen deines Laufs Schritt für Schritt eine <strong>One-Hot-QUBO</strong>. Geh die Schritte
      der Reihe nach durch – jeder deckt eine neue Zutat auf. Alle Zahlen sind live: Schalter anklicken, Regeln an- und
      abschalten, Strafgewichte verschieben. Die Lese-Version mit Hintergrund steht in <code>encodings/one_hot/README.md</code>.`,
  }));
  root.append(el('section', { class: 'card guide' }, stepper,
    el('label', { class: 'filter-group', for: 'oh-all', style: { marginTop: '6px' } }, showAllBox, el('span', { class: 'hint' }, 'Alles auf einmal zeigen')),
    explain));

  const layout = el('div', { class: 'grid', style: { marginTop: '16px' } },
    el('div', { class: 'grid grid-2' },
      cardEl('Szenario: welche Aufträge?', 'Ein echter Moment aus der Simulation', scenarioBody),
      cardEl('Lage in der Fabrik', 'Roboter im Snapshot · <b>#</b> = Abholort eines Auftrags · dunkle Linie = eingeschalteter Schalter', mapHost)),
    section(2, el('div', { class: 'grid oh-main' },
      cardEl('Schachbrett der Schalter', 'Zeile = Auftrag, Spalte = Roboter · Klick schaltet x = 0 ↔ 1 · kleine Zahl = Kosten <i>c</i><sub>t,r</sub> nach dem gewählten Kriterium', quickHost, boardHost),
      section(3, cardEl('Energie dieses Zustands', 'Jeder Beitrag einzeln erklärt', controlsHost, energyHost)))),
    section(3, cardEl('Bewertungskriterium: Wonach bewertet das QUBO?', 'Bestimmt die Zahl <i>c</i><sub>t,r</sub> jedes Schalters – sie landet auf der Diagonale der QUBO-Matrix', criterionHost)),
    section(3, cardEl('Die Formel dahinter', 'Wie die mathematische Formulierung wirkt – und wie die Zahlen eingesetzt werden · über Formelteile fahren hebt die Schalter hervor', formulaHost)),
    section(3, cardEl('Die günstigsten Zustände', 'Alle Schalterstellungen durchprobiert und nach Energie sortiert · Zeile anklicken zum Laden', rankHost, stripHost)),
    section(6, el('div', { class: 'grid grid-2' },
      cardEl('QUBO-Matrix', 'Jede Zahl ist eine Summe aus Kosten, Zeilen- und Spaltenregel · Hover erklärt · umrandet = zählt gerade', matrixHost),
      cardEl('Kopplungsgraph & Hardware-Bedarf', 'Knoten = Qubits, Linien = Kopplungen · dicke Linie = beide Schalter an', graphHost, metricsHost))));
  root.append(layout);

  const map = createLayoutMap(mapHost, { entities: run.entities, robots: run.robots, entityLabels: false });
  let matrixView = null;
  let graphView = null;
  const formula = createFormulaPanel(formulaHost, {
    getState: () => ({ data: st.data, x: st.x, A: st.A, B: st.B, terms: st.terms, step: st.step, model: st.model,
      criterion: st.data?.instance.criterion }),
    highlight: (sel) => highlightBoard(sel),
    clearHighlight: () => highlightBoard(null),
    setWeight: (key, value) => { st[key] = value; update(); },
    violations: (x) => violations(x),
    describe: (x) => describeState(x),
  });
  if (DEFAULT_FORMULA_TAB[st.step]) formula.setTab(DEFAULT_FORMULA_TAB[st.step], false);
  const criterionPanel = createCriterionPanel(criterionHost, {
    getState: () => ({ data: st.data, weightNote: st.weightNote, selected: st.selected }),
    setCriterion: (key) => { st.criterion = key; st.adjustWeights = true; load(); },
    setParam: (key, value) => { st.costParams = { ...st.costParams, [key]: value }; st.adjustWeights = true; load(); },
    resetParams: () => { st.costParams = {}; st.adjustWeights = true; load(); },
  });
  // Register per Link: #/kodierungen/one-hot?schritt=4&formel=qubo
  if (['formel', 'eingesetzt', 'qubo', 'wirkung'].includes(params.formel)) formula.setTab(params.formel, false);

  // ---------------------------------------------------------------- Szenario-Auswahl
  function drawScenario(error) {
    const snap = st.data ? st.data.instance.snapshot : null;
    renderScenario(scenarioBody, {
      tasks, st, load, error,
      note: snap ? `Vereinfachung fürs Lernen: Alle gewählten Aufträge sehen die Flotte im Snapshot von Anfrage #${snap.transport_id} (t = ${nf(snap.time)} s). Wie echte Zuweisungsprobleme aus dem Log geschnitten werden, ist eine offene Frage für Stufe 2.` : null,
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
    // Strafgewichte an den Kostenbereich anpassen, wenn Kriterium oder Annahmen geändert wurden
    if (st.adjustWeights) {
      st.adjustWeights = false;
      const maxC = Math.max(0, ...st.data.instance.variables.map((v) => v.cost));
      st.A = niceCeil(Math.max(10, 1.5 * maxC));
      st.B = st.A;
      st.weightNote = `A und B wurden an den Kostenbereich angepasst: 1,5 × größte Kosten (${nf(maxC, 1)}) → ${nf(st.A)}.`;
    } else {
      st.weightNote = '';
    }
    const prevX = st.x;
    st.x = new Uint8Array(n);
    if (prevX.length === n) st.x.set(prevX); // gleiche Schalter (nur Kriterium geändert) → Zustand behalten
    st.resultKey = '';
    // Startzustand per Link: #/kodierungen/one-hot?schritt=5&zustand=gierig|minimum (nur beim ersten Laden)
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
  const sliderMax = () => Math.max(200, niceCeil(4 * Math.max(0, ...vars().map((v) => v.cost))), st.A, st.B);
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
    for (const r of st.data.instance.robots) {
      const on = vars().filter((v, i) => v.robot_id === r.robot_id && x[i]).length;
      if (on > 1) out.push({ kind: 'spalte', robot: r.robot_id, on });
    }
    return out;
  }
  const isValid = (x) => violations(x).length === 0;
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
    st.model = makeModel(form, { A: st.A, B: st.B, terms: st.terms });
    const key = `${st.A}|${st.B}|${TERM_ORDER.map((k) => (st.terms[k] ? 1 : 0)).join('')}|${form.n}|${st.selected}|${st.mode}`;
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
    st.terms = { ...STEPS[k - 1].terms };
    if (DEFAULT_FORMULA_TAB[k]) formula.setTab(DEFAULT_FORMULA_TAB[k], false);
    if (st.showAll) st.terms = { kosten: true, zeile: true, spalte: true };
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
    const next = st.step < 6 ? ` <button class="btn small primary" type="button" data-next>Weiter: ${st.step + 1} · ${STEPS[st.step].title} →</button>` : '';
    let html = '';
    if (st.step === 1) {
      html = `Im gewählten Moment liegen <b>${T} Auftrag${T === 1 ? '' : 'e'}</b> vor (${d.tasks.map((t) => `#${t.transport_id}`).join(', ')}).
        Im Flotten-Snapshot sind <b>${free.length} von ${d.robots.length} Robotern frei</b>${free.length ? ` (${free.map((r) => `R${r.robot_id}`).join(', ')})` : ''}.
        Die Frage an den Optimierer: <b>Welcher Roboter übernimmt welchen Auftrag, damit ${escapeHtml(crit().goal)}?</b>
        <span class="hint">(Kriterium: ${escapeHtml(crit().label)} – wählbar ab Schritt 3)</span>
        ${T > free.length ? `<br><span class="warnline">⚠ Mehr Aufträge als freie Roboter – keine Zuweisung kann alle Regeln erfüllen. Spannend für Schritt 5.</span>` : ''}`;
    } else if (st.step === 2) {
      html = `Ein Quantenoptimierer versteht keine Frage, nur <b>Bits</b>. Deshalb bekommt <b>jede Kombination aus Auftrag und möglichem Roboter einen Schalter</b>
        x<sub>t,r</sub>: „Roboter r übernimmt Auftrag t“ (1 = ja, 0 = nein). Hier: ${perTask} → <b>${nVars} Schalter = ${nVars} Qubits</b>.
        ${st.mode === 'kandidaten' ? 'Belegte Roboter bekommen gar keinen Schalter (grau) – das hält das Problem klein.' : 'Auch belegte Roboter bekommen einen Schalter – das Problem wird größer.'}
        Klick im Schachbrett Schalter an und schau in der Karte, welche Fahrt das wäre. <b>Noch gibt es keine Bewertung</b> – der Rechner weiß nicht, was „gut“ ist.`;
    } else if (st.step === 3) {
      const m3 = minUnder({ kosten: true });
      html = `Jetzt bekommt jeder Schalter einen <b>Preis <i>c</i><sub>t,r</sub></b> – nach dem Kriterium <b>${escapeHtml(crit().label)}</b>
        (${escapeHtml(crit().en)}, in ${escapeHtml(unit())}): ${formulaHtml(crit().formula)}. Das ist die kleine Zahl im Schachbrett.
        Welches Kriterium gilt und woraus sich die Zahl zusammensetzt, stellst du unten unter <b>„Bewertungskriterium“</b> ein.
        Die <b>Energie</b> ist die Summe der Preise aller eingeschalteten Schalter – der Optimierer sucht die niedrigste.
        Nur mit Kosten ergibt das über alle ${nf(2 ** nVars)} Stellungen: <b>${m3 ? describeState(m3.x) : '–'}</b>, E = ${m3 ? fmtE(m3.E) : '–'}.
        Natürlich: Ohne Regeln ist <b>alles aus</b> am billigsten – <b>niemand fährt</b>. Kosten allein reichen nicht. Wir brauchen Regeln.`;
    } else if (st.step === 4) {
      const m = minUnder({ kosten: true, zeile: true });
      const v = m ? violations(m.x) : [];
      const dbl = v.filter((x) => x.kind === 'spalte');
      const none = v.filter((x) => x.kind === 'zeile' && x.on === 0 && x.possible);
      html = `Regel 1: <b>Jeder Auftrag braucht genau einen Roboter.</b> Pro Auftrag kommt die Strafe <b>A·(1 − Anzahl Schalter in der Zeile)²</b> dazu:
        genau einer → 0, keiner oder zwei → mindestens A. Mit A = ${nf(st.A)} ist das Minimum jetzt <b>${m ? describeState(m.x) : '–'}</b> (E = ${m ? fmtE(m.E) : '–'}).
        ${none.length ? `<br><span class="warnline">⚠ A = ${nf(st.A)} ist zu klein gegenüber den Kosten (günstigste Zuweisung: ${fmtE(cmin)} ${escapeHtml(unit())}) – einen Auftrag liegen zu lassen ist billiger. Schieb A nach oben!</span>` : ''}
        ${dbl.length ? `<br><span class="warnline">⚠ Aber: ${dbl.map((x) => `R${x.robot} hat ${x.on} Aufträge`).join(', ')} – das verbietet noch niemand. Weiter zur Spaltenregel.</span>` : ''}
        ${!none.length && !dbl.length ? '<br>Jeder Auftrag hat seinen Roboter – und es gibt hier zufällig keinen Konflikt.' : ''}`;
    } else if (st.step === 5) {
      const m = minUnder({ kosten: true, zeile: true, spalte: true });
      const g = greedy();
      const gv = violations(g).filter((x) => x.kind === 'spalte');
      const valid = m && isValid(m.x);
      html = `Regel 2: <b>Kein Roboter bekommt zwei Aufträge.</b> Für jedes Paar von Schaltern in derselben Spalte gibt es die Strafe <b>B·x·x′</b> –
        sie greift nur, wenn beide an sind. ${gv.length ? `„Jeder nimmt seinen nächsten“ (${describeState(g)}) würde genau das verletzen: ${gv.map(violationText).join(', ')}.` : ''}
        Mit A = ${nf(st.A)} und B = ${nf(st.B)} ist das Minimum <b>${m ? describeState(m.x) : '–'}</b> mit E = ${m ? fmtE(m.E) : '–'}
        ${valid ? '<span class="okline">✓ alle Regeln erfüllt.</span>' : `<span class="warnline">✗ ${m ? violations(m.x).map(violationText).join(', ') : ''}</span>`}
        ${!valid && T > free.length ? `<br>Es gibt mehr Aufträge als freie Roboter – irgendeine Regel muss brechen. Der Optimierer wählt den <b>billigsten Regelbruch</b>: Vergleiche A und B!
          In Wirklichkeit würde ein Roboter zwei Aufträge <b>nacheinander</b> fahren – das kann die Sofortzuweisung nicht ausdrücken, dafür braucht es Hilfsvariablen:
          <a href="#/kodierungen/reihenfolge?auftraege=${st.selected.join(',')}">One-Hot + Reihenfolge →</a>` : ''}
        ${!valid && noCand.length ? `<br>${noCand.map((t) => `#${t.transport_id}`).join(', ')} hat keinen Schalter – seine Zeilenregel kostet immer A.` : ''}`;
    } else {
      const mc = metrics();
      html = `Alles zusammen, ausmultipliziert, ist eine <b>QUBO-Matrix</b> mit <b>${mc.n} Variablen</b> und <b>${mc.couplings} Kopplungen</b>
        (${mc.row} aus Zeilenregeln, ${mc.col} aus Spaltenregeln). Jede Kopplung heißt für die Hardware: Diese zwei Qubits müssen miteinander wechselwirken.
        Fahre über Matrixzellen – jede Zahl ist eine Summe aus <span style="color:${TERM_COLORS.kosten}">Kosten</span>,
        <span style="color:${TERM_COLORS.zeile}">Zeilenregel</span> und <span style="color:${TERM_COLORS.spalte}">Spaltenregel</span>.
        Größter Koeffizient: <b>${fmtE(mc.maxCoef)}</b> – je größer A und B, desto feiner muss die Hardware die Zahlen einstellen können.`;
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
    const showCol = st.terms.spalte || st.step >= 5 || st.showAll;
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
      showCol ? el('tfoot', {}, el('tr', {}, el('th', {}, 'Σ Spalte'), d.robots.map((r) => {
        const on = vars().filter((v, i) => v.robot_id === r.robot_id && st.x[i]).length;
        return el('td', { class: `sum col-sum ${on <= 1 ? 'good' : 'bad'}`, 'data-robot': r.robot_id }, `${on} ${on <= 1 ? '✓' : '✗'}`);
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
      el('a', { class: 'btn small', href: `#/kodierungen/baukasten?auftraege=${st.selected.join(',')}&plaetze=1&kriterium=${st.criterion}${st.mode === 'alle' ? '&modus=alle' : ''}`,
        title: 'Dieselben Aufträge im Formel-Baukasten: Regeln verändern, weglassen, falsch machen' }, 'Formel verändern → Baukasten'));
  }

  function renderControls() {
    const toggles = el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Regeln'),
      TERM_ORDER.map((k) => {
        const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(Boolean(st.terms[k])), title: TERM_LABELS[k] },
          el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }), TERM_SHORT[k]);
        b.addEventListener('click', () => { st.terms[k] = !st.terms[k]; update(); });
        return b;
      }));
    const slider = (name, key, color, minStep) => {
      if (!(st.step >= minStep || st.showAll)) return null;
      const input = el('input', { type: 'range', min: 0, max: sliderMax(), step: 1, value: st[key], 'aria-label': name });
      const val = el('strong', { style: { color } }, nf(st[key]));
      input.addEventListener('input', () => { st[key] = Number(input.value); val.textContent = nf(st[key]); scheduleUpdate(); });
      return el('div', { class: 'slider-row' }, el('span', { class: 'filter-label', style: { minWidth: '150px' } }, name), input, val);
    };
    fill(controlsHost, toggles,
      slider('Strafgewicht A (Zeile)', 'A', TERM_COLORS.zeile, 4),
      slider('Strafgewicht B (Spalte)', 'B', TERM_COLORS.spalte, 5));
  }
  let pending = null;
  function scheduleUpdate() {
    clearTimeout(pending);
    pending = setTimeout(update, 60);
  }

  function renderEnergy() {
    if (!(st.step >= 3 || st.showAll)) return;
    const d = st.data.instance;
    const parts = { kosten: [], zeile: [], spalte: [] };
    vars().forEach((v, i) => { if (st.x[i]) parts.kosten.push({ v: v.cost, text: `#${v.task_id} → R${v.robot_id}: ${fmtE(v.cost)} ${unit()}` }); });
    for (const t of d.tasks) {
      const idx = vars().map((v, i) => (v.task_id === t.transport_id ? i : -1)).filter((i) => i >= 0);
      const on = idx.filter((i) => st.x[i]).length;
      const val = st.A * (1 - on) ** 2;
      const why = !idx.length ? 'kein Schalter möglich' : on === 0 ? 'niemand übernimmt' : on === 1 ? 'genau einer ✓' : `${on} Roboter fahren`;
      parts.zeile.push({ v: val, text: `#${t.transport_id}: ${on} an → A·(1−${on})² = ${fmtE(val)} · ${why}`, ok: on === 1 });
    }
    for (const r of d.robots) {
      const on = vars().filter((v, i) => v.robot_id === r.robot_id && st.x[i]).length;
      const n = vars().filter((v) => v.robot_id === r.robot_id).length;
      if (n < 2) continue;
      const pairs = on > 1 ? (on * (on - 1)) / 2 : 0;
      parts.spalte.push({ v: st.B * pairs, text: `R${r.robot_id}: ${on} Auftr${on === 1 ? 'ag' : 'äge'} → ${pairs} Paar${pairs === 1 ? '' : 'e'} · B·${pairs} = ${fmtE(st.B * pairs)}`, ok: on <= 1 });
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
        : el('div', { class: 'hint' }, k === 'kosten' ? 'kein Schalter an – keine Kosten' : 'keine Paare in einer Spalte'));

    fill(energyHost, 
      el('div', { class: 'etotal' },
        el('div', {}, el('div', { class: 'hint' }, 'Energie E'), el('div', { class: 'ebig' }, fmtE(E))),
        el('div', { class: 'erank' },
          rank ? el('div', {}, `Platz ${nf(rank)} von ${nf(st.result.total)}`) : null,
          el('div', { class: valid ? 'okline' : 'warnline' }, valid ? '✓ gültige Zuweisung' : `✗ ${violations(st.x).map(violationText).join(' · ')}`))),
      bar,
      ...TERM_ORDER.map(group),
      st.step >= 6 || st.showAll
        ? el('p', { class: 'hint' }, `Probe über die Matrix: xᵀQx + Konstante = ${fmtE(Eq)} ${Math.abs(Eq - E) < 1e-6 ? '✓ identisch' : '✗ ABWEICHUNG'}`)
        : null);
  }

  function renderRanking() {
    if (!(st.step >= 3 || st.showAll)) return;
    const n = vars().length;
    if (!st.result) {
      rankHost.replaceChildren(el('p', { class: 'hint' }, `${n} Schalter = ${nf(2 ** n)} Stellungen – zu viele zum Durchprobieren im Browser (Grenze: ${MAX_SEARCH_BITS} Schalter). Wähle weniger Aufträge.`));
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
      stripHost.replaceChildren(el('p', { class: 'hint' }, `Die Energie-Treppe (alle Zustände als Diagramm) wird bis ${MAX_STORE_BITS} Schalter gezeigt – die Rangliste oben gilt trotzdem für alle ${nf(st.result.total)} Zustände.`));
    }
  }

  function metrics() {
    const offs = st.model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const row = offs.filter((e) => e.activeParts[0]?.kind === 'zeile').length;
    const col = offs.filter((e) => e.activeParts[0]?.kind === 'spalte').length;
    const coefs = st.model.entries.filter((e) => e.activeParts.length).map((e) => Math.abs(e.value));
    return { n: vars().length, couplings: offs.length, row, col, maxCoef: coefs.length ? Math.max(...coefs) : 0 };
  }

  function renderMetrics() {
    const mc = metrics();
    const R = st.data.instance.robots.length;
    fill(metricsHost, el('div', { class: 'kpis', style: { marginTop: '10px' } },
      kpiSmall('Variablen (Qubits)', nf(mc.n), 'ein Schalter je Auftrag × möglichem Roboter'),
      kpiSmall('Kopplungen', nf(mc.couplings), `${mc.row} Zeile · ${mc.col} Spalte`),
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
    st.terms = st.showAll ? { kosten: true, zeile: true, spalte: true } : { ...STEPS[st.step - 1].terms };
    update();
  });

  st.terms = { ...STEPS[st.step - 1].terms };
  load();
}

function kpiSmall(label, value, note) {
  return el('div', { class: 'kpi' }, el('div', { class: 'kpi-label' }, label), el('div', { class: 'kpi-value', style: { fontSize: '1.3rem' } }, value),
    el('div', { class: 'kpi-note' }, note));
}
