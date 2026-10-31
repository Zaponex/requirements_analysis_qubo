// Bausteine des Formel-Baukastens: als Formel zeigen, in Worten erklären, die Wirkung ihrer Form
// beurteilen und bearbeiten. Die Mathematik (Ausmultiplizieren, Hilfsbits) macht encodings/baukasten.py.
import { el, fill, nf } from '../util.js';
import { niceCeil } from './onehotCriterion.js';
import { ENC_LABEL } from '../qubo/encoding.js';

export const TYPE_LABEL = {
  kosten: 'Kosten (Ziel)',
  vorgaenger: 'Vorgänger-Kopplung (Ziel)',
  gruppe: 'Gruppenregel',
  nachbar: 'Nachbarplatz-Regel',
  bitgruppe: 'Bit-Gruppe',
  bitnachbar: 'Bit-Nachbarn / Kettenregel',
  ungueltig: 'Phantom-Codes (Binary)',
  hilfsbit: 'Hilfsbit-Strafe M',
};
/** Ebene eines Bausteins: Zuweisung (über Indikatoren) oder direkt auf den Bits. */
export const LEVEL = { kosten: 'zuweisung', vorgaenger: 'zuweisung', gruppe: 'zuweisung', nachbar: 'zuweisung',
  bitgruppe: 'bits', bitnachbar: 'bits', ungueltig: 'bits', hilfsbit: 'bits' };
export const FORM_LABEL = { genau: 'genau k', hoechstens1: 'höchstens eins', linear: 'linear: k − n', eigene: 'eigene: a + b·n + c·n²' };
export const WEIGHTING_LABEL = { q: 'q – von hinten', eins: '1 – jeder Platz einfach', vorne: 'K + 1 − q – von vorne' };
export const SCOPE_LABEL = { alle: 'alle Aufträge', ...Object.fromEntries(Object.entries(ENC_LABEL).map(([k, v]) => [k, `nur ${v}-Blöcke`])) };
const PENALTY_SYMBOLS = ['A', 'B', 'D', 'E', 'F', 'G', 'H', 'J', 'L', 'P'];
const SPEC_KEYS = ['id', 'type', 'symbol', 'bloecke', 'auto', 'gewichtung', 'wartezeit', 'anfahrt', 'variante', 'gruppe', 'form', 'k', 'a', 'b', 'c', 'd'];
export const COST_TYPES = new Set(['kosten', 'vorgaenger']);

export const fmt = (v) => nf(v, 2).replace('-', '−');
const sgn = (v, first = false) => (v < 0 ? ` − ${fmt(-v)}` : `${first ? '' : ' + '}${fmt(v)}`);

/** Nur die Felder, die einen Baustein beschreiben (ohne Server-Zusätze wie stats, f, covers). */
export const specOf = (t) => Object.fromEntries(SPEC_KEYS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));

// ---------------------------------------------------------------- Farben: nach Rolle wie auf den anderen Seiten
const COLORS = { kosten: '#2a78d6', vorgaenger: '#1baf7a', auftrag: '#eb6834', platz: '#4a3aa7', roboter: '#4a3aa7',
  auftrag_roboter: '#eda100', alle: '#008300', nachbar: '#e87ba4', bitgruppe: '#5f6b7a', bitnachbar: '#a3470f',
  ungueltig: '#c92a2a', hilfsbit: '#0f8a8a' };
