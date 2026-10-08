// Box panel: size, spacing, border, background, shadow.
import { $, $$, rgbToHex } from '../../core/utils.mjs';
import { S, el } from '../../editor/state.mjs';
import { refreshOffsets } from './layers.mjs';
import { modelEl } from '../../editor/live-document.mjs';
import { styleEdit } from '../../editor/commands.mjs';
import { getLayerName, t } from '../../shared/lang.mjs';
import { contentSnippet } from '../../editor/layer-tree.mjs';

// ================================================================ frame panel (Khung)
// Friendly controls over inline CSS: presets and sliders, never raw px fields. A block's size
// is changed with the handles on the page; this panel only offers "back to the original size".
export const BOX_GROUPS = {
  size: ['width', 'height', 'max-width', 'min-width', 'min-height', 'max-height'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-bottom'],
  bg: ['background-color', 'background'],
  border: ['border-width', 'border-style', 'border-color'],
  radius: ['border-radius'],
  shadow: ['box-shadow'],
};
export const SHADOWS = {
  none: 'none',
  soft: '0 1px 3px rgba(14,14,17,.12), 0 1px 2px rgba(14,14,17,.06)',
  medium: '0 6px 18px -2px rgba(14,14,17,.16), 0 2px 6px rgba(14,14,17,.06)',
  strong: '0 20px 44px -8px rgba(14,14,17,.26), 0 6px 12px rgba(14,14,17,.08)',
};
export const BOX_PRESETS = {
  padding: [['chip_none', 0], ['chip_tight', 8], ['chip_medium', 16], ['chip_wide', 32]],
  margin: [['chip_none', 0], ['chip_small', 8], ['chip_medium', 16], ['chip_large', 32]],
  radius: [['chip_none', 0], ['chip_subtle', 6], ['chip_medium', 12], ['chip_large', 24], ['chip_round', 999]],
  bw: [['chip_thin', 1], ['chip_medium', 2], ['chip_thick', 4]],
};
export const BORDER_STYLES = [['none', 'bstyle_none'], ['solid', 'bstyle_solid'], ['dashed', 'bstyle_dashed'], ['dotted', 'bstyle_dotted']];
export const BORDER_COLORS = ['#dcdce2', '#8a8a94', '#0e0e11', '#ff5a1f', '#e94209', '#2e8a36', '#0072e0', '#8e4ec6'];
export const BG_COLORS = ['#ffffff', '#fbfbfc', '#f4f4f6', '#e9e9ed', '#0e0e11', '#ff5a1f', '#ffe0d3', '#fff1ea', '#ffe7be', '#d1edcf', '#cee5fe', '#f5eeff'];
export const SIDE_NAMES = { top: 'side_top', right: 'side_right', bottom: 'side_bottom', left: 'side_left' };
export function boxVisible() { return el.panel.classList.contains('open') && el.panel.dataset.view === 'box'; }
export const pxOf = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export function nodeLabel(n) {
  const text = contentSnippet(n);
  return (getLayerName(n.localName) || n.localName) + (text ? ': ' + text : '');
}
export function inlineValue(node, prop, m = modelEl(node.dataset.edId)) {
  return m ? m.style.getPropertyValue(prop) : '';
}
export function frameStyle(props, key) {
  if (!S.sel) return;
  styleEdit(S.sel, props, key);
  renderBoxPanel();
}
export function setSpacing(kind, value, side) {
  const sides = side ? [side] : kind === 'padding' ? ['top', 'right', 'bottom', 'left'] : ['top', 'bottom'];
  const props = {};
  for (const s of sides) props[`${kind}-${s}`] = value + 'px';
  frameStyle(props, `box-${kind}${side ? '-' + side : ''}`);
}
// A border needs a style, a width and a colour to show: fill in whichever the user did not pick.
export function setBorder(changes) {
  const cs = S.win.getComputedStyle(S.sel), props = { ...changes };
  const style = props['border-style'] ?? cs.borderTopStyle;
  if (style === 'none' && !props['border-style']) props['border-style'] = 'solid';
  if (props['border-style'] !== 'none' && !props['border-width'] && pxOf(cs.borderTopWidth) === 0) props['border-width'] = '1px';
  if (props['border-style'] !== 'none' && !props['border-color'] && !inlineValue(S.sel, 'border-color') && pxOf(cs.borderTopWidth) === 0) props['border-color'] = '#dcdce2';
  frameStyle(props, 'box-border');
}
// "Reset" means back to what the file itself had inline (keeping !important), not "remove all".
export function resetBoxGroup(group) {
  const node = S.sel;
  if (!node) return;
  const orig = S.pristine.querySelector(`[data-ed-id="${node.dataset.edId}"]`);
  const names = [...BOX_GROUPS[group]];
  if (group === 'border') names.push('border', 'border-top', 'border-right', 'border-bottom', 'border-left');
  if (group === 'bg') names.push('background-image');
  if (group === 'margin') names.push('margin-left', 'margin-right');
  const props = {};
  for (const p of names) {
    const v = orig ? orig.style.getPropertyValue(p) : '';
    props[p] = v ? v + (orig.style.getPropertyPriority(p) ? ' !important' : '') : null;
  }
  styleEdit(node, props);
  renderBoxPanel();
}
export function renderBoxPanel() {
  if (!boxVisible() || renderBoxPanel.raf) return;
  renderBoxPanel.raf = requestAnimationFrame(() => { renderBoxPanel.raf = 0; drawBoxPanel(); });
}
export function markChips(box, current, tol = 0.6) {
  for (const b of $$('button', box)) b.classList.toggle('on', current != null && Math.abs(Number(b.dataset.v) - current) <= tol);
}
export function drawBoxPanel() {
  if (!boxVisible()) return;
  const node = S.sel, body = $('.panel-body[data-view="box"]');
  body.classList.toggle('disabled-img', !node);
  $('#box-target').textContent = node ? nodeLabel(node) : t('box_target_empty');
  if (!node) return;
  const cs = S.win.getComputedStyle(node), m = modelEl(node.dataset.edId), isImg = node.localName === 'img';
  $$('[data-noimg]', body).forEach(s => { s.hidden = isImg; });
  const pads = ['top', 'right', 'bottom', 'left'].map(s => pxOf(cs.getPropertyValue('padding-' + s)));
  const uniform = pads.every(v => Math.abs(v - pads[0]) < 0.6) ? pads[0] : null;
  markChips($('#chips-padding'), uniform);
  $('#sl-padding').value = Math.round(uniform ?? pads[0]);
  $('#out-padding').textContent = uniform == null ? t('val_mixed') : Math.round(uniform);
  const mg = ['top', 'bottom'].map(s => pxOf(cs.getPropertyValue('margin-' + s)));
  markChips($('#chips-margin'), Math.abs(mg[0] - mg[1]) < 0.6 ? mg[0] : null);
  for (const r of $$('.side-row')) {
    const v = Math.round(pxOf(cs.getPropertyValue(r.dataset.prop)));
    const s = r.querySelector('input');
    if (document.activeElement !== s) s.value = v;
    r.querySelector('output').textContent = v;
  }
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const same = vals => vals.every(v => v === vals[0]);
  const styles = sides.map(k => pxOf(cs['border' + k + 'Width']) === 0 ? 'none' : cs['border' + k + 'Style']);
  const widths = sides.map(k => pxOf(cs['border' + k + 'Width']));
  const bstyle = same(styles) ? styles[0] : null, bw = widths[0];
  for (const b of $$('#chips-bstyle button')) b.classList.toggle('on', bstyle === b.dataset.v);
  markChips($('#chips-bw'), bstyle && bstyle !== 'none' && same(widths) ? bw : null);
  const bc = rgbToHex(cs.borderTopColor);
  for (const b of $$('#box-bc-swatches .swatch[data-hex]')) b.classList.toggle('on', bw > 0 && b.dataset.hex === bc);
  const radii = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(k => pxOf(cs['border' + k + 'Radius']));
  const rad = same(radii) ? radii[0] : null;
  markChips($('#chips-radius'), rad == null ? null : rad >= 999 ? 999 : rad);
  $('#sl-radius').value = Math.min(60, Math.round(rad ?? radii[0]));
  $('#out-radius').textContent = rad == null ? t('val_mixed') : rad >= 999 ? t('val_round') : Math.round(rad);
  const bg = rgbToHex(cs.backgroundColor);
  for (const b of $$('#box-bg-swatches .swatch[data-hex]')) b.classList.toggle('on', b.dataset.hex === bg);
  $('#box-bg-swatches .swatch.none')?.classList.toggle('on', !bg && cs.backgroundImage === 'none');
  const sh = inlineValue(node, 'box-shadow', m);
  for (const b of $$('[data-shadow]')) b.classList.toggle('on', sh ? normalizeCSS('box-shadow', SHADOWS[b.dataset.shadow]) === sh : b.dataset.shadow === 'none' && cs.boxShadow === 'none');
}
// The browser rewrites values it stores (colour order, rgba…); compare like with like.
export function normalizeCSS(prop, value) {
  const d = document.createElement('div');
  d.style.setProperty(prop, value);
  return d.style.getPropertyValue(prop);
}
export function chipButtons(box, items, onPick) {
  for (const [key, v] of items) {
    const b = document.createElement('button');
    b.textContent = t(key);
    b.dataset.i18n = key;
    b.dataset.v = v;
    b.addEventListener('click', () => onPick(v));
    box.appendChild(b);
  }
}
export function swatchButtons(box, colors, onPick, withNone) {
  if (withNone) {
    const n = document.createElement('button');
    n.className = 'swatch none';
    n.title = t('box_bg_none');
    n.dataset.i18nTitle = 'box_bg_none';
    n.addEventListener('click', () => onPick(null));
    box.appendChild(n);
  }
  for (const hex of colors) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = hex;
    b.title = hex;
    b.dataset.hex = hex;
    b.addEventListener('click', () => onPick(hex));
    box.appendChild(b);
  }
  const c = document.createElement('label');
  c.className = 'swatch custom';
  c.title = t('color_custom');
  c.dataset.i18nTitle = 'color_custom';
  c.innerHTML = '<input type="color">';
  c.querySelector('input').addEventListener('input', e => onPick(e.target.value));
  box.appendChild(c);
}
export function bindBoxPanel() {
  const body = $('.panel-body[data-view="box"]');
  chipButtons($('#chips-padding'), BOX_PRESETS.padding, v => setSpacing('padding', v));
  chipButtons($('#chips-margin'), BOX_PRESETS.margin, v => setSpacing('margin', v));
  chipButtons($('#chips-radius'), BOX_PRESETS.radius, v => frameStyle({ 'border-radius': v + 'px' }, 'box-radius'));
  chipButtons($('#chips-bw'), BOX_PRESETS.bw, v => setBorder({ 'border-width': v + 'px' }));
  for (const [v, key] of BORDER_STYLES) {
    const b = document.createElement('button');
    b.textContent = t(key);
    b.dataset.i18n = key;
    b.dataset.v = v;
    b.addEventListener('click', () => v === 'none' ? frameStyle({ 'border-style': 'none' }, 'box-border') : setBorder({ 'border-style': v }));
    $('#chips-bstyle').appendChild(b);
  }
  swatchButtons($('#box-bc-swatches'), BORDER_COLORS, hex => setBorder({ 'border-color': hex }));
  // Transparent with !important so a background the file forces really goes away.
  swatchButtons($('#box-bg-swatches'), BG_COLORS, hex => hex
    ? frameStyle({ 'background-color': hex }, 'box-bg')
    : frameStyle({ 'background-color': 'transparent !important', 'background-image': 'none !important' }, 'box-bg'), true);
  $('#sl-padding').addEventListener('input', e => { $('#out-padding').textContent = e.target.value; setSpacing('padding', +e.target.value); });
  $('#sl-radius').addEventListener('input', e => { $('#out-radius').textContent = e.target.value; frameStyle({ 'border-radius': e.target.value + 'px' }, 'box-radius'); });
  for (const [kind, sides] of [['padding', ['top', 'right', 'bottom', 'left']], ['margin', ['top', 'bottom']]]) {
    const box = $('#sides-' + kind);
    for (const s of sides) {
      const row = document.createElement('div');
      row.className = 'side-row';
      row.dataset.prop = `${kind}-${s}`;
      row.innerHTML = `<span data-i18n="${SIDE_NAMES[s]}">${t(SIDE_NAMES[s])}</span><input type="range" min="0" max="${kind === 'padding' ? 80 : 120}"><output></output>`;
      row.querySelector('input').addEventListener('input', e => { row.querySelector('output').textContent = e.target.value; setSpacing(kind, +e.target.value, s); });
      box.appendChild(row);
    }
  }
  for (const b of $$('[data-reset]', body)) b.addEventListener('click', () => resetBoxGroup(b.dataset.reset));
  for (const sec of [$('#chips-padding'), $('#chips-margin')].map(n => n.closest('.box-sec'))) {
    const hover = on => () => { S.spacingHover = on; refreshOffsets(); };
    sec.addEventListener('pointerenter', hover(true));
    sec.addEventListener('pointerleave', hover(false));
    sec.addEventListener('focusin', hover(true));
    sec.addEventListener('focusout', hover(false));
    // A held slider keeps the bands even when the pointer drifts out of the section.
    sec.addEventListener('pointerdown', e => {
      if (e.target.type !== 'range') return;
      S.spacingDrag = true;
      window.addEventListener('pointerup', () => { S.spacingDrag = false; refreshOffsets(); }, { once: true });
    });
  }
  for (const b of $$('[data-shadow]', body)) b.addEventListener('click', () => frameStyle({ 'box-shadow': SHADOWS[b.dataset.shadow] }, 'box-shadow'));
}
