// QUBO-Matrix als SVG: Zellen nach Herkunft eingefärbt, Hover erklärt die Zusammensetzung,
// umrandete Zellen zählen im aktuellen Zustand für die Energie.
import { svg, withTip, tipHtml, nf } from '../util.js';
import { C, TERM_COLORS, TERM_TINTS } from '../theme.js';

/**
 * @param {HTMLElement} host
 * @param {{labels: string[], describePart: (part, A, B) => string, varName: (i) => string}} o
 *   colorOf / tintOf (optional): Farbe eines Beitrags – sonst nach Termart (TERM_COLORS)
 */
export function createMatrixView(host, { labels, describePart, varName, onCellClick, colorOf, tintOf }) {
  const color = colorOf || ((p) => TERM_COLORS[p.kind]);
  const tint = tintOf || ((p) => TERM_TINTS[p.kind]);
  const n = labels.length;
  const s = Math.max(16, Math.min(40, Math.floor(560 / Math.max(n, 1))));
  const L = 64;
  const W = L + n * s + 8;
  const root = svg('svg', { viewBox: `0 0 ${W} ${W}`, class: 'qubo-matrix', role: 'img', 'aria-label': 'QUBO-Matrix' });
  const cells = new Map();
  for (let i = 0; i < n; i += 1) {
    root.append(svg('text', { x: L - 6, y: L + i * s + s / 2 + 4, 'text-anchor': 'end', class: 'mlabel' }, labels[i]));
    root.append(svg('text', { x: 0, y: 0, class: 'mlabel', transform: `translate(${L + i * s + s / 2 + 4},${L - 6}) rotate(-60)` }, labels[i]));
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      const rect = svg('rect', { x: L + j * s + 1, y: L + i * s + 1, width: s - 2, height: s - 2, rx: 3, class: 'mcell' });
      const text = svg('text', { x: L + j * s + s / 2, y: L + i * s + s / 2 + 4, 'text-anchor': 'middle', class: 'mvalue' });
      const g = svg('g', {}, rect, text);
      root.append(g);
      cells.set(`${i},${j}`, { g, rect, text, entry: null });
      if (onCellClick) g.addEventListener('click', () => onCellClick(i, j));
    }
  }
  host.replaceChildren(root);

  return {
    update(model, x) {
      const byKey = new Map(model.entries.map((e) => [`${e.i},${e.j}`, e]));
      for (const [key, cell] of cells) {
        const [i, j] = key.split(',').map(Number);
        const e = byKey.get(key);
        const parts = e ? e.activeParts : [];
        const v = e ? e.value : 0;
        const main = parts.find((p) => p.kind === 'kosten') || parts[0];
        const active = x[i] && x[j] && parts.length > 0;
        cell.rect.setAttribute('fill', parts.length ? tint(main) : C.surface);
        cell.rect.setAttribute('stroke', active ? C.ink : C.grid);
        cell.rect.setAttribute('stroke-width', active ? 2.5 : 1);
        cell.text.textContent = parts.length && s >= 24 ? fmt(v) : '';
        cell.g.style.cursor = parts.length ? 'help' : 'default';
        cell.g.onmousemove = null;
        if (parts.length) {
          const lines = parts.map((p) => `<span style="color:${color(p)}">■</span> ${describePart(p, model.A, model.B)}`);
          const title = i === j ? `Q[${varName(i)}] – Diagonale` : `Q[${varName(i)}, ${varName(j)}] – Kopplung`;
          withTipOnce(cell.g, tipHtml(title, [...lines, `<b>Summe: ${fmt(v)}</b>`,
            i === j ? 'zählt, wenn dieser Schalter an ist' : 'zählt, wenn beide Schalter an sind',
            active ? '<b>zählt gerade mit</b> (umrandet)' : null]));
        } else {
          withTipOnce(cell.g, null);
        }
      }
    },
  };
}

function fmt(v) {
  return nf(v, 1).replace('-', '−');
}

// Tooltip-Inhalt austauschbar halten, ohne Listener zu stapeln
function withTipOnce(node, html) {
  node.__tip = html;
  if (!node.__tipBound) {
    node.__tipBound = true;
    withTip(node, () => node.__tip || '');
    node.addEventListener('mousemove', () => {
      if (!node.__tip) document.getElementById('tooltip').hidden = true;
    });
  }
}
