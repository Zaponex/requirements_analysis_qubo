// Kodierungen der TA-Seiten mit Lastausgleich: was One-Hot, Domain Wall und Binary unterscheidet – Schritte, Namen im Paper,
// Bit-Beschriftung, Plan ↔ Bits, Regel der Kodierung (A) und das Brett. Alles andere teilen sich die Seiten (taWorkload.js).
// Formulierung: encodings/workload.py (wb_formulation)
import { el, fill, nf, withTip, tipHtml } from '../util.js';
import { statusColor } from '../theme.js';
import { shortName } from '../components/scenario.js';

const SUB = '₀₁₂₃₄₅₆₇₈₉';
export const sub = (s) => String(s).replace(/\d/g, (d) => SUB[d]);
const fmt = (v) => nf(v, 1).replace('-', '−');
const signed = (v) => (v < 0 ? `−${fmt(-v)}` : `+${fmt(v)}`);

const WB_STEPS = (setup, rule, extra = []) => {
  const base = { kosten: true };
  const withRule = { ...base, [rule.kind]: true };
  const all = { ...withRule, last: true, ...(extra.length ? { hilfsbit: true } : {}) };
  return [
    { title: 'Szenario', terms: {} },
    { title: setup, terms: {} },
    { title: 'Kosten', terms: base },
    { title: rule.title, terms: withRule },
    { title: 'Lastausgleich', terms: { ...withRule, last: true } },
    ...extra.map((title) => ({ title, terms: all })),
    { title: 'QUBO & Hardware', terms: all },
  ];
};

/** Tabelle Auftrag × Roboter mit Zellen der Kodierung und Fußzeile „Last je Roboter“ (gemeinsam für alle drei). */
function assignTable(c, { corner, cell, rowEnd, rowEndHead }) {
  const { inst } = c;
  return el('table', { class: 'board xgrid' },
    el('thead', {}, el('tr', {}, el('th', { class: 'corner' }, corner),
      inst.robots.map((r) => el('th', { 'data-robot': r.robot_id }, el('div', {}, `R${r.robot_id}`),
        el('div', { class: 'hint' }, el('span', { class: 'dot-inline', style: { background: statusColor(r.status) } }), r.available ? ' frei' : ' belegt'))),
      rowEndHead ? el('th', {}, rowEndHead) : null)),
    el('tbody', {}, inst.tasks.map((t) => el('tr', {},
      el('th', { class: 'rowhead', 'data-task': t.transport_id }, el('div', {}, `#${t.transport_id}`), el('div', { class: 'hint' }, `${shortName(t.from_entity)} → ${shortName(t.to_entity)}`)),
      inst.robots.map((r) => cell(t.transport_id, r.robot_id)),
      rowEnd ? rowEnd(t.transport_id) : null))),
    el('tfoot', {}, el('tr', {}, el('th', { html: c.showCost ? 'Last <i>L</i><sub>r</sub>' : 'Aufträge' }),
      c.loads.map((l) => withTip(el('td', { class: 'sum col-sum', 'data-robot': l.r.robot_id },
        c.showCost ? fmt(l.L) : String(l.items.filter((it) => it.x > 0).length)),
      tipHtml(`R${l.r.robot_id}`, [`Vorlast ${fmt(l.r.load0)}`, ...l.items.map((it) => `#${it.v.task_id}: ${it.x < 0 ? '−' : ''}${fmt(it.v.cost)}`), `L = ${fmt(l.L)} ${c.unit}`]))),
      rowEndHead ? el('td') : null)));
}
const rowSum = (c, t, text, good) => el('td', { class: `sum row-sum${c.judgePen ? (good ? ' good' : ' bad') : ''}`, 'data-task': t }, text);

