// Text formatting: styles, fonts, colors, alignment, case.
import { $$, clamp } from '../core/utils.mjs';
import { FONTS, S } from '../editor/state.mjs';
import { buildStyleOp, needsImportant, styleEdit } from '../editor/commands.mjs';
import { commitText, markTextDirty, scheduleCommit } from '../editor/edits.mjs';
import { hasDirectText, isOriginal } from '../editor/live-document.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { hooks } from '../shared/hooks.mjs';
import { pushOp } from '../editor/history.mjs';

// ================================================================ formatting
export function focusSel() {
  if (S.sel && S.doc.activeElement !== S.sel) S.sel.focus({ preventScroll: true });
}
export function restoreRange() {
  const r = S.savedRange;
  if (!r || !S.sel || !S.sel.contains(r.commonAncestorContainer)) return;
  const sel = S.win.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
export function hasTextSelection() {
  if (!S.editing || !S.sel) return false;
  const sel = S.win.getSelection();
  let r = sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!r || r.collapsed || !S.sel.contains(r.commonAncestorContainer)) r = S.savedRange;
  return !!(r && !r.collapsed && S.sel.contains(r.commonAncestorContainer));
}
export function execOnSelection(cmd) {
  focusSel();
  restoreRange();
  S.doc.execCommand('styleWithCSS', false, false);
  S.doc.execCommand(cmd, false, null);
  S.textDirty = true;  // claimed by the trusted input event execCommand fires
  scheduleCommit();
  hooks.refreshToolbar();
}
// Wrap the selected text in a span carrying one CSS property. Repeated calls on the same
// selection (slider/colour drags) update that span instead of nesting new ones.
export function wrapSelection(prop, value) {
  focusSel();
  restoreRange();
  const sel = S.win.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  const w = S.lastWrap;
  if (w && w.isConnected && r.startContainer === w && r.startOffset === 0 && r.endContainer === w && r.endOffset === w.childNodes.length) {
    w.style.setProperty(prop, value);
  } else {
    const span = S.doc.createElement('span');
    span.style.setProperty(prop, value);
    span.appendChild(r.extractContents());
    r.insertNode(span);
    S.lastWrap = span;
  }
  if (needsImportant(S.lastWrap, prop)) S.lastWrap.style.setProperty(prop, value, 'important');
  const nr = S.doc.createRange();
  nr.selectNodeContents(S.lastWrap);
  sel.removeAllRanges();
  sel.addRange(nr);
  S.savedRange = nr.cloneRange();
  markTextDirty();
  scheduleCommit();
  hooks.updateChrome();
}
export function computedFor(node) {
  let probe = node;
  if (S.editing) {
    const sel = S.win.getSelection();
    if (sel.rangeCount) {
      let n = sel.getRangeAt(0).startContainer;
      if (n.nodeType === 3) n = n.parentElement;
      if (n && node.contains(n)) probe = n;
    }
  }
  return S.win.getComputedStyle(probe);
}
export function toggleStyle(cmd) {
  if (!S.sel) return;
  if (hasTextSelection()) return execOnSelection(cmd);
  const cs = S.win.getComputedStyle(S.sel);
  const deco = new Set(cs.textDecorationLine.split(' ').filter(v => v !== 'none'));
  if (cmd === 'bold') styleEdit(S.sel, { 'font-weight': parseInt(cs.fontWeight, 10) >= 600 ? '400' : '700' });
  else if (cmd === 'italic') styleEdit(S.sel, { 'font-style': cs.fontStyle === 'italic' ? 'normal' : 'italic' });
  else {
    const v = cmd === 'underline' ? 'underline' : 'line-through';
    deco.has(v) ? deco.delete(v) : deco.add(v);
    styleEdit(S.sel, { 'text-decoration-line': deco.size ? [...deco].join(' ') : 'none' });
  }
  hooks.refreshToolbar();
}
export function setFontSize(px) {
  if (!S.sel || !(px > 0)) return;
  px = clamp(Math.round(px * 10) / 10, 4, 800);
  if (hasTextSelection()) wrapSelection('font-size', px + 'px');
  else styleEdit(S.sel, { 'font-size': px + 'px' }, 'size');
  hooks.refreshToolbar();
}
export function applyColor(hex) {
  if (!S.sel) return toast('Select a text block first');
  if (S.colorTarget === 'bg') styleEdit(S.sel, { 'background-color': hex }, 'bg');
  else if (hasTextSelection()) wrapSelection('color', hex);
  else { styleEdit(S.sel, { color: hex }, 'color'); offerChildColor(S.sel, hex); }
  hooks.refreshToolbar();
}
// Text inside the block that keeps its own colour (a class on a child) does not follow the
// block's new colour. Say so, and offer to apply it to those children as one undo step.
export function offerChildColor(node, hex) {
  if (!node?.isConnected) return;
  const want = S.win.getComputedStyle(node).color;
  const kids = $$('*', node).filter(e => isOriginal(e) && hasDirectText(e) && S.win.getComputedStyle(e).color !== want);
  if (!kids.length) return;
  toast(t('color_kids').replace('{n}', kids.length), { ms: 6000, action: { label: t('color_kids_apply'), fn: () => {
    commitText();
    const ops = kids.filter(k => k.isConnected).map(k => buildStyleOp(k, { color: hex })).filter(Boolean);
    if (!ops.length) return;
    pushOp(ops.length === 1 ? ops[0] : { type: 'batch', ops, label: t('color_kids_apply') });
    hooks.queueThumb(node);
  } } });
}
export function applyFont(name) {
  const f = FONTS.find(x => x[0] === name);
  if (!S.sel || !f) return;
  ensureFontLink(f);
  const family = `'${f[0]}', ${f[1]}`;
  if (hasTextSelection()) wrapSelection('font-family', family);
  else styleEdit(S.sel, { 'font-family': family });
  hooks.refreshToolbar();
}
// Google fonts are linked into the model too, so the saved file renders the chosen face.
export function ensureFontLink([name, , weights]) {
  if (!weights) return;
  const family = name.replace(/ /g, '+');
  const has = d => $$('link[href*="fonts.googleapis.com"]', d).some(l => l.getAttribute('href').includes('family=' + family + ':') || l.getAttribute('href').includes('family=' + family + '&'));
  if (has(S.model)) return;
  const link = S.model.createElement('link');
  link.setAttribute('rel', 'stylesheet');
  link.setAttribute('href', `https://fonts.googleapis.com/css2?family=${family}:wght@${weights}&display=swap`);
  link.setAttribute('data-ed-id', String(S.nextId++));
  S.model.head.appendChild(link);
  S.touched.add(S.model.head.getAttribute('data-ed-id'));
  S.doc.head.appendChild(S.doc.importNode(link, true));
}
export function cycleAlign() {
  if (!S.sel) return;
  const order = ['left', 'center', 'right', 'justify'];
  let cur = S.win.getComputedStyle(S.sel).textAlign;
  cur = cur === 'start' ? 'left' : cur === 'end' ? 'right' : cur;
  styleEdit(S.sel, { 'text-align': order[(order.indexOf(cur) + 1) % order.length] });
  hooks.refreshToolbar();
}
export function toggleCase() {
  if (!S.sel) return;
  const up = S.win.getComputedStyle(S.sel).textTransform === 'uppercase';
  styleEdit(S.sel, { 'text-transform': up ? 'none' : 'uppercase' });
  hooks.refreshToolbar();
}
