// Bausteine des Formel-Baukastens: als Formel zeigen, in Worten erklären, die Wirkung ihrer Form
// beurteilen und bearbeiten. Die Mathematik (Ausmultiplizieren) macht encodings/baukasten.py.
import { el, fill, nf } from '../util.js';
import { niceCeil } from './onehotCriterion.js';

export const TYPE_LABEL = {
  kosten: 'Kosten (Ziel)',
  vorgaenger: 'Vorgänger-Kopplung (Ziel)',
  gruppe: 'Gruppenregel',
  nachbar: 'Nachbarplatz-Regel',
};
export const FORM_LABEL = { genau: 'genau k', hoechstens1: 'höchstens eins', linear: 'linear: k − n', eigene: 'eigene: a + b·n + c·n²' };
export const WEIGHTING_LABEL = { q: 'q – von hinten', eins: '1 – jeder Platz einfach', vorne: 'K + 1 − q – von vorne' };
const PENALTY_SYMBOLS = ['A', 'B', 'D', 'E', 'F', 'G', 'H', 'J', 'L', 'M'];
const SPEC_KEYS = ['id', 'type', 'symbol', 'gewichtung', 'wartezeit', 'anfahrt', 'variante', 'gruppe', 'form', 'k', 'a', 'b', 'c', 'd'];

export const fmt = (v) => nf(v, 2).replace('-', '−');
const sgn = (v, first = false) => (v < 0 ? ` − ${fmt(-v)}` : `${first ? '' : ' + '}${fmt(v)}`);

/** Nur die Felder, die einen Baustein beschreiben (ohne Server-Zusätze wie stats, f, covers). */
export const specOf = (t) => Object.fromEntries(SPEC_KEYS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));

// ---------------------------------------------------------------- Farben: nach Rolle wie auf den anderen Seiten
const COLORS = { kosten: '#2a78d6', vorgaenger: '#1baf7a', auftrag: '#eb6834', platz: '#4a3aa7', roboter: '#4a3aa7',
  auftrag_roboter: '#eda100', alle: '#008300', nachbar: '#e87ba4' };
export function termColor(t) {
  if (!t) return '#898781';
  return t.type === 'gruppe' ? COLORS[t.gruppe] : COLORS[t.type];
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
    alle: 'alle Schalter zusammen',
  }[g];
}
/** Laufindizes: über welche Gruppen summiert wird (außen) und welche Schalter eine Gruppe bilden (innen). */
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

const x = (K, t = 't', r = 'r', q = 'q') => (K === 1 ? `<i>x</i><sub>${t},${r}</sub>` : `<i>x</i><sub>${t},${r},${q}</sub>`);
const sum = (idx) => (idx ? `Σ<sub><i>${idx}</i></sub> ` : '');
function weightHtml(weighting, K) {
  if (K === 1) return '';
  return { q: '<i>q</i>·', eins: '', vorne: `(${K + 1} − <i>q</i>)·` }[weighting || 'q'];
}

/** Formel eines Bausteins (ohne Gewicht), passend zu K und Zielart. */
export function termFormula(t, { K, objective }) {
  if (t.type === 'kosten') {
    if (objective === 'zuweisung') return `${sum('t,r')}<i>c</i><sub>t,r</sub> · ${x(K)}`;
    const inner = [t.anfahrt === false ? null : '<i>s</i>⁰<sub>r,t</sub>', '<i>p</i><sub>t</sub>'].filter(Boolean).join(' + ');
    const w = weightHtml(t.gewichtung, K);
    const body = `${t.wartezeit === false ? '' : 'ρ<sub>r</sub> + '}${w}${w || inner.includes('+') ? `(${inner})` : inner}`;
    return `${sum(K === 1 ? 't,r' : 't,r,q')}[ ${body} ] · ${x(K)}`;
  }
  if (t.type === 'vorgaenger') {
    if (K < 2) return '<span class="hint">– wirkt erst ab K = 2 Plätzen</span>';
    const d = t.variante === 'ohne_abzug' ? '<i>s</i><sub>t,t′</sub>' : '(<i>s</i><sub>t,t′</sub> − <i>s</i>⁰<sub>r,t′</sub>)';
    return `Σ<sub><i>r,q</i></sub> Σ<sub><i>t</i>≠<i>t</i>′</sub> ${weightHtml(t.gewichtung, K)}${d} · ${x(K, 't', 'r', 'q+1')} ${x(K, 't′', 'r', 'q')}`;
  }
  if (t.type === 'gruppe') {
    const { outer, inner } = groupIndex(t.gruppe || 'auftrag', K);
    const n = inner ? `Σ<sub><i>${inner}</i></sub> <i>x</i>` : '<i>x</i>';
    const k = t.k ?? 1;
    const f = {
      genau: `( ${fmt(k)} − ${n} )²`,
      hoechstens1: `Σ<sub><i>i</i>&lt;<i>j</i></sub> <i>x<sub>i</sub>x<sub>j</sub></i>`,
      linear: `( ${fmt(k)} − ${n} )`,
      eigene: `[ ${fmt(t.a ?? 0)}${sgn(t.b ?? 0)}·<i>n</i>${sgn(t.c ?? 0)}·<i>n</i>² ], <i>n</i> = ${n}`,
    }[t.form || 'genau'];
    return `${sum(outer)}${f}`;
  }
  if (K < 2) return '<span class="hint">– wirkt erst ab K = 2 Plätzen</span>';
  const o1 = '<i>o</i><sub>r,q+1</sub>';
  const o2 = '<i>o</i><sub>r,q</sub>';
  const g = t.form === 'eigene'
    ? `[ ${fmt(t.a ?? 0)}${sgn(t.b ?? 0)}·${o1}${sgn(t.c ?? 0)}·${o2}${sgn(t.d ?? 0)}·${o1}${o2} ]`
    : `${o1} ( 1 − ${o2} )`;
  return `Σ<sub><i>r,q</i></sub> ${g}, &nbsp;<i>o</i><sub>r,q</sub> = Σ<sub><i>t</i></sub> ${x(K)}`;
}

