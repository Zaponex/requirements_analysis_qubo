// Ablaufplan als Gantt-Diagramm: so würden die Roboter bei einer Schalterstellung fahren.
// Farben wie die Roboterstatus in Zeitreise und Flottenzustand.
import { el, fill, nf } from '../util.js';
import { C, STATUS_COLORS, plot, rootFontPx } from '../theme.js';
import { sub } from '../qubo/schedule.js';

const fmt = (v) => nf(v, 1).replace('-', '−');
const SEG = [
  { label: 'Warten, bis der Roboter frei ist', color: C.axis },
  { label: 'Anfahrt (leer)', color: STATUS_COLORS.MOVING_TO_PICKUP },
  { label: 'Beladen / Entladen', color: STATUS_COLORS.LOADING },
  { label: 'Lastfahrt', color: STATUS_COLORS.MOVING_TO_DROP_OFF },
  { label: 'Entladen', color: STATUS_COLORS.LOADING, showlegend: false },
];
export const SEGMENTS = SEG;

/**
 * @param {HTMLElement} chartHost
 * @param {HTMLElement} noteHost  Kopfzeile mit Zielwert und Gültigkeit
 * @param {object} o  sched, x, label (Name des Ziels), value (Zielwert), unit
 */
export function renderGantt(chartHost, noteHost, { sched, x, label, value, unit = 's' }) {
  const dec = sched.decode(x);
  const sim = sched.simulate(dec.sequences);
  const robots = sched.usedRobots().map((r) => `R${r.robot_id}`);
  const traces = SEG.map((s) => ({ type: 'bar', orientation: 'h', name: s.label, x: [], base: [], y: [], text: [], customdata: [],
    showlegend: s.showlegend !== false,
    marker: { color: s.color, line: { color: C.surface, width: 1 } }, textposition: 'inside', insidetextanchor: 'middle',
    textfont: { color: C.ink }, hovertemplate: '%{customdata}<extra></extra>' }));
  const push = (k, row, start, dur, text, hover) => {
    if (dur <= 0) return;
    traces[k].x.push(dur); traces[k].base.push(start); traces[k].y.push(`R${row.robot}`); traces[k].text.push(text); traces[k].customdata.push(hover);
  };
  const annotations = [];
  for (const row of sim.rows) {
    let t = row.start;
    if (row.release > 0) push(0, row, 0, row.release, '', `R${row.robot} ist noch belegt: frei nach ${fmt(row.release)} s`);
    const from = row.from == null ? 'vom Standort' : `vom Abgabeort von #${row.from}`;
    push(1, row, t, row.setup.time, '', `#${row.task}: Anfahrt ${from} – ${fmt(row.setup.time)} s (${nf(row.setup.distance)} Felder)`); t += row.setup.time;
    push(2, row, t, row.load, '', `#${row.task}: Beladen ${fmt(row.load)} s`); t += row.load;
    push(3, row, t, row.loaded, `#${row.task}`, `#${row.task}: Lastfahrt ${fmt(row.loaded)} s`); t += row.loaded;
    push(4, row, t, row.unload, '', `#${row.task}: Entladen ${fmt(row.unload)} s · erledigt nach ${fmt(row.finish)} s`);
    // über dem Balken: Kategorie-Index minus halbe Balkendicke (Achse ist umgedreht)
    annotations.push({ x: row.finish, y: robots.indexOf(`R${row.robot}`) - 0.3, yanchor: 'bottom', xanchor: 'right', showarrow: false,
      text: `C${sub(row.task)} = ${fmt(row.finish)} s`, font: { size: Math.round(rootFontPx() * 0.72), color: C.ink2 } });
  }
  const h = Math.round((robots.length * 74 + 110) * (rootFontPx() / 15));
  plot(chartHost, traces, {
    barmode: 'overlay', height: h, bargap: 0.5, showlegend: true,
    yaxis: { type: 'category', categoryarray: robots, categoryorder: 'array', autorange: 'reversed', showgrid: false, ticks: '' },
    xaxis: { title: { text: 'Sekunden ab dem Snapshot' }, rangemode: 'tozero' },
    legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0 },
    annotations,
    margin: { t: 60 },
  });
  fill(noteHost, el('div', { class: 'etotal' },
    el('div', {}, el('div', { class: 'hint' }, label), el('div', { class: 'ebig' }, `${fmt(value ?? sim.total)} ${unit}`)),
    el('div', { class: 'erank' },
      el('div', {}, sched.describeSeq(dec.sequences)),
      el('div', { class: dec.valid ? 'okline' : 'warnline' }, dec.valid ? '✓ gültiger Ablaufplan'
        : `✗ ${dec.issues.map((i) => i.text).join(' · ')} – gezeigt ist die Reihenfolge nach Platznummer`))));
  return { dec, sim };
}
