// „Die Formel dahinter“ für die Binary-Seite – vier Register wie bei One-Hot und Domain Wall:
//   ① Formel & Symbole   ② Eingesetzt   ③ Ausmultipliziert → QUBO (Grad, Hilfsbits)   ④ Wirkung der Terme
// Dazu die gemeinsamen Hilfen decodeBinary (Bits → Roboter) und polyEnergy (Polynom vor den Hilfsbits).
import { el, fill, nf } from '../util.js';
import { C, plot } from '../theme.js';
import { energy, fromMask, makeModel, search } from '../qubo/engine.js';

export const BIN_FORMULA_TABS = [
  { key: 'formel', label: '① Formel & Symbole' },
  { key: 'eingesetzt', label: '② Eingesetzt' },
  { key: 'qubo', label: '③ Ausmultipliziert → QUBO' },
  { key: 'wirkung', label: '④ Wirkung der Terme' },
];
export const BIN_DEFAULT_TAB = { 3: 'formel', 4: 'eingesetzt', 5: 'wirkung', 6: 'qubo' };
const POLY_KINDS = ['kosten', 'ungueltig']; // keine Spaltenregel: Doppelbelegung ist zulässig
const ALL = { kosten: true, ungueltig: true, hilfsbit: true };
const SWEEP_MAX_BITS = 16;
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (s) => String(s).replace(/\d/g, (d) => SUB[d]);
const fmt = (v) => nf(v, 1).replace('-', '−');
const signed = (v) => (v < 0 ? `− ${fmt(-v)}` : `+ ${fmt(v)}`);
const hl = (o) => `data-hl='${JSON.stringify(o)}'`;
const bit = (on) => (on ? '<b class="one">1</b>' : '<span class="zero">0</span>');

/** Wert des Polynoms vor den Hilfsbits (nur Auftrags-Bits zählen) – wie binary_poly_energy in Python. */
export function polyEnergy(form, x, A, B, terms) {
  let e = 0;
  for (const kind of POLY_KINDS) {
    if (!terms[kind]) continue;
    for (const t of form.polynomial[kind]) if (t.vars.every((i) => x[i])) e += t.c + t.A * A + t.B * B;
  }
  return e;
}

/** Bits → Code und Roboter je Auftrag; Verstöße: Phantomcode, Roboter doppelt, lügende Hilfsbits. */
export function decodeBinary(form, x, checkLies = true) {
  const tasks = form.tasks.map((t) => {
    if (!t.robots.length) return { task_id: t.task_id, code: null, robot: null, cost: null };
    const code = t.bits.reduce((acc, i, j) => acc + (x[i] << (t.nb - 1 - j)), 0);
    const ok = code < t.robots.length;
    return { task_id: t.task_id, code, robot: ok ? t.robots[code] : null, cost: ok ? t.costs[code] : null };
  });
  const issues = [];
  for (const t of tasks) {
    if (t.code == null) issues.push({ kind: 'leer', text: `#${t.task_id}: kein Roboter – nicht darstellbar` });
    else if (t.robot == null) issues.push({ kind: 'ungueltig', text: `#${t.task_id}: Code ${t.code} ist ein Phantom` });
  }
  const used = new Map(); // Doppelbelegung ist zulässig – nur gezählt, kein Verstoß
  for (const t of tasks) if (t.robot != null) used.set(t.robot, [...(used.get(t.robot) || []), t.task_id]);
  const lies = checkLies ? form.aux.filter((a) => x[a.index] !== x[a.pair[0]] * x[a.pair[1]]).map((a) => a.index) : [];
  if (lies.length) issues.push({ kind: 'hilfsbit', text: `${lies.length} Hilfsbit(s) lügen` });
  return { tasks, issues, valid: issues.length === 0, used, lies };
}

/**
 * @param {HTMLElement} host
 * @param {object} api  getState(), highlight(sel), clearHighlight(), setWeight(key, value), describe(x)
 */
