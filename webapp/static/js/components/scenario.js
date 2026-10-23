// Szenario-Auswahl der Kodierungsseiten: Welche echten Aufträge kommen in die Lern-Instanz?
// Der Zustand {start, window, selected, mode} gehört der Seite – die Auswahl verändert ihn und ruft load().
import { el, fill, nf } from '../util.js';
import { C, areaColor, areaLabel } from '../theme.js';

export const WINDOWS = [0, 30, 60, 120];
export const MAX_SELECTED = 6;

/** Aufträge ab einer Start-Anfrage (Liste ist nach Zeit sortiert) bis Startzeit + Fenster. */
export function windowTasks(tasks, startId, w) {
  const k = tasks.findIndex((t) => t.transport_id === startId);
  const t0 = tasks[k].time;
  const out = [];
  for (let i = k; i < tasks.length && tasks[i].time <= t0 + w; i += 1) out.push(tasks[i]);
  return out;
}

/** Startzustand: die ersten Aufträge des Laufs – oder die Aufträge aus dem Link (?auftraege=1,2,3). */
export function initialScenario(tasks, params, count = 2) {
  const st = { start: tasks[0].transport_id, window: 0, selected: [] };
  st.selected = windowTasks(tasks, st.start, 0).slice(0, count).map((t) => t.transport_id);
  const linked = String(params.auftraege || '').split(',').map(Number).filter((id) => tasks.some((t) => t.transport_id === id));
  if (linked.length) {
    st.selected = [...new Set(linked)].slice(0, MAX_SELECTED).sort((a, b) => a - b);
    st.start = st.selected[0];
    const t0 = tasks.find((t) => t.transport_id === st.start).time;
    st.window = WINDOWS.find((w) => st.selected.every((id) => tasks.find((t) => t.transport_id === id).time <= t0 + w)) ?? 120;
  }
  return st;
}

/**
 * Zeichnet Beispiele, Start-Anfrage, Zeitfenster, Auftragsliste und Modus.
 * @param {HTMLElement} host
 * @param {object} o  tasks, st (wird verändert), load(), error, note (Hinweistext), extra (weitere Bedienelemente)
 */
export function renderScenario(host, o) {
  const { tasks, st, load } = o;
  const redraw = () => renderScenario(host, o);
  const setScenario = (startId, w, ids) => {
    st.start = startId;
    st.window = w;
    st.selected = ids.length ? ids : [startId];
    load();
  };

  const startSel = el('select', { 'aria-label': 'Start-Anfrage' }, tasks.map((t) => el('option', { value: t.transport_id },
    `#${t.transport_id} · t = ${nf(t.time)} s`)));
  startSel.value = String(st.start);
  startSel.addEventListener('change', () => {
    st.start = Number(startSel.value);
    st.selected = windowTasks(tasks, st.start, st.window).slice(0, 2).map((t) => t.transport_id);
    load();
  });
  const winSel = el('select', { 'aria-label': 'Zeitfenster' }, WINDOWS.map((w) => el('option', { value: w }, w === 0 ? 'nur gleicher Zeitpunkt' : `+ ${w} s`)));
  winSel.value = String(st.window);
  winSel.addEventListener('change', () => { st.window = Number(winSel.value); redraw(); });

  const list = el('div', { class: 'task-pick' }, windowTasks(tasks, st.start, st.window).slice(0, 10).map((t) => {
    const box = el('input', { type: 'checkbox', checked: st.selected.includes(t.transport_id) });
    box.addEventListener('change', () => {
      const set = new Set(st.selected);
      if (box.checked) set.add(t.transport_id); else set.delete(t.transport_id);
      if (set.size === 0 || set.size > MAX_SELECTED) { box.checked = !box.checked; return; }
      st.selected = [...set].sort((a, b) => a - b);
      load();
    });
    return el('label', { class: 'task-row' }, box,
      el('strong', {}, `#${t.transport_id}`),
      el('span', { class: 'tag' }, el('span', { class: 'swatch', style: { background: t.task_area ? areaColor(t.task_area) : C.ink2 } }), t.task_area ? areaLabel(t.task_area) : 'ohne Bereich'),
      el('span', { class: 'hint' }, `t = ${nf(t.time)} s · ${shortName(t.from_entity)} → ${shortName(t.to_entity)}`));
  }));

  const modeBox = el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Schalter für'),
    ...[['kandidaten', 'nur freie Roboter'], ['alle', 'alle Roboter']].map(([v, label]) => {
      const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(st.mode === v) }, label);
      b.addEventListener('click', () => { st.mode = v; load(); });
      return b;
    }));
  const presetButton = (label, title, fn) => el('button', { class: 'btn small', type: 'button', title, onclick: fn }, label);
  const first = tasks[0].transport_id;
  const presets = el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Beispiele'),
    presetButton('Kapitel-Beispiel', 'Aufträge #1 und #2 bei t = 0 – wie im Lesekapitel', () => setScenario(first, 0, [1, 2])),
    presetButton('Mehr Aufträge als Roboter', 'Alle Anfragen bei t = 0 (bis zu 5)', () => setScenario(first, 0, windowTasks(tasks, first, 0).slice(0, 5).map((t) => t.transport_id))),
    presetButton('Zufälliger Moment', 'Ein zufälliger Zeitpunkt mit bis zu 3 Aufträgen in 60 s', () => {
      const t = tasks[Math.floor(Math.random() * tasks.length)];
      setScenario(t.transport_id, 60, windowTasks(tasks, t.transport_id, 60).slice(0, 3).map((x) => x.transport_id));
    }));

  fill(host,
    presets,
    el('div', { class: 'filter-group', style: { margin: '10px 0 6px' } }, el('span', { class: 'filter-label' }, 'Ab Anfrage'), startSel,
      el('span', { class: 'filter-label' }, 'Fenster'), winSel),
    list,
    el('div', { style: { marginTop: '8px' } }, modeBox),
    o.extra || null,
    o.note ? el('p', { class: 'hint' }, o.note) : null,
    o.error ? el('div', { class: 'error' }, o.error) : null);
}

/** Kurzname einer Entität für enge Stellen: „Ma: Verblisterung:1202“ → „Verbli. 1202“. */
export function shortName(entity) {
  const s = String(entity);
  if (s.startsWith('IntermediateStore')) return `ZL ${s.split(':').pop().trim()}`;
  if (s.startsWith('Source')) return 'Quelle';
  if (s.startsWith('Sink')) return 'Senke';
  const parts = s.split(':').map((p) => p.trim());
  return parts.length === 3 ? `${parts[1].slice(0, 6)}. ${parts[2]}` : s;
}