/** Ein Satz: Was tut dieser Baustein? */
export function termSentence(t, { K, objective, critLabel }) {
  if (t.type === 'kosten') {
    if (objective === 'zuweisung') return `Ziel: jeder eingeschaltete Schalter zahlt seine Kosten nach „${critLabel}“.`;
    return `Ziel: jeder Schalter zahlt ${t.wartezeit === false ? '' : 'Wartezeit + '}${K > 1 ? `${{ q: 'q-mal', eins: 'einmal', vorne: '(K + 1 − q)-mal' }[t.gewichtung || 'q']} ` : ''}`
      + `${t.anfahrt === false ? 'Bearbeitung (ohne Anfahrt)' : 'Anfahrt vom Standort + Bearbeitung'}.`;
  }
  if (t.type === 'vorgaenger') {
    return t.variante === 'ohne_abzug'
      ? 'Ziel: liegt t direkt vor t′, kommt die Anfahrt vom Abgabeort von t dazu – ohne die schon gezählte Anfahrt vom Standort abzuziehen.'
      : 'Ziel: liegt t direkt vor t′, wird die Anfahrt vom Standort durch die vom Abgabeort von t ersetzt.';
  }
  if (t.type === 'gruppe') {
    const what = { genau: `genau ${fmt(t.k ?? 1)} Schalter an`, hoechstens1: 'höchstens ein Schalter an', linear: `belohnt jeden Schalter (k − n: je mehr, desto billiger)`,
      eigene: 'eigene Strafe f(n) für n eingeschaltete Schalter' }[t.form || 'genau'];
    return `${groupLabel(t.gruppe || 'auftrag', K)}: ${what}.`;
  }
  return t.form === 'eigene' ? 'eigene Strafe g(o₁, o₂) für die Belegung zweier benachbarter Plätze.' : 'Platz q + 1 darf nur belegt sein, wenn Platz q belegt ist.';
}

