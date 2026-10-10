// Slide management from the filmstrip: duplicate, delete and reorder whole slides. Each is one
// insert / remove / move op on a top-level unit (a slide, or a Reveal vertical stack as a whole),
// so a save stays a patch of that unit's bytes and undo / redo goes through the usual history.
import { $$ } from '../core/utils.mjs';
import { S } from './state.mjs';
import { flushPending } from './edits.mjs';
import { clearMulti, deselect, showSlide } from './selection.mjs';
import { doRemove, nodeRefs, positionOf } from '../core/operations.mjs';
import { isOriginal, markOriginals, markRoots, modelEl, reId } from './live-document.mjs';
import { centerAllSlides, formatCSS } from './document.mjs';
import { commandBlocked } from './guards.mjs';
import { applyMove } from './ops.mjs';
import { pushOp } from './history.mjs';
import { hooks } from '../shared/hooks.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';

const reveal = () => S.format?.format === 'reveal';
// The unit an action moves: a Reveal leaf inside a vertical stack goes with its whole stack.
export function unitOf(slide) {
  const p = slide?.parentElement;
  return reveal() && p?.localName === 'section' ? p : slide;
}
export function units() {
  const out = [];
  for (const s of S.slides) { const u = unitOf(s); if (out[out.length - 1] !== u) out.push(u); }
  return out;
}
const firstLeaf = unit => S.slides.findIndex(s => s === unit || unit.contains(s));

// Why the slide at index i cannot take this action (an i18n key), or null.
export function slideBlock(i, kind) {
  if (S.mode !== 'deck' || S.present || !S.slides[i]) return 'slide_unavailable';
  if (S.readOnly) return S.readOnly;
  const u = unitOf(S.slides[i]), all = units(), k = all.indexOf(u);
  if (!isOriginal(u) || !modelEl(u.dataset.edId)) return 'lock_generated';
  if (kind === 'delete' && all.length < 2) return 'slide_last';
  if (kind === 'left' && k <= 0) return 'slide_unavailable';
  if (kind === 'right' && k >= all.length - 1) return 'slide_unavailable';
  return null;
}
// Refused with its reason shown (the same locks as for a block: read-only, generated, Markdown).
function refused(i, kind) {
  const why = slideBlock(i, kind);
  if (why === 'slide_unavailable') return true;
  if (why) { toast(t(why), { ms: 4000 }); return true; }
  return commandBlocked(unitOf(S.slides[i]), 'edit');
}
// Typed text, an open SVG label and speaker notes still waiting to be saved belong to the slide
// they were typed on: saved before the slide list changes under them.
function begin() {
  flushPending();
  clearMulti();
  deselect();
}
// The indentation right before a unit, in the model and the live page alike: it moves with the
// unit, so the file keeps one slide after another on their own lines.
function leadWs(l, m) {
  const a = m?.previousSibling, b = l?.previousSibling;
  return a?.nodeType === 3 && b?.nodeType === 3 && /^\s+$/.test(a.nodeValue) && a.nodeValue === b.nodeValue ? { m: a, l: b } : null;
}
// A copy that is still equal to its original is saved with the original's exact source text.
export function noteCopy(copy, original) {
  (S.copies ||= new Map()).set(copy.getAttribute('data-ed-id'), original.getAttribute('data-ed-id'));
}

export function duplicateSlide(i) {
  if (refused(i, 'duplicate')) return false;
  begin();
  const u = unitOf(S.slides[i]), m = modelEl(u.dataset.edId);
  const mc = m.cloneNode(true), lead = leadWs(u, m);
  reId(mc);
  noteCopy(mc, m);
  m.parentNode.insertBefore(mc, m.nextSibling);
  const lc = S.doc.importNode(mc, true);
  u.parentNode.insertBefore(lc, u.nextSibling);
  const ws = lead && { m: lead.m.cloneNode(), l: lead.l.cloneNode() };
  if (ws) { mc.before(ws.m); lc.before(ws.l); }
  markOriginals(lc, mc);
  markCopy(u, m, lc, mc);
  markRoots(lc, true);
  pushOp({ type: 'insert', label: 'Duplicate slide', slide: { at: i }, ws, ...nodeRefs(mc, lc, ws) });
  afterSlideOp(i + 1, lc);
  return true;
}
// The copy's slides carry the editor's slide marks: they persist on these nodes through undo/redo.
function markCopy(u, m, lc, mc) {
  for (const s of S.slides) {
    if (s !== u && !u.contains(s)) continue;
    const ms = modelEl(s.dataset.edId);
    if (!ms) continue;
    const path = [];
    for (let n = ms; n && n !== m; n = n.parentElement) path.unshift([...n.parentElement.children].indexOf(n));
    let c = mc;
    for (const k of path) c = c?.children[k];
    const lcs = c && (c === mc ? lc : lc.querySelector(`[data-ed-id="${c.getAttribute('data-ed-id')}"]`));
    if (!lcs) continue;
    lcs.setAttribute('data-ed-slide', '');
    lcs.dataset.edDisplay = s.dataset.edDisplay || 'block';
  }
  if (lc !== u && !lc.hasAttribute('data-ed-slide')) lc.setAttribute('data-ed-slide-anc', '');
}

