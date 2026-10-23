// Karte „Bewertungskriterium“ der One-Hot-Seite: Wonach bewertet das QUBO?
// Auswahl des Kriteriums, Annahmen (Parameter) und die Zerlegung jeder Diagonal-Zahl c_tr in Einzelfaktoren.
import { el, fill, nf, escapeHtml } from '../util.js';
import { C, plot, rootFontPx } from '../theme.js';

// Farben der Einzelfaktoren: feste Reihenfolge der geprüften Palette (benachbarte Paare bestehen den Farbcheck)
const PART_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const fmt = (v) => nf(v, 1).replace('-', '−');

/** Rundet auf eine „schöne“ Zahl nach oben (für Strafgewichte und Reglerbereiche). */
export function niceCeil(v) {
  if (!(v > 0)) return 10;
  const exp = 10 ** Math.floor(Math.log10(v));
  const step = exp >= 10 ? exp / 2 : exp;
  return Math.ceil(v / step) * step;
}

/** Formel-Text eines Kriteriums leserlich setzen (d_leer → d<sub>leer</sub> usw.). */
export function formulaHtml(text) {
  return escapeHtml(text).replace(/\b([a-zA-Z])_([a-zA-Zäöü]+)\b/g, '<i>$1</i><sub>$2</sub>');
}

/**
 * @param {HTMLElement} host
 * @param {object} api getState(), setCriterion(key), setParam(key, value), resetParams()
 */
