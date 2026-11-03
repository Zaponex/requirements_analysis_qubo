// „Die Formel dahinter“ der TA-Seiten mit Lastausgleich: H = H_obj + A·H_pen + B·H_WB (+ M·H_Aux bei Binary).
// Vier Register: ① Formel   ② Eingesetzt   ③ Ausmultipliziert → QUBO   ④ Wirkung von B und A
// Formelteile tragen data-hl – beim Überfahren hebt die Seite Aufträge, Roboter oder Bits hervor.
import { el, fill, nf } from '../util.js';
import { C, TERM_COLORS, plot } from '../theme.js';
import { fromMask, makeModel, search } from '../qubo/engine.js';
import { formulaHtml } from './onehotCriterion.js';
import { bestPlan, boundValue, recommendA, robotLoads } from '../components/workload.js';

export const WB_TABS = [
  { key: 'formel', label: '① Formel' },
  { key: 'eingesetzt', label: '② Eingesetzt' },
  { key: 'qubo', label: '③ Ausmultipliziert → QUBO' },
  { key: 'wirkung', label: '④ Wirkung von B und A' },
];
const SWEEP_MAX_BITS = 16;
const fmt = (v) => nf(v, 1).replace('-', '−');
const fmtB = (v) => nf(v, 4);
const signed = (v) => (v < 0 ? `− ${fmt(-v)}` : `+ ${fmt(v)}`);
const hl = (o) => `data-hl='${JSON.stringify(o)}'`;
const bit = (v) => (v === 1 ? '<b class="one">1</b>' : v === 0 ? '<span class="zero">0</span>' : `<b class="one" style="background:${C.bad}">${fmt(v)}</b>`);

/**
 * @param {HTMLElement} host
 * @param {object} api  getState(), highlight(sel), clearHighlight(), setWeight(key, value), describe(bits), isValid(bits)
 */
