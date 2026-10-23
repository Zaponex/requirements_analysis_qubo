// „Die Formel dahinter“ für die One-Hot-Seite: wie die mathematische Formulierung wirkt
// und wie konkrete Zahlen eingesetzt werden. Vier Register:
//   ① Formel & Symbole   ② Eingesetzt   ③ Ausmultipliziert → QUBO   ④ Wirkung der Terme
// Formelteile tragen data-hl – beim Überfahren hebt die Seite die passenden Schalter hervor.
import { el, fill, nf } from '../util.js';
import { C, TERM_COLORS, plot } from '../theme.js';
import { energy, fromMask, makeModel, search } from '../qubo/engine.js';
import { formulaHtml } from './onehotCriterion.js';

export const FORMULA_TABS = [
  { key: 'formel', label: '① Formel & Symbole' },
  { key: 'eingesetzt', label: '② Eingesetzt' },
  { key: 'qubo', label: '③ Ausmultipliziert → QUBO' },
  { key: 'wirkung', label: '④ Wirkung der Terme' },
];
export const DEFAULT_FORMULA_TAB = { 3: 'formel', 4: 'wirkung', 5: 'eingesetzt', 6: 'qubo' };
const SWEEP_MAX_BITS = 16;

const fmt = (v) => nf(v, 1).replace('-', '−');
const signed = (v) => (v < 0 ? `− ${fmt(-v)}` : `+ ${fmt(v)}`);
const hl = (o) => `data-hl='${JSON.stringify(o)}'`;
const xv = (v) => `<i>x</i><sub>${v.task_id},${v.robot_id}</sub>`;
const bit = (on) => (on ? '<b class="one">1</b>' : '<span class="zero">0</span>');

/**
 * @param {HTMLElement} host
 * @param {object} api  getState(), highlight(sel), clearHighlight(), setWeight(key, value), violations(x), describe(x)
 */
