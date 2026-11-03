// Reiter „4 · Qubits & Kopplungen“: Für eine Instanz Qubits gegen Kopplungen je Kodierung – links IA (Sofortzuweisung),
// rechts TA (Lastausgleich). Beide Diagramme mit derselben Skala, damit IA und TA direkt vergleichbar sind.
// Gezählt wird die fertige QUBO (Binary mit Hilfsbits): encodings/resources.py, POST /api/runs/<id>/ressourcen mit "kurz".
import { el, fill, nf, escapeHtml } from '../util.js';
import { C, plot } from '../theme.js';
import { initialScenario, renderScenario } from '../components/scenario.js';
import { robotPicker, toggledRobots } from '../components/iaScenario.js';

// Kodierung = Farbe (Kategorien-Slots 1–3 der Referenzpalette, geprüft mit validate_palette)
const ENCS = [
  { key: 'one_hot', label: 'One-Hot', color: '#2a78d6' },
  { key: 'domain_wall', label: 'Domain Wall', color: '#eb6834' },
  { key: 'binary', label: 'Binary', color: '#1baf7a' },
];
const CLASSES = [
  { key: 'IA', variant: 'paar', title: 'IA · Sofortzuweisung', sub: 'Jeder Roboter höchstens ein Auftrag – die Spalten- bzw. Querregel koppelt Aufträge am selben Roboter' },
  { key: 'TA', variant: 'wb', title: 'TA · Lastausgleich', sub: 'Ein Roboter darf mehrere Aufträge fahren – H<sub>WB</sub> koppelt Aufträge am selben Roboter' },
];
const fmt = (v, d = 1) => nf(v, d).replace('-', '−');
const MAX_T = 18; // wie MAX_STRUCT_T / MAX_STRUCT_R in encodings/resources.py
const MAX_R = 9;
const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== undefined && v !== '' ? Math.min(hi, Math.max(lo, n)) : dflt; };

