// Document operations, applied to the model and to the rendered iframe together.
// `live` adapts the iframe: { el(id), sync(liveNode, modelNode), adopt(l, m), refresh(l) }.
// Ops: html | style | attrs | move | insert | remove | batch, each with before/after.
import { modelEl, touchOp } from './model.mjs';

export function setStyleAttr(node, v) {
  if (!node) return;
  if (v == null || v === '') node.removeAttribute('style'); else node.setAttribute('style', v);
}
export function setAttrs(n, map) {
  if (!n) return;
  for (const [name, v] of Object.entries(map)) { if (v == null) n.removeAttribute(name); else n.setAttribute(name, v); }
}
export function placeAt(n, parent, ref) { parent.insertBefore(n, ref && ref.parentNode === parent ? ref : null); }
const indexIn = n => n.parentNode ? Array.prototype.indexOf.call(n.parentNode.childNodes, n) : -1;
const prevTextLen = n => n.previousSibling?.nodeType === 3 ? n.previousSibling.nodeValue.length : null;
// mIdx / lIdx: where the node sits among its siblings, and mPrev / lPrev the length of the text
// right before it, so a next sibling that was replaced (an 'html' op rewrites the text nodes,
// and merges the two around a removed element into one) can still be found by position.
// The same for a move's from / to position, taken while the node is there.
export function positionOf(m, l) { return { mI: indexIn(m), mPrev: prevTextLen(m), lI: indexIn(l), lPrev: prevTextLen(l) }; }
export function nodeRefs(m, l) {
  return { m, mParent: m.parentNode, mNext: m.nextSibling, mIdx: indexIn(m), mPrev: prevTextLen(m),
    l, lParent: l.parentNode, lNext: l.nextSibling, lIdx: indexIn(l), lPrev: prevTextLen(l) };
}
// Ops keep node references, but an 'html' op (a text commit, or its undo) replaces the
// descendants of the element it edits with equal copies carrying the same data-ed-id. A
// reference that has left its document is looked up again by that id when the op is applied.
const edId = n => n && n.nodeType === 1 ? n.getAttribute('data-ed-id') : null;
function current(n, find) {
  if (!n || n.isConnected) return n;
  const id = edId(n);
  return (id && find(id)) || n;
}
function refreshRefs(st, op, live) {
  if (!st || !live?.el) return;
  const fm = id => modelEl(st, id), fl = id => live.el(id);
  for (const k of ['m', 'mParent', 'mNext']) op[k] = current(op[k], fm);
  for (const k of ['l', 'lParent', 'lNext']) op[k] = current(op[k], fl);
}
// The sibling to insert before: the recorded one if it is still there, else the node now at its
// position (only when there was one: null meant "at the end"). Text on both sides merged into
// one node is split back where the node was.
function nextRef(parent, next, idx, prevLen) {
  if (!next) return null;
  if (next.parentNode === parent) return next;
  if (idx == null || idx < 0) return null;
  const before = parent.childNodes[idx - 1];
  if (next.nodeType === 3 && prevLen != null && before?.nodeType === 3 && before.nodeValue.length > prevLen) return before.splitText(prevLen);
  return parent.childNodes[idx] ?? null;
}
export function doInsert(op, live, st) {
  refreshRefs(st, op, live);
  op.mParent.insertBefore(op.m, nextRef(op.mParent, op.mNext, op.mIdx, op.mPrev));
  op.lParent.insertBefore(op.l, nextRef(op.lParent, op.lNext, op.lIdx, op.lPrev));
  live.adopt(op.l, op.m);
}
export function doRemove(op, live, st) { refreshRefs(st, op, live); op.m.remove(); op.l.remove(); }
export function applyMove(op, redo, live, st) {
  const t = redo ? op.to : op.from;
  if (st && live?.el) {
    const fm = id => modelEl(st, id), fl = id => live.el(id);
    op.m = current(op.m, fm); op.l = current(op.l, fl);
    for (const k of ['mP', 'mN']) t[k] = current(t[k], fm);
    for (const k of ['lP', 'lN']) t[k] = current(t[k], fl);
  }
  // Taken out first: the recorded positions count the siblings without the node.
  op.m.remove(); op.l.remove();
  t.mP.insertBefore(op.m, nextRef(t.mP, t.mN, t.mI, t.mPrev));
  t.lP.insertBefore(op.l, nextRef(t.lP, t.lN, t.lI, t.lPrev));
  live.refresh(op.l);
  return op.l;
}
export function applyOp(st, op, redo, live) {
  touchOp(st, op);
  switch (op.type) {
    case 'html': {
      const v = redo ? op.after : op.before, m = modelEl(st, op.id), l = live.el(op.id);
      if (m) m.innerHTML = v;
      if (l) { l.innerHTML = v; live.sync(l, m); }
      return l;
    }
    case 'style': {
      const v = redo ? op.after : op.before, l = live.el(op.id);
      setStyleAttr(modelEl(st, op.id), v);
      setStyleAttr(l, v);
      return l;
    }
    case 'attrs': {
      const l = live.el(op.id);
      setAttrs(modelEl(st, op.id), redo ? op.after : op.before);
      setAttrs(l, redo ? op.after : op.before);
      return l;
    }
    case 'move': return applyMove(op, redo, live, st);
    case 'batch': {
      let target = null;
      for (const sub of redo ? op.ops : [...op.ops].reverse()) target = applyOp(st, sub, redo, live) || target;
      return target;
    }
    case 'insert': if (redo) { doInsert(op, live, st); return op.l; } doRemove(op, live, st); return null;
    case 'remove': if (redo) { doRemove(op, live, st); return null; } doInsert(op, live, st); return op.l;
  }
  return null;
}
