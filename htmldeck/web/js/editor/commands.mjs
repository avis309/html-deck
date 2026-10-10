// Style and attribute edits, and undo / redo with recovery from a failed step.
import * as History from '../core/history.mjs';
import { S, el } from './state.mjs';
import { claimOwn, commitText, flushPending } from './edits.mjs';
import { deselect, select, showSlide } from './selection.mjs';
import { modelEl } from './live-document.mjs';
import { setAttrs, setStyleAttr } from '../core/operations.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { placeCaretEnd } from './caret.mjs';
import { hooks } from '../shared/hooks.mjs';
import { commandBlocked, lockedHint } from './guards.mjs';
import { afterChange, isDirty, pushOp } from './history.mjs';
import { loadNotes } from './speaker-notes.mjs';
import { applyOp } from './ops.mjs';
import { afterSlideStep } from './slide-actions.mjs';

// Does an inline declaration lose to a stylesheet `!important` rule (Tailwind `important: true`,
// `!` utilities, hand-written overrides)? Measured, not guessed: read the computed values with
// the declaration at normal priority, then at !important; a difference means normal loses.
// Shorthands are compared on their longhands. Transitions are paused during the probe; the
// editor's own slide locks (FRAME_CSS) are never fought.
export const STYLE_LONGHANDS = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  border: ['border-top-width', 'border-top-style', 'border-top-color', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  background: ['background-color', 'background-image'],
};
export function needsImportant(el, prop) {
  if (!el?.isConnected || !S.win || el.hasAttribute('data-ed-slide')) return false;
  const st = el.style, val = st.getPropertyValue(prop);
  if (!val || st.getPropertyPriority(prop)) return false;
  const longs = STYLE_LONGHANDS[prop] || [prop];
  const tv = st.getPropertyValue('transition'), tp = st.getPropertyPriority('transition');
  st.setProperty('transition', 'none', 'important');
  try {
    const cs = S.win.getComputedStyle(el);
    const a = longs.map(p => cs.getPropertyValue(p));
    st.setProperty(prop, val, 'important');
    const b = longs.map(p => cs.getPropertyValue(p));
    st.setProperty(prop, val, '');
    return a.some((x, i) => x !== b[i]);
  } finally {
    if (tv) st.setProperty('transition', tv, tp); else st.removeProperty('transition');
  }
}
export function buildStyleOp(node, props) {
  if (commandBlocked(node)) return null;
  const id = node.dataset.edId, m = modelEl(id);
  if (!m) return null;
  const before = m.getAttribute('style');
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === '') { m.style.removeProperty(k); continue; }
    // "value !important" forces priority; otherwise keep the priority the file already gave it.
    const forced = /\s*!important\s*$/i.test(v);
    m.style.setProperty(k, v.replace(/\s*!important\s*$/i, ''), forced ? 'important' : m.style.getPropertyPriority(k));
  }
  let after = m.getAttribute('style');
  if (after === '') { m.removeAttribute('style'); after = null; }
  setStyleAttr(node, after);
  // Escalate only the declarations the page's own !important rules would otherwise ignore.
  let raised = false;
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === '' || m.style.getPropertyPriority(k) || !needsImportant(node, k)) continue;
    m.style.setProperty(k, m.style.getPropertyValue(k), 'important');
    raised = true;
  }
  if (raised) { after = m.getAttribute('style'); setStyleAttr(node, after); }
  claimOwn();
  return before === after ? null : { type: 'style', id, before, after, label: 'Format' };
}
export function styleEdit(node, props, key) {
  commitText();
  const op = buildStyleOp(node, props);
  if (!op) return;
  op.key = key ? key + ':' + op.id : null;
  pushOp(op);
  hooks.queueThumb(node);
}
// Restore the model from before the failed step and rebuild the preview from it. History has
// to go: its ops point at live nodes of the preview being replaced.
export async function recoverFailedStep(modelBefore, wasDirty, err) {
  console.error('HtmlDeck: undo/redo step failed', err);
  if (modelBefore) S.model = modelBefore;
  // Shown once the rebuilt preview is up, after (not under) its own "opened" toast.
  S.afterReady = () => toast(t('history_step_failed'), { err: true, ms: 8000 });
  await hooks.rerender({ force: true, dirty: wasDirty });
}
export const COMPOUND_OPS = new Set(['batch', 'move', 'insert', 'remove']);
export function undo() { stepHistory(false); }
export function redo() { stepHistory(true); }
export function stepHistory(forward) {
  if (!S.model) return;
  hooks.stopFxPreview();
  if (S.readOnly) { lockedHint(S.readOnly); return; }
  const wasEditing = S.editing;
  flushPending();
  // The request in flight carries a snapshot; recovering under it would lose track of the save.
  if (S.saving) { toast(t('history_wait_save')); return; }
  const wasDirty = isDirty();
  const next = forward ? S.redo[S.redo.length - 1] : S.undo[S.undo.length - 1];
  // A compound step that throws half way (one sub-op applied, the next failing) would leave model
  // and preview disagreeing: keep the model from before it to fall back on. Single html/style/
  // attrs ops change one node and need no copy (the copy is linear in the document size).
  const before = next && COMPOUND_OPS.has(next.type) ? S.model.cloneNode(true) : null;
  // A single op changes one model element; a copy of just that element is enough to undo it.
  const single = next && !before ? modelEl(next.id) : null, singleCopy = single?.cloneNode(true);
  const op = History.takeStep(S, forward);
  if (!op) { hooks.updateChrome(); return; }
  deselect();
  let target;
  try {
    if (S.faultNextStep === 'step' && op.type === 'batch') {
      S.faultNextStep = null;
      applyOp((forward ? op.ops : [...op.ops].reverse())[0], forward);
      throw new Error('injected fault after the first sub-op');
    }
    if (S.faultNextStep === 'single' && op.type === 'html') {
      S.faultNextStep = null;
      modelEl(op.id).innerHTML = forward ? op.after : op.before;  // model written, live not
      throw new Error('injected fault after the model write');
    }
    target = applyOp(op, forward);
  } catch (e) {
    if (single && singleCopy && single.isConnected) single.replaceWith(singleCopy);
    recoverFailedStep(before, wasDirty, e);
    return;
  }
  History.finishStep(S, op, forward);
  // A slide op changes the slide list itself: it lands on the slide, nothing gets selected.
  if (op.slide) afterSlideStep(op);
  else if (target && target.isConnected) {
    const slideIdx = S.slides.indexOf(target.closest('[data-ed-slide]'));
    if (slideIdx >= 0 && slideIdx !== S.cur) showSlide(slideIdx);
    select(target, { edit: wasEditing && op.type === 'html' });
    if (S.editing) placeCaretEnd(target);
    hooks.queueThumb(target);
  } else {
    hooks.queueThumb(S.slides[S.cur]);
  }
  if (!el.notes.hidden) loadNotes();
  hooks.renderBoxPanel();
  hooks.renderPins();
  if (hooks.layersVisible()) hooks.buildLayers();
  hooks.updateChrome();
  afterChange();
}

// Apply attribute changes to model + live and return the op (not pushed), or null.
export function buildAttrsOp(node, changes, label) {
  if (commandBlocked(node)) return null;
  const id = node.dataset.edId, m = modelEl(id);
  if (!m) return null;
  const before = {}, after = {};
  for (const [name, value] of Object.entries(changes)) {
    const cur = m.getAttribute(name);
    if (cur === value) continue;
    before[name] = cur;
    after[name] = value;
  }
  if (!Object.keys(after).length) return null;
  setAttrs(m, after);
  setAttrs(node, after);
  claimOwn();
  return { type: 'attrs', id, before, after, label };
}
// Several attributes of one element as a single undo step.
export function attrsEdit(node, changes, label) {
  const op = buildAttrsOp(node, changes, label);
  if (op) pushOp(op);
}