export function deleteSlide(i) {
  if (refused(i, 'delete')) return false;
  begin();
  const u = unitOf(S.slides[i]), m = modelEl(u.dataset.edId), at = firstLeaf(u);
  const ws = leadWs(u, m);
  const op = { type: 'remove', label: 'Delete slide', slide: { at }, ws, ...nodeRefs(m, u, ws) };
  doRemove(op);
  pushOp(op);
  afterSlideOp(at, null);
  toast(t('slide_deleted'));
  return true;
}

// Move the slide at index i one unit earlier (-1) or later (+1).
export function nudgeSlide(i, dir) {
  const all = units(), u = unitOf(S.slides[i]), k = all.indexOf(u), target = all[k + dir];
  if (!target) return false;
  return moveSlide(i, target, dir < 0 ? 'before' : 'after');
}
// Move the slide at index i before / after the unit holding `targetSlide`.
export function moveSlide(i, targetSlide, mode) {
  if (refused(i, 'move')) return false;
  const node = unitOf(S.slides[i]), target = unitOf(targetSlide);
  if (!target || target === node || target.parentNode !== node.parentNode) return false;
  begin();   // a commit may replace model nodes: every reference below is taken after it
  const m = modelEl(node.dataset.edId), mt = modelEl(target.dataset.edId);
  if (!m || !mt) return false;
  // Before a unit is before its indentation; after it is right after its end tag.
  const ws = leadWs(node, m), tws = leadWs(target, mt);
  const lRef = mode === 'before' ? tws?.l || target : target.nextSibling;
  const mRef = mode === 'before' ? tws?.m || mt : mt.nextSibling;
  if (lRef === node || lRef === ws?.l || lRef === node.nextSibling) return false;   // already there
  const op = {
    type: 'move', label: 'Move slide', slide: { at: i }, ws, m, l: node,
    from: { mP: m.parentNode, mN: m.nextSibling, lP: node.parentNode, lN: node.nextSibling, ...positionOf(m, node, ws) },
    to: { mP: m.parentNode, mN: mRef, lP: node.parentNode, lN: lRef },
  };
  applyMove(op, true);
  Object.assign(op.to, positionOf(m, node, ws));
  pushOp(op);
  afterSlideOp(null, node);
  return true;
}

// After a slide op, its undo or its redo: the slide list, current slide and filmstrip follow the
// DOM. Lands on `unit` when it is in the document, else on index `at`.
export function afterSlideOp(at, unit) {
  clearMulti();   // a group on another slide must not follow the keys (undo / redo lands here too)
  refreshSlides();
  const k = unit?.isConnected ? firstLeaf(unit) : -1;
  showSlide(k >= 0 ? k : Math.min(at ?? S.cur, S.slides.length - 1));
  hooks.buildFilmstrip();
  hooks.renderPins();
  if (hooks.layersVisible()) hooks.buildLayers();
}
// Called by undo / redo for an op that carries `slide`.
export function afterSlideStep(op) { afterSlideOp(op.slide.at, op.l); }

export function refreshSlides() {
  if (!S.doc) return;
  S.slides = $$('[data-ed-slide]', S.doc);
  for (const s of S.slides) for (let n = s.parentElement; n && n !== S.doc.documentElement; n = n.parentElement) n.setAttribute('data-ed-slide-anc', '');
  if (reveal()) {
    // Backgrounds are keyed by data-ed-id: a copy needs its own rules.
    const fmt = S.doc.getElementById('ed-format');
    if (fmt) fmt.textContent = formatCSS();
    centerAllSlides();
  }
  document.body.dataset.slideCount = String(S.slides.length);
}
