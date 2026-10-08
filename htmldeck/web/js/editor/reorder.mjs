// Containment rules, moving and reordering blocks.
import { S } from './state.mjs';
import { VOID_TAGS, stripIds } from '../core/serializer.mjs';
import { commitText } from './edits.mjs';
import { isOriginal, modelEl } from './live-document.mjs';
import { positionOf } from '../core/operations.mjs';
import { select } from './selection.mjs';
import { toast } from '../shared/toast.mjs';
import { hooks } from '../shared/hooks.mjs';
import { layerKids, layerScope } from './layer-tree.mjs';
import { commandBlocked } from './guards.mjs';
import { applyMove } from './ops.mjs';
import { pushOp } from './history.mjs';

// ================================================================ move / reorder blocks
export const NO_CHILDREN = new Set(['img', 'svg', 'canvas', 'video', 'audio', 'iframe', 'textarea', 'select', 'input', 'script', 'style', 'template', 'picture', 'object', 'embed', 'br', 'hr', 'wbr', 'math']);
// Parents whose content model is text-level only: a block dropped inside is re-parented on reload.
export const PHRASING_ONLY = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'b', 'strong', 'em', 'i', 'u', 's', 'small', 'label', 'code', 'pre', 'sup', 'sub', 'mark', 'abbr', 'time', 'kbd', 'caption', 'dt', 'legend', 'button']);
export const INLINE_TAGS = new Set(['span', 'a', 'b', 'strong', 'em', 'i', 'u', 's', 'small', 'mark', 'sup', 'sub', 'code', 'img', 'br', 'label', 'abbr', 'time', 'kbd']);
// Children that the HTML parser only keeps inside specific parents, and parents that only keep specific children.
export const NEEDS_PARENT = { li: ['ul', 'ol', 'menu'], dt: ['dl', 'div'], dd: ['dl', 'div'], tr: ['thead', 'tbody', 'tfoot'], td: ['tr'], th: ['tr'], thead: ['table'], tbody: ['table'], tfoot: ['table'], caption: ['table'], colgroup: ['table'], option: ['select', 'optgroup', 'datalist'], source: ['picture', 'video', 'audio'], figcaption: ['figure'], summary: ['details'] };
export const ONLY_CHILDREN = { ul: ['li'], ol: ['li'], menu: ['li'], table: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot'], thead: ['tr'], tbody: ['tr'], tfoot: ['tr'], tr: ['td', 'th'], dl: ['dt', 'dd', 'div'] };
export function canContain(parent, node) {
  if (!parent || !node || !isOriginal(parent) || parent === node || node.contains(parent)) return false;
  if (NO_CHILDREN.has(parent.localName) || VOID_TAGS.has(parent.localName)) return false;
  const scope = layerScope();
  if (!scope || !(parent === scope || scope.contains(parent))) return false;
  if (!INLINE_TAGS.has(node.localName) && PHRASING_ONLY.has(parent.localName)) return false;
  if (NEEDS_PARENT[node.localName] && !NEEDS_PARENT[node.localName].includes(parent.localName)) return false;
  if (ONLY_CHILDREN[parent.localName] && !ONLY_CHILDREN[parent.localName].includes(node.localName)) return false;
  // Interactive content cannot nest: a link inside a link (or button in button, form in form) is split on reload.
  for (const tag of ['a', 'button', 'form', 'label']) {
    if ((node.localName === tag || node.querySelector(tag)) && (parent.closest(tag))) return false;
  }
  return true;
}
// Would the HTML parser rebuild `el` exactly as it is? Parses its markup in the context of its
// own parent, the same way the file will be parsed when reopened (nested <a>, table parts…).
export function survivesReparse(el) {
  // <body>/<head>/<html> never survive fragment parsing as tags: check their children in place.
  const top = ['body', 'head', 'html'].includes(el.localName);
  const ctx = top ? el : el.parentElement || el;
  const r = el.ownerDocument.createRange();
  r.selectNodeContents(ctx);
  const html = top ? stripIds(el).innerHTML : stripIds(el).outerHTML;
  const box = el.ownerDocument.createElement('div');
  box.appendChild(r.createContextualFragment(html));
  return box.innerHTML === html;
}
// drop = { mode: 'before' | 'after' | 'inside', target }
export function moveNode(node, drop) {
  if (!node || !drop || commandBlocked(node, 'move')) return false;
  commitText();   // may replace model subtrees: every model reference below is taken after it
  const m = modelEl(node.dataset.edId);
  const lParent = drop.mode === 'inside' ? drop.target : drop.target.parentElement;
  if (!m || !canContain(lParent, node) || commandBlocked(lParent) || commandBlocked(lParent, 'drop')) return false;
  let lRef = drop.mode === 'inside' ? null : drop.mode === 'before' ? drop.target : drop.target.nextSibling;
  const mParent = modelEl(lParent.dataset.edId), mt = drop.mode === 'inside' ? null : modelEl(drop.target.dataset.edId);
  if (!mParent || (drop.mode !== 'inside' && !mt)) return false;
  let mRef = drop.mode === 'inside' ? null : drop.mode === 'before' ? mt : mt.nextSibling;
  // Dropping an element next to itself changes nothing.
  if (lRef === node) lRef = node.nextSibling;
  if (mRef === m) mRef = m.nextSibling;
  if (lParent === node.parentNode && (lRef === node.nextSibling || (lRef === null && !node.nextSibling))) return false;
  const op = {
    type: 'move', label: 'Move block', m, l: node,
    from: { mP: m.parentNode, mN: m.nextSibling, lP: node.parentNode, lN: node.nextSibling, ...positionOf(m, node) },
    to: { mP: mParent, mN: mRef, lP: lParent, lN: lRef },
  };
  applyMove(op, true);
  Object.assign(op.to, positionOf(m, node));
  if (!survivesReparse(mParent)) {
    applyMove(op, false);
    toast('Browser will re-parent this position on reload — cannot place here', { err: true, ms: 4000 });
    return false;
  }
  pushOp(op);
  select(node, { edit: false });
  hooks.queueThumb(node);
  hooks.renderPins();
  if (hooks.layersVisible()) hooks.buildLayers();
  return true;
}
export function siblingBlocks(node) { return node.parentElement ? layerKids(node.parentElement) : []; }
export function nudgeOrder(dir) {
  const node = S.sel;
  if (!node) return;
  const sibs = siblingBlocks(node), i = sibs.indexOf(node);
  const other = sibs[i + dir];
  if (!other) return toast(dir < 0 ? 'Block is already at the top' : 'Block is already at the bottom');
  moveNode(node, { mode: dir < 0 ? 'before' : 'after', target: other });
}