export function createBinaryFormulaPanel(host, api) {
  let tab = 'formel';
  let task = null;
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
    const f = s.data.formulation;
    if (task == null || !f.tasks.some((t) => t.task_id === task && t.nb > 0)) task = f.tasks.find((t) => t.nb > 0)?.task_id ?? f.tasks[0]?.task_id;
    fill(bar, BIN_FORMULA_TABS.map((t) => el('button', {
      class: `seg-btn${t.key === tab ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(t.key === tab), onclick: () => setTab(t.key),
    }, t.label)));
    if (tab === 'formel') renderFormula(s);
    else if (tab === 'eingesetzt') renderSubstituted(s);
    else if (tab === 'qubo') renderExpansion(s);
    else renderEffects(s);
  }

  // ---------------------------------------------------------------- Hilfen
  const form = (s) => s.data.formulation;
  const unit = (s) => s.data.instance.criterion.unit;
  const zHtml = (s, i) => {
    const b = form(s).bits[i];
    return b.aux ? `<i>w</i><sub>${b.pos}</sub>` : `<i>z</i><sub>${b.task_id},${b.pos}</sub>`;
  };
  /** Indikator-Produkt eines Codes, wahlweise mit eingesetzten Bits. */
  function indHtml(s, t, code, x) {
    if (!t.nb) return '1';
    return t.bits.map((i, j) => {
      const one = (code >> (t.nb - 1 - j)) & 1;
      const v = x ? bit(x[i]) : zHtml(s, i);
      return one ? v : `(1 − ${v})`;
    }).join('·');
  }
  const indVal = (t, code, x) => t.bits.every((i, j) => x[i] === ((code >> (t.nb - 1 - j)) & 1)) ? 1 : 0;
  const offNote = (s, kind) => {
    if (s.terms[kind]) return '';
    const stepOf = { kosten: 3, ungueltig: 4, hilfsbit: 5 }[kind];
    return s.step < stepOf ? `kommt in Schritt ${stepOf}` : 'gerade ausgeschaltet';
  };
  const cls = (kind) => ({ kosten: 'kosten', ungueltig: 'zeile', spalte: 'spalte', hilfsbit: 'reihenfolge' }[kind]);
  const taskChips = (s) => form(s).tasks.filter((t) => t.nb > 0)
    .map((t) => `<button type="button" class="chip" data-task-pick="${t.task_id}" aria-pressed="${t.task_id === task}">#${t.task_id}</button>`).join(' ');
  const bindChips = () => body.querySelectorAll('[data-task-pick]').forEach((b) => b.addEventListener('click', () => { task = Number(b.dataset.taskPick); render(); }));

  // ---------------------------------------------------------------- ① Formel & Symbole
  function renderFormula(s) {
    const f = form(s);
    const line = (kind, lhs, term, note) => {
      const off = offNote(s, kind);
      return `<div class="fx-line t-${cls(kind)}${off ? ' off' : ''}" ${hl({ kind })}>
        <span class="fx-lhs">${lhs}</span><span class="fx-term">${term}</span>
        <span class="fx-note">${note}${off ? ` <em>(${off})</em>` : ''}</span></div>`;
    };
    const degs = Object.entries(f.degrees_before).map(([d, n]) => `${n}× Grad ${d}`).join(', ');
    body.innerHTML = `
      <p class="fx-intro">Die komplette Binary-Formulierung: <b>Polynom</b> über die Auftrags-Bits (bis Grad ${f.max_degree}); ab Grad 3 macht die letzte Zeile daraus eine QUBO.
        Keine Spaltenregel – Doppelbelegung ist zulässig, die Aufträge koppeln nicht.</p>
      <div class="fx">
        ${line('kosten', '<i>E</i>(<i>z</i>) =', 'Σ<sub><i>t</i></sub> Σ<sub><i>k</i> &lt; <i>R<sub>t</sub></i></sub> <i>c</i><sub><i>t</i>,<i>k</i></sub> · <i>I</i><sub><i>t</i>,<i>k</i></sub>(<i>z</i>)',
    '<b>Kosten:</b> <i>I</i><sub>t,k</sub> = 1 genau beim Code <i>k</i>.')}
        ${line('ungueltig', '+', '<i>A</i> · Σ<sub><i>t</i></sub> Σ<sub><i>k</i> ≥ <i>R<sub>t</sub></i></sub> <i>I</i><sub><i>t</i>,<i>k</i></sub>(<i>z</i>)',
    '<b>Ungültige Codes:</b> Phantome kosten A – sonst 0, und sie gewinnen.')}
        ${line('hilfsbit', '+', '<i>M</i> · Σ<sub><i>w</i></sub> ( <i>xy</i> − 2<i>xw</i> − 2<i>yw</i> + 3<i>w</i> )',
    '<b>Hilfsbits:</b> <i>w</i> ersetzt ein Paar <i>x</i>·<i>y</i> in Termen vom Grad > 2; Strafe 0 genau bei <i>w</i> = <i>xy</i>.')}
        <div class="fx-line" style="border-color:${C.axis}" ${hl({ all: true })}><span class="fx-lhs">mit</span>
          <span class="fx-term"><i>I</i><sub><i>t</i>,<i>k</i></sub> = Π<sub><i>j</i></sub> ( <i>z</i><sub><i>t</i>,<i>j</i></sub> falls Stelle <i>j</i> von <i>k</i> = 1, sonst 1 − <i>z</i><sub><i>t</i>,<i>j</i></sub> )</span>
          <span class="fx-note">Produkt über alle ⌈log₂ R⌉ Bits – schon die Kosten haben Grad ⌈log₂ R⌉.</span></div>
      </div>
      <table class="data symbols">
        <thead><tr><th>Symbol</th><th>Bedeutung</th><th>in diesem Szenario</th></tr></thead>
        <tbody>
          <tr ${hl({ kind: 'kosten' })}><td><i>z</i><sub><i>t</i>,<i>j</i></sub></td><td>Stelle <i>j</i> der Roboternummer von Auftrag <i>t</i> (höchste Stelle zuerst)</td>
            <td>${f.tasks.map((t) => `#${t.task_id}: ${t.nb} Bit${t.nb === 1 ? '' : 's'}`).join(' · ')}</td></tr>
          <tr ${hl({ all: true })}><td><i>k</i></td><td>Code = Roboternummer (${f.order === 'kosten' ? 'billigster = 0' : 'nach Roboternummer'})</td>
            <td>${f.tasks.map((t) => `#${t.task_id}: ${t.robots.map((r, k) => `${k}→R${r}`).join(' ')}`).join(' · ')}</td></tr>
          <tr ${hl({ kind: 'hilfsbit' })}><td><i>w</i></td><td>Hilfsbit für ein Paar – später ein eigenes Qubit</td>
            <td>${f.aux.map((a) => `${zHtml(s, a.index)} = ${zHtml(s, a.pair[0])}${zHtml(s, a.pair[1])}`).join(', ') || '– (Grad ≤ 2)'}</td></tr>
          <tr ${hl({ all: true })}><td>Grad</td><td>Terme vor den Hilfsbits</td><td>${degs || '–'}</td></tr>
          <tr ${hl({ kind: 'ungueltig' })}><td><i>A</i>, <i>M</i></td><td>Strafgewichte</td><td>${fmt(s.A)}, ${fmt(s.M)} (Regler)</td></tr>
        </tbody>
      </table>`;
  }

  // ---------------------------------------------------------------- ② Eingesetzt
  function renderSubstituted(s) {
    const f = form(s);
    const x = s.x;
    const rows = [];
    let total = 0;
    for (const t of f.tasks.filter((tt) => tt.robots.length)) {
      const val = t.costs.reduce((acc, c, k) => acc + c * indVal(t, k, x), 0);
      if (s.terms.kosten) total += val;
      rows.push({ kind: 'kosten', sel: { task: t.task_id }, name: `Kosten #${t.task_id}`,
        formula: t.costs.map((c, k) => `${fmt(c)}·${indHtml(s, t, k)}`).join(' + '),
        subst: t.costs.map((c, k) => `${fmt(c)}·${indHtml(s, t, k, x)}`).join(' + '), value: val });
      const invalid = t.codes.filter((c) => c.robot_id == null);
      if (invalid.length) {
        const pv = s.A * invalid.reduce((acc, c) => acc + indVal(t, c.code, x), 0);
        if (s.terms.ungueltig) total += pv;
        rows.push({ kind: 'ungueltig', sel: { task: t.task_id }, name: `Phantome #${t.task_id}`,
          formula: `<i>A</i>·[ ${invalid.map((c) => indHtml(s, t, c.code)).join(' + ')} ]`,
          subst: `${fmt(s.A)}·[ ${invalid.map((c) => indHtml(s, t, c.code, x)).join(' + ')} ]`, value: pv, ok: pv === 0 });
      }
    }
    if (s.qubo) {
      for (const a of f.aux) {
        const [px, py] = a.pair;
        const pen = x[px] * x[py] - 2 * x[px] * x[a.index] - 2 * x[py] * x[a.index] + 3 * x[a.index];
        if (s.terms.hilfsbit) total += s.M * pen;
        rows.push({ kind: 'hilfsbit', sel: { vars: [a.index, px, py] }, name: `Hilfsbit ${zHtml(s, a.index)}`,
          formula: `<i>M</i>·(${zHtml(s, px)}${zHtml(s, py)} − 2${zHtml(s, px)}${zHtml(s, a.index)} − 2${zHtml(s, py)}${zHtml(s, a.index)} + 3${zHtml(s, a.index)})`,
          subst: `${fmt(s.M)}·(${bit(x[px])}·${bit(x[py])} − 2·${bit(x[px])}·${bit(x[a.index])} − 2·${bit(x[py])}·${bit(x[a.index])} + 3·${bit(x[a.index])})`,
          value: s.M * pen, ok: pen === 0 });
      }
    }
    body.innerHTML = `
      <p class="fx-intro">Die Formel mit den Zahlen dieses Szenarios und deinen Bits; jedes Indikator-Produkt ist 1 genau für den gezeigten Code.
        ${s.qubo ? 'Hilfsbit-Zeilen sind 0, solange die Hilfsbits ehrlich sind.' : 'Hilfsbits ab Schritt 6.'}</p>
      <div class="table-wrap"><table class="data fx-table">
        <thead><tr><th>Term</th><th>Formel mit Zahlen</th><th>mit deinen Bits eingesetzt</th><th class="num">Wert</th></tr></thead>
        <tbody>${rows.map((r) => {
    const off = !s.terms[r.kind];
    return `<tr class="t-row t-${cls(r.kind)}${off ? ' off' : ''}" ${hl(r.sel)}><td><span class="t-name">${r.name}</span></td>
            <td class="fx-cell">${r.formula}</td><td class="fx-cell">${r.subst}</td>
            <td class="num ${off ? '' : r.ok === false ? 'no-val' : ''}">${off ? `<em>${offNote(s, r.kind)}</em>` : fmt(r.value)}</td></tr>`;
  }).join('')}
          <tr class="fx-total"><td colspan="3">Summe aller aktiven Terme</td><td class="num">${fmt(total)}</td></tr>
        </tbody></table></div>`;
  }

  // ---------------------------------------------------------------- ③ Ausmultipliziert → QUBO
  function renderExpansion(s) {
    const f = form(s);
    const t = f.tasks.find((tt) => tt.task_id === task);
    let costHtml = '<p class="hint">Nur ein Roboter – nichts auszumultiplizieren.</p>';
    if (t && t.nb > 0) {
      const terms = f.polynomial.kosten.filter((p) => p.vars.length && p.vars.every((i) => t.bits.includes(i)));
      const pos = (i) => t.bits.indexOf(i);
      // Koeffizient eines Produkts = Σ über Codes mit Einsen nur an diesen Stellen, Vorzeichen nach fehlenden Einsen
      const mix = (vars) => {
        const S = vars.map(pos);
        const parts = [];
        for (let m = 0; m < 1 << S.length; m += 1) {
          let code = 0;
          let ones = 0;
          S.forEach((p, k) => { if ((m >> k) & 1) { code |= 1 << (t.nb - 1 - p); ones += 1; } });
          const c = code < t.robots.length ? t.costs[code] : 0;
          parts.push(`${(S.length - ones) % 2 ? '−' : '+'} ${fmt(c)}`);
        }
        return parts.join(' ').replace(/^\+ /, '');
      };
      costHtml = `<div class="fx-derivation t-kosten${s.terms.kosten ? '' : ' off'}" ${hl({ task: t.task_id })}>
          <div>${t.costs.map((c, k) => `${fmt(c)}·${indHtml(s, t, k)}`).join(' + ')}</div>
          <div><span class="eq">=</span> <span class="p-const">${fmt(t.costs[0])}</span>
            ${terms.map((p) => `<span class="${p.vars.length > 1 ? 'p-pair' : 'p-lin'}">${signed(p.c)}·${p.vars.map((i) => zHtml(s, i)).join('')}</span>`).join(' ')}</div>
          <div class="why">Jeder Koeffizient mischt mehrere Roboter: ${terms.filter((p) => p.vars.length > 1).map((p) => `${p.vars.map((i) => zHtml(s, i)).join('')}: ${mix(p.vars)} = ${fmt(p.c)}`).join(' · ') || '–'}.
            Grad ${t.nb}: ${t.nb > 2 ? '<b>schon die Kosten sind keine QUBO</b> (über 4 Roboter → 3 Bits).' : 'noch QUBO-tauglich.'}</div>
        </div>`;
    }
    const kindDeg = POLY_KINDS.map((kind) => {
      const counts = {};
      for (const p of f.polynomial[kind]) if (p.vars.length) counts[p.vars.length] = (counts[p.vars.length] || 0) + 1;
      return { kind, counts };
    });
    const maxDeg = Math.max(1, f.max_degree);
    const degTable = `<table class="data"><thead><tr><th>Herkunft</th>${Array.from({ length: maxDeg }, (_, d) => `<th class="num">Grad ${d + 1}</th>`).join('')}</tr></thead>
      <tbody>${kindDeg.map((r) => `<tr class="t-row t-${cls(r.kind)}" ${hl({ kind: r.kind })}><td>${{ kosten: 'Kosten', ungueltig: 'Ungültige Codes' }[r.kind]}</td>
        ${Array.from({ length: maxDeg }, (_, d) => `<td class="num${d + 1 > 2 && r.counts[d + 1] ? ' no-val' : ''}">${r.counts[d + 1] || ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const auxHtml = f.aux.length
      ? `<div class="fx-derivation t-reihenfolge${s.terms.hilfsbit ? '' : ' off'}">
          ${f.aux.map((a) => `<div ${hl({ vars: [a.index, ...a.pair] })}>${zHtml(s, a.index)} ersetzt ${zHtml(s, a.pair[0])}·${zHtml(s, a.pair[1])} in ${a.replaced} Term${a.replaced === 1 ? '' : 'en'}
            &nbsp;→&nbsp; <span class="p-pair">${fmt(s.M)}·(${zHtml(s, a.pair[0])}${zHtml(s, a.pair[1])} − 2${zHtml(s, a.pair[0])}${zHtml(s, a.index)} − 2${zHtml(s, a.pair[1])}${zHtml(s, a.index)} + 3${zHtml(s, a.index)})</span></div>`).join('')}
          <div class="why">Das häufigste Paar in Termen vom Grad > 2 zuerst, bis kein Term mehr als zwei Bits hat. Jedes Hilfsbit = ein Qubit mehr, plus Kopplungen zu seinem Paar.</div>
        </div>`
      : '<p class="hint">Kein Term über zwei Bits – keine Hilfsbits nötig.</p>';
    const model = s.model;
    const lin = model.entries.filter((e) => e.i === e.j && e.value !== 0);
    const quad = model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const termHtml = [...lin.map((e) => `<span class="q-term" ${hl({ vars: [e.i] })}>${signed(e.value)}·${zHtml(s, e.i)}</span>`),
      ...quad.map((e) => `<span class="q-term" ${hl({ vars: [e.i, e.j] })}>${signed(e.value)}·${zHtml(s, e.i)}${zHtml(s, e.j)}</span>`)];
    const honest = Uint8Array.from(s.x);
    for (const a of f.aux) honest[a.index] = honest[a.pair[0]] * honest[a.pair[1]];
    const quboFull = makeModel(f, { A: s.A, B: 0, D: s.M, terms: ALL });
    const Eq = energy(quboFull, honest);
    const Ep = polyEnergy(f, honest, s.A, 0, ALL);
    body.innerHTML = `
      <p class="fx-intro">Anders als bei One-Hot und Domain Wall: jeder Roboter ist ein <b>Produkt</b> aller Bits des Auftrags, die Spaltenregel ein Produkt
        zweier Produkte – erst Hilfsbits bringen alles auf Grad 2.</p>
      <h4>Kosten eines Auftrags: ${taskChips(s)}</h4>${costHtml}
      <h4>Terme vor den Hilfsbits nach Grad (rot = kein QUBO-Term)</h4>${degTable}
      <h4>Hilfsbits: Paare ersetzen</h4>${auxHtml}
      <h4>Fertige QUBO-Form – das bekommt die Hardware${s.qubo ? '' : ' (ab Schritt 6)'}</h4>
      <div class="fx-qubo"><i>E</i> = ${termHtml.slice(0, 30).join(' ')}${termHtml.length > 30 ? ` <span class="hint">… und ${termHtml.length - 30} weitere Terme</span>` : ''} <span class="q-term">${signed(model.constant)}</span></div>
      <p class="fx-probe">Probe mit deinen Auftrags-Bits und ehrlichen Hilfsbits: QUBO <b>${fmt(Eq)}</b>, Polynom <b>${fmt(Ep)}</b>
        ${Math.abs(Eq - Ep) < 1e-6 ? '<span class="okline">✓ identisch – die Hilfsbits ändern nichts, solange sie ehrlich sind.</span>' : '<span class="warnline">✗ Abweichung</span>'}</p>`;
    bindChips();
  }

  // ---------------------------------------------------------------- ④ Wirkung der Terme
  function renderEffects(s) {
    const f = form(s);
    const t = f.tasks.find((tt) => tt.task_id === task);
    const sweeps = { A: el('div', { class: 'chart short' }), M: el('div', { class: 'chart short' }) };
    const codeTable = t && t.robots.length
      ? el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Code'), el('th', {}, 'Roboter'), el('th', { class: 'num' }, `Kosten-Term [${unit(s)}]`), el('th', { class: 'num' }, 'A · Phantom'), el('th', { class: 'num' }, 'Summe'))),
        el('tbody', {}, t.codes.map((c) => {
          const pen = c.robot_id == null ? s.A : 0;
          const cost = c.robot_id == null ? 0 : c.cost;
          return el('tr', { class: c.robot_id == null ? 'warnrow' : '' }, el('td', { class: 'mono' }, c.pattern || '–'),
            el('td', {}, c.robot_id != null ? `R${c.robot_id}` : 'Phantom'), el('td', { class: 'num' }, fmt(cost)), el('td', { class: 'num' }, fmt(pen)),
            el('td', { class: 'num' }, el('b', {}, fmt(cost + pen))));
        })))
      : el('p', { class: 'hint' }, 'Kein Auftrag mit Bits gewählt.');
    const ros = el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'x'), el('th', { class: 'num' }, 'y'), el('th', { class: 'num' }, 'w'), el('th', {}, 'w = x·y?'),
        el('th', { class: 'num' }, 'xy − 2xw − 2yw + 3w'), el('th', { class: 'num' }, `× M = ${fmt(s.M)}`))),
      el('tbody', {}, [0, 1].flatMap((xx) => [0, 1].flatMap((yy) => [0, 1].map((ww) => {
        const pen = xx * yy - 2 * xx * ww - 2 * yy * ww + 3 * ww;
        const ok = ww === xx * yy;
        return el('tr', { class: ok ? '' : 'warnrow' }, el('td', { class: 'num' }, xx), el('td', { class: 'num' }, yy), el('td', { class: 'num' }, ww),
          el('td', { class: ok ? 'ok' : 'no' }, ok ? '✓ ehrlich' : '✗ lügt'), el('td', { class: 'num' }, pen), el('td', { class: 'num' }, fmt(pen * s.M)));
      })))));
    fill(body,
      el('p', { class: 'fx-intro', html: `Codebuch eines Auftrags (ohne Strafe ist ein Phantom gratis), Hilfsbit-Strafe in allen 8 Fällen und der
        <b>Gültigkeitsbereich</b> je Gewicht. Klick in eine Kurve setzt das Gewicht.` }),
      el('div', { class: 'grid grid-2' },
        el('div', {}, el('h4', { html: `Codebuch von Auftrag ${taskChips(s)}` }), codeTable),
        el('div', {}, el('h4', {}, 'Hilfsbit-Strafe: 0 genau dann, wenn w = x·y'), ros,
          el('p', { class: 'hint' }, 'Jede Lüge kostet ≥ M. Lohnt sie sich trotzdem (große Strafe → Belohnung), ist M zu klein.'))),
      el('div', { class: 'grid grid-2' },
        el('div', {}, el('h4', {}, 'Wie groß muss A sein? (Phantome)'), sweeps.A, el('p', { class: 'hint', 'data-sweep': 'A' })),
        f.aux.length ? el('div', {}, el('h4', {}, 'Wie groß muss M sein? (Hilfsbits)'), sweeps.M, el('p', { class: 'hint', 'data-sweep': 'M' })) : null));
    bindChips();
    for (const key of f.aux.length ? ['A', 'M'] : ['A']) {
      const res = drawSweep(s, key, sweeps[key]);
      const note = body.querySelector(`[data-sweep="${key}"]`);
      if (!res || !note) continue;
      const below = res.lo != null ? [...res.pts].reverse().find((p) => !p.valid && p.val < res.lo) : null;
      const above = res.bounded ? res.pts.find((p) => !p.valid && p.val > res.hi) : null;
      const parts = [];
      if (res.lo == null) parts.push('Im Bereich nie gültig – mehr Aufträge als Roboter oder ein anderes Gewicht zu klein.');
      else if (res.lo === 0 && !res.bounded) parts.push(`Für jedes ${key} gültig – die Regel hält der Rest ein.`);
      if (below) parts.push(`Unter ${key} ≈ ${fmt(res.lo)}: <b>${below.desc}</b>${key === 'M' ? ' – ein Hilfsbit lügt' : ''}.`);
      if (above) parts.push(`<b>Über ${key} ≈ ${fmt(res.hi)} kippt es wieder</b>: <b>${above.desc}</b> – zu großes Gewicht macht eine Hilfsbit-Lüge lohnend.`);
      note.innerHTML = parts.join(' ');
    }
  }

  function drawSweep(s, key, div) {
    const f = form(s);
    if (f.n > SWEEP_MAX_BITS) {
      fill(div, el('p', { class: 'hint' }, `Kurve nur bis ${SWEEP_MAX_BITS} Qubits (hier ${f.n}).`));
      div.style.minHeight = '0';
      return null;
    }
    const cur = { A: s.A, B: 0, M: s.M };
    const top = Math.max(100, Math.ceil((Math.max(cur.A, cur.B, cur.M) * 1.6) / 10) * 10);
    const cacheKey = `${key}|${s.A}|${s.M}|${f.tasks.map((t) => `${t.task_id}:${t.robots}`)}|${f.const.c}`;
    let pts = sweepCache.get(cacheKey);
    if (!pts) {
      pts = [];
      for (let k = 0; k <= 40; k += 1) {
        const val = Math.round((top * k) / 40);
        const w = { ...cur, [key]: val };
        const m = makeModel(f, { A: w.A, B: w.B, D: w.M, terms: ALL });
        const r = search(m, 1);
        const x = fromMask(r.min.mask, f.n);
        pts.push({ val, E: r.min.E, valid: decodeBinary(f, x).valid, desc: api.describe(x) });
      }
      sweepCache.set(cacheKey, pts);
    }
    const validPts = pts.filter((p) => p.valid);
    const lo = validPts.length ? validPts[0].val : null;
    const hi = validPts.length ? validPts[validPts.length - 1].val : null;
    const bounded = hi != null && !pts[pts.length - 1].valid;
    div.style.minHeight = '';
    plot(div, [{
      type: 'scatter', mode: 'lines+markers', x: pts.map((p) => p.val), y: pts.map((p) => p.E),
      line: { color: C.axis, width: 1.5 }, marker: { size: 8, color: pts.map((p) => (p.valid ? C.series : C.axis)), line: { color: C.surface, width: 1 } },
      customdata: pts.map((p) => [p.desc, p.valid ? '✓ gültig' : '✗ ungültig']),
      hovertemplate: `${key} = %{x}: Minimum E = %{y}<br>%{customdata[0]}<br>%{customdata[1]}<extra></extra>`,
    }], {
      margin: { l: 52, r: 10, t: 34, b: 44 },
      xaxis: { title: { text: `Strafgewicht ${key} (andere fest, alle Regeln an)` } },
      yaxis: { title: { text: 'Energie des Minimums' } },
      shapes: [{ type: 'line', x0: cur[key], x1: cur[key], yref: 'paper', y0: 0, y1: 1, line: { color: C.accent, width: 2 } }],
      annotations: [
        { x: cur[key], yref: 'paper', y: 0, text: `aktuell ${key} = ${fmt(cur[key])}`, showarrow: false, yanchor: 'bottom', xanchor: 'left', xshift: 4, font: { color: C.accent } },
        { xref: 'paper', yref: 'paper', x: 0, y: 1.12, xanchor: 'left', showarrow: false, font: { color: C.ink2 },
          text: lo == null ? 'im gezeigten Bereich nie gültig'
            : `<span style="color:${C.series}">●</span> gültig ${bounded ? `zwischen ${key} ≈ ${fmt(lo)} und ${fmt(hi)}` : lo > 0 ? `ab ${key} ≈ ${fmt(lo)}` : 'für jedes Gewicht'}  <span style="color:${C.axis}">●</span> ungültig` },
      ],
    });
    div.removeAllListeners?.('plotly_click');
    div.on('plotly_click', (ev) => {
      const p = ev.points && ev.points[0];
      if (p) api.setWeight(key, p.x);
    });
    return { pts, lo, hi, bounded };
  }

  return { render, setTab, get tab() { return tab; } };
}