export function createFormulaPanel(host, api) {
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
    const vars = s.data.instance.variables;
    const tasks = s.data.instance.tasks;
    const robots = s.data.instance.robots;
    const rowVars = (t) => vars.filter((v) => v.task_id === t);
    const colVars = (r) => vars.filter((v) => v.robot_id === r);
    return { vars, tasks, robots, rowVars, colVars };
  };
  const offNote = (s, kind) => {
    if (s.terms[kind]) return '';
    const stepOf = { zeile: 4, spalte: 5, kosten: 3 }[kind];
    return s.step < stepOf ? `kommt in Schritt ${stepOf}` : 'gerade ausgeschaltet';
  };

  // ---------------------------------------------------------------- ① Formel & Symbole
  function renderFormula(s) {
    const { vars, tasks, robots, rowVars } = ctx(s);
    const line = (kind, lhs, term, note) => {
      const off = offNote(s, kind);
      return `<div class="fx-line t-${kind}${off ? ' off' : ''}" ${hl({ kind })}>
        <span class="fx-lhs">${lhs}</span><span class="fx-term">${term}</span>
        <span class="fx-note">${note}${off ? ` <em>(${off})</em>` : ''}</span></div>`;
    };
    const costs = vars.map((v) => v.cost);
    body.innerHTML = `
      <p class="fx-intro">Das ist die komplette One-Hot-Formulierung. Der Optimierer sucht die Schalterstellung <i>x</i>, für die
        <i>E</i>(<i>x</i>) am kleinsten ist. Jede Zeile ist ein Term mit eigener Aufgabe – fahre darüber, um die betroffenen Schalter zu sehen.</p>
      <div class="fx">
        ${line('kosten', '<i>E</i>(<i>x</i>) =', 'Σ<sub><i>t</i></sub> Σ<sub><i>r</i></sub> <i>c</i><sub><i>t</i>,<i>r</i></sub> · <i>x</i><sub><i>t</i>,<i>r</i></sub>',
          `<b>Kosten.</b> Jeder eingeschaltete Schalter zahlt seine Kosten c<sub>t,r</sub> – hier: <b>${s.criterion.label}</b> in ${s.criterion.unit}. Allein würde dieser Term alles ausschalten (E = 0).`)}
        ${line('zeile', '+', '<i>A</i> · Σ<sub><i>t</i></sub> ( 1 − Σ<sub><i>r</i></sub> <i>x</i><sub><i>t</i>,<i>r</i></sub> )²',
          '<b>Zeilenregel.</b> Pro Auftrag 0, wenn genau ein Schalter an ist – sonst mindestens A. Zieht jede Zeile auf genau eine 1.')}
        ${line('spalte', '+', '<i>B</i> · Σ<sub><i>r</i></sub> Σ<sub><i>t</i> &lt; <i>t</i>′</sub> <i>x</i><sub><i>t</i>,<i>r</i></sub> · <i>x</i><sub><i>t</i>′,<i>r</i></sub>',
          '<b>Spaltenregel.</b> Jedes Paar von Aufträgen auf demselben Roboter kostet B. Schiebt Aufträge auf verschiedene Roboter.')}
      </div>
      <table class="data symbols">
        <thead><tr><th>Symbol</th><th>Bedeutung</th><th>in diesem Szenario</th></tr></thead>
        <tbody>
          <tr ${hl({ all: true })}><td><i>t</i></td><td>ein Auftrag – eine Zeile im Schachbrett</td><td>${tasks.map((t) => `#${t.transport_id}`).join(', ')}</td></tr>
          <tr ${hl({ all: true })}><td><i>r</i></td><td>ein Roboter – eine Spalte im Schachbrett</td><td>${robots.map((r) => `R${r.robot_id}`).join(', ')}</td></tr>
          <tr ${hl({ all: true })}><td><i>x</i><sub><i>t</i>,<i>r</i></sub> ∈ {0, 1}</td><td>Schalter: 1 = „Roboter <i>r</i> übernimmt Auftrag <i>t</i>“ – später ein Qubit</td><td>${vars.length} Schalter${s.data.instance.mode === 'kandidaten' ? ' (nur freie Roboter)' : ''}</td></tr>
          <tr ${hl({ kind: 'kosten' })}><td><i>c</i><sub><i>t</i>,<i>r</i></sub></td><td>Kosten der Zuweisung nach dem Kriterium <b>${s.criterion.label}</b>: ${formulaHtml(s.criterion.formula)}</td><td>${costs.length ? `${fmt(Math.min(...costs))} … ${fmt(Math.max(...costs))} ${s.criterion.unit}` : '–'}</td></tr>
          <tr ${hl({ kind: 'zeile' })}><td>Σ<sub><i>r</i></sub> <i>x</i><sub><i>t</i>,<i>r</i></sub></td><td>Anzahl eingeschalteter Schalter in Zeile <i>t</i></td><td>${tasks.map((t) => `#${t.transport_id}: ${rowVars(t.transport_id).filter((v) => s.x[v.index]).length}`).join(' · ')}</td></tr>
          <tr ${hl({ kind: 'zeile' })}><td><i>A</i></td><td>Strafgewicht der Zeilenregel</td><td>${fmt(s.A)} (Regler)</td></tr>
          <tr ${hl({ kind: 'spalte' })}><td><i>B</i></td><td>Strafgewicht der Spaltenregel</td><td>${fmt(s.B)} (Regler)</td></tr>
          <tr ${hl({ kind: 'spalte' })}><td>Σ<sub><i>t</i> &lt; <i>t</i>′</sub></td><td>über alle Paare verschiedener Aufträge – jedes Paar einmal</td><td>${(tasks.length * (tasks.length - 1)) / 2} Auftragspaare je Roboter</td></tr>
        </tbody>
      </table>`;
  }

  // ---------------------------------------------------------------- ② Eingesetzt
  function renderSubstituted(s) {
    const { tasks, robots, rowVars, colVars } = ctx(s);
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
    for (const t of tasks) {
      const vs = rowVars(t.transport_id);
      const on = vs.filter((v) => s.x[v.index]).length;
      const val = s.A * (1 - on) ** 2;
      if (s.terms.zeile) total += val;
      rows.push({ kind: 'zeile', sel: { task: t.transport_id }, name: `Zeile #${t.transport_id}`,
        formula: `<i>A</i>·(1 ${vs.map((v) => `− ${xv(v)}`).join(' ')})²`,
        subst: `${fmt(s.A)}·(1 ${vs.map((v) => `− ${bit(s.x[v.index])}`).join(' ')})² = ${fmt(s.A)}·${fmt(1 - on)}²`, value: val,
        ok: on === 1 });
    }
    for (const r of robots) {
      const vs = colVars(r.robot_id);
      if (vs.length < 2) continue;
      const pairs = [];
      for (let a = 0; a < vs.length; a += 1) for (let b = a + 1; b < vs.length; b += 1) pairs.push([vs[a], vs[b]]);
      const prodSum = pairs.reduce((acc, [p, q]) => acc + s.x[p.index] * s.x[q.index], 0);
      const val = s.B * prodSum;
      if (s.terms.spalte) total += val;
      rows.push({ kind: 'spalte', sel: { robot: r.robot_id }, name: `Spalte R${r.robot_id}`,
        formula: `<i>B</i>·(${pairs.map(([p, q]) => `${xv(p)}${xv(q)}`).join(' + ')})`,
        subst: `${fmt(s.B)}·(${pairs.map(([p, q]) => `${bit(s.x[p.index])}·${bit(s.x[q.index])}`).join(' + ')})`, value: val, ok: prodSum === 0 });
    }
    body.innerHTML = `
      <p class="fx-intro">Hier wird die Formel mit den <b>Zahlen dieses Szenarios</b> und deiner <b>aktuellen Schalterstellung</b> ausgerechnet –
        Zeile für Zeile. Eine <b class="one">1</b> ist ein eingeschalteter Schalter. Klick im Schachbrett und sieh zu, wie sich die Werte ändern.</p>
      <div class="table-wrap"><table class="data fx-table">
        <thead><tr><th>Term</th><th>Formel mit Zahlen</th><th>mit deinem <i>x</i> eingesetzt</th><th class="num">Wert [${s.criterion.unit}]</th></tr></thead>
        <tbody>${rows.map((r) => {
    const off = !s.terms[r.kind];
    return `<tr class="t-row t-${r.kind}${off ? ' off' : ''}" ${hl(r.sel)}>
            <td><span class="t-name">${r.name}</span></td><td class="fx-cell">${r.formula}</td><td class="fx-cell">${r.subst}</td>
            <td class="num ${off ? '' : r.ok === false ? 'no-val' : ''}">${off ? `<em>${offNote(s, r.kind)}</em>` : fmt(r.value)}</td></tr>`;
  }).join('')}
          <tr class="fx-total"><td colspan="3">Summe aller aktiven Terme: <i>E</i>(<i>x</i>)</td><td class="num">${fmt(total)}</td></tr>
        </tbody></table></div>`;
  }

  // ---------------------------------------------------------------- ③ Ausmultipliziert → QUBO
  function renderExpansion(s) {
    const { vars, tasks, rowVars } = ctx(s);
    if (rowTask == null || !tasks.some((t) => t.transport_id === rowTask)) rowTask = tasks[0].transport_id;
    const vs = rowVars(rowTask);
    const A = s.A;
    const pairTerms = [];
    for (let a = 0; a < vs.length; a += 1) for (let b = a + 1; b < vs.length; b += 1) pairTerms.push([vs[a], vs[b]]);

    // fertige QUBO-Form mit Zahlen
    const model = s.model;
    const lin = model.entries.filter((e) => e.i === e.j && e.value !== 0);
    const quad = model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const LIMIT = 28;
    const termHtml = [
      ...lin.map((e) => `<span class="q-term" ${hl({ vars: [e.i] })}>${signed(e.value)}·${xv(vars[e.i])}</span>`),
      ...quad.map((e) => `<span class="q-term" ${hl({ vars: [e.i, e.j] })}>${signed(e.value)}·${xv(vars[e.i])}${xv(vars[e.j])}</span>`),
    ];
    const shown = termHtml.slice(0, LIMIT).join(' ');
    const more = termHtml.length > LIMIT ? ` <span class="hint">… und ${termHtml.length - LIMIT} weitere Terme</span>` : '';
    const Ep = penaltyEnergy(s);
    const Eq = energy(model, s.x);

    const rowSelect = tasks.map((t) => `<button type="button" class="chip" data-row="${t.transport_id}" aria-pressed="${t.transport_id === rowTask}">#${t.transport_id}</button>`).join(' ');
    body.innerHTML = `
      <p class="fx-intro">Ein QUBO darf nur <b>einzelne Bits</b> <i>x<sub>i</sub></i> und <b>Paare</b> <i>x<sub>i</sub>x<sub>j</sub></i> enthalten.
        Die Zeilenregel ist aber ein Quadrat – also wird sie ausmultipliziert. Der Trick dabei: Für Bits gilt <b><i>x</i>² = <i>x</i></b> (0² = 0, 1² = 1).</p>
      <div class="fx-derivation t-zeile${s.terms.zeile ? '' : ' off'}">
        <div><i>A</i>(1 − Σ<i>x</i>)² <span class="eq">=</span> <i>A</i>·( 1 − 2Σ<i>x</i> + (Σ<i>x</i>)² )</div>
        <div class="why">(Σ<i>x</i>)² = Σ<i>x</i>² + 2Σ<sub><i>i</i>&lt;<i>j</i></sub> <i>x<sub>i</sub>x<sub>j</sub></i> = Σ<i>x</i> + 2Σ<sub><i>i</i>&lt;<i>j</i></sub> <i>x<sub>i</sub>x<sub>j</sub></i> &nbsp;← weil <i>x</i>² = <i>x</i></div>
        <div><span class="eq">=</span> <span class="p-const"><i>A</i></span> <span class="p-lin">− <i>A</i>·Σ<i>x</i></span> <span class="p-pair">+ 2<i>A</i>·Σ<sub><i>i</i>&lt;<i>j</i></sub> <i>x<sub>i</sub>x<sub>j</sub></i></span></div>
      </div>
      <h4>Am Beispiel von Auftrag ${rowSelect}</h4>
      <div class="fx-derivation t-zeile${s.terms.zeile ? '' : ' off'}" ${hl({ task: rowTask })}>
        <div>${fmt(A)}·(1 ${vs.map((v) => `− ${xv(v)}`).join(' ')})²</div>
        <div><span class="eq">=</span> <span class="p-const">${fmt(A)}</span>
          ${vs.map((v) => `<span class="p-lin">− ${fmt(A)}·${xv(v)}</span>`).join(' ')}
          ${pairTerms.map(([p, q]) => `<span class="p-pair">+ ${fmt(2 * A)}·${xv(p)}${xv(q)}</span>`).join(' ')}</div>
        <div class="why"><span class="p-const">Konstante</span> · <span class="p-lin">je Schalter eine Belohnung −A fürs Einschalten</span> ·
          <span class="p-pair">je Schalterpaar der Zeile eine Strafe +2A</span> (${pairTerms.length} Paare)</div>
        ${s.terms.zeile ? '' : '<div class="hint">Die Zeilenregel ist gerade aus – oben unter „Regeln“ einschalten.</div>'}
      </div>
      <h4>Wohin wandert welcher Teil in der QUBO-Matrix?</h4>
      <table class="data fx-table">
        <thead><tr><th>Herkunft</th><th>Formelteil</th><th>landet in</th><th class="num">Wert hier</th></tr></thead>
        <tbody>
          <tr class="t-row t-kosten${s.terms.kosten ? '' : ' off'}" ${hl({ kind: 'kosten' })}><td>Kosten</td><td><i>c<sub>t,r</sub></i>·<i>x<sub>t,r</sub></i></td><td>Diagonale Q[<i>x<sub>t,r</sub></i>]</td><td class="num">+ <i>c<sub>t,r</sub></i></td></tr>
          <tr class="t-row t-zeile${s.terms.zeile ? '' : ' off'}" ${hl({ kind: 'zeile' })}><td>Zeilenregel</td><td>− <i>A</i>·<i>x<sub>t,r</sub></i></td><td>Diagonale Q[<i>x<sub>t,r</sub></i>]</td><td class="num">${fmt(-A)}</td></tr>
          <tr class="t-row t-zeile${s.terms.zeile ? '' : ' off'}" ${hl({ kind: 'zeile' })}><td>Zeilenregel</td><td>+ 2<i>A</i>·<i>x<sub>t,r</sub>x<sub>t,r′</sub></i></td><td>Kopplung im <b>selben Auftrag</b></td><td class="num">+ ${fmt(2 * A)}</td></tr>
          <tr class="t-row t-spalte${s.terms.spalte ? '' : ' off'}" ${hl({ kind: 'spalte' })}><td>Spaltenregel</td><td>+ <i>B</i>·<i>x<sub>t,r</sub>x<sub>t′,r</sub></i></td><td>Kopplung im <b>selben Roboter</b></td><td class="num">+ ${fmt(s.B)}</td></tr>
          <tr class="t-row t-zeile${s.terms.zeile ? '' : ' off'}" ${hl({ kind: 'zeile' })}><td>Zeilenregel</td><td>+ <i>A</i> je Auftrag</td><td>Konstante (verschiebt nur)</td><td class="num">${tasks.length}·${fmt(A)} = ${fmt(tasks.length * A)}</td></tr>
        </tbody>
      </table>
      <h4>Die Diagonale von Auftrag #${rowTask}: Kosten und Belohnung treffen sich</h4>
      <div class="fx-list">${vs.map((v) => `<div class="fx-item" ${hl({ vars: [v.index] })}>Q[${xv(v)}] = <span style="color:${TERM_COLORS.kosten}">${fmt(s.terms.kosten ? v.cost : 0)}</span>
        <span style="color:${TERM_COLORS.zeile}">${s.terms.zeile ? `− ${fmt(A)}` : ''}</span> = <b>${fmt((s.terms.kosten ? v.cost : 0) - (s.terms.zeile ? A : 0))}</b></div>`).join('')}</div>
      <p class="hint">Negativ heißt: Einschalten senkt die Energie. Das passiert, solange die Kosten c kleiner als A sind – deshalb muss A größer sein als die günstigste Zuweisung, sonst lohnt es sich, einen Auftrag liegen zu lassen.</p>
      <h4>Die fertige QUBO-Form – genau das bekommt die Hardware</h4>
      <div class="fx-qubo"><i>E</i>(<i>x</i>) = ${shown}${more} <span class="q-term">${signed(model.constant)}</span></div>
      <p class="fx-probe">Probe mit deinem <i>x</i>: Strafform ergibt <b>${fmt(Ep)}</b>, QUBO-Form ergibt <b>${fmt(Eq)}</b>
        ${Math.abs(Ep - Eq) < 1e-6 ? '<span class="okline">✓ identisch – das Ausmultiplizieren ändert nichts am Wert, nur an der Schreibweise.</span>' : '<span class="warnline">✗ Abweichung</span>'}</p>`;
    body.querySelectorAll('[data-row]').forEach((b) => b.addEventListener('click', () => { rowTask = Number(b.dataset.row); render(); }));
  }

  function penaltyEnergy(s) {
    const { tasks, robots, rowVars, colVars } = ctx(s);
    let e = 0;
    if (s.terms.kosten) for (const v of s.data.instance.variables) e += v.cost * s.x[v.index];
    if (s.terms.zeile) for (const t of tasks) e += s.A * (1 - rowVars(t.transport_id).filter((v) => s.x[v.index]).length) ** 2;
    if (s.terms.spalte) {
      for (const r of robots) {
        const on = colVars(r.robot_id).filter((v) => s.x[v.index]).length;
        e += on > 1 ? (s.B * on * (on - 1)) / 2 : 0;
      }
    }
    return e;
  }

  // ---------------------------------------------------------------- ④ Wirkung der Terme
  function renderEffects(s) {
    const { vars, tasks, robots, rowVars, colVars } = ctx(s);
    const rowDiv = el('div', { class: 'chart short' });
    const colDiv = el('div', { class: 'chart short' });
    const sweepA = el('div', { class: 'chart short' });
    const sweepB = el('div', { class: 'chart short' });
    fill(body,
      el('p', { class: 'fx-intro', html: `Wie wirken die Terme? Links die Strafen als Funktion davon, <b>wie viele Schalter</b> in einer Zeile bzw. Spalte an sind –
        mit deinen aktuellen Zeilen und Spalten markiert. Rechts unten: Ab welchem Strafgewicht wird das Minimum <b>gültig</b>? Klick in die Kurve setzt den Regler.` }),
      el('div', { class: 'grid grid-2' },
        el('div', {}, el('h4', {}, 'Zeilenregel zerlegt: warum genau eine 1?'), rowDiv,
          el('p', { class: 'hint', html: `Die <span style="color:${C.series}">Belohnung −A·k</span> macht jeden weiteren Schalter attraktiver, die
            <span style="color:${C.accent}">Paarstrafe +2A·(k über 2)</span> wächst quadratisch. Mit der Konstanten +A heben sie sich
            <b>nur bei k = 1</b> genau auf – dort ist die Linie (Summe) null.` })),
        el('div', {}, el('h4', {}, 'Spaltenregel: Strafe je Roboter'), colDiv,
          el('p', { class: 'hint', html: 'Mit 0 oder 1 Auftrag kostet ein Roboter nichts. Jeder weitere Auftrag bildet neue Paare – die Strafe wächst wie B·k(k−1)/2.' })),
        el('div', {}, el('h4', {}, 'Wie groß muss A sein?'), sweepA, el('p', { class: 'hint', 'data-sweep': 'A' })),
        el('div', {}, el('h4', {}, 'Wie groß muss B sein?'), sweepB, el('p', { class: 'hint', 'data-sweep': 'B' }))));

    const maxRow = Math.max(1, ...tasks.map((t) => rowVars(t.transport_id).length));
    const ks = Array.from({ length: maxRow + 1 }, (_, k) => k);
    const A = s.A;
    const rowAnn = tasks.map((t) => {
      const k = rowVars(t.transport_id).filter((v) => s.x[v.index]).length;
      return { k, label: `#${t.transport_id}` };
    });
    plot(rowDiv, [
      { type: 'bar', name: 'Konstante +A', x: ks, y: ks.map(() => A), marker: { color: C.axis }, hovertemplate: 'k = %{x}: Konstante %{y}<extra></extra>' },
      { type: 'bar', name: 'Belohnung −A·k', x: ks, y: ks.map((k) => -A * k), marker: { color: C.series }, hovertemplate: 'k = %{x}: Belohnung %{y}<extra></extra>' },
      { type: 'bar', name: 'Paarstrafe +2A·(k über 2)', x: ks, y: ks.map((k) => A * k * (k - 1)), marker: { color: C.accent }, hovertemplate: 'k = %{x}: Paarstrafe %{y}<extra></extra>' },
      { type: 'scatter', mode: 'lines+markers', name: 'Summe A(1−k)²', x: ks, y: ks.map((k) => A * (1 - k) ** 2), line: { color: C.ink, width: 2.5 }, marker: { size: 8, color: C.ink },
        hovertemplate: 'k = %{x}: Strafe A(1−k)² = %{y}<extra></extra>' },
    ], {
      barmode: 'relative', margin: { l: 52, r: 10, t: 40, b: 44 },
      xaxis: { title: { text: 'k = eingeschaltete Schalter in einer Zeile' }, dtick: 1 }, yaxis: { title: { text: 'Beitrag zur Energie' } },
      annotations: groupAnn(rowAnn).map(({ k, labels }) => ({ x: k, y: A * (1 - k) ** 2, text: labels.join(', '), showarrow: true, arrowhead: 2, ay: -34,
        arrowcolor: C.accent, font: { color: C.accent, size: 12 } })),
    });

    const maxCol = Math.max(2, tasks.length);
    const kc = Array.from({ length: maxCol + 1 }, (_, k) => k);
    const colAnn = robots.filter((r) => colVars(r.robot_id).length).map((r) => ({
      k: colVars(r.robot_id).filter((v) => s.x[v.index]).length, label: `R${r.robot_id}`,
    }));
    plot(colDiv, [{
      type: 'bar', x: kc, y: kc.map((k) => (s.B * k * (k - 1)) / 2), marker: { color: TERM_COLORS.spalte },
      hovertemplate: 'k = %{x} Aufträge: Strafe %{y}<extra></extra>',
    }], {
      margin: { l: 52, r: 10, t: 40, b: 44 },
      xaxis: { title: { text: 'k = Aufträge auf einem Roboter' }, dtick: 1 }, yaxis: { title: { text: 'Strafe B·k(k−1)/2' } },
      annotations: groupAnn(colAnn).map(({ k, labels }) => ({ x: k, y: (s.B * k * (k - 1)) / 2, text: labels.join(', '), showarrow: true,
        arrowhead: 2, ay: -30, arrowcolor: C.accent, font: { color: C.accent, size: 12 } })),
    });

    for (const [key, div] of [['A', sweepA], ['B', sweepB]]) {
      const res = drawSweep(s, key, div);
      const note = body.querySelector(`[data-sweep="${key}"]`);
      if (!res || !note) continue;
      const below = [...res.pts].reverse().find((p) => !p.valid && (res.threshold == null || p.val < res.threshold));
      const rule = key === 'A' ? 'die Zeilenregel (jeder Auftrag genau einen Roboter)' : 'die Spaltenregel (kein Roboter doppelt)';
      note.innerHTML = res.threshold == null
        ? `Im gezeigten Bereich wird das Minimum nie gültig – vermutlich gibt es mehr Aufträge als freie Roboter, irgendeine Regel muss dann brechen.`
        : res.threshold === 0
          ? `Hier ist das Minimum für jedes ${key} gültig – ${rule} wird schon durch die anderen Terme eingehalten.`
          : `Unterhalb von ${key} ≈ ${fmt(res.threshold)} ist es <b>billiger, ${rule} zu brechen</b>, als sie einzuhalten – z.B. ${key} = ${fmt(below.val)}: Minimum <b>${below.desc}</b> mit E = ${fmt(below.E)}.
             Die Schwelle ist genau der Preis, den das Einhalten der Regel mehr kostet als der billigste Regelbruch.`;
    }
  }

  function groupAnn(items) {
    const m = new Map();
    for (const it of items) m.set(it.k, [...(m.get(it.k) || []), it.label]);
    return [...m].map(([k, labels]) => ({ k, labels }));
  }

  function drawSweep(s, key, div) {
    const n = s.data.formulation.n;
    if (n > SWEEP_MAX_BITS) {
      fill(div, el('p', { class: 'hint' }, `Bei ${n} Schaltern zu aufwendig – die Kurve wird bis ${SWEEP_MAX_BITS} Schalter berechnet.`));
      div.style.minHeight = '0';
      return null;
    }
    const maxCost = Math.max(10, ...s.data.instance.variables.map((v) => v.cost));
    const top = Math.max(100, Math.ceil((maxCost * 2) / 10) * 10);
    const cacheKey = `${key}|${s.A}|${s.B}|${s.data.instance.tasks.map((t) => t.transport_id)}|${s.data.instance.mode}`;
    let pts = sweepCache.get(cacheKey);
    if (!pts) {
      pts = [];
      for (let k = 0; k <= 40; k += 1) {
        const val = Math.round((top * k) / 40);
        const m = makeModel(s.data.formulation, { A: key === 'A' ? val : s.A, B: key === 'B' ? val : s.B, terms: { kosten: true, zeile: true, spalte: true } });
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
      hovertemplate: `${key} = %{x}: Minimum E = %{y}<br>%{customdata[0]}<br>%{customdata[1]}<extra></extra>`,
    }], {
      margin: { l: 52, r: 10, t: 34, b: 44 },
      xaxis: { title: { text: `Strafgewicht ${key} (${key === 'A' ? 'B' : 'A'} = ${fmt(key === 'A' ? s.B : s.A)} fest, alle Regeln an)` } },
      yaxis: { title: { text: 'Energie des Minimums' }, rangemode: 'tozero' },
      shapes: [{ type: 'line', x0: cur, x1: cur, yref: 'paper', y0: 0, y1: 1, line: { color: C.accent, width: 2 } }],
      annotations: [
        { x: cur, yref: 'paper', y: 1, text: `aktuell ${key} = ${fmt(cur)}`, showarrow: false, yanchor: 'bottom', font: { color: C.accent } },
        { xref: 'paper', yref: 'paper', x: 0, y: 1.12, xanchor: 'left', showarrow: false, font: { color: C.ink2 },
          text: threshold != null && threshold > 0 ? `<span style="color:${C.series}">●</span> gültig ab ${key} ≈ ${fmt(threshold)}  <span style="color:${C.axis}">●</span> ungültig` : (threshold === 0 ? 'für jedes Gewicht gültig' : 'im gezeigten Bereich nie gültig – mehr Aufträge als Roboter?') },
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
