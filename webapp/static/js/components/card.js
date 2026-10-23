// Karte für Diagramme: Titel, Untertitel, Inhalt und eine umschaltbare Tabellenansicht der Daten.
import { el, nf } from '../util.js';

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.subtitle]
 * @param {Node|Node[]} [o.body]
 * @param {() => {columns: {key:string,label:string,num?:boolean,fmt?:Function}[], rows: object[]}} [o.table]
 * @param {Node[]} [o.actions] zusätzliche Bedienelemente rechts oben
 */
export function card({ title, subtitle, body, table, actions = [], className = '' }) {
  const tableHost = el('div', { class: 'table-wrap', hidden: true });
  let toggle = null;
  if (table) {
    toggle = el('button', { class: 'btn small', type: 'button', 'aria-pressed': 'false', title: 'Die Zahlen hinter dem Diagramm als Tabelle' }, 'Tabelle');
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(open));
      tableHost.hidden = !open;
      if (open) tableHost.replaceChildren(renderTable(table()));
    });
  }
  const node = el('section', { class: `card ${className}` },
    el('div', { class: 'card-head' },
      el('div', {}, el('h3', {}, title), subtitle ? el('div', { class: 'card-sub', html: subtitle }) : null),
      el('div', { style: { display: 'flex', gap: '6px' } }, actions, toggle)),
    el('div', { class: 'card-body' }, body),
    tableHost);
  node.refreshTable = () => {
    if (toggle && toggle.getAttribute('aria-pressed') === 'true') tableHost.replaceChildren(renderTable(table()));
  };
  return node;
}

export function renderTable({ columns, rows, onRowClick, rowClass }) {
  const thead = el('thead', {}, el('tr', {}, columns.map((c) => el('th', { class: c.num ? 'num' : '' }, c.label))));
  const tbody = el('tbody', {}, rows.map((r) => {
    const tr = el('tr', { class: [onRowClick ? 'clickable' : '', rowClass ? rowClass(r) : ''].join(' ').trim() },
      columns.map((c) => {
        const v = r[c.key];
        const shown = c.fmt ? c.fmt(v, r) : (typeof v === 'number' ? nf(v, 2) : (v ?? '–'));
        const td = el('td', { class: c.num ? 'num' : '' });
        if (shown instanceof Node) td.append(shown);
        else td.textContent = shown;
        return td;
      }));
    if (onRowClick) tr.addEventListener('click', () => onRowClick(r));
    return tr;
  }));
  return el('div', { class: 'table-scroll' }, el('table', { class: 'data' }, thead, tbody));
}

/** Kennzahl-Kachel mit Erklärung per Info-Symbol. */
export function kpi(label, value, note, info) {
  return el('div', { class: 'kpi' },
    el('div', { class: 'kpi-label' }, label, info ? el('span', { class: 'info-dot', title: info, 'aria-label': info }, 'i') : null),
    el('div', { class: 'kpi-value' }, value),
    note ? el('div', { class: 'kpi-note' }, note) : null);
}
