// Reiter „Kodierungen“ › One-Hot + Reihenfolge: Ein Roboter darf mehrere Aufträge nacheinander fahren.
// Dann hängt die Erledigungszeit eines Auftrags von seinen Vorgängern ab – die QUBO braucht
// Hilfsvariablen x_trq für den Platz q in der Reihenfolge (von hinten gezählt).
// Formulierung, exaktes Optimum und Vergleich kommen vom Server (encodings/formulations.py).
import { el, fill, nf, withTip, tipHtml, escapeHtml } from '../util.js';
import { C, TERM_COLORS } from '../theme.js';
import { createLayoutMap } from '../components/layoutMap.js';
import { autoWeights, createWeightControls, weightsFromParams } from '../components/weightControls.js';
import { initialScenario, renderScenario } from '../components/scenario.js';
import { renderSlotBoard } from '../components/slotBoard.js';
import { SEGMENTS as SEG, renderGantt as drawGantt } from '../components/gantt.js';
import { MAX_SEARCH_BITS, anneal, energy, fromMask, makeModel, rankOf, search, toMask } from '../qubo/engine.js';
import { SLOT_NAME, createSchedule } from '../qubo/schedule.js';
import { createMatrixView } from '../qubo/matrixView.js';
import { createLandscape } from '../components/landscape.js';
import { createGraphView } from '../qubo/graphView.js';

const TERMS = ['kosten', 'reihenfolge', 'zeile', 'spalte', 'luecke'];
const LABELS = {
  kosten: 'Kosten je Platz',
  reihenfolge: 'Vorgänger-Korrektur: Anfahrt vom Abgabeort des Vorgängers',
  zeile: 'Zeilenregel: jeder Auftrag genau einen Platz',
  spalte: 'Platzregel: höchstens ein Auftrag je Platz',
  luecke: 'Lückenregel: kein leerer Platz vor einem belegten',
};
const SHORT = { kosten: 'Kosten', reihenfolge: 'Vorgänger', zeile: 'Zeilenregel', spalte: 'Platzregel', luecke: 'Lückenregel' };
const WEIGHT = { zeile: 'A', spalte: 'B', luecke: 'D' };
const fmt = (v) => nf(v, 1).replace('-', '−');
const SWEEP_MAX_BITS = 16;

