// Reiter „5 · Hardware“: Ab welcher Instanzgröße lässt sich jede Kodierung auf heutige Quantenhardware abbilden?
// Zeigt nur gespeicherte Ergebnisse (results/<hardware>.json, erzeugt mit run_all.py) – nichts wird hier gerechnet.
// Ebene 1 der Belege: „mapped“ = eine gültige Einbettung bzw. ein Routing wurde gefunden. Das heißt nicht „lösbar“.
import { el, fill, nf } from '../util.js';

const ENCS = { OH: 'One-Hot', DW: 'Domain Wall', BIN: 'Binary' };
const MODELS = { A: 'Model A · IA', B: 'Model B · TA' };
const STATUS = { mapped: 'abgebildet', not_found: 'nicht abgebildet', exceeds_limit: 'Limit überschritten' };
const range = (m) => (m ? (m.min === m.max ? nf(m.min) : `${nf(m.min)}–${nf(m.max)}`) : '–');

export function renderHardware(root, { api }) {
  const st = { data: null, bw: true, hw: null, model: 'all', svg: null };
  const intro = el('p', { class: 'intro', html: '<strong>Hardware-Abbildung</strong>: Die QUBOs der drei Kodierungen (Model A = IA, Model B = TA, n Aufträge, Flotte m = n/2) werden '
    + 'auf die Zielgraphen bzw. Gatter der Hardware abgebildet. <b>Abgebildet</b> heißt: Einbettung oder Routing gefunden (Ebene 1) – nicht „lösbar“. '
    + '<b>Nicht abgebildet</b> heißt nur: Die Heuristik hat in allen Seeds im Zeitlimit nichts gefunden – kein Beweis.' });
  const figHost = el('div', { class: 'paper-fig' });
  const figBar = el('div', { class: 'filter-group', style: { margin: '8px 0 4px' } });
  const boundaryHost = el('div');
  const tableHost = el('div');
  const metaHost = el('div');
  const hwPick = el('div', { class: 'filter-group', style: { margin: '0 0 10px' } });
  const status = el('p', { class: 'hint' });
  root.append(intro, status,
    el('section', { class: 'card' }, el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, 'Abbildung'),
      el('div', { class: 'card-sub' }, 'Eine Spalte je Hardware, Zeilen Model A und B. Punkt = bestes Ergebnis über die Seeds, Balken = Streuung, × = nicht abgebildet'))),
      figHost, figBar),
    el('section', { class: 'card', style: { marginTop: '16px' } }, el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, 'Grenze je Kodierung'),
      el('div', { class: 'card-sub' }, 'Größtes abgebildetes n und kleinstes n, ab dem nichts mehr abgebildet wurde'))), hwPick, boundaryHost),
    el('section', { class: 'card', style: { marginTop: '16px' } }, el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, 'Ergebnisse je Instanz'),
      el('div', { class: 'card-sub' }, 'Bestes Ergebnis und Streuung über die Seeds'))), tableHost),
    el('section', { class: 'card', style: { marginTop: '16px' } }, el('div', { class: 'card-head' }, el('div', {}, el('h3', {}, 'Messbedingungen'),
      el('div', { class: 'card-sub' }, 'Zielgraph, Seeds, Zeitlimit, Versionen'))), metaHost));

  const chip = (label, pressed, onclick, title) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(pressed), title }, label);
    b.addEventListener('click', onclick);
    return b;
  };
  const current = () => st.data.hardware.find((h) => h.hardware === st.hw) || st.data.hardware[0];

  async function load() {
    try {
      st.data = await api('/api/hardware');
    } catch (err) {
      fill(status, el('span', { class: 'error' }, `Konnte die Ergebnisse nicht laden: ${err.message}`));
      return;
    }
    if (!st.data.hardware.length) {
      fill(status, 'Noch keine Ergebnisse. Erzeugen mit: ');
      status.append(el('code', {}, 'python run_all.py --hardware advantage_pegasus'));
      [figHost, boundaryHost, tableHost, metaHost, figBar, hwPick].forEach((h) => fill(h));
      figHost.style.display = 'none';
      return;
    }
    figHost.style.display = '';
    if (!st.data.hardware.some((h) => h.hardware === st.hw)) st.hw = st.data.hardware[0].hardware;
    drawAll();
    drawFigure();
  }

  function drawAll() {
    const incomplete = st.data.hardware.filter((h) => h.records < h.expected);
    fill(status, incomplete.length
      ? `Unvollständig: ${incomplete.map((h) => `${h.title} ${h.records} von ${h.expected} Läufen (${h.instances} von ${h.instances_expected} Instanzen)`).join(' · ')} – `
        + 'run_all.py rechnet fehlende Läufe nach.'
      : `${st.data.hardware.map((h) => `${h.title}: ${h.records} Läufe`).join(' · ')} – vollständig.`);
    status.append(' ', el('button', { class: 'btn small', type: 'button', onclick: load }, 'Neu laden'));
    fill(hwPick, el('span', { class: 'filter-label' }, 'Hardware'),
      ...st.data.hardware.map((h) => chip(h.title, h.hardware === current().hardware, () => { st.hw = h.hardware; drawAll(); })));
    drawBoundary();
    drawTable();
    drawMeta();
  }

  async function drawFigure() {
    fill(figHost, el('p', { class: 'hint' }, 'Zeichnet …'));
    try {
      const q = new URLSearchParams({ hardware: st.data.hardware.map((h) => h.hardware).join(','), schwarzweiss: String(st.bw) });
      st.svg = (await api(`/api/hardware/abbildung?${q}`)).svg;
    } catch (err) {
      fill(figHost, el('div', { class: 'error' }, `Konnte die Abbildung nicht zeichnen: ${err.message}`));
      return;
    }
    fill(figHost, el('img', { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(st.svg)}`, alt: 'Hardware mapping: physical qubits or two-qubit gates over orders n',
      style: { width: '100%', maxWidth: '1100px', height: 'auto', display: 'block', margin: '0 auto' } }));
    const download = el('button', { class: 'btn small', type: 'button', title: 'Abbildung als SVG speichern (Text als Pfade)' }, 'Als SVG herunterladen');
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([st.svg], { type: 'image/svg+xml' }));
      const a = el('a', { href: url, download: `hardware_mapping${st.bw ? '' : '_color'}.svg` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    fill(figBar, download, el('span', { class: 'filter-label' }, 'Stil'),
      chip('Schwarzweiß', st.bw, () => { st.bw = true; drawFigure(); }), chip('Farbe', !st.bw, () => { st.bw = false; drawFigure(); }));
  }

  function drawBoundary() {
    const h = current();
    const note = (b) => {
      const parts = [];
      if (b.done < st.data.orders.length) parts.push(`erst ${b.done} von ${st.data.orders.length} Größen gerechnet`);
      if (b.first_not_mapped_status === 'exceeds_limit') parts.push('hartes Limit verletzt (sicher)');
      else if (b.first_not_mapped_n != null) parts.push('Heuristik, kein Beweis');
      if (b.mapped_again_later) parts.push('größere Instanz wieder abgebildet');
      return parts.join(' · ') || '–';
    };
    fill(boundaryHost, el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Modell'), el('th', {}, 'Kodierung'), el('th', { class: 'num' }, 'größtes abgebildetes n'),
        el('th', { class: 'num' }, 'erstes nicht abgebildetes n'), el('th', {}, 'Hinweis'))),
      el('tbody', {}, h.boundary.map((b) => el('tr', {}, el('td', {}, MODELS[b.model]), el('td', {}, ENCS[b.encoding]),
        el('td', { class: 'num' }, b.last_mapped_n ?? '–'), el('td', { class: 'num' }, b.first_not_mapped_n ?? 'keines bis jetzt'),
        el('td', { class: 'hint' }, note(b))))))));
  }

  function drawTable() {
    const h = current();
    const rows = h.rows.filter((r) => st.model === 'all' || r.model === st.model);
    fill(tableHost,
      el('div', { class: 'filter-group', style: { marginBottom: '8px' } }, el('span', { class: 'filter-label' }, 'Modell'),
        ...[['all', 'beide'], ['A', 'A · IA'], ['B', 'B · TA']].map(([v, l]) => chip(l, st.model === v, () => { st.model = v; drawTable(); }))),
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Instanz'), el('th', { class: 'num' }, 'n'), el('th', { class: 'num' }, 'logische Qubits'), el('th', { class: 'num' }, 'Kopplungen'),
          el('th', {}, 'Status'), el('th', { class: 'num' }, 'Seeds gelungen'), el('th', { class: 'num', title: 'bestes Ergebnis (kleinster–größter gelungener Seed)' }, `${h.metric.label}: best (min–max)`),
          el('th', { class: 'num', title: 'längste Kette, kleinster–größter gelungener Seed' }, 'längste Kette'))),
        el('tbody', {}, rows.map((r) => el('tr', { class: r.status === 'mapped' ? '' : 'no' },
          el('td', {}, `${r.model} · ${ENCS[r.encoding]}`), el('td', { class: 'num' }, r.n), el('td', { class: 'num' }, nf(r.logical_qubits)), el('td', { class: 'num' }, nf(r.couplings)),
          el('td', {}, STATUS[r.status]), el('td', { class: 'num' }, `${r.mapped_seeds}/${r.seeds}`),
          el('td', { class: 'num' }, r.metric ? `${nf(r.metric.best)} (${range(r.metric)})` : '–'), el('td', { class: 'num' }, range(r.max_chain))))))));
  }

  function drawMeta() {
    const h = current();
    const m = h.meta || {};
    const line = (k, v) => (v == null || v === '' ? null : el('tr', {}, el('th', { scope: 'row' }, k), el('td', {}, String(v))));
    fill(metaHost, el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, el('tbody', {},
      line('Zielgraph', m.target), line('Qubits / Koppler / höchster Grad', m.target_qubits ? `${nf(m.target_qubits)} / ${m.target_couplers != null ? nf(m.target_couplers) : '–'} / ${m.target_max_degree ?? '–'}` : null),
      line('Hinweis', m.note), line('Seeds je Instanz', m.seeds), line('Zeitlimit je Lauf', m.timeout_s ? `${m.timeout_s} s` : null),
      line('Läufe', `${h.records} von ${h.expected}`), line('Stand', m.updated),
      line('Bibliotheken', [m.minorminer && `minorminer ${m.minorminer}`, m.dwave_networkx && `dwave-networkx ${m.dwave_networkx}`,
        m.qiskit && `qiskit ${m.qiskit}`, m.qiskit_ibm_runtime && `qiskit-ibm-runtime ${m.qiskit_ibm_runtime}`].filter(Boolean).join(', ')),
      line('Quellen', (m.sources || []).join(' · '))))));
  }

  load();
}