// ---------------------------------------------------------------- Wirkung der Form
/** f(n) für n = 0 … N und die Beurteilung gegenüber der Anforderung, die die Regel abdeckt. */
export function groupVerdict(r, K) {
  const f = r.f || { a: 0, b: 0, c: 0 };
  const N = Math.max(3, Math.min(r.max_size || 3, 6));
  const vals = Array.from({ length: N + 1 }, (_, n) => f.a + f.b * n + f.c * n * n);
  const min = Math.min(...vals);
  const argmin = vals.map((v, n) => (Math.abs(v - min) < 1e-9 ? n : -1)).filter((n) => n >= 0);
  const msgs = [];
  let ok = true;
  const eq = (a, b) => Math.abs(a - b) < 1e-9;
  if (r.covers === 'auftrag') {
    ok = argmin.length === 1 && argmin[0] === 1;
    if (vals[0] <= vals[1] + 1e-9) msgs.push(`n = 0 kostet ${vals[0] < vals[1] - 1e-9 ? 'weniger als' : 'genauso viel wie'} n = 1 – Aufträge dürfen liegen bleiben`);
    if (vals.slice(2).some((v) => v <= vals[1] + 1e-9)) msgs.push('Mehrfachfahrten sind nicht teurer als eine einzige');
    // f(1) ≠ 0 schadet nicht: in jedem gültigen Plan hat jeder Auftrag n = 1 – nur eine Verschiebung um G·f(1)
    if (ok) msgs.unshift(eq(vals[1], 0) ? 'Minimum genau bei n = 1 ✓' : `Minimum genau bei n = 1 ✓ (f(1) = ${fmt(vals[1])} verschiebt nur alle gültigen Pläne gleich)`);
  } else if (r.covers === 'platz') {
    const zeroOne = eq(vals[0], vals[1]);
    const doubles = vals.slice(2).every((v) => v > vals[1] + 1e-9);
    ok = zeroOne && doubles;
    if (!zeroOne) msgs.push(`leer (n = 0) und belegt (n = 1) kosten verschieden (${fmt(vals[0])} / ${fmt(vals[1])}) – die Regel mischt sich ins Ziel ein`);
    if (!doubles) msgs.push('Doppelbelegung (n ≥ 2) ist nicht teurer');
    if (ok) msgs.unshift('n = 0 und n = 1 gleich, ab n = 2 teurer ✓');
  } else {
    msgs.push(`Minimum bei n ∈ {${argmin.join(', ')}} – entspricht keiner Anforderung direkt`);
  }
  // Form richtig, aber Gruppe zu groß: verbietet auch gültige Pläne
  const strict = r.gruppe === 'roboter' && K > 1;
  if (strict) msgs.push('je Roboter statt je Platz: verbietet, dass ein Roboter mehrere Aufträge nacheinander fährt');
  return { vals, argmin, ok, strict, msgs };
}

/** g(o₁, o₂) für o₁, o₂ ∈ {0, 1, 2} und die Beurteilung als Lückenregel. */
export function neighborVerdict(r) {
  const g = r.g || { a: 0, b: 0, c: 0, d: 0 };
  const val = (o1, o2) => g.a + g.b * o1 + g.c * o2 + g.d * o1 * o2;
  const table = [0, 1, 2].map((o1) => [0, 1, 2].map((o2) => val(o1, o2)));
  const msgs = [];
  const zero = [[0, 0], [0, 1], [1, 1]].every(([a, b]) => Math.abs(val(a, b)) < 1e-9);
  const gap = val(1, 0) > 1e-9;
  if (!gap) msgs.push('eine Lücke (q + 1 belegt, q leer) kostet nichts');
  if (!zero) msgs.push('auch lückenlose Belegungen kosten etwas – die Regel mischt sich ins Ziel ein');
  if (val(2, 2) < -1e-9 || val(1, 2) < -1e-9) msgs.push('bei Doppelbelegung wird sie negativ – die Platzregel muss das überstimmen');
  const ok = zero && gap;
  if (ok) msgs.unshift('nur die Lücke (1, 0) kostet ✓');
  return { table, ok, msgs };
}

/** Gesamtbeurteilung eines Bausteins (für das Abzeichen in der Formelzeile). */
export function verdictOf(r, K) {
  if (!r) return { ok: true, msgs: [] };
  if (r.type === 'gruppe') return groupVerdict(r, K);
  if (r.type === 'nachbar') return K < 2 ? { ok: true, msgs: ['wirkt erst ab K = 2'] } : neighborVerdict(r);
  return { ok: true, msgs: r.note ? [r.note] : [] };
}

