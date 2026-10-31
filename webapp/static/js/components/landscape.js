// Normierte QUBO-Matrix (Heatmap Q / max|Q|) und Energielandschaft (3D) – gemeinsam für alle Kodierungsseiten.
// Landschaft: Die Bits werden auf zwei Achsen verteilt, jede in Gray-Reihenfolge – benachbarte Zellen
// unterscheiden sich in genau einem Bit. Höhe = Energie. Bis 16 Qubits alle Zustände exakt; bis 22 je Zelle
// die kleinste Energie über die übrigen Bits; darüber ein Schnitt durch das Minimum (16 Bits variiert).
import { el, fill, nf } from '../util.js';
import { C, plot } from '../theme.js';
import { energy } from '../qubo/engine.js';

// Divergierend: Blau (negativ, Belohnung) ↔ neutrales Grau ↔ Rot (positiv, Strafe), gleich viele Stufen je Arm
const DIVERGING = [[0, '#0d366b'], [0.2, '#2a78d6'], [0.4, '#b7d3f6'], [0.5, '#f0efec'], [0.6, '#f4c3c2'], [0.8, '#e34948'], [1, '#8f1d1d']];
// Sequentiell (eine Farbe): tiefe Täler dunkel, Höhen hell
const DEPTH = [[0, '#0d366b'], [0.2, '#184f95'], [0.4, '#256abf'], [0.6, '#5598e7'], [0.8, '#9ec5f4'], [1, '#cde2fb']];
const EXACT_BITS = 16;
const PROJECT_BITS = 22;
const fmt = (v) => nf(v, 1).replace('-', '−');
const gray = (k) => k ^ (k >> 1);
function grayInv(g) {
  let k = 0;
  for (; g; g >>= 1) k ^= g;
  return k;
}

/** Läuft alle Belegungen der ersten nb Bits per Gray-Code ab (übrige Bits wie in x0) und meldet (Maske, Energie). */
function grayWalk(model, nb, x0, visit) {
  const x = Uint8Array.from(x0);
  for (let i = 0; i < nb; i += 1) x[i] = 0;
  let E = energy(model, x);
  let mask = 0;
  visit(0, E);
  const total = 2 ** nb;
  for (let k = 1; k < total; k += 1) {
    const b = 31 - Math.clz32(k & -k);
    let delta = model.diag[b];
    for (const [j, q] of model.nbr[b]) if (x[j]) delta += q;
    if (x[b]) { E -= delta; x[b] = 0; } else { E += delta; x[b] = 1; }
    mask ^= 1 << b;
    visit(mask, E);
  }
}

/** Gitter der Landschaft: Achsen-Bits, Energien je Zelle und wie sie entstanden sind. */
function computeGrid(model, ref) {
  const n = model.n;
  if (n <= EXACT_BITS) {
    const a = Math.ceil(n / 2);
    const all = new Float64Array(2 ** n);
    grayWalk(model, n, new Uint8Array(n), (m, E) => { all[m] = E; });
    return { mode: 'exakt', a, b: n - a, cell: (m) => all[m] ?? Infinity, rest: 0 };
  }
  const a = 8;
  const b = 8;
  const cells = new Float64Array(1 << 16).fill(Infinity);
  if (n <= PROJECT_BITS) {
    grayWalk(model, n, new Uint8Array(n), (m, E) => { const c = m & 0xffff; if (E < cells[c]) cells[c] = E; });
    return { mode: 'projektion', a, b, cell: (m) => cells[m], rest: n - 16 };
  }
  grayWalk(model, 16, ref, (m, E) => { cells[m] = E; });
  return { mode: 'schnitt', a, b, cell: (m) => cells[m], rest: n - 16 };
}

const lowBits = (x, from, count) => {
  let v = 0;
  for (let i = 0; i < count; i += 1) if (x[from + i]) v |= 1 << i;
  return v;
};
const pattern = (v, count) => Array.from({ length: count }, (_, i) => ((v >> i) & 1 ? '1' : '0')).join('');

/**
 * @param {HTMLElement} normHost  Karte für die normierte Matrix
 * @param {HTMLElement} landHost  Karte für die Energielandschaft
 */
