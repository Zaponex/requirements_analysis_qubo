// „Die Formel dahinter“ für Domain Wall in der Sofortzuweisung (IA). Die Kette liegt auf der Seite, die vollständig
// zugewiesen wird: T ≤ R je Auftrag (Bits d_t,i), T > R je Roboter (Bits e_i,r). Vier Register wie bei One-Hot:
//   ① Formel & Fälle   ② Eingesetzt   ③ Ausmultipliziert → QUBO   ④ Wirkung der Terme
// Formelteile tragen data-hl – beim Überfahren hebt die Seite die passenden Bits hervor.
import { el, fill, nf } from '../util.js';
import { C, plot } from '../theme.js';
import { energy, fromMask, makeModel, search } from '../qubo/engine.js';
import { formulaHtml } from './onehotCriterion.js';
import { CASE_LABELS, CASE_ORDER, CASE_TEXTS } from '../components/iaScenario.js';

export const DW_IA_TABS = [
  { key: 'formel', label: '① Formel & Fälle' },
  { key: 'eingesetzt', label: '② Eingesetzt' },
  { key: 'qubo', label: '③ Ausmultipliziert → QUBO' },
  { key: 'wirkung', label: '④ Wirkung der Terme' },
];
export const DW_IA_DEFAULT_TAB = { 1: 'formel', 3: 'formel', 4: 'wirkung', 5: 'wirkung', 6: 'qubo' };
export const TERMS = ['kosten', 'kette', 'quer'];
const ALL = { kosten: true, kette: true, quer: true };
const SWEEP_MAX_BITS = 16;

// ---------------------------------------------------------------- Fälle und Namen (auch von der Seite genutzt)
/** Kette je Auftrag ("zeile", T ≤ R) oder je Roboter ("spalte", T > R) – wie formulations.domain_wall_ia. */
export const SIDE = { 'T=R': 'zeile', 'T<R': 'zeile', 'T>R': 'spalte' };
export const CROSS_EXACT = { 'T=R': true, 'T<R': false, 'T>R': false };
const H = (prime, sub) => `<i>H</i>${prime ? '′' : ''}<sub>${sub}</sub>`;
export const objName = (side) => H(side === 'spalte', 'obj_DW');
export const chainName = (side) => H(side === 'spalte', 'pen_DW');
export const crossName = (caseKey) => ({ 'T=R': H(false, 'pen2'), 'T<R': H(true, 'pen2'), 'T>R': H(true, 'pen1') })[caseKey];
export const termName = (kind, caseKey) => ({ kosten: objName, kette: chainName }[kind]?.(SIDE[caseKey]) ?? crossName(caseKey));
export const crossTitle = (caseKey) => (SIDE[caseKey] === 'zeile' ? 'Roboterregel' : 'Auftragsregel');
export const chainText = (side) => (side === 'zeile' ? 'jeder Auftrag genau einen Roboter' : 'jeder Roboter genau einen Auftrag');
export const crossText = (caseKey) => ({
  'T=R': 'jeder Roboter genau einen Auftrag', 'T<R': 'jeder Roboter höchstens einen Auftrag', 'T>R': 'jeder Auftrag höchstens einen Roboter',
})[caseKey];

const S = (sub, sup) => `Σ<sub>${sub}</sub>${sup ? `<sup>${sup}</sup>` : ''}`;
const d = (a, b) => `<i>d</i><sub>${a},${b}</sub>`;
const e = (a, b) => `<i>e</i><sub>${a},${b}</sub>`;
const c = (a, b) => `<i>c</i><sub>${a},${b}</sub>`;
const I = (s) => `<i>${s}</i>`;
/** x als Differenz zweier Kettenbits, mit festen Rändern. */
export const xDef = (side) => (side === 'zeile'
  ? `<i>x</i><sub><i>t</i>,<i>r</i></sub> = ${d(I('t'), `${I('r')}−1`)} − ${d(I('t'), I('r'))},&nbsp; ${d(I('t'), 0)} = 1,&nbsp; ${d(I('t'), I('R'))} = 0`
  : `<i>x</i><sub><i>t</i>,<i>r</i></sub> = ${e(`${I('t')}−1`, I('r'))} − ${e(I('t'), I('r'))},&nbsp; ${e(0, I('r'))} = 1,&nbsp; ${e(I('T'), I('r'))} = 0`);
export const objFormula = (side) => (side === 'zeile'
  ? `${S(I('t'))} ( ${c(I('t'), 1)} + ${S(`${I('i')}=1`, `${I('R')}−1`)} (${c(I('t'), `${I('i')}+1`)} − ${c(I('t'), I('i'))}) ${d(I('t'), I('i'))} )`
  : `${S(I('r'))} ( ${c(1, I('r'))} + ${S(`${I('i')}=1`, `${I('T')}−1`)} (${c(`${I('i')}+1`, I('r'))} − ${c(I('i'), I('r'))}) ${e(I('i'), I('r'))} )`);
export const chainFormula = (side) => (side === 'zeile'
  ? `${S(I('t'))} ${S(`${I('i')}=1`, `${I('R')}−2`)} ${d(I('t'), `${I('i')}+1`)} ( 1 − ${d(I('t'), I('i'))} )`
  : `${S(I('r'))} ${S(`${I('i')}=1`, `${I('T')}−2`)} ${e(`${I('i')}+1`, I('r'))} ( 1 − ${e(I('i'), I('r'))} )`);
