// „Die Formel dahinter“ für Binary in der Sofortzuweisung (IA). Der Code liegt auf der Seite, die vollständig zugewiesen
// wird: T ≤ R je Auftrag (Bits b_t,k, Roboter-Codes u_r), T > R je Roboter (Bits g_r,k, Auftrags-Codes v_t).
// Vier Register wie bei One-Hot und Domain Wall:
//   ① Formel & Fälle   ② Eingesetzt   ③ Ausmultipliziert → QUBO (Grad, Hilfsbits)   ④ Wirkung der Terme
// Formelteile tragen data-hl – beim Überfahren hebt die Seite die passenden Bits hervor.
import { el, fill, nf } from '../util.js';
import { C, plot } from '../theme.js';
import { energy, fromMask, makeModel, search } from '../qubo/engine.js';
import { formulaHtml } from './onehotCriterion.js';
import { CASE_LABELS, CASE_ORDER, CASE_TEXTS } from '../components/iaScenario.js';
import { SIDE, chainText as codeText, crossText, crossTitle } from './iaDomainWallFormula.js';

export const BIN_IA_TABS = [
  { key: 'formel', label: '① Formel & Fälle' },
  { key: 'eingesetzt', label: '② Eingesetzt' },
  { key: 'qubo', label: '③ Ausmultipliziert → QUBO' },
  { key: 'wirkung', label: '④ Wirkung der Terme' },
];
export const BIN_IA_DEFAULT_TAB = { 1: 'formel', 3: 'formel', 4: 'eingesetzt', 5: 'qubo', 6: 'wirkung', 7: 'qubo' };
export const TERMS = ['kosten', 'ungueltig', 'quer', 'hilfsbit'];
export const POLY_TERMS = ['kosten', 'ungueltig', 'quer']; // das Polynom vor den Hilfsbits
const ALL = { kosten: true, ungueltig: true, quer: true, hilfsbit: true };
const SWEEP_MAX_BITS = 16;
const STEP_OF = { kosten: 3, ungueltig: 4, quer: 5, hilfsbit: 6 };

// ---------------------------------------------------------------- Namen und Formeln (auch von der Seite genutzt)
const H = (prime, sub) => `<i>H</i>${prime ? '′' : ''}<sub>${sub}</sub>`;
export const objName = (side) => H(side === 'spalte', 'obj_B');
export const penName = (side) => H(side === 'spalte', 'pen_B');
export const crossName = (caseKey) => ({ 'T=R': H(false, 'pen2'), 'T<R': H(true, 'pen2'), 'T>R': H(true, 'pen1') })[caseKey];
export const AUX_NAME = H(false, 'Aux');
export const termName = (kind, caseKey) => ({ kosten: objName(SIDE[caseKey]), ungueltig: penName(SIDE[caseKey]), quer: crossName(caseKey), hilfsbit: AUX_NAME })[kind];
export const termTitle = (kind, caseKey) => ({ kosten: 'Kosten', ungueltig: 'Ungültige Codes', quer: crossTitle(caseKey), hilfsbit: 'Hilfsbits' })[kind];
export { codeText };

const I = (s) => `<i>${s}</i>`;
const S = (sub) => `Σ<sub>${sub}</sub>`;
const P = 'Π<sub><i>k</i>=1</sub><sup><i>K</i></sup>';
const sym = (name, a, b) => `<i>${name}</i><sub>${a},${b}</sub>`;
/** Zuweisungsgröße je Fall: y (Code je Auftrag) bzw. w (Code je Roboter) – wie im Paper. */
export const yName = (side) => (side === 'zeile' ? 'y' : 'w');
export const kDef = (side) => `<i>K</i> = ⌈log₂ ${side === 'zeile' ? '<i>R</i>' : '<i>T</i>'}⌉`;
export const yDef = (side) => (side === 'zeile'
  ? `<i>x</i><sub><i>t</i>,<i>r</i></sub> = ${sym('y', I('t'), I('r'))} = ${P} ( ${sym('u', I('k'), I('r'))} ${sym('b', I('t'), I('k'))} + (1 − ${sym('u', I('k'), I('r'))})(1 − ${sym('b', I('t'), I('k'))}) )`
  : `<i>x</i><sub><i>t</i>,<i>r</i></sub> = ${sym('w', I('t'), I('r'))} = ${P} ( ${sym('v', I('k'), I('t'))} ${sym('g', I('r'), I('k'))} + (1 − ${sym('v', I('k'), I('t'))})(1 − ${sym('g', I('r'), I('k'))}) )`);
export const objFormula = (side) => `${S(I('t'))} ${S(I('r'))} ${sym('c', I('t'), I('r'))} ${sym(yName(side), I('t'), I('r'))}`;
export const penFormula = (side) => (side === 'zeile'
  ? `${S(I('t'))} ${S('<i>u</i>∈<i>U</i><sub>f</sub>')} ${P} ( <i>u</i><sub><i>k</i></sub> ${sym('b', I('t'), I('k'))} + (1 − <i>u</i><sub><i>k</i></sub>)(1 − ${sym('b', I('t'), I('k'))}) )`
  : `${S(I('r'))} ${S('<i>v</i>∈<i>V</i><sub>f</sub>')} ${P} ( <i>v</i><sub><i>k</i></sub> ${sym('g', I('r'), I('k'))} + (1 − <i>v</i><sub><i>k</i></sub>)(1 − ${sym('g', I('r'), I('k'))}) )`);
export const crossFormula = (caseKey) => ({
  'T=R': `${S(I('r'))} ( 1 − ${S(I('t'))} ${sym('y', I('t'), I('r'))} )²`,
  'T<R': `${S(I('r'))} ${S(`${I('t')}&lt;${I('t')}′`)} ${sym('y', I('t'), I('r'))} ${sym('y', `${I('t')}′`, I('r'))}`,
  'T>R': `${S(I('t'))} ${S(`${I('r')}&lt;${I('r')}′`)} ${sym('w', I('t'), I('r'))} ${sym('w', I('t'), `${I('r')}′`)}`,
})[caseKey];
export const AUX_FORMULA = `${S('<i>a</i> = <i>x</i>·<i>y</i>')} ( <i>xy</i> − 2<i>xa</i> − 2<i>ya</i> + 3<i>a</i> )`;