export function createWbFormulaPanel(host, api) {
  let tab = 'formel';
  let diagRobot = null;
  const sweepCache = new Map();
  const bar = el('div', { class: 'seg', role: 'tablist' });
  const body = el('div', { class: 'formula-body' });
  fill(host, bar, body);
  body.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-hl]');
    if (t) api.highlight(JSON.parse(t.dataset.hl));
  });
  body.addEventListener('mouseout', (e) => {
    const t = e.target.closest('[data-hl]');
    if (t && !t.contains(e.relatedTarget)) api.clearHighlight();
  });

  function setTab(key, renderNow = true) {
    tab = key;
    if (renderNow) render();
  }
  function render() {
    const s = api.getState();
    if (!s.data) return;
    fill(bar, WB_TABS.map((t) => el('button', { class: `seg-btn${t.key === tab ? ' active' : ''}`, type: 'button', role: 'tab',
      'aria-selected': String(t.key === tab), onclick: () => setTab(t.key) }, t.label)));
    if (tab === 'formel') renderFormula(s);
    else if (tab === 'eingesetzt') renderSubstituted(s);
    else if (tab === 'qubo') renderExpansion(s);
    else renderEffects(s);
  }
  const offNote = (s, kind) => {
    if (s.terms[kind]) return '';
    const stepOf = s.E.steps.findIndex((st) => st.terms[kind]) + 1;
    return s.step < stepOf ? `kommt in Schritt ${stepOf}` : 'gerade ausgeschaltet';
  };

  // ---------------------------------------------------------------- ① Formel
  function renderFormula(s) {
    const { E, data } = s;
    const d = data.instance;
    const pen = E.pen;
    const line = (kind, lhs, term, note) => {
      const off = offNote(s, kind);
      return `<div class="fx-line t-${kind}${off ? ' off' : ''}" ${hl({ kind })}><span class="fx-lhs">${lhs}</span><span class="fx-term">${term}</span>
        <span class="fx-note">${note}${off ? ` <em>(${off})</em>` : ''}</span></div>`;
    };
    const x = E.xHtml('<i>t</i>', '<i>r</i>');
    const loads = robotLoads(d, s.dec.xs);
    const sumL = loads.reduce((a, l) => a + l.L, 0);
    const R = loads.length;
    const between = loads.reduce((a, l) => a + (l.L - sumL / R) ** 2, 0);
    const costs = d.variables.map((v) => v.cost);
    body.innerHTML = `
      <p class="fx-intro">Zuweisung mit Reihenfolge ohne Positionen: Gezählt wird nur, <b>wie viel</b> Arbeit jeder Roboter bekommt, nicht wann.
        ${E.name}: <i>x</i><sub>t,r</sub> = ${x}.</p>
      <div class="fx">
        ${line('kosten', '<i>H</i> =', `${E.names.obj} = Σ<sub><i>t</i></sub> Σ<sub><i>r</i></sub> <i>c</i><sub><i>t</i>,<i>r</i></sub> ${x}`, '<b>Gesamtlast:</b> jede Zuweisung zahlt ihre Arbeit c<sub>t,r</sub>.')}
        ${line(pen, '+ <i>A</i> ·', `${E.names.pen} = ${E.penFormula}`, `<b>${E.penText}</b> – 0, wenn die Kodierung gültig ist.`)}
        ${line('last', '+ <i>B</i> ·', `${E.names.wb} = Σ<sub><i>r</i></sub> ( <i>L</i><sub><i>r</i>,0</sub> + Σ<sub><i>t</i></sub> <i>c</i><sub><i>t</i>,<i>r</i></sub> ${x} )²`,
    '<b>Lastausgleich:</b> Quadrat je Roboter – eine doppelt so hohe Last zählt vierfach.')}
        ${E.key === 'binary' ? line('hilfsbit', '+ <i>M</i> ·', `${E.names.aux} = Σ ( <i>xy</i> − 2<i>xa</i> − 2<i>ya</i> + 3<i>a</i> )`, '<b>Hilfsbits:</b> a muss das Produkt x·y sein (ab Schritt 6).') : ''}
      </div>
      <h4>Warum ein Quadrat?</h4>
      <p class="fx-intro">Σ<sub>r</sub> <i>L</i><sub>r</sub>² = (Σ<sub>r</sub> <i>L</i><sub>r</sub>)² / <i>R</i> + Σ<sub>r</sub> (<i>L</i><sub>r</sub> − <i>L̄</i>)² – das Quadrat bestraft die <b>Gesamtlast</b> und die <b>Ungleichheit</b>.
        Dein Zustand: ${fmt(sumL)}² / ${R} = ${nf(sumL * sumL / R)} plus ${nf(between)} = ${nf(sumL * sumL / R + between)}.
        Ohne Anfahrt ist Σ<sub>r</sub> <i>L</i><sub>r</sub> für gültige Pläne fest – dann zählt nur die Ungleichheit (Zahlenpartitionierung).
        Die Varianz direkt (Σ (<i>L</i> − <i>L̄</i>)²) koppelt über (Σ<i>L</i>)² <b>jedes</b> Paar von Variablen – Tabelle beim Kopplungsgraph.</p>
      <h4>Symbole</h4>
      <table class="data symbols"><thead><tr><th>Symbol</th><th>Bedeutung</th><th>in diesem Szenario</th></tr></thead><tbody>
        <tr ${hl({ all: true })}><td><i>t</i> ∈ <i>T</i></td><td>Auftrag</td><td>${d.tasks.map((t) => `#${t.transport_id}`).join(', ')}</td></tr>
        <tr ${hl({ all: true })}><td><i>r</i> ∈ <i>R</i></td><td>Roboter (AMR)</td><td>${d.robots.map((r) => `R${r.robot_id}`).join(', ')}</td></tr>
        <tr ${hl({ kind: 'kosten' })}><td><i>c</i><sub><i>t</i>,<i>r</i></sub></td><td>Arbeit von <i>t</i> auf <i>r</i> (${d.measure.label}): ${formulaHtml(d.criterion.formula)}</td>
          <td>${costs.length ? `${fmt(Math.min(...costs))} … ${fmt(Math.max(...costs))} ${d.measure.unit}` : '–'}</td></tr>
        <tr ${hl({ kind: 'last' })}><td><i>L</i><sub><i>r</i>,0</sub></td><td>Vorlast: ${d.vorlast.text}</td><td>${d.robots.map((r) => `R${r.robot_id}: ${fmt(r.load0)}`).join(' · ')}</td></tr>
        <tr ${hl({ kind: 'last' })}><td><i>L</i><sub><i>r</i></sub></td><td>Last = Vorlast + Σ<sub>t</sub> c·x</td><td>${loads.map((l) => `R${l.r.robot_id}: ${fmt(l.L)}`).join(' · ')}</td></tr>
        <tr><td><i>A</i>, <i>B</i>${E.key === 'binary' ? ', <i>M</i>' : ''}</td><td>Gewichte (im Paper implizit 1); B hat die Einheit 1/${d.measure.unit}</td>
          <td>A = ${fmt(s.A)}, B = ${fmtB(s.B)}${E.key === 'binary' ? `, M = ${fmt(s.M)}` : ''}</td></tr>
      </tbody></table>`;
  }

  // ---------------------------------------------------------------- ② Eingesetzt
  function renderSubstituted(s) {
    const { E, data } = s;
    const d = data.instance;
    const xs = s.dec.xs;
    const rows = [];
    let total = 0;
    for (const t of d.tasks) {
      const vs = d.variables.filter((v) => v.task_id === t.transport_id);
      const val = vs.reduce((a, v) => a + v.cost * xs[v.index], 0);
      if (s.terms.kosten) total += val;
      rows.push({ kind: 'kosten', sel: { task: t.transport_id }, name: `Kosten #${t.transport_id}`,
        formula: vs.map((v) => `${fmt(v.cost)}·${E.xHtml(v.task_id, v.robot_id)}`).join(' + ') || '–',
        subst: vs.map((v) => `${fmt(v.cost)}·${bit(xs[v.index])}`).join(' + ') || '0', value: val });
    }
    const penItems = E.penItems(s.data.formulation, d, s.x, xs, s.A);
    const penVal = penItems.reduce((a, p) => a + p.v, 0);
    if (s.terms[E.pen]) total += penVal;
    rows.push({ kind: E.pen, sel: { kind: E.pen }, name: 'Regel der Kodierung', formula: `<i>A</i>·${E.names.pen}`,
      subst: penItems.length ? penItems.map((p) => p.text).join('<br>') : 'keine falsche Wand ✓', value: penVal, ok: penVal === 0 });
    for (const l of robotLoads(d, xs)) {
      const vs = d.variables.filter((v) => v.robot_id === l.r.robot_id);
      const val = s.B * l.L * l.L;
      if (s.terms.last) total += val;
      rows.push({ kind: 'last', sel: { robot: l.r.robot_id }, name: `Last R${l.r.robot_id}`,
        formula: `<i>B</i>·(${fmt(l.r.load0)} ${vs.map((v) => `+ ${fmt(v.cost)}·${E.xHtml(v.task_id, v.robot_id)}`).join(' ')})²`,
        subst: `${fmtB(s.B)}·(${fmt(l.r.load0)} ${vs.map((v) => `+ ${fmt(v.cost)}·${bit(xs[v.index])}`).join(' ')})² = ${fmtB(s.B)}·${fmt(l.L)}²`, value: val });
    }
    body.innerHTML = `
      <p class="fx-intro">Die Formel mit den Zahlen dieses Szenarios und deinen x-Werten (<b class="one">1</b> = an${E.key === 'domain_wall' ? ', rot = x = −1' : ''}) – live mit dem Brett.</p>
      <div class="table-wrap"><table class="data fx-table">
        <thead><tr><th>Term</th><th>Formel mit Zahlen</th><th>eingesetzt</th><th class="num">Wert</th></tr></thead>
        <tbody>${rows.map((r) => {
    const off = !s.terms[r.kind];
    return `<tr class="t-row t-${r.kind}${off ? ' off' : ''}" ${hl(r.sel)}><td><span class="t-name">${r.name}</span></td><td class="fx-cell">${r.formula}</td>
      <td class="fx-cell">${r.subst}</td><td class="num ${!off && r.ok === false ? 'no-val' : ''}">${off ? `<em>${offNote(s, r.kind)}</em>` : fmt(r.value)}</td></tr>`;
  }).join('')}
          <tr class="fx-total"><td colspan="3">Summe aller aktiven Terme${E.key === 'binary' && s.qubo ? ' (ohne Hilfsbit-Strafe)' : ''}</td><td class="num">${fmt(total)}</td></tr>
        </tbody></table></div>`;
  }

  // ---------------------------------------------------------------- ③ Ausmultipliziert → QUBO
  function renderExpansion(s) {
    const { E, data } = s;
    const d = data.instance;
    const f = data.formulation;
    if (diagRobot == null || !d.robots.some((r) => r.robot_id === diagRobot)) diagRobot = d.robots[0].robot_id;
    const derivation = `<div class="fx-derivation t-last${s.terms.last ? '' : ' off'}">
        <div><i>B</i>(<i>L</i><sub>0</sub> + Σ <i>c</i>·<i>x</i>)² <span class="eq">=</span> <span class="p-const"><i>B</i><i>L</i><sub>0</sub>²</span>
          <span class="p-lin">+ <i>B</i>·Σ (2<i>L</i><sub>0</sub><i>c</i> + <i>c</i>²)·<i>x</i></span> <span class="p-pair">+ 2<i>B</i>·Σ<sub><i>t</i>&lt;<i>t</i>′</sub> <i>c</i><i>c</i>′·<i>x</i><i>x</i>′</span></div>
        <div class="why">${E.key === 'domain_wall' ? 'Gilt so nur mit x² = x – bei Domain Wall ist x = d − d′ und x² = d + d′ − 2dd′: Auch Nachbarbits derselben Kette koppeln, und jedes x·x′ wird zu bis zu vier Bitpaaren.'
    : E.key === 'binary' ? 'y² = y gilt (Indikator), aber y·y′ ist ein Produkt aus 2K Bits zweier Codes – Grad 2K, erst Hilfsbits machen es quadratisch.'
      : 'weil x² = x. Die Paare koppeln Aufträge am selben Roboter – dieselben wie die Spaltenregel der IA, aber mit 2B·c·c′ statt B.'}</div></div>`;
    let detail = '';
    if (E.key === 'one_hot') {
      const vs = d.variables.filter((v) => v.robot_id === diagRobot);
      const L0 = d.robots.find((r) => r.robot_id === diagRobot).load0;
      const pick = d.robots.map((r) => `<button type="button" class="chip" data-robot-pick="${r.robot_id}" aria-pressed="${r.robot_id === diagRobot}">R${r.robot_id}</button>`).join(' ');
      detail = `<h4>Wohin wandert jeder Teil?</h4><table class="data fx-table"><thead><tr><th>Herkunft</th><th>Formelteil</th><th>landet in</th></tr></thead><tbody>
          <tr class="t-row t-kosten"><td>${E.names.obj}</td><td><i>c</i>·<i>x</i></td><td>Diagonale</td></tr>
          <tr class="t-row t-zeile"><td><i>A</i>·${E.names.pen}</td><td>− <i>A</i>·<i>x</i> · + 2<i>A</i>·<i>x</i><i>x</i>′ (selber Auftrag) · + <i>A</i></td><td>Diagonale · Kopplung · Konstante</td></tr>
          <tr class="t-row t-last"><td><i>B</i>·${E.names.wb}</td><td>+ <i>B</i>(<i>c</i>² + 2<i>L</i><sub>0</sub><i>c</i>)·<i>x</i> · + 2<i>B</i><i>c</i><i>c</i>′·<i>x</i><i>x</i>′ (selber Roboter) · + <i>B</i><i>L</i><sub>0</sub>²</td><td>Diagonale · Kopplung · Konstante</td></tr>
        </tbody></table>
        <h4>Spalte ${pick}</h4>
        <div class="fx-list">${vs.map((v) => `<div class="fx-item" ${hl({ vars: [v.index] })}>Q[${E.xHtml(v.task_id, v.robot_id)}] =
          <span style="color:${TERM_COLORS.kosten}">${fmt(v.cost)}</span> <span style="color:${TERM_COLORS.zeile}">− ${fmt(s.A)}</span>
          <span style="color:${TERM_COLORS.last}">+ ${fmtB(s.B)}·(${fmt(v.cost)}² + 2·${fmt(L0)}·${fmt(v.cost)})</span>
          = <b>${fmt(v.cost - s.A + s.B * (v.cost * v.cost + 2 * L0 * v.cost))}</b></div>`).join('')}
        ${vs.length > 1 ? `<div class="fx-item">Kopplung z.B. ${E.xHtml(vs[0].task_id, diagRobot)}${E.xHtml(vs[1].task_id, diagRobot)}: 2·${fmtB(s.B)}·${fmt(vs[0].cost)}·${fmt(vs[1].cost)} = <b>${fmt(2 * s.B * vs[0].cost * vs[1].cost)}</b></div>` : ''}</div>`;
    } else {
      const deg = Object.entries(f.degrees_before).map(([k, n]) => `${n} × Grad ${k}`).join(', ');
      detail = `<h4>Vor der QUBO</h4><p class="fx-intro">Polynom aus allen Termen: ${deg}${f.max_degree > 2 ? ` – höchster Grad <b>${f.max_degree}</b>, ${f.aux.length} Hilfsbits (je Code höchstens 2<sup>K</sup> − K − 1 = ${2 ** f.K - f.K - 1})` : ' – schon quadratisch'}.</p>`;
    }
    const model = s.model;
    const lab = (i) => s.bitLabel(i);
    const lin = model.entries.filter((e) => e.i === e.j && e.value !== 0);
    const quad = model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const LIMIT = 28;
    const terms = [...lin.map((e) => `<span class="q-term" ${hl({ vars: [e.i] })}>${signed(e.value)}·${lab(e.i)}</span>`),
      ...quad.map((e) => `<span class="q-term" ${hl({ vars: [e.i, e.j] })}>${signed(e.value)}·${lab(e.i)}${lab(e.j)}</span>`)];
    const more = terms.length > LIMIT ? ` <span class="hint">… und ${terms.length - LIMIT} weitere Terme</span>` : '';
    const coefs = model.entries.filter((e) => e.value !== 0).map((e) => Math.abs(e.value));
    body.innerHTML = `
      <p class="fx-intro">Eine QUBO kennt nur Bits und Bitpaare. Der Lastausgleich wird ausmultipliziert:</p>
      ${derivation}
      ${detail}
      <h4>Fertige QUBO-Form – das bekommt die Hardware</h4>
      <div class="fx-qubo"><i>H</i> = ${terms.slice(0, LIMIT).join(' ')}${more} <span class="q-term">${signed(model.constant)}</span></div>
      <p class="fx-probe">Koeffizienten von ${fmt(Math.min(...coefs))} bis ${fmt(Math.max(...coefs))} – Verhältnis <b>${nf(Math.max(...coefs) / Math.min(...coefs))} : 1</b>.
        Die Last-Terme wachsen mit <i>c</i>², A wächst mit B mit: Das bestimmt die nötige Präzision.</p>
      <p class="fx-probe">Probe mit deinen Bits: Regeln <b>${fmt(s.ruleEnergy)}</b>, QUBO <b>${fmt(s.quboEnergy)}</b>
        ${Math.abs(s.ruleEnergy - s.quboEnergy) < 1e-6 ? '<span class="okline">✓ identisch</span>' : `<span class="warnline">${E.key === 'binary' && s.dec.lies.length ? '– Differenz = Strafe der lügenden Hilfsbits' : '✗ Abweichung'}</span>`}</p>`;
    body.querySelectorAll('[data-robot-pick]').forEach((b) => b.addEventListener('click', () => { diagRobot = Number(b.dataset.robotPick); render(); }));
  }

  // ---------------------------------------------------------------- ④ Wirkung
  function renderEffects(s) {
    const divB = el('div', { class: 'chart short' });
    const divA = el('div', { class: 'chart short' });
    const noteB = el('p', { class: 'hint' });
    const noteA = el('p', { class: 'hint' });
    fill(body,
      el('p', { class: 'fx-intro', html: 'Links: Welcher Plan ist für welches B der beste (durch Aufzählen)? Rechts: Ab welchem A ist das Minimum der QUBO gültig? Klick in eine Kurve setzt den Regler.' }),
      el('div', { class: 'grid grid-2' },
        el('div', {}, el('h4', {}, 'B: Gesamtlast gegen Ausgleich'), divB, noteB),
        el('div', {}, el('h4', { html: `Wie groß muss A sein? (B = ${fmtB(s.B)})` }), divA, noteA)));
    drawBSweep(s, divB, noteB);
    drawASweep(s, divA, noteA);
  }

  function drawBSweep(s, div, note) {
    const plans = s.plans;
    const unit = s.data.instance.measure.unit;
    if (!plans || !plans.length) { fill(div, el('p', { class: 'hint' }, 'Keine Pläne zum Aufzählen.')); div.style.minHeight = '0'; return; }
    const top = Math.max(4 * s.data.weights.B, 1.2 * s.B, 1e-4);
    const pts = Array.from({ length: 41 }, (_, k) => {
      const B = (top * k) / 40;
      const p = bestPlan(plans, B);
      return { B, obj: p.obj, max: p.max, spread: Math.max(...p.loads) - Math.min(...p.loads) };
    });
    const line = (key, name, color, dash) => ({ type: 'scatter', mode: 'lines', line: { color, width: 2.5, shape: 'hv', dash }, name,
      x: pts.map((p) => p.B), y: pts.map((p) => p[key]), hovertemplate: `B = %{x:.4f}: ${name} %{y:.1f} ${unit}<extra></extra>` });
    plot(div, [line('obj', 'Gesamtlast', C.series), line('max', 'größte Last', C.accent), line('spread', 'Spannweite', C.ink2, 'dot')], {
      margin: { l: 52, r: 10, t: 34, b: 44 }, xaxis: { title: { text: 'Gewicht B des Lastausgleichs' } }, yaxis: { title: { text: unit } },
      shapes: [{ type: 'line', x0: s.B, x1: s.B, yref: 'paper', y0: 0, y1: 1, line: { color: C.ink, width: 1.5, dash: 'dash' } }],
    });
    div.removeAllListeners?.('plotly_click');
    div.on('plotly_click', (ev) => { const p = ev.points && ev.points[0]; if (p) api.setWeight('B', Number(p.x.toFixed(5))); });
    const a = pts[0];
    const z = pts[pts.length - 1];
    note.innerHTML = `B = 0: Gesamtlast ${fmt(a.obj)}, größte Last ${fmt(a.max)} ${unit}. B = ${fmtB(z.B)}: ${fmt(z.obj)} und ${fmt(z.max)} ${unit}.
      ${a.max > z.max + 1e-6 ? `Ausgleich kostet ${fmt(z.obj - a.obj)} ${unit} mehr Gesamtlast und spart ${fmt(a.max - z.max)} an der größten Last.` : 'Hier ist der billigste Plan schon ausgeglichen.'}`;
  }

  function drawASweep(s, div, note) {
    const f = s.data.formulation;
    if (f.n > SWEEP_MAX_BITS) {
      fill(div, el('p', { class: 'hint' }, `Kurve nur bis ${SWEEP_MAX_BITS} Bits (hier ${f.n}).`));
      div.style.minHeight = '0';
      note.textContent = '';
      return;
    }
    const bound = boundValue(s.data.weights.bound, s.B);
    const top = Math.max(50, Math.ceil((recommendA(s.data.weights.bound, s.B) * 1.6) / 10) * 10);
    const terms = { ...s.E.steps[s.E.steps.length - 1].terms };
    const key = `${s.cacheKey}|${s.B}|${s.M}`;
    let pts = sweepCache.get(key);
    if (!pts) {
      pts = [];
      for (let k = 0; k <= 40; k += 1) {
        const A = Math.round((top * k) / 40);
        const m = makeModel(f, { A, B: s.B, D: s.M, terms });
        const r = search(m, 1);
        const x = fromMask(r.min.mask, f.n);
        pts.push({ A, E: r.min.E, valid: api.isValid(x), desc: api.describe(x) });
      }
      sweepCache.set(key, pts);
    }
    let threshold = null;
    for (let k = pts.length - 1; k >= 0 && pts[k].valid; k -= 1) threshold = pts[k].A;
    plot(div, [{ type: 'scatter', mode: 'lines+markers', x: pts.map((p) => p.A), y: pts.map((p) => p.E), line: { color: C.axis, width: 1.5 },
      marker: { size: 8, color: pts.map((p) => (p.valid ? C.series : C.axis)), line: { color: C.surface, width: 1 } },
      customdata: pts.map((p) => [p.desc, p.valid ? '✓ gültig' : '✗ ungültig']),
      hovertemplate: 'A = %{x}: Minimum H = %{y:.1f}<br>%{customdata[0]}<br>%{customdata[1]}<extra></extra>' }], {
      margin: { l: 52, r: 10, t: 34, b: 44 }, xaxis: { title: { text: 'Strafgewicht A (alle Terme an)' } }, yaxis: { title: { text: 'Energie des Minimums' } },
      shapes: [
        { type: 'line', x0: s.A, x1: s.A, yref: 'paper', y0: 0, y1: 1, line: { color: C.accent, width: 2 } },
        { type: 'line', x0: bound, x1: bound, yref: 'paper', y0: 0, y1: 1, line: { color: C.ink2, width: 1.5, dash: 'dot' } },
      ],
      annotations: [{ x: s.A, yref: 'paper', y: 1, text: `aktuell A = ${fmt(s.A)}`, showarrow: false, yanchor: 'bottom', font: { color: C.accent } },
        { x: bound, yref: 'paper', y: 0.02, text: 'Schranke', showarrow: false, xanchor: 'left', font: { color: C.ink2 } }],
    });
    div.removeAllListeners?.('plotly_click');
    div.on('plotly_click', (ev) => { const p = ev.points && ev.points[0]; if (p) api.setWeight('A', p.x); });
    note.innerHTML = threshold == null ? 'Im gezeigten Bereich nie gültig.'
      : `Gültig ab A ≈ ${fmt(threshold)}; die Schranke (gepunktet, ${fmt(bound)}) ist sicher, aber oft größer als nötig – sie rechnet mit allen anderen Aufträgen auf demselben Roboter.`;
  }

  return { render, setTab, get tab() { return tab; } };
}
