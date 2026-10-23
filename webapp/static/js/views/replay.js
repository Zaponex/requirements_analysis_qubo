// Ansicht „Zeitreise“: die Simulation Schritt für Schritt abspielen.
import { el, groupBy, lifecycleText, nf, svg, withTip, tipHtml, escapeHtml } from '../util.js';
import { C, STATUS_ORDER, areaColor, areaLabel, rootFontPx, stageLabel, statusColor, statusLabel } from '../theme.js';
import { createLayoutMap, mapLegend } from '../components/layoutMap.js';

const SPEEDS = [10, 30, 60, 120];
const WINDOWS = [30, 60, 120, 300];

export function renderReplay(root, { run, params = {} }) {
  const tasks = run.tasks; // nach Zeit sortiert
  const taskById = new Map(tasks.map((t) => [t.transport_id, t]));
  const fleetBySnap = groupBy(run.fleet, (r) => r.transport_id);
  const snaps = [...fleetBySnap.entries()]
    .map(([id, robots]) => ({ id, time: robots[0].time, robots }))
    .sort((a, b) => a.time - b.time || a.id - b.id);
  const matrixByTask = groupBy(run.matrix, (m) => m.transport_id);
  const times = [...new Set(tasks.map((t) => t.time))].sort((a, b) => a - b);
  const tEnd = Math.max(...times);
  const nRobots = run.robots.length;

  const startAt = Math.max(0, Math.min(tEnd, Number(params.t) || 0)); // Link auf einen Zeitpunkt: #/daten/zeitreise?t=300
  const st = { clock: startAt, playing: false, speed: 30, recent: 60, trails: true, pinned: null, timer: null };

  // ---------------------------------------------------------------- Bedienelemente
  const playBtn = el('button', { class: 'btn primary', type: 'button', title: 'Abspielen / Pause (Leertaste)' }, '▶ Abspielen');
  const slider = el('input', { type: 'range', min: 0, max: tEnd, step: 1, value: 0, 'aria-label': 'Simulationszeit' });
  const clockLabel = el('div', { class: 'clock' });
  const speedSel = el('select', { 'aria-label': 'Geschwindigkeit' }, SPEEDS.map((s) => el('option', { value: s }, `${s}× Echtzeit`)));
  speedSel.value = String(st.speed);
  const windowSel = el('select', { 'aria-label': 'Zeitfenster für Anfragen' }, WINDOWS.map((w) => el('option', { value: w }, `letzte ${w} s`)));
  windowSel.value = String(st.recent);
  const trailsBox = el('input', { type: 'checkbox', checked: true, id: 'trails' });

  const player = el('div', { class: 'player' },
    el('button', { class: 'btn', type: 'button', title: 'Zum Anfang', onclick: () => jump(0) }, '⏮'),
    el('button', { class: 'btn', type: 'button', title: 'Vorherige Anfrage (←)', onclick: () => stepRequest(-1) }, '◀'),
    playBtn,
    el('button', { class: 'btn', type: 'button', title: 'Nächste Anfrage (→)', onclick: () => stepRequest(1) }, '▶'),
    el('button', { class: 'btn', type: 'button', title: 'Zum Ende', onclick: () => jump(tEnd) }, '⏭'),
    slider, clockLabel,
    el('label', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Tempo'), speedSel),
    el('label', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Pfeile'), windowSel),
    el('label', { class: 'filter-group', for: 'trails' }, trailsBox, el('span', { class: 'filter-label' }, 'Spuren')));

  // ---------------------------------------------------------------- Layout
  const mapHost = el('div');
  const statusBar = el('div', { class: 'statusbar' });
  const panel = el('div');
  const timelineHost = el('div');

  root.append(el('p', {
    class: 'intro',
    html: `Spiele die Simulation ab: Roboter bewegen sich zu den Positionen der Flotten-Snapshots, neue
      <strong>Transportanfragen</strong> erscheinen als Pfeil (Abholung → Ziel). Für die aktuelle Anfrage zeigen
      <span style="color:${C.series}">blaue Linien</span> die Roboter, die in Frage kommen, mit ihrer Distanz.
      Bedienung auch per Tastatur: Leertaste, ← und →.`,
  }));
  root.append(el('div', { class: 'card', style: { marginBottom: '16px' } }, player, timelineHost,
    el('div', { class: 'hint' }, 'Zeitleiste: Striche = Anfragen, Fläche = Anzahl verfügbarer Roboter. Klicken springt zu diesem Zeitpunkt.')));
  root.append(el('div', { class: 'grid grid-main-side' },
    el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, 'Fabrik-Layout'),
        el('div', { class: 'card-sub' }, 'Snapshots gibt es nur zu Anfragezeitpunkten – dazwischen sind die Positionen unbekannt.'))),
      mapHost, statusBar,
      mapLegend({ statuses: STATUS_ORDER, showRobotRing: true, extra: [
        [`<span class="swatch" style="background:${C.accent};height:3px"></span>`, 'ausgewählte Anfrage'],
        [`<span class="swatch" style="background:${C.muted};height:3px"></span>`, 'weitere Anfragen im Fenster'],
        [`<span class="swatch" style="background:${C.series};height:2px"></span>`, 'Kandidat → Abholort (Distanz)'],
        [`<span class="swatch" style="background:none;border-top:2px dotted ${C.muted};height:0"></span>`, 'Spur eines Roboters im Fenster'],
      ] })),
    el('section', { class: 'card' }, panel)));

  const map = createLayoutMap(mapHost, { entities: run.entities, robots: run.robots });
  const timeline = buildTimeline(timelineHost);

  // ---------------------------------------------------------------- Logik
  const snapAt = (t) => {
    let s = snaps[0];
    for (const x of snaps) {
      if (x.time <= t + 1e-9) s = x;
      else break;
    }
    return s;
  };

  function selectedTask(t) {
    if (st.pinned != null) {
      const p = taskById.get(st.pinned);
      if (p && p.time <= t + 1e-9) return p;
    }
    let last = null;
    for (const x of tasks) {
      if (x.time <= t + 1e-9) last = x;
      else break;
    }
    return last;
  }

  function update() {
    const t = st.clock;
    const sel = selectedTask(t);
    const snap = snapAt(t);
    const shown = sel && fleetBySnap.has(sel.transport_id) && sel.time === snap.time ? fleetBySnap.get(sel.transport_id) : snap.robots;
    const candRows = sel ? matrixByTask.get(sel.transport_id) || [] : [];
    const candIds = new Set(candRows.filter((m) => m.eligible).map((m) => m.robot_id));

    map.setRobots(shown.map((r) => ({ ...r, extra: candIds.has(r.robot_id) ? 'Kandidat für die ausgewählte Anfrage' : null })));

    // Spuren: Positionen jedes Roboters im Zeitfenster
    if (st.trails) {
      const win = snaps.filter((s) => s.time <= t + 1e-9 && s.time >= t - st.recent);
      const byRobot = groupBy(win.flatMap((s) => s.robots), (r) => r.robot_id);
      map.setTrails([...byRobot.values()].map((rows) => ({ points: rows.map((r) => ({ x: r.x, y: r.y })), color: C.muted })));
    } else {
      map.setTrails([]);
    }

    // Anfragen im Fenster als Pfeile
    const recent = tasks.filter((x) => x.time <= t + 1e-9 && x.time > t - st.recent);
    const arrows = recent.map((x) => {
      const isSel = sel && x.transport_id === sel.transport_id;
      const age = (t - x.time) / st.recent;
      return {
        from: { x: x.from_entity_x, y: x.from_entity_y },
        to: { x: x.to_entity_x, y: x.to_entity_y },
        color: isSel ? C.accent : C.muted,
        width: isSel ? 2.8 : 1.6,
        opacity: isSel ? 1 : 0.25 + 0.6 * (1 - age),
        tip: tipHtml(`Anfrage #${x.transport_id} · t = ${nf(x.time)} s`, [
          `${escapeHtml(x.from_entity)} → ${escapeHtml(x.to_entity)}`, stageLabel(x.material_stage)]),
      };
    });
    if (sel && !recent.includes(sel)) {
      arrows.push({ from: { x: sel.from_entity_x, y: sel.from_entity_y }, to: { x: sel.to_entity_x, y: sel.to_entity_y }, color: C.accent, width: 2.8 });
    }
    map.setArrows(arrows);

    // Kandidaten-Linien und Markierungen
    if (sel) {
      const pickup = { x: sel.from_entity_x, y: sel.from_entity_y };
      map.setLines(candRows.filter((m) => m.eligible).map((m) => ({ from: { x: m.x, y: m.y }, to: pickup, label: m.dist_to_pickup, color: C.series })));
      map.setHalos([{ ...pickup, color: C.accent }, { x: sel.to_entity_x, y: sel.to_entity_y, color: C.ink2, r: 9 }]);
    } else {
      map.setLines([]);
      map.setHalos([]);
    }

    // Statusleiste
    const counts = new Map(STATUS_ORDER.map((s) => [s, 0]));
    for (const r of shown) counts.set(r.status, (counts.get(r.status) || 0) + 1);
    const nAvail = shown.filter((r) => r.available).length;
    statusBar.replaceChildren(
      el('span', { class: 'tag' }, `${nAvail} von ${shown.length} verfügbar`),
      ...[...counts].filter(([, n]) => n > 0).map(([s, n]) => el('span', { class: 'tag' },
        el('span', { class: 'swatch', style: { background: statusColor(s) } }), `${statusLabel(s)}: ${n}`)));

    renderPanel(sel, candRows, recent);

    slider.value = String(Math.round(t));
    const idx = sel ? tasks.indexOf(sel) + 1 : 0;
    clockLabel.innerHTML = `<strong>t = ${nf(t)} s</strong> (${formatMinutes(t)}) · Anfrage ${idx} von ${tasks.length}`;
    timeline.update(t, sel);
  }

  function renderPanel(sel, candRows, recent) {
    if (!sel) {
      panel.replaceChildren(el('h3', {}, 'Noch keine Anfrage'), el('p', { class: 'hint' }, 'Starte die Wiedergabe.'));
      return;
    }
    const path = sel.path_unreachable ? `unerreichbar (Sentinel ${nf(sel.path_steps_raw)})` : `${nf(sel.path_steps)} Schritte`;
    const robotsTable = el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Roboter'), el('th', {}, 'Status'), el('th', {}, 'frei'), el('th', { class: 'num' }, 'Distanz'))),
      el('tbody', {}, [...candRows].sort((a, b) => (b.eligible - a.eligible) || a.dist_to_pickup - b.dist_to_pickup).map((m) => el('tr', { class: m.eligible ? '' : 'dim' },
        el('td', {}, `R${m.robot_id}`, sel.assigned_robot === m.robot_id ? el('span', { class: 'tag', style: { marginLeft: '6px' } }, 'übernommen') : null),
        el('td', {}, el('span', { class: 'tag' }, el('span', { class: 'swatch', style: { background: statusColor(m.status) } }), statusLabel(m.status))),
        el('td', { class: m.available ? 'ok' : 'no' }, m.available ? '✓' : '–'),
        el('td', { class: 'num' }, m.eligible ? nf(m.dist_to_pickup) : '–')))));

    const list = el('ul', { class: 'request-list' }, [...recent].reverse().map((x) => {
      const li = el('li', { class: x === sel ? 'selected' : '', title: 'Diese Anfrage auswählen' },
        el('span', { class: 't' }, `${nf(x.time)} s`),
        el('span', {}, `#${x.transport_id} · ${x.task_area ? areaLabel(x.task_area) : 'ohne Bereich'}`));
      li.addEventListener('click', () => { st.pinned = x.transport_id; pause(); st.clock = x.time; update(); });
      return li;
    }));

    panel.replaceChildren(
      el('h3', {}, `Anfrage #${sel.transport_id}`),
      el('div', { class: 'card-sub' }, `eingegangen bei t = ${nf(sel.time)} s`),
      el('dl', { class: 'kv' },
        el('dt', {}, 'Material'), el('dd', {}, `${stageLabel(sel.material_stage)} · Produkt ${sel.product}`),
        el('dt', {}, 'Von'), el('dd', {}, sel.from_entity),
        el('dt', {}, 'Nach'), el('dd', {}, sel.to_entity),
        el('dt', {}, 'Bereich'), el('dd', {}, sel.task_area ? el('span', { class: 'tag' }, el('span', { class: 'swatch', style: { background: areaColor(sel.task_area) } }), areaLabel(sel.task_area)) : 'ohne Bereich'),
        el('dt', {}, 'Pfadlänge'), el('dd', {}, path),
        el('dt', {}, 'Kandidaten'), el('dd', { class: sel.n_eligible ? '' : 'no' }, `${sel.n_eligible} von ${nRobots} Robotern${sel.n_eligible ? '' : ' – muss warten'}`),
        lifecycleText(sel) ? el('dt', {}, 'Tatsächlich (Simulation)') : null,
        lifecycleText(sel) ? el('dd', {}, el('strong', {}, lifecycleText(sel))) : null),
      el('div', { class: 'table-wrap' }, robotsTable),
      el('h3', { style: { marginTop: '14px' } }, `Anfragen der letzten ${st.recent} s`),
      recent.length ? list : el('p', { class: 'hint' }, 'keine'));
  }

  // ---------------------------------------------------------------- Zeitleiste (SVG)
  function buildTimeline(host) {
    // Koordinaten in „Schriftgröße-15-Pixeln“: das SVG skaliert gleichmäßig mit der Grundschrift, ohne Verzerrung
    const W = Math.max(500, Math.round((host.clientWidth || 1000) / (rootFontPx() / 15)));
    const H = 90;
    const L = 36;
    const R = 12;
    const x = (t) => L + (t / (tEnd || 1)) * (W - L - R);
    const yA = (n) => 66 - (n / (nRobots || 1)) * 50;
    const root2 = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'timeline', role: 'img', 'aria-label': 'Zeitleiste der Anfragen' });
    // verfügbare Roboter als Stufenfläche (Wert je Anfrage-Snapshot)
    const pts = tasks.map((t) => [t.time, t.n_available]);
    let d = `M${x(0)},${yA(0)}`;
    let prevY = yA(pts.length ? pts[0][1] : 0);
    d += ` L${x(0)},${prevY}`;
    for (const [t, n] of pts) {
      d += ` L${x(t)},${prevY} L${x(t)},${yA(n)}`;
      prevY = yA(n);
    }
    d += ` L${x(tEnd)},${prevY} L${x(tEnd)},${yA(0)} Z`;
    root2.append(svg('path', { d, fill: '#cde2fb', stroke: C.series, 'stroke-width': 1, opacity: 0.9 }));
    for (let n = 0; n <= nRobots; n += Math.max(1, Math.round(nRobots / 2))) {
      root2.append(svg('text', { x: L - 6, y: yA(n) + 3, 'text-anchor': 'end', 'font-size': 10, fill: C.muted }, n));
    }
    for (let t = 0; t <= tEnd; t += 250) {
      root2.append(svg('text', { x: x(t), y: H - 2, 'text-anchor': 'middle', 'font-size': 10, fill: C.muted }, `${t} s`));
    }
    const ticks = svg('g');
    for (const t of tasks) {
      const line = svg('line', { x1: x(t.time), x2: x(t.time), y1: 68, y2: 78, stroke: C.ink2, 'stroke-width': 1.5 });
      withTip(line, tipHtml(`Anfrage #${t.transport_id}`, [`t = ${nf(t.time)} s`, `${t.n_eligible} Kandidaten`]));
      ticks.append(line);
    }
    root2.append(ticks);
    const selTick = svg('line', { y1: 64, y2: 80, stroke: C.accent, 'stroke-width': 3 });
    const cursor = svg('line', { y1: 6, y2: 80, stroke: C.accent, 'stroke-width': 2 });
    root2.append(selTick, cursor);
    root2.addEventListener('click', (e) => {
      const r = root2.getBoundingClientRect();
      const t = ((e.clientX - r.left) / r.width * W - L) / (W - L - R) * tEnd;
      st.pinned = null;
      st.clock = Math.max(0, Math.min(tEnd, t));
      update();
    });
    host.replaceChildren(root2);
    return {
      update(t, sel) {
        cursor.setAttribute('x1', x(t));
        cursor.setAttribute('x2', x(t));
        selTick.style.display = sel ? '' : 'none';
        if (sel) {
          selTick.setAttribute('x1', x(sel.time));
          selTick.setAttribute('x2', x(sel.time));
        }
      },
    };
  }

  // ---------------------------------------------------------------- Abspielen
  function play() {
    if (st.clock >= tEnd) st.clock = 0;
    st.playing = true;
    st.pinned = null;
    playBtn.textContent = '⏸ Pause';
    st.timer = setInterval(() => {
      st.clock = Math.min(tEnd, st.clock + st.speed * 0.1);
      update();
      if (st.clock >= tEnd) pause();
    }, 100);
  }
  function pause() {
    st.playing = false;
    clearInterval(st.timer);
    playBtn.textContent = '▶ Abspielen';
  }
  function jump(t) {
    pause();
    st.pinned = null;
    st.clock = t;
    update();
  }
  function stepRequest(dir) {
    pause();
    st.pinned = null;
    const eps = 1e-6;
    const target = dir > 0 ? times.find((t) => t > st.clock + eps) : [...times].reverse().find((t) => t < st.clock - eps);
    if (target != null) st.clock = target;
    update();
  }

  playBtn.addEventListener('click', () => (st.playing ? pause() : play()));
  slider.addEventListener('input', () => { pause(); st.pinned = null; st.clock = Number(slider.value); update(); });
  speedSel.addEventListener('change', () => { st.speed = Number(speedSel.value); });
  windowSel.addEventListener('change', () => { st.recent = Number(windowSel.value); update(); });
  trailsBox.addEventListener('change', () => { st.trails = trailsBox.checked; update(); });

  const onKey = (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea', 'button'].includes(tag)) return;
    if (e.key === ' ') { e.preventDefault(); st.playing ? pause() : play(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepRequest(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepRequest(-1); }
  };
  document.addEventListener('keydown', onKey);

  update();
  return () => {
    pause();
    document.removeEventListener('keydown', onKey);
  };
}

function formatMinutes(t) {
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return `${m}:${String(s).padStart(2, '0')} min`;
}
