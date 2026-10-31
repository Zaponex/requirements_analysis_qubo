// Gemeinsame Bausteine der Seiten „Kodierungen IA“: Robotermenge R wählen, Fallkarten T = R, T < R, T > R
// und der Fallwechsel (zuerst R anpassen, sonst die Aufträge).
import { el, fill } from '../util.js';
import { statusColor, statusLabel } from '../theme.js';
import { MAX_SELECTED, WINDOWS } from './scenario.js';

export const CASE_ORDER = ['T=R', 'T<R', 'T>R'];
export const CASE_LABELS = { 'T=R': 'T = R', 'T<R': 'T < R', 'T>R': 'T > R' };
export const CASE_TEXTS = { 'T=R': 'gleich viele Aufträge wie Roboter', 'T<R': 'mehr Roboter als Aufträge', 'T>R': 'mehr Aufträge als Roboter' };

/** Chips für die Robotermenge R (belegte nur mit „alle Roboter“ wählbar). */
export function robotPicker(instance, mode, onToggle) {
  return el('div', { class: 'filter-group', style: { marginTop: '8px' } }, el('span', { class: 'filter-label' }, 'Roboter R'),
    instance.fleet.map((r) => {
      const usable = mode === 'alle' || r.available;
      const inR = instance.robots.some((x) => x.robot_id === r.robot_id);
      const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(inR), disabled: !usable,
        title: usable ? (inR ? 'aus R nehmen' : 'zu R hinzufügen') : `belegt (${statusLabel(r.status)}) – wählbar mit „alle Roboter“` },
      el('span', { class: 'swatch', style: { background: statusColor(r.status) } }), `R${r.robot_id}${r.available ? '' : ' · belegt'}`);
      b.addEventListener('click', () => onToggle(r.robot_id));
      return b;
    }));
}

/** Neue Robotermenge nach einem Klick auf einen Roboter – null, wenn sonst keiner übrig bliebe. */
export function toggledRobots(current, id) {
  const cur = new Set(current);
  if (cur.has(id)) cur.delete(id); else cur.add(id);
  return cur.size ? [...cur].sort((a, b) => a - b) : null;
}

/**
 * Fall wechseln: zuerst R anpassen (Auswahl behalten, auffüllen oder kürzen), sonst die Aufträge.
 * Ändert st.robots bzw. st.selected/st.window; liefert einen Hinweis, wenn der Fall nicht erreichbar ist.
 */
export function applyCase(key, { st, tasks, robotIds, pool }) {
  const T = st.selected.length;
  const R = robotIds.length;
  const wantR = key === 'T=R' ? T : key === 'T<R' ? T + 1 : T - 1;
  if (wantR >= 1 && wantR <= pool.length) {
    st.robots = [...robotIds, ...pool.filter((id) => !robotIds.includes(id))].slice(0, wantR).sort((a, b) => a - b);
    return '';
  }
  const wantT = key === 'T=R' ? R : key === 'T<R' ? R - 1 : R + 1;
  if (wantT < 1 || wantT > MAX_SELECTED) return `${CASE_LABELS[key]} geht hier nicht: ${pool.length} Roboter verfügbar, höchstens ${MAX_SELECTED} Aufträge.`;
  const k = tasks.findIndex((t) => t.transport_id === st.start);
  const next = tasks.slice(k).map((t) => t.transport_id).filter((id) => !st.selected.includes(id));
  st.selected = [...st.selected, ...next].slice(0, wantT).sort((a, b) => a - b);
  const t0 = tasks[k].time;
  st.window = WINDOWS.find((w) => st.selected.every((id) => tasks.find((t) => t.transport_id === id).time <= t0 + w)) ?? 120;
  return '';
}

/** Die drei Fälle als Karten – der aktuelle ist markiert. termsHtml(key) zeigt die Strafterme der Kodierung. */
export function renderCaseCards(host, { cur, T, R, termsHtml, note, onPick }) {
  fill(host,
    el('span', { class: 'filter-label' }, `Fall · T = ${T}, R = ${R}`),
    CASE_ORDER.map((k) => {
      const b = el('button', { class: `case-btn${k === cur ? ' current' : ''}`, type: 'button', 'aria-pressed': String(k === cur),
        title: k === cur ? 'aktueller Fall' : `umstellen auf ${CASE_LABELS[k]} – Roboter bzw. Aufträge werden angepasst` },
      el('span', { class: 'case-label' }, CASE_LABELS[k]),
      el('span', { class: 'case-terms', html: termsHtml(k) }),
      el('span', { class: 'hint' }, CASE_TEXTS[k]));
      if (k !== cur) b.addEventListener('click', () => onPick(k));
      return b;
    }),
    note ? el('span', { class: 'warnline' }, note) : null);
}
