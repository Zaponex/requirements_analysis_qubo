// Kopplungsgraph: Knoten = Variablen (Qubits), Linien = Kopplungen.
// Layout als Schachbrett (Zeilen = Aufträge, Spalten = Roboter) wie im One-Hot-Kapitel.
import { svg, withTip, tipHtml, nf } from '../util.js';
import { C, TERM_COLORS } from '../theme.js';

export function createGraphView(host, { variables, rowKeys, colKeys, rowLabel, colLabel, varName, colorOf }) {
  const color = colorOf || ((p) => TERM_COLORS[p.kind]);
  const dx = 92;
  const dy = 120;
  const L = 70;
  const T = 46;
  const W = L + Math.max(colKeys.length - 1, 0) * dx + 50;
  const H = T + Math.max(rowKeys.length - 1, 0) * dy + 60;
  const pos = variables.map((v) => ({
    x: L + colKeys.indexOf(v.col) * dx,
    y: T + rowKeys.indexOf(v.row) * dy,
  }));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'qubo-graph', role: 'img', 'aria-label': 'Kopplungsgraph' });
  const edgeLayer = svg('g');
  const nodeLayer = svg('g');
  root.append(edgeLayer, nodeLayer);
  rowKeys.forEach((r, k) => root.append(svg('text', { x: 8, y: T + k * dy + 4, class: 'glabel' }, rowLabel(r))));
  colKeys.forEach((c, k) => root.append(svg('text', { x: L + k * dx, y: 16, 'text-anchor': 'middle', class: 'glabel' }, colLabel(c))));

  const nodes = variables.map((v, i) => {
    const circle = svg('circle', { cx: pos[i].x, cy: pos[i].y, r: 17, class: 'gnode' });
    const label = svg('text', { x: pos[i].x, y: pos[i].y + 4, 'text-anchor': 'middle', class: 'gnode-label' }, varName(i));
    const g = svg('g', {}, circle, label);
    withTip(g, () => tipHtml(varName(i), [`Kosten ${nf(v.cost)}`, g.__on ? 'an (1)' : 'aus (0)']));
    nodeLayer.append(g);
    return { g, circle, label };
  });
  host.replaceChildren(root);

  return {
    update(model, x) {
      edgeLayer.replaceChildren();
      for (const e of model.entries) {
        if (e.i === e.j || !e.activeParts.length || e.value === 0) continue;
        const a = pos[e.i];
        const b = pos[e.j];
        const active = x[e.i] && x[e.j];
        let d;
        if (a.y === b.y && Math.abs(a.x - b.x) > dx + 1) {
          const h = 18 + 0.22 * Math.abs(b.x - a.x);
          d = `M${a.x},${a.y} Q${(a.x + b.x) / 2},${a.y - h} ${b.x},${b.y}`;
        } else if (a.x === b.x && Math.abs(a.y - b.y) > dy + 1) {
          const w = 18 + 0.22 * Math.abs(b.y - a.y);
          d = `M${a.x},${a.y} Q${a.x + w},${(a.y + b.y) / 2} ${b.x},${b.y}`;
        } else {
          d = `M${a.x},${a.y} L${b.x},${b.y}`;
        }
        const path = svg('path', { d, fill: 'none', stroke: color(e.activeParts[0]), 'stroke-width': active ? 4.5 : 1.8,
          opacity: active ? 1 : 0.6, 'stroke-linecap': 'round' });
        withTip(path, tipHtml(`Kopplung ${varName(e.i)} – ${varName(e.j)}`, [`Wert ${nf(e.value, 1)}`, active ? '<b>beide an – zählt</b>' : 'zählt, wenn beide an sind']));
        edgeLayer.append(path);
      }
      nodes.forEach((nd, i) => {
        nd.g.__on = Boolean(x[i]);
        nd.circle.setAttribute('fill', x[i] ? C.series : C.surface);
        nd.circle.setAttribute('stroke', x[i] ? C.series : C.ink2);
        nd.label.setAttribute('fill', x[i] ? '#fff' : C.ink);
      });
    },
  };
}