export const crossFormula = (caseKey) => ({
  'T=R': `${S(I('r'))} ( 1 − ${S(I('t'))} (${d(I('t'), `${I('r')}−1`)} − ${d(I('t'), I('r'))}) )²`,
  'T<R': `${S(I('r'))} ${S(`${I('t')}&lt;${I('t')}′`)} (${d(I('t'), `${I('r')}−1`)} − ${d(I('t'), I('r'))})(${d(`${I('t')}′`, `${I('r')}−1`)} − ${d(`${I('t')}′`, I('r'))})`,
  'T>R': `${S(I('t'))} ${S(`${I('r')}&lt;${I('r')}′`)} (${e(`${I('t')}−1`, I('r'))} − ${e(I('t'), I('r'))})(${e(`${I('t')}−1`, `${I('r')}′`)} − ${e(I('t'), `${I('r')}′`)})`,
})[caseKey];

export const linVal = (f, x) => f.const + Object.entries(f.terms).reduce((acc, [i, v]) => acc + v * x[Number(i)], 0);

/**
 * Bits auslesen (wie decode_domain_wall_ia in Python): Wände je Kette, gewähltes Paar, x je Variable
 * (−1 an einer falschen Wand), Querregel je Gruppe und alle Verstöße.
 */
export function decodeIa(form, x) {
  const zeile = form.side === 'zeile';
  const chains = form.chains.map((ch) => {
    const b = [1, ...ch.bits.map((i) => x[i]), 0];
    const down = [];
    const up = [];
    for (let k = 0; k < b.length - 1; k += 1) {
      if (b[k] === 1 && b[k + 1] === 0) down.push(k);
      if (b[k] === 0 && b[k + 1] === 1) up.push(k);
    }
    const valid = ch.members.length > 0 && up.length === 0;
    const k = valid ? down[0] : null;
    return { ch, b, down, up, valid, k, name: zeile ? `#${ch.key}` : `R${ch.key}`,
      task: valid ? ch.task_ids[k] : null, robot: valid ? ch.robot_ids[k] : null, cost: valid ? ch.costs[k] : null };
  });
  const picks = chains.filter((ch) => ch.valid).map((ch) => [ch.task, ch.robot]);
  const xs = form.x_forms.map((f) => (f ? linVal(f, x) : 0));
  const cross = form.rules.filter((r) => r.kind === 'quer').map((r) => {
    const onRobot = r.robot_id != null;
    const vals = r.deltas.map((f) => linVal(f, x));
    const sum = vals.reduce((a, v) => a + v, 0);
    let prod = 0;
    for (let i = 0; i < vals.length; i += 1) for (let j = i + 1; j < vals.length; j += 1) prod += vals[i] * vals[j];
    const n = picks.filter(([t, ro]) => (onRobot ? ro === r.robot_id : t === r.task_id)).length;
    return { rule: r, onRobot, key: onRobot ? r.robot_id : r.task_id, name: onRobot ? `R${r.robot_id}` : `#${r.task_id}`, vals, sum, prod, n,
      ok: r.exact ? n === 1 : n <= 1, penalty: r.exact ? (1 - sum) ** 2 : prod };
  });
  const issues = [];
  for (const ch of chains) {
    if (!ch.ch.members.length) issues.push({ kind: 'leer', key: ch.ch.key, text: `${ch.name}: nicht darstellbar` });
    else if (!ch.valid) issues.push({ kind: 'kette', key: ch.ch.key, text: `${ch.name}: Kette gebrochen` });
  }
  for (const q of cross) {
    if (q.ok) continue;
    const what = q.onRobot ? (q.n === 0 ? 'ohne Auftrag' : `${q.n} Aufträge`) : `${q.n} Roboter`;
    issues.push({ kind: 'quer', key: q.key, text: `${q.name}: ${what}` });
  }
  return { chains, picks, xs, cross, issues, valid: issues.length === 0 };
}

const fmt = (v) => nf(v, 1).replace('-', '−');
const signed = (v) => (v < 0 ? `− ${fmt(-v)}` : `+ ${fmt(v)}`);
const coefB = (v) => `${v < 0 ? '−' : '+'} ${Math.abs(v) === 1 ? '' : fmt(Math.abs(v))}<i>B</i>`;
const hl = (o) => `data-hl='${JSON.stringify(o)}'`;
const bit = (on) => (on ? '<b class="one">1</b>' : '<span class="zero">0</span>');

/**
 * @param {HTMLElement} host
 * @param {object} api  getState(), highlight(sel), clearHighlight(), setWeight(key, value), describe(x)
 */
