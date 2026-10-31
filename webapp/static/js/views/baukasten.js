// Reiter „Kodierungen“ › Formel-Baukasten: die QUBO aus Bausteinen selbst zusammensetzen – mit jeder Kodierung
// (One-Hot, Domain Wall, Binary, auch gemischt je Auftrag) und ausdrücklich auch falsch.
// Jede Lösung wird am echten Problem gemessen; die Diagnose zeigt, was fehlt, welche Form oder welches Gewicht
// nicht reicht – und in der Energiebilanz, welcher Baustein zum Regelbruch zieht und welcher sich wehrt.
// Ausmultiplizieren: encodings/baukasten.py · Energien und Suche im Browser: qubo/engine.js, qubo/encoding.js.
import { el, fill, nf, tipHtml, withTip } from '../util.js';
import { initialScenario, renderScenario } from '../components/scenario.js';
import { autoWeights } from '../components/weightControls.js';
import { renderBlockBoard } from '../components/blockBoard.js';
import { renderGantt } from '../components/gantt.js';
import { MAX_SEARCH_BITS, anneal, energy, fromMask, makeTermModel, rankOf, search, toMask } from '../qubo/engine.js';
import { createSchedule } from '../qubo/schedule.js';
import { ENC_LABEL, createEncoding } from '../qubo/encoding.js';
import { createMatrixView } from '../qubo/matrixView.js';
import { createGraphView } from '../qubo/graphView.js';
import { createLandscape } from '../components/landscape.js';
import { niceCeil } from './onehotCriterion.js';
import {
  COST_TYPES, LEVEL, TYPE_LABEL, fmt, newTerm, renderTermEditor, specOf, standardTerm, suggestWeight, termColor, termFormula,
  termSentence, termShort, termTint, verdictOf,
} from './baukastenTerms.js';

const LOO_AUTO_BITS = 16; // „Jeden Baustein weglassen“ bis hierhin automatisch
const MATRIX_MAX_BITS = 64; // größere Matrizen werden unlesbar
const PRESET_LABEL = { standard: 'Standard – passend zur Kodierung', nur_kosten: 'Nur Kosten – leer anfangen' };
const WHY_FREE = {
  auftrag: 'Ohne Regel sind Liegenlassen und Mehrfachfahren gratis – die Kosten entscheiden allein.',
  platz: 'Ohne Regel fährt ein Roboter mehrere Aufträge gleichzeitig – jeder nimmt seinen billigsten.',
  luecke: 'Ohne Regel gilt ein Auftrag hinter einer Lücke als „erster“ und fährt vom Standort los – ein Schein-Plan.',
};
const WHY_FREE_ENC = {
  domain_wall: 'Domain Wall: Die Kette darf brechen – mehrere δ = 1 zeigen auf mehrere Optionen, ein δ = −1 zieht Kosten ab.',
  binary: 'Binary: Ein Phantom-Code ist erlaubt – der Auftrag fährt nicht und kostet nichts.',
  one_hot: '',
};
const LEVEL_ICON = { bad: '✗', warn: '⚠', ok: '✓', info: 'ℹ' };
const EPS = 1e-6;

function parseFormel(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (Array.isArray(o.terms) && o.terms.length) return { terms: o.terms, weights: o.weights || {}, active: o.active || {} };
  } catch { /* unlesbar: dann Voreinstellung */ }
  return null;
}
/** ?kodierung=binary oder ?kodierung=12:binary,13:domain_wall */
function parseEncoding(raw) {
  if (!raw) return { def: 'one_hot', map: {} };
  if (ENC_LABEL[raw]) return { def: raw, map: {} };
  const map = {};
  for (const part of String(raw).split(',')) {
    const [t, e] = part.split(':');
    if (ENC_LABEL[e]) map[t] = e;
  }
  return { def: 'one_hot', map };
}

