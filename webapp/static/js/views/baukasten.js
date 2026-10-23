// Reiter „Kodierungen“ › Formel-Baukasten: die QUBO aus Bausteinen selbst zusammensetzen – auch falsch.
// Jede Lösung wird am echten Problem gemessen (Anforderungen + Ziel); die Diagnose sagt, was fehlt,
// welche Form oder welches Gewicht nicht reicht und was jeder Baustein bewirkt.
// Ausmultiplizieren: encodings/baukasten.py · Energien und Suche im Browser: qubo/engine.js.
import { el, fill, nf, tipHtml, withTip } from '../util.js';
import { initialScenario, renderScenario } from '../components/scenario.js';
import { renderSlotBoard } from '../components/slotBoard.js';
import { renderGantt } from '../components/gantt.js';
import { MAX_SEARCH_BITS, anneal, energy, fromMask, makeTermModel, rankOf, search, toMask } from '../qubo/engine.js';
import { createSchedule } from '../qubo/schedule.js';
import { createMatrixView } from '../qubo/matrixView.js';
import { createGraphView } from '../qubo/graphView.js';
import { niceCeil } from './onehotCriterion.js';
import {
  TYPE_LABEL, fmt, newTerm, renderTermEditor, specOf, standardTerm, suggestWeight, termColor, termFormula, termSentence,
  termTint, verdictOf,
} from './baukastenTerms.js';

const COST_TYPES = new Set(['kosten', 'vorgaenger']);
const LOO_AUTO_BITS = 16; // „Jeden Baustein weglassen“ bis hierhin automatisch
const PRESET_LABEL = { one_hot: 'One-Hot (Sofortzuweisung)', reihenfolge: 'One-Hot mit Reihenfolge', nur_kosten: 'Nur Kosten – leer anfangen' };
const WHY_FREE = {
  auftrag: 'Ohne Regel ist es für die QUBO kostenlos, einen Auftrag liegen zu lassen – die Kosten ziehen jeden Schalter auf 0.',
  platz: 'Ohne Regel darf ein Roboter mehrere Aufträge gleichzeitig (auf demselben Platz) fahren – jeder Auftrag nimmt einfach seinen billigsten.',
  luecke: 'Ohne Regel gilt ein Auftrag hinter einer Lücke als „erster“ und fährt vom Standort los – ein Schein-Plan.',
};
const LEVEL_ICON = { bad: '✗', warn: '⚠', ok: '✓', info: 'ℹ' };

function parseFormel(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (Array.isArray(o.terms) && o.terms.length) return { terms: o.terms, weights: o.weights || {}, active: o.active || {} };
  } catch { /* unlesbar: dann Voreinstellung */ }
  return null;
}