export function renderCouplings(root, { run, api, params }) {
  const tasks = run.tasks;
  const linked = String(params.roboter || '').split(',').map(Number).filter((id) => id > 0);
  const st = { ...initialScenario(tasks, params, 4), mode: params.modus === 'alle' ? 'alle' : 'kandidaten', robots: null, data: null,
    struct: params.struktur === '1', T: clampInt(params.T, 1, MAX_T, 6), R: clampInt(params.R, 1, MAX_R, 4),
    trend: CLASSES.map(() => false), ratio: 'halb', bw: true, limits: true, sizes: {} };
  st.robots = linked.length ? linked : defaultRobots();
  const sourceHost = el('div', { class: 'filter-group', style: { marginBottom: '10px' } });
  const scenarioHost = el('div');
  const summary = el('p', { class: 'hint' });
  const hosts = CLASSES.map((c, k) => {
    const btn = el('button', { class: 'btn small', type: 'button', 'aria-pressed': 'false',
      title: 'Qubits, couplings and density of this formulation over many instance sizes (structure only, no check)' }, 'Trend over instance sizes');
    btn.addEventListener('click', () => { st.trend[k] = !st.trend[k]; drawTrend(k); });
    return { chart: el('div', { class: 'chart' }), table: el('div'), note: el('p', { class: 'hint' }), btn, trend: el('div') };
  });
  root.append(
    el('p', { class: 'intro', html: '<strong>Qubits gegen Kopplungen</strong> je Kodierung für <b>eine Instanz</b> – links Sofortzuweisung (IA), rechts mit Reihenfolge (TA, Lastausgleich). Gleiche Skala in beiden Diagrammen.' }),
    el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, 'Instanz'),
      el('div', { class: 'card-sub' }, 'Echte Aufträge und Roboter wählen oder nur T × R vorgeben – IA und TA rechnen mit derselben Instanz'))),
      sourceHost, scenarioHost, summary),
    el('div', { class: 'grid grid-2', style: { marginTop: '16px' } }, CLASSES.map((c, k) => el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, c.title), el('div', { class: 'card-sub', html: c.sub })), hosts[k].btn),
      hosts[k].chart, hosts[k].table, hosts[k].note, hosts[k].trend))));

  function snapshot() {
    const first = tasks.filter((t) => st.selected.includes(t.transport_id)).sort((a, b) => a.time - b.time)[0];
    return first ? run.fleet.filter((r) => r.transport_id === first.transport_id).sort((a, b) => a.robot_id - b.robot_id) : [];
  }
  /** Ohne Link: die ersten drei freien Roboter im Snapshot (bei vier Aufträgen T > R). */
  function defaultRobots() {
    const free = snapshot().filter((r) => r.available).map((r) => r.robot_id);
    return free.length > 3 ? free.slice(0, 3) : free;
  }
  function drawSource() {
    fill(sourceHost, el('span', { class: 'filter-label' }, 'Instanz'),
      ...[[false, 'Echte Aufträge'], [true, 'Nur Struktur T × R']].map(([v, label]) => {
        const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(st.struct === v) }, label);
        b.addEventListener('click', () => { st.struct = v; load(); });
        return b;
      }));
  }
  function drawStructure(error) {
    const pick = (key, max, label) => {
      const sel = el('select', { 'aria-label': label }, Array.from({ length: max }, (_, k) => el('option', { value: k + 1 }, String(k + 1))));
      sel.value = String(st[key]);
      sel.addEventListener('change', () => { st[key] = Number(sel.value); load(); });
      return sel;
    };
    fill(scenarioHost,
      el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Aufträge T'), pick('T', MAX_T, 'Aufträge T'),
        el('span', { class: 'filter-label' }, 'Roboter R'), pick('R', MAX_R, 'Roboter R')),
      el('p', { class: 'hint' }, `Volle Zuständigkeit (jeder Roboter kann jeden Auftrag), synthetische Kosten, keine Vorlast: gezählt wird nur die Formulierung – `
        + `Qubits und Kopplungen hängen von T, R und der Kodierung ab, nicht von den Kostenwerten. Keine Suche nach dem Minimum. `
        + `Mit echten Kandidaten sind es höchstens so viele.`),
      error ? el('div', { class: 'error' }, error) : null);
  }
  function drawScenario(error) {
    drawSource();
    if (st.struct) { drawStructure(error); return; }
    const snap = snapshot();
    renderScenario(scenarioHost, {
      tasks, st, error,
      load: () => {
        const ids = new Set(snapshot().map((r) => r.robot_id));
        if (!st.robots.length || !st.robots.every((id) => ids.has(id))) st.robots = defaultRobots();
        load();
      },
      extra: robotPicker({ fleet: snap, robots: st.robots.map((id) => ({ robot_id: id })) }, st.mode, (id) => {
        const next = toggledRobots(st.robots, id);
        if (next) { st.robots = next; load(); }
      }),
      note: `Roboter aus dem Snapshot von Anfrage #${snap[0]?.transport_id ?? '–'}.`,
    });
  }

  async function load() {
    drawScenario();
    const scen = st.struct ? { struktur: true, T: st.T, R: st.R, kurz: true }
      : { tasks: st.selected, robots: st.robots, variables: st.mode, kurz: true };
    const cases = CLASSES.flatMap((c) => ENCS.map((e) => ({ cls: c.key, encoding: e.key, variant: c.variant, ...scen })));
    try {
      st.data = (await api(`/api/runs/${encodeURIComponent(run.run_id)}/ressourcen`, { body: { cases } })).cases;
    } catch (err) {
      drawScenario(`Konnte die Instanz nicht rechnen: ${err.message}`);
      return;
    }
    render();
  }

  function render() {
    const rows = CLASSES.map((c, k) => ENCS.map((e, j) => ({ ...e, m: st.data[k * ENCS.length + j] })));
    const ok = rows.flat().filter((r) => !r.m.error);
    // gemeinsame Skala für IA und TA
    const range = { x: Math.max(4, ...ok.map((r) => r.m.n)) * 1.2, y: Math.max(4, ...ok.map((r) => r.m.couplings)) * 1.25 };
    const any = ok[0]?.m;
    const T = any?.T ?? st.selected.length;
    const R = any?.R ?? st.robots.length;
    const iaCase = T === R ? 'T = R' : T < R ? 'T < R' : 'T > R';
    summary.innerHTML = st.struct
      ? `Nur Struktur: <b>T = ${T}</b> Aufträge, <b>R = ${R}</b> Roboter · IA-Fall <b>${iaCase}</b>.`
      : `Instanz: <b>T = ${T}</b> Aufträge (${st.selected.map((t) => `#${t}`).join(', ')}), <b>R = ${R}</b> Roboter
      (${st.robots.map((r) => `R${r}`).join(', ')}) · IA-Fall <b>${iaCase}</b>.`;
    rows.forEach((list, k) => {
      const h = hosts[k];
      const good = list.filter((r) => !r.m.error);
      if (!good.length) {
        Plotly.purge(h.chart);
        fill(h.table, el('div', { class: 'error' }, list[0].m.error));
        h.note.textContent = '';
        return;
      }
      drawChart(h.chart, good, range);
      fill(h.table, table(list));
      h.note.innerHTML = takeaway(good);
    });
    CLASSES.forEach((c, k) => { if (st.trend[k]) drawTrend(k); });
  }

  /** Trend over instance sizes in the paper style: qubits, couplings and density per encoding over mixed instance sizes T × R
   *  (structure with full eligibility, sorted by T·R). The figure is rendered by the server (matplotlib, SVG); shown and downloaded here. */
  async function drawTrend(k) {
    const h = hosts[k];
    const c = CLASSES[k];
    h.btn.setAttribute('aria-pressed', String(st.trend[k]));
    h.btn.textContent = st.trend[k] ? 'Hide trend' : 'Trend over instance sizes';
    if (!st.trend[k]) { fill(h.trend); return; }
    const R = st.data?.find((r) => !r.error)?.R ?? (st.struct ? st.R : st.robots.length);
    const chip = (label, pressed, onclick) => {
      const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(pressed) }, label);
      b.addEventListener('click', onclick);
      return b;
    };
    const redrawOpen = () => CLASSES.forEach((o, j) => { if (st.trend[j]) drawTrend(j); });
    const controls = el('div', { class: 'filter-group', style: { margin: '12px 0 8px' } }, el('span', { class: 'filter-label' }, 'Series'),
      ...[['halb', 'R = T/2'], ['fest', `R fixed = ${R}`], ['quadrat', 'T = R']].map(([v, label]) => chip(label, st.ratio === v, () => { st.ratio = v; redrawOpen(); })),
      el('span', { class: 'filter-label' }, 'Style'),
      chip('Black & white', st.bw, () => { st.bw = true; redrawOpen(); }), chip('Color', !st.bw, () => { st.bw = false; redrawOpen(); }),
      el('span', { class: 'filter-label' }, 'Reference'),
      chip('Largest mapped on hardware', st.limits, () => { st.limits = !st.limits; redrawOpen(); }));
    const fig = el('div', { class: 'paper-fig' }, el('p', { class: 'hint' }, 'Computing … (binary with auxiliary qubits can take a while the first time)'));
    const bar = el('div', { class: 'filter-group', style: { margin: '8px 0 4px' } });
    const details = el('div');
    fill(h.trend, controls, fig, bar, details);

    const body = { cls: c.key, ratio: st.ratio, R, schwarzweiss: st.bw, hardware_limits: st.limits };
    const key = JSON.stringify(body);
    if (!st.sizes[key]) {
      try {
        st.sizes[key] = await api('/api/ressourcen/groessen', { body });
      } catch (err) {
        if (fig.isConnected) fill(fig, el('div', { class: 'error' }, `Could not compute the trend: ${err.message}`));
        return;
      }
    }
    if (!fig.isConnected) return; // meanwhile hidden or redrawn
    const data = st.sizes[key];
    fill(fig, el('img', { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg)}`, alt: `${c.key}: qubits, couplings and density over instance sizes T × R`,
      style: { width: '100%', height: 'auto', display: 'block' } }));
    const download = el('button', { class: 'btn small', type: 'button', title: 'Save the figure as SVG (text as outlines)' }, 'Download SVG');
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([data.svg], { type: 'image/svg+xml' }));
      const a = el('a', { href: url, download: `qubo_${c.key}_${data.ratio}${st.bw ? '' : '_color'}.svg` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    fill(bar, download, el('span', { class: 'hint' }, 'Structure with full eligibility, instances sorted by T·R. Qubits and couplings on a log scale; the y-axes are fixed and identical for IA and TA.'
      + (data.limits?.length ? ` Dash-dot lines: largest problem mapped on ${data.limits.map((l) => l.label).join(', ')} (Hardware tab).` : '')));
    fill(details, el('details', {}, el('summary', {}, 'Values as table'), trendTable(data)));
  }

  function trendTable(data) {
    const pts = data.series[0].points;
    const head = el('tr', {}, el('th', {}, 'T × R'), ...data.series.flatMap((s) => {
      const e = ENCS.find((x) => x.key === s.encoding);
      return [el('th', { class: 'num' }, `${e.label} qubits`), el('th', { class: 'num' }, 'couplings'), el('th', { class: 'num' }, 'density')];
    }));
    return el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, el('thead', {}, head),
      el('tbody', {}, pts.map((p, i) => el('tr', {}, el('td', {}, `${p.T} × ${p.R}`),
        ...data.series.flatMap((s) => { const q = s.points[i]; return [el('td', { class: 'num' }, nf(q.n)), el('td', { class: 'num' }, nf(q.couplings)), el('td', { class: 'num' }, fmt(q.density, 2))]; }))))));
  }

  function drawChart(div, list, range) {
    const xs = Array.from({ length: 80 }, (_, k) => (range.x * k) / 79);
    // gleiche Punkte (z.B. Domain Wall = Binary bei R = 2) bekommen eine gemeinsame Beschriftung
    const groups = new Map();
    for (const r of list) {
      const key = `${r.m.n}|${r.m.couplings}`;
      groups.set(key, [...(groups.get(key) || []), r]);
    }
    const traces = [{ type: 'scatter', mode: 'lines', x: xs, y: xs.map((n) => (n * (n - 1)) / 2), name: 'vollständig verbunden: C(n, 2)',
      line: { color: C.axis, width: 1.5, dash: 'dot' }, hoverinfo: 'skip' }];
    for (const r of list) {
      const same = groups.get(`${r.m.n}|${r.m.couplings}`);
      const first = same[0] === r;
      traces.push({
        type: 'scatter', mode: first ? 'markers+text' : 'markers', name: r.label, x: [r.m.n], y: [r.m.couplings],
        text: first ? [`${same.map((s) => s.label).join(' = ')}: ${r.m.n} | ${r.m.couplings}`] : undefined,
        // gleiche Qubit-Zahl: der untere Punkt beschriftet nach unten, damit sich die Texte nicht überdecken
        textposition: list.some((o) => o.m.n === r.m.n && o.m.couplings > r.m.couplings) ? 'bottom center' : 'top center',
        textfont: { color: C.ink, size: 13 }, cliponaxis: false,
        marker: { size: 15, color: r.color, line: { color: C.surface, width: 2 } },
        hovertemplate: `${escapeHtml(r.label)}<br>%{x} Qubits${r.m.types.hilfsbit ? ` (davon ${r.m.types.hilfsbit} Hilfsbits)` : ''}<br>%{y} Kopplungen<br>Dichte ${fmt(r.m.density, 2)}<extra></extra>`,
      });
    }
    plot(div, traces, {
      margin: { l: 60, r: 16, t: 30, b: 50 },
      xaxis: { title: { text: 'Qubits (Binärvariablen, inkl. Hilfsbits)' }, range: [0, range.x], rangemode: 'tozero' },
      yaxis: { title: { text: 'Kopplungen (Q_ij ≠ 0, i ≠ j)' }, range: [0, range.y], rangemode: 'tozero' },
      legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom' },
    });
  }

  function table(list) {
    return el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Kodierung'), el('th', { class: 'num' }, 'Qubits'), el('th', { class: 'num' }, 'davon Hilfsbits'),
        el('th', { class: 'num' }, 'Kopplungen'), el('th', { class: 'num', title: 'Kopplungen / C(n, 2) – 1 = vollständig verbunden' }, 'Dichte'),
        el('th', { class: 'num', title: 'Kopplungen je Qubit im Mittel' }, 'Ø Grad'))),
      el('tbody', {}, list.map((r) => el('tr', {},
        el('td', {}, el('span', { class: 'swatch', style: { background: r.color, display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', marginRight: '6px' } }), r.label),
        ...(r.m.error ? [el('td', { colspan: 5, class: 'no' }, r.m.error)] : [
          el('td', { class: 'num' }, el('b', {}, nf(r.m.n))), el('td', { class: 'num' }, nf(r.m.types.hilfsbit)),
          el('td', { class: 'num' }, el('b', {}, nf(r.m.couplings))), el('td', { class: 'num' }, fmt(r.m.density, 2)), el('td', { class: 'num' }, fmt(r.m.deg_mean)),
        ]))))));
  }

  /** Ein Satz: Wie stehen Domain Wall und Binary gegen One-Hot? */
  function takeaway(list) {
    const oh = list.find((r) => r.key === 'one_hot');
    if (!oh) return '';
    const diff = (a, b, what) => (a === b ? `gleich viele ${what}` : `${Math.abs(a - b)} ${what} ${a < b ? 'weniger' : 'mehr'}`);
    return list.filter((r) => r !== oh).map((r) => `<b>${r.label}</b>: ${diff(r.m.n, oh.m.n, 'Qubits')}, ${diff(r.m.couplings, oh.m.couplings, 'Kopplungen')} als One-Hot`).join(' · ');
  }

  load();
}
