// Ansicht „Auftrag × Roboter“: Wer kommt für welche Anfrage in Frage – und wie weit ist er entfernt?
import { el, groupBy, lifecycleText, nf } from '../util.js';
import { C, SEQ_SCALE, areaColor, areaLabel, plot, stageLabel, statusColor, statusLabel } from '../theme.js';
import { card } from '../components/card.js';
import { createLayoutMap, mapLegend } from '../components/layoutMap.js';

export function renderMatrix(root, { run }) {
  const tasks = run.tasks;
  const robots = run.robots.map((r) => r.robot_id).sort((a, b) => a - b);
  const byTask = groupBy(run.matrix, (m) => m.transport_id);
  const st = { selected: tasks[0]?.transport_id, sizeFilter: null };

  root.append(el('p', {
    class: 'intro',
    html: `Jede Spalte ist eine Anfrage, jede Zeile ein Roboter. Eine Zelle ist eingefärbt, wenn der Roboter beim Eingang
      der Anfrage <strong>verfügbar und zuständig</strong> war – die Farbe zeigt seine Distanz zum Abholort.
      Graue Zellen: Roboter war belegt. <strong>Klicke auf eine Spalte</strong>, um die Anfrage im Layout zu sehen.`,
  }));

  const heat = el('div', { class: 'chart', style: { minHeight: '340px' } });
  const sizeChart = el('div', { class: 'chart short' });
  const mapHost = el('div');
  const details = el('div');
  const filterNote = el('span', { class: 'hint' });

  root.append(card({
    title: 'Auftrag × Roboter',
    subtitle: 'Farbe = Distanz zum Abholort (Manhattan) · grau = nicht in Frage kommend',
    actions: [filterNote],
    body: heat,
  }));
  root.append(el('div', { style: { height: '16px' } }));
  const prevBtn = el('button', { class: 'btn small', type: 'button', title: 'Vorherige Anfrage (←)' }, '◀');
  const nextBtn = el('button', { class: 'btn small', type: 'button', title: 'Nächste Anfrage (→)' }, '▶');
  root.append(el('div', { class: 'grid grid-main-side' },
    card({ title: 'Die ausgewählte Anfrage im Layout', subtitle: 'Roboterpositionen zum Zeitpunkt der Anfrage', actions: [prevBtn, nextBtn],
      body: [mapHost, mapLegend({ statuses: [], showRobotRing: true, extra: [
        [`<span class="swatch" style="background:${C.accent};height:3px"></span>`, 'Abholung → Ziel'],
        [`<span class="swatch" style="background:${C.series};height:2px"></span>`, 'Kandidat → Abholort'],
        ['<span class="dot" style="background:#c3c2b7;opacity:.4"></span>', 'kein Kandidat (blass)'],
      ] })] }),
    el('div', { class: 'grid' },
      card({ title: 'Details', body: details }),
      card({
        title: 'Größe der Kandidatenmenge',
        subtitle: 'Klicke auf einen Balken, um nur diese Anfragen in der Matrix zu zeigen',
        body: sizeChart,
        table: () => ({ columns: [{ key: 'n', label: 'Kandidaten', num: true }, { key: 'count', label: 'Anfragen', num: true }], rows: sizeRows() }),
      }))));

  const map = createLayoutMap(mapHost, { entities: run.entities, robots: run.robots });

  const visibleTasks = () => (st.sizeFilter == null ? tasks : tasks.filter((t) => t.n_eligible === st.sizeFilter));
  const sizeRows = () => {
    const rows = [];
    for (let n = 0; n <= robots.length; n += 1) rows.push({ n, count: tasks.filter((t) => t.n_eligible === n).length });
    return rows;
  };

  function drawHeat() {
    const vt = visibleTasks();
    const x = vt.map((t) => `#${t.transport_id}`);
    const y = robots.map((r) => `R${r}`);
    const cell = (t, r) => (byTask.get(t.transport_id) || []).find((m) => m.robot_id === r);
    const zDist = robots.map((r) => vt.map((t) => { const m = cell(t, r); return m && m.eligible ? m.dist_to_pickup : null; }));
    const zGrey = robots.map((r) => vt.map((t) => { const m = cell(t, r); return m && !m.eligible ? 1 : null; }));
    const custom = robots.map((r) => vt.map((t) => {
      const m = cell(t, r);
      return m ? [statusLabel(m.status), m.available ? 'verfügbar' : 'belegt', m.dist_to_pickup, nf(t.time)] : ['', '', '', ''];
    }));
    const selIdx = vt.findIndex((t) => t.transport_id === st.selected);
    const hover = 'Anfrage %{x} · t = %{customdata[3]} s<br>%{y}: %{customdata[0]}, %{customdata[1]}<br>Distanz zum Abholort: %{customdata[2]}<extra></extra>';
    plot(heat, [
      { type: 'heatmap', x, y, z: zGrey, colorscale: [[0, C.grid], [1, C.grid]], showscale: false, xgap: 1, ygap: 2, customdata: custom, hovertemplate: hover },
      { type: 'heatmap', x, y, z: zDist, colorscale: SEQ_SCALE, xgap: 1, ygap: 2, customdata: custom, hovertemplate: hover,
        colorbar: { title: { text: 'Distanz', side: 'right' }, thickness: 12, outlinewidth: 0, len: 0.9 } },
    ], {
      margin: { l: 48, r: 10, t: 6, b: 54 },
      xaxis: { type: 'category', showgrid: false, ticks: '', tickangle: -90, tickfont: { size: 9 },
        title: { text: 'Anfrage (zeitlich sortiert)' }, nticks: Math.min(vt.length, 45) },
      yaxis: { autorange: 'reversed', showgrid: false, ticks: '' },
      shapes: selIdx >= 0 ? [{ type: 'rect', xref: 'x', yref: 'paper', x0: selIdx - 0.5, x1: selIdx + 0.5, y0: -0.02, y1: 1.02,
        line: { color: C.accent, width: 2.5 }, fillcolor: 'rgba(0,0,0,0)' }] : [],
    });
    filterNote.textContent = st.sizeFilter == null ? `${tasks.length} Anfragen` : `Filter: ${st.sizeFilter} Kandidaten · ${vt.length} von ${tasks.length} Anfragen`;
  }

  function drawSizes() {
    const rows = sizeRows();
    plot(sizeChart, [{
      type: 'bar', x: rows.map((r) => r.n), y: rows.map((r) => r.count), text: rows.map((r) => r.count), textposition: 'outside', cliponaxis: false,
      marker: { color: rows.map((r) => (st.sizeFilter == null || st.sizeFilter === r.n ? C.series : C.axis)) },
      hovertemplate: '%{x} Kandidaten: %{y} Anfragen<br>Klicken zum Filtern<extra></extra>',
    }], { margin: { l: 44, r: 10, t: 16, b: 42 }, xaxis: { dtick: 1, title: { text: 'Kandidaten' } }, yaxis: { title: { text: 'Anfragen' } } });
  }

  function drawSelection() {
    const t = tasks.find((x) => x.transport_id === st.selected);
    if (!t) { details.replaceChildren(el('p', { class: 'hint' }, 'Keine Anfrage ausgewählt.')); return; }
    const rows = byTask.get(t.transport_id) || [];
    const pickup = { x: t.from_entity_x, y: t.from_entity_y };
    map.setRobots(rows.map((m) => ({ ...m, dim: !m.eligible, extra: m.eligible ? `Kandidat · Distanz ${m.dist_to_pickup}` : 'kein Kandidat' })));
    map.setHalos([{ ...pickup, color: C.accent }, { x: t.to_entity_x, y: t.to_entity_y, color: C.ink2, r: 9 }]);
    map.setArrows([{ from: pickup, to: { x: t.to_entity_x, y: t.to_entity_y }, color: C.accent, width: 2.8 }]);
    map.setLines(rows.filter((m) => m.eligible).map((m) => ({ from: { x: m.x, y: m.y }, to: pickup, label: m.dist_to_pickup, color: C.series })));

    const path = t.path_unreachable ? `unerreichbar (Sentinel ${nf(t.path_steps_raw)})` : `${nf(t.path_steps)} Schritte`;
    const best = rows.filter((m) => m.eligible).sort((a, b) => a.dist_to_pickup - b.dist_to_pickup)[0];
    details.replaceChildren(
      el('h3', {}, `Anfrage #${t.transport_id} · t = ${nf(t.time)} s`),
      el('dl', { class: 'kv' },
        el('dt', {}, 'Material'), el('dd', {}, `${stageLabel(t.material_stage)} · Produkt ${t.product}`),
        el('dt', {}, 'Von → Nach'), el('dd', {}, `${t.from_entity} → ${t.to_entity}`),
        el('dt', {}, 'Bereich'), el('dd', {}, t.task_area ? el('span', { class: 'tag' }, el('span', { class: 'swatch', style: { background: areaColor(t.task_area) } }), areaLabel(t.task_area)) : 'ohne Bereich'),
        el('dt', {}, 'Pfadlänge'), el('dd', {}, `${path} · Manhattan ${nf(t.manhattan)}`),
        el('dt', {}, 'Kandidaten'), el('dd', {}, `${t.n_eligible} von ${robots.length}`),
        el('dt', {}, 'Nächster Kandidat'), el('dd', {}, best ? `R${best.robot_id} (${best.dist_to_pickup} Felder)` : '– niemand frei'),
        lifecycleText(t) ? el('dt', {}, 'Tatsächlich (Simulation)') : null,
        lifecycleText(t) ? el('dd', {}, el('strong', {}, lifecycleText(t))) : null),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Roboter'), el('th', {}, 'Status'), el('th', {}, 'frei'), el('th', {}, 'zuständig'), el('th', { class: 'num' }, 'Distanz'))),
        el('tbody', {}, rows.map((m) => el('tr', { class: m.eligible ? '' : 'dim' },
          el('td', {}, `R${m.robot_id}${m.eligible ? ' ✓' : ''}`, t.assigned_robot === m.robot_id ? el('span', { class: 'tag', style: { marginLeft: '6px' } }, 'übernommen') : null),
          el('td', {}, el('span', { class: 'tag' }, el('span', { class: 'swatch', style: { background: statusColor(m.status) } }), statusLabel(m.status))),
          el('td', { class: m.available ? 'ok' : 'no' }, m.available ? 'ja' : 'nein'),
          el('td', { class: m.in_aor ? 'ok' : 'no' }, m.in_aor ? 'ja' : 'nein'),
          el('td', { class: 'num' }, nf(m.dist_to_pickup))))))));
  }

  function select(id) {
    st.selected = id;
    drawHeat();
    drawSelection();
  }

  function step(dir) {
    const vt = visibleTasks();
    const i = vt.findIndex((t) => t.transport_id === st.selected);
    const next = vt[Math.max(0, Math.min(vt.length - 1, (i < 0 ? 0 : i + dir)))];
    if (next) select(next.transport_id);
  }

  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  const onKey = (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  };
  document.addEventListener('keydown', onKey);

  drawHeat();
  drawSizes();
  drawSelection();
  heat.on('plotly_click', (ev) => {
    const p = ev.points && ev.points[0];
    if (p) select(Number(String(p.x).replace('#', '')));
  });
  sizeChart.on('plotly_click', (ev) => {
    const n = ev.points && ev.points[0] ? ev.points[0].x : null;
    st.sizeFilter = st.sizeFilter === n ? null : n;
    const vt = visibleTasks();
    if (!vt.some((t) => t.transport_id === st.selected) && vt.length) st.selected = vt[0].transport_id;
    drawSizes();
    drawHeat();
    drawSelection();
  });

  return () => document.removeEventListener('keydown', onKey);
}