// ---------------------------------------------------------------- One-Hot
const oneHot = {
  key: 'one_hot', api: 'one-hot', name: 'One-Hot', pen: 'zeile', quboFrom: 3,
  steps: WB_STEPS('Schalter', { kind: 'zeile', title: 'Auftragsregel' }),
  names: { obj: '<i>H</i><sub>obj_OH</sub>', pen: '<i>H</i><sub>pen1_OH</sub>', wb: '<i>H</i><sub>OH_WB</sub>' },
  penText: 'jeder Auftrag genau einen Roboter',
  penFormula: 'Σ<sub><i>t</i></sub> ( 1 − Σ<sub><i>r</i></sub> <i>x</i><sub><i>t</i>,<i>r</i></sub> )²',
  xHtml: (t, r) => `<i>x</i><sub>${t},${r}</sub>`,
  boardTitle: 'Schachbrett der Schalter',
  boardSub: 'Zeile = Auftrag, Spalte = Roboter · Klick: x 0 ↔ 1 · eine Spalte darf mehrere Einsen haben',
  bitLabel: (f, i) => `x${sub(f.bits[i].task_id)},${sub(f.bits[i].robot_id)}`,
  graph: (f, inst) => ({ variables: f.bits.map((b) => ({ ...b, cost: inst.variables[b.index].cost, row: b.task_id, col: b.robot_id })),
    rowKeys: inst.tasks.map((t) => t.transport_id), colKeys: inst.robots.map((r) => r.robot_id), rowLabel: (t) => `#${t}`, colLabel: (r) => `R${r}` }),
  planBits(f, inst, varIdx) {
    const x = new Uint8Array(f.n);
    for (const i of varIdx) x[i] = 1;
    return x;
  },
  issueText: (t, on) => (on.length ? `#${t}: ${on.length} Roboter` : `#${t}: niemand fährt`),
  penItems(f, inst, bits, xs, A) {
    return inst.tasks.map((t) => {
      const k = inst.variables.filter((v) => v.task_id === t.transport_id && bits[v.index]).length;
      return { v: A * (1 - k) ** 2, ok: k === 1, text: `#${t.transport_id}: ${k} an → A·(1 − ${k})² = ${fmt(A * (1 - k) ** 2)}${k === 1 ? ' ✓' : ''}` };
    });
  },
  renderBoard(host, c) {
    const idx = new Map(c.inst.variables.map((v) => [`${v.task_id}|${v.robot_id}`, v.index]));
    const table = assignTable(c, {
      corner: 'Auftrag ╲ Roboter',
      rowEndHead: c.showPen ? 'Σ = 1' : null,
      cell: (t, r) => {
        const i = idx.get(`${t}|${r}`);
        if (i == null) return withTip(el('td', { class: 'cell none', 'data-task': t, 'data-robot': r }, '–'), tipHtml(`Kein Schalter für R${r} → #${t}`, ['nicht zuständig']));
        const on = c.st.x[i];
        const b = el('button', { class: `cell switch${on ? ' on' : ''}`, type: 'button', 'data-var': i, 'data-task': t, 'data-robot': r,
          'aria-pressed': String(Boolean(on)), 'aria-label': `${c.bitLabel(i)} umschalten` },
        el('span', { class: 'bit' }, on ? '1' : '0'), el('span', { class: 'var' }, c.bitLabel(i)),
        c.showCost ? el('span', { class: 'cost' }, fmt(c.inst.variables[i].cost)) : null);
        b.addEventListener('click', () => c.toggle(i));
        return el('td', {}, b);
      },
      rowEnd: c.showPen ? (t) => {
        const k = c.inst.variables.filter((v) => v.task_id === t && c.st.x[v.index]).length;
        return rowSum(c, t, c.judgePen ? `${k} ${k === 1 ? '✓' : '✗'}` : String(k), k === 1);
      } : null,
    });
    fill(host, el('div', { class: 'table-wrap' }, table));
  },
  step2: (c) => `Je Auftrag × Roboter ein Schalter <i>x</i><sub>t,r</sub> („r fährt t“): ${c.T} × ${c.R} → <b>${c.f.n} Qubits</b>${c.f.n < c.T * c.R ? ` (${c.T * c.R - c.f.n} Paare nicht zuständig)` : ''}.
    Anders als in der IA darf eine <b>Spalte mehrere Einsen</b> haben – ein Roboter fährt dann mehrere Aufträge nacheinander. Die Fußzeile zählt sie.`,
  step4: (c) => `<i>A</i>·${oneHot.names.pen} = <i>A</i>·${oneHot.penFormula}: <b>jeder Auftrag genau einen Roboter</b> – 0 bei genau einem, sonst ≥ A. Keine Spaltenregel: Doppelbelegung ist erlaubt.`,
};