const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = (s) => String(s).replace(/\d/g, (d) => SUB[d]);
const auxPositions = (form, b) => b.covers.map((c) => form.bits[c].pos).join('');
/** Bit als Formelzeichen: b_t,k (Code je Auftrag), g_r,k (Code je Roboter) oder Hilfsbit a_Gruppe,Stellen. */
export function bitHtml(form, i) {
  const b = form.bits[i];
  if (b.aux) return b.group != null ? `<i>a</i><sub>${b.group},${auxPositions(form, b)}</sub>` : `<i>a</i><sub>${b.pos}</sub>`;
  return `<i>${form.side === 'zeile' ? 'b' : 'g'}</i><sub>${b.group},${b.pos}</sub>`;
}
export function bitText(form, i) {
  const b = form.bits[i];
  if (b.aux) return b.group != null ? `a${sub(b.group)},${sub(auxPositions(form, b))}` : `a${sub(b.pos)}`;
  return `${form.side === 'zeile' ? 'b' : 'g'}${sub(b.group)},${sub(b.pos)}`;
}

/** Wert des Polynoms vor den Hilfsbits (wie binary_poly_energy in Python) – nur die Code-Bits zählen. */
export function polyEnergy(form, x, A, B, terms) {
  let e = 0;
  for (const kind of POLY_TERMS) {
    if (!terms[kind]) continue;
    for (const t of form.polynomial[kind]) if (t.vars.every((i) => x[i])) e += t.c + t.A * A + t.B * B;
  }
  return e;
}

/**
 * Bits auslesen (wie decode_binary_ia in Python): Code je Gruppe, gewähltes Paar, y je Variable (0 oder 1),
 * Querregel je Gruppe der anderen Seite, lügende Hilfsbits und alle Verstöße.
 */
export function decodeIaBin(form, x, checkLies = true) {
  const zeile = form.side === 'zeile';
  const groups = form.groups.map((gr) => {
    const code = gr.bits.reduce((acc, i, j) => acc + (x[i] << (form.K - 1 - j)), 0);
    const c = gr.codes[code];
    const ok = gr.vars.length > 0 && c.var != null;
    return { gr, code, c, ok, name: zeile ? `#${gr.key}` : `R${gr.key}`,
      task: ok ? (zeile ? gr.key : c.member) : null, robot: ok ? (zeile ? c.member : gr.key) : null, cost: ok ? c.cost : null };
  });
  const ys = [];
  for (const g of groups) for (const c of g.gr.codes) if (c.var != null) ys[c.var] = g.code === c.code ? 1 : 0;
  const picks = groups.filter((g) => g.ok).map((g) => [g.task, g.robot]);
  const cross = form.rules.filter((r) => r.kind === 'quer').map((r) => {
    const onRobot = r.robot_id != null;
    const vals = r.var_ids.map((v) => ys[v] || 0);
    const n = vals.reduce((a, v) => a + v, 0);
    return { rule: r, onRobot, key: onRobot ? r.robot_id : r.task_id, name: onRobot ? `R${r.robot_id}` : `#${r.task_id}`, vals, n,
      ok: r.exact ? n === 1 : n <= 1, penalty: r.exact ? (1 - n) ** 2 : n > 1 ? (n * (n - 1)) / 2 : 0 };
  });
  const issues = [];
  for (const g of groups) {
    if (!g.gr.vars.length) issues.push({ kind: 'leer', key: g.gr.key, text: `${g.name}: nicht darstellbar` });
    else if (!g.ok) issues.push({ kind: 'ungueltig', key: g.gr.key, text: `${g.name}: Code ${g.c.pattern} ${g.c.status}` });
  }
  for (const q of cross) {
    if (q.ok) continue;
    const what = q.onRobot ? (q.n === 0 ? 'ohne Auftrag' : `${q.n} Aufträge`) : `${q.n} Roboter`;
    issues.push({ kind: 'quer', key: q.key, text: `${q.name}: ${what}` });
  }
  const lies = checkLies ? form.aux.filter((a) => x[a.index] !== x[a.pair[0]] * x[a.pair[1]]).map((a) => a.index) : [];
  if (lies.length) issues.push({ kind: 'hilfsbit', text: `${lies.length} Hilfsbit${lies.length === 1 ? ' lügt' : 's lügen'}` });
  return { groups, ys, picks, cross, issues, lies, valid: issues.length === 0 };
}

const fmt = (v) => nf(v, 1).replace('-', '−');
const signed = (v) => (v < 0 ? `− ${fmt(-v)}` : `+ ${fmt(v)}`);
const hl = (o) => `data-hl='${JSON.stringify(o)}'`;
const bit = (on) => (on ? '<b class="one">1</b>' : '<span class="zero">0</span>');

/** Polynom-Hilfen (Monom = sortierte Bitliste als Schlüssel) für die Herleitungen in ③. */
const key = (vars) => vars.join(',');
const unkey = (k) => (k ? k.split(',').map(Number) : []);
function polyMul(p, q) {
  const out = new Map();
  for (const [k1, c1] of p) {
    for (const [k2, c2] of q) {
      const k = key([...new Set([...unkey(k1), ...unkey(k2)])].sort((a, b) => a - b));
      out.set(k, (out.get(k) || 0) + c1 * c2);
    }
  }
  for (const [k, c] of out) if (Math.abs(c) < 1e-12) out.delete(k);
  return out;
}
/** Indikator eines Codes als Polynom: Π (b, falls Stelle = 1, sonst 1 − b). */
function indicatorPoly(K, bits, code) {
  let p = new Map([['', 1]]);
  bits.forEach((i, j) => {
    const one = (code >> (K - 1 - j)) & 1;
    p = polyMul(p, one ? new Map([[String(i), 1]]) : new Map([['', 1], [String(i), -1]]));
  });
  return p;
}

/**
 * @param {HTMLElement} host
 * @param {object} api  getState(), highlight(sel), clearHighlight(), setWeight(key, value), describe(x)
 */
