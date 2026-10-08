// Block toolbar state and popovers.
import { $, $$, clamp } from '../core/utils.mjs';
import { S, el } from '../editor/state.mjs';
import { boxVisible, renderBoxPanel } from './panels/box.mjs';
import { effectsVisible, renderFxSel } from '../features/effects.mjs';
import { computedFor } from '../features/formatting.mjs';
import { isRoot } from '../editor/live-document.mjs';

// ================================================================ toolbar sync
export function refreshToolbar() {
  const node = S.sel;
  el.ctx.classList.toggle('idle', !node);
  el.ctx.classList.toggle('img-mode', !!node && node.localName === 'img');
  if (boxVisible()) renderBoxPanel();
  if (effectsVisible()) renderFxSel();
  if (!node || !S.win) return;
  if (node.localName === 'img') {
    const op = Math.round(parseFloat(S.win.getComputedStyle(node).opacity) * 100);
    $('#op-range').value = op; $('#op-out').textContent = op;
    return;
  }
  const cs = computedFor(node);
  const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
  const sel = $('#tb-font');
  if (![...sel.options].some(o => o.value === fam)) {
    $$('option[data-temp]', sel).forEach(o => o.remove());
    const o = new Option(fam, fam);
    o.dataset.temp = '1';
    sel.prepend(o);
  }
  sel.value = fam;
  if (document.activeElement !== $('#tb-size')) $('#tb-size').value = String(Math.round(parseFloat(cs.fontSize) * 10) / 10);
  $('#tb-color-bar').style.background = cs.color;
  const deco = cs.textDecorationLine;
  $('#tb-bold').classList.toggle('on', parseInt(cs.fontWeight, 10) >= 600);
  $('#tb-italic').classList.toggle('on', cs.fontStyle === 'italic');
  $('#tb-underline').classList.toggle('on', deco.includes('underline'));
  $('#tb-strike').classList.toggle('on', deco.includes('line-through'));
  const rcs = S.win.getComputedStyle(node);
  $('#tb-case').classList.toggle('on', rcs.textTransform === 'uppercase');
  let al = rcs.textAlign;
  al = al === 'start' ? 'left' : al === 'end' ? 'right' : al;
  $('#tb-align use').setAttribute('href', '#i-al-' + (['left', 'center', 'right', 'justify'].includes(al) ? al : 'left'));
  const fs = parseFloat(rcs.fontSize) || 16;
  const ls = rcs.letterSpacing === 'normal' ? 0 : Math.round(parseFloat(rcs.letterSpacing) / fs * 1000);
  $('#ls-range').value = ls; $('#ls-out').textContent = ls;
  const lh = rcs.lineHeight === 'normal' ? 1.2 : Math.round(parseFloat(rcs.lineHeight) / fs * 100) / 100;
  $('#lh-range').value = lh; $('#lh-out').textContent = lh;
  const op = Math.round(parseFloat(rcs.opacity) * 100);
  $('#op-range').value = op; $('#op-out').textContent = op;
  const textOnly = !isRoot(node);
  for (const id of ['tb-bold', 'tb-italic', 'tb-underline', 'tb-strike']) $('#' + id).disabled = false;
  el.box.classList.toggle('block', textOnly);
}
export function closePopups() {
  $('#pop-spacing').hidden = true;
  $('#pop-opacity').hidden = true;
  $('#pop-note').hidden = true;
  $('#pop-link').hidden = true;
  $('#pop-alt').hidden = true;
  $('#pop-img').hidden = true;
  el.menu.hidden = true;
}
export function togglePop(id, btn) {
  const pop = $(id);
  const open = pop.hidden;
  closePopups();
  if (!open) return;
  const b = btn.getBoundingClientRect(), s = el.stage.getBoundingClientRect();
  pop.style.left = clamp(b.left - s.left + b.width / 2 - 130, 8, s.width - 268) + 'px';
  pop.hidden = false;
}
