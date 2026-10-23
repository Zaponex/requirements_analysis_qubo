// Ansicht „Auswertungen“: die Grafiken des PNG-Berichts – interaktiv und filterbar.
import { el, groupBy, countBy, median, mean, nf, windowCounts, tipHtml, escapeHtml } from '../util.js';
import {
  C, AREA_ORDER, FLOW_ORDER, SEQ_SCALE, STAGE_ORDER, STATUS_ORDER, areaColor, areaLabel, categoryLabel, categoryOf,
  ordered, plot, rootFontPx, stageLabel, statusColor, statusLabel,
} from '../theme.js';
import { card } from '../components/card.js';
import { createLayoutMap, mapLegend } from '../components/layoutMap.js';

const NO_AREA = '–';

export function renderCharts(root, { run }) {
  const all = run.tasks;
  const tMax = Math.max(...all.map((t) => t.time));
  const areas = ordered(all.map((t) => t.task_area || NO_AREA), [...AREA_ORDER, NO_AREA]);
  const stages = ordered(all.map((t) => t.material_stage), STAGE_ORDER);
  const st = { areas: new Set(areas), stages: new Set(stages), from: 0, to: tMax, dt: 60 };

  const filtered = () => all.filter((t) => st.areas.has(t.task_area || NO_AREA) && st.stages.has(t.material_stage)
    && t.time >= st.from && t.time <= st.to);

  // ---------------------------------------------------------------- Filterleiste
  const chip = (label, color, set, value) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true' },
      color ? el('span', { class: 'swatch', style: { background: color } }) : null, label);
    b.addEventListener('click', () => {
      if (set.has(value)) set.delete(value); else set.add(value);
      b.setAttribute('aria-pressed', String(set.has(value)));
      update();
    });
    return b;
  };
  const fromIn = el('input', { type: 'number', min: 0, max: tMax, step: 10, value: 0, style: { width: '90px' }, 'aria-label': 'von (s)' });
  const toIn = el('input', { type: 'number', min: 0, max: tMax, step: 10, value: tMax, style: { width: '90px' }, 'aria-label': 'bis (s)' });
  const count = el('span', { class: 'hint' });
  fromIn.addEventListener('change', () => { st.from = Number(fromIn.value) || 0; update(); });
  toIn.addEventListener('change', () => { st.to = Number(toIn.value) || tMax; update(); });
  const reset = el('button', { class: 'btn small', type: 'button' }, 'Filter zurücksetzen');
  reset.addEventListener('click', () => {
    areas.forEach((a) => st.areas.add(a));
    stages.forEach((s) => st.stages.add(s));
    st.from = 0; st.to = tMax; fromIn.value = 0; toIn.value = tMax;
    root.querySelectorAll('.filterbar .chip').forEach((c) => c.setAttribute('aria-pressed', 'true'));
    update();
  });

  root.append(el('p', {
    class: 'intro',
    html: `Die Auswertungen aus dem PNG-Bericht – hier mit Hover, Zoom und Filtern. Die Filter wirken auf alle
      Diagramme dieser Seite. Jede Karte hat eine <strong>Tabelle</strong> mit den Zahlen dahinter.`,
  }));
  root.append(el('div', { class: 'filterbar' },
    el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Bereich'),
      areas.map((a) => chip(a === NO_AREA ? 'ohne Bereich' : areaLabel(a), a === NO_AREA ? C.ink2 : areaColor(a), st.areas, a))),
    el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Materialstufe'),
      stages.map((s) => chip(stageLabel(s), null, st.stages, s))),
    el('div', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Zeitraum (s)'), fromIn, '–', toIn),
    reset, count));

  // ---------------------------------------------------------------- Karten
  const mapHost = el('div');
  const dtSlider = el('input', { type: 'range', min: 10, max: 300, step: 10, value: st.dt, 'aria-label': 'Fensterlänge' });
  const dtLabel = el('strong', {}, `${st.dt} s`);
  dtSlider.addEventListener('input', () => { st.dt = Number(dtSlider.value); dtLabel.textContent = `${st.dt} s`; drawWindows(); });

  const divs = {
    trans: el('div', { class: 'chart' }), stages: el('div', { class: 'chart' }), cumul: el('div', { class: 'chart' }),
    inter: el('div', { class: 'chart' }), windows: el('div', { class: 'chart' }), gantt: el('div', { class: 'chart', style: { minHeight: '320px' } }),
    avail: el('div', { class: 'chart short' }), battery: el('div', { class: 'chart short' }),
    pathHist: el('div', { class: 'chart' }), pathScatter: el('div', { class: 'chart' }),
  };

  const cards = {};
  cards.flow = card({ title: 'Layout & Materialfluss', subtitle: 'Pfeilstärke = Anzahl Transporte zwischen zwei Entitäten · über Pfeile und Punkte fahren für Details',
    body: [mapHost, mapLegend()], table: () => flowTable() });
  cards.trans = card({ title: 'Übergänge zwischen Bereichen', subtitle: 'Anzahl Anfragen je Kombination Abholung → Ziel', body: divs.trans, table: () => transTable() });
  cards.stages = card({ title: 'Materialstufen', subtitle: 'Prozessstufe des transportierten Materials', body: divs.stages,
    table: () => ({ columns: [{ key: 'stage', label: 'Stufe' }, { key: 'n', label: 'Anfragen', num: true }], rows: stageRows() }) });
  cards.cumul = card({ title: 'Eingang der Anfragen', subtitle: 'Kumulierte Anzahl über die Simulationszeit', body: divs.cumul,
    table: () => ({ columns: [{ key: 'transport_id', label: 'Anfrage', num: true }, { key: 'time', label: 't (s)', num: true }, { key: 'task_area', label: 'Bereich', fmt: (v) => (v ? areaLabel(v) : '–') }], rows: filtered() }) });
  cards.inter = card({ title: 'Zeit zwischen zwei Anfragen', subtitle: 'Klassenbreite 5 s', body: divs.inter,
    table: () => ({ columns: [{ key: 'transport_id', label: 'Anfrage', num: true }, { key: 'gap', label: 'Abstand zur vorherigen (s)', num: true }], rows: gaps() }) });
  cards.windows = card({ title: 'Anfragen pro Zeitfenster', subtitle: 'Die Simulationszeit in Fenster der Länge Δt geschnitten – jeder Balken ist ein Fenster',
    body: [el('div', { class: 'slider-row' }, el('span', { class: 'filter-label' }, 'Fensterlänge Δt'), dtSlider, dtLabel), divs.windows],
    table: () => ({ columns: [{ key: 'start', label: 'von (s)', num: true }, { key: 'end', label: 'bis (s)', num: true }, { key: 'count', label: 'Anfragen', num: true }], rows: windowRows() }) });
  cards.fleet = card({ title: 'Flottenzustand', subtitle: 'Status, Akku und Verfügbarkeit je Roboter · nur der Zeitraum-Filter wirkt hier (die Flotte hat keinen Bereich)',
    body: [divs.gantt, divs.battery, divs.avail], table: () => fleetTable() });
  cards.paths = card({ title: 'Pfadlängen', subtitle: 'Links Verteilung, rechts Vergleich mit der Manhattan-Distanz der Koordinaten', body: el('div', { class: 'grid grid-2' }, divs.pathHist, divs.pathScatter),
    table: () => ({ columns: [{ key: 'transport_id', label: 'Anfrage', num: true }, { key: 'path_steps', label: 'Pfadlänge', num: true }, { key: 'manhattan', label: 'Manhattan', num: true }, { key: 'path_unreachable', label: 'Sentinel', fmt: (v) => (v ? 'ja' : '') }], rows: filtered() }) });

  root.append(el('div', { class: 'grid' }, cards.flow,
    el('div', { class: 'grid grid-2' }, cards.trans, cards.stages, cards.cumul, cards.inter),
    cards.windows, cards.fleet, cards.paths));

  const map = createLayoutMap(mapHost, { entities: run.entities, robots: run.robots });

  // ---------------------------------------------------------------- Datenaufbereitung
  function flows() {
    const g = groupBy(filtered(), (t) => `${t.from_entity}→${t.to_entity}`);
    return [...g.values()].map((ts) => ({ from: ts[0].from_entity, to: ts[0].to_entity, n: ts.length, t: ts[0] })).sort((a, b) => b.n - a.n);
  }
  const flowTable = () => ({ columns: [{ key: 'from', label: 'von' }, { key: 'to', label: 'nach' }, { key: 'n', label: 'Transporte', num: true }], rows: flows() });
  function transitions() {
    const tasks = filtered();
    const src = tasks.map((t) => categoryOf(t.from_kind, t.from_area));
    const dst = tasks.map((t) => categoryOf(t.to_kind, t.to_area));
    const cats = ordered([...src, ...dst], FLOW_ORDER);
    const z = cats.map(() => cats.map(() => 0));
    src.forEach((s, i) => { z[cats.indexOf(s)][cats.indexOf(dst[i])] += 1; });
    return { cats, z };
  }
  function transTable() {
    const { cats, z } = transitions();
    const rows = [];
    cats.forEach((a, i) => cats.forEach((b, j) => { if (z[i][j]) rows.push({ from: categoryLabel(a), to: categoryLabel(b), n: z[i][j] }); }));
    return { columns: [{ key: 'from', label: 'von' }, { key: 'to', label: 'nach' }, { key: 'n', label: 'Anfragen', num: true }], rows };
  }
  function stageRows() {
    const c = countBy(filtered(), (t) => t.material_stage);
    return ordered([...c.keys()], STAGE_ORDER).map((s) => ({ stage: stageLabel(s), n: c.get(s) }));
  }
  function gaps() {
    const ts = filtered();
    return ts.slice(1).map((t, i) => ({ transport_id: t.transport_id, gap: t.time - ts[i].time }));
  }
  const windowRows = () => windowCounts(filtered().map((t) => t.time), st.dt, st.from, st.to);

  function segments() {
    // Status je Roboter als Abschnitte zwischen aufeinanderfolgenden Snapshots, auf den Zeitraum zugeschnitten
    const byRobot = groupBy([...run.fleet].sort((a, b) => a.time - b.time || a.transport_id - b.transport_id), (r) => r.robot_id);
    const segs = [];
    for (const [robot, rows] of [...byRobot].sort((a, b) => a[0] - b[0])) {
      const last = new Map();
      rows.forEach((r) => last.set(r.time, r));
      const snaps = [...last.values()];
      for (let i = 0; i < snaps.length - 1; i += 1) {
        const a = Math.max(snaps[i].time, st.from);
        const b = Math.min(snaps[i + 1].time, st.to);
        if (b > a) segs.push({ robot, status: snaps[i].status, start: a, end: b });
      }
    }
    return segs;
  }
  const fleetTable = () => ({ columns: [{ key: 'robot', label: 'Roboter', fmt: (v) => `R${v}` }, { key: 'status', label: 'Status', fmt: statusLabel },
    { key: 'start', label: 'von (s)', num: true }, { key: 'end', label: 'bis (s)', num: true }], rows: segments() });

  // ---------------------------------------------------------------- Zeichnen
  function drawFlow() {
    const fs = flows();
    const max = Math.max(1, ...fs.map((f) => f.n));
    map.setArrows(fs.map((f) => ({
      from: { x: f.t.from_entity_x, y: f.t.from_entity_y }, to: { x: f.t.to_entity_x, y: f.t.to_entity_y },
      color: C.muted, width: 1 + 4 * (f.n / max), opacity: 0.75, bend: 0.12,
      tip: tipHtml(`${f.n} Transport${f.n === 1 ? '' : 'e'}`, [`${escapeHtml(f.from)} → ${escapeHtml(f.to)}`]),
    })));
  }

  function drawTransitions() {
    const { cats, z } = transitions();
    const labels = cats.map(categoryLabel);
    const zz = z.map((row) => row.map((v) => (v === 0 ? null : v)));
    plot(divs.trans, [{
      type: 'heatmap', x: labels, y: labels, z: zz, colorscale: SEQ_SCALE, showscale: false, xgap: 2, ygap: 2,
      texttemplate: '%{z}', textfont: { size: 12 }, hovertemplate: '%{y} → %{x}: %{z} Anfragen<extra></extra>', hoverongaps: false,
    }], {
      margin: { l: 120, r: 10, t: 6, b: 100 },
      xaxis: { title: { text: 'nach (Ziel)' }, tickangle: -35, showgrid: false, ticks: '' },
      yaxis: { title: { text: 'von (Abholung)' }, autorange: 'reversed', showgrid: false, ticks: '' },
    });
  }

  function drawStages() {
    const rows = stageRows();
    plot(divs.stages, [{
      type: 'bar', orientation: 'h', y: rows.map((r) => r.stage), x: rows.map((r) => r.n), marker: { color: C.series },
      text: rows.map((r) => r.n), textposition: 'outside', cliponaxis: false, hovertemplate: '%{y}: %{x} Anfragen<extra></extra>',
    }], { margin: { l: 190, r: 30, t: 6, b: 44 }, yaxis: { autorange: 'reversed', showgrid: false }, xaxis: { title: { text: 'Anfragen' } } });
  }

  function drawCumul() {
    const ts = filtered();
    plot(divs.cumul, [{
      type: 'scatter', mode: 'lines+markers', line: { shape: 'hv', color: C.series, width: 2 }, marker: { size: 5, color: C.series },
      x: ts.map((t) => t.time), y: ts.map((_, i) => i + 1), customdata: ts.map((t) => t.transport_id),
      hovertemplate: 'Anfrage #%{customdata} bei t = %{x} s<br>%{y}. Anfrage im Filter<extra></extra>',
    }], { xaxis: { title: { text: 'Simulationszeit (s)' }, range: [st.from, st.to] }, yaxis: { title: { text: 'Anfragen kumuliert' }, rangemode: 'tozero' } });
  }

  function drawInter() {
    const g = gaps().map((r) => r.gap);
    const med = median(g);
    plot(divs.inter, [{
      type: 'histogram', x: g, xbins: { start: 0, size: 5 }, marker: { color: C.series, line: { color: C.surface, width: 1 } },
      hovertemplate: '%{x} s: %{y} Anfragen<extra></extra>',
    }], {
      xaxis: { title: { text: 'Abstand zur vorherigen Anfrage (s)' } }, yaxis: { title: { text: 'Anzahl' } },
      shapes: med != null ? [{ type: 'line', x0: med, x1: med, yref: 'paper', y0: 0, y1: 1, line: { color: C.ink2, width: 1 } }] : [],
      annotations: med != null ? [{ x: med, yref: 'paper', y: 1, text: `Median ${nf(med, 1)} s`, showarrow: false, xanchor: 'left', xshift: 4, font: { color: C.ink2 } }] : [],
    });
  }

  function drawWindows() {
    const rows = windowRows();
    const counts = rows.map((r) => r.count);
    const max = Math.max(0, ...counts);
    plot(divs.windows, [{
      type: 'bar', x: rows.map((r) => r.start + st.dt / 2), y: counts, width: rows.map(() => st.dt * 0.88),
      marker: { color: counts.map((c) => (c === max && max > 0 ? C.accent : C.series)) },
      customdata: rows.map((r) => [r.start, r.end]),
      hovertemplate: '%{customdata[0]}–%{customdata[1]} s: %{y} Anfragen<extra></extra>',
    }], {
      margin: { t: 34 },
      xaxis: { title: { text: 'Simulationszeit (s) – jeder Balken ist ein Fenster' }, range: [st.from, st.to] },
      yaxis: { title: { text: 'Anfragen im Fenster' }, rangemode: 'tozero' },
      annotations: [{ xref: 'paper', yref: 'paper', x: 1, y: 1.02, xanchor: 'right', yanchor: 'bottom', showarrow: false,
        text: `${rows.length} Fenster · Ø ${nf(mean(counts), 2)} · max ${max} (orange)`, font: { color: C.ink2 } }],
    });
  }

  function drawFleet() {
    const segs = segments();
    const robots = [...new Set(run.fleet.map((r) => r.robot_id))].sort((a, b) => a - b);
    const statuses = ordered(segs.map((s) => s.status), STATUS_ORDER);
    plot(divs.gantt, statuses.map((s) => {
      const ss = segs.filter((x) => x.status === s);
      return {
        type: 'bar', orientation: 'h', name: statusLabel(s), y: ss.map((x) => `R${x.robot}`), base: ss.map((x) => x.start),
        x: ss.map((x) => x.end - x.start), marker: { color: statusColor(s), line: { color: C.surface, width: 1 } },
        customdata: ss.map((x) => [x.start, x.end]),
        hovertemplate: `%{y}: ${statusLabel(s)}<br>%{customdata[0]}–%{customdata[1]} s<extra></extra>`,
      };
    }), {
      barmode: 'overlay', bargap: 0.3, margin: { l: 48, r: 10, t: 30, b: 30 },
      xaxis: { range: [st.from, st.to], showgrid: false }, yaxis: { autorange: 'reversed', categoryorder: 'array', categoryarray: robots.map((r) => `R${r}`) },
    });

    // Akku: kleine Mehrfachdiagramme, eines pro Roboter (gleiche Zeitachse)
    const n = robots.length;
    const gap = 0.12;
    const h = (1 - gap * (n - 1)) / n;
    const k = rootFontPx() / 15; // Höhe wächst mit der Grundschrift
    const layout = { height: Math.round((60 + 52 * n) * k), margin: { l: 60, r: 10, t: 30, b: 10 }, showlegend: false, xaxis: { range: [st.from, st.to], showticklabels: false, showgrid: false },
      annotations: [{ xref: 'paper', yref: 'paper', x: 0, y: 1.08, xanchor: 'left', showarrow: false, text: 'Akkustand (%) je Roboter', font: { color: C.ink2 } }] };
    const traces = robots.map((r, i) => {
      const key = i === 0 ? '' : String(i + 1);
      const y0 = 1 - (i + 1) * h - i * gap;
      layout[`yaxis${key}`] = { domain: [y0, y0 + h], range: [0, 100], tickvals: [0, 100], tickfont: { size: 9 }, title: { text: `R${r}`, font: { size: 10 } }, gridcolor: C.grid };
      const rows = run.fleet.filter((f) => f.robot_id === r).sort((a, b) => a.time - b.time);
      return { type: 'scatter', mode: 'lines', x: rows.map((f) => f.time), y: rows.map((f) => f.battery_percent), yaxis: `y${key}`,
        line: { color: C.ink2, width: 1.5, shape: 'hv' }, fill: 'tozeroy', fillcolor: 'rgba(82,81,78,0.10)',
        hovertemplate: `R${r} · t = %{x} s: Akku %{y} %<extra></extra>` };
    });
    plot(divs.battery, traces, layout);

    const snap = [...run.tasks].sort((a, b) => a.time - b.time);
    plot(divs.avail, [{
      type: 'scatter', mode: 'lines', x: snap.map((t) => t.time), y: snap.map((t) => t.n_available), line: { shape: 'hv', color: C.series, width: 2 },
      hovertemplate: 't = %{x} s: %{y} Roboter verfügbar<extra></extra>',
    }], {
      margin: { l: 48, r: 10, t: 22, b: 44 }, xaxis: { range: [st.from, st.to], title: { text: 'Simulationszeit (s)' } },
      yaxis: { range: [-0.2, robots.length + 0.2], dtick: 1, title: { text: 'verfügbar' } },
      annotations: [{ xref: 'paper', yref: 'paper', x: 0, y: 1.08, xanchor: 'left', showarrow: false, text: 'Anzahl verfügbarer Roboter', font: { color: C.ink2 } }],
    });
  }

  function drawPaths() {
    const ts = filtered();
    const valid = ts.filter((t) => t.path_steps != null);
    const nSent = ts.filter((t) => t.path_unreachable).length;
    plot(divs.pathHist, [{
      type: 'histogram', x: valid.map((t) => t.path_steps), xbins: { start: 0, size: 5 }, marker: { color: C.series, line: { color: C.surface, width: 1 } },
      hovertemplate: 'Pfadlänge %{x}: %{y} Anfragen<extra></extra>',
    }], {
      xaxis: { title: { text: 'Pfadlänge (Schritte)' } }, yaxis: { title: { text: 'Anfragen' } },
      annotations: nSent ? [{ xref: 'paper', yref: 'paper', x: 1, y: 1, xanchor: 'right', showarrow: false, text: `${nSent} Sentinel-Wert(e) ausgeschlossen`, font: { color: C.ink2 } }] : [],
    });
    const lim = Math.max(1, ...valid.map((t) => Math.max(t.manhattan, t.path_steps))) * 1.05;
    plot(divs.pathScatter, [
      { type: 'scatter', mode: 'lines', x: [0, lim], y: [0, lim], line: { color: C.axis, width: 1 }, hoverinfo: 'skip', showlegend: false },
      { type: 'scatter', mode: 'markers', x: valid.map((t) => t.manhattan), y: valid.map((t) => t.path_steps),
        marker: { size: 8, color: C.series, opacity: 0.8, line: { color: C.surface, width: 1 } }, customdata: valid.map((t) => t.transport_id),
        hovertemplate: 'Anfrage #%{customdata}<br>Manhattan %{x} · Pfad %{y}<extra></extra>', showlegend: false },
    ], {
      xaxis: { title: { text: 'Manhattan-Distanz (Koordinaten)' }, range: [0, lim] },
      yaxis: { title: { text: 'Pfadlänge' }, range: [0, lim] },
      annotations: [{ x: lim * 0.85, y: lim * 0.85, text: 'Pfad = Manhattan', showarrow: false, font: { color: C.muted, size: 11 }, yshift: 10 }],
    });
  }

  function update() {
    const n = filtered().length;
    count.textContent = `${n} von ${all.length} Anfragen`;
    drawFlow();
    drawTransitions();
    drawStages();
    drawCumul();
    drawInter();
    drawWindows();
    drawFleet();
    drawPaths();
    Object.values(cards).forEach((c) => c.refreshTable && c.refreshTable());
  }

  update();
}
