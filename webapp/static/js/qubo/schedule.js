// Ablaufplan aus einer Schalterstellung x_trq („Roboter r fährt Auftrag t als q-letzten“):
// Reihenfolge je Roboter, Regelverstöße und Zeiten – das echte Problem, an dem jede Formulierung
// gemessen wird. Wie decode_schedule / simulate / exact_optimum in encodings/formulations.py.
// Genutzt von „One-Hot + Reihenfolge“ und dem Formel-Baukasten.

const SUB = '₀₁₂₃₄₅₆₇₈₉';
export const sub = (s) => String(s).replace(/\d/g, (d) => SUB[d]);
export const SLOT_NAME = { 1: 'letzter', 2: 'vorletzter', 3: 'drittletzter' };

export function createSchedule(instance) {
  const vars = instance.variables;
  const S0 = new Map(instance.setup.start.map((s) => [`${s.robot_id}|${s.task_id}`, s]));
  const SB = new Map(instance.setup.between.map((s) => [`${s.from}|${s.to}`, s]));
  const taskOf = (id) => instance.tasks.find((t) => t.transport_id === id);
  const robotOf = (id) => instance.robots.find((r) => r.robot_id === id);
  const usedRobots = () => instance.robots.filter((r) => vars.some((v) => v.robot_id === r.robot_id));
  const s0 = (r, t) => S0.get(`${r}|${t}`);
  // Derselbe Auftrag zweimal hintereinander (nur in unzulässigen Zuständen): vom eigenen Abgabe- zum Abholort
  const sb = (i, j) => SB.get(`${i}|${j}`) || (() => {
    const t = taskOf(i);
    const distance = Math.abs(t.drop.x - t.pickup.x) + Math.abs(t.drop.y - t.pickup.y);
    return { from: i, to: j, distance, time: distance / instance.params.v };
  })();
  const K = instance.slots;

  /** Spalten des Schachbretts: je Roboter die Plätze in Fahrreihenfolge (K … 1). */
  const slotColumns = () => usedRobots().flatMap((r) => Array.from({ length: K }, (_, k) => ({
    robot: r.robot_id, slot: K - k, first: k === 0 })));

  const varLabel = (i) => {
    const v = vars[i];
    return K === 1 ? `x${sub(v.task_id)},${sub(v.robot_id)}` : `x${sub(v.task_id)},${sub(v.robot_id)},${sub(v.slot)}`;
  };

  /** Schalterstellung → Reihenfolge je Roboter, plus alle Verstöße gegen die echten Anforderungen. */
  function decode(x) {
    const on = vars.filter((v, i) => x[i]);
    const issues = [];
    for (const t of instance.tasks) {
      const k = on.filter((v) => v.task_id === t.transport_id).length;
      if (k !== 1) issues.push({ kind: 'auftrag', task: t.transport_id, count: k, text: k === 0 ? `#${t.transport_id} wird nicht gefahren` : `#${t.transport_id} wird ${k}× gefahren` });
    }
    const sequences = new Map();
    for (const r of usedRobots()) {
      const mine = on.filter((v) => v.robot_id === r.robot_id).sort((a, b) => b.slot - a.slot || a.task_id - b.task_id);
      const count = (q) => mine.filter((v) => v.slot === q).length;
      for (let q = 1; q <= K; q += 1) {
        if (count(q) > 1) {
          issues.push({ kind: 'platz', robot: r.robot_id, slot: q, count: count(q),
            text: K === 1 ? `R${r.robot_id} fährt ${count(q)} Aufträge gleichzeitig` : `R${r.robot_id} Platz ${q}: ${count(q)} Aufträge` });
        }
        if (q < K && count(q + 1) > 0 && count(q) === 0) {
          issues.push({ kind: 'luecke', robot: r.robot_id, slot: q, text: `R${r.robot_id}: Platz ${q} leer, Platz ${q + 1} belegt` });
        }
      }
      if (mine.length) sequences.set(r.robot_id, mine.map((v) => v.task_id));
    }
    return { valid: issues.length === 0, issues, sequences };
  }

  /** Fährt die Reihenfolgen ab: Abschnitte und Erledigungszeit je Auftrag. */
  function simulate(sequences) {
    const p = instance.params;
    const rows = [];
    let completion = 0;
    let busy = 0;
    for (const [r, seq] of sequences) {
      const release = robotOf(r).release;
      let clock = release;
      let prev = null;
      seq.forEach((tid, k) => {
        const t = taskOf(tid);
        const setup = prev == null ? s0(r, tid) : sb(prev, tid);
        const start = clock;
        clock += setup.time + t.p;
        busy += setup.time + t.p;
        completion += clock;
        rows.push({ task: tid, robot: r, order: k + 1, slot: seq.length - k, start, setup, from: prev, release: k === 0 ? release : 0,
          load: p.t_lade, loaded: t.t_last, unload: p.t_ent, finish: clock });
        prev = tid;
      });
    }
    return { rows, completion, busy, total: instance.criterion.position_weight ? completion : busy };
  }

  /** Wert des echten Ziels für einen Zustand (bei ungültigen Zuständen nur als Orientierung). */
  function trueObjective(x) {
    const dec = decode(x);
    const value = instance.objective === 'zuweisung'
      ? vars.reduce((s, v, i) => s + (x[i] ? v.cost : 0), 0)
      : simulate(dec.sequences).total;
    return { valid: dec.valid, value, dec };
  }

  // bei K = 1 gibt es keine Reihenfolge: zwei Aufträge auf einem Roboter laufen „gleichzeitig“
  const describeSeq = (sequences) => (sequences.size
    ? [...sequences].map(([r, seq]) => `R${r}: ${seq.map((t) => `#${t}`).join(K === 1 ? ' + ' : ' → ')}`).join(' · ')
    : 'alle Schalter aus');
  const seqMap = (obj) => new Map(Object.entries(obj || {}).map(([r, s]) => [Number(r), s]));
  const bitsToX = (bits) => {
    const x = new Uint8Array(vars.length);
    (bits || []).forEach((i) => { x[i] = 1; });
    return x;
  };

  /** „Jeder nimmt den nächsten Roboter“ – mehrere Aufträge auf einem Roboter werden hintereinander gelegt. */
  function nearest() {
    const per = new Map();
    for (const t of instance.tasks) {
      const cands = vars.filter((v) => v.task_id === t.transport_id && v.slot === 1);
      if (!cands.length) continue;
      const best = cands.reduce((a, b) => (s0(b.robot_id, t.transport_id).time < s0(a.robot_id, t.transport_id).time ? b : a));
      per.set(best.robot_id, [...(per.get(best.robot_id) || []), t.transport_id]);
    }
    const x = new Uint8Array(vars.length);
    for (const [r, seq] of per) {
      seq.slice(0, K).forEach((tid, k, list) => {
        const i = vars.findIndex((v) => v.task_id === tid && v.robot_id === r && v.slot === list.length - k);
        if (i >= 0) x[i] = 1;
      });
    }
    return x;
  }

  return { instance, vars, K, taskOf, robotOf, usedRobots, slotColumns, s0, sb, varLabel, decode, simulate, trueObjective,
    describeSeq, seqMap, bitsToX, nearest };
}
