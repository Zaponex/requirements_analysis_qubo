// Bit-Brett des Formel-Baukastens: je Auftrag ein Block Bits in seiner Kodierung (One-Hot, Domain Wall,
// Binary – je Zeile umschaltbar), daneben die Lesart „welche Option?“. Darunter die Belegung je Roboter-Platz
// und die Hilfsbits. Ein Klick schaltet ein Bit; bei Binary lädt ein Klick ins Codebuch den Code.
import { el, fill, nf, withTip, tipHtml } from '../util.js';
import { statusColor } from '../theme.js';
import { sub } from '../qubo/schedule.js';
import { ENC_LABEL } from '../qubo/encoding.js';
import { shortName } from './scenario.js';

const fmt = (v) => nf(v, 1).replace('-', '−');
const signed = (v) => (v > 0 ? `+${fmt(v)}` : fmt(v));

/**
 * @param {HTMLElement} host
 * @param {object} o  enc (createEncoding), sched, x, onToggle(i), onOption(block, option), onCode(block, code),
 *   onEncoding(taskId, name), bitValue(i) → Zahl im Bit, bitTip(i) → HTML, honest, onHonest(bool)
 */
export function renderBlockBoard(host, { enc, sched, x, onToggle, onOption, onCode, onEncoding, bitValue, bitTip, honest, onHonest }) {
  const inst = sched.instance;
  const y = enc.indicators(x);
  const bitButton = (i, extraClass = '', small = null) => {
    const b = el('button', { class: `cell dw-bit switch${x[i] ? ' on' : ''}${extraClass}`, type: 'button', 'data-var': i,
      'aria-pressed': String(Boolean(x[i])), 'aria-label': `${enc.bitLabel(i)} umschalten` },
    el('span', { class: 'bit' }, x[i] ? '1' : '0'), el('span', { class: 'var' }, enc.bitLabel(i)),
    el('span', { class: 'cost' }, small ?? signed(bitValue(i))));
    if (bitTip) withTip(b, () => bitTip(i));
    b.addEventListener('click', () => onToggle(i));
    return b;
  };

  const rows = enc.blocks.map((b) => {
    const t = sched.taskOf(b.task_id);
    const read = enc.readBlock(b, x, y);
    const sel = el('select', { class: 'blk-enc', 'aria-label': `Kodierung von #${b.task_id}` },
      Object.entries(ENC_LABEL).map(([k, label]) => el('option', { value: k }, label)));
    sel.value = b.encoding;
    sel.addEventListener('change', () => onEncoding(b.task_id, sel.value));
    const head = el('div', { class: 'dw-head', 'data-task': b.task_id },
      el('div', {}, el('strong', {}, `#${b.task_id}`), ' ', sel),
      el('div', { class: 'hint' }, `${shortName(t.from_entity)} → ${shortName(t.to_entity)} · ${b.nb} Bit${b.nb === 1 ? '' : 's'}`));
    let body;
    if (!b.options.length) body = el('div', { class: 'hint' }, 'keine Option – kein Roboter kommt in Frage');
    else if (b.encoding === 'one_hot') {
      body = el('div', { class: 'bin-bits' }, b.bits.map((i) => bitButton(i)));
    } else if (b.encoding === 'domain_wall') {
      const parts = [el('span', { class: 'dw-fixed' }, '1')];
      b.options.forEach((o, k) => {
        const d = y[o];
        parts.push(withTip(el('span', { class: `dw-gap${d === 1 ? ' wall' : d < 0 ? ' wall bad' : ''}`, 'data-task': b.task_id },
          el('span', { class: 'dw-robot' }, enc.optLabel(o)),
          el('span', { class: 'dw-delta' }, `δ = ${d < 0 ? '−1' : d}`)),
        tipHtml(`${enc.optLong(o)} für #${b.task_id}`, [`δ = ${k === 0 ? '1' : `b${sub(k)}`} − ${k === b.options.length - 1 ? '0' : `b${sub(k + 1)}`} = ${d}`,
          d === 1 ? '<b>Wand 1 → 0: diese Option ist gewählt</b>' : d < 0 ? '<b>falsche Wand 0 → 1</b>' : 'keine Wand'])));
        if (k < b.bits.length) parts.push(bitButton(b.bits[k]));
      });
      parts.push(el('span', { class: 'dw-fixed zero' }, '0'));
      body = el('div', { class: 'dw-chain' }, parts);
    } else {
      const code = read.code;
      body = el('div', { class: 'blk-bin' },
        el('div', { class: 'bin-bits' }, b.nb ? b.bits.map((i, j) => bitButton(i, '', `×${2 ** (b.nb - 1 - j)}`)) : el('span', { class: 'hint' }, '0 Bits – nur eine Option')),
        el('div', { class: 'bin-book' }, b.codes.map((c) => {
          const chip = el('button', { class: `bin-chip${c.code === code ? ' current' : ''}${c.option == null ? ' phantom' : ''}`, type: 'button', title: 'Code laden' },
            el('span', { class: 'mono' }, c.pattern || '–'), el('span', {}, c.option != null ? enc.optLabel(c.option) : 'Phantom'));
          chip.addEventListener('click', () => onCode(b, c.code));
          return chip;
        })));
    }
    const result = el('div', { class: `dw-result ${read.ok ? 'good' : 'bad'}` }, read.text);
    if (b.encoding === 'one_hot' && b.options.length) {
      result.append(el('div', { class: 'blk-pick' }, b.options.map((o) => {
        const p = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(read.ok && read.chosen[0] === o), title: 'nur diese Option an' }, enc.optLabel(o));
        p.addEventListener('click', () => onOption(b, o));
        return p;
      })));
    }
    return el('div', { class: 'blk-row' }, head, body, result);
  });

  // Belegung je Roboter-Platz: Σ der Indikatoren aller Aufträge
  const K = sched.K;
  const robots = sched.usedRobots();
  const count = (r, q) => sched.vars.reduce((s, v, o) => s + (v.robot_id === r && v.slot === q ? y[o] : 0), 0);
  const usage = el('div', { class: 'dw-usage' }, el('span', { class: 'filter-label' }, K > 1 ? 'Σ I je Roboter-Platz' : 'Σ I je Roboter'),
    robots.flatMap((r) => Array.from({ length: K }, (_, k) => K - k).map((q) => {
      const n = count(r.robot_id, q);
      const gap = q < K && n === 0 && count(r.robot_id, q + 1) > 0;
      const good = (K === 1 || n <= 1) && n >= 0 && !gap; // K = 1: Doppelbelegung zulässig
      return el('span', { class: `sum col-sum ${good ? 'good' : 'bad'}`, 'data-robot': r.robot_id },
        el('span', { class: 'dot-inline', style: { background: statusColor(r.status) } }),
        ` ${K > 1 ? `R${r.robot_id}·${q}` : `R${r.robot_id}`}: ${nf(n)} ${gap ? '✗ Lücke' : good ? '✓' : '✗'}`);
    })));

  const auxEl = enc.form.aux.length
    ? el('div', { class: 'bin-aux' },
      el('div', { class: 'filter-label' }, `Hilfsbits (${enc.form.aux.length}):`),
      enc.form.aux.map((a) => {
        const honestVal = x[a.pair[0]] * x[a.pair[1]];
        const lies = x[a.index] !== honestVal;
        const b = bitButton(a.index, lies ? ' lie' : '', lies ? 'lügt!' : '✓');
        withTip(b, () => tipHtml(`${enc.bitLabel(a.index)} soll ${enc.bitLabel(a.pair[0])}·${enc.bitLabel(a.pair[1])} sein`,
          [`${enc.bitLabel(a.pair[0])}·${enc.bitLabel(a.pair[1])} = ${x[a.pair[0]]}·${x[a.pair[1]]} = ${honestVal}`,
            lies ? '<b>lügt – kostet M · Strafe, die Energie stimmt nicht mehr mit dem Polynom</b>' : 'ehrlich – kostet nichts',
            `ersetzt das Paar in ${a.replaced} Term(en) vom Grad > 2`]));
        return el('span', { class: 'bin-aux-item' }, b, el('span', { class: 'hint' }, `= ${enc.bitLabel(a.pair[0])}·${enc.bitLabel(a.pair[1])}`));
      }),
      (() => {
        const box = el('input', { type: 'checkbox', checked: honest });
        box.addEventListener('change', () => onHonest(box.checked));
        return el('label', { class: 'filter-group' }, box, el('span', { class: 'hint' }, 'beim Klicken ehrlich halten'));
      })())
    : null;
  const hidden = inst.robots.filter((r) => !robots.includes(r));
  fill(host, el('div', { class: 'dw-board' }, rows), usage, auxEl,
    hidden.length ? el('p', { class: 'hint' }, `Ohne Option (belegt oder nicht zuständig): ${hidden.map((r) => `R${r.robot_id}`).join(', ')} – Modus „alle Roboter“ nimmt sie dazu.`) : null);
}
