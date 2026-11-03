// Lastverteilung (Workload Balancing) der TA – gemeinsam für One-Hot, Domain Wall und Binary:
// x-Werte aus den Bits, Pläne aufzählen, Schranke für A, Lastbalken je Roboter, Pareto-Diagramm und die Karte
// „Was fließt in die Last ein?“. Formulierung: encodings/workload.py
import { el, fill, nf, withTip, tipHtml, escapeHtml } from '../util.js';
import { C, plot, statusColor } from '../theme.js';
import { niceCeil, formulaHtml } from '../views/onehotCriterion.js';

export const MAX_PLANS = 60000;
const fmt = (v) => nf(v, 1).replace('-', '−');

/** x_tr jeder Variablen aus den Bits (x_polys: Monome {vars, c}) – Domain Wall: −1, 0, 1; Binary: Code-Bits, 0/1. */
export function xValues(form, bits) {
  return form.x_polys.map((p) => (p ? p.reduce((s, t) => (t.vars.every((i) => bits[i]) ? s + t.c : s), 0) : 0));
}

/** Last je Roboter aus Vorlast und x: [{r, L, items: [{v, x}]}] in der Reihenfolge von R. */
export function robotLoads(inst, xs) {
  return inst.robots.map((r) => {
    const items = inst.variables.filter((v) => v.robot_id === r.robot_id && Math.abs(xs[v.index]) > 1e-9).map((v) => ({ v, x: xs[v.index] }));
    return { r, items, L: r.load0 + items.reduce((s, it) => s + it.v.cost * it.x, 0) };
  });
}

/** Kennzahlen einer Lastverteilung: Σ L², größte, kleinste, Ø. */
export function loadStats(loads) {
  const Ls = loads.map((l) => l.L);
  return { wb: Ls.reduce((s, L) => s + L * L, 0), max: Math.max(...Ls), min: Math.min(...Ls), mean: Ls.reduce((s, L) => s + L, 0) / Math.max(1, Ls.length) };
}

/**
 * Alle gültigen Pläne: jeder Auftrag genau ein zuständiger Roboter aus R (Doppelbelegung erlaubt).
 * Je Plan: vars (Variablen-Index je Auftrag), obj = Σ c, wb = Σ L², max = größte Last, loads (je Roboter in R).
 * null, wenn es mehr als MAX_PLANS sind.
 */
export function enumeratePlans(inst) {
  const opts = inst.tasks.map((t) => inst.variables.filter((v) => v.task_id === t.transport_id));
  if (opts.some((o) => !o.length)) return [];
  const total = opts.reduce((p, o) => p * o.length, 1);
  if (total > MAX_PLANS) return null;
  const rIdx = new Map(inst.robots.map((r, k) => [r.robot_id, k]));
  const L0 = inst.robots.map((r) => r.load0);
  const plans = new Array(total);
  for (let k = 0; k < total; k += 1) {
    let rem = k;
    const L = L0.slice();
    const vars = new Array(opts.length);
    let obj = 0;
    for (let t = 0; t < opts.length; t += 1) {
      const o = opts[t];
      const v = o[rem % o.length];
      rem = Math.floor(rem / o.length);
      vars[t] = v.index;
      L[rIdx.get(v.robot_id)] += v.cost;
      obj += v.cost;
    }
    let wb = 0;
    let mx = -Infinity;
    for (const l of L) { wb += l * l; if (l > mx) mx = l; }
    plans[k] = { vars, obj, wb, max: mx, loads: L };
  }
  return plans;
}

/** Bester gültiger Plan für H_obj + B·H_WB (bei Gleichstand die kleinere größte Last). */
export function bestPlan(plans, B) {
  let best = null;
  let bv = Infinity;
  for (const p of plans || []) {
    const v = p.obj + B * p.wb;
    if (v < bv - 1e-9 || (Math.abs(v - bv) <= 1e-9 && p.max < best.max)) { best = p; bv = v; }
  }
  return best;
}
export const planValue = (p, B) => p.obj + B * p.wb;