export function createLandscape(normHost, landHost) {
  const normChart = el('div', { class: 'chart land-norm' });
  const normNote = el('p', { class: 'hint' });
  const logBox = el('input', { type: 'checkbox' });
  const landChart = el('div', { class: 'chart land-3d' });
  const landNote = el('p', { class: 'hint' });
  fill(normHost, normNote, normChart);
  fill(landHost, el('div', { class: 'filter-group' }, el('label', { class: 'filter-group' }, logBox,
    el('span', { class: 'hint' }, 'Höhe logarithmisch: log₁₀(E − E_min + 1) – zeigt die Täler neben hohen Strafwänden'))), landChart, landNote);
  let last = null;
  let gridCache = { key: null, grid: null, valid: null };
  let timer = null;
  logBox.addEventListener('change', () => draw());

  function drawMatrix({ model, labels }) {
    const n = model.n;
    const vals = model.entries.filter((e) => e.value !== 0);
    const maxAbs = Math.max(0, ...vals.map((e) => Math.abs(e.value)));
    const minAbs = vals.length ? Math.min(...vals.map((e) => Math.abs(e.value))) : 0;
    const z = Array.from({ length: n }, () => new Array(n).fill(null));
    const text = Array.from({ length: n }, () => new Array(n).fill(''));
    for (const e of vals) {
      z[e.i][e.j] = maxAbs ? e.value / maxAbs : 0;
      text[e.i][e.j] = `Q[${labels[e.i]}${e.i === e.j ? '' : `, ${labels[e.j]}`}] = ${fmt(e.value)}<br>normiert ${nf(e.value / maxAbs, 3).replace('-', '−')}`;
    }
    const ratio = minAbs ? maxAbs / minAbs : 0;
    normNote.innerHTML = vals.length
      ? `max |Q| = <b>${fmt(maxAbs)}</b> · kleinster |Q| ≠ 0 = <b>${fmt(minAbs)}</b> · Dynamikbereich <b>${nf(ratio, 0)} : 1</b>
        ≈ <b>${nf(Math.log2(Math.max(ratio, 1)), 1)} Bit</b> Auflösung, damit die Hardware den kleinsten Koeffizienten noch trifft.`
      : 'Keine aktiven Einträge.';
    const ticks = n <= 40;
    plot(normChart, [{
      type: 'heatmap', z, x: labels, y: labels, text, hovertemplate: '%{text}<extra></extra>', hoverongaps: false,
      colorscale: DIVERGING, zmin: -1, zmax: 1, zmid: 0, xgap: 1, ygap: 1,
      colorbar: { title: { text: 'Q / max|Q|', side: 'right' }, thickness: 12, len: 0.9, tickvals: [-1, -0.5, 0, 0.5, 1] },
    }], {
      margin: { l: ticks ? 64 : 20, r: 10, t: ticks ? 64 : 20, b: 10 },
      xaxis: { side: 'top', showgrid: false, showticklabels: ticks, tickangle: -60, type: 'category' },
      yaxis: { autorange: 'reversed', showgrid: false, showticklabels: ticks, type: 'category' },
    });
  }

  function drawLandscape() {
    const { model, labels, x, minX, validMasks, isValid, cacheKey } = last;
    const n = model.n;
    const key = cacheKey ?? model;
    if (gridCache.key !== key) {
      const grid = computeGrid(model, minX || x);
      let valid = null;
      if (grid.mode === 'exakt') {
        if (validMasks) valid = validMasks;
        else if (isValid) {
          valid = [];
          for (let m = 0; m < 2 ** n; m += 1) {
            const xx = Uint8Array.from({ length: n }, (_, i) => (m >> i) & 1);
            if (isValid(xx)) valid.push(m);
          }
        }
      }
      gridCache = { key, grid, valid };
    }
    const { grid, valid } = gridCache;
    const W = 1 << grid.a;
    const H = 1 << grid.b;
    let Emin = Infinity;
    let Emax = -Infinity;
    for (let m = 0; m < W * H; m += 1) {
      const E = grid.cell(m);
      if (E < Emin) Emin = E;
      if (E > Emax) Emax = E;
    }
    const useLog = logBox.checked;
    const tf = (E) => (useLog ? Math.log10(Math.max(0, E - Emin) + 1) : E);
    const axPat = Array.from({ length: W }, (_, g) => pattern(gray(g), grid.a));
    const ayPat = Array.from({ length: H }, (_, g) => pattern(gray(g), grid.b));
    const Z = [];
    const T = [];
    for (let gy = 0; gy < H; gy += 1) {
      const row = new Array(W);
      const trow = new Array(W);
      for (let gx = 0; gx < W; gx += 1) {
        const E = grid.cell(gray(gx) | (gray(gy) << grid.a));
        row[gx] = tf(E);
        trow[gx] = `${axPat[gx]} | ${ayPat[gy]}<br>E = ${fmt(E)}`;
      }
      Z.push(row);
      T.push(trow);
    }
    const pos = (xx) => ({ gx: grayInv(lowBits(xx, 0, grid.a)), gy: grayInv(lowBits(xx, grid.a, grid.b)) });
    const marker = (xx, name, color, symbol, size) => {
      const p = pos(xx);
      const E = energy(model, xx);
      return { type: 'scatter3d', mode: 'markers', name, x: [p.gx], y: [p.gy], z: [tf(E)],
        marker: { color, symbol, size, line: { color: C.surface, width: 2 } }, hovertemplate: `${name}: E = ${fmt(E)}<extra></extra>` };
    };
    const traces = [{ type: 'surface', z: Z, text: T, hovertemplate: '%{text}<extra></extra>', colorscale: DEPTH, showscale: false,
      name: 'Landschaft', showlegend: false }];
    if (valid?.length && valid.length <= 3000) {
      traces.push({ type: 'scatter3d', mode: 'markers', name: 'gültige Zustände', x: valid.map((m) => grayInv(m & (W - 1))),
        y: valid.map((m) => grayInv(m >> grid.a)), z: valid.map((m) => tf(grid.cell(m))),
        marker: { color: C.good, size: 4, symbol: 'circle' }, hovertemplate: 'gültig: E = %{customdata}<extra></extra>', customdata: valid.map((m) => fmt(grid.cell(m))) });
    }
    if (minX) traces.push(marker(minX, 'Minimum', C.ink, 'diamond', 7));
    if (x) traces.push(marker(x, 'dein Zustand', C.accent, 'circle', 7));
    // Bitmuster als Achsenbeschriftung nur bei kurzen Achsen – sonst stehen sie im Hover
    const ticks = (len, pats) => (len <= 8
      ? { tickvals: pats.map((_, k) => k), ticktext: pats, tickfont: { size: 10 } }
      : { showticklabels: false });
    const axisTitle = (from, count) => (count === 1 ? labels[from] : `${labels[from]} … ${labels[from + count - 1]}`);
    plot(landChart, traces, {
      margin: { l: 0, r: 0, t: 10, b: 0 },
      legend: { orientation: 'h', x: 0, y: 1.02 },
      scene: {
        xaxis: { title: { text: axisTitle(0, grid.a) }, ...ticks(W, axPat), backgroundcolor: C.surface, gridcolor: C.grid },
        yaxis: { title: { text: axisTitle(grid.a, grid.b) }, ...ticks(H, ayPat), backgroundcolor: C.surface, gridcolor: C.grid },
        zaxis: { title: { text: useLog ? 'log₁₀(E − E_min + 1)' : 'Energie E' }, backgroundcolor: C.surface, gridcolor: C.grid },
        aspectmode: 'manual', aspectratio: { x: 1, y: 1, z: 0.6 },
        camera: { eye: { x: 1.15, y: -1.3, z: 0.8 } },
      },
    });
    const how = {
      exakt: `alle ${nf(2 ** n)} Zustände`,
      projektion: `je Zelle die kleinste Energie über die übrigen ${grid.rest} Bits (${nf(2 ** n)} Zustände durchlaufen)`,
      schnitt: `Schnitt durch das Minimum: die ersten 16 Bits variiert, die übrigen ${grid.rest} wie im Minimum`,
    }[grid.mode];
    landNote.innerHTML = `${how}. Achsen in Gray-Reihenfolge – Nachbarzellen unterscheiden sich in einem Bit. E von ${fmt(Emin)} bis ${fmt(Emax)}
      ${valid ? ` · ${nf(valid.length)} gültige Zustände (grün)` : ''}.`;
  }

  function draw() {
    if (!last) return;
    if (!normChart.offsetWidth) return; // verborgen: beim nächsten sichtbaren update
    drawMatrix(last);
    drawLandscape();
  }

  return {
    /** model (engine), labels je Bit, x (Zustand), minX (Minimum), validMasks oder isValid(x), cacheKey (ändert sich mit der QUBO). */
    update(state) {
      last = state;
      clearTimeout(timer);
      timer = setTimeout(draw, 120); // Regler bleiben flüssig
    },
  };
}
