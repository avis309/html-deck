// "Animate this slide": assigns effects to the current slide's blocks (or the page's) as one
// undoable batch of data-fx attributes. Conservative: no loops, no grow; never touches blocks
// that already have an effect, scenes, or blocks the editor refuses effects on.
import { S } from '../editor/state.mjs';
import { setAttrs } from '../core/operations.mjs';
import { flushPending } from '../editor/edits.mjs';
import { pushOp } from '../editor/history.mjs';
import { isOriginal, isRoot, modelEl } from '../editor/live-document.mjs';
import { fxApi, fxBlock, fxScope, renderFxDoc, renderFxList, sceneNamesFor } from './effects.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';

const STEP = 120, MAX_DELAY = 1600, MAX_BLOCKS = 24, STAGGER = '90';
const MEDIA = new Set(['img', 'picture', 'video']);

// ≥3 element children with the same tag and class: cards, list items, rows, KPI tiles.
function isGroup(n) {
  const kids = [...n.children];
  return kids.length >= 3 && kids.every(k => k.localName === kids[0].localName && k.className === kids[0].className);
}
// A scene anywhere above (a Reveal vertical stack, the deck wrapper…) owns the block's motion.
function inScene(n) {
  for (let a = n; a; a = a.parentElement) if (sceneNamesFor(a).length) return true;
  return false;
}
// The effect a block gets, or null. `covered`: inside a block that already moves, where only a
// count-up still adds something.
// A figure, not a sentence or a date that happens to hold a number: at most a short sign or
// currency before it and a short unit after it ("$1.2M", "48%", "3.2x", "1.250 ₫").
function isFigure(n, api) {
  const p = api.parseCount(n.textContent.trim());
  return !!p && p.pre.replace(/\s/g, '').length <= 2 && !/\s\S/.test(p.post.trim()) && p.post.trim().length <= 3;
}
function pick(n, covered, api) {
  if (isRoot(n) && !api.check(n, 'count-up') && isFigure(n, api)) return { 'data-fx': 'count-up' };
  if (covered) return null;
  if (n.localName === 'svg') return api.check(n, 'draw') ? { 'data-fx': 'zoom-in' } : { 'data-fx': 'draw', 'data-fx-stagger': STAGGER };
  if (MEDIA.has(n.localName)) return { 'data-fx': 'zoom-in' };
  if (!isRoot(n) && isGroup(n)) return { 'data-fx': 'fade-up', 'data-fx-stagger': STAGGER };
  if (isRoot(n)) return { 'data-fx': 'fade-up' };
  return null;
}
export function planAutoFx(scope) {
  const api = fxApi();
  if (!scope || !api) return [];
  // A slide (or an ancestor) that already moves covers everything in it.
  const plan = [], covered = scope.closest('[data-fx]') ? [scope] : [];
  // Delays count within what the runtime reveals at once: the slide in a deck; on a page each
  // section / .slide (or the block itself) as it scrolls in.
  const steps = new Map(), part = n => S.mode === 'deck' ? scope : n.closest('section, .slide') || n;
  for (const n of scope.querySelectorAll('*')) {
    if (plan.length >= MAX_BLOCKS) break;
    if (!isOriginal(n) || !n.getClientRects().length) continue;
    if (inScene(n)) continue;
    const under = covered.some(r => r.contains(n));
    if (n.hasAttribute('data-fx')) { covered.push(n); continue; }
    const fx = pick(n, under, api);
    if (!fx || fxBlock(n, fx['data-fx'])) continue;
    const key = part(n), k = steps.get(key) || 0, delay = Math.min(k * STEP, MAX_DELAY);
    steps.set(key, k + 1);
    plan.push({ node: n, attrs: { 'data-fx': fx['data-fx'], 'data-fx-delay': delay ? String(delay) : null, 'data-fx-stagger': fx['data-fx-stagger'] || null } });
    if (fx['data-fx'] !== 'count-up') covered.push(n);
  }
  return plan;
}
export function animateScope() {
  if (!S.doc) return;
  flushPending();
  const plan = planAutoFx(fxScope());
  if (!plan.length) { toast(t('fx_auto_none')); return; }
  const ops = [];
  for (const { node, attrs } of plan) {
    const id = node.dataset.edId, m = modelEl(id);
    if (!m) continue;
    const before = Object.fromEntries(Object.keys(attrs).map(a => [a, m.getAttribute(a)]));
    setAttrs(m, attrs);
    setAttrs(node, attrs);
    ops.push({ type: 'attrs', id, before, after: attrs });
  }
  pushOp({ type: 'batch', label: 'Animate slide', ops });
  renderFxList();
  renderFxDoc();
  toast(t('fx_auto_done').replace('{n}', ops.length));
}
