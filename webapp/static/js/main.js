// Einstieg: lädt die Laufliste, verwaltet Reiter/Ansichten (über den URL-Hash) und die Laufauswahl.
// Hash-Schema: #/<reiter>/<ansicht>?param=wert   z.B. #/daten/zeitreise?t=330, #/kodierungen/one-hot?schritt=4
import { el, safeStorage } from './util.js';
import { renderOverview } from './views/overview.js';
import { renderReplay } from './views/replay.js';
import { renderMatrix } from './views/matrix.js';
import { renderCharts } from './views/charts.js';
import { renderCompare } from './views/compare.js';
import { renderOneHot } from './views/onehot.js';
import { renderSequence } from './views/sequence.js';
import { renderBaukasten } from './views/baukasten.js';

const TABS = {
  daten: [
    { key: 'ueberblick', label: 'Überblick', render: renderOverview },
    { key: 'zeitreise', label: 'Zeitreise', render: renderReplay },
    { key: 'matrix', label: 'Auftrag × Roboter', render: renderMatrix },
    { key: 'auswertungen', label: 'Auswertungen', render: renderCharts },
    { key: 'vergleich', label: 'Lauf-Vergleich', render: renderCompare },
  ],
  kodierungen: [
    { key: 'one-hot', label: 'One-Hot', render: renderOneHot },
    { key: 'reihenfolge', label: 'One-Hot + Reihenfolge', render: renderSequence },
    { key: 'baukasten', label: 'Formel-Baukasten', render: renderBaukasten },
    { key: 'domain-wall', label: 'Domain Wall', soon: true },
    { key: 'binary', label: 'Binary', soon: true },
  ],
};

const state = { runs: [], runId: null, dataDir: '', cleanup: null, cache: new Map() };
const viewEl = () => document.getElementById('view');

/** GET – oder POST mit JSON, wenn options.body gesetzt ist (z.B. die Bausteine des Formel-Baukastens). */
async function fetchJson(url, options = {}) {
  const init = options.body === undefined ? {}
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) };
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = await res.text();
    try { msg = JSON.parse(msg).detail || msg; } catch { /* Text behalten */ }
    throw new Error(`${res.status} – ${msg}`);
  }
  return res.json();
}

async function loadRun(runId) {
  if (!state.cache.has(runId)) state.cache.set(runId, await fetchJson(`/api/runs/${encodeURIComponent(runId)}`));
  return state.cache.get(runId);
}

function currentRoute() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const [tabKey, viewKey] = path.split('/');
  const tab = TABS[tabKey] ? tabKey : 'daten';
  const views = TABS[tab].filter((v) => !v.soon);
  const view = views.find((v) => v.key === viewKey) || views[0];
  return { tab, view, params: Object.fromEntries(new URLSearchParams(query || '')) };
}

async function route() {
  const { tab, view, params } = currentRoute();
  document.querySelectorAll('.tab[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  document.getElementById('subtabs').replaceChildren(...TABS[tab].map((v) => (v.soon
    ? el('span', { class: 'subtab disabled', title: 'Kommt in einem späteren Schritt' }, v.label, el('em', {}, 'bald'))
    : el('a', { class: `subtab${v === view ? ' active' : ''}`, href: `#/${tab}/${v.key}`, 'aria-current': v === view ? 'page' : null }, v.label))));

  if (state.cleanup) {
    state.cleanup();
    state.cleanup = null;
  }
  const root = viewEl();
  root.replaceChildren(el('p', { class: 'loading' }, 'Lade Daten …'));
  try {
    const run = await loadRun(state.runId);
    root.replaceChildren();
    const ctx = { run, runs: state.runs, dataDir: state.dataDir, selectRun, params, api: fetchJson };
    state.cleanup = view.render(root, ctx) || null;
  } catch (err) {
    console.error(err);
    root.replaceChildren(el('div', { class: 'error' }, `Fehler beim Laden von Lauf ${state.runId}: ${err.message}`));
  }
}

function fillRunOptions(select, runs) {
  select.replaceChildren(...runs.map((r) => el('option', { value: r.run_id }, r.error ? `${r.run_id} (Fehler)` : r.run_id)));
}

let refreshing = null;
async function refreshRuns() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const { runs } = await fetchJson('/api/runs');
      const ids = (list) => list.map((r) => r.run_id).join('|');
      if (ids(runs) !== ids(state.runs)) {
        state.runs = runs;
        const select = document.getElementById('run-select');
        fillRunOptions(select, runs);
        if (runs.some((r) => r.run_id === state.runId)) select.value = state.runId;
        else if (runs.length) selectRun(runs[runs.length - 1].run_id); // angezeigter Lauf wurde entfernt
      }
    } catch (err) {
      console.warn('Laufliste konnte nicht aktualisiert werden', err);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function selectRun(runId) {
  state.runId = runId;
  safeStorage('qubo.run', runId);
  document.getElementById('run-select').value = runId;
  route();
}

async function init() {
  try {
    const { runs, data_dir: dataDir } = await fetchJson('/api/runs');
    state.runs = runs;
    state.dataDir = dataDir;
    if (!runs.length) {
      viewEl().replaceChildren(el('div', { class: 'card' },
        el('h2', {}, 'Noch keine Simulationsläufe gefunden'),
        el('p', {}, 'Lege ein Dateipaar transport_events_<run_id>.csv und transport_fleet_<run_id>.csv in diesen Ordner und lade die Seite neu:'),
        el('p', {}, el('code', {}, dataDir))));
      return;
    }
    const select = document.getElementById('run-select');
    fillRunOptions(select, runs);
    const stored = safeStorage('qubo.run');
    state.runId = runs.some((r) => r.run_id === stored) ? stored : runs[runs.length - 1].run_id;
    select.value = state.runId;
    select.addEventListener('change', () => selectRun(select.value));
    // Neue Läufe im Datenordner erscheinen ohne Neuladen: beim Anklicken der Auswahl die Liste frisch holen
    select.addEventListener('focus', refreshRuns);
    select.addEventListener('mousedown', refreshRuns);
    window.addEventListener('hashchange', route);
    if (!location.hash) location.hash = '#/daten/ueberblick';
    else route();
  } catch (err) {
    console.error(err);
    viewEl().replaceChildren(el('div', { class: 'error' }, `Server nicht erreichbar: ${err.message}`));
  }
}

init();