export function renderBaukasten(root, { run, api, params }) {
  const tasks = run.tasks;
  const linked = parseFormel(params.formel);
  const slots = [1, 2, 3].includes(Number(params.plaetze)) ? Number(params.plaetze) : 1;
  const st = {
    ...initialScenario(tasks, params),
    mode: params.modus === 'alle' ? 'alle' : 'kandidaten',
    slots,
    criterion: params.kriterium || (slots === 1 ? 'leerfahrt' : 'erledigungszeit'),
    costParams: {},
    preset: params.preset || null,
    terms: linked ? linked.terms : null, // null: Voreinstellung vom Server
    weights: linked ? linked.weights : {},
    active: linked ? linked.active : {},
    dirty: Boolean(linked), // selbst verändert? Dann bleibt die Formel bei Szenariowechseln stehen
    open: new Set(String(params.offen || '').split(',').filter(Boolean)), // Bearbeitungsfelder per Link: ?offen=zeile,luecke
    data: null,
    sched: null,
    x: new Uint8Array(0),
    model: null,
    result: null,
    resultKey: '',
    scenarioKey: '',
    loo: null,
    looKey: '',
  };

  // ---------------------------------------------------------------- Gerüst
  const scenarioBody = el('div');
  const problemHost = el('div');
  const formulaHost = el('div');
  const diagHost = el('div');
  const looHost = el('div');
  const quickHost = el('div', { class: 'quick' });
  const boardHost = el('div');
  const energyHost = el('div');
  const ganttNote = el('div');
  const ganttHost = el('div', { class: 'chart' });
  const matrixHost = el('div');
  const graphHost = el('div');
  const hardwareHost = el('div');
  const cardEl = (title, sub, ...body) => el('section', { class: 'card' },
    el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, title), sub ? el('div', { class: 'card-sub', html: sub }) : null)),
    ...body);
  const gap = () => el('div', { style: { height: '16px' } });

  root.append(el('p', {
    class: 'intro',
    html: `Hier ist die Formel <b>nicht fest</b>: Sie besteht aus Bausteinen, die du an- und abschalten, umbauen, gewichten und
      ergänzen kannst – ausdrücklich auch so, dass die QUBO <b>unzulässige oder schlechte Lösungen</b> liefert. Jede Lösung wird am
      <b>echten Problem</b> gemessen; die Diagnose sagt, welche Anforderung verletzt ist und ob eine Regel fehlt, ihre Form nicht passt
      oder ihr Gewicht zu klein ist. Der mathematische Kern: Jede quadratische Funktion <i>f</i>(<i>n</i>) = <i>a</i> + <i>b·n</i> + <i>c·n</i>²
      der Anzahl <i>n</i> eingeschalteter Schalter einer Gruppe ist eine QUBO, weil <i>x</i>² = <i>x</i>.`,
  }));
  root.append(el('div', { class: 'grid grid-2' },
    cardEl('Szenario', 'Echte Aufträge, Plätze je Roboter K und Kriterium – das echte Problem', scenarioBody),
    cardEl('Das echte Problem – woran jede Formulierung gemessen wird', 'Anforderungen und Ziel, geprüft für das Minimum deiner QUBO und für den Zustand im Schachbrett', problemHost)));
  root.append(gap());
  root.append(cardEl('Die Formel – aus Bausteinen',
    'Haken = Baustein zählt · Zahl = Gewicht · ✎ öffnet Form, Gruppe und Wirkung · ✕ entfernt · Änderungen wirken sofort', formulaHost));
  root.append(gap());
  root.append(cardEl('Was passiert? Diagnose', 'Das Minimum deiner QUBO gegen das echte Problem – und was jeder Baustein bewirkt', diagHost, looHost));
  root.append(gap());
  root.append(cardEl('Schachbrett', 'Eigene Zustände bauen – auch unzulässige · kleine Zahl = Kosten-Beitrag des Schalters', quickHost, boardHost));
  root.append(gap());
  root.append(el('div', { class: 'grid grid-2' },
    cardEl('Energie je Baustein', 'Was jeder Baustein zum Zustand im Schachbrett beiträgt', energyHost),
    cardEl('Ablaufplan des Zustands im Schachbrett', 'So würden die Roboter fahren – bei unzulässigen Zuständen nach Platznummer gelesen', ganttNote, ganttHost)));
  root.append(gap());
  root.append(el('div', { class: 'grid grid-2' },
    cardEl('QUBO-Matrix', 'Farbe = Baustein · Hover erklärt jeden Beitrag · umrandet = zählt gerade', matrixHost),
    cardEl('Kopplungsgraph & Hardware-Bedarf', 'Welcher Baustein kostet wie viele Kopplungen?', graphHost, hardwareHost)));

  let matrixView = null;
  let graphView = null;

  // ---------------------------------------------------------------- Hilfen
  const d = () => st.data;
  const K = () => st.data.instance.slots;
  const ctx = () => ({ K: K(), objective: st.data.instance.objective, critLabel: st.data.instance.criterion.label });
  const unit = () => st.data.instance.criterion.unit || 's';
  const termById = (id) => st.terms.find((t) => t.id === id);
  const resolved = (id) => st.data.formulation.terms.find((t) => t.id === id);
  const activeTerms = () => st.terms.filter((t) => st.active[t.id]);
  const reqLabel = (k) => st.data.requirements.find((r) => r.key === k)?.label || k;

  /** Wert eines Bausteins ohne Gewicht – direkt aus seinen Regeln (wie energy_rules in Python). */
  function rawTermValue(id, x) {
    let e = 0;
    for (const r of st.data.formulation.rules) {
      if (r.term !== id) continue;
      if (r.kind === 'kosten') e += r.c * x[r.vars[0]];
      else if (r.kind === 'vorgaenger') e += r.c * x[r.vars[0]] * x[r.vars[1]];
      else if (r.kind === 'gruppe') {
        const n = r.vars.reduce((s, i) => s + x[i], 0);
        e += r.f.a + r.f.b * n + r.f.c * n * n;
      } else {
        const o1 = r.upper.reduce((s, i) => s + x[i], 0);
        const o2 = r.lower.reduce((s, i) => s + x[i], 0);
        e += r.g.a + r.g.b * o1 + r.g.c * o2 + r.g.d * o1 * o2;
      }
    }
    return e;
  }
  const objectiveEnergy = (x) => activeTerms().filter((t) => COST_TYPES.has(t.type)).reduce((s, t) => s + st.weights[t.id] * rawTermValue(t.id, x), 0);
  /**
   * Kleinster Wert einer Regel über Belegungen, die in gültigen Plänen vorkommen: je Gruppe das Minimum
   * von f über die dort möglichen Anzahlen. Zahlt der beste Plan mehr, verlangt die Regel mehr als das Problem.
   */
  function minValidValue(id) {
    const term = termById(id);
    const T = st.data.instance.tasks.length;
    const validCounts = (size) => ({
      auftrag: size ? [1] : [0],
      platz: [0, 1],
      roboter: Array.from({ length: Math.min(K(), size) + 1 }, (_, n) => n),
      auftrag_roboter: [0, 1],
      alle: [T],
    }[term.gruppe || 'auftrag']);
    let e = 0;
    for (const r of st.data.formulation.rules) {
      if (r.term !== id) continue;
      if (r.kind === 'gruppe') {
        e += Math.min(...validCounts(r.vars.length).map((n) => r.f.a + r.f.b * n + r.f.c * n * n));
      } else if (r.kind === 'nachbar') {
        e += Math.min(...[[0, 0], [0, 1], [1, 1]].map(([o1, o2]) => r.g.a + r.g.b * o1 + r.g.c * o2 + r.g.d * o1 * o2));
      }
    }
    return e;
  }

  // ---------------------------------------------------------------- Szenario
  function drawScenario(error) {
    const data = st.data;
    const slotSel = el('select', { 'aria-label': 'Plätze je Roboter' }, [1, 2, 3].map((k) => el('option', { value: k },
      k === 1 ? '1 – Sofortzuweisung' : `${k} – mit Reihenfolge`)));
    slotSel.value = String(st.slots);
    slotSel.addEventListener('change', () => {
      st.slots = Number(slotSel.value);
      if (st.slots > 1 && !['erledigungszeit', 'bearbeitungszeit'].includes(st.criterion)) st.criterion = 'erledigungszeit';
      if (!st.dirty) resetToPreset(null);
      load();
    });
    const crits = data ? data.catalog.criteria : [];
    const critSel = el('select', { 'aria-label': 'Kriterium' },
      el('optgroup', { label: 'mit Reihenfolge (jedes K)' }, crits.filter((c) => c.position_weight !== undefined)
        .map((c) => el('option', { value: c.key }, `${c.label} · ${c.en}`))),
      crits.some((c) => c.position_weight === undefined)
        ? el('optgroup', { label: 'nur Sofortzuweisung (K = 1)' }, crits.filter((c) => c.position_weight === undefined)
          .map((c) => el('option', { value: c.key }, `${c.label} · ${c.en}`)))
        : null);
    if (!crits.length) critSel.append(el('option', { value: st.criterion }, st.criterion));
    critSel.value = st.criterion;
    critSel.addEventListener('change', () => {
      st.criterion = critSel.value;
      if (!st.dirty) resetToPreset(null); // sonst bleibt deine Formel – und die Diagnose zeigt, ob sie noch passt
      load();
    });
    const extra = el('div', {},
      el('div', { class: 'filter-group', style: { marginTop: '10px' } }, el('span', { class: 'filter-label' }, 'Plätze je Roboter K'), slotSel),
      el('div', { class: 'filter-group', style: { marginTop: '6px' } }, el('span', { class: 'filter-label' }, 'Kriterium'), critSel),
      el('p', { class: 'hint' }, st.dirty
        ? 'Deine Formel bleibt beim Wechsel von K oder Kriterium stehen – die Diagnose zeigt, ob sie noch passt. Eine Voreinstellung setzt sie zurück.'
        : 'Solange du nichts veränderst, passt sich die Formel an K und Kriterium an.'));
    const snap = data ? data.instance.snapshot : null;
    renderScenario(scenarioBody, {
      tasks, st, load, error, extra,
      note: snap ? `Vereinfachung fürs Lernen: Alle gewählten Aufträge sehen die Flotte im Snapshot von Anfrage #${snap.transport_id} (t = ${nf(snap.time)} s).` : null,
    });
  }

  function resetToPreset(name) {
    st.terms = null;
    st.preset = name;
    st.weights = {};
    st.active = {};
    st.open.clear();
    st.dirty = false;
  }

  // ---------------------------------------------------------------- Laden
  async function load() {
    drawScenario();
    const body = { tasks: st.selected, variables: st.mode, kriterium: st.criterion, plaetze: st.slots, params: st.costParams,
      terms: st.terms ? st.terms.map(specOf) : null, preset: st.terms ? null : st.preset };
    let data;
    try {
      data = await api(`/api/runs/${encodeURIComponent(run.run_id)}/baukasten`, { body });
    } catch (err) {
      drawScenario(`Konnte die Formulierung nicht bauen: ${err.message}`);
      return;
    }
    const scenarioKey = [st.selected, st.mode, st.criterion, st.slots, JSON.stringify(st.costParams)].join('|');
    const scenarioChanged = scenarioKey !== st.scenarioKey;
    st.data = data;
    st.terms = data.terms.map(specOf);
    // Gewichte und Schalter je Baustein: neue Bausteine bekommen den Standardwert ihres Symbols.
    // Bei einem neuen Szenario werden die Gewichte an dessen Kostenbereich angepasst (außer beim ersten Laden per Link).
    const fresh = scenarioChanged && !(linked && !st.scenarioKey);
    const ids = new Set(st.terms.map((t) => t.id));
    for (const k of Object.keys(st.weights)) if (!ids.has(k) || fresh) delete st.weights[k];
    for (const k of Object.keys(st.active)) if (!ids.has(k)) delete st.active[k];
    for (const t of st.terms) {
      if (!(t.id in st.weights)) st.weights[t.id] = data.weights[t.symbol] ?? data.weights.A;
      if (!(t.id in st.active)) st.active[t.id] = true;
    }
    st.sched = createSchedule(data.instance);
    if (scenarioChanged || st.x.length !== data.formulation.n) {
      st.scenarioKey = scenarioKey;
      st.x = data.exact?.bits ? st.sched.bitsToX(data.exact.bits) : new Uint8Array(data.formulation.n);
    }
    createViews();
    st.resultKey = '';
    drawScenario();
    update();
  }
  let rebuildTimer = null;
  function rebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(load, 150);
  }

  function createViews() {
    const sched = st.sched;
    const sym = (p) => termById(p.term)?.symbol || p.term;
    matrixView = createMatrixView(matrixHost, {
      labels: sched.vars.map((v, i) => sched.varLabel(i)), varName: sched.varLabel, onCellClick: flashVars,
      describePart: (p) => `${sym(p)} · ${partText(p)}: ${fmt(p.v)} × ${nf(st.weights[p.term], 2)} = ${fmt(p.v * st.weights[p.term])}`,
      colorOf: (p) => termColor(termById(p.term)), tintOf: (p) => termTint(termById(p.term)),
    });
    const cols = sched.slotColumns();
    graphView = createGraphView(graphHost, {
      variables: sched.vars.map((v) => ({ ...v, row: v.task_id, col: `${v.robot_id}|${v.slot}` })),
      rowKeys: st.data.instance.tasks.map((t) => t.transport_id), colKeys: cols.map((c) => `${c.robot}|${c.slot}`),
      rowLabel: (t) => `#${t}`, colLabel: (k) => { const [r, q] = k.split('|'); return K() === 1 ? `R${r}` : `R${r}·${q}`; },
      varName: sched.varLabel, colorOf: (p) => termColor(termById(p.term)),
    });
  }
  function partText(p) {
    if (p.kind === 'kosten') return `Kosten #${p.task_id} auf R${p.robot_id}${K() > 1 ? `, Platz ${p.slot}` : ''}`;
    if (p.kind === 'vorgaenger') return `#${p.from} direkt vor #${p.to} auf R${p.robot_id}`;
    return `${TYPE_LABEL[p.kind]} ${p.group}`;
  }

  /** URL spiegelt die Formel – ein Link reproduziert genau diesen Stand. */
  function writeUrl() {
    const q = new URLSearchParams({ auftraege: st.selected.join(','), plaetze: String(st.slots), kriterium: st.criterion });
    if (st.mode === 'alle') q.set('modus', 'alle');
    if (st.dirty) q.set('formel', JSON.stringify({ terms: st.terms, weights: st.weights, active: st.active }));
    history.replaceState(null, '', `#/kodierungen/baukasten?${q}`);
  }

  // ---------------------------------------------------------------- Bausteine verändern
  function editTerm(id, patch) {
    st.terms = st.terms.map((t) => (t.id === id ? { ...t, ...patch } : t));
    st.dirty = true;
    rebuild();
  }
  function addTerm(term) {
    st.terms = [...st.terms, term];
    st.open.add(term.id);
    st.dirty = true;
    rebuild();
  }
  function removeTerm(id) {
    if (st.terms.length <= 1) return;
    st.terms = st.terms.filter((t) => t.id !== id);
    st.open.delete(id);
    st.dirty = true;
    rebuild();
  }
  function setActive(id, on) {
    st.active[id] = on;
    st.dirty = true;
    update();
  }
  /** Gewicht setzen; andere Regler desselben Bausteins mitziehen, ohne das Feld unter dem Cursor neu zu zeichnen. */
  function setWeight(id, value, source, full = false) {
    st.weights[id] = value;
    st.dirty = true;
    formulaHost.querySelectorAll(`[data-weight="${id}"]`).forEach((n) => { if (n !== source) n.value = value; });
    if (full) update();
    else scheduleUpdate();
  }
  let pending = null;
  function scheduleUpdate() {
    clearTimeout(pending);
    pending = setTimeout(() => update({ keepFormula: true }), 90);
  }

  // ---------------------------------------------------------------- Rechnen
  function solve(model, topK) {
    if (model.n <= MAX_SEARCH_BITS) {
      const r = search(model, topK);
      return { exhaustive: true, min: { E: r.min.E, x: fromMask(r.min.mask, model.n) }, top: r.top.map((t) => ({ E: t.E, x: fromMask(t.mask, model.n) })),
        all: r.all, total: r.total };
    }
    // Heuristik mit Tausch-Zügen je Auftrag (Vorschläge, kein Teil der Formel)
    const groups = st.data.instance.tasks.map((t) => st.sched.vars.map((v, i) => (v.task_id === t.transport_id ? i : -1)).filter((i) => i >= 0));
    const penalties = st.terms.filter((t) => !COST_TYPES.has(t.type) && model.active[t.id]).map((t) => st.weights[t.id]);
    const r = anneal(model, { restarts: 60, sweeps: 600, seed: 7, groups, T0: Math.max(1, ...penalties), T1: 0.5 });
    return { exhaustive: false, min: r.min, top: r.top, all: null, total: 2 ** model.n };
  }
  function compute() {
    st.model = makeTermModel(st.data.formulation, { weights: st.weights, active: st.active });
    const key = JSON.stringify([st.weights, st.active, st.terms, st.scenarioKey]);
    if (key !== st.resultKey) {
      st.resultKey = key;
      st.result = solve(st.model, 10);
    }
  }

  // ---------------------------------------------------------------- Zeichnen
  function update({ keepFormula = false } = {}) {
    if (!st.data) return;
    compute();
    if (!keepFormula) renderFormula();
    renderProblem();
    renderDiagnosis();
    renderLoo();
    renderBoard();
    renderEnergy();
    renderGanttCard();
    matrixView.update(st.model, st.x);
    graphView.update(st.model, st.x);
    renderHardware();
    writeUrl();
  }

  // ---------------------------------------------------------------- Das echte Problem
  function renderProblem() {
    const data = st.data;
    const minTruth = st.sched.trueObjective(st.result.min.x);
    const curTruth = st.sched.trueObjective(st.x);
    const status = (truth, key) => {
      const issues = truth.dec.issues.filter((i) => i.kind === key);
      return issues.length
        ? el('td', { class: 'no-ok' }, `✗ ${issues.slice(0, 2).map((i) => i.text).join(' · ')}${issues.length > 2 ? ` · … (${issues.length})` : ''}`)
        : el('td', { class: 'ok' }, '✓');
    };
    const goal = (truth) => {
      if (!truth.valid) return el('td', { class: 'hint' }, '– (unzulässig)');
      if (!data.exact) return el('td', {}, `${fmt(truth.value)} ${unit()}`);
      const best = Math.abs(truth.value - data.exact.value) < 1e-6;
      return el('td', { class: best ? 'ok' : 'no-ok' }, `${fmt(truth.value)} ${unit()} ${best ? '✓ bestmöglich' : `✗ (bestmöglich ${fmt(data.exact.value)})`}`);
    };
    fill(problemHost,
      el('table', { class: 'data req-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Anforderung'), el('th', {}, 'Minimum deiner QUBO'), el('th', {}, 'Zustand im Schachbrett'))),
        el('tbody', {}, data.requirements.map((r) => el('tr', {},
          el('td', {}, r.label),
          ...(r.key === 'ziel' ? [goal(minTruth), goal(curTruth)] : [status(minTruth, r.key), status(curTruth, r.key)]))))),
      el('p', { class: 'hint' }, data.exact
        ? `Bester gültiger Plan (alle ${nf(data.exact.count)} Pläne aufgezählt): ${st.sched.describeSeq(st.sched.seqMap(data.exact.sequences))} = ${fmt(data.exact.value)} ${unit()}.`
        : 'Es gibt keinen gültigen Plan: mehr Aufträge als Plätze. Mehr Plätze K oder weniger Aufträge wählen.'),
      data.exact && data.exact_free && Math.abs(data.exact_free.value - data.exact.value) > 1e-6
        ? el('p', { class: 'hint' }, `Ohne Platzgrenze wäre ${fmt(data.exact_free.value)} ${unit()} möglich – K = ${K()} schneidet das Optimum ab.`) : null);
  }

  // ---------------------------------------------------------------- Formel
  function renderFormula() {
    const data = st.data;
    const c = ctx();
    const presets = el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Voreinstellung'),
      Object.entries(PRESET_LABEL).map(([name, label]) => el('button', { class: 'btn small', type: 'button',
        title: 'Setzt Bausteine und Gewichte zurück', onclick: () => { resetToPreset(name); st.dirty = name !== data.default_preset; load(); } }, label)));
    const sliderMax = niceCeil(3 * Math.max(...Object.values(data.weights), ...Object.values(st.weights)));
    const checks = objectiveChecks();
    const lines = st.terms.map((t, k) => {
      const r = resolved(t.id);
      const v = verdictOf(r, c.K);
      const on = Boolean(st.active[t.id]);
      const box = el('input', { type: 'checkbox', checked: on, 'aria-label': `${t.symbol} an/aus` });
      box.addEventListener('change', () => setActive(t.id, box.checked));
      const isCost = COST_TYPES.has(t.type);
      const w = el('input', { type: 'number', value: st.weights[t.id], step: isCost ? 0.1 : 10, min: 0, class: 'bk-w', 'data-weight': t.id,
        'aria-label': `Gewicht ${t.symbol}` });
      w.addEventListener('input', () => { if (w.value !== '' && Number.isFinite(Number(w.value))) setWeight(t.id, Number(w.value), w); });
      const mine = checks.filter((ch) => ch.term === t.id);
      const fine = v.ok && !v.strict && !mine.length;
      const badge = withTip(el('span', { class: `bk-badge ${fine ? 'ok' : 'warn'}` }, fine ? '✓' : '⚠'),
        tipHtml(fine ? 'Passt zum Problem' : 'Passt nicht ganz zum Problem', [...v.msgs, ...mine.map((ch) => ch.html)]));
      const editBtn = el('button', { class: `btn small${st.open.has(t.id) ? ' primary' : ''}`, type: 'button', title: 'Form, Gruppe und Wirkung', onclick: () => {
        if (st.open.has(t.id)) st.open.delete(t.id); else st.open.add(t.id);
        renderFormula();
      } }, '✎');
      const delBtn = el('button', { class: 'btn small', type: 'button', title: 'Baustein entfernen', disabled: st.terms.length <= 1, onclick: () => removeTerm(t.id) }, '✕');
      const line = el('div', { class: `bk-line${on ? '' : ' off'}`, style: { borderLeftColor: termColor(t) } },
        el('span', { class: 'bk-lhs', html: k === 0 ? '<i>E</i>(<i>x</i>) =' : '+' }), box,
        el('span', { class: 'bk-sym' }, el('b', { style: { color: termColor(t) } }, t.symbol), w, '·'),
        el('span', { class: 'bk-term', html: termFormula(t, c) }),
        el('span', { class: 'bk-note' }, badge, ' ', termSentence(t, c)),
        el('span', { class: 'bk-actions' }, editBtn, delBtn));
      let editor = null;
      if (st.open.has(t.id)) {
        editor = el('div', { class: 'bk-editor', style: { borderLeftColor: termColor(t) } });
        renderTermEditor(editor, { term: t, resolved: r, ctx: c, weight: st.weights[t.id], weightMax: isCost ? 3 : sliderMax,
          onChange: (patch) => editTerm(t.id, patch), onWeight: (val) => setWeight(t.id, val, null) });
        editor.querySelector('input[type="range"]')?.setAttribute('data-weight', t.id);
      }
      return [line, editor];
    });
    const add = el('select', { 'aria-label': 'Baustein hinzufügen' }, el('option', { value: '' }, '+ Baustein hinzufügen …'),
      Object.entries(TYPE_LABEL).map(([type, label]) => el('option', { value: type }, label)));
    add.addEventListener('change', () => { if (add.value) addTerm(newTerm(add.value, st.terms, data.instance.criterion)); });
    const offs = st.model.entries.filter((e) => e.i !== e.j && e.value !== 0).length;
    fill(formulaHost, presets,
      el('div', { class: 'bk-lines' }, lines),
      el('div', { class: 'filter-group', style: { marginTop: '10px' } }, add,
        el('span', { class: 'hint' }, `→ ${data.formulation.n} Qubits, ${offs} Kopplungen, Konstante ${fmt(st.model.constant)}`)));
  }

  // ---------------------------------------------------------------- Diagnose
  function objectiveChecks() {
    const data = st.data;
    const crit = data.instance.criterion;
    const out = [];
    const act = activeTerms();
    const costs = act.filter((t) => t.type === 'kosten');
    const vorg = act.filter((t) => t.type === 'vorgaenger');
    const ablauf = data.instance.objective === 'ablauf';
    const want = crit.position_weight ? 'q' : 'eins';
    if (!costs.length) out.push({ level: 'bad', html: '<b>Kein Kosten-Baustein aktiv:</b> Die QUBO kennt das Ziel nicht – jeder gültige Plan ist für sie gleich gut.',
      action: { label: '+ Kosten-Baustein', run: () => addTerm(standardTerm('ziel', st.terms, crit)) } });
    if (costs.length > 1) out.push({ level: 'warn', term: costs[1].id, html: '<b>Mehrere Kosten-Bausteine:</b> Die Kosten zählen mehrfach – das verschiebt das Verhältnis zu den Strafgewichten.' });
    if (ablauf) {
      for (const c of costs) {
        if (K() > 1 && (c.gewichtung || 'q') !== want) {
          out.push({ level: 'warn', term: c.id, html: `<b>${c.symbol}: Gewicht je Platz passt nicht zum Kriterium.</b> Für „${crit.label}“ wäre ${want === 'q' ? '<i>q</i> (von hinten)' : '1'} richtig – ${c.gewichtung === 'vorne' ? 'von vorne gezählt stimmt das Gewicht nur, wenn jeder Roboter genau K Aufträge hat' : 'so bewertet die QUBO etwas anderes'}.` });
        }
        const busyRelease = data.instance.robots.some((r) => r.release > 0 && st.sched.vars.some((v) => v.robot_id === r.robot_id));
        if (busyRelease && (c.wartezeit !== false) !== Boolean(crit.release)) {
          out.push({ level: 'warn', term: c.id, html: `<b>${c.symbol}: Wartezeit ρ</b> ${crit.release ? 'fehlt – belegte Roboter wirken zu billig' : 'gehört nicht zu diesem Kriterium'}.` });
        }
        if (c.anfahrt === false) out.push({ level: 'warn', term: c.id, html: `<b>${c.symbol}: Anfahrt vom Standort fehlt</b> – der erste Auftrag jedes Roboters wird zu billig bewertet.` });
      }
      if (K() > 1) {
        if (!vorg.length && costs.length) {
          out.push({ level: 'warn', html: '<b>Keine Vorgänger-Kopplung:</b> Jeder Auftrag wird bewertet, als führe sein Roboter vom Standort los – ab dem zweiten Auftrag stimmt die Anfahrt nicht.',
            action: { label: '+ Vorgänger-Kopplung', run: () => addTerm(newTerm('vorgaenger', st.terms, crit)) } });
        }
        for (const v of vorg) {
          if (v.variante === 'ohne_abzug') out.push({ level: 'warn', term: v.id, html: `<b>${v.symbol}: ohne Abzug</b> – die Anfahrt vom Standort steckt schon in den Kosten und zählt so doppelt.` });
          const cost = costs[0];
          if (cost && (v.gewichtung || 'q') !== (cost.gewichtung || 'q')) out.push({ level: 'warn', term: v.id, html: `<b>${v.symbol}: anderes Gewicht je Platz als die Kosten</b> – Korrektur und Kosten passen nicht zusammen.` });
          if (cost && Math.abs(st.weights[v.id] - st.weights[cost.id]) > 1e-9) out.push({ level: 'warn', term: v.id, html: `<b>${v.symbol} ≠ ${cost.symbol}:</b> Vorgänger-Kopplung und Kosten sind verschieden gewichtet – die Anfahrt zählt anders als der Rest.` });
        }
      }
    }
    return out;
  }

  function diagnose() {
    const data = st.data;
    const res = st.result;
    const x = res.min.x;
    const truth = st.sched.trueObjective(x);
    const xOpt = data.exact?.bits ? st.sched.bitsToX(data.exact.bits) : null;
    const items = [];
    const act = activeTerms();
    const c = ctx();
    if (!data.exact) items.push({ level: 'warn', html: '<b>Es gibt keinen gültigen Plan:</b> mehr Aufträge als Plätze. Irgendeine Regel muss brechen – mehr Plätze K oder weniger Aufträge.' });
    // Regeln, die den besten gültigen Plan selbst bestrafen, verlangen mehr als das Problem
    const conflicts = xOpt ? act.filter((t) => !COST_TYPES.has(t.type)).map((t) => ({ t, over: rawTermValue(t.id, xOpt) - minValidValue(t.id) }))
      .filter((cf) => cf.over > 1e-9) : [];
    for (const { t, over } of conflicts) {
      items.push({ level: 'bad', html: `<b>${t.symbol} bestraft den besten gültigen Plan</b> (um ${fmt(over)} × ${nf(st.weights[t.id], 2)} = ${fmt(over * st.weights[t.id])}):
        „${termSentence(t, c)}“ verlangt mehr als das Problem – oder belohnt etwas, das gültige Pläne nicht tun. Solange das so ist, hilft kein Gewicht.` });
    }
    for (const kind of ['auftrag', 'platz', 'luecke']) {
      const issues = truth.dec.issues.filter((i) => i.kind === kind);
      if (!issues.length) continue;
      const example = `${issues.slice(0, 3).map((i) => i.text).join(' · ')}${issues.length > 3 ? ` · … (${issues.length})` : ''}`;
      const cover = act.filter((t) => resolved(t.id)?.covers === kind);
      if (!cover.length) {
        items.push({ level: 'bad', html: `<b>Es fehlt eine Regel für „${reqLabel(kind)}“.</b> Im Minimum: ${example}. ${WHY_FREE[kind]}`,
          action: { label: '+ Standardregel dafür', run: () => addTerm(standardTerm(kind, st.terms, data.instance.criterion)) } });
        continue;
      }
      for (const t of cover) {
        const v = verdictOf(resolved(t.id), c.K);
        if (!v.ok) {
          items.push({ level: 'bad', html: `<b>${t.symbol}: Die Form lässt es zu.</b> „${termSentence(t, c)}“ soll „${reqLabel(kind)}“ sichern, aber: ${v.msgs.filter((m) => !m.includes('✓')).join('; ')}. Im Minimum: ${example}.` });
          continue;
        }
        if (!xOpt || conflicts.length) continue; // bei Konflikten wäre ein Gewichtsvorschlag irreführend
        const delta = energy(st.model, xOpt) - res.min.E;
        const perUnit = rawTermValue(t.id, x) - rawTermValue(t.id, xOpt);
        if (perUnit > 1e-9 && delta > 0) {
          const s = suggestWeight(st.weights[t.id], delta, perUnit);
          items.push({ level: 'bad', html: `<b>${t.symbol} = ${nf(st.weights[t.id], 2)} ist zu klein.</b> Im Minimum: ${example}. Der beste gültige Plan hätte in deiner QUBO
            ${fmt(delta)} mehr Energie – der Regelbruch ist billiger als das Einhalten. Ab ${t.symbol} ≈ ${nf(st.weights[t.id] + delta / perUnit, 1)} kippt das.`,
          action: { label: `${t.symbol} = ${nf(s)} setzen`, run: () => setWeight(t.id, s, null, true) } });
        } else {
          items.push({ level: 'bad', html: `<b>${t.symbol} ist an, verhindert den Verstoß hier aber nicht</b> (${example}) – andere Bausteine belohnen ihn stärker.` });
        }
      }
    }
    if (truth.valid && xOpt) {
      if (Math.abs(truth.value - data.exact.value) < 1e-6) {
        items.push({ level: 'ok', html: `<b>Das Minimum deiner QUBO ist der beste Plan</b> (${fmt(data.exact.value)} ${unit()}).` });
      } else {
        items.push({ level: 'bad', html: `<b>Gültig, aber nicht der beste Plan:</b> ${fmt(truth.value)} statt ${fmt(data.exact.value)} ${unit()}.` });
        const a = objectiveEnergy(x);
        const b = objectiveEnergy(xOpt);
        if (Math.abs(a - truth.value) > 1e-6 || Math.abs(b - data.exact.value) > 1e-6) {
          items.push({ level: 'bad', html: `<b>Die Ziel-Bausteine bewerten Pläne falsch.</b> Gefundener Plan: in der QUBO ${fmt(a)}, wirklich ${fmt(truth.value)}.
            Bester Plan: in der QUBO ${fmt(b)}, wirklich ${fmt(data.exact.value)}${a < b ? ' – deine QUBO hält den schlechteren Plan für billiger.' : '.'}` });
        } else if (energy(st.model, xOpt) < res.min.E - 1e-6) {
          items.push({ level: 'warn', html: '<b>Die Heuristik hat das Minimum verfehlt</b> – der beste Plan hätte weniger Energie. Bei vielen Qubits kann das passieren.' });
        } else {
          items.push({ level: 'bad', html: `<b>Die Regeln verzerren das Ziel:</b> Sie kosten auch bei gültigen Plänen etwas – gefunden ${fmt(energy(st.model, x) - a)},
            bester Plan ${fmt(energy(st.model, xOpt) - b)}.` });
        }
      }
    }
    const checks = objectiveChecks();
    if (checks.length && items.some((i) => i.level === 'ok')) {
      checks.forEach((i) => { if (i.level === 'warn') i.html += ' <span class="hint">Hier trifft das Minimum trotzdem – in anderen Szenarien nicht unbedingt.</span>'; });
    }
    items.push(...checks);
    for (const t of act) {
      const r = resolved(t.id);
      if (r?.note) items.push({ level: 'info', html: `<b>${t.symbol}:</b> ${r.note}.` });
    }
    return items;
  }

  function renderDiagnosis() {
    const data = st.data;
    const res = st.result;
    const truth = st.sched.trueObjective(res.min.x);
    const items = diagnose();
    const verdict = !truth.valid ? { cls: 'bad', text: '✗ unzulässig' }
      : !data.exact || Math.abs(truth.value - data.exact.value) < 1e-6 ? { cls: 'ok', text: '✓ bester Plan' }
        : { cls: 'warn', text: '✗ gültig, aber nicht optimal' };
    fill(diagHost,
      el('div', { class: 'opt-grid' },
        el('div', { class: 'opt-box' }, el('div', { class: 'hint' }, res.exhaustive ? `Minimum deiner QUBO (alle ${nf(res.total)} Zustände durchprobiert)` : 'Minimum deiner QUBO (Simulated Annealing – Heuristik)'),
          el('div', { class: 'big' }, `E = ${fmt(res.min.E)}`), el('div', {}, st.sched.describeSeq(truth.dec.sequences)),
          el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = Uint8Array.from(res.min.x); update({ keepFormula: true }); } }, 'ins Schachbrett laden')),
        el('div', { class: 'opt-box' }, el('div', { class: 'hint' }, 'Am echten Problem gemessen'),
          el('div', { class: `big ${verdict.cls}` }, verdict.text),
          el('div', {}, truth.valid ? `${data.instance.criterion.label}: ${fmt(truth.value)} ${unit()}${data.exact ? ` (bestmöglich ${fmt(data.exact.value)})` : ''}`
            : truth.dec.issues.slice(0, 3).map((i) => i.text).join(' · ')))),
      el('h4', {}, 'Was fehlt? Was wirkt?'),
      el('ul', { class: 'diag-list' }, items.map((i) => el('li', { class: `diag ${i.level}` },
        el('span', { class: 'icon' }, LEVEL_ICON[i.level]),
        el('div', {}, el('div', { html: i.html }),
          i.action ? el('button', { class: 'btn small', type: 'button', onclick: i.action.run }, i.action.label) : null)))));
  }

  // ---------------------------------------------------------------- Jeden Baustein weglassen
  function computeLoo() {
    const data = st.data;
    return activeTerms().map((t) => {
      const m = makeTermModel(data.formulation, { weights: st.weights, active: { ...st.active, [t.id]: false } });
      const r = solve(m, 1);
      const truth = st.sched.trueObjective(r.min.x);
      const unique = st.model.entries.filter((e) => e.i !== e.j && e.value !== 0 && e.activeParts.every((p) => p.term === t.id)).length;
      const optimal = truth.valid && data.exact && Math.abs(truth.value - data.exact.value) < 1e-6;
      return { t, truth, optimal, unique, heuristic: !r.exhaustive };
    });
  }
  function renderLoo() {
    const n = st.data.formulation.n;
    const key = st.resultKey;
    if (st.looKey !== key) {
      st.loo = n <= LOO_AUTO_BITS ? computeLoo() : null;
      st.looKey = n <= LOO_AUTO_BITS ? key : '';
    }
    const head = el('h4', {}, 'Was bewirkt jeder Baustein? – jeden einzeln weglassen');
    if (!st.loo) {
      fill(looHost, head, el('p', { class: 'hint' }, `Bei ${n} Qubits wird das auf Knopfdruck berechnet (je Baustein eine Suche).`),
        el('button', { class: 'btn small', type: 'button', onclick: () => { st.loo = computeLoo(); st.looKey = key; renderLoo(); } }, 'Jetzt berechnen'));
      return;
    }
    const data = st.data;
    // Fazit im Vergleich zum jetzigen Minimum (mit allen Bausteinen)
    const now = st.sched.trueObjective(st.result.min.x);
    const issuesText = (truth) => truth.dec.issues.map((i) => i.text).join(' · ');
    const issueShort = (truth) => `${truth.dec.issues[0].text}${truth.dec.issues.length > 1 ? ` (+${truth.dec.issues.length - 1})` : ''}`;
    const verdict = (row) => {
      const r = row.truth;
      const same = r.valid === now.valid && Math.abs(r.value - now.value) < 1e-6 && issuesText(r) === issuesText(now);
      if (same) return { cls: 'hint', text: row.unique ? `hier ohne Wirkung – weglassen spart ${row.unique} Kopplungen` : 'hier ohne Wirkung' };
      if (now.valid && !r.valid) return { cls: 'no-ok', text: `nötig – ohne ihn: ${issueShort(r)}` };
      if (!now.valid && r.valid) return { cls: 'ok', text: `ohne ihn wird es zulässig${row.optimal ? ' und optimal' : ''} – dieser Baustein schadet hier` };
      if (now.valid && r.valid) {
        return r.value > now.value + 1e-6
          ? { cls: 'no-ok', text: `nötig fürs Ziel – ohne ihn ${fmt(r.value)} statt ${fmt(now.value)} ${unit()}` }
          : { cls: 'ok', text: `ohne ihn sogar besser: ${fmt(r.value)} statt ${fmt(now.value)} ${unit()}` };
      }
      return { cls: 'no-ok', text: `ändert die Verstöße – ohne ihn: ${issueShort(r)}` };
    };
    fill(looHost, head,
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'ohne Baustein'), el('th', {}, 'Minimum dann'), el('th', { class: 'num' }, 'Kopplungen nur von ihm'), el('th', {}, 'Fazit'))),
        el('tbody', {}, st.loo.map((row) => {
          const v = verdict(row);
          return el('tr', {},
            el('td', { style: { whiteSpace: 'normal', maxWidth: '420px' } }, el('b', { style: { color: termColor(row.t) } }, row.t.symbol), ` ${termSentence(row.t, ctx())}`),
            el('td', { style: { whiteSpace: 'normal', maxWidth: '460px' } }, row.truth.valid ? st.sched.describeSeq(row.truth.dec.sequences)
              : `unzulässig: ${row.truth.dec.issues.slice(0, 2).map((i) => i.text).join(' · ')}${row.truth.dec.issues.length > 2 ? ' …' : ''}`),
            el('td', { class: 'num' }, nf(row.unique)),
            el('td', { class: v.cls, style: { whiteSpace: 'normal' } }, v.text));
        })))),
      el('p', { class: 'hint' }, '„Hier entbehrlich“ gilt nur für dieses Szenario und diese Gewichte – eine Regel kann in anderen Momenten nötig sein. Gespart werden die Kopplungen, die nur dieser Baustein erzeugt.'));
  }

  // ---------------------------------------------------------------- Schachbrett & Energie
  function diagPartsOf(i) {
    return st.model.entries.find((e) => e.i === i && e.j === i)?.activeParts || [];
  }
  function renderBoard() {
    renderSlotBoard(boardHost, {
      sched: st.sched, x: st.x,
      onToggle: (i) => { st.x[i] = st.x[i] ? 0 : 1; update({ keepFormula: true }); },
      cellValue: (i) => diagPartsOf(i).filter((p) => COST_TYPES.has(p.kind)).reduce((s, p) => s + p.v * st.weights[p.term], 0),
      cellTip: (i) => {
        const parts = diagPartsOf(i);
        const total = parts.reduce((s, p) => s + p.v * st.weights[p.term], 0);
        return tipHtml(`${st.sched.varLabel(i)} – Diagonale Q = ${fmt(total)}`,
          parts.length ? parts.map((p) => `<span style="color:${termColor(termById(p.term))}">■</span> ${termById(p.term)?.symbol}: ${fmt(p.v)} × ${nf(st.weights[p.term], 2)} = ${fmt(p.v * st.weights[p.term])}`)
            : ['kein aktiver Baustein auf der Diagonale']);
      },
    });
    const exact = st.data.exact;
    fill(quickHost,
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = new Uint8Array(st.sched.vars.length); update({ keepFormula: true }); } }, 'Alle aus'),
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = st.sched.nearest(); update({ keepFormula: true }); } }, 'Jeder nimmt den nächsten'),
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = Uint8Array.from(st.result.min.x); update({ keepFormula: true }); } }, 'Minimum deiner QUBO'),
      el('button', { class: 'btn small primary', type: 'button', disabled: !exact?.bits, onclick: () => { st.x = st.sched.bitsToX(exact.bits); update({ keepFormula: true }); } }, 'Bester gültiger Plan'));
  }

  function renderEnergy() {
    const x = st.x;
    const rows = [];
    let total = 0;
    for (const t of st.terms) {
      const on = st.active[t.id];
      const w = st.weights[t.id];
      const items = [];
      let raw = 0;
      for (const r of st.data.formulation.rules) {
        if (r.term !== t.id) continue;
        if (r.kind === 'kosten') {
          if (x[r.vars[0]]) { raw += r.c; items.push(`#${r.task_id} auf R${r.robot_id}${K() > 1 ? `, Platz ${r.slot}` : ''}: ${fmt(r.c)}`); }
        } else if (r.kind === 'vorgaenger') {
          if (x[r.vars[0]] && x[r.vars[1]]) { raw += r.c; items.push(`#${r.from} direkt vor #${r.to} (R${r.robot_id}): ${fmt(r.c)}`); }
        } else if (r.kind === 'gruppe') {
          const n = r.vars.reduce((s, i) => s + x[i], 0);
          const v = r.f.a + r.f.b * n + r.f.c * n * n;
          raw += v;
          if (Math.abs(v) > 1e-9) items.push(`${r.label}: n = ${n} → f = ${fmt(v)}`);
        } else {
          const o1 = r.upper.reduce((s, i) => s + x[i], 0);
          const o2 = r.lower.reduce((s, i) => s + x[i], 0);
          const v = r.g.a + r.g.b * o1 + r.g.c * o2 + r.g.d * o1 * o2;
          raw += v;
          if (Math.abs(v) > 1e-9) items.push(`${r.label}: o₁ = ${o1}, o₂ = ${o2} → g = ${fmt(v)}`);
        }
      }
      if (on) total += w * raw;
      rows.push(el('div', { class: `egroup${on ? '' : ' off'}` },
        el('div', { class: 'egroup-head' }, el('span', { class: 'swatch', style: { background: termColor(t) } }),
          el('span', {}, `${t.symbol} · ${termSentence(t, ctx())}`),
          el('strong', {}, on ? `${nf(w, 2)} × ${fmt(raw)} = ${fmt(w * raw)}` : 'aus')),
        items.length
          ? el('ul', {}, items.slice(0, 8).map((s) => el('li', {}, s)), items.length > 8 ? el('li', { class: 'hint' }, `… und ${items.length - 8} weitere`) : null)
          : el('div', { class: 'hint' }, t.type === 'gruppe' || t.type === 'nachbar' ? 'alle Gruppen bei f = 0' : 'kein Beitrag')));
    }
    const Eq = energy(st.model, x);
    const truth = st.sched.trueObjective(x);
    const obj = objectiveEnergy(x);
    const rank = st.result.all ? rankOf(st.result, toMask(x)) : null;
    fill(energyHost,
      el('div', { class: 'etotal' },
        el('div', {}, el('div', { class: 'hint' }, 'Energie E'), el('div', { class: 'ebig' }, fmt(total))),
        el('div', { class: 'erank' }, rank ? el('div', {}, `Platz ${nf(rank)} von ${nf(st.result.total)}`) : null,
          el('div', { class: truth.valid ? 'okline' : 'warnline' }, truth.valid ? '✓ zulässig' : `✗ ${truth.dec.issues.length} Verstoß/Verstöße`))),
      ...rows,
      truth.valid
        ? el('p', { class: Math.abs(obj - truth.value) < 1e-6 ? 'okline' : 'warnline' },
          `Ziel-Bausteine: ${fmt(obj)} – echtes Ziel (${st.data.instance.criterion.label}): ${fmt(truth.value)} ${unit()} ${Math.abs(obj - truth.value) < 1e-6 ? '✓ identisch' : '✗ die Ziel-Bausteine messen etwas anderes'}`)
        : el('p', { class: 'hint' }, 'Unzulässiger Zustand: Hier zählt, wie teuer die Regeln ihn machen.'),
      el('p', { class: 'hint' }, `Probe über die Matrix: xᵀQx + Konstante = ${fmt(Eq)} ${Math.abs(Eq - total) < 1e-6 ? '✓ identisch' : '✗ ABWEICHUNG'}`));
  }

  function renderGanttCard() {
    const truth = st.sched.trueObjective(st.x);
    renderGantt(ganttHost, ganttNote, { sched: st.sched, x: st.x, label: st.data.instance.criterion.label, value: truth.value, unit: unit() });
  }

  // ---------------------------------------------------------------- Hardware
  function renderHardware() {
    const n = st.data.formulation.n;
    const offs = st.model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const coefs = st.model.entries.filter((e) => e.value !== 0).map((e) => Math.abs(e.value));
    fill(hardwareHost,
      el('div', { class: 'kpis', style: { marginTop: '10px' } },
        kpiSmall('Qubits', nf(n), K() > 1 ? `Aufträge × Roboter × ${K()} Plätze` : 'Aufträge × Roboter'),
        kpiSmall('Kopplungen', nf(offs.length), `${nf((100 * offs.length) / Math.max(1, (n * (n - 1)) / 2), 0)} % aller Paare`),
        kpiSmall('Größter |Koeffizient|', fmt(coefs.length ? Math.max(...coefs) : 0), 'bestimmt die nötige Präzision')),
      el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Baustein'), el('th', { class: 'num' }, 'Diagonale'), el('th', { class: 'num' }, 'Kopplungen'),
          el('th', { class: 'num' }, 'nur von ihm'))),
        el('tbody', {}, st.terms.map((t) => {
          const r = resolved(t.id);
          const unique = offs.filter((e) => e.activeParts.length && e.activeParts.every((p) => p.term === t.id)).length;
          return el('tr', { class: st.active[t.id] ? '' : 'dim' },
            el('td', {}, el('b', { style: { color: termColor(t) } }, t.symbol), ` ${TYPE_LABEL[t.type]}`),
            el('td', { class: 'num' }, nf(r?.stats?.diag ?? 0)), el('td', { class: 'num' }, nf(r?.stats?.couplings ?? 0)),
            el('td', { class: 'num' }, st.active[t.id] ? nf(unique) : '–'));
        }))),
      el('p', { class: 'hint' }, 'Kopplungen je Baustein sind strukturell gezählt; eine Kopplung kann von mehreren Bausteinen kommen. „Nur von ihm“ verschwindet, wenn man ihn weglässt.'));
  }

  function flashVars(i, j) {
    for (const k of new Set([i, j])) {
      const b = boardHost.querySelector(`[data-var="${k}"]`);
      if (b) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
    }
  }

  load();
}

function kpiSmall(label, value, note) {
  return el('div', { class: 'kpi' }, el('div', { class: 'kpi-label' }, label), el('div', { class: 'kpi-value', style: { fontSize: '1.3rem' } }, value),
    el('div', { class: 'kpi-note' }, note));
}
