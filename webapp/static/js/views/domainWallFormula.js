// „Die Formel dahinter“ für die Domain-Wall-Seite – wie bei One-Hot vier Register:
//   ① Formel & Symbole   ② Eingesetzt   ③ Ausmultipliziert → QUBO   ④ Wirkung der Terme
// Formelteile tragen data-hl – beim Überfahren hebt die Seite die passenden Bits hervor.
import { el, fill, nf } from '../util.js';
import { C, plot } from '../theme.js';
import { energy, fromMask, makeModel, search } from '../qubo/engine.js';

export const DW_FORMULA_TABS = [
  { key: 'formel', label: '① Formel & Symbole' },
  { key: 'eingesetzt', label: '② Eingesetzt' },
  { key: 'qubo', label: '③ Ausmultipliziert → QUBO' },
  { key: 'wirkung', label: '④ Wirkung der Terme' },
];
export const DW_DEFAULT_TAB = { 3: 'formel', 4: 'wirkung', 5: 'eingesetzt', 6: 'qubo' };
const SWEEP_MAX_BITS = 16;
const ALL = { kosten: true, kette: true, spalte: true };

const fmt = (v) => nf(v, 1).replace('-', '−');
const signed = (v) => (v < 0 ? `− ${fmt(-v)}` : `+ ${fmt(v)}`);
const hl = (o) => `data-hl='${JSON.stringify(o)}'`;
const bit = (on) => (on ? '<b class="one">1</b>' : '<span class="zero">0</span>');