// ---------------------------------------------------------------- Domain Wall
function setChain(x, ch, k) {
  ch.bits.forEach((i, pos) => { x[i] = pos < k ? 1 : 0; });
}
const domainWall = {
  key: 'domain_wall', api: 'domain-wall', name: 'Domain Wall', pen: 'kette', quboFrom: 3,
  steps: WB_STEPS('Ketten', { kind: 'kette', title: 'Kettenregel' }),
  names: { obj: '<i>H</i><sub>obj_DW</sub>', pen: '<i>H</i><sub>pen_DW</sub>', wb: '<i>H</i><sub>DW_WB</sub>' },
  penText: 'keine falsche Wand 0 → 1',
  penFormula: 'Σ<sub><i>t</i></sub> Σ<sub><i>i</i></sub> <i>d</i><sub><i>t</i>,<i>i</i>+1</sub> (1 − <i>d</i><sub><i>t</i>,<i>i</i></sub>)',
  xHtml: (t, r) => `(<i>d</i><sub>${t},${r}−1</sub> − <i>d</i><sub>${t},${r}</sub>)`,
  boardTitle: 'Die Ketten',
  boardSub: 'Je Auftrag: feste 1 · Bits · feste 0 · <b>grün</b> = Wand 1→0 (gewählt), <b>rot</b> = falsche Wand · Klick schaltet ein Bit',
  bitLabel: (f, i) => `d${sub(f.bits[i].task_id)},${sub(f.bits[i].pos)}`,
  graph: (f, inst) => ({ variables: f.bits.map((b) => ({ ...b, cost: 0, row: b.chain, col: b.pos })),
    rowKeys: f.chains.map((ch) => ch.key), colKeys: Array.from({ length: Math.max(1, ...f.bits.map((b) => b.pos)) }, (_, k) => k + 1),
    rowLabel: (t) => `#${t}`, colLabel: (k) => `d·${k}` }),
  planBits(f, inst, varIdx) {
    const x = new Uint8Array(f.n);
    for (const ch of f.chains) {
      const k = ch.vars.findIndex((i) => varIdx.includes(i));
      if (k >= 0) setChain(x, ch, k);
    }
    return x;
  },
  issueText: (t) => `#${t}: Kette gebrochen`,
  penItems(f, inst, bits, xs, A) {
    const out = [];
    for (const ch of f.chains) {
      const walls = ch.bits.slice(1).filter((i, k) => bits[i] && !bits[ch.bits[k]]).length;
      if (walls) out.push({ v: A * walls, ok: false, text: `#${ch.key}: ${walls} falsche Wand${walls > 1 ? 'e' : ''} 0 → 1 → ${walls > 1 ? `${walls}·` : ''}A = ${fmt(A * walls)}` });
    }
    return out;
  },
  renderBoard(host, c) {
    const { f } = c;
    const rows = f.chains.map((ch) => {
      const t = ch.key;
      const task = c.inst.tasks.find((x) => x.transport_id === t);
      const head = el('div', { class: 'dw-head', 'data-task': t }, el('div', {}, el('strong', {}, `#${t}`)), el('div', { class: 'hint' }, `${shortName(task.from_entity)} → ${shortName(task.to_entity)}`));
      if (!ch.members.length) return el('div', { class: 'dw-row' }, head, el('div', { class: 'hint' }, 'kein Roboter zuständig – nicht darstellbar'), el('div', { class: 'dw-result bad' }, '✗'));
      const b = [1, ...ch.bits.map((i) => c.st.x[i]), 0];
      const parts = [el('span', { class: 'dw-fixed' }, '1')];
      ch.members.forEach((r, k) => {
        const xv = b[k] - b[k + 1];
        parts.push(withTip(el('span', { class: `dw-gap${xv === 1 ? ' wall' : xv === -1 ? ' wall bad' : ''}`, 'data-task': t, 'data-robot': r },
          el('span', { class: 'dw-robot' }, `R${r}`), c.showCost ? el('span', { class: 'dw-cost' }, fmt(ch.costs[k])) : null,
          el('span', { class: 'dw-delta' }, `x = ${xv < 0 ? '−1' : xv}`)),
        tipHtml(`x${sub(t)},${sub(r)} – R${r} für #${t}`, [`x = ${k === 0 ? '1' : c.bitLabel(ch.bits[k - 1])} − ${k === ch.members.length - 1 ? '0' : c.bitLabel(ch.bits[k])} = ${xv}`,
          xv === 1 ? '<b>Wand 1 → 0: gewählt</b>' : xv === -1 ? '<b>falsche Wand: x = −1 zieht Last ab</b>' : 'keine Wand'])));
        if (k < ch.bits.length) {
          const i = ch.bits[k];
          const btn = el('button', { class: `cell dw-bit switch${c.st.x[i] ? ' on' : ''}`, type: 'button', 'data-var': i, 'data-chain': t,
            'aria-pressed': String(Boolean(c.st.x[i])), 'aria-label': `${c.bitLabel(i)} umschalten` },
          el('span', { class: 'bit' }, c.st.x[i] ? '1' : '0'), el('span', { class: 'var' }, c.bitLabel(i)),
          c.showCost ? el('span', { class: 'cost' }, signed(ch.costs[k + 1] - ch.costs[k])) : null);
          btn.addEventListener('click', () => c.toggle(i));
          parts.push(btn);
        }
      });
      parts.push(el('span', { class: 'dw-fixed zero' }, '0'));
      const r = c.dec.assignment[t];
      const result = r != null ? el('div', { class: 'dw-result good' }, `→ R${r}`) : el('div', { class: 'dw-result bad' }, '✗ Kette');
      return el('div', { class: 'dw-row' }, head, el('div', { class: 'dw-chain' }, parts), result);
    });
    const varAt = new Map(c.inst.variables.map((v) => [`${v.task_id}|${v.robot_id}`, v.index]));
    const table = assignTable(c, {
      corner: 'x: Auftrag ╲ Roboter',
      rowEndHead: 'Σ = 1',
      cell: (t, r) => {
        const v = varAt.get(`${t}|${r}`);
        if (v == null) return el('td', { class: 'x-cell none' }, '–');
        const xv = c.dec.xs[v];
        const td = el('td', { class: `x-cell${xv === 1 ? ' on' : xv < 0 ? ' neg' : ''}`, 'data-task': t, 'data-robot': r,
          title: `x${sub(t)},${sub(r)} = ${xv} · Klick: Wand auf R${r}` }, xv < 0 ? '−1' : String(xv));
        td.addEventListener('click', () => c.pick(t, r));
        return td;
      },
      rowEnd: (t) => {
        const ok = c.dec.assignment[t] != null;
        return rowSum(c, t, `1 ${ok ? '✓' : '✗'}`, ok);
      },
    });
    fill(host, el('div', { class: 'dw-board' }, rows),
      el('h4', { style: { marginTop: '14px' }, html: 'Daraus: <i>x</i><sub>t,r</sub> = Differenz der Kettenbits <span class="hint">· Klick setzt die Wand · rot = −1</span>' }),
      el('div', { class: 'table-wrap' }, table));
  },
  step2: (c) => `Je Auftrag eine <b>Kette</b> über die Roboter: feste 1, ${c.R} − 1 Bits, feste 0. Die Wand 1 → 0 zeigt den Roboter: <i>x</i><sub>t,r</sub> = <i>d</i><sub>t,r−1</sub> − <i>d</i><sub>t,r</sub>.
    ${c.T} × (${c.R} − 1) → <b>${c.f.n} Qubits</b> (One-Hot: ${c.data.compare.one_hot.n}). Σ<sub>r</sub> <i>x</i> = 1 gilt für jede Stellung (Teleskop) – „genau ein Roboter“ ist eingebaut, Doppelbelegung über Ketten hinweg erlaubt.`,
  step4: () => `<i>A</i>·${domainWall.names.pen} = <i>A</i>·${domainWall.penFormula}: <b>keine falsche Wand</b> – gekoppelt sind nur direkte Nachbarn einer Kette.
    Eine gebrochene Kette erzeugt <i>x</i> = −1: Sie zieht Last von einem Roboter ab – mit <i>H</i><sub>WB</sub> wird das verlockend, darum wächst die Schranke für A mit B.`,
};