// ---------------------------------------------------------------- neue Bausteine
export function nextSymbol(terms) {
  const used = new Set(terms.map((t) => t.symbol));
  return PENALTY_SYMBOLS.find((s) => !used.has(s)) || `P${terms.length}`;
}
export function nextId(terms, type) {
  for (let k = 1; ; k += 1) if (!terms.some((t) => t.id === `${type}${k}`)) return `${type}${k}`;
}
/** Die Regel, die eine Anforderung des Problems im Standard abdeckt. */
export function standardTerm(req, terms, crit) {
  const id = nextId(terms, req === 'ziel' ? 'kosten' : req);
  if (req === 'auftrag') return { id, type: 'gruppe', symbol: nextSymbol(terms), gruppe: 'auftrag', form: 'genau', k: 1 };
  if (req === 'platz') return { id, type: 'gruppe', symbol: nextSymbol(terms), gruppe: 'platz', form: 'hoechstens1' };
  if (req === 'luecke') return { id, type: 'nachbar', symbol: nextSymbol(terms), form: 'luecke' };
  return { id, type: 'kosten', symbol: 'λ', gewichtung: crit.position_weight ? 'q' : 'eins', wartezeit: Boolean(crit.release), anfahrt: true };
}
export function newTerm(type, terms, crit) {
  const id = nextId(terms, type);
  if (type === 'kosten') return { ...standardTerm('ziel', terms, crit), id };
  if (type === 'vorgaenger') return { id, type, symbol: 'λ_V', variante: 'differenz', gewichtung: crit.position_weight ? 'q' : 'eins' };
  if (type === 'nachbar') return { id, type, symbol: nextSymbol(terms), form: 'luecke' };
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
 * @param {object} o  term (Spezifikation), resolved (vom Server, mit f/g/stats), ctx {K, objective, critLabel},
 *                    weight, weightMax, onChange(patch), onWeight(value)
 */
export function renderTermEditor(host, { term: t, resolved: r, ctx, weight, weightMax, onChange, onWeight }) {
  const K = ctx.K;
  const parts = [];
  // Gewicht
  const slider = el('input', { type: 'range', min: 0, max: weightMax, step: weightMax > 20 ? 1 : 0.1, value: weight, 'aria-label': `Gewicht ${t.symbol}` });
  const val = el('strong', {}, nf(weight, 2));
  slider.addEventListener('input', () => { val.textContent = nf(Number(slider.value), 2); onWeight(Number(slider.value)); });
  parts.push(row(`Gewicht ${t.symbol}`, el('div', { class: 'slider-row' }, slider, val,
    el('span', { class: 'hint' }, t.type === 'kosten' || t.type === 'vorgaenger' ? 'skaliert das Ziel – zählt nur im Verhältnis zu den Strafgewichten' : 'Strafgewicht: wie teuer ein Verstoß ist'))));

  if (t.type === 'kosten') {
    if (ctx.objective === 'zuweisung') {
      parts.push(el('p', { class: 'hint' }, `Die Kosten c_t,r kommen fest aus dem Kriterium „${ctx.critLabel}“ (Sofortzuweisung, K = 1).`));
    } else {
      if (K > 1) parts.push(row('Gewicht je Platz w(q)', chips(WEIGHTING_LABEL, t.gewichtung || 'q', (v) => onChange({ gewichtung: v }))));
      parts.push(row('enthält', checkbox('Wartezeit ρ, bis ein belegter Roboter frei ist', t.wartezeit !== false, (v) => onChange({ wartezeit: v })),
        checkbox('Anfahrt vom Standort s⁰', t.anfahrt !== false, (v) => onChange({ anfahrt: v }))));
    }
    parts.push(el('p', { class: 'hint' }, 'In der QUBO: nur Diagonale – Q[x] = Gewicht × Kosten des Schalters.'));
  } else if (t.type === 'vorgaenger') {
    parts.push(row('Variante', chips({ differenz: 's − s⁰ (ersetzt die Anfahrt)', ohne_abzug: 's (kommt dazu – doppelt gezählt)' }, t.variante || 'differenz', (v) => onChange({ variante: v }))));
    if (K > 1) parts.push(row('Gewicht je Platz w(q)', chips(WEIGHTING_LABEL, t.gewichtung || 'q', (v) => onChange({ gewichtung: v }))));
    parts.push(el('p', { class: 'hint' }, 'In der QUBO: nur Kopplungen zwischen Platz q + 1 und q desselben Roboters.'));
  } else if (t.type === 'gruppe') {
    const groups = ['auftrag', 'platz', 'roboter', 'auftrag_roboter', 'alle'].filter((g) => K > 1 || (g !== 'platz' && g !== 'auftrag_roboter'));
    parts.push(row('Gruppe', chips(Object.fromEntries(groups.map((g) => [g, groupLabel(g, K)])), t.gruppe === 'platz' && K === 1 ? 'roboter' : (t.gruppe || 'auftrag'),
      (v) => onChange({ gruppe: v }))));
    parts.push(row('Form f(n)', chips(FORM_LABEL, t.form || 'genau', (v) => {
      // „eigene“ übernimmt die aktuelle Form, damit man sie leicht abwandeln kann
      onChange(v === 'eigene' && r?.f ? { form: v, a: r.f.a, b: r.f.b, c: r.f.c } : { form: v });
    })));
    if (t.form === 'genau' || t.form === 'linear' || !t.form) parts.push(row('k', numberInput('k', t.k ?? 1, (v) => onChange({ k: v }), 1)));
    if (t.form === 'eigene') parts.push(row('Koeffizienten', ...['a', 'b', 'c'].map((c) => numberInput(c, t[c] ?? 0, (v) => onChange({ [c]: v })))));
    if (r?.f) parts.push(fTable(r, K, weight));
  } else {
    parts.push(row('Form g(o₁, o₂)', chips({ luecke: 'Lücke: o₁·(1 − o₂)', eigene: 'eigene: a + b·o₁ + c·o₂ + d·o₁o₂' }, t.form || 'luecke',
      (v) => onChange(v === 'eigene' && r?.g ? { form: v, ...r.g } : { form: v }))));
    if (t.form === 'eigene') parts.push(row('Koeffizienten', ...['a', 'b', 'c', 'd'].map((c) => numberInput(c, t[c] ?? 0, (v) => onChange({ [c]: v })))));
    if (r?.g && K > 1) parts.push(gTable(r, weight));
  }
  if (r?.note) parts.push(el('p', { class: 'warnline' }, `⚠ ${r.note}`));
  if (r?.stats) {
    parts.push(el('p', { class: 'hint' }, `In dieser Instanz: ${r.stats.diag} Diagonal-Einträge, ${r.stats.couplings} Kopplungen`
      + `${r.stats.const ? `, Konstante ${fmt(r.stats.const)} × ${t.symbol}` : ''}.`));
  }
  fill(host, ...parts);
}

/** Wertetabelle f(n) mit Ausmultiplizieren – die Brücke von der Regel zur QUBO. */
function fTable(r, K, weight) {
  const v = groupVerdict(r, K);
  const f = r.f;
  const max = Math.max(1e-9, ...v.vals.map(Math.abs));
  return el('div', { class: 'bk-effect' },
    el('table', { class: 'bk-ftable' },
      el('tr', {}, el('th', {}, 'n = Schalter an'), v.vals.map((_, n) => el('th', {}, n))),
      el('tr', {}, el('th', {}, 'f(n)'), v.vals.map((val, n) => el('td', { class: v.argmin.includes(n) ? 'min' : '' },
        el('div', { class: 'bk-fbar' }, el('div', { class: val < 0 ? 'neg' : 'pos', style: { height: `${(Math.abs(val) / max) * 28}px` } })),
        fmt(val)))),
      el('tr', {}, el('th', {}, `× ${r.symbol} = ${nf(weight, 2)}`), v.vals.map((val) => el('td', { class: 'hint' }, fmt(val * weight))))),
    el('div', { class: v.ok ? 'okline' : 'warnline' }, v.msgs.join(' · ')),
    el('div', { class: 'hint', html: `Ausmultipliziert, weil <i>x</i>² = <i>x</i>: f(n) = ${fmt(f.a)} + ${fmt(f.b)}·n + ${fmt(f.c)}·n² ergibt
      <b>Konstante ${fmt(f.a)}</b> je Gruppe (${r.groups} Gruppen), <b>${fmt(f.b + f.c)}</b> auf der Diagonale je Schalter
      und <b>${fmt(2 * f.c)}</b> als Kopplung je Schalterpaar derselben Gruppe.` }));
}

function gTable(r, weight) {
  const v = neighborVerdict(r);
  const g = r.g;
  return el('div', { class: 'bk-effect' },
    el('table', { class: 'bk-ftable' },
      el('tr', {}, el('th', {}, 'o₁ (Platz q+1) ╲ o₂ (Platz q)'), [0, 1, 2].map((o) => el('th', {}, o))),
      v.table.map((rowVals, o1) => el('tr', {}, el('th', {}, o1), rowVals.map((val, o2) => el('td', { class: o1 === 1 && o2 === 0 ? 'gap' : '' }, fmt(val)))))),
    el('div', { class: v.ok ? 'okline' : 'warnline' }, v.msgs.join(' · ')),
    el('div', { class: 'hint', html: `Ausmultipliziert: Konstante ${fmt(g.a)} je Platzpaar, ${fmt(g.b)} auf der Diagonale der Schalter auf Platz q + 1,
      ${fmt(g.c)} auf Platz q, ${fmt(g.d)} als Kopplung zwischen Platz q + 1 und q. Gewicht ${r.symbol} = ${nf(weight, 2)}.` }));
}

/** Vorschlag für ein Gewicht, das einen Verstoß sicher teurer macht als der Gewinn daraus. */
export const suggestWeight = (w, delta, perUnit) => niceCeil(w + (delta + 1e-6) / Math.max(perUnit, 1e-9) + 1);