export function createIaDwFormulaPanel(host, api) {
  let tab = 'formel';
  let chainKey = null;
  let groupKey = null;
  const sweepCache = new Map();
  const bar = el('div', { class: 'seg', role: 'tablist' });
  const body = el('div', { class: 'formula-body' });
  fill(host, bar, body);
  body.addEventListener('mouseover', (ev) => {
    const t = ev.target.closest('[data-hl]');
    if (t) api.highlight(JSON.parse(t.dataset.hl));
  });
  body.addEventListener('mouseout', (ev) => {
    const t = ev.target.closest('[data-hl]');
    if (t && !t.contains(ev.relatedTarget)) api.clearHighlight();
  });

  function setTab(key, renderNow = true) {
    tab = key;
    if (renderNow) render();
  }
  function render() {
    const s = api.getState();
    if (!s.data) return;
    const f = s.data.formulation;
    if (!f.chains.some((ch) => ch.key === chainKey && ch.members.length)) {
      chainKey = (f.chains.find((ch) => ch.members.length > 2) || f.chains.find((ch) => ch.members.length > 1) || f.chains[0])?.key ?? null;
    }
    const groups = f.rules.filter((r) => r.kind === 'quer');
    if (!groups.some((r) => groupOf(r) === groupKey)) groupKey = groupOf(groups.find((r) => r.deltas.length > 1) || groups[0] || {});
    fill(bar, DW_IA_TABS.map((t) => el('button', {
      class: `seg-btn${t.key === tab ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(t.key === tab), onclick: () => setTab(t.key),
    }, t.label)));
    if (tab === 'formel') renderFormula(s);
    else if (tab === 'eingesetzt') renderSubstituted(s);
    else if (tab === 'qubo') renderExpansion(s);
    else renderEffects(s);
  }

  // ---------------------------------------------------------------- Hilfen
  const groupOf = (r) => r.robot_id ?? r.task_id ?? null;
  const form = (s) => s.data.formulation;
  const unit = (s) => s.data.instance.criterion.unit;
  const zeile = (s) => form(s).side === 'zeile';
  const member = (s, m) => (zeile(s) ? `R${m}` : `#${m}`);
  const chainLabel = (s, key) => (zeile(s) ? `#${key}` : `R${key}`);
  const groupLabel = (s, key) => (zeile(s) ? `R${key}` : `#${key}`);
  /** Bit als Formelzeichen: d_t,i (Kette je Auftrag) oder e_i,r (Kette je Roboter). */
  function bHtml(s, i) {
    const b = form(s).bits[i];
    return zeile(s) ? d(b.task_id, b.pos) : e(b.pos, b.robot_id);
  }
  /** x einer Variable als Differenz der Kettenbits, wahlweise mit eingesetzten Werten. */
  function xHtml(s, v, values) {
    const f = form(s).x_forms[v];
    if (!f) return '0';
    const parts = f.const ? [fmt(f.const)] : [];
    for (const [i, k] of Object.entries(f.terms)) {
      const sym = values ? bit(values[Number(i)]) : bHtml(s, Number(i));
      parts.push(`${k < 0 ? '− ' : parts.length ? '+ ' : ''}${sym}`);
    }
    if (!parts.length) return '0';
    return parts.length > 1 ? `(${parts.join(' ')})` : parts[0];
  }
  const offNote = (s, kind) => {
    if (s.terms[kind]) return '';
    const stepOf = { kosten: 3, kette: 4, quer: 5 }[kind];
    return s.step < stepOf ? `kommt in Schritt ${stepOf}` : 'gerade ausgeschaltet';
  };
  const cls = (kind) => ({ kette: 'zeile', quer: 'spalte' }[kind] || kind);
  const chainChips = (s) => form(s).chains.filter((ch) => ch.members.length > 1)
    .map((ch) => `<button type="button" class="chip" data-chain-pick="${ch.key}" aria-pressed="${ch.key === chainKey}">${chainLabel(s, ch.key)}</button>`).join(' ');
  const groupChips = (s) => form(s).rules.filter((r) => r.kind === 'quer')
    .map((r) => `<button type="button" class="chip" data-group-pick="${groupOf(r)}" aria-pressed="${groupOf(r) === groupKey}">${groupLabel(s, groupOf(r))}</button>`).join(' ');
  const bindChips = () => {
    body.querySelectorAll('[data-chain-pick]').forEach((b) => b.addEventListener('click', () => { chainKey = Number(b.dataset.chainPick); render(); }));
    body.querySelectorAll('[data-group-pick]').forEach((b) => b.addEventListener('click', () => { groupKey = Number(b.dataset.groupPick); render(); }));
  };
  const chainSel = (s, key) => (zeile(s) ? { task: key } : { robot: key });
  const groupSel = (s, key) => (zeile(s) ? { robot: key } : { task: key });

  // ---------------------------------------------------------------- ① Formel & Fälle
  function renderFormula(s) {
    const f = form(s);
    const caseKey = f.case;
    const side = f.side;
    const { tasks, robots } = s.data.instance;
    const line = (kind, lhs, term, note) => {
      const off = offNote(s, kind);
      return `<div class="fx-line t-${cls(kind)}${off ? ' off' : ''}" ${hl({ kind })}>
        <span class="fx-lhs">${lhs}</span><span class="fx-term">${term}</span>
        <span class="fx-note">${note}${off ? ` <em>(${off})</em>` : ''}</span></div>`;
    };
    const caseRows = CASE_ORDER.map((k) => {
      const sd = SIDE[k];
      return `<tr class="${k === caseKey ? 'selected' : 'dim'}"><td><b>${CASE_LABELS[k]}</b></td><td>${CASE_TEXTS[k]}</td>
        <td>je ${sd === 'zeile' ? 'Auftrag' : 'Roboter'} (${sd === 'zeile' ? d(I('t'), I('i')) : e(I('i'), I('r'))})</td>
        <td class="num">${sd === 'zeile' ? '<i>T</i>(<i>R</i> − 1)' : '<i>R</i>(<i>T</i> − 1)'}</td>
        <td class="fx-cell">${chainName(sd)} + ${crossName(k)}</td><td>${chainText(sd)}; ${crossText(k)}</td></tr>`;
    }).join('');
    const costs = s.data.instance.variables.map((v) => v.cost);
    body.innerHTML = `
      <p class="fx-intro">Eine Domain-Wall-Kette drückt nur <b>„genau eins“</b> aus – sie liegt auf der Seite, die vollständig zugewiesen wird.
        Hier <i>T</i> = ${tasks.length}, <i>R</i> = ${robots.length} → <b>Fall ${CASE_LABELS[caseKey]}</b>: je ${side === 'zeile' ? 'Auftrag eine Kette über die Roboter' : 'Roboter eine Kette über die Aufträge'}.</p>
      <div class="fx">
        ${line('kosten', '<i>H</i> =', `${objName(side)} = ${objFormula(side)}`,
    `<b>Ziel:</b> Teleskopsumme von Σ <i>c</i>·<i>x</i> – Kosten des ersten ${side === 'zeile' ? 'Roboters' : 'Auftrags'} + je Bit die Differenz zum nächsten (<b>${s.data.instance.criterion.label}</b>).`)}
        ${line('kette', '+ <i>A</i> ·', `${chainName(side)} = ${chainFormula(side)}`,
    `<b>Kettenregel:</b> jede Wand 0 → 1 kostet A. Ohne sie bleibt genau eine Wand: ${chainText(side)}.`)}
        ${line('quer', '+ <i>B</i> ·', `${crossName(caseKey)} = ${crossFormula(caseKey)}`,
    `<b>${crossTitle(caseKey)} – ${crossText(caseKey)}:</b> die One-Hot-Regel, eingesetzt mit <i>x</i> = Differenz zweier Bits. Koppelt verschiedene Ketten.`)}
        <div class="fx-line" style="border-color:${C.axis}" ${hl({ all: true })}><span class="fx-lhs">mit</span>
          <span class="fx-term">${xDef(side)}</span>
          <span class="fx-note">Feste Ränder. Für jede Stellung gilt Σ <i>x</i> = 1 entlang der Kette (Teleskop) – „genau eins“ ist eingebaut. Gebrochene Ketten erzeugen <i>x</i> = −1.</span></div>
      </div>
      <h4>Die drei Fälle</h4>
      <table class="data">
        <thead><tr><th>Fall</th><th></th><th>Kette</th><th class="num">Qubits</th><th>Strafterme</th><th>Regeln</th></tr></thead>
        <tbody>${caseRows}</tbody>
      </table>
      <h4>Symbole</h4>
      <table class="data symbols">
        <thead><tr><th>Symbol</th><th>Bedeutung</th><th>in diesem Szenario</th></tr></thead>
        <tbody>
          <tr ${hl({ all: true })}><td><i>t</i> ∈ <i>T</i>, <i>r</i> ∈ <i>R</i></td><td>Auftrag, Roboter (AMR)</td><td>${tasks.map((t) => `#${t.transport_id}`).join(', ')} · ${robots.map((r) => `R${r.robot_id}`).join(', ')}</td></tr>
          <tr ${hl({ kind: 'kosten' })}><td>${side === 'zeile' ? d(I('t'), I('i')) : e(I('i'), I('r'))} ∈ {0, 1}</td><td>Bit = Qubit; ${side === 'zeile' ? '<i>i</i> = Position des Roboters (nach Nummer)' : '<i>i</i> = Position des Auftrags (Anfrage-Reihenfolge)'}</td>
            <td>${f.n} Bits (One-Hot: ${s.data.one_hot.n})</td></tr>
          <tr ${hl({ all: true })}><td><i>x</i><sub><i>t</i>,<i>r</i></sub> ∈ {−1, 0, 1}</td><td>„<i>r</i> übernimmt <i>t</i>“ – keine eigene Variable, sondern Differenz zweier Bits</td>
            <td>${f.chains.map((ch) => `${chainLabel(s, ch.key)}: ${ch.members.map((m) => member(s, m)).join(' ')}`).join(' · ')}</td></tr>
          <tr ${hl({ kind: 'kosten' })}><td><i>c</i><sub><i>t</i>,<i>r</i></sub></td><td>${s.criterion.en}: ${formulaHtml(s.criterion.formula)}</td><td>${costs.length ? `${fmt(Math.min(...costs))} … ${fmt(Math.max(...costs))} ${unit(s)}` : '–'}</td></tr>
          <tr ${hl({ kind: 'kette' })}><td><i>A</i>, <i>B</i></td><td>Gewichte Kettenregel, ${crossTitle(caseKey)} (im Paper implizit 1)</td><td>A = ${fmt(s.A)}, B = ${fmt(s.B)} (Regler)</td></tr>
        </tbody>
      </table>`;
  }

  // ---------------------------------------------------------------- ② Eingesetzt
  function renderSubstituted(s) {
    const f = form(s);
    const x = s.x;
    const dec = decodeIa(f, x);
    const rows = [];
    let total = 0;
    for (const ch of f.chains.filter((h) => h.members.length)) {
      const val = ch.vars.reduce((acc, v, k) => acc + ch.costs[k] * linVal(f.x_forms[v], x), 0);
      if (s.terms.kosten) total += val;
      rows.push({ kind: 'kosten', sel: chainSel(s, ch.key), name: `Kosten ${chainLabel(s, ch.key)}`,
        formula: ch.vars.map((v, k) => `${fmt(ch.costs[k])}·${xHtml(s, v)}`).join(' + '),
        subst: ch.vars.map((v, k) => `${fmt(ch.costs[k])}·${xHtml(s, v, x)}`).join(' + '), value: val });
    }
    for (const ch of f.chains.filter((h) => h.bits.length > 1)) {
      const prs = ch.bits.slice(1).map((i, k) => [ch.bits[k], i]);
      const ups = prs.filter(([a, b]) => x[b] && !x[a]).length;
      const val = s.A * ups;
      if (s.terms.kette) total += val;
      rows.push({ kind: 'kette', sel: chainSel(s, ch.key), name: `Kette ${chainLabel(s, ch.key)}`,
        formula: `<i>A</i>·[ ${prs.map(([a, b]) => `${bHtml(s, b)}(1 − ${bHtml(s, a)})`).join(' + ')} ]`,
        subst: `${fmt(s.A)}·[ ${prs.map(([a, b]) => `${bit(x[b])}·(1 − ${bit(x[a])})`).join(' + ')} ] = ${fmt(s.A)}·${ups}`, value: val, ok: ups === 0 });
    }
    for (const q of dec.cross) {
      const vs = q.rule.deltas.map((_, k) => memberVar(s, q, k));
      const val = s.B * q.penalty;
      if (s.terms.quer) total += val;
      let formula;
      let subst;
      if (q.rule.exact) {
        formula = `<i>B</i>·(1 − [ ${vs.map((v) => xHtml(s, v)).join(' + ')} ])²`;
        subst = `${fmt(s.B)}·(1 − [ ${vs.map((v) => xHtml(s, v, x)).join(' + ')} ])² = ${fmt(s.B)}·(1 − ${fmt(q.sum)})²`;
      } else {
        const prs = [];
        for (let a = 0; a < vs.length; a += 1) for (let b = a + 1; b < vs.length; b += 1) prs.push([vs[a], vs[b]]);
        formula = prs.length ? `<i>B</i>·( ${prs.map(([p, r]) => `${xHtml(s, p)}${xHtml(s, r)}`).join(' + ')} )` : '– (kein Paar)';
        subst = prs.length ? `${fmt(s.B)}·( ${prs.map(([p, r]) => `${xHtml(s, p, x)}${xHtml(s, r, x)}`).join(' + ')} ) = ${fmt(s.B)}·${fmt(q.prod)}` : '0';
      }
      rows.push({ kind: 'quer', sel: groupSel(s, q.key), name: `${crossTitle(f.case)} ${q.name}`, formula, subst, value: val, ok: q.ok });
    }
    body.innerHTML = `
      <p class="fx-intro">Die Formel mit den Zahlen dieses Szenarios und deinen Bits (<b class="one">1</b> = gesetzt). Jedes <i>x</i> ist eine Differenz –
        an einer falschen Wand wird es −1, die Kosten werden zu Phantasiewerten und die ${crossTitle(f.case)} kann sogar <b>belohnen</b>.</p>
      <div class="table-wrap"><table class="data fx-table">
        <thead><tr><th>Term</th><th>Formel mit Zahlen</th><th>mit deinen Bits eingesetzt</th><th class="num">Wert</th></tr></thead>
        <tbody>${rows.map((r) => {
    const off = !s.terms[r.kind];
    return `<tr class="t-row t-${cls(r.kind)}${off ? ' off' : ''}" ${hl(r.sel)}><td><span class="t-name">${r.name}</span></td>
            <td class="fx-cell">${r.formula}</td><td class="fx-cell">${r.subst}</td>
            <td class="num ${off ? '' : r.ok === false ? 'no-val' : ''}">${off ? `<em>${offNote(s, r.kind)}</em>` : fmt(r.value)}</td></tr>`;
  }).join('')}
          <tr class="fx-total"><td colspan="3">Summe aller aktiven Terme: <i>H</i>(<i>${zeile(s) ? 'd' : 'e'}</i>)</td><td class="num">${fmt(total)}</td></tr>
        </tbody></table></div>`;
  }
  /** Variable des k-ten Mitglieds einer Querregel-Gruppe. */
  function memberVar(s, q, k) {
    const vars = s.data.instance.variables;
    const m = q.rule.members[k];
    return vars.find((v) => (q.onRobot ? v.robot_id === q.key && v.task_id === m : v.task_id === q.key && v.robot_id === m)).index;
  }

  // ---------------------------------------------------------------- ③ Ausmultipliziert → QUBO
  function renderExpansion(s) {
    const f = form(s);
    const side = f.side;
    const ch = f.chains.find((h) => h.key === chainKey);
    const model = s.model;
    let tele = '<p class="hint">Nur ein Mitglied – nichts zu zeigen.</p>';
    let chainHtml = '';
    if (ch && ch.members.length > 1) {
      const diffs = ch.bits.map((i, k) => `<span class="p-lin" ${hl({ vars: [i] })}>${signed(ch.costs[k + 1] - ch.costs[k])}·${bHtml(s, i)}</span>`).join(' ');
      tele = `<div class="fx-derivation t-kosten${s.terms.kosten ? '' : ' off'}" ${hl(chainSel(s, ch.key))}>
          <div>${ch.vars.map((v, k) => `${fmt(ch.costs[k])}·${xHtml(s, v)}`).join(' + ')}</div>
          <div><span class="eq">=</span> <span class="p-const">${fmt(ch.costs[0])}</span> ${diffs}</div>
          <div class="why"><span class="p-const">Konstante: Kosten von ${member(s, ch.members[0])}</span> ·
            <span class="p-lin">je Bit die Differenz zum nächsten Mitglied</span>. Jedes Bit steht in zwei <i>x</i>, einmal +, einmal − (Teleskop).</div>
        </div>`;
      const prs = ch.bits.slice(1).map((i, k) => [ch.bits[k], i]);
      chainHtml = prs.length
        ? `<div class="fx-derivation t-zeile${s.terms.kette ? '' : ' off'}" ${hl(chainSel(s, ch.key))}>
            <div><i>A</i>·<i>b</i><sub>i+1</sub>(1 − <i>b</i><sub>i</sub>) <span class="eq">=</span> <span class="p-lin"><i>A</i>·<i>b</i><sub>i+1</sub></span> <span class="p-pair">− <i>A</i>·<i>b</i><sub>i</sub><i>b</i><sub>i+1</sub></span></div>
            <div><span class="eq">=</span> ${prs.map(([a, b]) => `<span class="p-lin">+ ${fmt(s.A)}·${bHtml(s, b)}</span> <span class="p-pair">− ${fmt(s.A)}·${bHtml(s, a)}${bHtml(s, b)}</span>`).join(' ')}</div>
            <div class="why">Eine 1 kostet A, außer ihr linker Nachbar ist auch 1. Nur <b>direkte Nachbarn</b> gekoppelt.</div>
          </div>`
        : '<p class="hint">Nur ein Bit – keine Kettenregel nötig.</p>';
    }
    // Querregel: Beiträge der gewählten Gruppe aus den QUBO-Einträgen (in Einheiten von B)
    const isGroup = (p) => p.kind === 'quer' && (zeile(s) ? p.robot_id === groupKey : p.task_id === groupKey);
    const contrib = [];
    for (const en of f.entries) {
      const b = en.parts.filter(isGroup).reduce((acc, p) => acc + p.B, 0);
      if (Math.abs(b) > 1e-9) contrib.push({ en, b });
    }
    const c0 = f.const_parts.filter(isGroup).reduce((acc, p) => acc + p.B, 0);
    const contribHtml = [
      ...contrib.filter(({ en }) => en.i === en.j).map(({ en, b }) => `<span class="q-term" ${hl({ vars: [en.i] })}>${coefB(b)}·${bHtml(s, en.i)}</span>`),
      ...contrib.filter(({ en }) => en.i !== en.j).map(({ en, b }) => `<span class="q-term" ${hl({ vars: [en.i, en.j] })}>${coefB(b)}·${bHtml(s, en.i)}${bHtml(s, en.j)}</span>`),
      c0 ? `<span class="q-term">${coefB(c0)} <span class="hint">(Konstante)</span></span>` : '',
    ].join(' ');
    const exact = CROSS_EXACT[f.case];
    const sideSym = side === 'zeile' ? ['<i>d</i>', '<i>d</i>′'] : ['<i>e</i>', '<i>e</i>′'];
    const crossHtml = exact
      ? `<div class="fx-derivation t-spalte${s.terms.quer ? '' : ' off'}">
          <div><i>B</i>(1 − Σ <i>x</i>)² <span class="eq">=</span> <i>B</i> − 2<i>B</i> Σ <i>x</i> + <i>B</i> Σ <i>x</i>² + 2<i>B</i> Σ<sub><i>i</i>&lt;<i>j</i></sub> <i>x<sub>i</sub>x<sub>j</sub></i></div>
          <div class="why"><b>Achtung:</b> <i>x</i>² = <i>x</i> gilt hier nicht mehr – <i>x</i> ist eine Differenz und kann −1 sein:
            (<i>d</i><sub>a</sub> − <i>d</i><sub>b</sub>)² = <i>d</i><sub>a</sub> + <i>d</i><sub>b</sub> − 2<i>d</i><sub>a</sub><i>d</i><sub>b</sub>. Das koppelt Nachbarbits derselben Kette zusätzlich.</div></div>`
      : `<div class="fx-derivation t-spalte${s.terms.quer ? '' : ' off'}">
          <div>(${sideSym[0]}<sub>a</sub> − ${sideSym[0]}<sub>b</sub>)(${sideSym[1]}<sub>a</sub> − ${sideSym[1]}<sub>b</sub>) <span class="eq">=</span>
            <span class="p-pair">+ ${sideSym[0]}<sub>a</sub>${sideSym[1]}<sub>a</sub> − ${sideSym[0]}<sub>a</sub>${sideSym[1]}<sub>b</sub> − ${sideSym[0]}<sub>b</sub>${sideSym[1]}<sub>a</sub> + ${sideSym[0]}<sub>b</sub>${sideSym[1]}<sub>b</sub></span></div>
          <div class="why">Je Paar zweier Ketten bis zu vier Kopplungen: gleiche Position +B, versetzte −B. Über alle Mitglieder: 3·(Kettenlänge) − 5 Kopplungen je Kettenpaar.
            Steht an einer gebrochenen Kette <i>x</i> = −1 neben einem <i>x</i>′ = 1, ist das Produkt −1 – <b>Belohnung</b>.</div></div>`;
    const lin = model.entries.filter((en) => en.i === en.j && en.value !== 0);
    const quad = model.entries.filter((en) => en.i !== en.j && en.value !== 0);
    const termHtml = [
      ...lin.map((en) => `<span class="q-term" ${hl({ vars: [en.i] })}>${signed(en.value)}·${bHtml(s, en.i)}</span>`),
      ...quad.map((en) => `<span class="q-term" ${hl({ vars: [en.i, en.j] })}>${signed(en.value)}·${bHtml(s, en.i)}${bHtml(s, en.j)}</span>`),
    ];
    const LIMIT = 30;
    const Ep = ruleEnergy(s);
    const Eq = energy(model, s.x);
    body.innerHTML = `
      <p class="fx-intro">Eine QUBO kennt nur Bits und Paare. Kosten (Teleskopsumme) und Kettenregel sind schon so;
        die ${crossTitle(f.case)} wird mit <i>x</i> = Differenz ausmultipliziert und <b>koppelt verschiedene Ketten</b>.</p>
      <h4>Am Beispiel der Kette ${chainChips(s)}</h4>
      <h4>Kosten: die Teleskopsumme</h4>${tele}
      <h4>Kettenregel: nur Nachbarn</h4>${chainHtml}
      <h4>${crossTitle(f.case)} ${crossName(f.case)}</h4>${crossHtml}
      <div class="fx-list"><div class="fx-item" ${hl(groupSel(s, groupKey))}>Beitrag von ${groupChips(s)}: ${contribHtml || '–'}</div></div>
      <h4>Wohin wandert jeder Teil?</h4>
      <table class="data fx-table">
        <thead><tr><th>Herkunft</th><th>Formelteil</th><th>landet in</th><th class="num">Wert hier</th></tr></thead>
        <tbody>
          <tr class="t-row t-kosten" ${hl({ kind: 'kosten' })}><td>${objName(side)}</td><td>Kosten des ersten Mitglieds</td><td>Konstante</td><td class="num">${fmt(f.const.c)}</td></tr>
          <tr class="t-row t-kosten" ${hl({ kind: 'kosten' })}><td>${objName(side)}</td><td>Differenz zum nächsten Mitglied</td><td>Diagonale</td><td class="num">Differenzen</td></tr>
          <tr class="t-row t-zeile" ${hl({ kind: 'kette' })}><td><i>A</i>·${chainName(side)}</td><td>+ <i>A</i>·<i>b</i><sub>i+1</sub> &nbsp; − <i>A</i>·<i>b</i><sub>i</sub><i>b</i><sub>i+1</sub></td><td>Diagonale · Kopplung <b>direkter Nachbarn</b></td><td class="num">${fmt(s.A)} · ${fmt(-s.A)}</td></tr>
          <tr class="t-row t-spalte" ${hl({ kind: 'quer' })}><td><i>B</i>·${crossName(f.case)}</td><td>${exact ? 'Konstante B je Gruppe, ±B·Bit, ±2B·Paar' : '±B je Bitpaar zweier Ketten'}</td>
            <td>${exact ? 'Konstante · Diagonale · Kopplungen' : 'Kopplungen <b>zwischen Ketten</b> (und Diagonale)'}</td><td class="num">${fmt(f.const.B * s.B)} Konstante</td></tr>
        </tbody>
      </table>
      <h4>Fertige QUBO-Form – das bekommt die Hardware</h4>
      <div class="fx-qubo"><i>H</i> = ${termHtml.slice(0, LIMIT).join(' ')}${termHtml.length > LIMIT ? ` <span class="hint">… und ${termHtml.length - LIMIT} weitere Terme</span>` : ''} <span class="q-term">${signed(model.constant)}</span></div>
      <p class="fx-probe">Probe mit deinen Bits: Formel <b>${fmt(Ep)}</b>, QUBO-Form <b>${fmt(Eq)}</b>
        ${Math.abs(Ep - Eq) < 1e-6 ? '<span class="okline">✓ identisch</span>' : '<span class="warnline">✗ Abweichung</span>'}</p>`;
    bindChips();
  }

  /** H(b) direkt aus den Regeln (wie energy_rules_dw_ia in Python), nur aktive Terme. */
  function ruleEnergy(s) {
    const f = form(s);
    const x = s.x;
    let en = 0;
    for (const r of f.rules) {
      if (r.kind === 'kosten' && s.terms.kosten) en += r.costs.reduce((acc, k, i) => acc + k * linVal(r.deltas[i], x), 0);
      if (r.kind === 'kette' && s.terms.kette) en += s.A * x[r.vars[1]] * (1 - x[r.vars[0]]);
      if (r.kind === 'quer' && s.terms.quer) {
        const vals = r.deltas.map((g) => linVal(g, x));
        let p = 0;
        for (let i = 0; i < vals.length; i += 1) for (let j = i + 1; j < vals.length; j += 1) p += vals[i] * vals[j];
        en += s.B * (r.exact ? (1 - vals.reduce((a, v) => a + v, 0)) ** 2 : p);
      }
    }
    return en;
  }

  // ---------------------------------------------------------------- ④ Wirkung der Terme
  function renderEffects(s) {
    const f = form(s);
    const ch = f.chains.find((h) => h.key === chainKey);
    const sweepA = el('div', { class: 'chart short' });
    const sweepB = el('div', { class: 'chart short' });
    const statesHost = el('div');
    const spread = s.data.weights.spread;
    fill(body,
      el('p', { class: 'fx-intro', html: `Oben: alle Stellungen <b>einer Kette</b>, ungültige mit Phantasiewert. Unten: Ab welchem Gewicht ist das Minimum
        <b>gültig</b>? Klick in die Kurve setzt den Regler.` }),
      el('h4', { html: `Alle Stellungen der Kette ${chainChips(s)}` }), statesHost,
      el('p', { class: 'hint', html: CROSS_EXACT[f.case]
        ? `Bei T = R ist die Querregel (1 − Σ<i>x</i>)² ≥ 0 – sie belohnt nie. Ein <i>x</i> = −1 kann aber eine Doppelbelegung „ausgleichen“; die Kettenregel muss das verhindern.`
        : `<b>Warum A deutlich größer als B?</b> Eine gebrochene Kette hat <i>x</i> = −1 an einem Mitglied. Belegt dort ein anderer das Mitglied (<i>x</i>′ = 1),
          ist <i>x</i>·<i>x</i>′ = −1: die ${crossTitle(f.case)} <b>belohnt</b> mit −B. Mit Phantasiewert und gespartem Ausweichen (je ≤ Spannweite s = ${fmt(spread)})
          gewinnt ein Bruch bis B + 2s – also A &gt; B + 2s. Empfehlung A = 3B.` }),
      el('div', { class: 'grid grid-2' },
        el('div', {}, el('h4', {}, 'Wie groß muss A sein? (Kettenregel)'), sweepA, el('p', { class: 'hint', 'data-sweep': 'A' })),
        el('div', {}, el('h4', {}, `Wie groß muss B sein? (${crossTitle(f.case)})`), sweepB, el('p', { class: 'hint', 'data-sweep': 'B' }))));
    bindChips();
    renderStates(s, ch, statesHost);
    for (const [key, div] of [['A', sweepA], ['B', sweepB]]) {
      const res = drawSweep(s, key, div);
      const note = body.querySelector(`[data-sweep="${key}"]`);
      if (!res || !note) continue;
      const other = key === 'A' ? 'B' : 'A';
      const below = res.lo != null ? [...res.pts].reverse().find((p) => !p.valid && p.val < res.lo) : null;
      const above = res.bounded ? res.pts.find((p) => !p.valid && p.val > res.hi) : null;
      const parts = [];
      if (res.lo == null) parts.push(`Im Bereich nie gültig – ${other} zu klein oder kein gültiger Plan möglich.`);
      else if (res.lo === 0 && !res.bounded) parts.push(`Für jedes ${key} gültig (bei ${other} = ${fmt(other === 'A' ? s.A : s.B)}).`);
      if (below) parts.push(`Unter ${key} ≈ ${fmt(res.lo)} ist ein Regelbruch billiger, z.B. ${key} = ${fmt(below.val)}: <b>${below.desc}</b>.`);
      if (above) parts.push(`<b>Über ${key} ≈ ${fmt(res.hi)} kippt es wieder</b>, z.B. ${key} = ${fmt(above.val)}: <b>${above.desc}</b> – zu großes ${key} macht den Bruch der anderen Regel lohnend.`);
      note.innerHTML = parts.join(' ');
    }
  }

  function renderStates(s, ch, host) {
    if (!ch || ch.bits.length === 0) {
      fill(host, el('p', { class: 'hint' }, 'Diese Kette hat keine Bits.'));
      return;
    }
    const m = ch.bits.length;
    if (m > 5) {
      fill(host, el('p', { class: 'hint' }, `${2 ** m} Stellungen – die Tabelle wird bis 5 Bits gezeigt.`));
      return;
    }
    const rows = [];
    for (let mask = 0; mask < 2 ** m; mask += 1) {
      const bits = Array.from({ length: m }, (_, k) => (mask >> k) & 1);
      const b = [1, ...bits, 0];
      let up = 0;
      let cost = 0;
      const xs = [];
      for (let k = 0; k < b.length - 1; k += 1) {
        if (b[k] === 0 && b[k + 1] === 1) up += 1;
        xs.push(b[k] - b[k + 1]);
        cost += ch.costs[k] * (b[k] - b[k + 1]);
      }
      const pick = up === 0 ? ch.members[xs.indexOf(1)] : null;
      rows.push({ bits, xs, up, cost, pen: s.A * up, pick });
    }
    rows.sort((a, b) => a.cost + a.pen - (b.cost + b.pen));
    const bestValid = Math.min(...rows.filter((r) => r.up === 0).map((r) => r.cost));
    const cheats = rows.filter((r) => r.up > 0 && r.cost < bestValid);
    fill(host,
      el('div', { class: 'table-scroll' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Kette (1 | Bits | 0)'), el('th', {}, `x je ${zeile(s) ? 'Roboter' : 'Auftrag'} (${ch.members.map((mm) => member(s, mm)).join(' ')})`),
          el('th', {}, 'gewählt'), el('th', { class: 'num' }, `Kosten-Term [${unit(s)}]`), el('th', { class: 'num' }, 'Kettenstrafe A·↑'), el('th', { class: 'num' }, 'Summe'))),
        el('tbody', {}, rows.map((r) => el('tr', { class: r.up > 0 && r.cost < bestValid ? 'warnrow' : r.up > 0 ? 'dim' : '' },
          el('td', { class: 'mono' }, `1 | ${r.bits.join('')} | 0`),
          el('td', { class: 'mono' }, r.xs.map((v) => (v < 0 ? '−1' : String(v))).join(' ')),
          el('td', {}, r.pick != null ? member(s, r.pick) : '✗ gebrochen'),
          el('td', { class: 'num' }, `${fmt(r.cost)}${r.up > 0 ? ' (Phantasiewert)' : ''}`), el('td', { class: 'num' }, fmt(r.pen)),
          el('td', { class: 'num' }, el('b', {}, fmt(r.cost + r.pen)))))))),
      el('p', { class: 'hint', html: cheats.length
        ? `<b>${cheats.length} gebrochene Stellung(en)</b> (orange) liegen unter dem besten gültigen Wert ${fmt(bestValid)} – ohne Kettenregel wären sie billiger.`
        : `Kein Phantasiewert unter dem besten gültigen (${fmt(bestValid)}).` }));
  }

  function drawSweep(s, key, div) {
    const f = form(s);
    const n = f.n;
    if (n > SWEEP_MAX_BITS) {
      fill(div, el('p', { class: 'hint' }, `Kurve nur bis ${SWEEP_MAX_BITS} Bits (hier ${n}).`));
      div.style.minHeight = '0';
      return null;
    }
    const other = key === 'A' ? s.B : s.A;
    const top = Math.max(100, Math.ceil(((key === 'A' ? s.data.weights.A : s.data.weights.B) * 2) / 10) * 10);
    const inst = s.data.instance;
    const cacheKey = `${key}|${other}|${top}|${inst.tasks.map((t) => t.transport_id)}|${inst.robots.map((r) => r.robot_id)}|${inst.mode}|${inst.criterion.key}|${JSON.stringify(inst.params)}`;
    let pts = sweepCache.get(cacheKey);
    if (!pts) {
      pts = [];
      for (let k = 0; k <= 40; k += 1) {
        const val = Math.round((top * k) / 40);
        const m = makeModel(f, { A: key === 'A' ? val : other, B: key === 'B' ? val : other, terms: ALL });
        const r = search(m, 1);
        const x = fromMask(r.min.mask, n);
        pts.push({ val, E: r.min.E, valid: decodeIa(f, x).valid, desc: api.describe(x) });
      }
      sweepCache.set(cacheKey, pts);
    }
    const validPts = pts.filter((p) => p.valid);
    const lo = validPts.length ? validPts[0].val : null;
    const hi = validPts.length ? validPts[validPts.length - 1].val : null;
    const bounded = hi != null && !pts[pts.length - 1].valid;
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
        { x: cur, yref: 'paper', y: 0, text: `aktuell ${key} = ${fmt(cur)}`, showarrow: false, yanchor: 'bottom', xanchor: 'left', xshift: 4, font: { color: C.accent } },
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

