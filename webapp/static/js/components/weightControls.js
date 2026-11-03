// Strafgewichte einstellen – gemeinsam für alle Kodierungsseiten:
// je Gewicht ein Regler und ein Zahlenfeld (exakte Werte, auch über das Reglerende hinaus),
// die Empfehlung zum Übernehmen und der Schalter „automatisch an das Szenario anpassen“.
import { el, fill, nf, safeStorage } from '../util.js';
import { niceCeil } from '../views/onehotCriterion.js';

const AUTO_KEY = 'qubo.autoWeights';

/** Gemerkte Wahl: Gewichte bei neuem Szenario automatisch anpassen? (Standard: ja) */
export function autoWeights() {
  return safeStorage(AUTO_KEY) !== '0';
}
function setAutoWeights(on) {
  safeStorage(AUTO_KEY, on ? '1' : '0');
}

/** Gewichte aus dem Link übernehmen (z.B. ?A=80&B=40); true, wenn mindestens eines gesetzt wurde. */
export function weightsFromParams(params, target, keys) {
  let any = false;
  for (const k of keys) {
    const v = Number(params[k]);
    if (params[k] != null && params[k] !== '' && Number.isFinite(v) && v >= 0) {
      target[k] = v;
      any = true;
    }
  }
  return any;
}

/**
 * @param {HTMLElement} host
 * @param {object} api  onChange(key, value) – bei jeder Eingabe; onAuto(on) – Schalter umgelegt
 * @returns {{render(spec)}}  spec: { items: [{key, label, color, value, recommended, hint, step?, max?, digits?}], note }
 *   step/max/digits für kleine Gewichte (z.B. B ≈ 0,008 beim Lastausgleich) – sonst Schritt 1 und automatisches Ende.
 *   Die Felder werden nur neu gebaut, wenn sich Gewichte oder Beschriftungen ändern – sonst nur
 *   abgeglichen, damit ein Feld beim Tippen den Fokus behält.
 */
export function createWeightControls(host, api) {
  let signature = '';
  const rows = new Map();

  const sliderMax = (item) => item.max ?? Math.max(niceCeil(3 * Math.max(item.recommended || 0, 10)), niceCeil(item.value * 1.2 || 10));

  function set(key, value, source) {
    const row = rows.get(key);
    if (!row) return;
    if (value > Number(row.slider.max)) row.slider.max = niceCeil(value * 1.2);
    if (row.slider !== source) row.slider.value = value;
    if (row.input !== source) row.input.value = value;
    api.onChange(key, value);
  }

  function build(spec) {
    rows.clear();
    const lines = spec.items.map((item) => {
      const slider = el('input', { type: 'range', min: 0, max: sliderMax(item), step: item.step ?? 1, value: item.value, 'aria-label': `${item.label} (Regler)` });
      const input = el('input', { type: 'number', min: 0, step: 'any', value: item.value, class: 'w-input', 'aria-label': item.label });
      const rec = el('button', { class: 'btn small', type: 'button', title: 'Empfohlenen Wert übernehmen' });
      slider.addEventListener('input', () => set(item.key, Number(slider.value), slider));
      input.addEventListener('input', () => {
        const v = Number(input.value);
        if (input.value !== '' && Number.isFinite(v) && v >= 0) set(item.key, v, input);
      });
      rec.addEventListener('click', () => set(item.key, Number(rec.dataset.value), null));
      rows.set(item.key, { slider, input, rec });
      return el('div', { class: 'w-row' },
        el('span', { class: 'w-label', style: { color: item.color } }, item.label),
        slider, input, rec,
        item.hint ? el('span', { class: 'hint w-hint' }, item.hint) : null);
    });
    const autoBox = el('input', { type: 'checkbox', checked: autoWeights() });
    autoBox.addEventListener('change', () => { setAutoWeights(autoBox.checked); api.onAuto?.(autoBox.checked); });
    const resetAll = el('button', { class: 'btn small', type: 'button', onclick: () => spec.items.forEach((i) => set(i.key, Number(rows.get(i.key).rec.dataset.value), null)) },
      'alle Empfehlungen übernehmen');
    fill(host,
      el('div', { class: 'w-grid' }, lines),
      el('div', { class: 'filter-group', style: { marginTop: '4px' } },
        el('label', { class: 'filter-group' }, autoBox, el('span', { class: 'hint' }, 'bei Szenario- oder Kriteriumswechsel automatisch anpassen')),
        resetAll),
      spec.note ? el('p', { class: 'hint' }, spec.note) : null);
  }

  function sync(spec) {
    for (const item of spec.items) {
      const row = rows.get(item.key);
      if (!row) continue;
      if (document.activeElement !== row.input) row.input.value = item.value;
      if (document.activeElement !== row.slider) {
        if (item.value > Number(row.slider.max)) row.slider.max = Math.max(sliderMax(item), niceCeil(item.value * 1.2));
        row.slider.value = item.value;
      }
      row.rec.dataset.value = item.recommended;
      row.rec.textContent = `Empfehlung ${nf(item.recommended, item.digits ?? 0)}`;
      row.rec.disabled = Math.abs(item.value - item.recommended) < 1e-9;
    }
  }

  function render(spec) {
    const sig = JSON.stringify([spec.items.map((i) => [i.key, i.label, i.hint]), spec.note]);
    if (sig !== signature) {
      signature = sig;
      build(spec);
    }
    sync(spec);
  }

  return { render };
}