export function createIaBinFormulaPanel(host, api) {
  let tab = 'formel';
  let groupKey = null;
  let crossKey = null;
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

  function setTab(k, renderNow = true) {
    tab = k;
    if (renderNow) render();
  }
  function render() {
    const s = api.getState();
    if (!s.data) return;
    const f = s.data.formulation;
    if (!f.groups.some((g) => g.key === groupKey && g.vars.length)) groupKey = (f.groups.find((g) => g.vars.length) || f.groups[0])?.key ?? null;
    const cr = f.rules.filter((r) => r.kind === 'quer');
    if (!cr.some((r) => crossOf(r) === crossKey)) crossKey = crossOf(cr.find((r) => r.var_ids.length > 1) || cr[0] || {});
    fill(bar, BIN_IA_TABS.map((t) => el('button', {
      class: `seg-btn${t.key === tab ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(t.key === tab), onclick: () => setTab(t.key),
    }, t.label)));
    if (tab === 'formel') renderFormula(s);
    else if (tab === 'eingesetzt') renderSubstituted(s);
    else if (tab === 'qubo') renderExpansion(s);
    else renderEffects(s);
  }

  // ---------------------------------------------------------------- Hilfen
  const crossOf = (r) => r.robot_id ?? r.task_id ?? null;
  const form = (s) => s.data.formulation;
  const unit = (s) => s.data.instance.criterion.unit;
  const zeile = (s) => form(s).side === 'zeile';
  const groupLabel = (s, k) => (zeile(s) ? `#${k}` : `R${k}`);
  const member = (s, m) => (zeile(s) ? `R${m}` : `#${m}`);
  const crossLabel = (s, k) => (zeile(s) ? `R${k}` : `#${k}`);
  const groupSel = (s, k) => (zeile(s) ? { task: k } : { robot: k });
  const crossSel = (s, k) => (zeile(s) ? { robot: k } : { task: k });
  const bH = (s, i) => bitHtml(form(s), i);
  const monoHtml = (s, vars) => vars.map((i) => bH(s, i)).join('');
  /** y bzw. w einer Variable als Zeichen. */
  function yHtml(s, v) {
    const va = s.data.instance.variables[v];
    return sym(yName(form(s).side), va.task_id, va.robot_id);
  }
  /** Indikator-Produkt eines Codes, wahlweise mit eingesetzten Bits. */
  function indHtml(s, gr, code, x) {
    const K = form(s).K;
    if (!K) return '1';
    return gr.bits.map((i, j) => {
      const one = (code >> (K - 1 - j)) & 1;
      const val = x ? bit(x[i]) : bH(s, i);
      return one ? val : `(1 − ${val})`;
    }).join('·');
  }
  const indVal = (s, gr, code, x) => (gr.bits.every((i, j) => x[i] === ((code >> (form(s).K - 1 - j)) & 1)) ? 1 : 0);
  /** Polynom als Formel, Terme nach Grad; Grad > 2 rot. */
  function polyHtml(s, p, limit = 24) {
    const terms = [...p].map(([k, c]) => ({ vars: unkey(k), c })).sort((a, b) => a.vars.length - b.vars.length || a.vars.join().localeCompare(b.vars.join()));
    const out = terms.slice(0, limit).map((t, n) => {
      const cls = t.vars.length > 2 ? 'p-high' : t.vars.length === 2 ? 'p-pair' : t.vars.length ? 'p-lin' : 'p-const';
      const coef = Math.abs(t.c) === 1 && t.vars.length ? (t.c < 0 ? '−' : n ? '+' : '') : n || t.c < 0 ? signed(t.c) : fmt(t.c);
      return `<span class="${cls}">${coef} ${t.vars.length ? monoHtml(s, t.vars) : ''}</span>`;
    });
    return `${out.join(' ')}${terms.length > limit ? ` <span class="hint">… und ${terms.length - limit} weitere</span>` : ''}`;
  }
  const offNote = (s, kind) => {
    if (s.terms[kind]) return '';
    return s.step < STEP_OF[kind] ? `kommt in Schritt ${STEP_OF[kind]}` : 'gerade ausgeschaltet';
  };
  const cls = (kind) => ({ kosten: 'kosten', ungueltig: 'zeile', quer: 'spalte', hilfsbit: 'reihenfolge' }[kind]);
  const groupChips = (s) => form(s).groups.filter((g) => g.vars.length)
    .map((g) => `<button type="button" class="chip" data-group-pick="${g.key}" aria-pressed="${g.key === groupKey}">${groupLabel(s, g.key)}</button>`).join(' ');
  const crossChips = (s) => form(s).rules.filter((r) => r.kind === 'quer')
    .map((r) => `<button type="button" class="chip" data-cross-pick="${crossOf(r)}" aria-pressed="${crossOf(r) === crossKey}">${crossLabel(s, crossOf(r))}</button>`).join(' ');
  const bindChips = () => {
    body.querySelectorAll('[data-group-pick]').forEach((b) => b.addEventListener('click', () => { groupKey = Number(b.dataset.groupPick); render(); }));
    body.querySelectorAll('[data-cross-pick]').forEach((b) => b.addEventListener('click', () => { crossKey = Number(b.dataset.crossPick); render(); }));
  };

  // ---------------------------------------------------------------- ① Formel & Fälle
  function renderFormula(s) {
    const f = form(s);
    const side = f.side;
    const ck = f.case;
    const { tasks, robots } = s.data.instance;
    const L = f.members.length;
    const line = (kind, lhs, term, note) => {
      const off = offNote(s, kind);
      return `<div class="fx-line t-${cls(kind)}${off ? ' off' : ''}" ${hl({ kind })}>
        <span class="fx-lhs">${lhs}</span><span class="fx-term">${term}</span>
        <span class="fx-note">${note}${off ? ` <em>(${off})</em>` : ''}</span></div>`;
    };
    const unused = f.groups[0] ? f.groups[0].codes.filter((c) => c.status === 'ungenutzt').map((c) => c.pattern) : [];
    const caseRows = CASE_ORDER.map((k) => {
      const sd = SIDE[k];
      const G = sd === 'zeile' ? '<i>T</i>' : '<i>R</i>';
      return `<tr class="${k === ck ? 'selected' : 'dim'}"><td><b>${CASE_LABELS[k]}</b></td><td>${CASE_TEXTS[k]}</td>
        <td>je ${sd === 'zeile' ? 'Auftrag' : 'Roboter'}, ${kDef(sd)}</td><td class="num">${G}·<i>K</i></td>
        <td class="fx-cell">${penName(sd)} + ${crossName(k)} + ${AUX_NAME}</td><td class="num">${G}(2<sup><i>K</i></sup> − <i>K</i> − 1)</td></tr>`;
    }).join('');
    const costs = s.data.instance.variables.map((v) => v.cost);
    const auxList = f.aux.map((a) => `${bH(s, a.index)} = ${bH(s, a.pair[0])}·${bH(s, a.pair[1])}`).join(', ');
    body.innerHTML = `
      <p class="fx-intro">Binary drückt „genau eins“ ohne Regel aus: Jede Stellung der <i>K</i> Bits ist genau ein Code. Der Code liegt darum auf der Seite,
        die vollständig zugewiesen wird. Hier <i>T</i> = ${tasks.length}, <i>R</i> = ${robots.length} → <b>Fall ${CASE_LABELS[ck]}</b>:
        je ${side === 'zeile' ? 'Auftrag ein Code über die Roboter' : 'Roboter ein Code über die Aufträge'}, <i>K</i> = ${f.K}.</p>
      <div class="fx">
        ${line('kosten', '<i>H</i> =', `${objName(side)} = ${objFormula(side)}`,
    `<b>Ziel:</b> ${yName(side)} = 1 genau beim gewählten Code – Σ <i>c</i>·${yName(side)} zählt dessen Kosten (<b>${s.data.instance.criterion.label}</b>).`)}
        ${line('ungueltig', '+ <i>A</i> ·', `${penName(side)} = ${penFormula(side)}`,
    `<b>Ungültige Codes:</b> die 2<sup>K</sup> − ${side === 'zeile' ? 'R' : 'T'} = ${2 ** f.K - L} ungenutzten Codes kosten A – ohne Kostenterm wären sie gratis.`)}
        ${line('quer', '+ <i>B</i> ·', `${crossName(ck)} = ${crossFormula(ck)}`,
    `<b>${crossTitle(ck)} – ${crossText(ck)}:</b> die One-Hot-Regel mit <i>x</i> = ${yName(side)} (immer 0 oder 1). Produkt zweier Codes → Grad 2<i>K</i>.`)}
        ${line('hilfsbit', '+ <i>M</i> ·', `${AUX_NAME} = ${AUX_FORMULA}`,
    '<b>Hilfsbits</b> (ab <i>K</i> ≥ 2): <i>a</i> ersetzt ein Bitpaar <i>x</i>·<i>y</i> in Termen vom Grad &gt; 2; die Strafe ist 0 genau bei <i>a</i> = <i>xy</i>, sonst ≥ 1.')}
        <div class="fx-line" style="border-color:${C.axis}" ${hl({ all: true })}><span class="fx-lhs">mit</span>
          <span class="fx-term">${yDef(side)},&nbsp; ${kDef(side)} = ${f.K}</span>
          <span class="fx-note">${side === 'zeile' ? '<i>u</i><sub><i>k</i>,<i>r</i></sub>' : '<i>v</i><sub><i>k</i>,<i>t</i></sub>'} = Stelle <i>k</i> des Codes (höchste zuerst).
            Jeder Faktor ist 0 oder 1 – ${yName(side)} ist 1 genau dann, wenn alle Stellen passen.</span></div>
      </div>
      <h4>${AUX_NAME} in Worten</h4>
      <p class="fx-intro" ${hl({ kind: 'hilfsbit' })}>Für <i>K</i> ≥ 2 ist ${yName(side)} ein Produkt aus <i>K</i> Faktoren (Grad <i>K</i>); die ${crossTitle(ck)}
        multipliziert zwei ${yName(side)} verschiedener Codes (Grad 2<i>K</i>), ab <i>K</i> = 3 haben schon Kosten und Codesperre Grad 3.
        Eine QUBO erlaubt nur Grad 2. Darum ersetzt ein Hilfsbit <i>a</i> ein Bitpaar <i>x</i>·<i>y</i> desselben Codes, das in einem Term vom Grad &gt; 2 vorkommt,
        und ${AUX_NAME} erzwingt <i>a</i> = <i>xy</i> (Rosenberg 1975). Hilfsbits bauen aufeinander auf (<i>a</i><sub>t,123</sub> = <i>a</i><sub>t,12</sub>·<i>b</i><sub>t,3</sub>),
        bis jeder Term höchstens zwei Variablen hat – je Code höchstens 2<sup><i>K</i></sup> − <i>K</i> − 1 (<i>K</i> = 2: eines, <i>K</i> = 3: vier).
        <i>M</i> muss den größten Gewinn übersteigen, den ein falsches Hilfsbit bringt.</p>
      <h4>Die drei Fälle</h4>
      <table class="data">
        <thead><tr><th>Fall</th><th></th><th>Code</th><th class="num">Bits</th><th>Strafterme</th><th class="num">Hilfsbits höchstens</th></tr></thead>
        <tbody>${caseRows}</tbody>
      </table>
      <h4>Symbole</h4>
      <table class="data symbols">
        <thead><tr><th>Symbol</th><th>Bedeutung</th><th>in diesem Szenario</th></tr></thead>
        <tbody>
          <tr ${hl({ all: true })}><td><i>t</i> ∈ <i>T</i>, <i>r</i> ∈ <i>R</i></td><td>Auftrag, Roboter (AMR)</td><td>${tasks.map((t) => `#${t.transport_id}`).join(', ')} · ${robots.map((r) => `R${r.robot_id}`).join(', ')}</td></tr>
          <tr ${hl({ kind: 'kosten' })}><td>${side === 'zeile' ? sym('b', I('t'), I('k')) : sym('g', I('r'), I('k'))} ∈ {0, 1}</td><td>Bit = Qubit, Stelle <i>k</i> des Codes von ${side === 'zeile' ? 'Auftrag <i>t</i>' : 'Roboter <i>r</i>'}</td>
            <td>${f.n_code_bits} Bits (One-Hot: ${s.data.compare.one_hot.n}, Domain Wall: ${s.data.compare.domain_wall.n})</td></tr>
          <tr ${hl({ all: true })}><td>${side === 'zeile' ? '<i>u</i><sub><i>r</i></sub>' : '<i>v</i><sub><i>t</i></sub>'}</td><td>Code = Platz in ${side === 'zeile' ? '<i>R</i> nach Nummer' : '<i>T</i> nach Anfrage'}</td>
            <td>${f.members.map((m, k) => `${member(s, m)} = ${f.groups[0]?.codes[k]?.pattern ?? '–'}`).join(' · ') || '–'}</td></tr>
          <tr ${hl({ kind: 'ungueltig' })}><td>${side === 'zeile' ? '<i>U</i><sub>f</sub>' : '<i>V</i><sub>f</sub>'}</td><td>ungenutzte Codes (2<sup><i>K</i></sup> − ${side === 'zeile' ? '<i>R</i>' : '<i>T</i>'})</td>
            <td>${unused.join(', ') || '– (Zweierpotenz)'}</td></tr>
          <tr ${hl({ all: true })}><td>${sym(yName(side), I('t'), I('r'))} ∈ {0, 1}</td><td>„<i>r</i> übernimmt <i>t</i>“ – keine eigene Variable, sondern ein Produkt der Bits</td>
            <td>${s.data.instance.variables.length} Paare</td></tr>
          <tr ${hl({ kind: 'hilfsbit' })}><td><i>a</i></td><td>Hilfsbit für ein Paar – ein eigenes Qubit</td><td>${auxList || '– (Grad ≤ 2)'}</td></tr>
          <tr ${hl({ kind: 'kosten' })}><td><i>c</i><sub><i>t</i>,<i>r</i></sub></td><td>${s.data.instance.criterion.en}: ${formulaHtml(s.data.instance.criterion.formula)}</td>
            <td>${costs.length ? `${fmt(Math.min(...costs))} … ${fmt(Math.max(...costs))} ${unit(s)}` : '–'}</td></tr>
          <tr ${hl({ kind: 'ungueltig' })}><td><i>A</i>, <i>B</i>, <i>M</i></td><td>Gewichte: Codesperre, ${crossTitle(ck)}, Hilfsbits (im Paper implizit 1)</td><td>${fmt(s.A)}, ${fmt(s.B)}, ${fmt(s.M)} (Regler)</td></tr>
        </tbody>
      </table>`;
  }

  // ---------------------------------------------------------------- ② Eingesetzt
  function renderSubstituted(s) {
    const f = form(s);
    const x = s.x;
    const dec = decodeIaBin(f, x, s.qubo);
    const rows = [];
    let total = 0;
    for (const gr of f.groups.filter((g) => g.vars.length)) {
      const ok = gr.codes.filter((c) => c.var != null);
      const val = ok.reduce((acc, c) => acc + c.cost * indVal(s, gr, c.code, x), 0);
      if (s.terms.kosten) total += val;
      rows.push({ kind: 'kosten', sel: groupSel(s, gr.key), name: `Kosten ${groupLabel(s, gr.key)}`,
        formula: ok.map((c) => `${fmt(c.cost)}·${indHtml(s, gr, c.code)}`).join(' + '),
        subst: ok.map((c) => `${fmt(c.cost)}·${indHtml(s, gr, c.code, x)}`).join(' + '), value: val });
      const bad = gr.codes.filter((c) => c.var == null);
      if (bad.length) {
        const pv = s.A * bad.reduce((acc, c) => acc + indVal(s, gr, c.code, x), 0);
        if (s.terms.ungueltig) total += pv;
        rows.push({ kind: 'ungueltig', sel: groupSel(s, gr.key), name: `Codesperre ${groupLabel(s, gr.key)}`,
          formula: `<i>A</i>·[ ${bad.map((c) => indHtml(s, gr, c.code)).join(' + ')} ]`,
          subst: `${fmt(s.A)}·[ ${bad.map((c) => indHtml(s, gr, c.code, x)).join(' + ')} ]`, value: pv, ok: pv === 0 });
      }
    }
    for (const q of dec.cross) {
      const vs = q.rule.var_ids;
      const val = s.B * q.penalty;
      if (s.terms.quer) total += val;
      let formula;
      let subst;
      if (q.rule.exact) {
        formula = `<i>B</i>·(1 − [ ${vs.map((v) => yHtml(s, v)).join(' + ')} ])²`;
        subst = `${fmt(s.B)}·(1 − [ ${vs.map((v) => bit(dec.ys[v])).join(' + ')} ])² = ${fmt(s.B)}·(1 − ${q.n})²`;
      } else {
        const prs = [];
        for (let a = 0; a < vs.length; a += 1) for (let b = a + 1; b < vs.length; b += 1) prs.push([vs[a], vs[b]]);
        formula = prs.length ? `<i>B</i>·( ${prs.map(([p, r]) => `${yHtml(s, p)}${yHtml(s, r)}`).join(' + ')} )` : '– (kein Paar)';
        subst = prs.length ? `${fmt(s.B)}·( ${prs.map(([p, r]) => `${bit(dec.ys[p])}·${bit(dec.ys[r])}`).join(' + ')} ) = ${fmt(s.B)}·${q.penalty}` : '0';
      }
      rows.push({ kind: 'quer', sel: crossSel(s, q.key), name: `${crossTitle(f.case)} ${q.name}`, formula, subst, value: val, ok: q.ok });
    }
    if (s.qubo) {
      for (const a of f.aux) {
        const [px, py] = a.pair;
        const pen = x[px] * x[py] - 2 * x[px] * x[a.index] - 2 * x[py] * x[a.index] + 3 * x[a.index];
        if (s.terms.hilfsbit) total += s.M * pen;
        rows.push({ kind: 'hilfsbit', sel: { vars: [a.index, px, py] }, name: `Hilfsbit ${bH(s, a.index)}`,
          formula: `<i>M</i>·(${bH(s, px)}${bH(s, py)} − 2${bH(s, px)}${bH(s, a.index)} − 2${bH(s, py)}${bH(s, a.index)} + 3${bH(s, a.index)})`,
          subst: `${fmt(s.M)}·(${bit(x[px])}·${bit(x[py])} − 2·${bit(x[px])}·${bit(x[a.index])} − 2·${bit(x[py])}·${bit(x[a.index])} + 3·${bit(x[a.index])})`,
          value: s.M * pen, ok: pen === 0 });
      }
    }
    body.innerHTML = `
      <p class="fx-intro">Die Formel mit den Zahlen dieses Szenarios und deinen Bits (<b class="one">1</b> = gesetzt). Jedes Indikator-Produkt ist 1 genau beim gezeigten Code;
        in der ${crossTitle(f.case)} steht jedes ${yName(f.side)} als fertiger Wert 0 oder 1. ${s.qubo ? 'Hilfsbit-Zeilen sind 0, solange die Hilfsbits ehrlich sind.' : 'Hilfsbits ab Schritt 6.'}</p>
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
    const gr = f.groups.find((g) => g.key === groupKey);
    const K = f.K;
    // Indikator je Code der gewählten Gruppe: Produkt → Polynom vom Grad K
    let indTable = '<p class="hint">Nur ein Mitglied – 0 Bits, nichts auszumultiplizieren.</p>';
    if (gr && K > 0) {
      indTable = `<div class="table-wrap"><table class="data fx-table">
        <thead><tr><th>Code</th><th>${zeile(s) ? 'Roboter' : 'Auftrag'}</th><th>Produkt</th><th>ausmultipliziert</th></tr></thead>
        <tbody>${gr.codes.map((c) => `<tr class="${c.var == null ? 'warnrow' : ''}" ${hl({ ...groupSel(s, gr.key), vars: gr.bits })}><td class="mono">${c.pattern}</td>
          <td>${c.member != null ? member(s, c.member) : 'ungenutzt'}</td><td class="fx-cell">${indHtml(s, gr, c.code)}</td>
          <td class="fx-cell">${polyHtml(s, indicatorPoly(K, gr.bits, c.code))}</td></tr>`).join('')}</tbody></table></div>`;
    }
    // Kosten der Gruppe: Σ c·Indikator (die Konstante der Python-Terme mischt alle Codes)
    let costHtml = '';
    if (gr && gr.vars.length && K > 0) {
      const p = new Map();
      for (const c of gr.codes.filter((cc) => cc.var != null)) {
        for (const [k, v] of indicatorPoly(K, gr.bits, c.code)) p.set(k, (p.get(k) || 0) + v * c.cost);
      }
      for (const [k, v] of p) if (Math.abs(v) < 1e-9) p.delete(k);
      costHtml = `<div class="fx-derivation t-kosten${s.terms.kosten ? '' : ' off'}" ${hl(groupSel(s, gr.key))}>
          <div>${gr.codes.filter((c) => c.var != null).map((c) => `${fmt(c.cost)}·${indHtml(s, gr, c.code)}`).join(' + ')}</div>
          <div><span class="eq">=</span> ${polyHtml(s, p)}</div>
          <div class="why">Jeder Koeffizient mischt mehrere ${zeile(s) ? 'Roboter' : 'Aufträge'} – kein Bit heißt „${zeile(s) ? 'Roboter' : 'Auftrag'} gewählt“. Grad ${K}${K > 2 ? ': <b>schon die Kosten sind keine QUBO</b>' : ''}.</div>
        </div>`;
    }
    // Querregel: Produkt zweier Codes der gewählten Gruppe der anderen Seite
    const rule = f.rules.find((r) => r.kind === 'quer' && crossOf(r) === crossKey);
    let crossHtml = '<p class="hint">Keine Regel.</p>';
    if (rule) {
      const vs = rule.var_ids;
      /** Code und Gruppe, deren Indikator y der Variable v ist. */
      const codeOf = (v) => {
        const g = f.groups.find((h) => h.codes.some((c) => c.var === v));
        return { g, code: g.codes.find((c) => c.var === v).code };
      };
      const yPoly = (v) => { const { g, code } = codeOf(v); return indicatorPoly(K, g.bits, code); };
      const yProd = (v) => { const { g, code } = codeOf(v); return indHtml(s, g, code); };
      const ex = vs.length > 1 ? polyMul(yPoly(vs[0]), yPoly(vs[1])) : null;
      const maxDeg = ex ? Math.max(0, ...[...ex.keys()].map((k) => unkey(k).length)) : 0;
      const y = yName(f.side);
      crossHtml = `<div class="fx-derivation t-spalte${s.terms.quer ? '' : ' off'}" ${hl(crossSel(s, crossOf(rule)))}>
          ${rule.exact ? `<div><i>B</i>(1 − Σ ${y})² <span class="eq">=</span> <i>B</i> − <i>B</i> Σ ${y} + 2<i>B</i> Σ<sub><i>i</i>&lt;<i>j</i></sub> ${y}<sub><i>i</i></sub>${y}<sub><i>j</i></sub>
            <span class="hint">(${y}² = ${y}, weil ${y} ∈ {0, 1})</span></div>` : ''}
          ${ex ? `<div>${yHtml(s, vs[0])}·${yHtml(s, vs[1])} = (${yProd(vs[0])})·(${yProd(vs[1])})</div>
            <div><span class="eq">=</span> ${polyHtml(s, ex, 18)}</div>` : '<div class="hint">Nur ein Mitglied – kein Produkt.</div>'}
          <div class="why">${ex ? `${ex.size} Terme bis Grad ${maxDeg}. ` : ''}Grade dieser Regel: ${Object.entries(rule.degrees).map(([d, n]) => `${n}× Grad ${d}`).join(', ') || '–'}.
            Anders als bei Domain Wall belohnt die Regel nie – ${yName(f.side)} ist immer 0 oder 1.</div>
        </div>`;
    }
    const kinds = POLY_TERMS.map((kind) => {
      const counts = {};
      for (const t of f.polynomial[kind]) if (t.vars.length) counts[t.vars.length] = (counts[t.vars.length] || 0) + 1;
      return { kind, counts };
    });
    const maxDeg = Math.max(1, f.max_degree);
    const degTable = `<table class="data"><thead><tr><th>Herkunft</th>${Array.from({ length: maxDeg }, (_, d) => `<th class="num">Grad ${d + 1}</th>`).join('')}</tr></thead>
      <tbody>${kinds.map((r) => `<tr class="t-row t-${cls(r.kind)}" ${hl({ kind: r.kind })}><td>${termName(r.kind, f.case)} · ${termTitle(r.kind, f.case)}</td>
        ${Array.from({ length: maxDeg }, (_, d) => `<td class="num${d + 1 > 2 && r.counts[d + 1] ? ' no-val' : ''}">${r.counts[d + 1] || ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const perGroup = f.aux.length && f.groups.length ? Math.max(...f.groups.map((g) => f.aux.filter((a) => a.group === g.key).length)) : 0;
    const auxHtml = f.aux.length
      ? `<div class="fx-derivation t-reihenfolge${s.terms.hilfsbit ? '' : ' off'}">
          ${f.aux.map((a) => `<div ${hl({ vars: [a.index, ...a.pair] })}>${bH(s, a.index)} = ${bH(s, a.pair[0])}·${bH(s, a.pair[1])} ersetzt das Paar in ${a.replaced} Term${a.replaced === 1 ? '' : 'en'}
            &nbsp;→&nbsp; <span class="p-pair">${fmt(s.M)}·(${bH(s, a.pair[0])}${bH(s, a.pair[1])} − 2${bH(s, a.pair[0])}${bH(s, a.index)} − 2${bH(s, a.pair[1])}${bH(s, a.index)} + 3${bH(s, a.index)})</span></div>`).join('')}
          <div class="why">Nur Paare <b>desselben Codes</b>, das häufigste zuerst: ${perGroup} je Code (höchstens 2<sup>${K}</sup> − ${K} − 1 = ${Math.max(0, 2 ** K - K - 1)}).
            Danach ist jedes ${yName(f.side)} linear in Bits und Hilfsbits seines Codes – ein Produkt zweier ${yName(f.side)} hat Grad 2.</div>
        </div>`
      : `<p class="hint">Kein Term über zwei Bits – keine Hilfsbits nötig (${K < 2 ? '<i>K</i> = 1' : 'nur ein Code, Grad ≤ 2'}).</p>`;
    const model = s.model;
    const lin = model.entries.filter((e) => e.i === e.j && e.value !== 0);
    const quad = model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const termHtml = [...lin.map((e) => `<span class="q-term" ${hl({ vars: [e.i] })}>${signed(e.value)}·${bH(s, e.i)}</span>`),
      ...quad.map((e) => `<span class="q-term" ${hl({ vars: [e.i, e.j] })}>${signed(e.value)}·${bH(s, e.i)}${bH(s, e.j)}</span>`)];
    const honest = Uint8Array.from(s.x);
    for (const a of f.aux) honest[a.index] = honest[a.pair[0]] * honest[a.pair[1]];
    const Eq = energy(makeModel(f, { A: s.A, B: s.B, D: s.M, terms: ALL }), honest);
    const Ep = polyEnergy(f, honest, s.A, s.B, ALL);
    body.innerHTML = `
      <p class="fx-intro">Anders als bei One-Hot und Domain Wall ist jedes ${yName(f.side)} ein <b>Produkt</b> aller Bits eines Codes,
        die ${crossTitle(f.case)} ein Produkt zweier Produkte – erst Hilfsbits bringen alles auf Grad 2.</p>
      <h4>Ein ${yName(f.side)} je Code von ${groupChips(s)}</h4>${indTable}
      <h4>Kosten ${objName(f.side)} dieses Codes</h4>${costHtml || '<p class="hint">–</p>'}
      <h4>${crossTitle(f.case)} ${crossName(f.case)} für ${crossChips(s)}</h4>${crossHtml}
      <h4>Terme vor den Hilfsbits nach Grad (rot = kein QUBO-Term)</h4>${degTable}
      <h4>Hilfsbits ${AUX_NAME}: Paare ersetzen</h4>${auxHtml}
      <h4>Fertige QUBO-Form – das bekommt die Hardware${s.qubo ? '' : ' (ab Schritt 6)'}</h4>
      <div class="fx-qubo"><i>H</i> = ${termHtml.slice(0, 30).join(' ')}${termHtml.length > 30 ? ` <span class="hint">… und ${termHtml.length - 30} weitere Terme</span>` : ''} <span class="q-term">${signed(model.constant)}</span></div>
      <p class="fx-probe">Probe mit deinen Code-Bits und ehrlichen Hilfsbits: QUBO <b>${fmt(Eq)}</b>, Polynom <b>${fmt(Ep)}</b>
        ${Math.abs(Eq - Ep) < 1e-6 ? '<span class="okline">✓ identisch – ehrliche Hilfsbits ändern nichts.</span>' : '<span class="warnline">✗ Abweichung</span>'}</p>`;
    bindChips();
  }

  // ---------------------------------------------------------------- ④ Wirkung der Terme
  function renderEffects(s) {
    const f = form(s);
    const gr = f.groups.find((g) => g.key === groupKey);
    const sweeps = { A: el('div', { class: 'chart short' }), B: el('div', { class: 'chart short' }), M: el('div', { class: 'chart short' }) };
    const codeTable = gr && gr.vars.length
      ? el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Code'), el('th', {}, zeile(s) ? 'Roboter' : 'Auftrag'), el('th', { class: 'num' }, `Kosten-Term [${unit(s)}]`),
          el('th', { class: 'num' }, 'A · Sperre'), el('th', { class: 'num' }, 'Summe'))),
        el('tbody', {}, gr.codes.map((c) => {
          const pen = c.var == null ? s.A : 0;
          const cost = c.var == null ? 0 : c.cost;
          return el('tr', { class: c.var == null ? 'warnrow' : '' }, el('td', { class: 'mono' }, c.pattern || '–'),
            el('td', {}, c.member != null ? member(s, c.member) + (c.var == null ? ' (gesperrt)' : '') : 'ungenutzt'),
            el('td', { class: 'num' }, fmt(cost)), el('td', { class: 'num' }, fmt(pen)), el('td', { class: 'num' }, el('b', {}, fmt(cost + pen))));
        })))
      : el('p', { class: 'hint' }, 'Kein Code mit Bits gewählt.');
    const ros = el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'x'), el('th', { class: 'num' }, 'y'), el('th', { class: 'num' }, 'a'), el('th', {}, 'a = x·y?'),
        el('th', { class: 'num' }, 'xy − 2xa − 2ya + 3a'), el('th', { class: 'num' }, `× M = ${fmt(s.M)}`))),
      el('tbody', {}, [0, 1].flatMap((xx) => [0, 1].flatMap((yy) => [0, 1].map((aa) => {
        const pen = xx * yy - 2 * xx * aa - 2 * yy * aa + 3 * aa;
        const ok = aa === xx * yy;
        return el('tr', { class: ok ? '' : 'warnrow' }, el('td', { class: 'num' }, xx), el('td', { class: 'num' }, yy), el('td', { class: 'num' }, aa),
          el('td', { class: ok ? 'ok' : 'no' }, ok ? '✓ ehrlich' : '✗ lügt'), el('td', { class: 'num' }, pen), el('td', { class: 'num' }, fmt(pen * s.M)));
      })))));
    const keys = f.aux.length ? ['A', 'B', 'M'] : ['A', 'B'];
    const titles = { A: 'Wie groß muss A sein? (ungültige Codes)', B: `Wie groß muss B sein? (${crossTitle(f.case)})`, M: 'Wie groß muss M sein? (Hilfsbits)' };
    fill(body,
      el('p', { class: 'fx-intro', html: `Codebuch eines Codes (ohne Sperre ist ein ungenutzter Code gratis), Hilfsbit-Strafe in allen 8 Fällen und der
        <b>Gültigkeitsbereich</b> je Gewicht (QUBO mit Hilfsbits, alle Terme an). Klick in eine Kurve setzt das Gewicht.` }),
      el('div', { class: 'grid grid-2' },
        el('div', {}, el('h4', { html: `Codebuch von ${groupChips(s)}` }), codeTable),
        el('div', {}, el('h4', {}, 'Hilfsbit-Strafe: 0 genau dann, wenn a = x·y'), ros,
          el('p', { class: 'hint' }, 'Jede Lüge kostet ≥ M. Lohnt sie sich trotzdem (eine Strafe wird zur Belohnung), ist M zu klein.'))),
      el('div', { class: 'grid grid-2' }, keys.map((k) => el('div', {}, el('h4', {}, titles[k]), sweeps[k], el('p', { class: 'hint', 'data-sweep': k })))));
    bindChips();
    for (const k of keys) {
      const res = drawSweep(s, k, sweeps[k]);
      const note = body.querySelector(`[data-sweep="${k}"]`);
      if (!res || !note) continue;
      const below = res.lo != null ? [...res.pts].reverse().find((p) => !p.valid && p.val < res.lo) : null;
      const above = res.bounded ? res.pts.find((p) => !p.valid && p.val > res.hi) : null;
      const parts = [];
      if (res.lo == null) parts.push('Im Bereich nie gültig – ein anderes Gewicht ist zu klein oder kein gültiger Plan möglich.');
      else if (res.lo === 0 && !res.bounded) parts.push(`Für jedes ${k} gültig – die Regel hält der Rest ein.`);
      if (below) parts.push(`Unter ${k} ≈ ${fmt(res.lo)}: <b>${below.desc}</b>.`);
      if (above) parts.push(`<b>Über ${k} ≈ ${fmt(res.hi)} kippt es wieder</b>: <b>${above.desc}</b> – zu großes Gewicht macht eine Hilfsbit-Lüge lohnend.`);
      note.innerHTML = parts.join(' ');
    }
  }

  function drawSweep(s, k, div) {
    const f = form(s);
    if (f.n > SWEEP_MAX_BITS) {
      fill(div, el('p', { class: 'hint' }, `Kurve nur bis ${SWEEP_MAX_BITS} Qubits (hier ${f.n}).`));
      div.style.minHeight = '0';
      return null;
    }
    const cur = { A: s.A, B: s.B, M: s.M };
    const top = Math.max(100, Math.ceil((Math.max(cur[k], s.data.weights[k]) * 2) / 10) * 10);
    const inst = s.data.instance;
    const cacheKey = `${k}|${s.A}|${s.B}|${s.M}|${top}|${inst.tasks.map((t) => t.transport_id)}|${inst.robots.map((r) => r.robot_id)}|${inst.mode}|${inst.criterion.key}|${JSON.stringify(inst.params)}`;
    let pts = sweepCache.get(cacheKey);
    if (!pts) {
      pts = [];
      for (let j = 0; j <= 40; j += 1) {
        const val = Math.round((top * j) / 40);
        const w = { ...cur, [k]: val };
        const m = makeModel(f, { A: w.A, B: w.B, D: w.M, terms: ALL });
        const r = search(m, 1);
        const x = fromMask(r.min.mask, f.n);
        pts.push({ val, E: r.min.E, valid: decodeIaBin(f, x).valid, desc: api.describe(x) });
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
      hovertemplate: `${k} = %{x}: Minimum H = %{y}<br>%{customdata[0]}<br>%{customdata[1]}<extra></extra>`,
    }], {
      margin: { l: 52, r: 10, t: 34, b: 44 },
      xaxis: { title: { text: `Strafgewicht ${k} (andere fest, alle Terme an)` } },
      yaxis: { title: { text: 'Energie des Minimums' } },
      shapes: [{ type: 'line', x0: cur[k], x1: cur[k], yref: 'paper', y0: 0, y1: 1, line: { color: C.accent, width: 2 } }],
      annotations: [
        { x: cur[k], yref: 'paper', y: 0, text: `aktuell ${k} = ${fmt(cur[k])}`, showarrow: false, yanchor: 'bottom', xanchor: 'left', xshift: 4, font: { color: C.accent } },
        { xref: 'paper', yref: 'paper', x: 0, y: 1.12, xanchor: 'left', showarrow: false, font: { color: C.ink2 },
          text: lo == null ? 'im gezeigten Bereich nie gültig'
            : `<span style="color:${C.series}">●</span> gültig ${bounded ? `zwischen ${k} ≈ ${fmt(lo)} und ${fmt(hi)}` : lo > 0 ? `ab ${k} ≈ ${fmt(lo)}` : 'für jedes Gewicht'}  <span style="color:${C.axis}">●</span> ungültig` },
      ],
    });
    div.removeAllListeners?.('plotly_click');
    div.on('plotly_click', (ev) => {
      const p = ev.points && ev.points[0];
      if (p) api.setWeight(k, p.x);
    });
    return { pts, lo, hi, bounded };
  }

  return { render, setTab, get tab() { return tab; } };
}
