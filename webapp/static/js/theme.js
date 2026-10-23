// Farbrollen und Beschriftungen – identisch zu analysis/plots.py, damit Website und PNG-Berichte
// dieselbe Sprache sprechen. Bereichs- und Statusfarben sind per validate_palette (alle Paare) geprüft.

export const C = {
  page: '#f9f9f7',
  surface: '#fcfcfb',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  neutral: '#f0efec',
  series: '#2a78d6',
  accent: '#eb6834',
  good: '#0ca30c',
  bad: '#d03b3b',
};

export const AREA_ORDER = ['ENTPACKUNG', 'VERBLISTERUNG', 'AUFROLLER', 'KONTROLLE', 'KOMMISSIONIERUNG'];
export const AREA_COLORS = {
  ENTPACKUNG: '#2a78d6',
  VERBLISTERUNG: '#1baf7a',
  AUFROLLER: '#eda100',
  KONTROLLE: '#008300',
  KOMMISSIONIERUNG: '#4a3aa7',
};

export const STATUS_ORDER = ['IDLE', 'MOVING_TO_PICKUP', 'LOADING', 'MOVING_TO_DROP_OFF', 'MOVING_TO_BASE'];
export const STATUS_COLORS = {
  IDLE: C.axis,
  MOVING_TO_PICKUP: '#2a78d6',
  LOADING: '#eb6834',
  MOVING_TO_DROP_OFF: '#1baf7a',
  MOVING_TO_BASE: '#4a3aa7',
};
export const STATUS_LABELS = {
  IDLE: 'Leerlauf',
  MOVING_TO_PICKUP: 'Fahrt zur Abholung',
  LOADING: 'Beladen',
  MOVING_TO_DROP_OFF: 'Fahrt zur Abgabe',
  MOVING_TO_BASE: 'Rückfahrt zur Basis',
};

export const FLOW_ORDER = ['Quelle', 'ENTPACKUNG', 'Zwischenlager', 'VERBLISTERUNG', 'AUFROLLER', 'KONTROLLE',
  'KOMMISSIONIERUNG', 'Senke'];
export const STAGE_ORDER = ['Roh', 'Entpackt', 'Ungerollt_Unkontr_Verpackt', 'Unkontr_Verpackt', 'Kontr_Verpackt',
  'Kommiss_Kontr_Verpackt'];

// Termarten der QUBO-Formulierungen (blau/orange/violett: alle Paare geprüft). Die Reihenfolge-Seite
// ergänzt grün (Vorgänger-Korrektur) und rosa (Lückenregel) – geprüft in der Folge
// kosten, reihenfolge, zeile, spalte, luecke; Terme tragen immer auch eine Beschriftung.
export const TERM_ORDER = ['kosten', 'zeile', 'spalte'];
export const TERM_COLORS = { kosten: '#2a78d6', zeile: '#eb6834', spalte: '#4a3aa7', reihenfolge: '#1baf7a', luecke: '#e87ba4' };
export const TERM_TINTS = { kosten: '#cde2fb', zeile: '#fbe0d4', spalte: '#dedaf3', reihenfolge: '#d1efe4', luecke: '#fae5ee' };
export const TERM_LABELS = {
  kosten: 'Kosten (Anfahrt)',
  zeile: 'Zeilenregel: genau ein Roboter je Auftrag',
  spalte: 'Spaltenregel: kein Roboter doppelt',
};
export const TERM_SHORT = { kosten: 'Kosten', zeile: 'Zeilenregel', spalte: 'Spaltenregel' };

// Sequentielle Blau-Skala (hell → dunkel) für Größen wie Distanzen und Anzahlen
export const SEQ_SCALE = [
  [0, '#b7d3f6'], [0.2, '#86b6ef'], [0.4, '#5598e7'], [0.6, '#2a78d6'], [0.8, '#1c5cab'], [1, '#0d366b'],
];

export const areaColor = (a) => AREA_COLORS[a] || C.ink2;
export const statusColor = (s) => STATUS_COLORS[s] || C.ink2;
export const statusLabel = (s) => STATUS_LABELS[s] || s;
export const areaLabel = (a) => (a ? a[0] + a.slice(1).toLowerCase() : 'ohne Bereich');
export const categoryOf = (kind, area) => (kind === 'Maschine' && area ? area : kind);
export const categoryLabel = (c) => (c && c === c.toUpperCase() ? areaLabel(c) : c);
export const stageLabel = (s) => (s || '').replaceAll('_', ' ');

export function ordered(values, order) {
  const present = [...new Set(values)];
  return [...order.filter((v) => present.includes(v)), ...present.filter((v) => !order.includes(v)).sort()];
}

// ---------------------------------------------------------------- Plotly
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const BASE_LAYOUT = {
  font: { family: FONT, size: 12, color: C.ink2 },
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  margin: { l: 56, r: 16, t: 10, b: 46 },
  separators: ',.',
  xaxis: { gridcolor: C.grid, linecolor: C.axis, zeroline: false, ticks: 'outside', tickcolor: C.axis, automargin: true },
  yaxis: { gridcolor: C.grid, linecolor: C.axis, zeroline: false, automargin: true },
  hoverlabel: { bgcolor: C.surface, bordercolor: C.axis, font: { family: FONT, color: C.ink, size: 12 } },
  legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { size: 11 } },
  bargap: 0.25,
};

function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  }
  return out;
}

/** Grundschrift der Seite in px – die Diagramme wachsen mit (siehe font-size in style.css). */
export function rootFontPx() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

export function plotLayout(overrides = {}) {
  const base = Math.round(rootFontPx() * 0.82);
  const scaled = merge(BASE_LAYOUT, {
    font: { size: base },
    hoverlabel: { font: { size: base + 1 } },
    legend: { font: { size: base - 1 } },
    margin: { l: 4.6 * base, r: 1.3 * base, t: 0.9 * base, b: 3.8 * base },
  });
  return merge(scaled, overrides);
}
export const axis = (overrides = {}) => merge(BASE_LAYOUT.xaxis, overrides);

export const PLOT_CONFIG = {
  displaylogo: false,
  responsive: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines', 'hoverCompareCartesian'],
};

export function plot(div, data, layout, config = {}) {
  return Plotly.react(div, data, plotLayout(layout), { ...PLOT_CONFIG, ...config });
}