export function renderBaukasten(root, { run, api, params }) {
  const tasks = run.tasks;
  const linked = parseFormel(params.formel);
  const encParam = parseEncoding(params.kodierung);
  const slots = [1, 2, 3].includes(Number(params.plaetze)) ? Number(params.plaetze) : 1;
  const st = {
    ...initialScenario(tasks, params),
    mode: params.modus === 'alle' ? 'alle' : 'kandidaten',
    slots,
    criterion: params.kriterium || (slots === 1 ? 'leerfahrt' : 'erledigungszeit'),
    costParams: {},
    encDefault: encParam.def, // Kodierung neuer Aufträge
    enc: { ...encParam.map }, // je Auftrag (Schlüssel: Nummer als Text)
    order: params.reihenfolge === 'kosten' ? 'kosten' : 'nummer',
    preset: params.preset || null,
    terms: linked ? linked.terms : null, // null: Voreinstellung vom Server
    weights: linked ? linked.weights : {},
    active: linked ? linked.active : {},
    dirty: Boolean(linked), // selbst verändert? Dann bleibt die Formel bei Szenariowechseln stehen
    open: new Set(String(params.offen || '').split(',').filter(Boolean)), // Bearbeitungsfelder per Link: ?offen=zeile,luecke
    honest: true,
    data: null,
    sched: null,
    encx: null,
    x: new Uint8Array(0),
    model: null,
    result: null,
    resultKey: '',
    layoutKey: '',
    weightKey: '',
    planRaws: [],
    planStats: {},
    loo: null,
    looKey: '',
  };

  // ---------------------------------------------------------------- Gerüst
  const scenarioBody = el('div');
  const problemHost = el('div');
  const formulaHost = el('div');
  const diagHost = el('div');
  const balanceHost = el('div');
  const validHost = el('div');
  const looHost = el('div');
  const quickHost = el('div', { class: 'quick' });
  const boardHost = el('div');
  const energyHost = el('div');
  const ganttNote = el('div');
  const ganttHost = el('div', { class: 'chart' });
  const matrixHost = el('div');
  const graphHost = el('div');
  const hardwareHost = el('div');
  const normHost = el('div');
  const landHost = el('div');
  const cardEl = (title, sub, ...body) => el('section', { class: 'card' },
    el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, title), sub ? el('div', { class: 'card-sub', html: sub }) : null)),
    ...body);
  const gap = () => el('div', { style: { height: '16px' } });

  root.append(el('p', {
    class: 'intro',
    html: `Die Formel ist <b>frei</b>: <b>Kodierung je Auftrag</b> (One-Hot, Domain Wall, Binary, auch gemischt) und <b>Bausteine</b> zum An- und Abschalten,
      Umbauen, Gewichten – auch unsinnig. Gemessen wird am <b>echten Problem</b>; die <b>Energiebilanz</b> zeigt, welcher Baustein zum Regelbruch zieht
      und welcher sich wehrt.`,
  }));
  root.append(el('div', { class: 'grid grid-2' },
    cardEl('Szenario & Kodierung', 'Aufträge, Plätze K, Kriterium, Bits je Auftrag', scenarioBody),
    cardEl('Das echte Problem', 'Anforderungen und Ziel – für dein QUBO-Minimum und den Zustand im Bit-Brett', problemHost)));
  root.append(gap());
  root.append(cardEl('Die Formel – aus Bausteinen',
    'Haken = zählt · Zahl = Gewicht · ✎ Form, Gruppe, Geltung, Wirkung · ✕ entfernt', formulaHost));
  root.append(gap());
  root.append(cardEl('Diagnose', 'Dein QUBO-Minimum gegen das echte Problem – und wie die Bausteine zusammenwirken',
    diagHost, balanceHost, validHost, looHost));
  root.append(gap());
  root.append(cardEl('Bit-Brett', 'Je Auftrag ein Bit-Block, Kodierung je Zeile umschaltbar · auch unzulässige Zustände · kleine Zahl = Ziel-Beitrag', quickHost, boardHost));
  root.append(gap());
  root.append(el('div', { class: 'grid grid-2' },
    cardEl('Energie je Baustein', 'Beitrag jedes Bausteins zum Zustand im Bit-Brett', energyHost),
    cardEl('Ablaufplan', 'Gelesen aus den Indikatoren mit I = 1', ganttNote, ganttHost)));
  root.append(gap());
  root.append(el('div', { class: 'grid grid-2' },
    cardEl('QUBO-Matrix', 'Farbe = Baustein · Hover erklärt · umrandet = zählt jetzt', matrixHost),
    cardEl('Kopplungsgraph & Hardware', 'Kopplungen je Baustein', graphHost, hardwareHost)));
  root.append(gap());
  root.append(el('div', { class: 'grid grid-2' },
    cardEl('Normierte QUBO-Matrix', 'Q / max|Q| · blau = Belohnung, rot = Strafe', normHost),
    cardEl('Energielandschaft', 'Zustände als Fläche · Ziehen dreht, Scrollen zoomt', landHost)));
  const landscape = createLandscape(normHost, landHost);

  let matrixView = null;
  let graphView = null;

  // ---------------------------------------------------------------- Hilfen
  const K = () => st.data.instance.slots;
  const form = () => st.data.formulation;
  const ctx = () => ({ K: K(), objective: st.data.instance.objective, critLabel: st.data.instance.criterion.label,
    ind: form().used_encodings.every((e) => e === 'one_hot') ? 'x' : 'I' });
  const unit = () => st.data.instance.criterion.unit || 's';
  const termById = (id) => st.terms.find((t) => t.id === id);
  const resolved = (id) => form().terms.find((t) => t.id === id);
  const activeTerms = () => st.terms.filter((t) => st.active[t.id]);
  const reqLabel = (k) => st.data.requirements.find((r) => r.key === k)?.label || k;
  const encOf = (task) => form().encodings[String(task)];
  const mixed = () => form().used_encodings.length > 1;
  const plans = () => st.data.plans?.plans || [];
  const bestX = () => (plans().length ? st.encx.encodePlan(plans()[0].opts) : null);
  const truth = (x) => st.encx.truth(x);
  const wsum = (raw, ids) => ids.reduce((s, id) => s + st.weights[id] * raw[id], 0);
  const activeIds = (active = st.active) => st.terms.filter((t) => active[t.id]).map((t) => t.id);
  const costIds = () => activeTerms().filter((t) => COST_TYPES.has(t.type)).map((t) => t.id);
  const objectiveEnergy = (x) => wsum(st.encx.termRaw(x), costIds());

  /** Der gültige Plan, den eine QUBO (aktive Bausteine) für den billigsten hält – über alle mitgeschickten Pläne. */
  function bestValid(active = st.active) {
    const ids = activeIds(active);
    let k = -1;
    let E = Infinity;
    st.planRaws.forEach((raw, i) => {
      const e = wsum(raw, ids);
      if (e < E - 1e-9) { E = e; k = i; }
    });
    return k < 0 ? null : { k, E, plan: plans()[k], x: st.encx.encodePlan(plans()[k].opts) };
  }

  // ---------------------------------------------------------------- Szenario
  function encodingSpec() {
    const out = {};
    for (const t of st.selected) out[String(t)] = st.enc[String(t)] || st.encDefault;
    return out;
  }
  function setAllEncodings(e) {
    st.encDefault = e;
    st.enc = {};
    if (!st.dirty) resetToPreset(null);
    load();
  }
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
    const spec = encodingSpec();
    const used = new Set(Object.values(spec));
    const encChips = el('div', { class: 'filter-group' }, Object.entries(ENC_LABEL).map(([k, label]) => {
      const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(used.size === 1 && used.has(k)) }, label);
      b.addEventListener('click', () => setAllEncodings(k));
      return b;
    }), used.size > 1 ? el('span', { class: 'chip', 'aria-pressed': 'true' }, 'gemischt') : null,
    el('button', { class: 'btn small', type: 'button', title: 'Reihum One-Hot, Domain Wall, Binary', onclick: () => {
      st.enc = Object.fromEntries(st.selected.map((t, k) => [String(t), Object.keys(ENC_LABEL)[k % 3]]));
      if (!st.dirty) resetToPreset(null);
      load();
    } }, 'reihum mischen'));
    const orderSel = el('select', { 'aria-label': 'Reihenfolge der Optionen' },
      el('option', { value: 'nummer' }, 'nach Roboter und Platz'), el('option', { value: 'kosten' }, 'billigste zuerst'));
    orderSel.value = st.order;
    orderSel.addEventListener('change', () => { st.order = orderSel.value; load(); });
    const extra = el('div', {},
      el('div', { class: 'filter-group', style: { marginTop: '10px' } }, el('span', { class: 'filter-label' }, 'Plätze je Roboter K'), slotSel),
      el('div', { class: 'filter-group', style: { marginTop: '6px' } }, el('span', { class: 'filter-label' }, 'Kriterium'), critSel),
      el('div', { class: 'filter-group', style: { marginTop: '6px' } }, el('span', { class: 'filter-label' }, 'Kodierung'), encChips),
      el('div', { class: 'filter-group', style: { marginTop: '6px' } }, el('span', { class: 'filter-label' }, 'Optionen in Kette/Code'), orderSel,
        el('span', { class: 'hint' }, 'je Auftrag umschaltbar im Bit-Brett')),
      el('p', { class: 'hint' }, st.dirty
        ? 'Deine Formel bleibt beim Wechsel von K, Kriterium oder Kodierung stehen – die Diagnose zeigt, ob sie noch passt. Eine Voreinstellung setzt sie zurück.'
        : 'Solange du nichts veränderst, passt sich die Formel an K, Kriterium und Kodierung an.'));
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
      kodierung: encodingSpec(), reihenfolge: st.order,
      terms: st.terms ? st.terms.map(specOf) : null, preset: st.terms ? null : st.preset };
    let data;
    try {
      data = await api(`/api/runs/${encodeURIComponent(run.run_id)}/baukasten`, { body });
    } catch (err) {
      drawScenario(`Konnte die Formulierung nicht bauen: ${err.message}`);
      return;
    }
    const scenarioKey = [st.selected, st.mode, st.criterion, st.slots, JSON.stringify(st.costParams)].join('|');
    const layoutKey = `${scenarioKey}|${JSON.stringify(data.formulation.encodings)}|${st.order}`;
    const layoutChanged = layoutKey !== st.layoutKey;
    st.data = data;
    st.enc = { ...st.enc, ...data.formulation.encodings };
    st.terms = data.formulation.terms.map(specOf);
    // Gewichte und Schalter je Baustein: neue Bausteine bekommen ihr empfohlenes Gewicht. Bei neuem Szenario oder neuer
    // Kodierung werden alle Gewichte neu empfohlen (außer beim ersten Laden per Link oder wenn die Automatik aus ist).
    const fresh = layoutChanged && !(linked && !st.layoutKey) && autoWeights();
    const ids = new Set(st.terms.map((t) => t.id));
    for (const k of Object.keys(st.weights)) if (!ids.has(k) || fresh) delete st.weights[k];
    for (const k of Object.keys(st.active)) if (!ids.has(k)) delete st.active[k];
    for (const t of data.formulation.terms) {
      if (!(t.id in st.weights)) st.weights[t.id] = t.recommended ?? data.weights[t.symbol] ?? data.weights.A;
      if (!(t.id in st.active)) st.active[t.id] = true;
    }
    st.sched = createSchedule(data.instance);
    st.encx = createEncoding(data.formulation, st.sched);
    // Was kostet jeder Baustein bei gültigen Plänen? (ohne Gewicht – hängt nur an der Formel)
    st.planRaws = plans().map((p) => st.encx.termRaw(st.encx.encodePlan(p.opts)));
    st.planStats = {};
    for (const t of st.terms) {
      const vals = st.planRaws.map((r) => r[t.id]);
      st.planStats[t.id] = vals.length ? { min: Math.min(...vals), max: Math.max(...vals), best: vals[0] } : null;
    }
    if (layoutChanged || st.x.length !== data.formulation.n) {
      st.layoutKey = layoutKey;
      st.x = bestX() || st.encx.honest(new Uint8Array(data.formulation.n));
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
    const f = form();
    const encx = st.encx;
    const sym = (p) => termById(p.term)?.symbol || p.term;
    if (f.n <= MATRIX_MAX_BITS) {
      matrixView = createMatrixView(matrixHost, {
        labels: f.bits.map((b, i) => encx.bitLabel(i)), varName: encx.bitLabel, onCellClick: flashVars,
        describePart: (p) => `${sym(p)} · ${partText(p)}: ${fmt(p.v)} × ${nf(st.weights[p.term], 2)} = ${fmt(p.v * st.weights[p.term])}`,
        colorOf: (p) => termColor(termById(p.term)), tintOf: (p) => termTint(termById(p.term)),
      });
    } else {
      matrixView = null;
      fill(matrixHost, el('p', { class: 'hint' }, `Bei ${f.n} Qubits wäre die Matrix unlesbar (${nf((f.n * (f.n + 1)) / 2)} Zellen) – die Kennzahlen stehen rechts.`));
    }
    const pureOneHot = f.used_encodings.every((e) => e === 'one_hot');
    const vars = st.sched.vars;
    const cols = st.sched.slotColumns();
    const rowKeys = [...st.data.instance.tasks.map((t) => t.transport_id), ...(f.aux.length ? ['aux'] : [])];
    const width = Math.max(1, ...f.bits.map((b) => b.pos));
    const colKeys = pureOneHot ? cols.map((c) => `${c.robot}|${c.slot}`) : Array.from({ length: width }, (_, k) => String(k + 1));
    graphView = createGraphView(graphHost, {
      variables: f.bits.map((b, i) => ({
        get cost() { return st.model ? bitValue(i) : 0; }, // erst beim Hovern – das Modell entsteht nach den Ansichten
        row: b.aux ? 'aux' : b.task_id,
        col: pureOneHot && !b.aux ? `${vars[b.option].robot_id}|${vars[b.option].slot}` : String(b.pos),
      })),
      rowKeys, colKeys,
      rowLabel: (t) => (t === 'aux' ? 'Hilfsbits' : `#${t}`),
      colLabel: (k) => {
        if (!pureOneHot) return `Bit ${k}`;
        const [r, q] = k.split('|');
        return K() === 1 ? `R${r}` : `R${r}·${q}`;
      },
      varName: encx.bitLabel, colorOf: (p) => termColor(termById(p.term)),
    });
  }
  function partText(p) {
    if (p.kind === 'kosten') return `Kosten #${p.task_id} auf R${p.robot_id}${K() > 1 ? `, Platz ${p.slot}` : ''}`;
    if (p.kind === 'vorgaenger') return `#${p.from} direkt vor #${p.to} auf R${p.robot_id}`;
    if (p.kind === 'hilfsbit') return `w = ${st.encx.bitLabel(p.pair[0])}·${st.encx.bitLabel(p.pair[1])}`;
    return `${TYPE_LABEL[p.kind]} ${p.group}`;
  }

  /** URL spiegelt Szenario, Kodierung und Formel – ein Link reproduziert genau diesen Stand. */
  function writeUrl() {
    const q = new URLSearchParams({ auftraege: st.selected.join(','), plaetze: String(st.slots), kriterium: st.criterion });
    if (st.mode === 'alle') q.set('modus', 'alle');
    const spec = encodingSpec();
    const used = new Set(Object.values(spec));
    if (used.size > 1) q.set('kodierung', Object.entries(spec).map(([t, e]) => `${t}:${e}`).join(','));
    else if (!used.has('one_hot')) q.set('kodierung', [...used][0]);
    if (st.order === 'kosten') q.set('reihenfolge', 'kosten');
    if (st.dirty) q.set('formel', JSON.stringify({ terms: st.terms, weights: st.weights, active: st.active }));
    history.replaceState(null, '', `#/ta/baukasten?${q}`);
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
  function solve(model, topK, active = st.active) {
    if (model.n <= MAX_SEARCH_BITS) {
      const r = search(model, topK);
      return { exhaustive: true, min: { E: r.min.E, x: fromMask(r.min.mask, model.n) }, top: r.top.map((t) => ({ E: t.E, x: fromMask(t.mask, model.n) })),
        all: r.all, total: r.total };
    }
    // Heuristik: Simulated Annealing mit Tausch-Zügen in One-Hot-Blöcken – dazu alle gültigen Pläne als Kandidaten
    const groups = st.encx.blocks.filter((b) => b.encoding === 'one_hot').map((b) => b.bits);
    const penalties = st.terms.filter((t) => !COST_TYPES.has(t.type) && active[t.id]).map((t) => st.weights[t.id]);
    const r = anneal(model, { restarts: 60, sweeps: 600, seed: 7, groups, T0: Math.max(1, ...penalties), T1: 0.5 });
    const v = bestValid(active);
    const top = v ? [...r.top, { E: energy(model, v.x), x: v.x }].sort((a, b) => a.E - b.E) : r.top;
    return { exhaustive: false, min: top[0], top, all: null, total: 2 ** model.n };
  }
  function compute() {
    st.model = makeTermModel(form(), { weights: st.weights, active: st.active });
    const key = JSON.stringify([st.weights, st.active, st.terms, st.layoutKey]);
    if (key !== st.resultKey) {
      st.resultKey = key;
      st.result = solve(st.model, 30);
    }
  }

  // ---------------------------------------------------------------- Zeichnen
  function update({ keepFormula = false } = {}) {
    if (!st.data) return;
    compute();
    if (!keepFormula) renderFormula();
    renderProblem();
    renderDiagnosis();
    renderValid();
    renderLoo();
    renderBoard();
    renderEnergy();
    renderGanttCard();
    matrixView?.update(st.model, st.x);
    graphView.update(st.model, st.x);
    renderHardware();
    landscape.update({ model: st.model, labels: form().bits.map((b, i) => st.encx.bitLabel(i)), x: st.x, minX: st.result.min.x, cacheKey: st.result,
      validMasks: form().n <= 16 ? plans().map((p) => toMask(st.encx.encodePlan(p.opts))) : null });
    writeUrl();
  }

  // ---------------------------------------------------------------- Das echte Problem
  function renderProblem() {
    const data = st.data;
    const minTruth = truth(st.result.min.x);
    const curTruth = truth(st.x);
    const status = (tr, key) => {
      if (key === 'hilfsbit') {
        return tr.lies.length ? el('td', { class: 'no-ok' }, `✗ ${tr.lies.length} Hilfsbit(s) lügen: ${tr.lies.slice(0, 3).map(st.encx.bitLabel).join(', ')}`) : el('td', { class: 'ok' }, '✓');
      }
      const issues = tr.dec.issues.filter((i) => i.kind === key);
      return issues.length
        ? el('td', { class: 'no-ok' }, `✗ ${issues.slice(0, 2).map((i) => i.text).join(' · ')}${issues.length > 2 ? ` · … (${issues.length})` : ''}`)
        : el('td', { class: 'ok' }, '✓');
    };
    const goal = (tr) => {
      if (!tr.valid) return el('td', { class: 'hint' }, '– (unzulässig)');
      if (!data.exact) return el('td', {}, `${fmt(tr.value)} ${unit()}`);
      const best = Math.abs(tr.value - data.exact.value) < EPS;
      return el('td', { class: best ? 'ok' : 'no-ok' }, `${fmt(tr.value)} ${unit()} ${best ? '✓ bestmöglich' : `✗ (bestmöglich ${fmt(data.exact.value)})`}`);
    };
    fill(problemHost,
      el('table', { class: 'data req-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Anforderung'), el('th', {}, 'Minimum deiner QUBO'), el('th', {}, 'Zustand im Bit-Brett'))),
        el('tbody', {}, data.requirements.map((r) => el('tr', { class: r.encoding ? 'enc-req' : '' },
          el('td', {}, r.label),
          ...(r.key === 'ziel' ? [goal(minTruth), goal(curTruth)] : [status(minTruth, r.key), status(curTruth, r.key)]))))),
      el('p', { class: 'hint' }, data.exact
        ? `Bester gültiger Plan (alle ${nf(data.exact.count)} Pläne aufgezählt): ${st.sched.describeSeq(st.sched.seqMap(data.exact.sequences))} = ${fmt(data.exact.value)} ${unit()}.`
        : 'Es gibt keinen gültigen Plan: mehr Aufträge als Plätze. Mehr Plätze K oder weniger Aufträge wählen.'),
      data.exact && data.exact_free && Math.abs(data.exact_free.value - data.exact.value) > EPS
        ? el('p', { class: 'hint' }, `Ohne Platzgrenze wäre ${fmt(data.exact_free.value)} ${unit()} möglich – K = ${K()} schneidet das Optimum ab.`) : null,
      data.requirements.some((r) => r.encoding)
        ? el('p', { class: 'hint' }, 'Grau: Bedingungen der Kodierung – nicht vom echten Problem, aber nötig für die QUBO.') : null);
  }

  // ---------------------------------------------------------------- Formel
  function indicatorLine() {
    const used = form().used_encodings;
    const parts = {
      one_hot: '<b>One-Hot</b>: <i>I</i> = <i>x</i><sub>t,o</sub> (Grad 1)',
      domain_wall: '<b>Domain Wall</b>: <i>I</i><sub>t,k</sub> = <i>b</i><sub>t,k</sub> − <i>b</i><sub>t,k+1</sub> (linear, an Kettenbrüchen −1)',
      binary: '<b>Binary</b>: <i>I</i><sub>t,k</sub> = Π<sub>j</sub> <i>z</i><sub>t,j</sub> bzw. (1 − <i>z</i><sub>t,j</sub>) (Grad ⌈log₂ m⌉)',
    };
    return el('div', { class: 'bk-ind', html: `Zuweisungs-Bausteine rechnen mit <i>I</i><sub>t,o</sub> = „t nimmt Option o“: ${used.map((e) => parts[e]).join(' · ')}.
      Bit-Bausteine (schraffiert) wirken direkt auf die Bits <i>z</i><sub>t,j</sub>.` });
  }
  function renderFormula() {
    const data = st.data;
    const c = ctx();
    const presets = el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Voreinstellung'),
      Object.entries(PRESET_LABEL).map(([name, label]) => el('button', { class: 'btn small', type: 'button',
        title: 'Setzt Bausteine und Gewichte zurück', onclick: () => { resetToPreset(name); st.dirty = name !== data.default_preset; load(); } }, label)));
    const sliderMax = niceCeil(3 * Math.max(...form().terms.map((t) => t.recommended || 0), ...Object.values(st.weights)));
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
      const editBtn = el('button', { class: `btn small${st.open.has(t.id) ? ' primary' : ''}`, type: 'button', title: 'Form, Gruppe, Geltungsbereich und Wirkung', onclick: () => {
        if (st.open.has(t.id)) st.open.delete(t.id); else st.open.add(t.id);
        renderFormula();
      } }, '✎');
      const delBtn = el('button', { class: 'btn small', type: 'button', title: t.auto ? 'Wird automatisch ergänzt, solange Hilfsbits nötig sind – abschalten geht über den Haken' : 'Baustein entfernen',
        disabled: st.terms.length <= 1 || t.auto, onclick: () => removeTerm(t.id) }, '✕');
      const line = el('div', { class: `bk-line${on ? '' : ' off'}${LEVEL[t.type] === 'bits' ? ' bits' : ''}`, style: { borderLeftColor: termColor(t) } },
        el('span', { class: 'bk-lhs', html: k === 0 ? '<i>E</i>(<i>x</i>) =' : '+' }), box,
        el('span', { class: 'bk-sym' }, el('b', { style: { color: termColor(t) } }, t.symbol), w, '·'),
        el('span', { class: 'bk-term', html: termFormula(t, c) }),
        el('span', { class: 'bk-note' }, badge, ' ', termSentence(t, c), t.auto ? el('span', { class: 'hint' }, ' (automatisch)') : null),
        el('span', { class: 'bk-actions' }, editBtn, delBtn));
      let editor = null;
      if (st.open.has(t.id)) {
        editor = el('div', { class: 'bk-editor', style: { borderLeftColor: termColor(t) } });
        renderTermEditor(editor, { term: t, resolved: r, ctx: c, weight: st.weights[t.id], weightMax: isCost ? 3 : sliderMax,
          onChange: (patch) => editTerm(t.id, patch), onWeight: (val, full) => setWeight(t.id, val, null, full) });
        editor.querySelector('input[type="range"]')?.setAttribute('data-weight', t.id);
      }
      return [line, editor];
    });
    const add = el('select', { 'aria-label': 'Baustein hinzufügen' }, el('option', { value: '' }, '+ Baustein hinzufügen …'),
      el('optgroup', { label: 'Zuweisung (über die Indikatoren I)' }, Object.entries(TYPE_LABEL).filter(([type]) => LEVEL[type] === 'zuweisung')
        .map(([type, label]) => el('option', { value: type }, label))),
      el('optgroup', { label: 'Bits (direkt auf den Bits eines Blocks)' }, Object.entries(TYPE_LABEL).filter(([type]) => LEVEL[type] === 'bits')
        .map(([type, label]) => el('option', { value: type }, label))));
    add.addEventListener('change', () => { if (add.value) addTerm(newTerm(add.value, st.terms, data.instance.criterion)); });
    const offs = st.model.entries.filter((e) => e.i !== e.j && e.value !== 0).length;
    const f = form();
    fill(formulaHost, indicatorLine(), presets,
      el('div', { class: 'bk-lines' }, lines),
      el('div', { class: 'filter-group', style: { marginTop: '10px' } }, add,
        el('span', { class: 'hint' }, `→ ${f.n} Qubits (${f.n_task_bits} Bits${f.aux.length ? ` + ${f.aux.length} Hilfsbits` : ''}), ${offs} Kopplungen, `
          + `höchster Grad vor den Hilfsbits ${f.max_degree}, Konstante ${fmt(st.model.constant)}`)));
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
    for (const c of costs) {
      const r = resolved(c.id);
      if (r && r.tasks.length < data.instance.tasks.length) out.push({ level: 'warn', term: c.id, html: `<b>${c.symbol} gilt nicht für alle Aufträge</b> – die übrigen sind für die QUBO kostenlos.` });
    }
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

  /** Deckt Baustein t diesen Verstoß ab (richtige Regelart für die Kodierung des Auftrags)? */
  function coversIssue(t, issue) {
    const r = resolved(t.id);
    if (!r) return false;
    if (issue.kind === 'auftrag' || issue.kind === 'kodierung') {
      if (!r.tasks.includes(issue.task)) return false;
      const e = encOf(issue.task);
      if (t.type === 'gruppe' && (t.gruppe || 'auftrag') === 'auftrag') return e !== 'domain_wall';
      if (t.type === 'bitnachbar' && (t.form || 'kette') === 'kette') return e === 'domain_wall';
      if (t.type === 'ungueltig') return e === 'binary';
      return false;
    }
    if (issue.kind === 'platz') return t.type === 'gruppe' && ['platz', 'roboter'].includes(t.gruppe);
    if (issue.kind === 'luecke') return t.type === 'nachbar';
    return false;
  }

  /** Verstöße gruppiert: Auftrag + Kodierung je Kodierung (dieselbe Regel hilft), Platz, Lücke. */
  function issueGroups(tr) {
    const groups = new Map();
    for (const i of tr.dec.issues) {
      const e = i.task != null ? encOf(i.task) : null;
      const key = i.kind === 'auftrag' || i.kind === 'kodierung' ? `auftrag|${e}` : i.kind;
      if (!groups.has(key)) groups.set(key, { kind: i.kind === 'kodierung' ? 'auftrag' : i.kind, encoding: e, issues: [] });
      groups.get(key).issues.push(i);
    }
    return [...groups.values()];
  }

  function diagnose() {
    const data = st.data;
    const res = st.result;
    const x = res.min.x;
    const tr = truth(x);
    const xOpt = bestX();
    const items = [];
    const act = activeTerms();
    const c = ctx();
    const raw = st.encx.termRaw(x);
    if (!data.exact) items.push({ level: 'warn', html: '<b>Es gibt keinen gültigen Plan:</b> mehr Aufträge als Plätze. Irgendeine Regel muss brechen – mehr Plätze K oder weniger Aufträge.' });
    // Regeln, die den besten gültigen Plan teurer machen als andere gültige Pläne, verlangen mehr als das Problem
    const conflicts = xOpt ? act.filter((t) => !COST_TYPES.has(t.type) && st.planStats[t.id])
      .map((t) => ({ t, over: st.planStats[t.id].best - st.planStats[t.id].min })).filter((cf) => cf.over > EPS) : [];
    for (const { t, over } of conflicts) {
      items.push({ level: 'bad', html: `<b>${t.symbol} bestraft den besten gültigen Plan</b> (um ${fmt(over)} × ${nf(st.weights[t.id], 2)} = ${fmt(over * st.weights[t.id])} mehr als den günstigsten gültigen):
        „${termSentence(t, c)}“ verlangt etwas anderes als das Problem. Solange das so ist, hilft kein Gewicht.` });
    }
    // Strafen, die gültige Pläne unterschiedlich teuer machen, verschieben deren Rangfolge
    for (const t of act) {
      const s = st.planStats[t.id];
      if (COST_TYPES.has(t.type) || !s || s.max - s.min < EPS || conflicts.some((cf) => cf.t === t)) continue;
      items.push({ level: 'warn', html: `<b>${t.symbol} mischt sich ins Ziel ein:</b> kostet bei gültigen Plänen ${fmt(s.min)} bis ${fmt(s.max)} (× ${nf(st.weights[t.id], 2)})
        und verschiebt die Rangfolge – der beste Plan zahlt hier das Minimum, anderswo nicht unbedingt.` });
    }
    const v = bestValid();
    for (const g of issueGroups(tr)) {
      const example = `${g.issues.slice(0, 3).map((i) => i.text).join(' · ')}${g.issues.length > 3 ? ` · … (${g.issues.length})` : ''}`;
      const where = g.kind === 'auftrag' && g.encoding ? ` (${ENC_LABEL[g.encoding]}-Blöcke)` : '';
      const cover = act.filter((t) => g.issues.some((i) => coversIssue(t, i)));
      if (!cover.length) {
        items.push({ level: 'bad', html: `<b>Es fehlt eine Regel für „${reqLabel(g.kind)}“${where}.</b> Im Minimum: ${example}. ${WHY_FREE[g.kind]} ${g.kind === 'auftrag' ? WHY_FREE_ENC[g.encoding] || '' : ''}`,
          action: { label: '+ Standardregel dafür', run: () => addTerm(standardTerm(g.kind, st.terms, data.instance.criterion, g.encoding || 'one_hot', mixed())) } });
        continue;
      }
      for (const t of cover) {
        const vd = verdictOf(resolved(t.id), c.K);
        if ((t.type === 'gruppe' || t.type === 'bitnachbar') && !vd.ok) {
          items.push({ level: 'bad', html: `<b>${t.symbol}: Die Form lässt es zu.</b> „${termSentence(t, c)}“ soll „${reqLabel(g.kind)}“ sichern, aber: ${vd.msgs.filter((m) => !m.includes('✓')).join('; ')}. Im Minimum: ${example}.` });
          continue;
        }
        if (!v || conflicts.length) continue; // bei Konflikten wäre ein Gewichtsvorschlag irreführend
        const rawV = st.planRaws[v.k];
        const delta = v.E - res.min.E;
        const perUnit = raw[t.id] - rawV[t.id];
        if (perUnit > 1e-9 && delta > 0) {
          const s = suggestWeight(st.weights[t.id], delta, perUnit);
          items.push({ level: 'bad', html: `<b>${t.symbol} = ${nf(st.weights[t.id], 2)} ist zu klein.</b> Im Minimum: ${example}. Der billigste gültige Plan kostet ${fmt(delta)} mehr –
            der Bruch lohnt sich. Ab ${t.symbol} ≈ ${nf(st.weights[t.id] + delta / perUnit, 1)} kippt dieser Vergleich (dann evtl. ein anderer Bruch).`,
          action: { label: `${t.symbol} = ${nf(s)} setzen`, run: () => setWeight(t.id, s, null, true) } });
        } else {
          items.push({ level: 'bad', html: `<b>${t.symbol} ist an, verhindert den Verstoß hier aber nicht</b> (${example}) – andere Bausteine belohnen ihn stärker, siehe Energiebilanz.` });
        }
      }
    }
    // Lügende Hilfsbits im Minimum: Die QUBO rechnet dann nicht mehr das Polynom
    if (tr.lies.length) {
      const M = act.filter((t) => t.type === 'hilfsbit');
      const label = tr.lies.slice(0, 4).map(st.encx.bitLabel).join(', ');
      if (!M.length) {
        const off = st.terms.find((t) => t.type === 'hilfsbit');
        items.push({ level: 'bad', html: `<b>Hilfsbits lügen (${label}), keine Hilfsbit-Strafe an:</b> Jedes Hilfsbit ist frei – die QUBO rechnet ein anderes Polynom als deine Formel.`,
          action: off ? { label: `${off.symbol} wieder einschalten`, run: () => setActive(off.id, true) } : { label: '+ Hilfsbit-Strafe', run: () => addTerm(standardTerm('hilfsbit', st.terms, data.instance.criterion)) } });
      } else {
        const xh = st.encx.honest(Uint8Array.from(x));
        const rawH = st.encx.termRaw(xh);
        const delta = energy(st.model, xh) - res.min.E;
        for (const t of M) {
          const perUnit = raw[t.id] - rawH[t.id];
          if (perUnit > 1e-9 && delta > 0) {
            const s = suggestWeight(st.weights[t.id], delta, perUnit);
            items.push({ level: 'bad', html: `<b>${t.symbol} = ${nf(st.weights[t.id], 2)} zu klein: Hilfsbits lügen</b> (${label}); ehrlich wären es ${fmt(delta)} mehr.
              Ab ${t.symbol} ≈ ${nf(st.weights[t.id] + delta / perUnit, 1)} lohnt die Lüge nicht mehr.`,
            action: { label: `${t.symbol} = ${nf(s)} setzen`, run: () => setWeight(t.id, s, null, true) } });
          }
        }
      }
    }
    if (tr.valid && xOpt) {
      if (Math.abs(tr.value - data.exact.value) < EPS) {
        items.push({ level: 'ok', html: `<b>Das Minimum deiner QUBO ist der beste Plan</b> (${fmt(data.exact.value)} ${unit()}).` });
      } else {
        items.push({ level: 'bad', html: `<b>Gültig, aber nicht optimal:</b> ${fmt(tr.value)} statt ${fmt(data.exact.value)} ${unit()} – wer den schlechteren Plan billiger macht, zeigt die Energiebilanz.` });
        const a = objectiveEnergy(x);
        const b = objectiveEnergy(xOpt);
        if (Math.abs(a - tr.value) > EPS || Math.abs(b - data.exact.value) > EPS) {
          items.push({ level: 'bad', html: `<b>Die Ziel-Bausteine bewerten Pläne falsch.</b> Gefundener Plan: in der QUBO ${fmt(a)}, wirklich ${fmt(tr.value)}.
            Bester Plan: in der QUBO ${fmt(b)}, wirklich ${fmt(data.exact.value)}${a < b ? ' – deine QUBO hält den schlechteren Plan für billiger.' : '.'}
            ${K() === 1 && data.instance.objective === 'ablauf' && [...tr.dec.sequences.values()].some((s) => s.length > 1)
    ? '<br>Grund: Bei K = 1 zählt jeder Auftrag, als startete sein Roboter sofort – bei Doppelbelegung fehlt die Wartezeit auf den Vorgänger. Abhilfe: K ≥ 2 (Reihenfolge).' : ''}` });
        } else if (energy(st.model, xOpt) < res.min.E - EPS) {
          items.push({ level: 'warn', html: '<b>Die Heuristik hat das Minimum verfehlt</b> – der beste Plan hätte weniger Energie. Bei vielen Qubits kann das passieren.' });
        } else {
          items.push({ level: 'bad', html: `<b>Die Regeln verzerren das Ziel:</b> Sie kosten auch bei gültigen Plänen etwas – gefunden ${fmt(energy(st.model, x) - a)},
            bester Plan ${fmt(energy(st.model, xOpt) - b)}.` });
        }
      }
    }
    const checks = objectiveChecks();
    if (checks.length && items.some((i) => i.level === 'ok')) {
      checks.forEach((i) => { if (i.level === 'warn') i.html += ' <span class="hint">Hier trifft das Minimum trotzdem – anderswo nicht unbedingt.</span>'; });
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
    const tr = truth(res.min.x);
    const items = diagnose();
    const verdict = !tr.valid ? { cls: 'bad', text: '✗ unzulässig' }
      : !data.exact || Math.abs(tr.value - data.exact.value) < EPS ? { cls: 'ok', text: `✓ bester Plan${tr.lies.length ? ' (Hilfsbits lügen)' : ''}` }
        : { cls: 'warn', text: '✗ gültig, aber nicht optimal' };
    fill(diagHost,
      el('div', { class: 'opt-grid' },
        el('div', { class: 'opt-box' }, el('div', { class: 'hint' }, res.exhaustive ? `Minimum deiner QUBO (alle ${nf(res.total)} Zustände durchprobiert)`
          : 'Minimum deiner QUBO (Heuristik: Simulated Annealing, dazu alle gültigen Pläne geprüft)'),
        el('div', { class: 'big' }, `E = ${fmt(res.min.E)}`), el('div', {}, describeState(res.min.x)),
        el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = Uint8Array.from(res.min.x); update({ keepFormula: true }); } }, 'ins Bit-Brett laden')),
        el('div', { class: 'opt-box' }, el('div', { class: 'hint' }, 'Am echten Problem gemessen'),
          el('div', { class: `big ${verdict.cls}` }, verdict.text),
          el('div', {}, tr.valid ? `${data.instance.criterion.label}: ${fmt(tr.value)} ${unit()}${data.exact ? ` (bestmöglich ${fmt(data.exact.value)})` : ''}`
            : tr.dec.issues.slice(0, 3).map((i) => i.text).join(' · ')))),
      el('h4', {}, 'Was fehlt? Was wirkt?'),
      el('ul', { class: 'diag-list' }, items.map((i) => el('li', { class: `diag ${i.level}` },
        el('span', { class: 'icon' }, LEVEL_ICON[i.level]),
        el('div', {}, el('div', { html: i.html }),
          i.action ? el('button', { class: 'btn small', type: 'button', onclick: i.action.run }, i.action.label) : null)))));
    renderBalance(tr);
  }
  function describeState(x) {
    const tr = truth(x);
    const bad = st.encx.blocks.map((b) => st.encx.readBlock(b, x)).filter((r) => !r.ok && r.block.options.length);
    const seq = st.sched.describeSeq(tr.dec.sequences);
    return bad.length ? `${seq} · ${bad.slice(0, 2).map((r) => `#${r.block.task_id} ${r.text}`).join(' · ')}` : seq;
  }

  // ---------------------------------------------------------------- Energiebilanz
  /**
   * Zwei Zustände Baustein für Baustein vergleichen: Wer macht A billiger als B (zieht), wer teurer (wehrt sich)?
   * Unzulässiges Minimum: gegen den billigsten gültigen Plan. Gültig, nicht optimal: gegen den besten Plan.
   * Optimal: der billigste Regelbruch unter den besten Zuständen gegen das Minimum – der Sicherheitsabstand.
   */
  function renderBalance(tr) {
    const res = st.result;
    const head = el('h4', {}, 'Energiebilanz – wie die Bausteine zusammenwirken');
    const v = bestValid();
    let A;
    let B;
    let title;
    let labels;
    if (!tr.valid && v) {
      [A, B] = [res.min.x, v.x];
      title = `Warum gewinnt der Regelbruch? Minimum gegen den billigsten gültigen Plan deiner QUBO (${st.sched.describeSeq(truth(v.x).dec.sequences)}).`;
      labels = ['Minimum (Regelbruch)', 'billigster gültiger Plan'];
    } else if (tr.valid && st.data.exact && Math.abs(tr.value - st.data.exact.value) > EPS) {
      [A, B] = [res.min.x, bestX()];
      title = 'Warum nicht der beste Plan? Minimum gegen den besten gültigen Plan.';
      labels = ['Minimum', 'bester Plan'];
    } else if (tr.valid) {
      const breach = res.top.find((s) => !truth(s.x).valid);
      if (!breach) {
        const last = res.top[res.top.length - 1];
        fill(balanceHost, head, el('p', { class: 'hint' }, res.exhaustive
          ? `Kein Regelbruch unter den ${res.top.length} billigsten Zuständen – jeder kostet ≥ ${fmt(last.E - res.min.E)} mehr als dein Minimum.`
          : 'Die Heuristik fand nur gültige Zustände – den Abstand zum billigsten Bruch kann sie nicht sicher angeben.'));
        return;
      }
      [A, B] = [breach.x, res.min.x];
      title = `Sicherheitsabstand: billigster Regelbruch (${truth(breach.x).dec.issues.slice(0, 2).map((i) => i.text).join(' · ')}) gegen dein Minimum.`;
      labels = ['billigster Regelbruch', 'Minimum'];
    } else {
      fill(balanceHost, head, el('p', { class: 'hint' }, 'Ohne gültigen Plan gibt es keinen Vergleich.'));
      return;
    }
    const ra = st.encx.termRaw(A);
    const rb = st.encx.termRaw(B);
    const rows = activeTerms().map((t) => {
      const w = st.weights[t.id];
      return { t, a: w * ra[t.id], b: w * rb[t.id], d: w * (ra[t.id] - rb[t.id]) };
    });
    const total = rows.reduce((s, r) => s + r.d, 0);
    const pull = rows.filter((r) => r.d < -EPS).sort((p, q) => p.d - q.d);
    const push = rows.filter((r) => r.d > EPS).sort((p, q) => q.d - p.d);
    const maxAbs = Math.max(1e-9, ...rows.map((r) => Math.abs(r.d)));
    const bar = (d) => el('div', { class: 'bal-bar' }, el('div', { class: d < 0 ? 'neg' : 'pos', style: { width: `${(Math.abs(d) / maxAbs) * 100}%` } }));
    const effect = (r) => {
      if (r.d < -EPS) return `zieht zu „${labels[0]}“ (spart ${fmt(-r.d)})`;
      if (r.d > EPS) return `wehrt sich (kostet dort ${fmt(r.d)} mehr)`;
      return 'gleich – entscheidet hier nicht';
    };
    const summary = total < -EPS
      ? `„${labels[0]}“ ist um ${fmt(-total)} billiger.`
      : `„${labels[0]}“ ist um ${fmt(total)} teurer${labels[0].includes('Regelbruch') ? ' – so viel Puffer haben die Strafen' : ''}.`;
    fill(balanceHost, head, el('p', { class: 'hint' }, title),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data bal-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Baustein'), el('th', { class: 'num' }, labels[0]), el('th', { class: 'num' }, labels[1]),
          el('th', { class: 'num' }, 'Unterschied'), el('th', {}, ''), el('th', {}, 'Wirkung'))),
        el('tbody', {}, rows.map((r) => el('tr', {},
          el('td', { style: { whiteSpace: 'normal', maxWidth: '320px' } }, el('b', { style: { color: termColor(r.t) } }, r.t.symbol), ` ${termShort(r.t, K())}`),
          el('td', { class: 'num' }, fmt(r.a)), el('td', { class: 'num' }, fmt(r.b)),
          el('td', { class: `num ${r.d < -EPS ? 'neg-text' : r.d > EPS ? 'pos-text' : ''}` }, r.d > 0 ? `+${fmt(r.d)}` : fmt(r.d)),
          el('td', { style: { width: '120px' } }, bar(r.d)),
          el('td', { class: 'hint', style: { whiteSpace: 'normal' } }, effect(r))))),
        el('tfoot', {}, el('tr', {}, el('th', {}, 'Summe'), el('td', { class: 'num' }, fmt(rows.reduce((s, r) => s + r.a, 0))),
          el('td', { class: 'num' }, fmt(rows.reduce((s, r) => s + r.b, 0))), el('td', { class: 'num' }, total > 0 ? `+${fmt(total)}` : fmt(total)), el('td'), el('td', {}, summary))))),
      el('p', { class: 'hint' }, pull.length || push.length
        ? `${pull.length ? `Zum „${labels[0]}“ ziehen: ${pull.map((r) => r.t.symbol).join(', ')}. ` : ''}${push.length ? `Dagegen wehren sich: ${push.map((r) => r.t.symbol).join(', ')}. ` : ''}`
          + 'Das Minimum kippt, wenn die Wehrenden mehr wiegen als die Ziehenden.'
        : 'Beide Zustände kosten in jedem Baustein gleich viel.'));
  }

  // ---------------------------------------------------------------- Gültige Pläne
  function renderValid() {
    const P = plans();
    const head = el('h4', {}, 'Was kostet jeder Baustein bei gültigen Plänen?');
    if (!P.length) { fill(validHost); return; }
    const data = st.data;
    const v = bestValid();
    const cost = costIds();
    const mism = st.planRaws.filter((raw, k) => Math.abs(wsum(raw, cost) - P[k].value) > EPS).length;
    const rank = v ? P.filter((p) => p.value < v.plan.value - EPS).length + 1 : null;
    const scope = data.plans.truncated ? `den ${nf(P.length)} besten von ${nf(data.plans.count)} gültigen Plänen` : `allen ${nf(P.length)} gültigen Plänen`;
    const verdictRow = (t) => {
      const s = st.planStats[t.id];
      if (!s) return { cls: 'hint', text: '–' };
      if (COST_TYPES.has(t.type)) return { cls: 'hint', text: 'Ziel – soll zwischen Plänen unterscheiden' };
      if (s.max - s.min < EPS) return { cls: 'ok', text: Math.abs(s.min) < EPS ? '✓ neutral: 0 bei jedem gültigen Plan' : `✓ neutral: verschiebt jeden Plan um ${fmt(s.min)}` };
      return { cls: 'no-ok', text: `✗ mischt sich ins Ziel ein: ${fmt(s.min)} bis ${fmt(s.max)} je nach Plan${s.best - s.min > EPS ? ' – der beste Plan zahlt mehr als nötig' : ''}` };
    };
    fill(validHost, head,
      el('p', { class: 'hint' }, `An ${scope}. Eine reine Strafe kostet bei jedem gültigen Plan gleich viel – sonst verschiebt sie die Rangfolge.`),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Baustein'), el('th', { class: 'num' }, 'kleinster Wert'), el('th', { class: 'num' }, 'größter Wert'),
          el('th', { class: 'num' }, 'im besten Plan'), el('th', {}, 'Urteil'))),
        el('tbody', {}, st.terms.map((t) => {
          const s = st.planStats[t.id];
          const vr = verdictRow(t);
          return el('tr', { class: st.active[t.id] ? '' : 'dim' },
            el('td', {}, el('b', { style: { color: termColor(t) } }, t.symbol), ` ${termShort(t, K())}`),
            el('td', { class: 'num' }, s ? fmt(s.min) : '–'), el('td', { class: 'num' }, s ? fmt(s.max) : '–'), el('td', { class: 'num' }, s ? fmt(s.best) : '–'),
            el('td', { class: vr.cls, style: { whiteSpace: 'normal' } }, vr.text));
        })))),
      el('ul', { class: 'diag-list', style: { marginTop: '8px' } },
        el('li', { class: `diag ${mism ? 'bad' : 'ok'}` }, el('span', { class: 'icon' }, mism ? '✗' : '✓'),
          el('div', {}, mism ? `Die Ziel-Bausteine (× Gewicht) weichen bei ${nf(mism)} von ${nf(P.length)} gültigen Plänen vom echten Ziel ab.`
            : `Die Ziel-Bausteine (× Gewicht) treffen bei allen ${nf(P.length)} gültigen Plänen genau das echte Ziel.`)),
        v ? el('li', { class: `diag ${rank === 1 ? 'ok' : 'bad'}` }, el('span', { class: 'icon' }, rank === 1 ? '✓' : '✗'),
          el('div', {}, rank === 1
            ? `Unter den gültigen Plänen ist der beste auch für deine QUBO der billigste (E = ${fmt(v.E)}).`
            : `Unter den gültigen Plänen hält deine QUBO „${st.sched.describeSeq(truth(v.x).dec.sequences)}“ für den billigsten – nach echtem Ziel erst Platz ${nf(rank)} (${fmt(v.plan.value)} statt ${fmt(P[0].value)} ${unit()}).`)) : null));
  }

  // ---------------------------------------------------------------- Jeden Baustein weglassen
  function computeLoo() {
    const data = st.data;
    return activeTerms().map((t) => {
      const active = { ...st.active, [t.id]: false };
      const m = makeTermModel(data.formulation, { weights: st.weights, active });
      const r = solve(m, 1, active);
      const tr = truth(r.min.x);
      const unique = st.model.entries.filter((e) => e.i !== e.j && e.value !== 0 && e.activeParts.every((p) => p.term === t.id)).length;
      const optimal = tr.valid && data.exact && Math.abs(tr.value - data.exact.value) < EPS;
      return { t, truth: tr, x: r.min.x, optimal, unique, heuristic: !r.exhaustive };
    });
  }
  function renderLoo() {
    const n = form().n;
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
    // Fazit im Vergleich zum jetzigen Minimum (mit allen Bausteinen)
    const now = truth(st.result.min.x);
    const issuesText = (tr) => tr.dec.issues.map((i) => i.text).join(' · ');
    const issueShort = (tr) => `${tr.dec.issues[0].text}${tr.dec.issues.length > 1 ? ` (+${tr.dec.issues.length - 1})` : ''}`;
    const verdict = (row) => {
      const r = row.truth;
      const same = r.valid === now.valid && Math.abs(r.value - now.value) < EPS && issuesText(r) === issuesText(now) && r.lies.length === now.lies.length;
      if (same) return { cls: 'hint', text: row.unique ? `hier ohne Wirkung – weglassen spart ${row.unique} Kopplungen` : 'hier ohne Wirkung' };
      if (now.valid && !r.valid) return { cls: 'no-ok', text: `nötig – ohne ihn: ${issueShort(r)}` };
      if (!now.valid && r.valid) return { cls: 'ok', text: `ohne ihn wird es zulässig${row.optimal ? ' und optimal' : ''} – dieser Baustein schadet hier` };
      if (now.valid && r.valid) {
        if (r.lies.length && !now.lies.length) return { cls: 'no-ok', text: `nötig – ohne ihn lügen ${r.lies.length} Hilfsbit(s)` };
        return r.value > now.value + EPS
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
            el('td', { style: { whiteSpace: 'normal', maxWidth: '460px' } }, row.truth.valid ? describeState(row.x)
              : `unzulässig: ${row.truth.dec.issues.slice(0, 2).map((i) => i.text).join(' · ')}${row.truth.dec.issues.length > 2 ? ' …' : ''}`),
            el('td', { class: 'num' }, nf(row.unique)),
            el('td', { class: v.cls, style: { whiteSpace: 'normal' } }, v.text));
        })))),
      el('p', { class: 'hint' }, '„Ohne Wirkung“ gilt nur für dieses Szenario und diese Gewichte. Gespart werden die Kopplungen, die nur dieser Baustein erzeugt.'));
  }

  // ---------------------------------------------------------------- Bit-Brett & Energie
  function diagPartsOf(i) {
    return st.model.entries.find((e) => e.i === i && e.j === i)?.activeParts || [];
  }
  function bitValue(i) {
    return diagPartsOf(i).filter((p) => COST_TYPES.has(p.kind)).reduce((s, p) => s + p.v * st.weights[p.term], 0);
  }
  function renderBoard() {
    const encx = st.encx;
    const after = (x) => { st.x = x; update({ keepFormula: true }); };
    renderBlockBoard(boardHost, {
      enc: encx, sched: st.sched, x: st.x, honest: st.honest,
      onToggle: (i) => {
        st.x[i] = st.x[i] ? 0 : 1;
        if (st.honest && !form().bits[i].aux) encx.honest(st.x);
        after(st.x);
      },
      onOption: (b, o) => after(encx.honest(encx.setOption(st.x, b, o))),
      onCode: (b, code) => after(encx.honest(encx.setCode(st.x, b, code))),
      onEncoding: (task, e) => {
        st.enc[String(task)] = e;
        if (!st.dirty) resetToPreset(null);
        load();
      },
      onHonest: (on) => { st.honest = on; if (on) encx.honest(st.x); after(st.x); },
      bitValue,
      bitTip: (i) => {
        const parts = diagPartsOf(i);
        const total = parts.reduce((s, p) => s + p.v * st.weights[p.term], 0);
        return tipHtml(`${encx.bitLabel(i)} – Diagonale Q = ${fmt(total)}`,
          parts.length ? parts.map((p) => `<span style="color:${termColor(termById(p.term))}">■</span> ${termById(p.term)?.symbol}: ${partText(p)}: ${fmt(p.v)} × ${nf(st.weights[p.term], 2)} = ${fmt(p.v * st.weights[p.term])}`)
            : ['kein aktiver Baustein auf der Diagonale']);
      },
    });
    const best = bestX();
    fill(quickHost,
      el('button', { class: 'btn small', type: 'button', title: 'Alle Bits 0 – was das bedeutet, hängt von der Kodierung ab', onclick: () => after(encx.honest(new Uint8Array(form().n))) }, 'Alle Bits 0'),
      el('button', { class: 'btn small', type: 'button', onclick: () => after(encx.fromOneHot(st.sched.nearest())) }, 'Jeder nimmt den nächsten'),
      el('button', { class: 'btn small', type: 'button', onclick: () => {
        const x = Uint8Array.from(form().bits, (b) => (b.aux ? 0 : Math.random() < 0.5 ? 1 : 0));
        after(st.honest ? encx.honest(x) : x);
      } }, 'Zufall'),
      el('button', { class: 'btn small', type: 'button', onclick: () => after(Uint8Array.from(st.result.min.x)) }, 'Minimum deiner QUBO'),
      el('button', { class: 'btn small primary', type: 'button', disabled: !best, onclick: () => after(bestX()) }, 'Bester gültiger Plan'));
  }

  function ruleItem(r, x, y, v) {
    const encx = st.encx;
    switch (r.kind) {
      case 'kosten': return y[r.opt] ? `#${r.task_id} auf ${encx.optLabel(r.opt)}: ${fmt(r.c)}${y[r.opt] < 0 ? ' × (δ = −1)' : ''}` : null;
      case 'vorgaenger': return Math.abs(v) > 1e-9 ? `#${r.from} direkt vor #${r.to} (R${r.robot_id}): ${fmt(v)}` : null;
      case 'gruppe': {
        const n = r.opts.reduce((s, o) => s + y[o], 0);
        const neg = r.opts.some((o) => y[o] < 0);
        return Math.abs(v) > 1e-9 ? `${r.label}: n = ${nf(n)}${neg ? ' (mit δ = −1, Paarform)' : ''} → f = ${fmt(v)}` : null;
      }
      case 'bitgruppe': return Math.abs(v) > 1e-9 ? `${r.label}: n = ${r.bits.reduce((s, i) => s + x[i], 0)} Bits → f = ${fmt(v)}` : null;
      case 'nachbar': return Math.abs(v) > 1e-9 ? `${r.label}: o₁ = ${nf(r.upper.reduce((s, o) => s + y[o], 0))}, o₂ = ${nf(r.lower.reduce((s, o) => s + y[o], 0))} → g = ${fmt(v)}` : null;
      case 'bitnachbar': return Math.abs(v) > 1e-9 ? `${r.label}: (${x[r.hi]}, ${x[r.lo]}) → g = ${fmt(v)}` : null;
      case 'ungueltig': return v ? `#${r.task_id}: Phantom-Code → 1` : null;
      default: return v ? `${encx.bitLabel(r.aux)} = ${x[r.aux]}, ${encx.bitLabel(r.pair[0])}·${encx.bitLabel(r.pair[1])} = ${x[r.pair[0]] * x[r.pair[1]]} → ${fmt(v)}` : null;
    }
  }
  function renderEnergy() {
    const x = st.x;
    const encx = st.encx;
    const y = encx.indicators(x);
    const quboRaw = encx.termRaw(x);
    const rows = [];
    let polyTotal = 0;
    for (const t of st.terms) {
      const on = st.active[t.id];
      const w = st.weights[t.id];
      const items = [];
      let raw = 0;
      for (const r of form().rules) {
        if (r.term !== t.id) continue;
        const v = encx.ruleValue(r, x, y);
        raw += v;
        const s = ruleItem(r, x, y, v);
        if (s) items.push(s);
      }
      const differs = Math.abs(raw - quboRaw[t.id]) > EPS;
      if (on) polyTotal += w * raw;
      rows.push(el('div', { class: `egroup${on ? '' : ' off'}` },
        el('div', { class: 'egroup-head' }, el('span', { class: 'swatch', style: { background: termColor(t) } }),
          el('span', {}, `${t.symbol} · ${termSentence(t, ctx())}`),
          el('strong', {}, on ? `${nf(w, 2)} × ${fmt(raw)} = ${fmt(w * raw)}` : 'aus')),
        items.length
          ? el('ul', {}, items.slice(0, 8).map((s) => el('li', {}, s)), items.length > 8 ? el('li', { class: 'hint' }, `… und ${items.length - 8} weitere`) : null)
          : el('div', { class: 'hint' }, ['gruppe', 'nachbar', 'bitgruppe', 'bitnachbar'].includes(t.type) ? 'alle Gruppen bei 0' : 'kein Beitrag'),
        differs ? el('div', { class: 'warnline' }, `In der QUBO (mit den Hilfsbits, wie sie stehen): ${fmt(quboRaw[t.id])} statt ${fmt(raw)}`) : null));
    }
    const Eq = energy(st.model, x);
    const tr = truth(x);
    const obj = objectiveEnergy(x);
    const rank = st.result.all ? rankOf(st.result, toMask(x)) : null;
    fill(energyHost,
      el('div', { class: 'etotal' },
        el('div', {}, el('div', { class: 'hint' }, 'Energie E (QUBO)'), el('div', { class: 'ebig' }, fmt(Eq))),
        el('div', { class: 'erank' }, rank ? el('div', {}, `Platz ${nf(rank)} von ${nf(st.result.total)}`) : null,
          el('div', { class: tr.valid ? 'okline' : 'warnline' }, tr.valid ? '✓ zulässig' : `✗ ${tr.dec.issues.length} Verstoß/Verstöße`))),
      ...rows,
      tr.valid
        ? el('p', { class: Math.abs(obj - tr.value) < EPS ? 'okline' : 'warnline' },
          `Ziel-Bausteine: ${fmt(obj)} – echtes Ziel (${st.data.instance.criterion.label}): ${fmt(tr.value)} ${unit()} ${Math.abs(obj - tr.value) < EPS ? '✓ identisch' : '✗ die Ziel-Bausteine messen etwas anderes'}`)
        : el('p', { class: 'hint' }, 'Unzulässiger Zustand: Hier zählt, wie teuer die Regeln ihn machen.'),
      el('p', { class: Math.abs(Eq - polyTotal) < EPS ? 'hint' : 'warnline' }, Math.abs(Eq - polyTotal) < EPS
        ? `Probe: Summe der Regeln = ${fmt(polyTotal)} = xᵀQx + Konstante ✓ identisch`
        : `Summe der Regeln (Polynom) = ${fmt(polyTotal)}, die QUBO rechnet ${fmt(Eq)}: ${tr.lies.length} Hilfsbit(s) lügen – die QUBO setzt w statt x·y ein.`));
  }

  function renderGanttCard() {
    const tr = truth(st.x);
    renderGantt(ganttHost, ganttNote, { sched: st.sched, x: st.encx.toOneHot(st.x), label: st.data.instance.criterion.label, value: tr.value, unit: unit() });
  }

  // ---------------------------------------------------------------- Hardware
  function renderHardware() {
    const f = form();
    const n = f.n;
    const offs = st.model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const coefs = st.model.entries.filter((e) => e.value !== 0).map((e) => Math.abs(e.value));
    const perEnc = f.used_encodings.map((e) => {
      const bl = st.encx.blocks.filter((b) => b.encoding === e);
      return `${ENC_LABEL[e]}: ${bl.length} Auftr. · ${bl.reduce((s, b) => s + b.nb, 0)} Bits`;
    }).join(' · ');
    fill(hardwareHost,
      el('div', { class: 'kpis', style: { marginTop: '10px' } },
        kpiSmall('Qubits', nf(n), f.aux.length ? `${f.n_task_bits} Bits + ${f.aux.length} Hilfsbits` : 'nur Bits der Aufträge'),
        kpiSmall('Kopplungen', nf(offs.length), `${nf((100 * offs.length) / Math.max(1, (n * (n - 1)) / 2), 0)} % aller Paare`),
        kpiSmall('Größter |Koeffizient|', fmt(coefs.length ? Math.max(...coefs) : 0), 'bestimmt die nötige Präzision'),
        kpiSmall('Grad vor Hilfsbits', nf(f.max_degree), f.max_degree > 2 ? 'braucht Quadratisierung' : 'schon quadratisch')),
      el('p', { class: 'hint' }, `${perEnc}. Bits je Auftrag mit m Optionen: One-Hot m, Domain Wall m − 1, Binary ⌈log₂ m⌉.`),
      el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Baustein'), el('th', { class: 'num' }, 'Diagonale'), el('th', { class: 'num' }, 'Kopplungen'),
          el('th', { class: 'num' }, 'nur von ihm'))),
        el('tbody', {}, st.terms.map((t) => {
          const r = resolved(t.id);
          const unique = offs.filter((e) => e.activeParts.length && e.activeParts.every((p) => p.term === t.id)).length;
          return el('tr', { class: st.active[t.id] ? '' : 'dim' },
            el('td', {}, el('b', { style: { color: termColor(t) } }, t.symbol), ` ${termShort(t, K())}`),
            el('td', { class: 'num' }, nf(r?.stats?.diag ?? 0)), el('td', { class: 'num' }, nf(r?.stats?.couplings ?? 0)),
            el('td', { class: 'num' }, st.active[t.id] ? nf(unique) : '–'));
        }))),
      el('p', { class: 'hint' }, 'Strukturell gezählt; eine Kopplung kann von mehreren Bausteinen stammen. „Nur von ihm“ entfällt ohne ihn.'));
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
