// Kodierungen im Formel-Baukasten: Bits je Auftrag (One-Hot, Domain Wall, Binary – auch gemischt) lesen,
// gültige Pläne in Bits schreiben und Regeln auswerten. Wie indicator_values / encode_plan / read_plan /
// rule_value in encodings/baukasten.py. Das echte Problem (Ablaufplan, Ziel) kommt aus qubo/schedule.js.
import { sub } from './schedule.js';

export const ENC_LABEL = { one_hot: 'One-Hot', domain_wall: 'Domain Wall', binary: 'Binary' };
export const ENC_SHORT = { one_hot: 'OH', domain_wall: 'DW', binary: 'Bin' };

export function createEncoding(form, sched) {
  const vars = sched.vars;
  const K = sched.K;
  const blocks = form.blocks;
  const blockOf = new Map(blocks.map((b) => [b.task_id, b]));
  const auxByIndex = new Map(form.aux.map((a) => [a.index, a]));
  const optLabel = (o) => (K === 1 ? `R${vars[o].robot_id}` : `R${vars[o].robot_id}·${vars[o].slot}`);
  const optLong = (o) => (K === 1 ? `R${vars[o].robot_id}` : `R${vars[o].robot_id}, Platz ${vars[o].slot}`);

  function bitLabel(i) {
    const b = form.bits[i];
    if (b.aux) return `w${sub(b.pos)}`;
    if (b.encoding === 'one_hot') return sched.varLabel(b.option);
    return `${b.encoding === 'domain_wall' ? 'b' : 'z'}${sub(b.task_id)},${sub(b.pos)}`;
  }

  /** Indikator I_{t,o} je Option: 0/1, bei gebrochenen Domain-Wall-Ketten auch −1. */
  function indicators(x) {
    const y = new Float64Array(vars.length);
    for (const b of blocks) {
      if (b.encoding === 'one_hot') b.options.forEach((o, k) => { y[o] = x[b.bits[k]]; });
      else if (b.encoding === 'domain_wall') {
        const chain = [1, ...b.bits.map((i) => x[i]), 0];
        b.options.forEach((o, k) => { y[o] = chain[k] - chain[k + 1]; });
      } else {
        const code = codeOf(b, x);
        b.options.forEach((o, k) => { y[o] = code === k ? 1 : 0; });
      }
    }
    return y;
  }
  const codeOf = (b, x) => b.bits.reduce((s, i, j) => s + (x[i] << (b.nb - 1 - j)), 0);

  /** Lesart je Block: gewählte Optionen (I = 1), negative (I = −1), Code bzw. Wände. */
  function readBlock(b, x, y = indicators(x)) {
    const chosen = b.options.filter((o) => y[o] === 1);
    const negative = b.options.filter((o) => y[o] < 0);
    const out = { block: b, chosen, negative, ok: chosen.length === 1 && !negative.length };
    if (b.encoding === 'binary') out.code = codeOf(b, x);
    if (b.encoding === 'domain_wall') out.walls = chosen.length + negative.length;
    if (!b.options.length) out.text = 'keine Option – nicht darstellbar';
    else if (out.ok) out.text = `→ ${optLong(chosen[0])}`;
    else if (b.encoding === 'binary') out.text = `✗ Phantom-Code ${b.codes[out.code]?.pattern ?? out.code}`;
    else if (b.encoding === 'domain_wall') out.text = `✗ Kette gebrochen: ${out.walls} Wände`;
    else out.text = chosen.length ? `✗ ${chosen.length} Optionen an` : '✗ keine Option an';
    return out;
  }

  /** Verstöße der Kodierung (zusätzlich zu den Anforderungen des echten Problems). */
  function encodingIssues(x, y = indicators(x)) {
    const issues = [];
    for (const b of blocks) {
      if (b.encoding === 'domain_wall' && b.options.some((o) => y[o] < 0)) {
        issues.push({ kind: 'kodierung', task: b.task_id, encoding: b.encoding, text: `#${b.task_id}: Kette gebrochen (δ = −1)` });
      }
      if (b.encoding === 'binary' && b.options.length && !b.options.some((o) => y[o])) {
        issues.push({ kind: 'kodierung', task: b.task_id, encoding: b.encoding, text: `#${b.task_id}: Phantom-Code ${b.codes[codeOf(b, x)].pattern}` });
      }
    }
    return issues;
  }
  const lies = (x) => form.aux.filter((a) => x[a.index] !== x[a.pair[0]] * x[a.pair[1]]).map((a) => a.index);

  /** Positive Indikatoren als One-Hot-Vektor x_trq – damit rechnet das echte Problem (schedule.js). */
  function toOneHot(x, y = indicators(x)) {
    return Uint8Array.from(y, (v) => (v === 1 ? 1 : 0));
  }

  /** Am echten Problem gemessen: Anforderungen, Ziel, Kodierungs-Verstöße und lügende Hilfsbits. */
  function truth(x) {
    const y = indicators(x);
    const t = sched.trueObjective(toOneHot(x, y));
    const enc = encodingIssues(x, y);
    for (const i of t.dec.issues) if (i.task != null) i.encoding = blockOf.get(i.task)?.encoding;
    const issues = [...t.dec.issues, ...enc];
    return { ...t, valid: issues.length === 0, dec: { ...t.dec, issues }, lies: lies(x), y };
  }

  function honest(x) {
    for (const a of form.aux) x[a.index] = x[a.pair[0]] * x[a.pair[1]];
    return x;
  }

  /** Option einer Aufgabe setzen (in der Kodierung ihres Blocks). */
  function setOption(x, b, o) {
    const k = b.options.indexOf(o);
    if (k < 0) return x;
    if (b.encoding === 'one_hot') b.bits.forEach((i, j) => { x[i] = j === k ? 1 : 0; });
    else if (b.encoding === 'domain_wall') b.bits.forEach((i, j) => { x[i] = j < k ? 1 : 0; });
    else b.bits.forEach((i, j) => { x[i] = (k >> (b.nb - 1 - j)) & 1; });
    return x;
  }
  function setCode(x, b, code) {
    b.bits.forEach((i, j) => { x[i] = (code >> (b.nb - 1 - j)) & 1; });
    return x;
  }

  /** Gültiger Plan (Option je Auftrag, in Auftragsreihenfolge) → Bits, Hilfsbits ehrlich. */
  function encodePlan(opts) {
    const x = new Uint8Array(form.n);
    blocks.forEach((b, k) => setOption(x, b, opts[k]));
    return honest(x);
  }
  /** One-Hot-Zustand (z.B. „jeder nimmt den nächsten“) → Bits; Aufträge ohne Wahl nehmen ihre erste Option. */
  function fromOneHot(oh) {
    const x = new Uint8Array(form.n);
    for (const b of blocks) {
      const on = b.options.filter((o) => oh[o]);
      if (b.options.length) setOption(x, b, on[0] ?? b.options[0]);
    }
    return honest(x);
  }

  /** Wert einer Regel ohne Gewicht – aus ihrer Bedeutung (wie rule_value in Python). */
  function ruleValue(r, x, y) {
    switch (r.kind) {
      case 'kosten': return r.c * y[r.opt];
      case 'vorgaenger': return r.c * y[r.opts[0]] * y[r.opts[1]];
      case 'gruppe':
      case 'bitgruppe': {
        const vals = r.kind === 'gruppe' ? r.opts.map((o) => y[o]) : r.bits.map((i) => x[i]);
        const s = vals.reduce((a, v) => a + v, 0);
        const pairs = (s * s - vals.reduce((a, v) => a + v * v, 0)) / 2;
        return r.f.a + (r.f.b + r.f.c) * s + 2 * r.f.c * pairs;
      }
      case 'nachbar':
      case 'bitnachbar': {
        const o1 = r.kind === 'nachbar' ? r.upper.reduce((s, o) => s + y[o], 0) : x[r.hi];
        const o2 = r.kind === 'nachbar' ? r.lower.reduce((s, o) => s + y[o], 0) : x[r.lo];
        return r.g.a + r.g.b * o1 + r.g.c * o2 + r.g.d * o1 * o2;
      }
      case 'ungueltig': return r.codes.includes(r.bits.reduce((s, i, j) => s + (x[i] << (r.nb - 1 - j)), 0)) ? 1 : 0;
      default: { // hilfsbit
        const [a, b] = r.pair;
        const w = r.aux;
        return x[a] * x[b] - 2 * x[a] * x[w] - 2 * x[b] * x[w] + 3 * x[w];
      }
    }
  }

  /**
   * Werte aller Bausteine (ohne Gewicht) aus der QUBO – genau das, was der Löser sieht.
   * Vorberechnet je Baustein: Liste (i, j, v) und Konstante.
   */
  const perTerm = new Map(Object.keys(form.const).map((t) => [t, { c: form.const[t], ii: [], jj: [], vv: [] }]));
  for (const e of form.entries) {
    for (const p of e.parts) {
      const t = perTerm.get(p.term);
      t.ii.push(e.i); t.jj.push(e.j); t.vv.push(p.v);
    }
  }
  function termRaw(x) {
    const out = {};
    for (const [id, t] of perTerm) {
      let s = t.c;
      for (let k = 0; k < t.vv.length; k += 1) if (x[t.ii[k]] && x[t.jj[k]]) s += t.vv[k];
      out[id] = s;
    }
    return out;
  }

  return { form, blocks, blockOf, auxByIndex, optLabel, optLong, bitLabel, indicators, readBlock, encodingIssues, lies,
    toOneHot, truth, honest, setOption, setCode, encodePlan, fromOneHot, ruleValue, termRaw, codeOf };
}