/** Pareto-Front (Gesamtlast ↓, Σ L² ↓): kein anderer Plan ist in beidem besser. */
export function paretoFront(plans) {
  const sorted = [...plans].sort((a, b) => a.obj - b.obj || a.wb - b.wb);
  const out = [];
  let minWb = Infinity;
  for (const p of sorted) if (p.wb < minWb - 1e-9) { out.push(p); minWb = p.wb; }
  return out;
}

/** Schranke für A als Funktion von B (vom Server, workload.weight_bound): max_Gruppe min_Option (a + B·w). */
export function boundValue(groups, B) {
  let out = 0;
  for (const g of groups || []) out = Math.max(out, Math.min(...g.options.map((o) => o.a + B * o.w)));
  return out;
}
export const recommendA = (groups, B) => niceCeil(Math.max(10, 1.1 * boundValue(groups, B)));

/** Zuweisung eines Plans als Text. */
export function planText(inst, p) {
  if (!p) return '–';
  return p.vars.map((i) => `#${inst.variables[i].task_id}→R${inst.variables[i].robot_id}`).join(' · ');
}

/**
 * Lastbalken je Roboter: Vorlast (schraffiert) + Aufträge (blau), x = −1 (Domain Wall, gebrochene Kette) rot gestrichelt.
 * ref: Lasten eines Vergleichsplans je Roboter (gestrichelte Marke), B: Gewicht für die Summenzeile.
 */
export function renderLoadBars(host, { inst, xs, unit, ref, refLabel, B }) {
  const loads = robotLoads(inst, xs);
  const pos = loads.map((l) => l.r.load0 + l.items.filter((it) => it.x > 0).reduce((s, it) => s + it.v.cost * it.x, 0));
  const scale = Math.max(1, ...pos, ...(ref || []), ...loads.map((l) => Math.abs(l.L)));
  const pct = (v) => `${(100 * v) / scale}%`;
  const rows = loads.map((l, k) => {
    const segs = [];
    let at = 0;
    if (l.r.load0 > 0) {
      segs.push(withTip(el('div', { class: 'wl-seg pre', style: { left: '0%', width: pct(l.r.load0) } }, 'L₀'),
        tipHtml(`Vorlast R${l.r.robot_id}: ${fmt(l.r.load0)} ${unit}`, [escapeHtml(l.r.load0_source), ...l.r.load0_parts.map((p) => `${escapeHtml(p.name)}: ${fmt(p.value)}`)])));
      at = l.r.load0;
    }
    for (const it of l.items.filter((i) => i.x > 0)) {
      const w = it.v.cost * it.x;
      segs.push(withTip(el('div', { class: 'wl-seg task', style: { left: pct(at), width: pct(w) } }, `#${it.v.task_id}`),
        tipHtml(`#${it.v.task_id} auf R${l.r.robot_id}: c = ${fmt(it.v.cost)} ${unit}`, it.v.parts.map((p) => `${escapeHtml(p.name)}: ${fmt(p.value)}`))));
      at += w;
    }
    let back = at;
    for (const it of l.items.filter((i) => i.x < 0)) {
      const w = it.v.cost * -it.x;
      back -= w;
      segs.push(withTip(el('div', { class: 'wl-seg neg', style: { left: pct(Math.max(0, back)), width: pct(w) } }, `−#${it.v.task_id}`),
        tipHtml(`x = −1: #${it.v.task_id} zieht ${fmt(w)} ${unit} von R${l.r.robot_id} ab`, ['gebrochene Kette – Phantasiewert'])));
    }
    if (ref) segs.push(withTip(el('div', { class: 'wl-mark', style: { left: pct(ref[k]) } }), tipHtml(refLabel || 'Vergleich', [`R${l.r.robot_id}: ${fmt(ref[k])} ${unit}`])));
    return el('div', { class: 'wl-row', 'data-robot': l.r.robot_id },
      el('div', { class: 'wl-name' }, el('span', { class: 'dot-inline', style: { background: statusColor(l.r.status) } }), ` R${l.r.robot_id}`),
      el('div', { class: 'wl-track' }, segs),
      el('div', { class: 'wl-val' }, el('strong', {}, `L = ${fmt(l.L)}`), ` ${unit}`, el('span', { class: 'hint' }, ` · L² = ${nf(l.L * l.L)}`)));
  });
  const s = loadStats(loads);
  fill(host, el('div', { class: 'wl-rows' }, rows),
    el('div', { class: 'wl-sum' },
      el('span', {}, 'Σ L² = ', el('strong', {}, nf(s.wb))),
      B != null ? el('span', {}, `B·Σ L² = ${fmt(B * s.wb)}`) : null,
      el('span', {}, `größte Last ${fmt(s.max)} ${unit}`),
      el('span', {}, `Spannweite ${fmt(s.max - s.min)} ${unit}`),
      el('span', {}, `Ø ${fmt(s.mean)} ${unit}`),
      ref ? el('span', { class: 'hint' }, el('span', { style: { color: C.accent } }, '┆ '), refLabel || 'Vergleich') : null));
  return { loads, stats: s };
}