export function renderSequence(root, { run, api, params }) {
  const tasks = run.tasks;
  const st = {
    ...initialScenario(tasks, params),
    mode: 'kandidaten',
    slots: [1, 2, 3].includes(Number(params.plaetze)) ? Number(params.plaetze) : 2,
    criterion: params.kriterium === 'bearbeitungszeit' ? 'bearbeitungszeit' : 'erledigungszeit',
    costParams: {},
    A: 0, B: 0, D: 0,
    terms: Object.fromEntries(TERMS.map((k) => [k, true])),
    data: null,
    x: new Uint8Array(0),
    model: null,
    result: null,
    resultKey: '',
    sweep: null,
  };

  // ---------------------------------------------------------------- Gerüst
  const whyHost = el('div');
  const scenarioBody = el('div');
  const mapHost = el('div');
  const boardHost = el('div');
  const quickHost = el('div', { class: 'quick' });
  const ganttNote = el('div');
  const ganttHost = el('div', { class: 'chart' });
  const controlsHost = el('div');
  const togglesHost = el('div');
  const weightsHost = el('div');
  controlsHost.append(togglesHost, weightsHost);
  const linkedWeights = weightsFromParams(params, st, ['A', 'B', 'D']);
  let firstLoad = true;
  const weights = createWeightControls(weightsHost, { onChange: (key, value) => { st[key] = value; scheduleUpdate(); } });
  const energyHost = el('div');
  const formulaHost = el('div', { class: 'formula-body' });
  const optimumHost = el('div');
  const sweepHost = el('div');
  const hardwareHost = el('div');
  const matrixHost = el('div');
  const graphHost = el('div');
  const normHost = el('div');
  const landHost = el('div');
  const cardEl = (title, sub2, ...body) => el('section', { class: 'card' },
    el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, title), sub2 ? el('div', { class: 'card-sub', html: sub2 }) : null)),
    ...body);
  const gap = () => el('div', { style: { height: '16px' } });

  root.append(el('p', {
    class: 'intro',
    html: `Bei <a href="#/ta/alt-one-hot">One-Hot</a> fährt jeder Roboter <b>höchstens einen</b> Auftrag, hier <b>mehrere nacheinander</b>.
      Die Erledigungszeit ist dann keine feste Zahl je Auftrag und Roboter – die QUBO braucht <b>Hilfsvariablen</b> für den Platz.
      Herleitung: <code>encodings/reihenfolge/README.md</code>.`,
  }));
  root.append(cardEl('Warum reicht die Diagonale nicht mehr?', '„Roboter r fährt Auftrag t“ kostet je nach Vorgänger etwas anderes', whyHost));
  root.append(gap());
  root.append(el('div', { class: 'grid grid-2' },
    cardEl('Szenario', 'Aufträge, Plätze je Roboter, Kriterium, Annahmen', scenarioBody),
    cardEl('Lage in der Fabrik', 'Linie = Anfahrt laut Schaltern (R62·1 = erste Fahrt von R62) · Pfeil = Lastfahrt', mapHost)));
  root.append(gap());
  root.append(cardEl('Schachbrett mit Plätzen',
    'Zeile = Auftrag · Spaltengruppe = Roboter · Spalte = Platz <i>q</i> <b>von hinten</b> (q = 1: letzter Auftrag), links → rechts = Fahrreihenfolge · Klick: x 0 ↔ 1 · kleine Zahl = Kosten je Platz',
    quickHost, boardHost));
  root.append(gap());
  root.append(el('div', { class: 'grid oh-main' },
    cardEl('Ablaufplan dieser Schalterstellung', 'So fahren die Roboter – jede Erledigungszeit C ablesbar', ganttNote, ganttHost),
    cardEl('Energie dieses Zustands', 'Jeder Beitrag einzeln – gültig: Kosten + Vorgänger-Korrektur = Summe aus dem Ablaufplan', controlsHost, energyHost)));
  root.append(gap());
  root.append(el('div', { class: 'grid grid-2' },
    cardEl('QUBO-Matrix', 'Summe der Terme · Hover erklärt · umrandet = zählt jetzt', matrixHost),
    cardEl('Kopplungsgraph', 'Knoten = Qubits (Zeile = Auftrag, Spalte = Roboter·Platz), Linien = Kopplungen · dick = beide an', graphHost)));
  root.append(gap());
  root.append(el('div', { class: 'grid grid-2' },
    cardEl('Normierte QUBO-Matrix', 'Q / max|Q| · blau = Belohnung, rot = Strafe', normHost),
    cardEl('Energielandschaft', 'Zustände als Fläche · Ziehen dreht, Scrollen zoomt', landHost)));
  root.append(gap());
  root.append(cardEl('Die Formel dahinter', 'Neu gegenüber der Sofortzuweisung · Hover hebt Schalter hervor', formulaHost));
  root.append(gap());
  root.append(cardEl('Optimum und Probe', 'Findet die QUBO den besten Ablaufplan? Gegen alle Pläne aufgezählt', optimumHost, sweepHost));
  root.append(gap());
  root.append(cardEl('Was kosten die Hilfsvariablen an Hardware?', 'Qubits und Kopplungen je nach Abbildung der Reihenfolge', hardwareHost));

  const map = createLayoutMap(mapHost, { entities: run.entities, robots: run.robots, entityLabels: false });
  const landscape = createLandscape(normHost, landHost);
  let matrixView = null;
  let graphView = null;

  formulaHost.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-hl]');
    if (t) highlightBoard(JSON.parse(t.dataset.hl));
  });
  formulaHost.addEventListener('mouseout', (e) => {
    const t = e.target.closest('[data-hl]');
    if (t && !t.contains(e.relatedTarget)) highlightBoard(null);
  });

  // ---------------------------------------------------------------- Szenario
  function drawScenario(error) {
    const d = st.data;
    const crit = d ? d.catalog.criteria : [];
    const critSel = el('select', { 'aria-label': 'Kriterium' }, (crit.length ? crit : [{ key: st.criterion, label: st.criterion }])
      .map((c) => el('option', { value: c.key }, c.en ? `${c.label} · ${c.en}` : c.label)));
    critSel.value = st.criterion;
    critSel.addEventListener('change', () => { st.criterion = critSel.value; load(); });
    const slotSel = el('select', { 'aria-label': 'Plätze je Roboter' }, [1, 2, 3].map((k) => el('option', { value: k },
      k === 1 ? '1 (= Sofortzuweisung)' : `${k}`)));
    slotSel.value = String(st.slots);
    slotSel.addEventListener('change', () => { st.slots = Number(slotSel.value); load(); });

    let pending = null;
    const paramRows = d ? Object.entries(d.catalog.params).filter(([key]) => d.instance.criterion.params.includes(key)).map(([key, meta]) => {
      const input = el('input', { type: 'number', value: d.instance.params[key], min: meta.min, step: meta.step, 'aria-label': meta.label, style: { width: '80px' } });
      input.addEventListener('input', () => {
        clearTimeout(pending);
        pending = setTimeout(() => { st.costParams = { ...st.costParams, [key]: Number(input.value) }; load(); }, 350);
      });
      return el('label', { class: `param${d.instance.params[key] !== meta.default ? ' changed' : ''}` },
        el('span', { class: 'param-label' }, meta.label, el('code', {}, key)), input, el('span', { class: 'hint' }, meta.unit));
    }) : [];

    const extra = el('div', {},
      el('div', { class: 'filter-group', style: { marginTop: '10px' } },
        el('span', { class: 'filter-label' }, 'Plätze je Roboter K'), slotSel,
        el('span', { class: 'filter-label', style: { marginLeft: '10px' } }, 'Kriterium'), critSel),
      d ? el('p', { class: 'hint', html: `K begrenzt, wie viele Aufträge ein Roboter nacheinander fahren darf – und vervielfacht die Schalter:
        ${d.instance.tasks.length} Aufträge × Roboter × ${d.instance.slots} Plätze = <b>${d.formulation.n} Schalter</b>.
        ${d.instance.slots < st.slots ? `(Bei ${d.instance.tasks.length} Auftrag/Aufträgen reichen ${d.instance.slots} Plätze.)` : ''}` }) : null,
      paramRows.length ? el('div', {},
        el('div', { class: 'param-head' }, el('strong', {}, 'Annahmen'),
          el('span', { class: 'hint' }, ' – nicht in den Logs, frei einstellbar'),
          el('button', { class: 'btn small', type: 'button', style: { marginLeft: '8px' }, onclick: () => { st.costParams = {}; load(); } }, 'Standardwerte')),
        el('div', { class: 'params' }, paramRows)) : null);
    const snap = d ? d.instance.snapshot : null;
    renderScenario(scenarioBody, {
      tasks, st, load, error, extra,
      note: snap ? `Vereinfachung fürs Lernen: Alle gewählten Aufträge sehen die Flotte im Snapshot von Anfrage #${snap.transport_id} (t = ${nf(snap.time)} s) und gelten ab dann als verfügbar. Belegte Roboter (Modus „alle Roboter“) starten nach der Restzeit an ihrer aktuellen Position.` : null,
    });
  }

  // ---------------------------------------------------------------- Daten laden
  let sched = null;
  async function load() {
    drawScenario();
    try {
      st.data = await api(`/api/runs/${encodeURIComponent(run.run_id)}/reihenfolge?tasks=${st.selected.join(',')}&variables=${st.mode}`
        + `&kriterium=${st.criterion}&plaetze=${st.slots}&params=${encodeURIComponent(JSON.stringify(st.costParams))}`);
    } catch (err) {
      drawScenario(`Konnte die Formulierung nicht laden: ${err.message}`);
      return;
    }
    const d = st.data;
    // Empfohlene Gewichte übernehmen – außer per Link gesetzt oder Automatik aus
    if (!(firstLoad && linkedWeights) && autoWeights()) ({ A: st.A, B: st.B, D: st.D } = d.weights);
    firstLoad = false;
    sched = createSchedule(d.instance);
    const n = d.formulation.n;
    st.x = new Uint8Array(n);
    if (d.exact?.bits) d.exact.bits.forEach((i) => { st.x[i] = 1; }); // mit dem besten Ablaufplan starten
    st.resultKey = '';
    st.sweep = null;
    matrixView = createMatrixView(matrixHost, { labels: vars().map((v, i) => varLabel(i)), varName: varLabel, describePart, onCellClick: flashVars });
    const cols = slotColumns();
    graphView = createGraphView(graphHost, {
      variables: vars().map((v) => ({ ...v, row: v.task_id, col: `${v.robot_id}|${v.slot}` })),
      rowKeys: d.instance.tasks.map((t) => t.transport_id), colKeys: cols.map((c) => `${c.robot}|${c.slot}`),
      rowLabel: (t) => `#${t}`, colLabel: (k) => { const [r, q] = k.split('|'); return `R${r}·${q}`; }, varName: varLabel,
    });
    drawScenario();
    update();
    // Schwellen per Link: #/ta/reihenfolge?schwellen=1 (nur beim ersten Laden)
    if (params.schwellen && !st.sweepLinked && n <= SWEEP_MAX_BITS) {
      st.sweepLinked = true;
      st.sweep = computeSweeps();
      renderSweepHost(n);
    }
  }

  // ---------------------------------------------------------------- Hilfen
  const vars = () => st.data.instance.variables;
  const crit = () => st.data.instance.criterion;
  const weighted = () => crit().position_weight;
  const taskOf = (id) => sched.taskOf(id);
  const robotOf = (id) => sched.robotOf(id);
  const usedRobots = () => sched.usedRobots();
  const slotColumns = () => sched.slotColumns();
  const s0 = (r, t) => sched.s0(r, t);
  const sb = (i, j) => sched.sb(i, j);
  const wq = (q) => (weighted() ? q : 1);
  const varLabel = (i) => sched.varLabel(i);
  const xv = (v) => `<i>x</i><sub>${v.task_id},${v.robot_id},${v.slot}</sub>`;

  function describePart(p) {
    if (p.kind === 'kosten') {
      const v = vars().find((w) => w.task_id === p.task_id && w.robot_id === p.robot_id && w.slot === p.slot);
      return `Kosten: #${p.task_id} auf R${p.robot_id}, Platz ${p.slot} → ${costText(v)} = ${fmt(p.c)} s`;
    }
    if (p.kind === 'reihenfolge') return `Vorgänger-Korrektur: #${p.from} direkt vor #${p.to} auf R${p.robot_id} → ${fmt(p.c)} s`;
    if (p.kind === 'zeile') return p.A < 0 ? `Zeilenregel #${p.task_id}: Belohnung −A = ${fmt(-st.A)}` : `Zeilenregel #${p.task_id}: zwei Plätze für einen Auftrag +2A = ${fmt(2 * st.A)}`;
    if (p.kind === 'spalte') return `Platzregel R${p.robot_id}, Platz ${p.slot}: zwei Aufträge auf einem Platz +B = ${fmt(st.B)}`;
    return p.D > 0
      ? `Lückenregel R${p.robot_id}: Platz ${p.slot + 1} belegt → +D = ${fmt(st.D)} (zurück, wenn Platz ${p.slot} belegt)`
      : `Lückenregel R${p.robot_id}: Platz ${p.slot + 1} und ${p.slot} belegt → −D = ${fmt(-st.D)}`;
  }
  function costText(v) {
    return v.parts.filter((p) => p.base !== 0 || p.weight > 1)
      .map((p) => (p.weight > 1 ? `${p.weight}·${fmt(p.base)}` : fmt(p.base))).join(' + ');
  }

  const decode = (x) => sched.decode(x);
  const simulate = (sequences) => sched.simulate(sequences);
  const describeSeq = (sequences) => sched.describeSeq(sequences);
  const seqMap = (obj) => sched.seqMap(obj);
  const bitsToX = (bits) => sched.bitsToX(bits);

  /** Energiebeiträge je Regel – direkt aus den Regeln wie energy_rules in Python. */
  function contributions(x) {
    const out = Object.fromEntries(TERMS.map((k) => [k, []]));
    for (const r of st.data.formulation.rules) {
      if (r.kind === 'kosten') {
        if (x[r.vars[0]]) out.kosten.push({ r, v: r.c });
      } else if (r.kind === 'reihenfolge') {
        if (x[r.vars[0]] && x[r.vars[1]]) out.reihenfolge.push({ r, v: r.c });
      } else if (r.kind === 'zeile') {
        const on = r.vars.filter((i) => x[i]).length;
        out.zeile.push({ r, on, v: st.A * (1 - on) ** 2 });
      } else if (r.kind === 'spalte') {
        const on = r.vars.filter((i) => x[i]).length;
        if (on) out.spalte.push({ r, on, v: (st.B * on * (on - 1)) / 2 });
      } else {
        const up = r.upper.filter((i) => x[i]).length;
        const low = r.lower.filter((i) => x[i]).length;
        if (up) out.luecke.push({ r, up, low, v: st.D * up * (1 - low) });
      }
    }
    return out;
  }

  /** Bei K = 1 gibt es keine Reihenfolge, Platz- und Lückenregel (Doppelbelegung zulässig). */
  const shownTerms = () => (st.data.instance.slots >= 2 ? TERMS : TERMS.filter((k) => !['reihenfolge', 'spalte', 'luecke'].includes(k)));

  // ---------------------------------------------------------------- Rechnen
  function compute() {
    const form = st.data.formulation;
    st.model = makeModel(form, { A: st.A, B: st.B, D: st.D, terms: st.terms });
    const key = `${st.A}|${st.B}|${st.D}|${TERMS.map((k) => (st.terms[k] ? 1 : 0)).join('')}|${form.n}|${st.selected}|${st.mode}|${st.slots}|${st.criterion}|${JSON.stringify(st.costParams)}`;
    if (key === st.resultKey) return;
    st.resultKey = key;
    st.sweep = null; // Schwellen gelten nur für die Gewichte, mit denen sie berechnet wurden
    if (form.n <= MAX_SEARCH_BITS) {
      const r = search(st.model, 10);
      st.result = { exhaustive: true, min: { E: r.min.E, x: fromMask(r.min.mask, form.n) },
        top: r.top.map((t) => ({ E: t.E, x: fromMask(t.mask, form.n) })), all: r.all, total: r.total };
    } else {
      // Heuristik mit Tausch-Zügen in den Zeilen; zum Vergleich reines Einzelbit-Kippen
      const opts = { restarts: 60, sweeps: 600, seed: 7, T0: Math.max(1, st.A), T1: 0.5 };
      const groups = form.rules.filter((r) => r.kind === 'zeile').map((r) => r.vars);
      const r = anneal(st.model, { ...opts, groups });
      const plain = anneal(st.model, opts);
      st.result = { exhaustive: false, min: r.min, top: r.top, all: null, total: 2 ** form.n, restarts: r.restarts, plain: plain.min };
    }
  }

  // ---------------------------------------------------------------- Zeichnen
  function update() {
    if (!st.data) return;
    compute();
    renderWhy();
    renderMap();
    renderBoard();
    renderGantt();
    renderControls();
    renderEnergy();
    renderFormula();
    renderOptimum();
    renderHardware();
    matrixView.update(st.model, st.x);
    graphView.update(st.model, st.x);
    landscape.update({ model: st.model, labels: vars().map((v, i) => varLabel(i)), x: st.x, minX: st.result.min.x,
      isValid: (x) => decode(x).valid, cacheKey: st.result });
  }

  // ---------------------------------------------------------------- ① Warum
  function renderWhy() {
    const d = st.data.instance;
    // Beispiel: zwei Aufträge auf einem Roboter, der für beide in Frage kommt
    let ex = null;
    for (const r of usedRobots()) {
      const mine = d.tasks.filter((t) => vars().some((v) => v.robot_id === r.robot_id && v.task_id === t.transport_id));
      if (mine.length >= 2) { ex = { r: r.robot_id, a: mine[0].transport_id, b: mine[1].transport_id }; break; }
    }
    if (!ex) {
      fill(whyHost, el('p', {}, 'Das Beispiel braucht zwei Aufträge, die derselbe Roboter fahren kann – mindestens zwei wählen.'));
      return;
    }
    const { r, a, b } = ex;
    const ta = taskOf(a);
    const tb = taskOf(b);
    const rel = weighted() ? robotOf(r).release : 0;
    const alone = { setup: s0(r, b).time, p: tb.p };
    const Calone = rel + alone.setup + alone.p;
    const Ca = rel + s0(r, a).time + ta.p;
    const after = sb(a, b).time;
    const Cafter = Ca + after + tb.p;
    const max = Cafter;
    const p = d.params;
    const segs = (release, setup, task, from) => [
      release > 0 ? { color: SEG[0].color, v: release, label: '', title: 'Warten, bis der Roboter frei ist' } : null,
      { color: SEG[1].color, v: setup, label: '', title: `Anfahrt ${from}` },
      { color: SEG[2].color, v: p.t_lade, label: '', title: `Beladen #${task.transport_id}` },
      { color: SEG[3].color, v: task.t_last, label: `#${task.transport_id}`, title: `Lastfahrt #${task.transport_id}` },
      { color: SEG[4].color, v: p.t_ent, label: '', title: `Entladen #${task.transport_id}` },
    ].filter(Boolean);
    // Zeitbalken im gemeinsamen Maßstab: Breite ∝ Dauer, damit beide Fälle vergleichbar sind
    const tbarWrap = (parts) => {
      const total = parts.reduce((x, s) => x + s.v, 0);
      return el('div', { style: { width: `${(100 * total) / max}%` } },
        el('div', { class: 'tbar' }, parts.map((s) => withTip(el('div', { style: { flex: `${s.v} 0 0`, background: s.color } }, s.label),
          tipHtml(s.title, [`${fmt(s.v)} s`])))),
        el('div', { class: 'tbar-axis' }, el('span', {}, '0 s'), el('span', {}, `${fmt(total)} s`)));
    };
    const what = weighted() ? 'Erledigungszeit' : 'Arbeitszeit';
    fill(whyHost, el('div', { class: 'why-grid' },
      el('div', { class: 'why-step' },
        el('h4', {}, '① Sofortzuweisung: eine feste Zahl'),
        el('p', { html: `R${r} fährt nur #${b}: Anfahrt ${fmt(alone.setup)} s + Beladen, Lastfahrt, Entladen ${fmt(alone.p)} s →
          ${weighted() ? `<b>C<sub>${b}</sub> = ${fmt(Calone)} s</b>` : `Arbeitszeit <b>${fmt(alone.setup + alone.p)} s</b>`}, fest zum Schalter <i>x</i><sub>${b},${r}</sub>: <b>Diagonale</b>.` }),
        tbarWrap(segs(rel, alone.setup, tb, 'vom Standort'))),
      el('div', { class: 'why-step', style: { borderLeftColor: TERM_COLORS.reihenfolge } },
        el('h4', {}, '② Mit Reihenfolge: hängt vom Vorgänger ab'),
        el('p', { html: weighted()
          ? `Fährt R${r} vorher #${a}, wartet #${b} bis ${fmt(Ca)} s, die Anfahrt startet am Abgabeort von #${a} (${fmt(after)} statt ${fmt(alone.setup)} s):
            <b>C<sub>${b}</sub> = ${fmt(Cafter)} s</b> statt ${fmt(Calone)} s – „R${r} fährt #${b}“ hat <b>keine feste ${what}</b> mehr.`
          : `Fährt R${r} vorher #${a}, startet die Anfahrt zu #${b} am Abgabeort von #${a}: <b>${fmt(after)} statt ${fmt(alone.setup)} s</b> – die ${what} hängt vom Vorgänger ab.` }),
        tbarWrap([...segs(rel, s0(r, a).time, ta, 'vom Standort'), ...segs(0, after, tb, `vom Abgabeort von #${a}`)])),
      el('div', { class: 'why-step', style: { borderLeftColor: TERM_COLORS.luecke } },
        el('h4', {}, '③ Der Trick: Hilfsvariablen für den Platz'),
        el('p', { html: `<i>x</i><sub>t,r,q</sub> = „<i>r</i> fährt <i>t</i> als <i>q</i>-letzten“.
          ${weighted() ? `<b>Von hinten</b> gezählt ist der Beitrag fest: <b>q · (Anfahrt + Bearbeitung)</b> – Platz q verzögert sich und die q − 1 danach.` : 'Jeder Platz zählt seine Fahrt einmal.'}
          Nur die Anfahrt hängt am <b>direkten Vorgänger</b>: eine Kopplung Platz q + 1 ↔ q. Alles bleibt quadratisch, kostet aber
          <b>${d.slots}× so viele Qubits</b> (${st.data.formulation.n} statt ${st.data.estimates[0].qubits}).` }))));
  }

  function renderMap() {
    const d = st.data.instance;
    map.setRobots(d.robots.map((r) => ({ ...r, dim: !vars().some((v) => v.robot_id === r.robot_id) })));
    map.setHalos(d.tasks.map((t) => ({ ...t.pickup, color: C.accent })));
    map.setLabels(d.tasks.map((t) => ({ ...t.pickup, text: `#${t.transport_id}`, color: C.accent })));
    map.setArrows(d.tasks.map((t) => ({ from: t.pickup, to: t.drop, color: C.accent, width: 1.6, opacity: 0.6,
      tip: tipHtml(`Auftrag #${t.transport_id}`, [`${escapeHtml(t.from_entity)} → ${escapeHtml(t.to_entity)}`]) })));
    const lines = [];
    for (const [r, seq] of decode(st.x).sequences) {
      let from = { x: robotOf(r).x, y: robotOf(r).y };
      seq.forEach((tid, k) => {
        const t = taskOf(tid);
        lines.push({ from, to: t.pickup, label: `R${r}·${k + 1}`, color: C.ink, opacity: 1 });
        from = t.drop;
      });
    }
    map.setLines(lines);
  }

  // ---------------------------------------------------------------- Schachbrett
  function renderBoard() {
    renderSlotBoard(boardHost, {
      sched, x: st.x,
      onToggle: (i) => { st.x[i] = st.x[i] ? 0 : 1; update(); },
      cellValue: (i) => vars()[i].cost,
      cellTip: (i) => {
        const v = vars()[i];
        return tipHtml(`${varLabel(i)}: R${v.robot_id} fährt #${v.task_id} als ${SLOT_NAME[v.slot] || `${v.slot}.-letzten`}`,
          v.parts.map((p) => `${escapeHtml(p.name)}: ${p.weight > 1 ? `${p.weight} × ${fmt(p.base)} = ` : ''}${fmt(p.value)} s`)
            .concat([`<b>Kosten je Platz: ${fmt(v.cost)} s</b>`]));
      },
    });
    fill(quickHost,
      el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = new Uint8Array(vars().length); update(); } }, 'Alle aus'),
      el('button', { class: 'btn small', type: 'button', title: 'Jeder Auftrag nimmt den nächsten Roboter – auch wenn der dann mehrere fahren muss', onclick: () => { st.x = sched.nearest(); update(); } }, 'Jeder nimmt den nächsten'),
      el('button', { class: 'btn small primary', type: 'button', disabled: !st.data.exact?.bits, title: 'Den besten Ablaufplan laden (Aufzählen aller Pläne)',
        onclick: () => { st.x = bitsToX(st.data.exact.bits); update(); } }, 'Bester Ablaufplan'),
      el('a', { class: 'btn small', href: `#/ta/baukasten?auftraege=${st.selected.join(',')}&plaetze=${st.slots}&kriterium=${st.criterion}`,
        title: 'Dieselben Aufträge im Formel-Baukasten: Bausteine verändern, weglassen, falsch machen' }, 'Formel verändern → Baukasten'));
  }

  // ---------------------------------------------------------------- Ablaufplan
  function renderGantt() {
    const dec = decode(st.x);
    drawGantt(ganttHost, ganttNote, { sched, x: st.x, label: weighted() ? 'Summe der Erledigungszeiten Σ C' : 'Summe der Arbeitszeiten',
      value: simulate(dec.sequences).total });
  }

  // ---------------------------------------------------------------- Energie
  function renderControls() {
    const toggles = el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Terme'),
      shownTerms().map((k) => {
        const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(Boolean(st.terms[k])), title: LABELS[k] },
          el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }), SHORT[k]);
        b.addEventListener('click', () => { st.terms[k] = !st.terms[k]; update(); });
        return b;
      }));
    fill(togglesHost, toggles);
    const w = st.data.weights;
    const multi = st.data.instance.slots >= 2; // K = 1: keine Platz- und Lückenregel (Doppelbelegung zulässig)
    weights.render({
      items: [
        { key: 'A', label: 'A · Zeilenregel', color: TERM_COLORS.zeile, value: st.A, recommended: w.A, hint: '> größter möglicher Zuwachs' },
        multi ? { key: 'B', label: 'B · Platzregel', color: TERM_COLORS.spalte, value: st.B, recommended: w.B, hint: '= 2·A (überstimmt die Lückenregel)' } : null,
        multi ? { key: 'D', label: 'D · Lückenregel', color: TERM_COLORS.luecke, value: st.D, recommended: w.D, hint: '> größter möglicher Zuwachs' } : null,
      ].filter(Boolean),
      note: multi ? `Empfehlung: A = D ≥ 1,1 × größter möglicher Zuwachs (${nf(w.U)} s), B = 2·A.` : `Empfehlung: A ≥ 1,1 × größter möglicher Zuwachs (${nf(w.U)} s).`,
    });
  }
  let pending = null;
  function scheduleUpdate() {
    clearTimeout(pending);
    pending = setTimeout(update, 80);
  }

  function renderEnergy() {
    const c = contributions(st.x);
    const items = {
      kosten: c.kosten.map(({ r, v }) => {
        const vv = vars()[r.vars[0]];
        return { v, text: `#${r.task_id} auf R${r.robot_id}, Platz ${r.slot}: ${costText(vv)} = ${fmt(v)}` };
      }),
      reihenfolge: c.reihenfolge.map(({ r, v }) => ({ v, text: `#${r.from} direkt vor #${r.to} (R${r.robot_id}): ${r.weight > 1 ? `${r.weight}·` : ''}(${fmt(r.s)} − ${fmt(r.s0)}) = ${fmt(v)} · Anfahrt vom Abgabeort statt vom Standort` })),
      zeile: c.zeile.map(({ r, on, v }) => ({ v, ok: on === 1, text: `#${r.task_id}: ${on} Platz/Plätze an → A·(1−${on})² = ${fmt(v)}` })),
      spalte: c.spalte.map(({ r, on, v }) => ({ v, ok: on <= 1, text: `R${r.robot_id} Platz ${r.slot}: ${on} Auftr${on === 1 ? 'ag' : 'äge'} → ${fmt(v)}` })),
      luecke: c.luecke.map(({ r, up, low, v }) => ({ v, ok: v <= 0, text: `R${r.robot_id}: Platz ${r.slot + 1} belegt (${up}), Platz ${r.slot} ${low ? `belegt (${low})` : 'leer'} → D·${up}·(1−${low}) = ${fmt(v)}` })),
    };
    const sums = Object.fromEntries(TERMS.map((k) => [k, st.terms[k] ? items[k].reduce((s, p) => s + p.v, 0) : 0]));
    const E = TERMS.reduce((s, k) => s + sums[k], 0);
    const Eq = energy(st.model, st.x);
    const dec = decode(st.x);
    const sim = simulate(dec.sequences);
    const objective = (st.terms.kosten ? sums.kosten : 0) + (st.terms.reihenfolge ? sums.reihenfolge : 0);
    const rank = st.result?.all ? rankOf(st.result, toMask(st.x)) : null;
    const bar = el('div', { class: 'ebar' }, TERMS.filter((k) => sums[k] > 0).map((k) => withTip(
      el('div', { style: { flex: `${sums[k]} 0 0`, background: TERM_COLORS[k] } }), tipHtml(LABELS[k], [fmt(sums[k])]))));
    const group = (k) => el('div', { class: `egroup${st.terms[k] ? '' : ' off'}` },
      el('div', { class: 'egroup-head' }, el('span', { class: 'swatch', style: { background: TERM_COLORS[k] } }),
        el('span', {}, LABELS[k]), el('strong', {}, st.terms[k] ? fmt(sums[k]) : 'aus')),
      items[k].length
        ? el('ul', {}, items[k].map((p) => el('li', { class: p.ok === false ? 'bad' : p.ok ? 'good' : '' }, p.text)))
        : el('div', { class: 'hint' }, { kosten: 'kein Schalter an', reihenfolge: 'kein Auftrag hat einen Vorgänger', zeile: '–', spalte: 'kein Platz belegt', luecke: 'kein Platz über 1 belegt' }[k]));
    fill(energyHost,
      el('div', { class: 'etotal' },
        el('div', {}, el('div', { class: 'hint' }, 'Energie E'), el('div', { class: 'ebig' }, fmt(E))),
        el('div', { class: 'erank' },
          rank ? el('div', {}, `Platz ${nf(rank)} von ${nf(st.result.total)}`) : null,
          el('div', { class: dec.valid ? 'okline' : 'warnline' }, dec.valid ? '✓ gültig' : `✗ ${dec.issues.length} Regelverstoß/-verstöße`))),
      bar,
      ...shownTerms().map(group),
      dec.valid && st.terms.kosten && st.terms.reihenfolge
        ? el('p', { class: Math.abs(objective - sim.total) < 1e-6 ? 'okline' : 'warnline' },
          `Probe: Kosten + Vorgänger-Korrektur = ${fmt(objective)} s – Ablaufplan: ${fmt(sim.total)} s ${Math.abs(objective - sim.total) < 1e-6 ? '✓ identisch' : '✗ Abweichung'}`)
        : el('p', { class: 'hint' }, dec.valid ? 'Für die Probe gegen den Ablaufplan Kosten und Vorgänger-Korrektur einschalten.' : 'Bei ungültigen Zuständen haben die Kosten keine Bedeutung als Fahrplan – die Strafen sorgen dafür, dass sie nie gewinnen.'),
      el('p', { class: 'hint' }, `Probe über die Matrix: xᵀQx + Konstante = ${fmt(Eq)} ${Math.abs(Eq - E) < 1e-6 ? '✓ identisch' : '✗ ABWEICHUNG'}`));
  }

  // ---------------------------------------------------------------- Formel
  function renderFormula() {
    const d = st.data.instance;
    const w = weighted();
    const q = w ? '<i>q</i>' : '';
    const qdot = w ? '<i>q</i>·' : '';
    const hl = (o) => `data-hl='${JSON.stringify(o)}'`;
    const line = (kind, lhs, term, note) => `<div class="fx-line t-${kind}${st.terms[kind] ? '' : ' off'}" ${hl({ kind })}>
      <span class="fx-lhs">${lhs}</span><span class="fx-term">${term}</span><span class="fx-note">${note}</span></div>`;

    // Beispiel für die Herleitung: längste Reihenfolge im aktuellen Zustand, sonst im besten Plan, sonst zwei Aufträge auf einem Roboter
    const dec = decode(st.x);
    let exR = null;
    let exSeq = null;
    const pick = (seqs) => {
      for (const [r, s] of seqs) if (s.length >= 2 && (!exSeq || s.length > exSeq.length)) { exR = r; exSeq = s; }
    };
    if (dec.valid) pick(dec.sequences);
    if (!exSeq) pick(seqMap(st.data.exact?.sequences));
    if (!exSeq && d.slots >= 2) {
      for (const r of usedRobots()) {
        const mine = d.tasks.filter((t) => vars().some((v) => v.robot_id === r.robot_id && v.task_id === t.transport_id)).map((t) => t.transport_id);
        if (mine.length >= 2) { exR = r.robot_id; exSeq = mine.slice(0, d.slots); break; }
      }
    }
    let example = '';
    let corr = d.slots < 2 ? '<p class="hint">K = 1: keine Vorgänger-Korrektur, keine Platz- und Lückenregel – die Sofortzuweisung. Doppelbelegung ist zulässig; die QUBO zählt den zweiten Auftrag dann, als startete er sofort.</p>' : '';
    if (exSeq) {
      const sim = simulate(new Map([[exR, exSeq]]));
      const rows = sim.rows;
      const n = rows.length;
      const rel = w ? robotOf(exR).release : 0;
      const relTxt = rel > 0 ? `${fmt(rel)} + ` : '';
      const cLines = rows.map((row, k) => `C<sub>${row.task}</sub> = ${k === 0 ? relTxt : `C<sub>${rows[k - 1].task}</sub> + `}${fmt(row.setup.time)} + ${fmt(taskOf(row.task).p)} = ${fmt(row.finish)}`);
      const posTerms = rows.map((row, k) => `${w ? `${n - k}·` : ''}(${fmt(row.setup.time)} + ${fmt(taskOf(row.task).p)})`);
      example = `<h4>Am Beispiel: R${exR} fährt ${exSeq.map((t) => `#${t}`).join(' → ')}</h4>
        <div class="fx-derivation t-kosten" ${hl({ robot: exR })}>
          ${w ? `<div>${cLines.join(' &nbsp;·&nbsp; ')}</div>
          <div><span class="eq">⇒</span> Σ C = ${rows.map((r) => fmt(r.finish)).join(' + ')} = <b>${fmt(sim.completion)}</b> s</div>
          <div><span class="eq">=</span> ${rel > 0 ? `${n}·${fmt(rel)} + ` : ''}${posTerms.join(' + ')} = <b>${fmt(sim.completion)}</b> s &nbsp;✓</div>
          <div class="why">Gleiche Zahl, jeder Summand fest an einen Schalter: ${rows.map((row, k) => `${xv({ task_id: row.task, robot_id: exR, slot: n - k })} trägt ${n - k}·(Anfahrt + Bearbeitung)`).join(', ')}.</div>`
    : `<div>Arbeitszeit = ${rows.map((row) => `(${fmt(row.setup.time)} + ${fmt(taskOf(row.task).p)})`).join(' + ')} = <b>${fmt(sim.busy)}</b> s</div>
          <div class="why">Jede Fahrt zählt einmal – nur die Anfahrten hängen von der Reihenfolge ab.</div>`}
        </div>`;
      const [a, b] = exSeq;
      const qB = w ? n - 1 : 1;
      const qq = n - 1;
      const sab = sb(a, b).time;
      const s0b = s0(exR, b).time;
      corr = `<div class="fx-derivation t-reihenfolge" ${hl({ robot: exR })}>
          <div>Anfahrt zu #${b} auf Platz ${qq}: ${qdot}<i>s</i><sub>→${b}</sub> = ${qdot}<i>s</i>⁰<sub>${exR},${b}</sub> + ${qdot}(<i>s</i><sub>${a},${b}</sub> − <i>s</i>⁰<sub>${exR},${b}</sub>)·${xv({ task_id: a, robot_id: exR, slot: qq + 1 })}</div>
          <div><span class="eq">=</span> ${w ? `${qB}·` : ''}${fmt(s0b)} &nbsp;+&nbsp; ${w ? `${qB}·` : ''}(${fmt(sab)} − ${fmt(s0b)})·${xv({ task_id: a, robot_id: exR, slot: qq + 1 })}
            = ${fmt(qB * s0b)} ${qB * (sab - s0b) < 0 ? '−' : '+'} ${fmt(Math.abs(qB * (sab - s0b)))}·${xv({ task_id: a, robot_id: exR, slot: qq + 1 })}</div>
          <div class="why"><span class="p-lin">Teil 1: schon in den Kosten je Platz (Diagonale).</span>
            <span class="p-pair">Teil 2: nur wenn #${a} direkt davor liegt – Kopplung Platz ${qq + 1} ↔ ${qq}.</span>
            ${sab < s0b ? `Negativ: vom Abgabeort von #${a} ist es näher – die Kopplung <b>lockt</b> #${a} vor #${b}.` : `Positiv: vom Abgabeort von #${a} ist es weiter als vom Standort.`}</div>
        </div>`;
    }

    formulaHost.innerHTML = `
      <p class="fx-intro">Neu gegenüber der Sofortzuweisung: Platz-Index <i>q</i>, <span style="color:${TERM_COLORS.reihenfolge}">Vorgänger-Korrektur</span>
        und <span style="color:${TERM_COLORS.luecke}">Lückenregel</span>.
        ${w ? '' : 'Bei der Summe der Arbeitszeiten zählt jeder Platz einfach – Platz-Variablen braucht es trotzdem, weil die Anfahrt vom Vorgänger abhängt.'}</p>
      <div class="fx">
        ${line('kosten', '<i>E</i>(<i>x</i>) =', `Σ<sub><i>t,r,q</i></sub> [ ${w ? 'ρ<sub><i>r</i></sub> + ' : ''}${qdot}(<i>s</i>⁰<sub><i>r,t</i></sub> + <i>p<sub>t</sub></i>) ] · <i>x</i><sub><i>t,r,q</i></sub>`,
    `<b>Kosten je Platz:</b> ${w ? 'Platz q (von hinten) verzögert sich und die q − 1 danach – Anfahrt s⁰ und Bearbeitung p zählen q-mal; ρ = Wartezeit, bis ein belegter Roboter frei ist.' : 'Anfahrt vom Standort und Bearbeitung zählen einmal.'}`)}
        ${line('reihenfolge', '+', `Σ<sub><i>r,q</i></sub> Σ<sub><i>t</i>≠<i>t</i>′</sub> ${qdot}(<i>s</i><sub><i>t,t</i>′</sub> − <i>s</i>⁰<sub><i>r,t</i>′</sub>) · <i>x</i><sub><i>t,r,q</i>+1</sub> <i>x</i><sub><i>t</i>′<i>,r,q</i></sub>`,
    '<b>Vorgänger-Korrektur:</b> liegt t direkt vor t′, startet die Anfahrt zu t′ am Abgabeort von t (s<sub>t,t′</sub> statt s⁰) – Kopplung benachbarter Plätze.')}
        ${line('zeile', '+', '<i>A</i> · Σ<sub><i>t</i></sub> ( 1 − Σ<sub><i>r,q</i></sub> <i>x</i><sub><i>t,r,q</i></sub> )²',
    '<b>Zeilenregel:</b> je Auftrag genau ein Platz bei genau einem Roboter.')}
        ${line('spalte', '+', '<i>B</i> · Σ<sub><i>r,q</i></sub> Σ<sub><i>t</i>&lt;<i>t</i>′</sub> <i>x</i><sub><i>t,r,q</i></sub> <i>x</i><sub><i>t</i>′<i>,r,q</i></sub>',
    '<b>Platzregel:</b> höchstens ein Auftrag je Roboter-Platz – verbietet keine Doppelbelegung (die liegt auf verschiedenen Plätzen); entfällt bei K = 1.')}
        ${line('luecke', '+', '<i>D</i> · Σ<sub><i>r,q</i></sub> <i>o</i><sub><i>r,q</i>+1</sub> ( 1 − <i>o</i><sub><i>r,q</i></sub> ), &nbsp;<i>o</i><sub><i>r,q</i></sub> = Σ<sub><i>t</i></sub> <i>x</i><sub><i>t,r,q</i></sub>',
    '<b>Lückenregel:</b> Platz q + 1 nur, wenn q belegt – sonst führe der Auftrag auf q + 1 als „erster“ vom Standort los (Schein-Plan).')}
      </div>
      <h4>Woher kommt ${w ? 'das Gewicht q' : 'die Reihenfolge'}?</h4>
      <div class="fx-derivation t-kosten">
        <div>Roboter <i>r</i> fährt π<sub>1</sub>, π<sub>2</sub>, …, π<sub><i>n</i></sub>. Erledigungszeit des <i>k</i>-ten:
          C<sub>π<sub><i>k</i></sub></sub> = ρ<sub><i>r</i></sub> + Σ<sub><i>l</i> ≤ <i>k</i></sub> ( <i>s</i><sub>π<sub><i>l</i>−1</sub> π<sub><i>l</i></sub></sub> + <i>p</i><sub>π<sub><i>l</i></sub></sub> )</div>
        ${w ? `<div><span class="eq">⇒</span> Σ<sub><i>k</i></sub> C<sub>π<sub><i>k</i></sub></sub> = <i>n</i>·ρ<sub><i>r</i></sub> + Σ<sub><i>l</i></sub> (<i>n</i> − <i>l</i> + 1) · ( <i>s</i> + <i>p</i> )</div>
        <div class="why">Jede Fahrt zählt so oft, wie ab ihr noch Aufträge warten. Mit <i>q</i> = <i>n</i> − <i>l</i> + 1 <b>von hinten</b> ist das eine feste Zahl je Schalter –
          von vorne hinge es von <i>n</i> ab, also von allen anderen Schaltern (kubische Terme).</div>`
    : '<div class="why">Summe der Arbeitszeiten: jede Fahrt einmal; nur die Anfahrt s hängt vom Vorgänger ab.</div>'}
      </div>
      ${example}
      <h4>Woher kommt die Vorgänger-Korrektur?</h4>
      ${corr || '<p class="hint">Das Zahlenbeispiel braucht zwei Aufträge auf einem Roboter.</p>'}
      <h4>Wohin wandert jeder Teil?</h4>
      <table class="data fx-table">
        <thead><tr><th>Herkunft</th><th>Formelteil</th><th>landet in</th><th class="num">Wert hier</th></tr></thead>
        <tbody>
          <tr class="t-row t-kosten" ${hl({ kind: 'kosten' })}><td>Kosten je Platz</td><td>${w ? 'ρ + ' : ''}${q ? `${q}·` : ''}(s⁰ + p) · <i>x<sub>t,r,q</sub></i></td><td>Diagonale</td><td class="num">${rangeOf('kosten')}</td></tr>
          <tr class="t-row t-reihenfolge" ${hl({ kind: 'reihenfolge' })}><td>Vorgänger-Korrektur</td><td>${qdot}(s − s⁰) · <i>x<sub>t,r,q+1</sub>x<sub>t′,r,q</sub></i></td><td>Kopplung <b>benachbarter Plätze</b>, selber Roboter</td><td class="num">${rangeOf('reihenfolge')}</td></tr>
          <tr class="t-row t-zeile" ${hl({ kind: 'zeile' })}><td>Zeilenregel</td><td>− <i>A</i>·<i>x</i> &nbsp; + 2<i>A</i>·<i>x x′</i> &nbsp; + <i>A</i></td><td>Diagonale · Kopplung im <b>selben Auftrag</b> (alle Roboter und Plätze) · Konstante</td><td class="num">${fmt(-st.A)} · ${fmt(2 * st.A)} · ${fmt(st.A)}</td></tr>
          <tr class="t-row t-spalte" ${hl({ kind: 'spalte' })}><td>Platzregel</td><td>+ <i>B</i>·<i>x x′</i></td><td>Kopplung im <b>selben Platz</b></td><td class="num">${fmt(st.B)}</td></tr>
          <tr class="t-row t-luecke" ${hl({ kind: 'luecke' })}><td>Lückenregel</td><td>+ <i>D</i>·<i>x</i><sub>q+1</sub> &nbsp; − <i>D</i>·<i>x</i><sub>q+1</sub><i>x</i><sub>q</sub></td><td>Diagonale (Platz q + 1) · Kopplung <b>benachbarter Plätze</b></td><td class="num">${fmt(st.D)} · ${fmt(-st.D)}</td></tr>
        </tbody>
      </table>
      <p class="hint">B > D, weil die Lückenregel bei zwei Aufträgen auf Platz q negativ wird (1 − 2 = −1). Standard: B = 2·A, A = D.</p>`;
  }
  function rangeOf(kind) {
    const vals = st.data.formulation.rules.filter((r) => r.kind === kind).map((r) => r.c);
    return vals.length ? `${fmt(Math.min(...vals))} … ${fmt(Math.max(...vals))}` : kind === 'reihenfolge' ? '– (K = 1)' : '–';
  }

  // ---------------------------------------------------------------- Optimum
  function renderOptimum() {
    const d = st.data;
    const n = d.formulation.n;
    const res = st.result;
    const minDec = decode(res.min.x);
    const exact = d.exact;
    const same = exact && minDec.valid && Math.abs(res.min.E - exact.value) < 1e-6;
    const loadBtn = (x, label = 'laden') => el('button', { class: 'btn small', type: 'button', onclick: () => { st.x = Uint8Array.from(x); update(); } }, label);
    const box = (title, big, ...rest) => el('div', { class: 'opt-box' }, el('div', { class: 'hint' }, title), el('div', { class: 'big' }, big), ...rest);
    const ia = d.exact_ia;
    const free = d.exact_free;
    fill(optimumHost,
      el('div', { class: 'opt-grid' },
        box(res.exhaustive ? `QUBO-Minimum (alle ${nf(res.total)} Zustände durchprobiert)` : `QUBO-Minimum (Simulated Annealing mit Tausch-Zügen, ${res.restarts} Neustarts – Heuristik)`,
          `E = ${fmt(res.min.E)}`,
          el('div', {}, describeSeq(minDec.sequences)),
          el('div', { class: minDec.valid ? 'okline' : 'warnline' }, minDec.valid ? '✓ gültiger Plan' : `✗ ${minDec.issues.map((i) => i.text).join(' · ')}`),
          loadBtn(res.min.x),
          res.plain ? el('div', { class: 'hint', html: `Nur Einzelbits (ohne Tausch-Züge): E = ${fmt(res.plain.E)}
            ${Math.abs(res.plain.E - res.min.E) < 1e-6 ? '– gleich gut.' : `<b>✗ schlechter</b>: Ein Auftrag wechselt nur über zwei Bit-Kipps mit ungültigem Zwischenzustand – eine Barriere ≈ A.
            Das macht große One-Hot-QUBOs für Annealer schwer.`}` }) : null),
        box(`Exaktes Optimum (${nf(exact?.count ?? 0)} Ablaufpläne aufgezählt, ≤ ${d.instance.slots} je Roboter)`,
          exact ? `${fmt(exact.value)} s` : '–',
          el('div', {}, exact ? describeSeq(seqMap(exact.sequences)) : 'kein gültiger Plan: mehr Aufträge als Plätze'),
          exact?.bits ? loadBtn(bitsToX(exact.bits)) : null),
        box('Probe', exact ? (same ? '✓ gleich' : '✗ verschieden') : '–',
          el('div', { class: same ? 'okline' : 'warnline' }, !exact ? 'Ohne gültigen Plan muss eine Regel brechen.'
            : same ? 'Das QUBO-Minimum ist der beste Ablaufplan – die Formulierung stimmt.'
              : !minDec.valid ? 'Das Minimum bricht eine Regel – Strafgewichte erhöhen (oder Terme einschalten).'
                : res.exhaustive ? 'Abweichung – bitte melden.' : 'Die Heuristik hat das Optimum verfehlt – genau das Risiko großer Instanzen.')),
        box('Reichen K Plätze?', free && exact ? (Math.abs(free.value - exact.value) < 1e-6 ? '✓ ja' : '✗ nein') : '–',
          el('div', {}, !free ? '–' : Math.abs(free.value - (exact?.value ?? Infinity)) < 1e-6
            ? `Auch ohne Platzgrenze ist ${fmt(free.value)} s das Optimum.`
            : `Ohne Platzgrenze wäre ${fmt(free.value)} s möglich (${describeSeq(seqMap(free.sequences))}) – mehr Plätze, mehr Qubits.`)),
        box('Zum Vergleich: Sofortzuweisung (K = 1)', ia ? `${fmt(ia.value)} s` : 'unlösbar',
          el('div', {}, ia ? `${describeSeq(seqMap(ia.sequences))}${exact && ia.value > exact.value + 1e-6 ? ` – mit Reihenfolge ${fmt(ia.value - exact.value)} s besser` : ''}`
            : 'Ein Auftrag ohne möglichen Roboter.'),
          el('div', { class: 'hint' }, 'Doppelbelegung zulässig, Aufträge eines Roboters in Anfrage-Reihenfolge.'))),
      el('h4', {}, res.exhaustive ? 'Die günstigsten Zustände' : 'Die besten gefundenen Zustände'),
      el('div', { class: 'table-scroll' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'Platz'), el('th', { class: 'num' }, 'Energie'), el('th', {}, 'Ablauf'), el('th', {}, 'Regeln'))),
        el('tbody', {}, res.top.map((r, k) => {
          const dd = decode(r.x);
          const tr = el('tr', { class: `clickable${r.x.every((b, i) => b === st.x[i]) ? ' selected' : ''}` },
            el('td', { class: 'num' }, k + 1), el('td', { class: 'num' }, fmt(r.E)), el('td', {}, describeSeq(dd.sequences)),
            el('td', { class: dd.valid ? 'ok' : 'no' }, dd.valid ? '✓ gültig' : `✗ ${dd.issues.map((i) => i.text).join(' · ')}`));
          tr.addEventListener('click', () => { st.x = Uint8Array.from(r.x); update(); });
          return tr;
        })))));
    renderSweepHost(n);
  }

  function renderSweepHost(n) {
    if (n > SWEEP_MAX_BITS) {
      fill(sweepHost, el('p', { class: 'hint' }, `Schwellen für A, B und D nur bis ${SWEEP_MAX_BITS} Schalter (hier ${n}).`));
      return;
    }
    const btn = el('button', { class: 'btn small', type: 'button', onclick: () => { st.sweep = computeSweeps(); renderSweepHost(n); } }, 'Schwellen für A, B, D berechnen');
    if (!st.sweep) {
      fill(sweepHost, el('h4', {}, 'Wie groß müssen die Strafgewichte sein?'),
        el('p', { class: 'hint' }, 'Je Gewicht von 0 an erhöhen (die anderen fest), bis das Minimum gültig ist.'), btn);
      return;
    }
    const rows = st.sweep.map((s) => el('tr', {},
      el('td', {}, el('span', { class: 'swatch', style: { background: TERM_COLORS[s.kind], display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', marginRight: '6px' } }), `${s.key} · ${SHORT[s.kind]}`),
      el('td', { class: 'num' }, nf(st[s.key])),
      el('td', {}, s.threshold == null ? 'im gezeigten Bereich nie gültig' : s.threshold === 0 ? 'für jedes Gewicht gültig – hier nicht nötig' : `gültig ab ≈ ${fmt(s.threshold)}`),
      el('td', { class: 'hint' }, s.threshold > 0 && s.below ? `darunter z.B. ${s.key} = ${fmt(s.below.val)}: ${describeSeq(s.below.seq)} (${s.below.issues})` : '')));
    fill(sweepHost, el('h4', {}, 'Wie groß müssen die Strafgewichte sein?'),
      el('table', { class: 'data' }, el('thead', {}, el('tr', {}, el('th', {}, 'Gewicht'), el('th', { class: 'num' }, 'aktuell'), el('th', {}, 'Minimum gültig'), el('th', {}, 'Was ohne sie passiert'))),
        el('tbody', {}, rows)),
      el('p', { class: 'hint' }, '„Für jedes Gewicht gültig“: hier halten die Kosten die Regel schon ein – sie bleibt für die Garantie (kostet Kopplungen). Beispiel: Bei Erledigungszeiten macht die Dreiecksungleichung Lücken meist unattraktiv, bei Arbeitszeiten nicht.'),
      btn);
  }

  function computeSweeps() {
    const out = [];
    for (const [kind, key] of Object.entries(WEIGHT)) {
      if (kind !== 'zeile' && st.data.instance.slots < 2) continue; // K = 1: nur die Zeilenregel
      const top = Math.max(st.data.weights[key], st[key]) * 1.5;
      const pts = [];
      for (let k = 0; k <= 30; k += 1) {
        const val = Math.round((top * k) / 30);
        const m = makeModel(st.data.formulation, { A: st.A, B: st.B, D: st.D, [key]: val, terms: Object.fromEntries(TERMS.map((t) => [t, true])) });
        const r = search(m, 1);
        const dd = decode(fromMask(r.min.mask, m.n));
        pts.push({ val, valid: dd.valid, seq: dd.sequences, issues: dd.issues.map((i) => i.text).join(' · ') });
      }
      let threshold = null;
      for (let k = pts.length - 1; k >= 0 && pts[k].valid; k -= 1) threshold = pts[k].val;
      const below = [...pts].reverse().find((p) => !p.valid && (threshold == null || p.val < threshold));
      out.push({ kind, key, threshold, below });
    }
    return out;
  }

  // ---------------------------------------------------------------- Hardware
  function renderHardware() {
    const d = st.data;
    const est = d.estimates;
    const offs = st.model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const coefs = st.model.entries.filter((e) => e.activeParts.length).map((e) => Math.abs(e.value));
    const n = d.formulation.n;
    const ia = est.find((e) => e.key === 'sofort');
    const byKind = Object.fromEntries(TERMS.map((k) => [k, offs.filter((e) => e.activeParts.some((p) => p.kind === k)).length]));
    fill(hardwareHost,
      el('div', { class: 'kpis' },
        kpiSmall('Qubits', nf(n), `${nf(n / Math.max(1, ia.qubits), 1)}× die Sofortzuweisung (${nf(ia.qubits)})`),
        kpiSmall('Kopplungen', nf(offs.length), `Sofortzuweisung: ${nf(ia.couplings)}`),
        kpiSmall('Dichte', `${nf((100 * offs.length) / Math.max(1, (n * (n - 1)) / 2), 0)} %`, 'Anteil aller möglichen Paare'),
        kpiSmall('Größter |Koeffizient|', fmt(coefs.length ? Math.max(...coefs) : 0), 'Strafgewichte wachsen mit der Summe aller Fahrten')),
      el('p', { class: 'hint' }, `Kopplungen nach Herkunft (eine Kopplung kann mehrere haben): ${TERMS.filter((k) => byKind[k]).map((k) => `${SHORT[k]} ${byKind[k]}`).join(' · ')}.`),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Wie die Reihenfolge abgebildet wird'), el('th', {}, 'Hilfsvariablen'), el('th', { class: 'num' }, 'Qubits'),
          el('th', { class: 'num' }, 'Kopplungen'), el('th', {}, 'Bemerkung'))),
        el('tbody', {}, est.map((e) => el('tr', { class: e.key === 'plaetze' ? 'selected' : '' },
          el('td', {}, el('strong', {}, e.label)), el('td', {}, e.aux),
          el('td', { class: 'num' }, `${e.exact ? '' : '≈ '}${nf(e.qubits)}`),
          el('td', { class: 'num' }, e.couplings == null ? 'dicht' : `${e.exact ? '' : '≈ '}${nf(e.couplings)}`),
          el('td', { style: { whiteSpace: 'normal' } }, e.note)))))),
      el('p', { class: 'hint', html: `Sofortzuweisung und Plätze exakt gezählt (Kopplungen strukturell, Standardgewichte); Zeitraster und explizite Zeiten sind <b>Abschätzungen</b>.
        Platz-Variablen sind der sparsamste exakte Weg: Qubits = Aufträge × Roboter × Plätze, unabhängig von der Zeitauflösung.` }));
  }

  // ---------------------------------------------------------------- Hervorheben
  function highlightBoard(sel) {
    boardHost.querySelectorAll('.hl').forEach((n) => n.classList.remove('hl'));
    if (!sel) return;
    const q = [];
    if (sel.robot != null) q.push(`[data-robot="${sel.robot}"]`);
    if (sel.kind === 'zeile') q.push('.row-sum');
    if (sel.kind === 'spalte' || sel.kind === 'luecke') q.push('.col-sum');
    if (sel.kind === 'kosten' || sel.kind === 'reihenfolge') q.push('.switch.on');
    if (q.length) boardHost.querySelectorAll(q.join(',')).forEach((n) => n.classList.add('hl'));
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
