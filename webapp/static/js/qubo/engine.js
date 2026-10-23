// Rechenkern für QUBOs im Browser – unabhängig von der Kodierung.
// Ein Eintrag hat symbolische Gewichte: Wert = c + a·A + b·B + d·D, aufgeteilt in „parts“ je Regelart.

export const MAX_SEARCH_BITS = 22; // 2^22 ≈ 4 Mio. Zustände – im Browser noch flott
export const MAX_STORE_BITS = 16; // bis hierhin werden alle Energien für die Landschaft gespeichert

/** Wert eines Teil-Beitrags bei gegebenen Gewichten. */
export const partValue = (p, A, B, D = 0) => (p.c || 0) + (p.A || 0) * A + (p.B || 0) * B + (p.D || 0) * D;

/**
 * Baut ein auswertbares Modell. terms: {kosten, zeile, spalte, …} – nur aktive Regelarten zählen.
 * Rückgabe: Diagonale, Nachbarlisten, Konstante und die Einträge mit aktuellem Wert.
 */
export function makeModel(form, { A, B, D = 0, terms }) {
  const n = form.n;
  const diag = new Float64Array(n);
  const nbr = Array.from({ length: n }, () => []);
  const entries = [];
  for (const e of form.entries) {
    const parts = e.parts.filter((p) => terms[p.kind]);
    const v = parts.reduce((s, p) => s + partValue(p, A, B, D), 0);
    entries.push({ ...e, value: v, activeParts: parts });
    if (v === 0) continue;
    if (e.i === e.j) diag[e.i] += v;
    else {
      nbr[e.i].push([e.j, v]);
      nbr[e.j].push([e.i, v]);
    }
  }
  // Konstante: aufgeteilt nach Termart (const_parts, z.B. Domain Wall) – sonst nur die Zeilenregel (One-Hot)
  const constant = form.const_parts
    ? form.const_parts.filter((p) => terms[p.kind]).reduce((s, p) => s + partValue(p, A, B, D), 0)
    : (terms.zeile ? form.const.A * A : 0);
  return { n, diag, nbr, entries, constant, A, B, D, terms };
}

/**
 * Modell für Baukasten-Formulierungen (encodings/baukasten.py): Jeder Beitrag gehört zu einem Baustein
 * (p.term) und zählt mit dessen Gewicht; ausgeschaltete Bausteine zählen nicht.
 * weights, active: {Baustein-Kennung: Zahl bzw. true/false}
 */
export function makeTermModel(form, { weights, active }) {
  const n = form.n;
  const diag = new Float64Array(n);
  const nbr = Array.from({ length: n }, () => []);
  const entries = [];
  for (const e of form.entries) {
    const parts = e.parts.filter((p) => active[p.term]);
    const v = parts.reduce((s, p) => s + p.v * weights[p.term], 0);
    entries.push({ ...e, value: v, activeParts: parts });
    if (v === 0) continue;
    if (e.i === e.j) diag[e.i] += v;
    else {
      nbr[e.i].push([e.j, v]);
      nbr[e.j].push([e.i, v]);
    }
  }
  let constant = 0;
  for (const [t, c] of Object.entries(form.const)) if (active[t]) constant += c * weights[t];
  return { n, diag, nbr, entries, constant, weights, active };
}

export function energy(model, x) {
  let e = model.constant;
  for (let i = 0; i < model.n; i += 1) {
    if (!x[i]) continue;
    e += model.diag[i];
    for (const [j, q] of model.nbr[i]) if (j > i && x[j]) e += q;
  }
  return e;
}

export const toMask = (x) => x.reduce((m, b, i) => (b ? m | (1 << i) : m), 0);
export function fromMask(mask, n) {
  const x = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) x[i] = (mask >> i) & 1;
  return x;
}

/**
 * Probiert alle 2^n Zustände durch (Gray-Code: pro Schritt kippt genau ein Bit).
 * Liefert Minimum, die topK günstigsten Zustände und – bis MAX_STORE_BITS – alle Energien.
 */
export function search(model, topK = 10) {
  const { n } = model;
  if (n > MAX_SEARCH_BITS) return null;
  const total = 2 ** n;
  const all = n <= MAX_STORE_BITS ? new Float64Array(total) : null;
  const top = []; // [{E, mask}] aufsteigend
  const consider = (mask, E) => {
    if (all) all[mask] = E;
    if (top.length < topK || E < top[top.length - 1].E) {
      let k = top.length;
      while (k > 0 && top[k - 1].E > E) k -= 1;
      top.splice(k, 0, { E, mask });
      if (top.length > topK) top.pop();
    }
  };
  const x = new Uint8Array(n);
  let mask = 0;
  let E = model.constant;
  consider(0, E);
  for (let k = 1; k < total; k += 1) {
    const b = 31 - Math.clz32(k & -k);
    let delta = model.diag[b];
    for (const [j, q] of model.nbr[b]) if (x[j]) delta += q;
    if (x[b]) {
      E -= delta;
      x[b] = 0;
    } else {
      E += delta;
      x[b] = 1;
    }
    mask ^= 1 << b;
    consider(mask, E);
  }
  return { min: top[0], top, all, total };
}