/** Ketten auslesen: Wände, gewählter Roboter, Verstöße (wie decode_domain_wall in Python). */
export function decodeChains(form, x) {
  const chains = form.chains.map((ch) => {
    const b = [1, ...ch.bits.map((i) => x[i]), 0];
    const down = [];
    const up = [];
    for (let k = 0; k < b.length - 1; k += 1) {
      if (b[k] === 1 && b[k + 1] === 0) down.push(k);
      if (b[k] === 0 && b[k + 1] === 1) up.push(k);
    }
    const valid = ch.robots.length > 0 && up.length === 0;
    return { ch, b, down, up, valid, robot: valid ? ch.robots[down[0]] : null, cost: valid ? ch.costs[down[0]] : null };
  });
  const issues = [];
  for (const c of chains) {
    if (!c.ch.robots.length) issues.push({ kind: 'leer', task: c.ch.task_id, text: `#${c.ch.task_id}: kein Roboter – nicht darstellbar` });
    else if (!c.valid) issues.push({ kind: 'kette', task: c.ch.task_id, text: `#${c.ch.task_id}: ${c.down.length + c.up.length} Wände` });
  }
  const used = new Map();
  for (const c of chains) if (c.valid) used.set(c.robot, [...(used.get(c.robot) || []), c.ch.task_id]);
  for (const [r, ts] of used) {
    if (ts.length > 1) issues.push({ kind: 'spalte', robot: r, text: `R${r} fährt ${ts.length} Aufträge (${ts.map((t) => `#${t}`).join(', ')})` });
  }
  return { chains, issues, valid: issues.length === 0, used };
}

/**
 * @param {HTMLElement} host
 * @param {object} api  getState(), highlight(sel), clearHighlight(), setWeight(key, value), describe(x)
 */
export function createDwFormulaPanel(host, api) {
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
    if (task == null || !s.data.formulation.chains.some((c) => c.task_id === task && c.robots.length)) {
      task = s.data.formulation.chains.find((c) => c.robots.length > 1)?.task_id ?? s.data.formulation.chains[0]?.task_id;
    }
    fill(bar, DW_FORMULA_TABS.map((t) => el('button', {
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
  const bitOf = (s, i) => s.data.formulation.bits[i];
  const bHtml = (s, i) => { const b = bitOf(s, i); return `<i>b</i><sub>${b.task_id},${b.pos}</sub>`; };
  /** δ_k einer Kette als Text: (b_{k−1} − b_k) mit festen Rändern 1 und 0. */
  function deltaHtml(s, ch, k, values) {
    const left = k === 0 ? '1' : values ? bit(values[ch.bits[k - 1]]) : bHtml(s, ch.bits[k - 1]);
    const right = k === ch.robots.length - 1 ? '0' : values ? bit(values[ch.bits[k]]) : bHtml(s, ch.bits[k]);
    if (k === ch.robots.length - 1 && k === 0) return '1';
    if (k === ch.robots.length - 1) return left;
    return `(${left} − ${right})`;
  }
  /** Lineare Form {const, terms} als Text, wahlweise mit eingesetzten Bits. */
  function linHtml(s, e, values) {
    const parts = [];
    if (e.const || !Object.keys(e.terms).length) parts.push(fmt(e.const));
    for (const [i, c] of Object.entries(e.terms)) {
      const v = values ? bit(values[Number(i)]) : bHtml(s, Number(i));
      parts.push(`${c < 0 ? '−' : parts.length ? '+' : ''} ${Math.abs(c) === 1 ? '' : `${fmt(Math.abs(c))}·`}${v}`);
    }
    return `(${parts.join(' ')})`;
  }
  const linVal = (e, x) => e.const + Object.entries(e.terms).reduce((acc, [i, c]) => acc + c * x[Number(i)], 0);
  const offNote = (s, kind) => {
    if (s.terms[kind]) return '';
    const stepOf = { kosten: 3, kette: 4, spalte: 5 }[kind];
    return s.step < stepOf ? `kommt in Schritt ${stepOf}` : 'gerade ausgeschaltet';
  };
  const taskChips = (s) => form(s).chains.filter((c) => c.robots.length > 1)
    .map((c) => `<button type="button" class="chip" data-task-pick="${c.task_id}" aria-pressed="${c.task_id === task}">#${c.task_id}</button>`).join(' ');
  const bindChips = () => body.querySelectorAll('[data-task-pick]').forEach((b) => b.addEventListener('click', () => { task = Number(b.dataset.taskPick); render(); }));

  // ---------------------------------------------------------------- ① Formel & Symbole
  function renderFormula(s) {
    const f = form(s);
    const line = (kind, lhs, term, note) => {
      const off = offNote(s, kind);
      return `<div class="fx-line t-${kind === 'kette' ? 'zeile' : kind}${off ? ' off' : ''}" ${hl({ kind })}>
        <span class="fx-lhs">${lhs}</span><span class="fx-term">${term}</span>
        <span class="fx-note">${note}${off ? ` <em>(${off})</em>` : ''}</span></div>`;
    };
    const costs = s.data.instance.variables.map((v) => v.cost);
    body.innerHTML = `
      <p class="fx-intro">Das ist die komplette Domain-Wall-Formulierung. Statt Schaltern <i>x</i><sub>t,r</sub> gibt es je Auftrag eine Kette aus Bits
        <i>b</i><sub>t,1</sub> … <i>b</i><sub>t,R−1</sub>. Fahre über eine Zeile, um die betroffenen Bits zu sehen.</p>
      <div class="fx">
        ${line('kosten', '<i>E</i>(<i>b</i>) =', 'Σ<sub><i>t</i></sub> Σ<sub><i>k</i></sub> <i>c</i><sub><i>t</i>,<i>k</i></sub> · δ<sub><i>t</i>,<i>k</i></sub>',
    `<b>Kosten.</b> δ ist 1 genau an der Wand – dort zahlt der Auftrag die Kosten des Roboters <i>k</i> seiner Kette (${s.data.instance.criterion.label}).`)}
        ${line('kette', '+', '<i>A</i> · Σ<sub><i>t</i></sub> Σ<sub><i>i</i></sub> <i>b</i><sub><i>t</i>,<i>i</i>+1</sub> ( 1 − <i>b</i><sub><i>t</i>,<i>i</i></sub> )',
    '<b>Kettenregel.</b> Eine 1 rechts von einer 0 (Wand 0 → 1) kostet A. Ohne solche Wände bleibt genau eine Wand – genau ein Roboter.')}
        ${line('spalte', '+', '<i>B</i> · Σ<sub><i>r</i></sub> Σ<sub><i>t</i> &lt; <i>t</i>′</sub> δ<sub><i>t</i>,<i>r</i></sub> · δ<sub><i>t</i>′,<i>r</i></sub>',
    '<b>Spaltenregel.</b> Zeigen zwei Wände auf denselben Roboter, sind beide δ = 1 → B.')}
        <div class="fx-line" style="border-color:${C.axis}" ${hl({ all: true })}><span class="fx-lhs">mit</span>
          <span class="fx-term">δ<sub><i>t</i>,<i>k</i></sub> = <i>b</i><sub><i>t</i>,<i>k</i>−1</sub> − <i>b</i><sub><i>t</i>,<i>k</i></sub>,&nbsp; <i>b</i><sub><i>t</i>,0</sub> = 1,&nbsp; <i>b</i><sub><i>t</i>,<i>R</i></sub> = 0</span>
          <span class="fx-note">Die Ränder sind fest. δ ist eine <b>Differenz zweier Bits</b> – linear. Deshalb bleiben Kosten linear und die Spaltenregel quadratisch.</span></div>
      </div>
      <table class="data symbols">
        <thead><tr><th>Symbol</th><th>Bedeutung</th><th>in diesem Szenario</th></tr></thead>
        <tbody>
          <tr ${hl({ all: true })}><td><i>t</i></td><td>ein Auftrag – eine Kette</td><td>${f.chains.map((c) => `#${c.task_id}`).join(', ')}</td></tr>
          <tr ${hl({ all: true })}><td><i>k</i> = 1 … <i>R<sub>t</sub></i></td><td>Position eines Roboters in der Kette von <i>t</i> (${f.order === 'kosten' ? 'billigster zuerst' : 'nach Nummer'})</td>
            <td>${f.chains.map((c) => `#${c.task_id}: ${c.robots.map((r) => `R${r}`).join(' ')}`).join(' · ')}</td></tr>
          <tr ${hl({ kind: 'kosten' })}><td><i>b</i><sub><i>t</i>,<i>i</i></sub> ∈ {0, 1}</td><td>Bit <i>i</i> der Kette von <i>t</i> – später ein Qubit</td><td>${f.n} Bits (One-Hot: ${s.data.one_hot.n})</td></tr>
          <tr ${hl({ kind: 'kosten' })}><td><i>c</i><sub><i>t</i>,<i>k</i></sub></td><td>Kosten, wenn der <i>k</i>-te Roboter der Kette <i>t</i> übernimmt</td><td>${costs.length ? `${fmt(Math.min(...costs))} … ${fmt(Math.max(...costs))} ${unit(s)}` : '–'}</td></tr>
          <tr ${hl({ kind: 'kette' })}><td><i>A</i></td><td>Strafgewicht der Kettenregel</td><td>${fmt(s.A)} (Regler)</td></tr>
          <tr ${hl({ kind: 'spalte' })}><td><i>B</i></td><td>Strafgewicht der Spaltenregel</td><td>${fmt(s.B)} (Regler)</td></tr>
        </tbody>
      </table>`;
  }

  // ---------------------------------------------------------------- ② Eingesetzt
  function renderSubstituted(s) {
    const f = form(s);
    const x = s.x;
    const rows = [];
    let total = 0;
    for (const ch of f.chains.filter((c) => c.robots.length)) {
      const val = ch.costs.reduce((acc, c, k) => {
        const b = [1, ...ch.bits.map((i) => x[i]), 0];
        return acc + c * (b[k] - b[k + 1]);
      }, 0);
      if (s.terms.kosten) total += val;
      rows.push({ kind: 'kosten', sel: { task: ch.task_id }, name: `Kosten #${ch.task_id}`,
        formula: ch.costs.map((c, k) => `${fmt(c)}·${deltaHtml(s, ch, k)}`).join(' + '),
        subst: ch.costs.map((c, k) => `${fmt(c)}·${deltaHtml(s, ch, k, x)}`).join(' + '), value: val });
    }
    for (const ch of f.chains.filter((c) => c.bits.length > 1)) {
      const pairs = ch.bits.slice(1).map((i, k) => [ch.bits[k], i]);
      const ups = pairs.filter(([a, b]) => x[b] && !x[a]).length;
      const val = s.A * ups;
      if (s.terms.kette) total += val;
      rows.push({ kind: 'kette', sel: { task: ch.task_id }, name: `Kette #${ch.task_id}`,
        formula: `<i>A</i>·[ ${pairs.map(([a, b]) => `${bHtml(s, b)}(1 − ${bHtml(s, a)})`).join(' + ')} ]`,
        subst: `${fmt(s.A)}·[ ${pairs.map(([a, b]) => `${bit(x[b])}·(1 − ${bit(x[a])})`).join(' + ')} ] = ${fmt(s.A)}·${ups}`, value: val, ok: ups === 0 });
    }
    for (const r of f.rules.filter((rr) => rr.kind === 'spalte')) {
      const d1 = linVal(r.deltas[0], x);
      const d2 = linVal(r.deltas[1], x);
      const val = s.B * d1 * d2;
      if (s.terms.spalte) total += val;
      rows.push({ kind: 'spalte', sel: { robot: r.robot_id }, name: `R${r.robot_id}: #${r.tasks[0]} & #${r.tasks[1]}`,
        formula: `<i>B</i>·${linHtml(s, r.deltas[0])}·${linHtml(s, r.deltas[1])}`,
        subst: `${fmt(s.B)}·${linHtml(s, r.deltas[0], x)}·${linHtml(s, r.deltas[1], x)} = ${fmt(s.B)}·${d1}·${d2}`, value: val, ok: d1 * d2 <= 0 });
    }
    const cls = (k) => (k === 'kette' ? 'zeile' : k);
    body.innerHTML = `
      <p class="fx-intro">Die Formel mit den <b>Zahlen dieses Szenarios</b> und deiner <b>aktuellen Bitstellung</b>, Zeile für Zeile.
        Eine <b class="one">1</b> ist ein gesetztes Bit. Beachte: An einer falschen Wand wird δ = −1 – dann kann die Spaltenregel negativ werden.</p>
      <div class="table-wrap"><table class="data fx-table">
        <thead><tr><th>Term</th><th>Formel mit Zahlen</th><th>mit deinen Bits eingesetzt</th><th class="num">Wert</th></tr></thead>
        <tbody>${rows.map((r) => {
    const off = !s.terms[r.kind];
    return `<tr class="t-row t-${cls(r.kind)}${off ? ' off' : ''}" ${hl(r.sel)}><td><span class="t-name">${r.name}</span></td>
            <td class="fx-cell">${r.formula}</td><td class="fx-cell">${r.subst}</td>
            <td class="num ${off ? '' : r.ok === false ? 'no-val' : ''}">${off ? `<em>${offNote(s, r.kind)}</em>` : fmt(r.value)}</td></tr>`;
  }).join('')}
          <tr class="fx-total"><td colspan="3">Summe aller aktiven Terme: <i>E</i>(<i>b</i>)</td><td class="num">${fmt(total)}</td></tr>
        </tbody></table></div>`;
  }

  // ---------------------------------------------------------------- ③ Ausmultipliziert → QUBO
  function renderExpansion(s) {
    const f = form(s);
    const ch = f.chains.find((c) => c.task_id === task);
    const model = s.model;
    const lin = model.entries.filter((e) => e.i === e.j && e.value !== 0);
    const quad = model.entries.filter((e) => e.i !== e.j && e.value !== 0);
    const termHtml = [
      ...lin.map((e) => `<span class="q-term" ${hl({ vars: [e.i] })}>${signed(e.value)}·${bHtml(s, e.i)}</span>`),
      ...quad.map((e) => `<span class="q-term" ${hl({ vars: [e.i, e.j] })}>${signed(e.value)}·${bHtml(s, e.i)}${bHtml(s, e.j)}</span>`),
    ];
    const LIMIT = 30;
    const Ep = penaltyEnergy(s);
    const Eq = energy(model, s.x);
    let tele = '<p class="hint">Diese Kette hat nur einen Roboter – nichts zu zeigen.</p>';
    let chainHtml = '';
    let colHtml = '<p class="hint">Kein anderer Auftrag teilt sich hier einen Roboter mit diesem – keine Spaltenregel.</p>';
    if (ch && ch.robots.length > 1) {
      const diffs = ch.bits.map((i, k) => `<span class="p-lin" ${hl({ vars: [i] })}>${signed(ch.costs[k + 1] - ch.costs[k])}·${bHtml(s, i)}</span>`).join(' ');
      tele = `<div class="fx-derivation t-kosten${s.terms.kosten ? '' : ' off'}" ${hl({ task: ch.task_id })}>
          <div>${ch.costs.map((c, k) => `${fmt(c)}·${deltaHtml(s, ch, k)}`).join(' + ')}</div>
          <div><span class="eq">=</span> <span class="p-const">${fmt(ch.costs[0])}</span> ${diffs}</div>
          <div class="why"><span class="p-const">Konstante: Kosten des ersten Roboters (R${ch.robots[0]})</span> ·
            <span class="p-lin">je Bit die Differenz zum nächsten Roboter – jedes Bit schiebt die Wand eine Stufe weiter</span>.
            Jedes Bit taucht in zwei δ auf, einmal mit +, einmal mit −: alles andere hebt sich weg (Teleskopsumme).</div>
        </div>`;
      const pairs = ch.bits.slice(1).map((i, k) => [ch.bits[k], i]);
      chainHtml = pairs.length
        ? `<div class="fx-derivation t-zeile${s.terms.kette ? '' : ' off'}" ${hl({ task: ch.task_id })}>
            <div><i>A</i>·<i>b</i><sub>i+1</sub>(1 − <i>b</i><sub>i</sub>) <span class="eq">=</span> <span class="p-lin"><i>A</i>·<i>b</i><sub>i+1</sub></span> <span class="p-pair">− <i>A</i>·<i>b</i><sub>i</sub><i>b</i><sub>i+1</sub></span></div>
            <div><span class="eq">=</span> ${pairs.map(([a, b]) => `<span class="p-lin">+ ${fmt(s.A)}·${bHtml(s, b)}</span> <span class="p-pair">− ${fmt(s.A)}·${bHtml(s, a)}${bHtml(s, b)}</span>`).join(' ')}</div>
            <div class="why">Eine 1 kostet A … außer ihr linker Nachbar ist auch 1 – dann wird A erstattet. ${bHtml(s, ch.bits[0])} hat keinen Preis: Links von ihm steht die feste 1.
              Nur <b>direkte Nachbarn</b> sind gekoppelt (${pairs.length} Kopplungen statt ${(ch.robots.length * (ch.robots.length - 1)) / 2} bei One-Hot).</div>
          </div>`
        : '<p class="hint">Die Kette hat nur ein Bit – keine Kettenregel nötig.</p>';
      const r = f.rules.find((rr) => rr.kind === 'spalte' && rr.tasks.includes(ch.task_id));
      if (r) {
        const [d1, d2] = r.deltas;
        const terms = [];
        const c0 = d1.const * d2.const;
        if (c0) terms.push(`<span class="p-const">${signed(c0 * s.B)}</span>`);
        for (const [i, c] of Object.entries(d1.terms)) if (d2.const) terms.push(`<span class="p-lin">${signed(c * d2.const * s.B)}·${bHtml(s, Number(i))}</span>`);
        for (const [j, c] of Object.entries(d2.terms)) if (d1.const) terms.push(`<span class="p-lin">${signed(c * d1.const * s.B)}·${bHtml(s, Number(j))}</span>`);
        for (const [i, ci] of Object.entries(d1.terms)) {
          for (const [j, cj] of Object.entries(d2.terms)) terms.push(`<span class="p-pair">${signed(ci * cj * s.B)}·${bHtml(s, Number(i))}${bHtml(s, Number(j))}</span>`);
        }
        colHtml = `<div class="fx-derivation t-spalte${s.terms.spalte ? '' : ' off'}" ${hl({ robot: r.robot_id })}>
            <div>Roboter R${r.robot_id} in den Ketten von #${r.tasks[0]} und #${r.tasks[1]}: <i>B</i>·${linHtml(s, d1)}·${linHtml(s, d2)}</div>
            <div><span class="eq">=</span> ${terms.join(' ')}</div>
            <div class="why">Jedes Produkt zweier Differenzen gibt bis zu vier Terme. Bits an gleicher Stelle bekommen +B, versetzte −B – zusammen über alle Roboter
              die „Leiter mit gekreuzten Sprossen“ aus dem Lesekapitel: <b>3R − 5</b> Kopplungen je Auftragspaar (One-Hot: R).</div>
          </div>`;
      }
    }
    body.innerHTML = `
      <p class="fx-intro">Ein QUBO darf nur einzelne Bits und Bit-Paare enthalten. Bei Domain Wall ist dafür wenig zu tun: Die Kosten werden durch die
        <b>Teleskopsumme</b> linear, die Kettenregel ist schon ein Produkt zweier Nachbarn, und die Spaltenregel ist ein Produkt zweier Differenzen.</p>
      <h4>Am Beispiel von Auftrag ${taskChips(s)}</h4>
      <h4>Kosten: die Teleskopsumme</h4>${tele}
      <h4>Kettenregel: nur Nachbarn</h4>${chainHtml}
      <h4>Spaltenregel: Produkt zweier Differenzen</h4>${colHtml}
      <h4>Wohin wandert welcher Teil in der QUBO-Matrix?</h4>
      <table class="data fx-table">
        <thead><tr><th>Herkunft</th><th>Formelteil</th><th>landet in</th><th class="num">Wert hier</th></tr></thead>
        <tbody>
          <tr class="t-row t-kosten" ${hl({ kind: 'kosten' })}><td>Kosten</td><td><i>c</i><sub>t,1</sub></td><td>Konstante (verschiebt nur)</td><td class="num">${fmt(f.const.c)}</td></tr>
          <tr class="t-row t-kosten" ${hl({ kind: 'kosten' })}><td>Kosten</td><td>(<i>c</i><sub>t,k+1</sub> − <i>c</i><sub>t,k</sub>)·<i>b</i><sub>t,k</sub></td><td>Diagonale</td><td class="num">Differenzen</td></tr>
          <tr class="t-row t-zeile" ${hl({ kind: 'kette' })}><td>Kettenregel</td><td>+ <i>A</i>·<i>b</i><sub>i+1</sub> &nbsp; − <i>A</i>·<i>b</i><sub>i</sub><i>b</i><sub>i+1</sub></td><td>Diagonale · Kopplung <b>direkter Nachbarn</b></td><td class="num">${fmt(s.A)} · ${fmt(-s.A)}</td></tr>
          <tr class="t-row t-spalte" ${hl({ kind: 'spalte' })}><td>Spaltenregel</td><td>±<i>B</i>·<i>b</i><i>b</i>′, ±<i>B</i>·<i>b</i></td><td>Kopplung <b>zwischen Ketten</b> (gleiche und versetzte Stelle), am Rand Diagonale/Konstante</td><td class="num">±${fmt(s.B)}</td></tr>
        </tbody>
      </table>
      <h4>Die fertige QUBO-Form – genau das bekommt die Hardware</h4>
      <div class="fx-qubo"><i>E</i>(<i>b</i>) = ${termHtml.slice(0, LIMIT).join(' ')}${termHtml.length > LIMIT ? ` <span class="hint">… und ${termHtml.length - LIMIT} weitere Terme</span>` : ''} <span class="q-term">${signed(model.constant)}</span></div>
      <p class="fx-probe">Probe mit deinen Bits: Formel ergibt <b>${fmt(Ep)}</b>, QUBO-Form ergibt <b>${fmt(Eq)}</b>
        ${Math.abs(Ep - Eq) < 1e-6 ? '<span class="okline">✓ identisch</span>' : '<span class="warnline">✗ Abweichung</span>'}</p>`;
    bindChips();
  }

  /** E(b) direkt aus der Formel (wie energy_rules_dw in Python), nur aktive Terme. */
  function penaltyEnergy(s) {
    const x = s.x;
    let e = 0;
    for (const r of form(s).rules) {
      if (r.kind === 'kosten' && s.terms.kosten) e += r.costs.reduce((acc, c, k) => acc + c * linVal(r.deltas[k], x), 0);
      if (r.kind === 'kette' && s.terms.kette) e += s.A * x[r.vars[1]] * (1 - x[r.vars[0]]);
      if (r.kind === 'spalte' && s.terms.spalte) e += s.B * linVal(r.deltas[0], x) * linVal(r.deltas[1], x);
    }
    return e;
  }

  // ---------------------------------------------------------------- ④ Wirkung der Terme
  function renderEffects(s) {
    const f = form(s);
    const ch = f.chains.find((c) => c.task_id === task);
    const sweepA = el('div', { class: 'chart short' });
    const sweepB = el('div', { class: 'chart short' });
    const statesHost = el('div');
    fill(body,
      el('p', { class: 'fx-intro', html: `Wie wirken die Terme? Links alle Stellungen <b>einer Kette</b> – mit „Phantasiewerten“ für ungültige Ketten.
        Unten: Ab welchem A bzw. B wird das Minimum <b>gültig</b>? Klick in die Kurve setzt den Regler.` }),
      el('h4', { html: `Alle Stellungen der Kette von Auftrag ${taskChips(s)}` }), statesHost,
      el('div', { class: 'grid grid-2' },
        el('div', {}, el('h4', {}, 'Wie groß muss A sein? (Kettenregel)'), sweepA, el('p', { class: 'hint', 'data-sweep': 'A' })),
        el('div', {}, el('h4', {}, 'Wie groß muss B sein? (Spaltenregel)'), sweepB, el('p', { class: 'hint', 'data-sweep': 'B' }))));
    bindChips();
    renderStates(s, ch, statesHost);
    for (const [key, div] of [['A', sweepA], ['B', sweepB]]) {
      const res = drawSweep(s, key, div);
      const note = body.querySelector(`[data-sweep="${key}"]`);
      if (!res || !note) continue;
      const rule = key === 'A' ? 'die Kettenregel' : 'die Spaltenregel';
      const below = res.lo != null ? [...res.pts].reverse().find((p) => !p.valid && p.val < res.lo) : null;
      const above = res.bounded ? res.pts.find((p) => !p.valid && p.val > res.hi) : null;
      const parts = [];
      if (res.lo == null) parts.push('Im gezeigten Bereich wird das Minimum nie gültig – mehr Aufträge als freie Roboter? Domain Wall kann keinen Auftrag liegen lassen.');
      else if (res.lo === 0 && !res.bounded) parts.push(`Hier ist das Minimum für jedes ${key} gültig – ${rule} hält schon der Rest ein.`);
      if (below) parts.push(`Unterhalb von ${key} ≈ ${fmt(res.lo)} ist es billiger, ${rule} zu brechen – z.B. ${key} = ${fmt(below.val)}: <b>${below.desc}</b>.`);
      if (above) {
        parts.push(`<b>Oberhalb von ${key} ≈ ${fmt(res.hi)} kippt es wieder</b> – z.B. ${key} = ${fmt(above.val)}: <b>${above.desc}</b>.
          ${key === 'B' ? `Eine zu große Spaltenregel überstimmt die Kettenregel: An einer falschen Wand ist δ = −1, aus der Strafe wird eine Belohnung. Deshalb A = 2·B – bei One-Hot gibt es diese Obergrenze nicht.`
    : 'Zu großes A verschiebt die Gewichte so, dass sich ein anderer Regelbruch lohnt.'}`);
      }
      if (key === 'A' && below) parts.push(`Mit B = ${fmt(s.B)} braucht A mehr als nur die Spannweite der Kosten: An einer falschen Wand ist δ = −1, die Spaltenregel belohnt dann.`);
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
      let down = 0;
      let up = 0;
      let cost = 0;
      for (let k = 0; k < b.length - 1; k += 1) {
        if (b[k] === 1 && b[k + 1] === 0) down += 1;
        if (b[k] === 0 && b[k + 1] === 1) up += 1;
        cost += ch.costs[k] * (b[k] - b[k + 1]);
      }
      const robot = up === 0 ? ch.robots[b.findIndex((v, k) => v === 1 && b[k + 1] === 0)] : null;
      rows.push({ bits, down, up, cost, pen: s.A * up, robot });
    }
    rows.sort((a, b) => a.cost + a.pen - (b.cost + b.pen));
    const bestValid = Math.min(...rows.filter((r) => r.up === 0).map((r) => r.cost));
    const cheats = rows.filter((r) => r.up > 0 && r.cost < bestValid);
    fill(host,
      el('div', { class: 'table-scroll' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Kette (1 | Bits | 0)'), el('th', { class: 'num' }, 'Wände ↓ / ↑'), el('th', {}, 'Roboter'),
          el('th', { class: 'num' }, `Kosten-Term [${unit(s)}]`), el('th', { class: 'num' }, 'Kettenstrafe A·↑'), el('th', { class: 'num' }, 'Summe'))),
        el('tbody', {}, rows.map((r) => el('tr', { class: r.up > 0 && r.cost < bestValid ? 'warnrow' : r.up > 0 ? 'dim' : '' },
          el('td', { class: 'mono' }, `1 | ${r.bits.join('')} | 0`), el('td', { class: 'num' }, `${r.down} / ${r.up}`),
          el('td', {}, r.robot ? `R${r.robot}` : '✗ ungültig'),
          el('td', { class: 'num' }, `${fmt(r.cost)}${r.up > 0 ? ' (Phantasiewert)' : ''}`), el('td', { class: 'num' }, fmt(r.pen)),
          el('td', { class: 'num' }, el('b', {}, fmt(r.cost + r.pen)))))))),
      el('p', { class: 'hint', html: cheats.length
        ? `<b>${cheats.length} ungültige Stellung(en)</b> haben einen Phantasiewert unter dem besten gültigen (${fmt(bestValid)}) – ohne Kettenregel wären sie das Minimum (orange markiert).
          Die Kettenregel muss mindestens die Spannweite der Kosten aufwiegen: ${fmt(Math.max(...ch.costs) - Math.min(...ch.costs))}.`
        : `Kein Phantasiewert liegt unter dem besten gültigen (${fmt(bestValid)}) – diese Kette wäre auch ohne Strafe ehrlich. Das ist Glück der Kostenreihenfolge, kein Prinzip.` }));
  }

  function drawSweep(s, key, div) {
    const n = form(s).n;
    if (n > SWEEP_MAX_BITS) {
      fill(div, el('p', { class: 'hint' }, `Bei ${n} Bits zu aufwendig – die Kurve wird bis ${SWEEP_MAX_BITS} Bits berechnet.`));
      div.style.minHeight = '0';
      return null;
    }
    const top = Math.max(100, Math.ceil((Math.max(s.A, s.B) * 2) / 10) * 10);
    const cacheKey = `${key}|${s.A}|${s.B}|${form(s).chains.map((c) => `${c.task_id}:${c.robots}`)}|${form(s).const.c}`;
    let pts = sweepCache.get(cacheKey);
    if (!pts) {
      pts = [];
      for (let k = 0; k <= 40; k += 1) {
        const val = Math.round((top * k) / 40);
        const m = makeModel(form(s), { A: key === 'A' ? val : s.A, B: key === 'B' ? val : s.B, terms: ALL });
        const r = search(m, 1);
        const x = fromMask(r.min.mask, n);
        pts.push({ val, E: r.min.E, valid: decodeChains(form(s), x).valid, desc: api.describe(x) });
      }
      sweepCache.set(cacheKey, pts);
    }
    // Gültigkeitsbereich: bei Domain Wall kann er auch nach oben begrenzt sein (zu großes B)
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
      hovertemplate: `${key} = %{x}: Minimum E = %{y}<br>%{customdata[0]}<br>%{customdata[1]}<extra></extra>`,
    }], {
      margin: { l: 52, r: 10, t: 34, b: 44 },
      xaxis: { title: { text: `Strafgewicht ${key} (${key === 'A' ? 'B' : 'A'} = ${fmt(key === 'A' ? s.B : s.A)} fest, alle Regeln an)` } },
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