/**
 * Pareto-Diagramm: jeder gültige Plan als Punkt (Gesamtlast H_obj gegen Σ L²). Der beste Plan für B liegt dort, wo die
 * Gerade H_obj + B·Σ L² = konst. die Punktwolke von unten links berührt.
 */
export function drawTradeoff(div, { plans, B, cur, inst, unit, onPick }) {
  if (!plans || !plans.length) {
    Plotly.purge(div);
    fill(div, el('p', { class: 'hint' }, plans === null ? `Mehr als ${nf(MAX_PLANS)} Pläne – weniger Aufträge oder Roboter wählen.` : 'Kein gültiger Plan (Zuständigkeiten).'));
    div.style.minHeight = '0';
    return;
  }
  if (div.querySelector('p')) div.replaceChildren();
  div.style.minHeight = '';
  const step = Math.max(1, Math.ceil(plans.length / 4000)); // Hintergrund ausdünnen, Front und Optimum immer zeigen
  const cloud = plans.filter((_, k) => k % step === 0);
  const front = paretoFront(plans);
  const best = bestPlan(plans, B);
  const E = planValue(best, B);
  const xs = plans.map((p) => p.obj);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const traces = [
    { type: 'scattergl', mode: 'markers', x: cloud.map((p) => p.obj), y: cloud.map((p) => p.wb), name: 'gültige Pläne',
      marker: { size: 6, color: C.axis }, customdata: cloud.map((p) => [planText(inst, p), fmt(p.max)]),
      hovertemplate: `H_obj = %{x:.1f} ${unit}<br>Σ L² = %{y:,.0f}<br>größte Last %{customdata[1]}<br>%{customdata[0]}<extra></extra>` },
    { type: 'scatter', mode: 'lines+markers', x: front.map((p) => p.obj), y: front.map((p) => p.wb), name: 'Pareto-Front',
      line: { color: C.series, width: 1.5, shape: 'hv' }, marker: { size: 7, color: C.series }, customdata: front.map((p) => [planText(inst, p), fmt(p.max)]),
      hovertemplate: `Pareto: H_obj = %{x:.1f}, Σ L² = %{y:,.0f}<br>größte Last %{customdata[1]}<br>%{customdata[0]}<extra></extra>` },
  ];
  if (B > 0) {
    traces.push({ type: 'scatter', mode: 'lines', x: [x0, x1], y: [(E - x0) / B, (E - x1) / B], name: `H_obj + B·Σ L² = ${fmt(E)}`,
      line: { color: C.accent, width: 1.5, dash: 'dash' }, hoverinfo: 'skip' });
  }
  traces.push({ type: 'scatter', mode: 'markers', x: [best.obj], y: [best.wb], name: 'bester Plan für B',
    marker: { size: 15, color: C.accent, line: { color: C.surface, width: 2 } }, customdata: [[planText(inst, best), fmt(best.max)]],
    hovertemplate: `bester Plan für B: %{customdata[0]}<br>größte Last %{customdata[1]}<extra></extra>` });
  if (cur) {
    traces.push({ type: 'scatter', mode: 'markers', x: [cur.obj], y: [cur.wb], name: 'dein Zustand',
      marker: { size: 13, color: 'rgba(0,0,0,0)', line: { color: C.ink, width: 2.5 } }, hovertemplate: 'dein Zustand<extra></extra>' });
  }
  const ys = plans.map((p) => p.wb);
  plot(div, traces, {
    margin: { l: 70, r: 10, t: 34, b: 46 },
    xaxis: { title: { text: `Gesamtlast H_obj = Σ c·x [${unit}]` } },
    yaxis: { title: { text: 'H_WB = Σ L²' }, range: [Math.min(...ys) * 0.97, Math.max(...ys) * 1.03] },
  });
  div.removeAllListeners?.('plotly_click');
  div.on('plotly_click', (ev) => {
    const pt = ev.points && ev.points[0];
    if (!pt) return;
    const hit = plans.find((p) => Math.abs(p.obj - pt.x) < 1e-6 && Math.abs(p.wb - pt.y) < 1e-6);
    if (hit) onPick(hit);
  });
}