export function createCriterionPanel(host, api) {
  const chartDiv = el('div', { class: 'chart' });
  let pending = null;

  function render() {
    const s = api.getState();
    if (!s.data) return;
    const { catalog, instance } = s.data;
    const crit = instance.criterion;
    const vars = instance.variables;

    // Auswahl – Struktur-Kriterien mit eigener Seite sind anwählbar und springen dorthin
    const pageLink = (c) => `#/kodierungen/${c.page}?auftraege=${(s.selected || []).join(',')}`;
    const select = el('select', { 'aria-label': 'Bewertungskriterium', class: 'crit-select' },
      el('optgroup', { label: 'Füllt die Diagonale (Sofortzuweisung)' },
        catalog.criteria.map((c) => el('option', { value: c.key }, `${c.label} · ${c.en} [${c.unit}]`))),
      el('optgroup', { label: 'Verändert die QUBO-Struktur (Hilfsvariablen)' },
        catalog.structural.map((c) => el('option', { value: c.key, disabled: !c.page }, `${c.label} · ${c.en}${c.page ? ' → eigene Seite' : ' (geplant)'}`))));
    select.value = crit.key;
    select.addEventListener('change', () => {
      const structural = catalog.structural.find((c) => c.key === select.value);
      if (structural) { location.hash = pageLink(structural); return; }
      api.setCriterion(select.value);
    });
    const seqPage = catalog.structural.find((c) => c.page);

    // Parameter des Kriteriums
    const paramRows = crit.params.map((key) => {
      const meta = catalog.params[key];
      const input = el('input', { type: 'number', value: instance.params[key], min: meta.min, step: meta.step, 'aria-label': meta.label, style: { width: '90px' } });
      input.addEventListener('input', () => {
        clearTimeout(pending);
        pending = setTimeout(() => api.setParam(key, Number(input.value)), 350);
      });
      const changed = instance.params[key] !== meta.default;
      return el('label', { class: `param${changed ? ' changed' : ''}` },
        el('span', { class: 'param-label' }, meta.label, el('code', {}, key)), input, el('span', { class: 'hint' }, meta.unit));
    });

    // Kennzahlen zur Wirkung der Kostenwerte
    const costs = vars.map((v) => v.cost);
    const constShare = vars.length
      ? vars.reduce((acc, v) => acc + (v.cost > 0 ? v.parts.filter((p) => p.const).reduce((a, p) => a + p.value, 0) / v.cost : 0), 0) / vars.length
      : 0;
    const spreads = instance.tasks.map((t) => {
      const c = vars.filter((v) => v.task_id === t.transport_id).map((v) => v.cost);
      return c.length ? Math.max(...c) - Math.min(...c) : 0;
    });
    const meanSpread = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 0;
    const anyEstimated = instance.tasks.some((t) => t.loaded_estimated);

    fill(host,
      el('div', { class: 'crit-top' },
        el('label', { class: 'filter-group' }, el('span', { class: 'filter-label' }, 'Kriterium'), select),
        el('div', { class: 'crit-box' },
          el('div', { html: `<b>Ziel:</b> Zuweisung so wählen, dass ${escapeHtml(crit.goal)}.` }),
          el('div', { class: 'crit-formula', html: `${formulaHtml(crit.formula).replace(/^c =/, '<i>c</i><sub>t,r</sub> =')} <span class="hint">[${escapeHtml(crit.unit)}]</span>` }),
          el('div', { class: 'hint', html: s.diagonalHint || `Diese Zahl steht für jeden Schalter auf der <b>Diagonale</b> der QUBO-Matrix: Q[<i>x</i><sub>t,r</sub>] = <i>c</i><sub>t,r</sub> − A. Die Kopplungen ändern sich durch das Kriterium nicht.
            Das gilt, weil diese Seite eine <b>Sofortzuweisung</b> rechnet: Jeder Roboter bekommt höchstens einen Auftrag – nur dann ist <i>c</i><sub>t,r</sub> eine feste Zahl.` }),
          crit.sequence_note && seqPage ? el('div', { class: 'warnline', html: `⚠ ${escapeHtml(catalog.sequence_note)}
            <a href="${pageLink(seqPage)}">Summe der Erledigungszeiten mit Reihenfolge →</a>` }) : null,
          s.weightNote ? el('div', { class: 'okline', style: { marginTop: '4px' } }, s.weightNote) : null)),
      crit.params.length
        ? el('div', {},
          el('div', { class: 'param-head' }, el('strong', {}, 'Annahmen'),
            el('span', { class: 'hint' }, ' – nicht in den Logs enthalten, frei einstellbar. Die Geschwindigkeit ist aus den Snapshots geschätzt (≈ 1 Feld/s).'),
            el('button', { class: 'btn small', type: 'button', onclick: () => api.resetParams(), style: { marginLeft: '8px' } }, 'Standardwerte')),
          el('div', { class: 'params' }, paramRows))
        : el('p', { class: 'hint' }, 'Dieses Kriterium braucht keine Annahmen – es kommt direkt aus den Koordinaten.'),
      el('h4', {}, 'Woraus setzt sich jede Diagonal-Zahl zusammen?'),
      chartDiv,
      el('p', { class: 'hint', html: `Koeffizienten von <b>${fmt(Math.min(...costs))}</b> bis <b>${fmt(Math.max(...costs))}</b> ${escapeHtml(crit.unit)}.
        Für die Entscheidung zählen nur die <b>Unterschiede zwischen den Robotern eines Auftrags</b> (im Mittel ${fmt(meanSpread)} ${escapeHtml(crit.unit)}).
        ${constShare > 0.005 ? `Im Schnitt <b>${nf(constShare * 100, 0)} %</b> jeder Zahl sind für alle Roboter des Auftrags gleich (schraffiert) – sie verschieben nur und machen die Zahlen größer, die die Hardware genau einstellen muss.` : 'Hier gibt es keine für alle Roboter gleichen Anteile.'}
        ${anyEstimated ? '<br>Bei Aufträgen mit Sentinel-Pfadlänge ist die Lastfahrt mit der Manhattan-Distanz geschätzt.' : ''}` }),
      el('details', { class: 'structural' },
        el('summary', {}, 'Kriterien, die die QUBO-Struktur verändern – warum sie Hilfsvariablen oder Kopplungen brauchen'),
        el('table', { class: 'data' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Kriterium'), el('th', {}, 'Warum nicht nur die Diagonale?'), el('th', {}, 'Was sich an QUBO und Hardware ändert'))),
          el('tbody', {}, catalog.structural.map((c) => el('tr', {},
            el('td', {}, el('strong', {}, c.label), el('div', { class: 'hint' }, c.en),
              c.page ? el('a', { href: pageLink(c) }, 'umgesetzt → eigene Seite') : el('div', { class: 'hint' }, 'geplant')),
            el('td', {}, c.why), el('td', {}, c.qubo)))))));

    drawParts(instance, crit);
  }

  function drawParts(instance, crit) {
    const vars = instance.variables;
    const labels = vars.map((v) => `#${v.task_id} → R${v.robot_id}${v.eligible ? '' : ' (belegt)'}`);
    const names = [];
    vars.forEach((v) => v.parts.forEach((p) => { if (!names.includes(p.name)) names.push(p.name); }));
    const traces = names.map((name, k) => {
      const vals = vars.map((v) => v.parts.find((p) => p.name === name)?.value ?? 0);
      const isConst = vars.some((v) => v.parts.find((p) => p.name === name)?.const);
      return {
        type: 'bar', orientation: 'h', name: isConst ? `${name} (für alle Roboter gleich)` : name, y: labels, x: vals,
        marker: { color: PART_COLORS[k % PART_COLORS.length], line: { color: C.surface, width: 1 },
          // Schraffur über der Balkenfarbe (overlay) – sonst wäre der Hintergrund transparent
          pattern: isConst ? { shape: '/', fillmode: 'overlay', fgcolor: C.surface, size: 8, solidity: 0.3 } : undefined },
        hovertemplate: `%{y}<br>${escapeHtml(name)}: %{x:.1f} ${escapeHtml(crit.unit)}${isConst ? '<br><i>für alle Roboter dieses Auftrags gleich</i>' : ''}<extra></extra>`,
      };
    });
    const totals = vars.map((v) => v.cost);
    traces.push({
      type: 'scatter', mode: 'text', y: labels, x: totals, text: totals.map((t) => ` ${fmt(t)}`), textposition: 'middle right',
      textfont: { color: C.ink, size: 11 }, hoverinfo: 'skip', showlegend: false, cliponaxis: false,
    });
    plot(chartDiv, traces, {
      barmode: 'stack', height: Math.round(Math.max(220, 26 * vars.length + 110) * (rootFontPx() / 15)), margin: { l: 140, r: 60, t: 40, b: 50 },
      yaxis: { autorange: 'reversed', showgrid: false, ticks: '' },
      xaxis: { title: { text: `c = Kosten der Zuweisung [${crit.unit}] → Diagonale der QUBO` }, rangemode: 'tozero' },
      legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0 },
    });
  }

  return { render };
}
