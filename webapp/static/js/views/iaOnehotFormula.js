// „Die Formel dahinter“ für One-Hot in der Sofortzuweisung (IA): H = H_obj + A·H_pen1 + B·H_pen2,
// je nach Fall T = R, T < R, T > R mit „genau eins“ (H_pen) oder „höchstens eins“ (H′_pen). Vier Register:
//   ① Formel & Fälle   ② Eingesetzt   ③ Ausmultipliziert → QUBO   ④ Wirkung der Terme
// Formelteile tragen data-hl – beim Überfahren hebt die Seite die passenden Schalter hervor.
import { el, fill, nf } from '../util.js';
import { C, TERM_COLORS, plot } from '../theme.js';
import { energy, fromMask, makeModel, search } from '../qubo/engine.js';
import { formulaHtml } from './onehotCriterion.js';
import { CASE_LABELS, CASE_ORDER, CASE_TEXTS } from '../components/iaScenario.js';

export const FORMULA_TABS = [
  { key: 'formel', label: '① Formel & Fälle' },
  { key: 'eingesetzt', label: '② Eingesetzt' },
  { key: 'qubo', label: '③ Ausmultipliziert → QUBO' },
  { key: 'wirkung', label: '④ Wirkung der Terme' },
];
export const DEFAULT_FORMULA_TAB = { 1: 'formel', 3: 'formel', 4: 'wirkung', 5: 'wirkung', 6: 'qubo' };
const SWEEP_MAX_BITS = 16;

// ---------------------------------------------------------------- Fälle (auch von der Seite genutzt)
export const TERMS = ['kosten', 'zeile', 'spalte'];
/** exact: „genau eins“ (H_pen) statt „höchstens eins“ (H′_pen) – wie formulations.IA_CASES. */
export const IA_EXACT = {
  'T=R': { zeile: true, spalte: true },
  'T<R': { zeile: true, spalte: false },
  'T>R': { zeile: false, spalte: true },
};
export const CASES = Object.fromEntries(CASE_ORDER.map((k) => [k, { label: CASE_LABELS[k], text: CASE_TEXTS[k], exact: IA_EXACT[k] }]));
export const WEIGHT = { zeile: 'A', spalte: 'B' };
/** Name im Paper: H_pen1, H′_pen1, H_pen2, H′_pen2. */
export const penName = (kind, exact) => `<i>H</i>${exact ? '' : '′'}<sub>pen${kind === 'zeile' ? 1 : 2}</sub>`;
/** Anzahl Paare unter k eingeschalteten Schaltern (k über 2). */
export const pairs = (k) => (k > 1 ? (k * (k - 1)) / 2 : 0);
/** Strafe einer Zeile/Spalte mit k eingeschalteten Schaltern. */
export const penalty = (exact, k) => (exact ? (1 - k) ** 2 : pairs(k));
export const satisfied = (exact, k) => (exact ? k === 1 : k <= 1);
export const ruleText = (kind, exact) => (kind === 'zeile'
  ? `jeder Auftrag ${exact ? 'genau' : 'höchstens'} einen Roboter`
  : `jeder Roboter ${exact ? 'genau' : 'höchstens'} einen Auftrag`);
/** Summenformel des Strafterms (HTML). */
export function penFormula(kind, exact) {
  const x = (a, b) => `<i>x</i><sub>${a},${b}</sub>`;
  if (kind === 'zeile') {
    return exact ? `Σ<sub><i>t</i></sub> ( 1 − Σ<sub><i>r</i></sub> ${x('<i>t</i>', '<i>r</i>')} )²`
      : `Σ<sub><i>t</i></sub> Σ<sub><i>r</i>&lt;<i>r</i>′</sub> ${x('<i>t</i>', '<i>r</i>')} ${x('<i>t</i>', '<i>r</i>′')}`;
  }
  return exact ? `Σ<sub><i>r</i></sub> ( 1 − Σ<sub><i>t</i></sub> ${x('<i>t</i>', '<i>r</i>')} )²`
    : `Σ<sub><i>r</i></sub> Σ<sub><i>t</i>&lt;<i>t</i>′</sub> ${x('<i>t</i>', '<i>r</i>')} ${x('<i>t</i>′', '<i>r</i>')}`;
}
export const H_OBJ = 'Σ<sub><i>t</i></sub> Σ<sub><i>r</i></sub> <i>c</i><sub><i>t</i>,<i>r</i></sub> <i>x</i><sub><i>t</i>,<i>r</i></sub>';

