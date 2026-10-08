// Delete, duplicate, insert, copy / paste style.
import { NO_BLOCK_PARENT, PRESETS, S } from './state.mjs';
import { commitText } from './edits.mjs';
import { deselect, select, setEditing } from './selection.mjs';
import { doRemove, nodeRefs, setStyleAttr } from '../core/operations.mjs';
import { isOriginal, markOriginals, markRoots, modelEl, pickBlock, reId } from './live-document.mjs';
import { parseTranslate } from '../core/utils.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { selectAllIn } from './caret.mjs';
import { hooks } from '../shared/hooks.mjs';
import { commandBlocked, lockedHint } from './guards.mjs';
import { pushOp } from './history.mjs';

// ================================================================ element actions
export function deleteSel() {
  const node = S.sel;
  if (!node || commandBlocked(node)) return;
  const m = modelEl(node.dataset.edId);
  deselect();
  if (!m) return;
  const op = { type: 'remove', label: 'Delete', ...nodeRefs(m, node) };
  doRemove(op);
  pushOp(op);
  hooks.queueThumb(S.slides[S.cur]);
  if (hooks.layersVisible()) hooks.buildLayers();
  toast('Deleted · Ctrl+Z to undo');
}
export function duplicateSel() {
  const node = S.sel;
  if (!node || commandBlocked(node, 'duplicate')) return;
  setEditing(false);
  const m = modelEl(node.dataset.edId);
  if (!m) return;
  const mc = m.cloneNode(true);
  reId(mc);
  const pos = S.win.getComputedStyle(node).position;
  if (pos === 'absolute' || pos === 'fixed') {
    const [tx, ty] = parseTranslate(mc.style.translate);
    mc.style.setProperty('translate', `${tx + 24}px ${ty + 24}px`);
  }
  m.parentNode.insertBefore(mc, m.nextSibling);
  const lc = S.doc.importNode(mc, true);
  node.parentNode.insertBefore(lc, node.nextSibling);
  markOriginals(lc, mc);
  markRoots(lc, true);
  pushOp({ type: 'insert', label: 'Duplicate', ...nodeRefs(mc, lc) });
  select(lc, { edit: false });
  hooks.queueThumb(lc);
  if (hooks.layersVisible()) hooks.buildLayers();
}
export function insertText(kind) {
  if (!S.doc) return toast('Please open a document first');
  if (S.readOnly) return lockedHint(S.readOnly);
  const p = PRESETS[kind];
  const css = { ...p.css };
  let lParent, lRef = null, mParent, mRef = null;
  if (S.mode === 'deck') {
    lParent = S.slides[S.cur];
    Object.assign(css, { position: 'absolute', left: '120px', top: p.top + 'px', margin: '0', 'z-index': '20', 'max-width': '1040px' });
  } else {
    let anchor = S.sel || rootNearViewportCenter();
    while (anchor && anchor.parentElement && NO_BLOCK_PARENT.has(anchor.parentElement.localName) && isOriginal(anchor.parentElement)) anchor = anchor.parentElement;
    if (!anchor || !anchor.parentElement || !isOriginal(anchor.parentElement)) return toast('Select a text block to insert after');
    lParent = anchor.parentElement;
    lRef = anchor.nextSibling;
    mRef = modelEl(anchor.dataset.edId)?.nextSibling || null;
    css.margin = '12px 0';
  }
  mParent = modelEl(lParent.dataset.edId);
  if (!mParent) return;
  deselect();
  const m = S.model.createElement(p.tag);
  m.setAttribute('data-ed-id', String(S.nextId++));
  for (const [k, v] of Object.entries(css)) m.style.setProperty(k, v);
  m.textContent = t('preset_' + kind, p.text);
  mParent.insertBefore(m, mRef);
  const l = S.doc.importNode(m, true);
  lParent.insertBefore(l, lRef && lRef.parentNode === lParent ? lRef : null);
  markOriginals(l, m);
  markRoots(l, true);
  pushOp({ type: 'insert', label: 'Add text', ...nodeRefs(m, l) });
  if (S.mode === 'page') l.scrollIntoView({ block: 'center' });
  select(l, { edit: true });
  selectAllIn(l);
  hooks.queueThumb(l);
}
export function rootNearViewportCenter() {
  const mid = S.win.innerHeight / 2;
  let best = null, bestD = Infinity;
  for (const node of S.liveById.values()) {
    if (!node.isConnected) continue;
    const r = node.getBoundingClientRect();
    if (!r.height) continue;
    const d = Math.abs(r.top + r.height / 2 - mid);
    if (d < bestD) { best = node; bestD = d; }
  }
  return best;
}
export function selectParent() {
  if (!S.sel) return;
  const parent = pickBlock(S.sel.parentElement || S.sel);
  if (parent) select(parent, { edit: false }); else toast('Already at the outermost block');
}
export function copyStyle() {
  if (!S.sel) return;
  S.styleClip = modelEl(S.sel.dataset.edId)?.getAttribute('style') || '';
  toast('Style copied');
}
export function pasteStyle() {
  if (!S.sel || S.styleClip == null) return toast('No style copied yet');
  if (commandBlocked(S.sel)) return;
  const node = S.sel, m = modelEl(node.dataset.edId);
  if (!m) return;
  commitText();
  const before = m.getAttribute('style'), after = S.styleClip || null;
  if (before === after) return;
  setStyleAttr(m, after); setStyleAttr(node, after);
  pushOp({ type: 'style', id: node.dataset.edId, before, after, label: 'Paste style' });
  hooks.queueThumb(node);
  hooks.refreshToolbar();
}
export function clearStyle() {
  if (!S.sel || commandBlocked(S.sel)) return;
  const node = S.sel, m = modelEl(node.dataset.edId);
  if (!m) return;
  const orig = m.getAttribute('style');
  if (orig == null) return toast('This block has no inline formatting');
  commitText();
  setStyleAttr(m, null); setStyleAttr(node, null);
  pushOp({ type: 'style', id: node.dataset.edId, before: orig, after: null, label: 'Clear formatting' });
  hooks.queueThumb(node);
  hooks.refreshToolbar();
}
