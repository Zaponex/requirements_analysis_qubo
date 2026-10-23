// Kleine Hilfsfunktionen für DOM, Zahlen und Statistik – ohne externe Bibliotheken.

export function el(tag, attrs = {}, ...children) {
  return build(document.createElement(tag), attrs, children);
}

export function svg(tag, attrs = {}, ...children) {
  return build(document.createElementNS('http://www.w3.org/2000/svg', tag), attrs, children);
}

function build(node, attrs, children) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Ersetzt den Inhalt eines Elements; null/false werden übersprungen (replaceChildren würde „null“ schreiben). */
export function fill(host, ...children) {
  host.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return host;
}

/** Lebenslauf eines Auftrags in einem Satz (nur bei Logs mit ASSIGNED/COMPLETED/…), sonst null. */
export function lifecycleText(t) {
  if (!t || t.outcome == null) return null;
  const who = t.assigned_agent ? `${t.assigned_agent.startsWith('W') ? `Werker ${t.assigned_agent.slice(1)}` : t.assigned_agent}` : null;
  const parts = [];
  if (who) parts.push(`${who}, zugewiesen nach ${nf(t.wait_until_assigned)} s`);
  else parts.push('keine Zuweisung');
  if (t.outcome === 'abgeschlossen') parts.push(`abgeschlossen nach ${nf(t.lead_time)} s${t.completed_by === 'conveyor' ? ' (Förderband)' : ''}`);
  else if (t.outcome === 'abgebrochen') parts.push(`abgebrochen${t.abort_reason ? ` (${t.abort_reason})` : ''}`);
  else parts.push('am Log-Ende noch offen');
  return parts.join(' · ');
}

/** Zahl im deutschen Format; null/NaN → „–“. */
export function nf(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '–';
  return Number(v).toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function pct(v, digits = 1) {
  return v == null ? '–' : `${nf(v * 100, digits)} %`;
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function countBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

export function median(values) {
  const v = values.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function mean(values) {
  const v = values.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Anfragen je Zeitfenster [k·w, (k+1)·w) ab t0 – inklusive leerer Fenster (wie features.requests_per_window). */
export function windowCounts(times, w, t0 = 0, tEnd = null) {
  if (!times.length) return [];
  const end = tEnd ?? Math.max(...times);
  const n = Math.floor((end - t0) / w) + 1;
  const counts = new Array(n).fill(0);
  for (const t of times) {
    const k = Math.floor((t - t0) / w);
    if (k >= 0 && k < n) counts[k] += 1;
  }
  return counts.map((c, k) => ({ start: t0 + k * w, end: t0 + (k + 1) * w, count: c }));
}

export function uniq(arr) {
  return [...new Set(arr)];
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------- Tooltip (für SVG-Elemente)
const tipEl = () => document.getElementById('tooltip');

export function showTip(evt, html) {
  const tip = tipEl();
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14;
  const { innerWidth: W, innerHeight: H } = window;
  const r = tip.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + r.width > W - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > H - 8) y = evt.clientY - r.height - pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

export function hideTip() {
  tipEl().hidden = true;
}

/** Hängt einen Tooltip an ein Element; html darf eine Funktion sein. */
export function withTip(node, html) {
  node.addEventListener('mousemove', (e) => showTip(e, typeof html === 'function' ? html() : html));
  node.addEventListener('mouseleave', hideTip);
  return node;
}

export function tipHtml(title, rows = []) {
  return `<div class="tt-title">${escapeHtml(title)}</div>${rows
    .filter(Boolean)
    .map((r) => `<div class="tt-row">${r}</div>`)
    .join('')}`;
}

export function safeStorage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
  return null;
}