// ---------------------------------------------------------------- Binary
const codeOf = (f, gr, bits) => gr.bits.reduce((s, i, j) => s + (bits[i] << (f.K - 1 - j)), 0);
function setCode(f, x, gr, code) {
  gr.bits.forEach((i, j) => { x[i] = (code >> (f.K - 1 - j)) & 1; });
}
export function makeHonest(f, x) {
  for (const a of f.aux) x[a.index] = x[a.pair[0]] * x[a.pair[1]];
  return x;
}
const binary = {
  key: 'binary', api: 'binary', name: 'Binary', pen: 'ungueltig', quboFrom: 6,
  steps: WB_STEPS('Codes', { kind: 'ungueltig', title: 'Ungültige Codes' }, ['Hilfsbits']),
  names: { obj: '<i>H</i><sub>obj_B</sub>', pen: '<i>H</i><sub>pen_B</sub>', wb: '<i>H</i><sub>B_WB</sub>', aux: '<i>H</i><sub>Aux</sub>' },
  penText: 'kein ungenutzter oder gesperrter Code',
  penFormula: 'Σ<sub><i>t</i></sub> Σ<sub><i>k</i> ∉ Roboter von <i>t</i></sub> <i>I</i><sub><i>t</i>,<i>k</i></sub>',
  xHtml: (t, r) => `<i>y</i><sub>${t},${r}</sub>`,
  boardTitle: 'Die Codes',
  boardSub: 'Je Auftrag die Roboternummer im Zweiersystem · Codebuch: blau = gewählt, rot gestrichelt = ungenutzt/gesperrt · Klick schaltet',
  bitLabel: (f, i) => (f.bits[i].aux ? `a${sub(f.bits[i].task_id ?? '')},${sub(f.bits[i].pos)}` : `b${sub(f.bits[i].task_id)},${sub(f.bits[i].pos)}`),
  graph(f) {
    const auxCol = new Map();
    for (const g of f.groups) f.aux.filter((a) => a.group === g.key).forEach((a, k) => auxCol.set(a.index, f.K + k + 1));
    const nCols = Math.max(1, ...f.bits.map((b) => (b.aux ? auxCol.get(b.index) ?? f.K + 1 : b.pos)));
    return { variables: f.bits.map((b) => ({ ...b, cost: 0, row: b.group ?? 'a', col: b.aux ? auxCol.get(b.index) ?? f.K + 1 : b.pos })),
      rowKeys: [...f.groups.map((g) => g.key), ...(f.aux.some((a) => a.group == null) ? ['a'] : [])],
      colKeys: Array.from({ length: nCols }, (_, k) => k + 1), rowLabel: (k) => (k === 'a' ? 'Hilfs' : `#${k}`), colLabel: (k) => (k <= f.K ? `Bit ${k}` : `a·${k - f.K}`) };
  },
  planBits(f, inst, varIdx) {
    const x = new Uint8Array(f.n);
    for (const gr of f.groups) {
      const c = gr.codes.find((cc) => cc.var != null && varIdx.includes(cc.var));
      if (c) setCode(f, x, gr, c.code);
    }
    return makeHonest(f, x);
  },
  issueText: (t, on, f, bits) => {
    const gr = f.groups.find((g) => g.key === t);
    const c = gr.codes[codeOf(f, gr, bits)];
    return `#${t}: Code ${c.pattern} ${c.status}`;
  },
  penItems(f, inst, bits, xs, A) {
    return f.groups.filter((gr) => gr.vars.length).map((gr) => {
      const c = gr.codes[codeOf(f, gr, bits)];
      return c.var == null ? { v: A, ok: false, text: `#${gr.key}: Code ${c.pattern} ${c.status} → A = ${fmt(A)}` }
        : { v: 0, ok: true, text: `#${gr.key}: Code ${c.pattern} → R${c.member} ✓` };
    });
  },
  renderBoard(host, c) {
    const { f } = c;
    const rows = f.groups.map((gr) => {
      const t = gr.key;
      const task = c.inst.tasks.find((x) => x.transport_id === t);
      const head = el('div', { class: 'dw-head', 'data-task': t }, el('div', {}, el('strong', {}, `#${t}`)), el('div', { class: 'hint' }, `${shortName(task.from_entity)} → ${shortName(task.to_entity)}`));
      if (!gr.vars.length) return el('div', { class: 'bin-row' }, head, el('div', { class: 'hint' }, 'kein Roboter zuständig – nicht darstellbar'));
      const code = codeOf(f, gr, c.st.x);
      const cur = gr.codes[code];
      const bitsEl = el('div', { class: 'bin-bits' }, f.K ? gr.bits.map((i, j) => {
        const b = el('button', { class: `cell dw-bit switch${c.st.x[i] ? ' on' : ''}`, type: 'button', 'data-var': i, 'data-group': t,
          'aria-pressed': String(Boolean(c.st.x[i])), 'aria-label': `${c.bitLabel(i)} umschalten` },
        el('span', { class: 'bit' }, c.st.x[i] ? '1' : '0'), el('span', { class: 'var' }, c.bitLabel(i)), el('span', { class: 'cost' }, `×${2 ** (f.K - 1 - j)}`));
        b.addEventListener('click', () => c.toggle(i));
        return b;
      }) : el('span', { class: 'hint' }, '0 Bits – nur ein Roboter'));
      const ok = cur.var != null;
      const result = el('div', { class: `bin-code ${ok ? 'good' : 'bad'}` }, el('div', { class: 'hint' }, `Code ${cur.pattern || '–'}`),
        el('div', {}, ok ? `→ R${cur.member}` : `✗ ${cur.status}`), c.showCost && ok ? el('div', { class: 'hint' }, `${fmt(cur.cost)} ${c.unit}`) : null);
      const book = el('div', { class: 'bin-book' }, gr.codes.map((cc) => {
        const chip = el('button', { class: `bin-chip${cc.code === code ? ' current' : ''}${cc.var == null ? ' phantom' : ''}`, type: 'button', title: 'Code laden' },
          el('span', { class: 'mono' }, cc.pattern || '–'), el('span', {}, cc.member != null ? `R${cc.member}${cc.var == null ? ' ✗' : ''}` : 'ungenutzt'),
          c.showCost ? el('span', { class: 'hint' }, cc.var != null ? fmt(cc.cost) : c.st.terms.ungueltig ? `A = ${nf(c.st.A)}` : '0 (!)') : null);
        chip.addEventListener('click', () => c.setBits((x) => setCode(f, x, gr, cc.code)));
        return chip;
      }));
      return el('div', { class: 'bin-row' }, head, bitsEl, result, book);
    });
    const auxEl = c.qubo && f.aux.length ? el('div', { class: 'bin-aux' },
      el('div', { class: 'filter-label' }, `Hilfsbits ${f.aux.length}:`),
      f.aux.map((a) => {
        const honest = c.st.x[a.pair[0]] * c.st.x[a.pair[1]];
        const lies = c.st.x[a.index] !== honest;
        const b = el('button', { class: `cell dw-bit switch${c.st.x[a.index] ? ' on' : ''}${lies ? ' lie' : ''}`, type: 'button', 'data-var': a.index, 'data-group': a.group ?? '' },
          el('span', { class: 'bit' }, c.st.x[a.index] ? '1' : '0'), el('span', { class: 'var' }, c.bitLabel(a.index)), el('span', { class: 'cost' }, lies ? 'lügt!' : '✓'));
        withTip(b, () => tipHtml(`${c.bitLabel(a.index)} soll ${c.bitLabel(a.pair[0])}·${c.bitLabel(a.pair[1])} sein`, [lies ? '<b>lügt – kostet M·Strafe</b>' : 'ehrlich', `ersetzt das Paar in ${a.replaced} Term(en) vom Grad > 2`]));
        b.addEventListener('click', () => c.toggle(a.index, true));
        return el('span', { class: 'bin-aux-item' }, b, el('span', { class: 'hint' }, `= ${c.bitLabel(a.pair[0])}·${c.bitLabel(a.pair[1])}`));
      }),
      (() => {
        const box = el('input', { type: 'checkbox', checked: c.st.honest });
        box.addEventListener('change', () => { c.st.honest = box.checked; c.setBits(() => {}); });
        return el('label', { class: 'filter-group' }, box, el('span', { class: 'hint' }, 'beim Klicken ehrlich halten'));
      })()) : null;
    const varAt = new Map(c.inst.variables.map((v) => [`${v.task_id}|${v.robot_id}`, v.index]));
    const table = assignTable(c, {
      corner: 'y: Auftrag ╲ Roboter',
      rowEndHead: 'Σ = 1',
      cell: (t, r) => {
        const v = varAt.get(`${t}|${r}`);
        if (v == null) return el('td', { class: 'x-cell none' }, '–');
        const yv = c.dec.xs[v];
        const td = el('td', { class: `x-cell${yv ? ' on' : ''}`, 'data-task': t, 'data-robot': r, title: `y${sub(t)},${sub(r)} = ${yv} · Klick: Code von R${r}` }, String(yv));
        td.addEventListener('click', () => c.pick(t, r));
        return td;
      },
      rowEnd: (t) => {
        const ok = c.dec.assignment[t] != null;
        return rowSum(c, t, `${ok ? 1 : 0} ${ok ? '✓' : '✗'}`, ok);
      },
    });
    fill(host, el('div', { class: 'dw-board' }, rows), auxEl,
      el('h4', { style: { marginTop: '14px' }, html: 'Daraus: <i>y</i><sub>t,r</sub> = Produkt der Code-Bits <span class="hint">· Klick setzt den Code · immer 0 oder 1</span>' }),
      el('div', { class: 'table-wrap' }, table));
  },
  step2: (c) => {
    const unused = 2 ** c.f.K - c.R;
    return `Die Roboter bekommen Nummern (${c.f.members.map((m, k) => `R${m} = ${c.f.groups[0]?.codes[k]?.pattern ?? k}`).join(', ')}); je Auftrag steht die gewählte im Zweiersystem:
      <b>K = ⌈log₂ ${c.R}⌉ = ${c.f.K} Bits</b> × ${c.T} → <b>${c.f.n_code_bits} Bits</b> (One-Hot ${c.data.compare.one_hot.n}, Domain Wall ${c.data.compare.domain_wall.n}).
      <i>y</i><sub>t,r</sub> = Produkt der Bits – 1 genau beim Code von r. ${unused ? `<span class="warnline">${unused} Code${unused === 1 ? '' : 's'} ohne Roboter.</span>` : ''}`;
  },
  step4: (c) => `<i>A</i>·${binary.names.pen}: je ungenutztem oder gesperrtem Code <b>A · Indikator</b>${2 ** c.f.K - c.R ? '' : ' – hier ist R eine Zweierpotenz, nur gesperrte Codes zählen'}.
    Sonst kostet ein Auftrag dort 0 und trägt keine Last – mit <i>H</i><sub>WB</sub> wird das noch verlockender (Schranke für A wächst mit B).`,
};

export const TA_ENCODINGS = { one_hot: oneHot, domain_wall: domainWall, binary };
export { setChain, setCode, codeOf };
