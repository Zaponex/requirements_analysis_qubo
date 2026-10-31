// Schachbrett mit Plätzen: Zeile = Auftrag, Spaltengruppe = Roboter, Spalte = Platz q in Fahrreihenfolge.
// Zeigt je Zeile, Platz und Roboter, ob die echten Anforderungen erfüllt sind. Klick schaltet ein Bit.
import { el, fill, nf, withTip, tipHtml } from '../util.js';
import { statusColor } from '../theme.js';
import { SLOT_NAME } from '../qubo/schedule.js';
import { shortName } from './scenario.js';

const fmt = (v) => nf(v, 1).replace('-', '−');

/**
 * @param {HTMLElement} host
 * @param {object} o  sched (createSchedule), x, onToggle(i), cellValue(i) → Zahl in der Zelle, cellTip(i) → HTML
 */
export function renderSlotBoard(host, { sched, x, onToggle, cellValue, cellTip }) {
  const d = sched.instance;
  const vars = sched.vars;
  const K = d.slots;
  const idx = new Map(vars.map((v, i) => [`${v.task_id}|${v.robot_id}|${v.slot}`, i]));
  const cols = sched.slotColumns();
  const robots = sched.usedRobots();
  const dec = sched.decode(x);
  const onCount = (r, q) => vars.filter((v, i) => v.robot_id === r && v.slot === q && x[i]).length;
  const hidden = d.robots.filter((r) => !robots.includes(r));
  const table = el('table', { class: 'board seq' },
    el('thead', {},
      el('tr', {}, el('th', { class: 'corner', rowspan: K > 1 ? 2 : 1 }, K > 1 ? 'Auftrag ╲ Roboter · Platz' : 'Auftrag ╲ Roboter'),
        robots.map((r) => el('th', { colspan: K, class: 'grp', 'data-robot': r.robot_id }, el('div', {}, `R${r.robot_id}`),
          el('div', { class: 'hint' }, el('span', { class: 'dot-inline', style: { background: statusColor(r.status) } }),
            r.available ? ' frei' : ` belegt · frei nach ${fmt(r.release)} s`))),
        el('th', { rowspan: K > 1 ? 2 : 1 }, 'Σ Zeile')),
      K > 1 ? el('tr', {}, cols.map((c) => el('th', { class: c.first ? 'grp' : '', 'data-robot': c.robot, 'data-slot': c.slot },
        el('div', {}, `q = ${c.slot}`), el('div', { class: 'hint' }, SLOT_NAME[c.slot] || '')))) : null),
    el('tbody', {}, d.tasks.map((t) => {
      const on = vars.filter((v, i) => v.task_id === t.transport_id && x[i]).length;
      return el('tr', {},
        el('th', { class: 'rowhead', 'data-task': t.transport_id }, el('div', {}, `#${t.transport_id}`),
          el('div', { class: 'hint' }, `${shortName(t.from_entity)} → ${shortName(t.to_entity)}`)),
        cols.map((c) => {
          const i = idx.get(`${t.transport_id}|${c.robot}|${c.slot}`);
          if (i == null) {
            return withTip(el('td', { class: `cell compact none${c.first ? ' grp' : ''}`, 'data-task': t.transport_id, 'data-robot': c.robot }, '–'),
              tipHtml(`Kein Schalter für R${c.robot} → #${t.transport_id}`, ['Roboter ist nicht zuständig für diesen Bereich']));
          }
          const v = vars[i];
          const b = el('button', { class: `cell compact switch${x[i] ? ' on' : ''}`, type: 'button', 'data-var': i, 'data-task': v.task_id,
            'data-robot': v.robot_id, 'data-slot': v.slot, 'aria-pressed': String(Boolean(x[i])), 'aria-label': `${sched.varLabel(i)} umschalten` },
          el('span', { class: 'bit' }, x[i] ? '1' : '0'),
          el('span', { class: 'var' }, sched.varLabel(i)),
          el('span', { class: 'cost' }, nf(cellValue(i), 1)));
          if (cellTip) withTip(b, () => cellTip(i));
          b.addEventListener('click', () => onToggle(i));
          return el('td', { class: c.first ? 'grp' : '' }, b);
        }),
        el('td', { class: `sum row-sum ${on === 1 ? 'good' : 'bad'}`, 'data-task': t.transport_id }, `${on} ${on === 1 ? '✓' : '✗'}`));
    })),
    el('tfoot', {},
      el('tr', {}, el('th', {}, K > 1 ? 'Σ Platz' : 'Σ Spalte'), cols.map((c) => {
        const on = onCount(c.robot, c.slot);
        const gapHere = c.slot < K && on === 0 && onCount(c.robot, c.slot + 1) > 0;
        const ok = (K === 1 || on <= 1) && !gapHere; // K = 1: Doppelbelegung zulässig
        return el('td', { class: `sum col-sum ${ok ? 'good' : 'bad'}${c.first ? ' grp' : ''}`, 'data-robot': c.robot, 'data-slot': c.slot },
          gapHere ? '0 ✗ Lücke' : `${on} ${ok ? '✓' : '✗'}`);
      }), el('td')),
      K > 1 ? el('tr', {}, el('th', {}, 'Fahrt'), robots.map((r) => {
        const seq = dec.sequences.get(r.robot_id);
        return el('td', { colspan: K, class: 'seq-cell grp' }, seq ? seq.map((t) => `#${t}`).join(' → ') : '–');
      }), el('td')) : null));
  fill(host, el('div', { class: 'table-wrap' }, table),
    hidden.length ? el('p', { class: 'hint' }, `Ohne Schalter (belegt oder nicht zuständig): ${hidden.map((r) => `R${r.robot_id}`).join(', ')} – Modus „alle Roboter“ nimmt sie dazu.`) : null);
}
