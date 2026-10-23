// Ansicht „Lauf-Vergleich“: Kennzahlen aller Läufe nebeneinander.
import { el, nf, pct } from '../util.js';
import { C, plot } from '../theme.js';
import { card, renderTable } from '../components/card.js';

const METRICS = [
  { key: 'n_requests', label: 'Anfragen', fmt: (v) => nf(v) },
  { key: 'duration_s', label: 'Dauer (min)', fmt: (v) => nf(v / 60, 1), value: (v) => v / 60 },
  { key: 'n_robots', label: 'Roboter', fmt: (v) => nf(v) },
  { key: 'n_machines', label: 'Maschinen', fmt: (v) => nf(v) },
  { key: 'mean_eligible', label: 'Ø Kandidaten', fmt: (v) => nf(v, 2) },
  { key: 'share_zero_eligible', label: 'Anteil ohne Kandidat', fmt: (v) => pct(v), value: (v) => v * 100 },
  { key: 'max_requests_same_time', label: 'max. gleichzeitig', fmt: (v) => nf(v) },
  { key: 'req_per_60s_max', label: 'max. pro 60 s', fmt: (v) => nf(v) },
  { key: 'path_median', label: 'Pfadlänge Median', fmt: (v) => nf(v) },
  { key: 'n_distinct_aor', label: 'Zuständigkeitsprofile', fmt: (v) => nf(v) },
  { key: 'n_warnings', label: 'Warnungen', fmt: (v) => nf(v) },
  // nur bei Logs mit Lebenslauf (ASSIGNED/COMPLETED/…); ältere Läufe zeigen „–“
  { key: 'n_completed', label: 'Abgeschlossen', fmt: (v) => nf(v) },
  { key: 'n_aborted', label: 'Abgebrochen', fmt: (v) => nf(v) },
  { key: 'mean_wait_until_assigned', label: 'Ø Wartezeit bis Zuweisung (s)', fmt: (v) => nf(v, 1) },
  { key: 'mean_lead_time', label: 'Ø Durchlaufzeit (s)', fmt: (v) => nf(v, 1) },
];

export function renderCompare(root, { runs, run, selectRun }) {
  const ok = runs.filter((r) => !r.error);
  root.append(el('p', {
    class: 'intro',
    html: `Jeder Simulationslauf in einer Zeile. Mit mehr Läufen siehst du hier, wie sich Flottengröße, Last und
      Konkurrenz um Roboter unterscheiden – die Grundlage, um später Problemklassen zu bilden.
      Klicke auf eine Zeile, um den Lauf auszuwählen.`,
  }));
  if (ok.length < 2) {
    root.append(el('p', { class: 'hint' }, 'Bisher gibt es nur einen auswertbaren Lauf. Sobald weitere Dateipaare im Datenordner liegen, erscheinen sie hier automatisch.'));
  }

  const table = renderTable({
    columns: [{ key: 'run_id', label: 'Lauf' }, ...METRICS.map((m) => ({ key: m.key, label: m.label, num: true, fmt: m.fmt }))],
    rows: ok,
    onRowClick: (r) => selectRun(r.run_id),
    rowClass: (r) => (r.run_id === run.run_id ? 'selected' : ''),
  });
  root.append(card({ title: 'Kennzahlen je Lauf', subtitle: `${ok.length} Lauf/Läufe`, body: table }));

  const failed = runs.filter((r) => r.error);
  if (failed.length) {
    root.append(card({ title: 'Nicht lesbare Läufe', body: el('ul', { class: 'plain' }, failed.map((r) => el('li', {}, `${r.run_id}: ${r.error}`))) }));
  }

  const select = el('select', { 'aria-label': 'Kennzahl' }, METRICS.map((m) => el('option', { value: m.key }, m.label)));
  select.value = 'mean_eligible';
  const chartDiv = el('div', { class: 'chart' });
  const draw = () => {
    const m = METRICS.find((x) => x.key === select.value);
    const vals = ok.map((r) => (m.value ? m.value(r[m.key]) : r[m.key]));
    plot(chartDiv, [{
      type: 'bar', x: ok.map((r) => r.run_id), y: vals, width: ok.length < 4 ? 0.3 : undefined,
      marker: { color: ok.map((r) => (r.run_id === run.run_id ? C.series : C.axis)) },
      text: ok.map((r) => m.fmt(r[m.key])), textposition: 'outside', cliponaxis: false,
      hovertemplate: `%{x}<br>${m.label}: %{text}<extra></extra>`,
    }], { xaxis: { type: 'category', title: { text: 'Lauf' } }, yaxis: { title: { text: m.label } } });
  };
  select.addEventListener('change', draw);
  root.append(el('div', { style: { height: '16px' } }));
  root.append(card({
    title: 'Eine Kennzahl über alle Läufe',
    subtitle: 'Der ausgewählte Lauf ist blau hervorgehoben',
    actions: [select],
    body: chartDiv,
  }));
  draw();
}