/** Rang eines Zustands (1 = bester) – nur wenn alle Energien gespeichert sind. */
export function rankOf(result, mask) {
  if (!result || !result.all) return null;
  const e = result.all[mask];
  let better = 0;
  for (let i = 0; i < result.all.length; i += 1) if (result.all[i] < e - 1e-9) better += 1;
  return better + 1;
}

/**
 * Simulated Annealing für Modelle, die zu groß zum Durchprobieren sind – eine Heuristik:
 * findet sehr wahrscheinlich, aber nicht garantiert das Minimum. Mehrere Neustarts, am Ende
 * gierig bis ins lokale Minimum. Liefert das beste und die besten verschiedenen Ergebnisse.
 *
 * groups (optional): One-Hot-Gruppen (z.B. die Zeilen). Dann gibt es zusätzlich Tausch-Züge:
 * ein Bit der Gruppe aus, ein anderes an – in einem Schritt. Ohne sie muss jeder Wechsel
 * zwischen zwei gültigen Zuständen über einen ungültigen (Strafbarriere) laufen.
 * T0, T1: Start- und Endtemperatur (Standard: aus der Größe der Koeffizienten).
 */
export function anneal(model, { restarts = 30, sweeps = 300, seed = 1, groups = [], T0: t0, T1: t1 } = {}) {
  const { n, diag, nbr } = model;
  let s = seed >>> 0;
  const rand = () => { // mulberry32 – reproduzierbar
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let scale = 0;
  for (let i = 0; i < n; i += 1) {
    let a = Math.abs(diag[i]);
    for (const [, q] of nbr[i]) a += Math.abs(q);
    scale = Math.max(scale, a);
  }
  const T0 = t0 ?? Math.max(1e-6, scale / 2);
  const T1 = t1 ?? T0 / 2000;
  const coupling = nbr.map((list) => new Map(list));
  const x = new Uint8Array(n);
  const h = new Float64Array(n); // Energieänderung beim Einschalten von i: diag + Σ Kopplungen zu eingeschalteten
  const flip = (i) => {
    const sgn = x[i] ? -1 : 1;
    x[i] ^= 1;
    for (const [j, q] of nbr[i]) h[j] += sgn * q;
  };
  const found = new Map();
  let best = { E: Infinity, x: null };
  for (let r = 0; r < restarts; r += 1) {
    for (let i = 0; i < n; i += 1) x[i] = rand() < 0.5 ? 1 : 0;
    for (let i = 0; i < n; i += 1) {
      let v = diag[i];
      for (const [j, q] of nbr[i]) if (x[j]) v += q;
      h[i] = v;
    }
    for (let sw = 0; sw < sweeps; sw += 1) {
      const T = T0 * (T1 / T0) ** (sw / Math.max(1, sweeps - 1));
      for (let i = 0; i < n; i += 1) {
        const d = x[i] ? -h[i] : h[i];
        if (d <= 0 || rand() < Math.exp(-d / T)) flip(i);
      }
      for (const g of groups) { // Tausch-Zug: i aus, j an
        const on = g.filter((i) => x[i]);
        const off = g.filter((i) => !x[i]);
        if (!on.length || !off.length) continue;
        const i = on[Math.floor(rand() * on.length)];
        const j = off[Math.floor(rand() * off.length)];
        const d = -h[i] + h[j] - (coupling[j].get(i) || 0);
        if (d <= 0 || rand() < Math.exp(-d / T)) { flip(i); flip(j); }
      }
    }
    for (let improved = true; improved;) {
      improved = false;
      for (let i = 0; i < n; i += 1) {
        if ((x[i] ? -h[i] : h[i]) < -1e-9) { flip(i); improved = true; }
      }
    }
    const E = energy(model, x);
    const key = x.join('');
    if (!found.has(key)) found.set(key, E);
    if (E < best.E - 1e-9) best = { E, x: Uint8Array.from(x) };
  }
  const top = [...found].sort((a, b) => a[1] - b[1]).slice(0, 10).map(([k, E]) => ({ E, x: Uint8Array.from(k, Number) }));
  return { min: best, top, restarts };
}
