// Document colors: the swatches of the colors a document already uses.
import { $, rgbToHex } from '../../core/utils.mjs';
import { S } from '../../editor/state.mjs';
import { applyColor } from '../../features/formatting.mjs';
import { t } from '../../shared/lang.mjs';

export function buildDocColors() {
  const counts = new Map();
  let k = 0;
  for (const node of S.liveById.values()) {
    if (k++ > 3000) break;
    const hex = rgbToHex(S.win.getComputedStyle(node).color);
    if (hex) counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 13).map(e => e[0]);
  renderSwatches($('#doc-colors'), top, true);
}
export function renderSwatches(box, colors, withCustom) {
  box.innerHTML = '';
  if (withCustom) {
    const c = document.createElement('label');
    c.className = 'swatch custom';
    c.title = t('color_custom');
    c.innerHTML = '<input type="color">';
    c.querySelector('input').addEventListener('input', e => applyColor(e.target.value));
    box.appendChild(c);
  }
  for (const hex of colors) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = hex;
    b.title = hex;
    b.addEventListener('click', () => applyColor(hex));
    box.appendChild(b);
  }
}
