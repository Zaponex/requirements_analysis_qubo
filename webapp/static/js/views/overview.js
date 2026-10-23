// Ansicht „Überblick“: Kennzahlen, Kandidatenmengen, Datenqualität, Annahmen.
import { el, nf, pct } from '../util.js';
import { C, plot } from '../theme.js';
import { card, kpi } from '../components/card.js';

export function renderOverview(root, { run, dataDir }) {
  const s = run.summary;
  const warnings = run.findings.filter((f) => f.level === 'Warnung');
  const infos = run.findings.filter((f) => f.level !== 'Warnung');

  root.append(el('p', {
    class: 'intro',
    html: `Ein Simulationslauf besteht aus zwei Dateien: <strong>Transportanfragen</strong> (wer will was von wo nach wo?) und
      <strong>Flotten-Snapshots</strong> (wo steht welcher Roboter, ist er frei?) – jeweils zum Zeitpunkt einer Anfrage.
      Hier die wichtigsten Kennzahlen von Lauf <code>${run.run_id}</code>. Fahre über das <span class="info-dot">i</span>
      für eine Erklärung.`,
  }));

  root.append(el('div', { class: 'kpis' },
    kpi('Transportanfragen', nf(s.n_requests), `in ${nf(s.duration_s / 60, 1)} min Simulationszeit`,
      'Anzahl Zeilen in transport_events – jede Zeile ist eine Anfrage, einen Transport auszuführen.'),
    kpi('Roboter', nf(s.n_robots), `${s.n_distinct_aor} Zuständigkeitsprofil${s.n_distinct_aor === 1 ? '' : 'e'}`,
      'Anzahl Roboter in den Flotten-Snapshots. Ein Zuständigkeitsprofil ist eine Menge von Bereichen, für die ein Roboter fahren darf.'),
    kpi('Entitäten', nf(s.n_entities), `${s.n_machines} Maschinen in ${s.n_machine_areas} Bereichen`,
      'Orte, zwischen denen transportiert wird: Maschinen, Zwischenlager, Quelle und Senke.'),
    kpi('Ø Kandidaten je Anfrage', nf(s.mean_eligible, 2), `von ${s.n_robots} Robotern`,
      'Wie viele Roboter beim Eingang einer Anfrage verfügbar und zuständig waren. Das ist die Zahl der Wahlmöglichkeiten, die später ein Optimierer pro Auftrag hat.'),
    kpi('Anfragen ohne Kandidat', pct(s.share_zero_eligible), `${s.candidates_0} Anfragen`,
      'In diesen Momenten war kein Roboter frei – die Anfrage musste warten. Ein Hinweis auf Stau in der Flotte.'),
    kpi('Max. gleichzeitig', nf(s.max_requests_same_time), `bis ${s.req_per_60s_max} Anfragen pro 60 s`,
      'Größte Zahl Anfragen mit identischem Zeitstempel. Gleichzeitige Anfragen konkurrieren um dieselben Roboter.'),
    kpi('Pfadlänge (Median)', nf(s.path_median), `Ø ${nf(s.path_mean, 1)} · max ${nf(s.path_max)} Schritte`,
      'Länge des kürzesten Pfads vom Abholort zum Ziel laut Simulation. Sentinel-Werte (unerreichbar) sind ausgeschlossen.'),
    kpi('Datenqualität', `${warnings.length} ⚠`, `${infos.length} weitere Hinweise`,
      'Automatische Prüfungen der Rohdaten – Details unten.'),
    // Lebenslauf-Kennzahlen – nur bei Logs mit ASSIGNED/COMPLETED/ABORTED
    s.has_lifecycle ? kpi('Abgeschlossen', `${s.n_completed} / ${s.n_requests}`, `${s.n_aborted} abgebrochen · ${s.n_open} offen`,
      'Aus den Lifecycle-Events: Wie viele Anfragen wurden in der Simulation erledigt, abgebrochen oder waren am Ende noch offen?') : null,
    s.has_lifecycle ? kpi('Ø Wartezeit bis Zuweisung', `${nf(s.mean_wait_until_assigned, 1)} s`, 'REQUESTED → ASSIGNED',
      'Wie lange eine Anfrage im Schnitt warten musste, bis ein Roboter oder Werker zugewiesen wurde.') : null,
    s.has_lifecycle ? kpi('Ø Durchlaufzeit', `${nf(s.mean_lead_time, 1)} s`, 'REQUESTED → COMPLETED',
      'Zeit von der Anfrage bis zur Ablieferung, gemittelt über die abgeschlossenen Aufträge.') : null,
    s.has_lifecycle && s.n_by_other_agents ? kpi('Durch Werker erledigt', nf(s.n_by_other_agents), 'nicht in den Flotten-Snapshots',
      'Aufträge, die Agenten außerhalb der Roboterflotte (Worker) übernommen haben.') : null,
  ));

  // Kandidatenmengen
  const sizes = Object.keys(s).filter((k) => k.startsWith('candidates_')).map((k) => ({
    n: Number(k.split('_')[1]), count: s[k],
  })).sort((a, b) => a.n - b.n);
  const chartDiv = el('div', { class: 'chart' });
  const candCard = card({
    title: 'Wie viele Roboter kamen in Frage?',
    subtitle: 'Anzahl Anfragen je Größe der Kandidatenmenge (verfügbar und zuständig)',
    body: chartDiv,
    table: () => ({ columns: [{ key: 'n', label: 'Kandidaten', num: true }, { key: 'count', label: 'Anfragen', num: true }], rows: sizes }),
  });

  const findingList = el('ul', { class: 'findings' }, [...warnings, ...infos].map((f) => el('li', {
    class: `finding ${f.level === 'Warnung' ? 'warn' : 'info'}`,
  },
  el('span', { class: 'icon', 'aria-hidden': 'true' }, f.level === 'Warnung' ? '⚠' : 'ℹ'),
  el('div', {},
    el('div', { class: 'finding-title' }, `${f.level === 'Warnung' ? 'Warnung' : 'Hinweis'}: ${f.title}`),
    f.detail ? el('div', { class: 'finding-detail', html: f.detail.replace(/`([^`]+)`/g, '<code>$1</code>') }) : null))));

  root.append(el('div', { class: 'grid grid-2' },
    candCard,
    card({ title: 'Datenqualität', subtitle: 'Automatische Prüfungen der Rohdaten (wie im PNG-Bericht)', body: findingList }),
    card({ title: 'Annahmen', subtitle: 'So werden die Rohdaten interpretiert – gilt für alle Ansichten',
      body: el('ul', { class: 'plain' }, run.assumptions.map((a) => el('li', {}, a))) }),
    card({ title: 'Woher die Daten kommen', body: el('div', {},
      el('p', {}, 'Dateien dieses Laufs:'),
      el('ul', { class: 'plain' }, run.files.map((f) => el('li', {}, el('code', {}, f)))),
      el('p', { class: 'hint' }, 'Datenordner: ', el('code', {}, dataDir)),
      el('p', { class: 'hint' }, 'Neue Läufe als Dateipaar dort ablegen und die Seite neu laden – sie erscheinen in der Laufauswahl oben rechts.')) }),
  ));

  plot(chartDiv, [{
    type: 'bar', x: sizes.map((d) => d.n), y: sizes.map((d) => d.count), marker: { color: C.series },
    text: sizes.map((d) => d.count), textposition: 'outside', cliponaxis: false,
    hovertemplate: '%{x} Kandidaten: %{y} Anfragen<extra></extra>',
  }], {
    xaxis: { title: { text: 'Anzahl in Frage kommender Roboter' }, dtick: 1 },
    yaxis: { title: { text: 'Anfragen' } },
  });
}