export function termColor(t) {
  if (!t) return '#898781';
  return t.type === 'gruppe' ? COLORS[t.gruppe || 'auftrag'] : COLORS[t.type];
}
/** Helle Tönung für Matrixzellen: Farbe mit Weiß gemischt. */
export function termTint(t, f = 0.78) {
  const hex = termColor(t).slice(1);
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${c.map((v) => Math.round(v + (255 - v) * f)).join(',')})`;
}

// ---------------------------------------------------------------- Gruppen
export function groupLabel(g, K) {
  return {
    auftrag: 'je Auftrag',
    platz: K > 1 ? 'je Roboter-Platz' : 'je Roboter',
    roboter: K > 1 ? 'je Roboter (alle Plätze zusammen)' : 'je Roboter',
    auftrag_roboter: 'je Auftrag und Roboter',
    alle: 'alle Optionen zusammen',
  }[g];
}
export const BIT_GROUP_LABEL = { block: 'je Block (Bits eines Auftrags)', stelle: 'je Bitstelle (über alle Aufträge)', alle: 'alle Bits zusammen' };
/** Laufindizes: über welche Gruppen summiert wird (außen) und welche Optionen eine Gruppe bilden (innen). */
function groupIndex(g, K) {
  const multi = K > 1;
  return {
    auftrag: { outer: 't', inner: multi ? 'r,q' : 'r' },
    platz: { outer: multi ? 'r,q' : 'r', inner: 't' },
    roboter: { outer: 'r', inner: multi ? 't,q' : 't' },
    auftrag_roboter: { outer: 't,r', inner: multi ? 'q' : '' },
    alle: { outer: '', inner: multi ? 't,r,q' : 't,r' },
  }[g];
}

/** Kurzname für Tabellen: bei Gruppenregeln mit der Gruppe, damit A und B unterscheidbar bleiben. */
export function termShort(t, K) {
  if (t.type === 'gruppe') return `Gruppe ${groupLabel(t.gruppe || 'auftrag', K)}`;
  if (t.type === 'bitgruppe') return `Bit-Gruppe ${BIT_GROUP_LABEL[t.gruppe || 'block'].split(' (')[0]}`;
  if (t.type === 'bitnachbar') return t.form === 'eigene' ? 'Bit-Nachbarn (eigene Form)' : 'Kettenregel';
  return TYPE_LABEL[t.type];
}

/** Variable einer Option: x bei reinem One-Hot, sonst der Indikator I („t nimmt Option o“). */
const v = (ctx, t = 't', r = 'r', q = 'q') => {
  const s = ctx.K === 1 ? `${t},${r}` : `${t},${r},${q}`;
  return ctx.ind === 'x' ? `<i>x</i><sub>${s}</sub>` : `<i>I</i><sub>${s}</sub>`;
};
const sum = (idx) => (idx ? `Σ<sub><i>${idx}</i></sub> ` : '');
function weightHtml(weighting, K) {
  if (K === 1) return '';
  return { q: '<i>q</i>·', eins: '', vorne: `(${K + 1} − <i>q</i>)·` }[weighting || 'q'];
}
const scopeNote = (t) => (t.bloecke && t.bloecke !== 'alle' ? ` <span class="hint">· ${SCOPE_LABEL[t.bloecke]}</span>` : '');
function fHtml(t, n) {
  const k = t.k ?? 1;
  const s = ['z', 'x', 'I'].find((c) => n.includes(`<i>${c}</i>`)) || 'I';
  return {
    genau: `( ${fmt(k)} − ${n} )²`,
    hoechstens1: `Σ<sub><i>i</i>&lt;<i>j</i></sub> <i>${s}<sub>i</sub>${s}<sub>j</sub></i>`,
    linear: `( ${fmt(k)} − ${n} )`,
    eigene: `[ ${fmt(t.a ?? 0)}${sgn(t.b ?? 0)}·<i>n</i>${sgn(t.c ?? 0)}·<i>n</i>² ], <i>n</i> = ${n}`,
  }[t.form || 'genau'];
}

/** Formel eines Bausteins (ohne Gewicht), passend zu K, Zielart und Kodierung. */
export function termFormula(t, ctx) {
  const { K, objective } = ctx;
  let out;
  if (t.type === 'kosten') {
    if (objective === 'zuweisung') out = `${sum('t,r')}<i>c</i><sub>t,r</sub> · ${v(ctx)}`;
    else {
      const inner = [t.anfahrt === false ? null : '<i>s</i>⁰<sub>r,t</sub>', '<i>p</i><sub>t</sub>'].filter(Boolean).join(' + ');
      const w = weightHtml(t.gewichtung, K);
      const body = `${t.wartezeit === false ? '' : 'ρ<sub>r</sub> + '}${w}${w || inner.includes('+') ? `(${inner})` : inner}`;
      out = `${sum(K === 1 ? 't,r' : 't,r,q')}[ ${body} ] · ${v(ctx)}`;
    }
  } else if (t.type === 'vorgaenger') {
    if (K < 2) return '<span class="hint">– wirkt erst ab K = 2 Plätzen</span>';
    const d = t.variante === 'ohne_abzug' ? '<i>s</i><sub>t,t′</sub>' : '(<i>s</i><sub>t,t′</sub> − <i>s</i>⁰<sub>r,t′</sub>)';
    out = `Σ<sub><i>r,q</i></sub> Σ<sub><i>t</i>≠<i>t</i>′</sub> ${weightHtml(t.gewichtung, K)}${d} · ${v(ctx, 't', 'r', 'q+1')} ${v(ctx, 't′', 'r', 'q')}`;
  } else if (t.type === 'gruppe') {
    const { outer, inner } = groupIndex(t.gruppe || 'auftrag', K);
    const sym = ctx.ind === 'x' ? '<i>x</i>' : '<i>I</i>';
    out = `${sum(outer)}${fHtml(t, inner ? `Σ<sub><i>${inner}</i></sub> ${sym}` : sym)}`;
  } else if (t.type === 'nachbar') {
    if (K < 2) return '<span class="hint">– wirkt erst ab K = 2 Plätzen</span>';
    const o1 = '<i>o</i><sub>r,q+1</sub>';
    const o2 = '<i>o</i><sub>r,q</sub>';
    const g = t.form === 'eigene'
      ? `[ ${fmt(t.a ?? 0)}${sgn(t.b ?? 0)}·${o1}${sgn(t.c ?? 0)}·${o2}${sgn(t.d ?? 0)}·${o1}${o2} ]`
      : `${o1} ( 1 − ${o2} )`;
    out = `Σ<sub><i>r,q</i></sub> ${g}, &nbsp;<i>o</i><sub>r,q</sub> = Σ<sub><i>t</i></sub> ${v(ctx)}`;
  } else if (t.type === 'bitgruppe') {
    const g = t.gruppe || 'block';
    const n = { block: 'Σ<sub><i>j</i></sub> <i>z</i><sub>t,j</sub>', stelle: 'Σ<sub><i>t</i></sub> <i>z</i><sub>t,j</sub>', alle: 'Σ<sub><i>t,j</i></sub> <i>z</i><sub>t,j</sub>' }[g];
    out = `${{ block: sum('t'), stelle: sum('j'), alle: '' }[g]}${fHtml(t, n)}`;
  } else if (t.type === 'bitnachbar') {
    const z1 = '<i>z</i><sub>t,j+1</sub>';
    const z2 = '<i>z</i><sub>t,j</sub>';
    out = t.form === 'eigene'
      ? `Σ<sub><i>t,j</i></sub> [ ${fmt(t.a ?? 0)}${sgn(t.b ?? 0)}·${z1}${sgn(t.c ?? 0)}·${z2}${sgn(t.d ?? 0)}·${z1}${z2} ]`
      : `Σ<sub><i>t,j</i></sub> ${z1} ( 1 − ${z2} )`;
  } else if (t.type === 'ungueltig') {
    out = 'Σ<sub><i>t</i></sub> Σ<sub><i>k</i> ≥ <i>m<sub>t</sub></i></sub> <i>I</i><sub>t,k</sub>(<i>z</i>)';
  } else {
    out = 'Σ<sub><i>w</i> = <i>x·y</i></sub> ( <i>xy</i> − 2<i>xw</i> − 2<i>yw</i> + 3<i>w</i> )';
  }
  return out + scopeNote(t);
}

/** Ein Satz: Was tut dieser Baustein? */
export function termSentence(t, { K, objective, critLabel }) {
  if (t.type === 'kosten') {
    if (objective === 'zuweisung') return `Ziel: jede gewählte Option zahlt ihre Kosten nach „${critLabel}“.`;
    return `Ziel: jede Option zahlt ${t.wartezeit === false ? '' : 'Wartezeit + '}${K > 1 ? `${{ q: 'q-mal', eins: 'einmal', vorne: '(K + 1 − q)-mal' }[t.gewichtung || 'q']} ` : ''}`
      + `${t.anfahrt === false ? 'Bearbeitung (ohne Anfahrt)' : 'Anfahrt vom Standort + Bearbeitung'}.`;
  }
  if (t.type === 'vorgaenger') {
    return t.variante === 'ohne_abzug'
      ? 'Ziel: liegt t direkt vor t′, kommt die Anfahrt vom Abgabeort von t dazu – ohne die schon gezählte Anfahrt vom Standort abzuziehen.'
      : 'Ziel: liegt t direkt vor t′, wird die Anfahrt vom Standort durch die vom Abgabeort von t ersetzt.';
  }
  const what = (form, k, u) => {
    const one = u === 'Bits' ? 'ein Bit' : 'eine Option';
    return { genau: (k ?? 1) === 1 ? `genau ${one} an` : `genau ${fmt(k)} ${u} an`, hoechstens1: `höchstens ${one} an`,
      linear: 'belohnt jedes Einschalten (k − n: je mehr, desto billiger)', eigene: `eigene Strafe f(n) für n eingeschaltete ${u}` }[form || 'genau'];
  };
  if (t.type === 'gruppe') return `${groupLabel(t.gruppe || 'auftrag', K)}: ${what(t.form, t.k, 'Optionen')}.`;
  if (t.type === 'nachbar') {
    return t.form === 'eigene' ? 'eigene Strafe g(o₁, o₂) für die Belegung zweier benachbarter Plätze.' : 'Platz q + 1 darf nur belegt sein, wenn Platz q belegt ist.';
  }
  if (t.type === 'bitgruppe') return `Bits ${BIT_GROUP_LABEL[t.gruppe || 'block']}: ${what(t.form, t.k, 'Bits')}.`;
  if (t.type === 'bitnachbar') {
    return t.form === 'eigene' ? 'eigene Strafe g für je zwei benachbarte Bits eines Blocks.' : 'Kettenregel: Bit j + 1 nur an, wenn Bit j an ist – keine Wand 0 → 1.';
  }
  if (t.type === 'ungueltig') return 'Binärcodes ohne Option („Phantom-Roboter“) kosten.';
  return 'Jedes Hilfsbit w muss das Produkt x·y sein, das es ersetzt.';
}

// ---------------------------------------------------------------- Wirkung der Form
/** f(n) für n = 0 … N und die Beurteilung gegenüber der Anforderung, die die Regel abdeckt. */
export function groupVerdict(r, K) {
  const f = r.f || { a: 0, b: 0, c: 0 };
  const N = Math.max(3, Math.min(r.max_size || 3, 6));
  const vals = Array.from({ length: N + 1 }, (_, n) => f.a + f.b * n + f.c * n * n);
  const min = Math.min(...vals);
  const argmin = vals.map((val, n) => (Math.abs(val - min) < 1e-9 ? n : -1)).filter((n) => n >= 0);
  const msgs = [];
  let ok = true;
  const eq = (a, b) => Math.abs(a - b) < 1e-9;
  if (r.type === 'gruppe' && r.covers === 'auftrag') {
    ok = argmin.length === 1 && argmin[0] === 1;
    if (vals[0] <= vals[1] + 1e-9) msgs.push(`n = 0 kostet ${vals[0] < vals[1] - 1e-9 ? 'weniger als' : 'genauso viel wie'} n = 1 – Aufträge dürfen liegen bleiben`);
    if (vals.slice(2).some((val) => val <= vals[1] + 1e-9)) msgs.push('Mehrfachfahrten sind nicht teurer als eine einzige');
    // f(1) ≠ 0 schadet nicht: in jedem gültigen Plan hat jeder Auftrag n = 1 – nur eine Verschiebung um G·f(1)
    if (ok) msgs.unshift(eq(vals[1], 0) ? 'Minimum genau bei n = 1 ✓' : `Minimum genau bei n = 1 ✓ (f(1) = ${fmt(vals[1])} verschiebt nur alle gültigen Pläne gleich)`);
  } else if (r.type === 'gruppe' && r.covers === 'platz') {
    const zeroOne = eq(vals[0], vals[1]);
    const doubles = vals.slice(2).every((val) => val > vals[1] + 1e-9);
    ok = zeroOne && doubles;
    if (!zeroOne) msgs.push(`leer (n = 0) und belegt (n = 1) kosten verschieden (${fmt(vals[0])} / ${fmt(vals[1])}) – die Regel mischt sich ins Ziel ein`);
    if (!doubles) msgs.push('Doppelbelegung (n ≥ 2) ist nicht teurer');
    if (ok) msgs.unshift('n = 0 und n = 1 gleich, ab n = 2 teurer ✓');
  } else {
    msgs.push(`Minimum bei n ∈ {${argmin.join(', ')}}${r.type === 'bitgruppe' ? ' – eine Regel über Bits, keine Anforderung des Problems' : ' – entspricht keiner Anforderung direkt'}`);
  }
  // Form richtig, aber Gruppe zu groß: verbietet auch gültige Pläne
  const strict = r.type === 'gruppe' && r.gruppe === 'roboter' && K > 1;
  if (strict) msgs.push('je Roboter statt je Platz: verbietet, dass ein Roboter mehrere Aufträge nacheinander fährt');
  return { vals, argmin, ok, strict, msgs };
}

/** g(o₁, o₂) für o₁, o₂ ∈ {0, 1, 2} (Plätze) bzw. {0, 1} (Bits) und die Beurteilung als Lücken-/Kettenregel. */
export function neighborVerdict(r) {
  const g = r.g || { a: 0, b: 0, c: 0, d: 0 };
  const bits = r.type === 'bitnachbar';
  const range = bits ? [0, 1] : [0, 1, 2];
  const val = (o1, o2) => g.a + g.b * o1 + g.c * o2 + g.d * o1 * o2;
  const table = range.map((o1) => range.map((o2) => val(o1, o2)));
  const msgs = [];
  const zero = [[0, 0], [0, 1], [1, 1]].every(([a, b]) => Math.abs(val(a, b)) < 1e-9);
  const gap = val(1, 0) > 1e-9;
  if (!gap) msgs.push(bits ? 'eine Wand 0 → 1 (Bit j + 1 an, Bit j aus) kostet nichts' : 'eine Lücke (q + 1 belegt, q leer) kostet nichts');
  if (!zero) msgs.push(bits ? 'auch intakte Ketten kosten etwas – die Regel mischt sich ins Ziel ein' : 'auch lückenlose Belegungen kosten etwas – die Regel mischt sich ins Ziel ein');
  if (!bits && (val(2, 2) < -1e-9 || val(1, 2) < -1e-9)) msgs.push('bei Doppelbelegung wird sie negativ – die Platzregel muss das überstimmen');
  const ok = zero && gap;
  if (ok) msgs.unshift(bits ? 'nur die falsche Wand (1, 0) kostet ✓' : 'nur die Lücke (1, 0) kostet ✓');
  return { table, range, ok, msgs };
}

/** Gesamtbeurteilung eines Bausteins (für das Abzeichen in der Formelzeile). */
export function verdictOf(r, K) {
  if (!r) return { ok: true, msgs: [] };
  const notes = r.note ? [r.note] : [];
  if (r.type === 'gruppe' || r.type === 'bitgruppe') {
    const v = groupVerdict(r, K);
    return { ...v, ok: v.ok && !r.misfit, msgs: [...v.msgs, ...notes] };
  }
  if (r.type === 'nachbar') return K < 2 ? { ok: true, msgs: ['wirkt erst ab K = 2'] } : neighborVerdict(r);
  if (r.type === 'bitnachbar') {
    const v = neighborVerdict(r);
    return { ...v, ok: v.ok && !r.misfit, msgs: [...v.msgs, ...notes] };
  }
  return { ok: !r.misfit, msgs: notes };
}

// ---------------------------------------------------------------- neue Bausteine
export function nextSymbol(terms) {
  const used = new Set(terms.map((t) => t.symbol));
  return PENALTY_SYMBOLS.find((s) => !used.has(s)) || `P${terms.length}`;
}
export function nextId(terms, type) {
  for (let k = 1; ; k += 1) if (!terms.some((t) => t.id === `${type}${k}`)) return `${type}${k}`;
}
/**
 * Die Regel, die eine Anforderung im Standard abdeckt – für „auftrag“/„kodierung“ abhängig von der
 * Kodierung des betroffenen Auftrags: Zeilenregel (One-Hot), Kettenregel (Domain Wall), Phantom-Codes (Binary).
 */
export function standardTerm(req, terms, crit, encoding = 'one_hot', mixed = false) {
  const scope = mixed ? encoding : 'alle';
  if (req === 'auftrag' || req === 'kodierung') {
    if (encoding === 'domain_wall') return { id: nextId(terms, 'kette'), type: 'bitnachbar', symbol: nextSymbol(terms), form: 'kette', bloecke: scope };
    if (encoding === 'binary') return { id: nextId(terms, 'ungueltig'), type: 'ungueltig', symbol: nextSymbol(terms), bloecke: scope };
    return { id: nextId(terms, 'auftrag'), type: 'gruppe', symbol: nextSymbol(terms), gruppe: 'auftrag', form: 'genau', k: 1, bloecke: scope };
  }
  if (req === 'platz') return { id: nextId(terms, 'platz'), type: 'gruppe', symbol: nextSymbol(terms), gruppe: 'platz', form: 'hoechstens1' };
  if (req === 'luecke') return { id: nextId(terms, 'luecke'), type: 'nachbar', symbol: nextSymbol(terms), form: 'luecke' };
  if (req === 'hilfsbit') return { id: nextId(terms, 'hilfsbit'), type: 'hilfsbit', symbol: 'M' };
  return { id: nextId(terms, 'kosten'), type: 'kosten', symbol: 'λ', gewichtung: crit.position_weight ? 'q' : 'eins', wartezeit: Boolean(crit.release), anfahrt: true };
}
export function newTerm(type, terms, crit) {
  const id = nextId(terms, type);
  if (type === 'kosten') return { ...standardTerm('ziel', terms, crit), id };
  if (type === 'vorgaenger') return { id, type, symbol: 'λ_V', variante: 'differenz', gewichtung: crit.position_weight ? 'q' : 'eins' };
  if (type === 'nachbar') return { id, type, symbol: nextSymbol(terms), form: 'luecke' };
  if (type === 'bitgruppe') return { id, type, symbol: nextSymbol(terms), gruppe: 'block', form: 'genau', k: 1 };
  if (type === 'bitnachbar') return { id, type, symbol: nextSymbol(terms), form: 'kette' };
  if (type === 'ungueltig') return { id, type, symbol: nextSymbol(terms) };
  if (type === 'hilfsbit') return { id, type, symbol: 'M' };
  return { id, type: 'gruppe', symbol: nextSymbol(terms), gruppe: 'auftrag', form: 'genau', k: 1 };
}

// ---------------------------------------------------------------- Editor
const chips = (options, value, onPick) => el('div', { class: 'filter-group' }, Object.entries(options).map(([k, label]) => {
  const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(value === k) }, label);
  b.addEventListener('click', () => onPick(k));
  return b;
}));
const numberInput = (label, value, onSet, step = 0.5) => {
  const input = el('input', { type: 'number', value, step, style: { width: '84px' }, 'aria-label': label });
  input.addEventListener('change', () => { if (input.value !== '' && Number.isFinite(Number(input.value))) onSet(Number(input.value)); });
  return el('label', { class: 'filter-group' }, el('span', { class: 'filter-label' }, label), input);
};
const checkbox = (label, checked, onSet) => {
  const box = el('input', { type: 'checkbox', checked });
  box.addEventListener('change', () => onSet(box.checked));
  return el('label', { class: 'filter-group' }, box, el('span', {}, label));
};
const row = (label, ...content) => el('div', { class: 'bk-row' }, el('span', { class: 'bk-row-label' }, label), el('div', {}, ...content));

/**
 * Bearbeitungsfeld eines Bausteins.
 * @param {object} o  term (Spezifikation), resolved (vom Server, mit f/g/stats/recommended), ctx {K, objective, critLabel, ind},
 *                    weight, weightMax, onChange(patch), onWeight(value)
 */
export function renderTermEditor(host, { term: t, resolved: r, ctx, weight, weightMax, onChange, onWeight }) {
  const K = ctx.K;
  const parts = [];
  // Gewicht
  const slider = el('input', { type: 'range', min: 0, max: weightMax, step: weightMax > 20 ? 1 : 0.1, value: weight, 'aria-label': `Gewicht ${t.symbol}` });
  const val = el('strong', {}, nf(weight, 2));
  slider.addEventListener('input', () => { val.textContent = nf(Number(slider.value), 2); onWeight(Number(slider.value)); });
  const rec = r?.recommended;
  parts.push(row(`Gewicht ${t.symbol}`, el('div', { class: 'slider-row' }, slider, val,
    rec != null ? el('button', { class: 'btn small', type: 'button', title: 'Empfohlenes Gewicht für diese Rolle', onclick: () => onWeight(rec, true) }, `Empfehlung ${nf(rec, 2)}`) : null,
    el('span', { class: 'hint' }, COST_TYPES.has(t.type) ? 'skaliert das Ziel – zählt nur im Verhältnis zu den Strafgewichten' : 'Strafgewicht: wie teuer ein Verstoß ist'))));
  // Geltungsbereich: für welche Blöcke (nach Kodierung) der Baustein gilt
  if (t.type !== 'hilfsbit') {
    parts.push(row('gilt für', chips(SCOPE_LABEL, t.bloecke || 'alle', (s) => onChange({ bloecke: s })),
      el('span', { class: 'hint' }, `${r?.tasks?.length ?? 0} Aufträge`)));
  }

  if (t.type === 'kosten') {
    if (ctx.objective === 'zuweisung') {
      parts.push(el('p', { class: 'hint' }, `Die Kosten c_t,r kommen fest aus dem Kriterium „${ctx.critLabel}“ (Sofortzuweisung, K = 1).`));
    } else {
      if (K > 1) parts.push(row('Gewicht je Platz w(q)', chips(WEIGHTING_LABEL, t.gewichtung || 'q', (w) => onChange({ gewichtung: w }))));
      parts.push(row('enthält', checkbox('Wartezeit ρ, bis ein belegter Roboter frei ist', t.wartezeit !== false, (w) => onChange({ wartezeit: w })),
        checkbox('Anfahrt vom Standort s⁰', t.anfahrt !== false, (w) => onChange({ anfahrt: w }))));
    }
    parts.push(el('p', { class: 'hint' }, ctx.ind === 'x' ? 'In der QUBO: nur Diagonale – Q[x] = Gewicht × Kosten der Option.'
      : 'One-Hot: Diagonale. Domain Wall: Teleskopsumme – Konstante + Kostendifferenzen benachbarter Optionen. Binary: Polynom vom Grad ⌈log₂ m⌉.'));
  } else if (t.type === 'vorgaenger') {
    parts.push(row('Variante', chips({ differenz: 's − s⁰ (ersetzt die Anfahrt)', ohne_abzug: 's (kommt dazu – doppelt gezählt)' }, t.variante || 'differenz', (w) => onChange({ variante: w }))));
    if (K > 1) parts.push(row('Gewicht je Platz w(q)', chips(WEIGHTING_LABEL, t.gewichtung || 'q', (w) => onChange({ gewichtung: w }))));
    parts.push(el('p', { class: 'hint' }, 'Produkt zweier Indikatoren (Platz q + 1 und q eines Roboters): One-Hot eine Kopplung, Binary Grad 2⌈log₂ m⌉.'));
  } else if (t.type === 'gruppe' || t.type === 'bitgruppe') {
    if (t.type === 'gruppe') {
      const groups = ['auftrag', 'platz', 'roboter', 'auftrag_roboter', 'alle'].filter((g) => K > 1 || (g !== 'platz' && g !== 'auftrag_roboter'));
      parts.push(row('Gruppe', chips(Object.fromEntries(groups.map((g) => [g, groupLabel(g, K)])), t.gruppe === 'platz' && K === 1 ? 'roboter' : (t.gruppe || 'auftrag'),
        (g) => onChange({ gruppe: g }))));
    } else {
      parts.push(row('Gruppe', chips(BIT_GROUP_LABEL, t.gruppe || 'block', (g) => onChange({ gruppe: g }))));
    }
    parts.push(row('Form f(n)', chips(FORM_LABEL, t.form || 'genau', (f) => {
      // „eigene“ übernimmt die aktuelle Form, damit man sie leicht abwandeln kann
      onChange(f === 'eigene' && r?.f ? { form: f, a: r.f.a, b: r.f.b, c: r.f.c } : { form: f });
    })));
    if (t.form === 'genau' || t.form === 'linear' || !t.form) parts.push(row('k', numberInput('k', t.k ?? 1, (k) => onChange({ k }), 1)));
    if (t.form === 'eigene') parts.push(row('Koeffizienten', ...['a', 'b', 'c'].map((c) => numberInput(c, t[c] ?? 0, (x) => onChange({ [c]: x })))));
    if (r?.f) parts.push(fTable(r, K, weight, t.type === 'bitgruppe'));
    if (t.type === 'gruppe' && ctx.ind !== 'x') {
      parts.push(el('p', { class: 'hint', html: 'Ausmultipliziert mit <i>I</i>² = <i>I</i> – exakt für One-Hot und Binary; bei Domain Wall weicht die Paarform an Kettenbrüchen (δ = −1) von <i>f</i>(<i>n</i>) ab.' }));
    }
  } else if (t.type === 'nachbar' || t.type === 'bitnachbar') {
    const named = t.type === 'nachbar' ? { luecke: 'Lücke: o₁·(1 − o₂)', eigene: 'eigene: a + b·o₁ + c·o₂ + d·o₁o₂' }
      : { kette: 'Kette: z_{j+1}·(1 − z_j)', eigene: 'eigene: a + b·z_{j+1} + c·z_j + d·z_{j+1}z_j' };
    parts.push(row('Form g', chips(named, t.form || (t.type === 'nachbar' ? 'luecke' : 'kette'),
      (f) => onChange(f === 'eigene' && r?.g ? { form: f, ...r.g } : { form: f }))));
    if (t.form === 'eigene') parts.push(row('Koeffizienten', ...['a', 'b', 'c', 'd'].map((c) => numberInput(c, t[c] ?? 0, (x) => onChange({ [c]: x })))));
    if (r?.g && (K > 1 || t.type === 'bitnachbar')) parts.push(gTable(r, weight));
    if (t.type === 'bitnachbar') parts.push(el('p', { class: 'hint' }, 'Je zwei Nachbarbits jedes Blocks – für Domain-Wall-Ketten gedacht, auf jede Kodierung anwendbar.'));
  } else if (t.type === 'ungueltig') {
    parts.push(el('p', { class: 'hint' }, 'm Optionen → 2^⌈log₂ m⌉ Codes; die überzähligen (Phantome) kosten je das Gewicht – als Polynom ein Indikator-Produkt je Phantom.'));
  } else {
    parts.push(el('p', { class: 'hint', html: `Rosenberg: <i>w</i> ersetzt <i>x·y</i> in Termen vom Grad &gt; 2; <i>xy</i> − 2<i>xw</i> − 2<i>yw</i> + 3<i>w</i> = 0 bei <i>w</i> = <i>x·y</i>, sonst ≥ 1 –
      jede Lüge kostet ≥ M. Empfehlung: 1,1 × größter Lügengewinn bei den übrigen Empfehlungen.` }));
  }
  if (r?.note) parts.push(el('p', { class: 'warnline' }, `⚠ ${r.note}`));
  if (r?.stats) {
    parts.push(el('p', { class: 'hint' }, `In dieser Instanz: ${r.stats.diag} Diagonal-Einträge, ${r.stats.couplings} Kopplungen`
      + `${r.stats.const ? `, Konstante ${fmt(r.stats.const)} × ${t.symbol}` : ''}.`));
  }
  fill(host, ...parts);
}

/** Wertetabelle f(n) mit Ausmultiplizieren – die Brücke von der Regel zur QUBO. */
function fTable(r, K, weight, bits) {
  const v = groupVerdict(r, K);
  const f = r.f;
  const max = Math.max(1e-9, ...v.vals.map(Math.abs));
  const unit = bits ? 'Bit' : 'Option';
  return el('div', { class: 'bk-effect' },
    el('table', { class: 'bk-ftable' },
      el('tr', {}, el('th', {}, `n = ${bits ? 'Bits' : 'Optionen'} an`), v.vals.map((_, n) => el('th', {}, n))),
      el('tr', {}, el('th', {}, 'f(n)'), v.vals.map((val, n) => el('td', { class: v.argmin.includes(n) ? 'min' : '' },
        el('div', { class: 'bk-fbar' }, el('div', { class: val < 0 ? 'neg' : 'pos', style: { height: `${(Math.abs(val) / max) * 28}px` } })),
        fmt(val)))),
      el('tr', {}, el('th', {}, `× ${r.symbol} = ${nf(weight, 2)}`), v.vals.map((val) => el('td', { class: 'hint' }, fmt(val * weight))))),
    el('div', { class: v.ok ? 'okline' : 'warnline' }, v.msgs.join(' · ')),
    el('div', { class: 'hint', html: `Ausmultipliziert, weil ${bits ? '<i>z</i>² = <i>z</i>' : '<i>x</i>² = <i>x</i>'}: f(n) = ${fmt(f.a)} + ${fmt(f.b)}·n + ${fmt(f.c)}·n² ergibt
      <b>Konstante ${fmt(f.a)}</b> je Gruppe (${r.groups} Gruppen), <b>${fmt(f.b + f.c)}</b> je ${unit} und <b>${fmt(2 * f.c)}</b> je Paar derselben Gruppe
      ${bits ? '' : '(bei One-Hot direkt auf Diagonale und Kopplungen, sonst auf die Indikatoren)'}.` }));
}

function gTable(r, weight) {
  const v = neighborVerdict(r);
  const g = r.g;
  const bits = r.type === 'bitnachbar';
  return el('div', { class: 'bk-effect' },
    el('table', { class: 'bk-ftable' },
      el('tr', {}, el('th', {}, bits ? 'z_{j+1} ╲ z_j' : 'o₁ (Platz q+1) ╲ o₂ (Platz q)'), v.range.map((o) => el('th', {}, o))),
      v.table.map((rowVals, o1) => el('tr', {}, el('th', {}, o1), rowVals.map((val, o2) => el('td', { class: o1 === 1 && o2 === 0 ? 'gap' : '' }, fmt(val)))))),
    el('div', { class: v.ok ? 'okline' : 'warnline' }, v.msgs.join(' · ')),
    el('div', { class: 'hint', html: `Ausmultipliziert: Konstante ${fmt(g.a)} je ${bits ? 'Bitpaar' : 'Platzpaar'}, ${fmt(g.b)} auf ${bits ? 'Bit j + 1' : 'Platz q + 1'},
      ${fmt(g.c)} auf ${bits ? 'Bit j' : 'Platz q'}, ${fmt(g.d)} als Kopplung. Gewicht ${r.symbol} = ${nf(weight, 2)}.` }));
}

/** Vorschlag für ein Gewicht, das einen Verstoß sicher teurer macht als der Gewinn daraus. */
export const suggestWeight = (w, delta, perUnit) => niceCeil(w + (delta + 1e-6) / Math.max(perUnit, 1e-9) + 1);