/**
 * Karte „Was fließt in die Last ein?“: Lastmaß, Anteile von c_t,r, Vorlast L_r,0, Parameter und die Tabelle c_t,r.
 * api.onChange({measure?, parts?, vorlast?, param?: [key, value], reset?}) – die Seite lädt neu.
 */
export function renderLoadSetup(host, { data, st, onChange }) {
  const d = data.instance;
  const cat = data.catalog;
  const m = d.measure;
  const chip = (pressed, html, title, onclick, disabled = false) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(pressed), title, disabled, html });
    b.addEventListener('click', onclick);
    return b;
  };
  const measures = el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Lastmaß'),
    cat.measures.map((x) => chip(x.key === m.key, `${escapeHtml(x.label)} <small>${escapeHtml(x.unit)}</small>`, x.en,
      () => { if (x.key !== m.key) onChange({ measure: x.key, parts: null }); })));
  const parts = el('div', { class: 'filter-group' }, el('span', { class: 'filter-label', html: 'Anteile von <i>c</i><sub>t,r</sub>' }),
    m.parts.map((k) => {
      const p = cat.parts[k];
      const on = d.load_parts.includes(k);
      return chip(on, `${escapeHtml(p.label)} <small>${formulaHtml(p.formula[m.key])}${p.robot ? ' · je Roboter' : ''}</small>`,
        p.robot ? 'hängt vom Roboter ab (Anfahrt ab der aktuellen Position)' : 'für alle Roboter gleich',
        () => {
          const next = on ? d.load_parts.filter((x) => x !== k) : [...d.load_parts, k];
          if (next.length) onChange({ parts: m.parts.filter((x) => next.includes(x)) });
        });
    }));
  const vor = el('div', { class: 'filter-group' }, el('span', { class: 'filter-label', html: 'Vorlast <i>L</i><sub>r,0</sub>' }),
    cat.vorlast.map((x) => chip(x.key === d.vorlast.key, escapeHtml(x.label), x.text, () => { if (x.key !== d.vorlast.key) onChange({ vorlast: x.key }); },
      x.key === 'log' && m.key !== 'zeit')));
  // Parameter, die gerade wirken
  const used = new Set();
  const formulas = d.load_parts.map((k) => cat.parts[k].formula[m.key]).join(' ');
  if (/\bv\b/.test(formulas) || d.vorlast.key !== 'keine') used.add('v');
  if (d.load_parts.includes('beladen')) used.add('t_lade');
  if (d.load_parts.includes('entladen')) used.add('t_ent');
  if (d.vorlast.key !== 'keine') used.add('t_rest');
  if (m.key === 'energie') { used.add('e_leer'); if (d.load_parts.includes('lastfahrt')) used.add('f_last'); }
  const paramEls = [...used].filter((k) => cat.params[k]).map((k) => {
    const p = cat.params[k];
    const input = el('input', { type: 'number', min: p.min, step: p.step, value: d.params[k], class: 'w-input', 'aria-label': p.label });
    input.addEventListener('change', () => { const v = Number(input.value); if (Number.isFinite(v)) onChange({ param: [k, v] }); });
    return el('label', { class: 'filter-group', title: p.label }, el('span', { class: 'filter-label' }, `${p.label} [${p.unit}]`), input);
  });

  // Tabelle c_t,r und L_r,0
  const cost = new Map(d.variables.map((v) => [`${v.task_id}|${v.robot_id}`, v]));
  const busy = d.fleet.some((r) => !r.available);
  const table = el('table', { class: 'data wl-ctable' },
    el('thead', {}, el('tr', {}, el('th', {}, 'c [' + m.unit + ']'), d.robots.map((r) => el('th', { class: 'num' }, `R${r.robot_id}`)))),
    el('tbody', {},
      el('tr', {}, el('th', { html: '<i>L</i><sub>r,0</sub>' }), d.robots.map((r) => withTip(el('td', { class: 'num' }, r.load0 ? fmt(r.load0) : '0'),
        tipHtml(`Vorlast R${r.robot_id}`, [escapeHtml(r.load0_source), ...r.load0_parts.map((p) => `${escapeHtml(p.name)}: ${fmt(p.value)}`)])))),
      d.tasks.map((t) => el('tr', {}, el('th', {}, `#${t.transport_id}`), d.robots.map((r) => {
        const v = cost.get(`${t.transport_id}|${r.robot_id}`);
        return v ? withTip(el('td', { class: 'num' }, fmt(v.cost)), tipHtml(`c #${t.transport_id}, R${r.robot_id}`, v.parts.map((p) => `${escapeHtml(p.name)}: ${fmt(p.value)}`)))
          : el('td', { class: 'num hint' }, '–');
      })))));
  const anfahrt = d.load_parts.includes('anfahrt');
  const notes = [
    anfahrt ? 'Die <b>Anfahrt</b> zählt ab der aktuellen Position – exakt nur für den ersten Auftrag eines Roboters; die eines späteren hängt vom Vorgänger ab (dafür bräuchte es Positionen).'
      : 'Ohne Anfahrt ist <i>c</i><sub>t,r</sub> = <i>c</i><sub>t</sub> für alle Roboter: Die Gesamtlast ist fest, <i>H</i><sub>WB</sub> ist die <b>Zahlenpartitionierung</b> der Auftragslasten auf <i>R</i> Roboter.',
    d.vorlast.key !== 'keine' && !d.robots.some((r) => r.load0 > 0)
      ? `Alle Roboter in <i>R</i> sind frei – die Vorlast ist 0. ${busy || st.mode === 'kandidaten' ? 'Mit „Schalter für: alle Roboter“ kommen belegte dazu.' : ''}` : '',
  ].filter(Boolean);
  fill(host, el('div', { class: 'wl-setup' }, measures, parts, vor,
    paramEls.length ? el('div', { class: 'filter-group' }, paramEls,
      el('button', { class: 'btn small', type: 'button', onclick: () => onChange({ reset: true }) }, 'Standardwerte')) : null,
    el('p', { class: 'hint', html: `<i>c</i><sub>t,r</sub> = ${formulaHtml(d.criterion.formula.replace(/^c = /, ''))} · gilt in <i>H</i><sub>obj</sub> und <i>H</i><sub>WB</sub>` }),
    el('div', { class: 'table-wrap' }, table),
    notes.map((n) => el('p', { class: 'hint', html: n }))));
}

/** Größentabelle der drei Kodierungen mit H_WB (vom Server, workload.wb_sizes) – Zeile T hervorgehoben. */
export function sizesTable(sizes, T, current) {
  const cell = (o) => `${o.n} / ${o.couplings}${o.aux ? ` (${o.aux} H.)` : ''}`;
  return el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'T'), ...['One-Hot', 'Domain Wall', 'Binary'].map((h, k) => el('th', { class: `num${['one_hot', 'domain_wall', 'binary'][k] === current ? ' hl' : ''}` }, h)),
      el('th', { class: 'num', title: 'One-Hot mit Σ (L − L̄)² statt Σ L²' }, 'One-Hot, Varianz'))),
    el('tbody', {}, sizes.map((row) => el('tr', { class: row.T === T ? 'selected' : '' }, el('td', { class: 'num' }, row.T),
      el('td', { class: 'num' }, cell(row.one_hot)), el('td', { class: 'num' }, cell(row.domain_wall)), el('td', { class: 'num' }, cell(row.binary)),
      el('td', { class: 'num' }, `${row.varianz.n} / ${row.varianz.couplings}`))))));
}
