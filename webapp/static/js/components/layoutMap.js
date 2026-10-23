// Interaktive Layout-Karte (SVG): Entitäten, Roboter, Pfeile, Distanzlinien.
// Wird von Zeitreise, Auftrag × Roboter und Materialfluss gemeinsam genutzt.
import { hideTip, svg, tipHtml, withTip, nf } from '../util.js';
import { C, AREA_ORDER, areaColor, areaLabel, statusColor, statusLabel } from '../theme.js';

const S = 13; // Pixel pro Gitterfeld
const PAD = 30;

export function createLayoutMap(container, { entities, robots, showBases = true, entityLabels = true }) {
  const xs = [...entities.map((e) => e.x), ...robots.map((r) => r.base_x)];
  const ys = [...entities.map((e) => e.y), ...robots.map((r) => r.base_y)];
  const xmin = Math.min(...xs) - 1;
  const xmax = Math.max(...xs) + 2;
  const ymin = Math.min(...ys) - 1;
  const ymax = Math.max(...ys) + 2;
  const W = (xmax - xmin) * S + 2 * PAD;
  const H = (ymax - ymin) * S + 2 * PAD;
  const px = (x) => PAD + (x - xmin) * S;
  const py = (y) => PAD + (ymax - y) * S; // y wächst nach oben – wie in den PNG-Berichten

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'layout-map', role: 'img', 'aria-label': 'Layout der Fabrik' });
  const defs = svg('defs');
  const layers = {};
  root.append(defs);
  for (const name of ['grid', 'trails', 'flows', 'lines', 'entities', 'labels', 'halos', 'bases', 'robots', 'top']) {
    layers[name] = svg('g', { class: `layer-${name}` });
    root.append(layers[name]);
  }
  container.replaceChildren(root);

  // ---------------------------------------------------------------- Raster
  for (let x = Math.ceil(xmin / 10) * 10; x <= xmax; x += 10) {
    layers.grid.append(svg('line', { class: 'gridline', x1: px(x), x2: px(x), y1: PAD - 6, y2: H - PAD + 6 }));
    layers.grid.append(svg('text', { class: 'ticklabel', x: px(x), y: H - 8, 'text-anchor': 'middle' }, x));
  }
  for (let y = Math.ceil(ymin / 5) * 5; y <= ymax; y += 5) {
    layers.grid.append(svg('line', { class: 'gridline', x1: PAD - 6, x2: W - PAD + 6, y1: py(y), y2: py(y) }));
    layers.grid.append(svg('text', { class: 'ticklabel', x: 8, y: py(y) + 3 }, y));
  }

  // ---------------------------------------------------------------- Entitäten
  const shape = (kind, x, y, r, fill) => {
    if (kind === 'Zwischenlager') return svg('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r, rx: 1.5, fill });
    if (kind === 'Quelle') return svg('path', { d: `M${x},${y - r - 1} L${x + r + 1},${y + r} L${x - r - 1},${y + r} Z`, fill });
    if (kind === 'Senke') return svg('path', { d: `M${x},${y + r + 1} L${x + r + 1},${y - r} L${x - r - 1},${y - r} Z`, fill });
    return svg('circle', { cx: x, cy: y, r, fill });
  };
  const entityPos = new Map();
  for (const e of entities) {
    const x = px(e.x);
    const y = py(e.y);
    entityPos.set(e.entity, { x, y });
    const fill = e.kind === 'Maschine' ? areaColor(e.area) : C.ink2;
    const node = shape(e.kind, x, y, 5.5, fill);
    node.setAttribute('class', 'entity');
    withTip(node, tipHtml(e.entity, [
      e.kind === 'Maschine' ? `Maschine · ${areaLabel(e.area)}` : e.kind,
      `Position (${e.x}, ${e.y})`,
      `${e.pickups} × Abholung · ${e.dropoffs} × Ziel`,
    ]));
    layers.entities.append(node);
    if (entityLabels) {
      const short = e.entity.split(':').pop().trim();
      const label = e.kind === 'Maschine' ? short : ({ Zwischenlager: `ZL ${short}` }[e.kind] || e.kind);
      layers.labels.append(svg('text', { class: 'entity-label', x: x + 7, y: y + 12 }, label));
    }
  }
  // Bereichsnamen einmal pro Cluster, über benachbarten Entitäten
  const machines = entities.filter((e) => e.kind === 'Maschine');
  const areas = [...new Set(machines.map((m) => m.area))];
  const placed = []; // bereits gesetzte Bereichsnamen – überlappende werden nach oben versetzt
  for (const a of areas) {
    const grp = machines.filter((m) => m.area === a);
    const gx = grp.map((m) => m.x);
    const gy = grp.map((m) => m.y);
    const near = entities.filter((e) => e.x >= Math.min(...gx) - 2 && e.x <= Math.max(...gx) + 2
      && e.y >= Math.min(...gy) && e.y <= Math.max(...gy) + 2);
    const top = Math.max(...near.map((e) => e.y), ...gy);
    const off = top === Math.max(...gy) ? 11 : 22;
    const cx = px(gx.reduce((s, v) => s + v, 0) / gx.length);
    const text = areaLabel(a);
    const w = text.length * 6.6; // grobe Textbreite bei 11px
    let y = py(top) - off;
    while (placed.some((p) => Math.abs(p.x - cx) < (p.w + w) / 2 + 4 && Math.abs(p.y - y) < 13)) y -= 13;
    placed.push({ x: cx, y, w });
    layers.labels.append(svg('text', { class: 'area-label', x: cx, y, 'text-anchor': 'middle' }, text));
  }

  // ---------------------------------------------------------------- Roboter-Basen
  if (showBases) {
    for (const r of robots) {
      const x = px(r.base_x);
      const y = py(r.base_y);
      const g = svg('g', { class: 'base' },
        svg('line', { x1: x - 5, x2: x + 5, y1: y, y2: y }), svg('line', { x1: x, x2: x, y1: y - 5, y2: y + 5 }));
      withTip(g, tipHtml(`Basis von R${r.robot_id}`, [`Position (${r.base_x}, ${r.base_y})`, 'abgeleitet aus Leerlauf-Positionen']));
      layers.bases.append(g);
    }
  }

  // ---------------------------------------------------------------- Dynamische Ebenen
  const markers = new Set();
  function marker(color) {
    const id = `arrow-${color.replace('#', '')}`;
    if (!markers.has(id)) {
      markers.add(id);
      defs.append(svg('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 9, markerHeight: 9,
        markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' }, svg('path', { d: 'M0,0 L10,5 L0,10 Z', fill: color })));
    }
    return `url(#${id})`;
  }

  /** Gebogener Pfeil von (x0,y0) nach (x1,y1) in Pixeln, Enden um shrink verkürzt. */
  function curve(x0, y0, x1, y1, bend = 0.15, shrink = 8) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const sx = x0 + ux * shrink;
    const sy = y0 + uy * shrink;
    const ex = x1 - ux * shrink;
    const ey = y1 - uy * shrink;
    const mx = (sx + ex) / 2 - uy * len * bend;
    const my = (sy + ey) / 2 + ux * len * bend;
    return { d: `M${sx},${sy} Q${mx},${my} ${ex},${ey}`, mx, my };
  }

  const robotNodes = new Map();

  const api = {
    root,
    px,
    py,
    entityPos,

    /** Pfeile zwischen Gitterpunkten: [{from:{x,y}, to:{x,y}, color, width, opacity, tip}] */
    setArrows(arrows, layer = 'flows') {
      layers[layer].replaceChildren();
      for (const a of arrows) {
        const c = curve(px(a.from.x), py(a.from.y), px(a.to.x), py(a.to.y), a.bend ?? 0.15);
        const path = svg('path', { class: 'flow', d: c.d, stroke: a.color || C.muted, 'stroke-width': a.width || 1.6,
          opacity: a.opacity ?? 0.8, 'marker-end': marker(a.color || C.muted) });
        if (a.tip) withTip(path, a.tip);
        layers[layer].append(path);
      }
    },

    /** Gerade Distanzlinien mit Beschriftung: [{from:{x,y}, to:{x,y}, label, color}] */
    setLines(lines) {
      layers.lines.replaceChildren();
      for (const l of lines) {
        const x0 = px(l.from.x);
        const y0 = py(l.from.y);
        const x1 = px(l.to.x);
        const y1 = py(l.to.y);
        layers.lines.append(svg('line', { class: 'dist-line', x1: x0, y1: y0, x2: x1, y2: y1, stroke: l.color || C.series,
          opacity: l.opacity ?? 0.9 }));
        if (l.label != null) {
          layers.lines.append(svg('text', { class: 'dist-label', x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 3,
            'text-anchor': 'middle', fill: l.color || C.series }, l.label));
        }
      }
    },

    /** Ringe um Gitterpunkte: [{x, y, color, r}] */
    setHalos(halos) {
      layers.halos.replaceChildren(...halos.map((h) => svg('circle', { class: 'halo', cx: px(h.x), cy: py(h.y),
        r: h.r || 11, stroke: h.color || C.accent })));
    },

    /** Spuren der Roboter: [{points:[{x,y}], color}] */
    setTrails(trails) {
      layers.trails.replaceChildren(...trails.filter((t) => t.points.length > 1).map((t) => svg('polyline', {
        class: 'trail', stroke: t.color || C.muted, points: t.points.map((p) => `${px(p.x)},${py(p.y)}`).join(' ') })));
    },

    /** Roboter an Position mit Status: [{robot_id, x, y, status, available, dim, extra}] – mit weicher Bewegung. */
    setRobots(states) {
      const seen = new Set();
      for (const r of states) {
        seen.add(r.robot_id);
        let node = robotNodes.get(r.robot_id);
        if (!node) {
          const ring = svg('circle', { class: 'ring', r: 12.5 });
          const body = svg('circle', { class: 'body', r: 9.5 });
          const label = svg('text', {}, String(r.robot_id).slice(-2));
          const g = svg('g', { class: 'robot' }, ring, body, label);
          node = { g, ring, body, label, data: r };
          withTip(g, () => {
            const d = node.data;
            return tipHtml(`Roboter ${d.robot_id}`, [
              `${statusLabel(d.status)}`,
              d.available ? '<span class="ok">verfügbar</span>' : 'belegt',
              `Position (${d.x}, ${d.y})`,
              d.battery_percent != null ? `Akku ${nf(d.battery_percent)} %` : null,
              d.extra || null,
            ]);
          });
          layers.robots.append(g);
          robotNodes.set(r.robot_id, node);
        }
        node.data = r;
        node.g.setAttribute('transform', `translate(${px(r.x)},${py(r.y)})`);
        node.g.classList.toggle('dim', Boolean(r.dim));
        node.g.style.display = '';
        node.body.setAttribute('fill', statusColor(r.status));
        // Leerlauf ist hellgrau – dort dunkle Schrift, sonst weiße
        node.label.setAttribute('fill', r.status === 'IDLE' ? C.ink : '#fff');
        node.ring.style.display = r.available ? '' : 'none';
      }
      for (const [id, node] of robotNodes) if (!seen.has(id)) node.g.style.display = 'none';
    },

    /** Beschriftungen an Gitterpunkten: [{x, y, text, color, dy}] */
    setLabels(labels) {
      layers.top.replaceChildren(...labels.map((l) => svg('text', {
        class: 'area-label', x: px(l.x), y: py(l.y) + (l.dy ?? -14), 'text-anchor': 'middle', style: { fill: l.color || C.ink },
      }, l.text)));
    },

    clearRobots() {
      layers.robots.replaceChildren();
      robotNodes.clear();
      hideTip();
    },
  };
  return api;
}

/** Legende für Bereiche, Entitätsarten und Roboter-Elemente. */
export function mapLegend({ statuses = [], showRobotRing = false, showBase = true, extra = [] } = {}) {
  const item = (swatch, label) => `<span class="legend-item">${swatch}${label}</span>`;
  const parts = AREA_ORDER.map((a) => item(`<span class="dot" style="background:${areaColor(a)}"></span>`, areaLabel(a)));
  parts.push(item(`<span class="swatch" style="background:${C.ink2}"></span>`, 'Zwischenlager / ▲ Quelle / ▼ Senke'));
  if (showBase) parts.push(item('<span style="color:#898781;font-weight:700">+</span>', 'Roboter-Basis'));
  for (const s of statuses) parts.push(item(`<span class="dot" style="background:${statusColor(s)}"></span>`, `Roboter: ${statusLabel(s)}`));
  if (showRobotRing) parts.push(item(`<span class="dot" style="background:none;border:2.5px solid ${C.good}"></span>`, 'Ring = verfügbar'));
  parts.push(...extra.map(([sw, label]) => item(sw, label)));
  const div = document.createElement('div');
  div.className = 'legend';
  div.innerHTML = parts.join('');
  return div;
}