const fmt = (v) => nf(v, 1).replace('-', '−');
const signed = (v) => (v < 0 ? `− ${fmt(-v)}` : `+ ${fmt(v)}`);
const hl = (o) => `data-hl='${JSON.stringify(o)}'`;
const xv = (v) => `<i>x</i><sub>${v.task_id},${v.robot_id}</sub>`;
const bit = (on) => (on ? '<b class="one">1</b>' : '<span class="zero">0</span>');

/**
 * @param {HTMLElement} host
 * @param {object} api  getState(), highlight(sel), clearHighlight(), setWeight(key, value), violations(x), describe(x)
 */
export function createIaFormulaPanel(host, api) {
  let tab = 'formel';
  let rowTask = null;
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
    fill(bar, FORMULA_TABS.map((t) => el('button', {
      class: `seg-btn${t.key === tab ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(t.key === tab),
      onclick: () => setTab(t.key),
    }, t.label)));
    if (tab === 'formel') renderFormula(s);
    else if (tab === 'eingesetzt') renderSubstituted(s);
    else if (tab === 'qubo') renderExpansion(s);
    else renderEffects(s);
  }

  // ---------------------------------------------------------------- Hilfen
  const ctx = (s) => {
    const { variables: vars, tasks, robots } = s.data.instance;
    const caseKey = s.data.formulation.case;
    const ex = s.data.formulation.exact;
    const rowVars = (t) => vars.filter((v) => v.task_id === t);
    const colVars = (r) => vars.filter((v) => v.robot_id === r);
    const on = (vs) => vs.filter((v) => s.x[v.index]).length;
    return { vars, tasks, robots, caseKey, ex, rowVars, colVars, on };
  };
  const offNote = (s, kind) => {
    if (s.terms[kind]) return '';
    const stepOf = { kosten: 3, zeile: 4, spalte: 5 }[kind];
    return s.step < stepOf ? `kommt in Schritt ${stepOf}` : 'gerade ausgeschaltet';
  };

  // ---------------------------------------------------------------- ① Formel & Fälle
  function renderFormula(s) {
    const { vars, tasks, robots, caseKey, ex, rowVars, colVars, on } = ctx(s);
    const line = (kind, lhs, term, note) => {
      const off = offNote(s, kind);
      return `<div class="fx-line t-${kind}${off ? ' off' : ''}" ${hl({ kind })}>
        <span class="fx-lhs">${lhs}</span><span class="fx-term">${term}</span>
        <span class="fx-note">${note}${off ? ` <em>(${off})</em>` : ''}</span></div>`;
    };
    const costs = vars.map((v) => v.cost);
    const caseRows = CASE_ORDER.map((k) => {
      const c = CASES[k];
      return `<tr class="${k === caseKey ? 'selected' : 'dim'}"><td><b>${c.label}</b></td><td>${c.text}</td>
        <td class="fx-cell">${penName('zeile', c.exact.zeile)} + ${penName('spalte', c.exact.spalte)}</td>
        <td>${ruleText('zeile', c.exact.zeile)}; ${ruleText('spalte', c.exact.spalte)}</td></tr>`;
    }).join('');
    body.innerHTML = `
      <p class="fx-intro">Sofortzuweisung: <b>jeder Roboter höchstens ein Auftrag</b>. Welche Seite vollständig zugewiesen wird, hängt von
        <i>T</i> : <i>R</i> ab. Hier <i>T</i> = ${tasks.length}, <i>R</i> = ${robots.length} → <b>Fall ${CASES[caseKey].label}</b>.</p>
      <div class="fx">
        ${line('kosten', '<i>H</i> =', `<i>H</i><sub>obj</sub> = ${H_OBJ}`,
          `<b>Ziel:</b> jeder Schalter, der an ist, zahlt c<sub>t,r</sub> (<b>${s.criterion.label}</b>, ${s.criterion.unit}).`)}
        ${line('zeile', '+ <i>A</i> ·', `${penName('zeile', ex.zeile)} = ${penFormula('zeile', ex.zeile)}`,
          `<b>${ruleText('zeile', ex.zeile)}:</b> ${ex.zeile ? '0 bei genau einem Schalter je Zeile, sonst ≥ 1.' : '1 je Roboterpaar am selben Auftrag; keiner oder einer → 0.'}`)}
        ${line('spalte', '+ <i>B</i> ·', `${penName('spalte', ex.spalte)} = ${penFormula('spalte', ex.spalte)}`,
          `<b>${ruleText('spalte', ex.spalte)}:</b> ${ex.spalte ? '0 bei genau einem Schalter je Spalte, sonst ≥ 1.' : '1 je Auftragspaar am selben Roboter; keiner oder einer → 0.'}`)}
      </div>
      <h4>Die drei Fälle</h4>
      <table class="data">
        <thead><tr><th>Fall</th><th></th><th>Strafterme</th><th>Regeln</th></tr></thead>
        <tbody>${caseRows}</tbody>
      </table>
      <h4>Symbole</h4>
      <table class="data symbols">
        <thead><tr><th>Symbol</th><th>Bedeutung</th><th>in diesem Szenario</th></tr></thead>
        <tbody>
          <tr ${hl({ all: true })}><td><i>t</i> ∈ <i>T</i></td><td>Auftrag (Zeile)</td><td>${tasks.map((t) => `#${t.transport_id}`).join(', ')}</td></tr>
          <tr ${hl({ all: true })}><td><i>r</i> ∈ <i>R</i></td><td>Roboter, AMR (Spalte)</td><td>${robots.map((r) => `R${r.robot_id}`).join(', ')}</td></tr>
          <tr ${hl({ all: true })}><td><i>x</i><sub><i>t</i>,<i>r</i></sub> ∈ {0, 1}</td><td>Schalter = Qubit: 1 = <i>r</i> übernimmt <i>t</i></td><td>${vars.length} Schalter</td></tr>
          <tr ${hl({ kind: 'kosten' })}><td><i>c</i><sub><i>t</i>,<i>r</i></sub></td><td>${s.criterion.en}: ${formulaHtml(s.criterion.formula)}</td><td>${costs.length ? `${fmt(Math.min(...costs))} … ${fmt(Math.max(...costs))} ${s.criterion.unit}` : '–'}</td></tr>
          <tr ${hl({ kind: 'zeile' })}><td>Σ<sub><i>r</i></sub> <i>x</i><sub><i>t</i>,<i>r</i></sub></td><td>Schalter an in Zeile <i>t</i></td><td>${tasks.map((t) => `#${t.transport_id}: ${on(rowVars(t.transport_id))}`).join(' · ')}</td></tr>
          <tr ${hl({ kind: 'spalte' })}><td>Σ<sub><i>t</i></sub> <i>x</i><sub><i>t</i>,<i>r</i></sub></td><td>Schalter an in Spalte <i>r</i></td><td>${robots.map((r) => `R${r.robot_id}: ${on(colVars(r.robot_id))}`).join(' · ')}</td></tr>
          <tr ${hl({ kind: 'zeile' })}><td><i>A</i>, <i>B</i></td><td>Strafgewichte (im Paper implizit 1)</td><td>A = ${fmt(s.A)}, B = ${fmt(s.B)} (Regler)</td></tr>
        </tbody>
      </table>`;
  }

  // ---------------------------------------------------------------- ② Eingesetzt
  function renderSubstituted(s) {
    const { tasks, robots, ex, rowVars, colVars, on } = ctx(s);
    const rows = [];
    let total = 0;
    for (const t of tasks) {
      const vs = rowVars(t.transport_id);
      const val = vs.reduce((acc, v) => acc + v.cost * s.x[v.index], 0);
      if (s.terms.kosten) total += val;
      rows.push({ kind: 'kosten', sel: { task: t.transport_id }, name: `Kosten #${t.transport_id}`,
        formula: vs.length ? vs.map((v) => `${fmt(v.cost)}·${xv(v)}`).join(' + ') : '– (kein Schalter)',
        subst: vs.length ? vs.map((v) => `${fmt(v.cost)}·${bit(s.x[v.index])}`).join(' + ') : '0', value: val });
    }
    const group = (kind, key, label, vs) => {
      const exact = ex[kind];
      const k = on(vs);
      const W = s[WEIGHT[kind]];
      const val = W * penalty(exact, k);
      if (s.terms[kind]) total += val;
      const ps = [];
      for (let a = 0; a < vs.length; a += 1) for (let b = a + 1; b < vs.length; b += 1) ps.push([vs[a], vs[b]]);
      rows.push(exact
        ? { kind, sel: key, name: label, formula: `<i>${WEIGHT[kind]}</i>·(1 ${vs.map((v) => `− ${xv(v)}`).join(' ')})²`,
          subst: `${fmt(W)}·(1 ${vs.map((v) => `− ${bit(s.x[v.index])}`).join(' ')})² = ${fmt(W)}·${fmt(1 - k)}²`, value: val, ok: k === 1 }
        : { kind, sel: key, name: label, formula: ps.length ? `<i>${WEIGHT[kind]}</i>·(${ps.map(([p, q]) => `${xv(p)}${xv(q)}`).join(' + ')})` : '– (kein Paar)',
          subst: ps.length ? `${fmt(W)}·(${ps.map(([p, q]) => `${bit(s.x[p.index])}·${bit(s.x[q.index])}`).join(' + ')}) = ${fmt(W)}·${pairs(k)}` : '0', value: val, ok: k <= 1 });
    };
    for (const t of tasks) group('zeile', { task: t.transport_id }, `Zeile #${t.transport_id}`, rowVars(t.transport_id));
    for (const r of robots) group('spalte', { robot: r.robot_id }, `Spalte R${r.robot_id}`, colVars(r.robot_id));
    body.innerHTML = `
      <p class="fx-intro">Die Formel mit den Zahlen dieses Szenarios und deinem <i>x</i> (<b class="one">1</b> = an) – live mit dem Schachbrett.</p>
      <div class="table-wrap"><table class="data fx-table">
        <thead><tr><th>Term</th><th>Formel mit Zahlen</th><th>mit deinem <i>x</i> eingesetzt</th><th class="num">Wert</th></tr></thead>
        <tbody>${rows.map((r) => {
    const off = !s.terms[r.kind];
    return `<tr class="t-row t-${r.kind}${off ? ' off' : ''}" ${hl(r.sel)}>
            <td><span class="t-name">${r.name}</span></td><td class="fx-cell">${r.formula}</td><td class="fx-cell">${r.subst}</td>
            <td class="num ${off ? '' : r.ok === false ? 'no-val' : ''}">${off ? `<em>${offNote(s, r.kind)}</em>` : fmt(r.value)}</td></tr>`;
  }).join('')}
          <tr class="fx-total"><td colspan="3">Summe aller aktiven Terme: <i>H</i>(<i>x</i>)</td><td class="num">${fmt(total)}</td></tr>
        </tbody></table></div>`;
  }

  // ---------------------------------------------------------------- ③ Ausmultipliziert → QUBO
  function renderExpansion(s) {
    const { vars, tasks, robots, ex, rowVars } = ctx(s);
    if (rowTask == null || !tasks.some((t) => t.transport_id === rowTask)) rowTask = tasks[0].transport_id;
    const vs = rowVars(rowTask);
    const { A, B } = s;
    const derivation = (kind) => {
      const W = `<i>${WEIGHT[kind]}</i>`;
      const sum = kind === 'zeile' ? 'Σ<sub><i>r</i></sub>' : 'Σ<sub><i>t</i></sub>';
      const off = s.terms[kind] ? '' : ' off';
      return ex[kind]
        ? `<div class="fx-derivation t-${kind}${off}">
            <div>${W}·${penName(kind, true)}: ${W}(1 − ${sum}<i>x</i>)² <span class="eq">=</span> <span class="p-const">${W}</span>
              <span class="p-lin">− ${W}·${sum}<i>x</i></span> <span class="p-pair">+ 2${W}·Σ<sub><i>i</i>&lt;<i>j</i></sub> <i>x<sub>i</sub>x<sub>j</sub></i></span></div>
            <div class="why">weil <i>x</i>² = <i>x</i>: (Σ<i>x</i>)² = Σ<i>x</i> + 2Σ<sub><i>i</i>&lt;<i>j</i></sub> <i>x<sub>i</sub>x<sub>j</sub></i></div></div>`
        : `<div class="fx-derivation t-${kind}${off}">
            <div>${W}·${penName(kind, false)}: <span class="p-pair">${W}·Σ<sub><i>i</i>&lt;<i>j</i></sub> <i>x<sub>i</sub>x<sub>j</sub></i></span> – schon quadratisch</div>
            <div class="why">nur Kopplungen +${W}, keine Belohnung auf der Diagonale, keine Konstante</div></div>`;
    };
    const tr = (kind, part, where, value) => `<tr class="t-row t-${kind}${s.terms[kind] ? '' : ' off'}" ${hl({ kind })}>
      <td>${kind === 'kosten' ? '<i>H</i><sub>obj</sub>' : `${WEIGHT[kind]}·${penName(kind, ex[kind])}`}</td><td>${part}</td><td>${where}</td><td class="num">${value}</td></tr>`;
    const table = [
      tr('kosten', '<i>c<sub>t,r</sub></i>·<i>x<sub>t,r</sub></i>', 'Diagonale Q[<i>x<sub>t,r</sub></i>]', '+ <i>c<sub>t,r</sub></i>'),
      ex.zeile ? tr('zeile', '− <i>A</i>·<i>x<sub>t,r</sub></i>', 'Diagonale', fmt(-A)) : '',
      tr('zeile', `+ ${ex.zeile ? '2' : ''}<i>A</i>·<i>x<sub>t,r</sub>x<sub>t,r′</sub></i>`, 'Kopplung im <b>selben Auftrag</b>', `+ ${fmt(ex.zeile ? 2 * A : A)}`),
      ex.zeile ? tr('zeile', '+ <i>A</i> je Auftrag', 'Konstante', `${tasks.length}·${fmt(A)} = ${fmt(tasks.length * A)}`) : '',
      ex.spalte ? tr('spalte', '− <i>B</i>·<i>x<sub>t,r</sub></i>', 'Diagonale', fmt(-B)) : '',
      tr('spalte', `+ ${ex.spalte ? '2' : ''}<i>B</i>·<i>x<sub>t,r</sub>x<sub>t′,r</sub></i>`, 'Kopplung am <b>selben Roboter</b>', `+ ${fmt(ex.spalte ? 2 * B : B)}`),
      ex.spalte ? tr('spalte', '+ <i>B</i> je Roboter', 'Konstante', `${robots.length}·${fmt(B)} = ${fmt(robots.length * B)}`) : '',
    ].join('');

    const model = s.model;
    const lin = model.entries.filter((e) => e.i === e.j && e.value !== 0);
    const quad = model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const LIMIT = 28;
    const termHtml = [
      ...lin.map((e) => `<span class="q-term" ${hl({ vars: [e.i] })}>${signed(e.value)}·${xv(vars[e.i])}</span>`),
      ...quad.map((e) => `<span class="q-term" ${hl({ vars: [e.i, e.j] })}>${signed(e.value)}·${xv(vars[e.i])}${xv(vars[e.j])}</span>`),
    ];
    const more = termHtml.length > LIMIT ? ` <span class="hint">… und ${termHtml.length - LIMIT} weitere Terme</span>` : '';
    const Ep = penaltyEnergy(s);
    const Eq = energy(model, s.x);
    const diagOf = (v) => (s.terms.kosten ? v.cost : 0) - (s.terms.zeile && ex.zeile ? A : 0) - (s.terms.spalte && ex.spalte ? B : 0);
    const rowSelect = tasks.map((t) => `<button type="button" class="chip" data-row="${t.transport_id}" aria-pressed="${t.transport_id === rowTask}">#${t.transport_id}</button>`).join(' ');
    const rewards = [ex.zeile ? 'A' : null, ex.spalte ? 'B' : null].filter(Boolean);
    body.innerHTML = `
      <p class="fx-intro">Eine QUBO kennt nur Bits <i>x<sub>i</sub></i> und Paare <i>x<sub>i</sub>x<sub>j</sub></i>. „Genau eins“ wird ausmultipliziert,
        „höchstens eins“ ist schon quadratisch.</p>
      ${derivation('zeile')}
      ${derivation('spalte')}
      <h4>Wohin wandert jeder Teil?</h4>
      <table class="data fx-table">
        <thead><tr><th>Herkunft</th><th>Formelteil</th><th>landet in</th><th class="num">Wert hier</th></tr></thead>
        <tbody>${table}</tbody>
      </table>
      <h4>Diagonale von Auftrag ${rowSelect}</h4>
      <div class="fx-list">${vs.map((v) => `<div class="fx-item" ${hl({ vars: [v.index] })}>Q[${xv(v)}] = <span style="color:${TERM_COLORS.kosten}">${fmt(s.terms.kosten ? v.cost : 0)}</span>
        ${s.terms.zeile && ex.zeile ? `<span style="color:${TERM_COLORS.zeile}">− ${fmt(A)}</span>` : ''}
        ${s.terms.spalte && ex.spalte ? `<span style="color:${TERM_COLORS.spalte}">− ${fmt(B)}</span>` : ''} = <b>${fmt(diagOf(v))}</b></div>`).join('')}</div>
      <p class="hint">${rewards.length
    ? `Belohnung fürs Einschalten nur aus ${rewards.join(' und ')} – ${rewards.length === 1 ? `${rewards[0]} muss den teuersten nötigen Schalter überbieten, sonst lohnt Liegenlassen` : 'beide zusammen müssen die Kosten überbieten'}.`
    : 'Keine Belohnung fürs Einschalten.'}</p>
      <h4>Fertige QUBO-Form – das bekommt die Hardware</h4>
      <div class="fx-qubo"><i>H</i>(<i>x</i>) = ${termHtml.slice(0, LIMIT).join(' ')}${more} <span class="q-term">${signed(model.constant)}</span></div>
      <p class="fx-probe">Probe mit deinem <i>x</i>: Strafform <b>${fmt(Ep)}</b>, QUBO-Form <b>${fmt(Eq)}</b>
        ${Math.abs(Ep - Eq) < 1e-6 ? '<span class="okline">✓ identisch – nur die Schreibweise ändert sich.</span>' : '<span class="warnline">✗ Abweichung</span>'}</p>`;
    body.querySelectorAll('[data-row]').forEach((b) => b.addEventListener('click', () => { rowTask = Number(b.dataset.row); render(); }));
  }

  function penaltyEnergy(s) {
    const { tasks, robots, ex, rowVars, colVars, on } = ctx(s);
    let e = 0;
    if (s.terms.kosten) for (const v of s.data.instance.variables) e += v.cost * s.x[v.index];
    if (s.terms.zeile) for (const t of tasks) e += s.A * penalty(ex.zeile, on(rowVars(t.transport_id)));
    if (s.terms.spalte) for (const r of robots) e += s.B * penalty(ex.spalte, on(colVars(r.robot_id)));
    return e;
  }

  // ---------------------------------------------------------------- ④ Wirkung der Terme
  function renderEffects(s) {
    const { tasks, robots, ex, rowVars, colVars, on } = ctx(s);
    const rowDiv = el('div', { class: 'chart short' });
    const colDiv = el('div', { class: 'chart short' });
    const sweepA = el('div', { class: 'chart short' });
    const sweepB = el('div', { class: 'chart short' });
    const how = (exact) => (exact
      ? 'Belohnung −W·k und Paarstrafe +2W·(k über 2) heben sich mit +W <b>nur bei k = 1</b> auf.'
      : 'Nur die Paarstrafe W·(k über 2): k = 0 und k = 1 kosten nichts.');
    fill(body,
      el('p', { class: 'fx-intro', html: 'Oben: Strafe je Anzahl eingeschalteter Schalter (deine Zeilen bzw. Spalten markiert). Unten: Ab welchem Gewicht ist das Minimum <b>gültig</b>? Klick in die Kurve setzt den Regler.' }),
      el('div', { class: 'grid grid-2' },
        el('div', {}, el('h4', { html: `Zeile: A·${penName('zeile', ex.zeile)} – ${ruleText('zeile', ex.zeile)}` }), rowDiv,
          el('p', { class: 'hint', html: how(ex.zeile).replaceAll('W', 'A') })),
        el('div', {}, el('h4', { html: `Spalte: B·${penName('spalte', ex.spalte)} – ${ruleText('spalte', ex.spalte)}` }), colDiv,
          el('p', { class: 'hint', html: how(ex.spalte).replaceAll('W', 'B') })),
        el('div', {}, el('h4', {}, 'Wie groß muss A sein?'), sweepA, el('p', { class: 'hint', 'data-sweep': 'A' })),
        el('div', {}, el('h4', {}, 'Wie groß muss B sein?'), sweepB, el('p', { class: 'hint', 'data-sweep': 'B' }))));

    penaltyChart(rowDiv, ex.zeile, s.A, TERM_COLORS.zeile, Math.max(2, robots.length),
      tasks.map((t) => ({ k: on(rowVars(t.transport_id)), label: `#${t.transport_id}` })), 'Zeile');
    penaltyChart(colDiv, ex.spalte, s.B, TERM_COLORS.spalte, Math.max(2, tasks.length),
      robots.map((r) => ({ k: on(colVars(r.robot_id)), label: `R${r.robot_id}` })), 'Spalte');

    for (const [key, div] of [['A', sweepA], ['B', sweepB]]) {
      const res = drawSweep(s, key, div);
      const note = body.querySelector(`[data-sweep="${key}"]`);
      if (!res || !note) continue;
      const below = [...res.pts].reverse().find((p) => !p.valid && (res.threshold == null || p.val < res.threshold));
      note.innerHTML = res.threshold == null
        ? `Im Bereich nie gültig – ${key === 'A' ? 'B' : 'A'} zu klein oder kein gültiger Plan möglich.`
        : res.threshold === 0
          ? `Für jedes ${key} gültig (bei ${key === 'A' ? 'B' : 'A'} = ${fmt(key === 'A' ? s.B : s.A)}).`
          : `Unter ${key} ≈ ${fmt(res.threshold)} ist ein Regelbruch billiger, z.B. ${key} = ${fmt(below.val)}: <b>${below.desc}</b>, H = ${fmt(below.E)}.`;
    }
  }

  function penaltyChart(div, exact, W, color, maxK, marks, what) {
    const ks = Array.from({ length: maxK + 1 }, (_, k) => k);
    const groups = new Map();
    for (const m of marks) groups.set(m.k, [...(groups.get(m.k) || []), m.label]);
    const traces = exact
      ? [
        { type: 'bar', name: 'Konstante +W', x: ks, y: ks.map(() => W), marker: { color: C.axis } },
        { type: 'bar', name: 'Belohnung −W·k', x: ks, y: ks.map((k) => -W * k), marker: { color: C.series } },
        { type: 'bar', name: 'Paarstrafe +2W·(k über 2)', x: ks, y: ks.map((k) => W * k * (k - 1)), marker: { color } },
      ]
      : [{ type: 'bar', name: 'Paarstrafe W·(k über 2)', x: ks, y: ks.map((k) => W * pairs(k)), marker: { color } }];
    traces.push({ type: 'scatter', mode: 'lines+markers', name: exact ? 'Summe W(1−k)²' : 'Summe', x: ks, y: ks.map((k) => W * penalty(exact, k)),
      line: { color: C.ink, width: 2.5 }, marker: { size: 8, color: C.ink } });
    const w = what === 'Zeile' ? 'A' : 'B';
    traces.forEach((t) => { t.name = t.name.replaceAll('W', w); t.hovertemplate = `k = %{x}: %{y}<extra>${t.name}</extra>`; });
    plot(div, traces, {
      barmode: 'relative', margin: { l: 52, r: 10, t: 40, b: 44 },
      xaxis: { title: { text: `k = Schalter an in einer ${what}` }, dtick: 1 }, yaxis: { title: { text: 'Beitrag zur Energie' } },
      annotations: [...groups].map(([k, labels]) => ({ x: k, y: W * penalty(exact, k), text: labels.join(', '), showarrow: true, arrowhead: 2, ay: -34,
        arrowcolor: C.accent, font: { color: C.accent, size: 12 } })),
    });
  }

  function drawSweep(s, key, div) {
    const n = s.data.formulation.n;
    if (n > SWEEP_MAX_BITS) {
      fill(div, el('p', { class: 'hint' }, `Kurve nur bis ${SWEEP_MAX_BITS} Schalter (hier ${n}).`));
      div.style.minHeight = '0';
      return null;
    }
    const other = key === 'A' ? s.B : s.A;
    const maxCost = Math.max(10, ...s.data.instance.variables.map((v) => v.cost));
    const top = Math.max(100, Math.ceil((maxCost * 2) / 10) * 10);
    const cacheKey = `${key}|${other}|${s.data.instance.tasks.map((t) => t.transport_id)}|${s.data.instance.robots.map((r) => r.robot_id)}|${s.data.instance.mode}|${s.data.instance.criterion.key}|${JSON.stringify(s.data.instance.params)}`;
    let pts = sweepCache.get(cacheKey);
    if (!pts) {
      pts = [];
      for (let k = 0; k <= 40; k += 1) {
        const val = Math.round((top * k) / 40);
        const m = makeModel(s.data.formulation, { A: key === 'A' ? val : other, B: key === 'B' ? val : other, terms: { kosten: true, zeile: true, spalte: true } });
        const r = search(m, 1);
        const x = fromMask(r.min.mask, n);
        pts.push({ val, E: r.min.E, valid: api.violations(x).length === 0, desc: api.describe(x) });
      }
      sweepCache.set(cacheKey, pts);
    }
    let threshold = null;
    for (let k = pts.length - 1; k >= 0 && pts[k].valid; k -= 1) threshold = pts[k].val;
    const cur = key === 'A' ? s.A : s.B;
    div.style.minHeight = '';
    plot(div, [{
      type: 'scatter', mode: 'lines+markers', x: pts.map((p) => p.val), y: pts.map((p) => p.E),
      line: { color: C.axis, width: 1.5 }, marker: { size: 8, color: pts.map((p) => (p.valid ? C.series : C.axis)), line: { color: C.surface, width: 1 } },
      customdata: pts.map((p) => [p.desc, p.valid ? '✓ gültig' : '✗ ungültig']),
      hovertemplate: `${key} = %{x}: Minimum H = %{y}<br>%{customdata[0]}<br>%{customdata[1]}<extra></extra>`,
    }], {
      margin: { l: 52, r: 10, t: 34, b: 44 },
      xaxis: { title: { text: `Strafgewicht ${key} (${key === 'A' ? 'B' : 'A'} = ${fmt(other)}, alle Terme an)` } },
      yaxis: { title: { text: 'Energie des Minimums' } },
      shapes: [{ type: 'line', x0: cur, x1: cur, yref: 'paper', y0: 0, y1: 1, line: { color: C.accent, width: 2 } }],
      annotations: [
        { x: cur, yref: 'paper', y: 1, text: `aktuell ${key} = ${fmt(cur)}`, showarrow: false, yanchor: 'bottom', font: { color: C.accent } },
        { xref: 'paper', yref: 'paper', x: 0, y: 1.12, xanchor: 'left', showarrow: false, font: { color: C.ink2 },
          text: threshold != null && threshold > 0 ? `<span style="color:${C.series}">●</span> gültig ab ${key} ≈ ${fmt(threshold)}  <span style="color:${C.axis}">●</span> ungültig` : (threshold === 0 ? 'für jedes Gewicht gültig' : 'im gezeigten Bereich nie gültig') },
      ],
    });
    div.removeAllListeners?.('plotly_click');
    div.on('plotly_click', (ev) => {
      const p = ev.points && ev.points[0];
      if (p) api.setWeight(key, p.x);
    });
    return { pts, threshold };
  }

  return { render, setTab, get tab() { return tab; } };
}
