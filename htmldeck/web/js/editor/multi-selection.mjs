// Marquee, region and group selection.
import { $, clamp } from '../core/utils.mjs';
import { S, el } from './state.mjs';
import { clearMulti, deselect, select } from './selection.mjs';
import { doRemove, nodeRefs } from '../core/operations.mjs';
import { isOriginal, modelEl } from './live-document.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { hooks } from '../shared/hooks.mjs';
import { commandBlocked } from './guards.mjs';
import { pushOp } from './history.mjs';

// ---------------------------------------------------------------- marquee selection
// Drag from the slide background (or the grey stage around it) to sweep a box over several
// blocks, as in a slide or design tool; a drag that starts on text still selects text. The
// blocks swept become a group: one AI Feedback note about the area (a region note) or one
// Delete for all of them. Shift+drag / Shift+click adds or removes blocks.
// The idea of a region note with the elements found in it comes from slides-grab's bbox tool;
// regions are kept in CSS pixels of the slide (or report section) they were drawn on, and the
// elements are anchored like element notes, so the agent can find them.
export const MARQUEE_MIN_PX = 5;     // screen px: a smaller drag is a click
export const REGION_COVER = 0.7;     // share of what an element shows that must lie inside the box
export const REGION_MAX = 12;
export const REGION_SKIP = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'br', 'wbr', 'source', 'track']);
export const REGION_BOXED = new Set(['img', 'svg', 'video', 'canvas', 'picture', 'iframe', 'object', 'embed', 'input', 'select', 'textarea', 'button', 'hr', 'table']);
// Frame-viewport rect of a region stored relative to its owner.
export function regionRect(owner, reg) {
  const o = owner.getBoundingClientRect();
  return new DOMRect(o.left + reg.x, o.top + reg.y, reg.width, reg.height);
}
export function spanRect(a, b) {
  return new DOMRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
// Pointer → frame-viewport coordinates (the sheet is scaled by S.scale), kept on the page.
export function framePoint(ev) {
  const fr = el.frame.getBoundingClientRect();
  return {
    x: clamp((ev.clientX - fr.left) / S.scale, 0, S.win.innerWidth),
    y: clamp((ev.clientY - fr.top) / S.scale, 0, S.win.innerHeight),
  };
}
export function startMarquee(pt, shift, fromStage) {
  if (!S.doc || S.presenting || S.crop || S.readOnly) return;
  S.marquee = { start: pt, end: pt, shift, fromStage, active: false, preview: [] };
}
export function moveMarquee(pt) {
  const m = S.marquee;
  if (!m) return;
  m.end = { x: clamp(pt.x, 0, S.win.innerWidth), y: clamp(pt.y, 0, S.win.innerHeight) };
  if (!m.active && Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y) * S.scale >= MARQUEE_MIN_PX) {
    m.active = true;
    deselect();
    if (!m.shift) clearMulti();
    S.win.getSelection()?.removeAllRanges();
    S.doc.documentElement.classList.add('ed-marquee');
  }
  if (m.active) m.preview = regionHit(spanRect(m.start, m.end))?.nodes || [];
}
export function endMarquee() {
  const m = S.marquee;
  S.marquee = null;
  S.doc?.documentElement.classList.remove('ed-marquee');
  if (!m?.active) return;
  const hit = regionHit(spanRect(m.start, m.end));
  if (!hit) return;
  const nodes = m.shift && S.multi ? [...new Set([...S.multi.nodes, ...hit.nodes])] : hit.nodes;
  setMulti(nodes, m.shift && S.multi ? null : hit);
}
// What a box drawn in frame coordinates is about: the slide (or section) it sits on, the box
// clipped to it, and the blocks it covers.
export function regionHit(r) {
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const inside = n => { const b = n.getBoundingClientRect(); return b.width && cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom; };
  const owner = S.mode === 'deck' ? S.slides[S.cur] : S.sections.find(inside) || S.doc.body;
  if (!owner) return null;
  const o = owner.getBoundingClientRect();
  const left = Math.max(r.left, o.left), top = Math.max(r.top, o.top);
  const right = Math.min(r.right, o.right), bottom = Math.min(r.bottom, o.bottom);
  if (right - left < 1 || bottom - top < 1) return null;
  const box = new DOMRect(left, top, right - left, bottom - top);
  return {
    owner, nodes: regionElements(owner, box),
    region: { x: left - o.left, y: top - o.top, width: box.width, height: box.height },
    canvas: { width: o.width, height: o.height },
  };
}
// What the eye sees of an element. A block of text spans the whole line box although its words
// may fill a third of it, so a box drawn around the words would never cover it: measure the text
// instead. A block that shows its box (background, border, shadow, media) is its box.
export function inkRect(n) {
  const r = n.getBoundingClientRect();
  if (REGION_BOXED.has(n.localName) || n.namespaceURI !== 'http://www.w3.org/1999/xhtml') return r;
  const cs = S.win.getComputedStyle(n);
  const border = ['Top', 'Right', 'Bottom', 'Left'].some(k => parseFloat(cs[`border${k}Width`]) > 0 && cs[`border${k}Style`] !== 'none');
  if (border || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' || !/^(transparent|rgba\(.*,\s*0\))$/.test(cs.backgroundColor)) return r;
  if ([...n.children].some(c => !S.win.getComputedStyle(c).display.startsWith('inline'))) return r;
  const range = S.doc.createRange();
  range.selectNodeContents(n);
  const t = range.getBoundingClientRect();
  return t.width && t.height ? t : r;
}
// The blocks the box covers: each must lie mostly inside it, and a covered block stands for its
// covered children (a card, not its title and text one by one), as a click picks one block.
export function regionElements(owner, box) {
  const area = r => r.width * r.height;
  const overlap = r => Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left)) * Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
  const covered = new Set();
  for (const n of owner.querySelectorAll('*')) {
    if (REGION_SKIP.has(n.localName) || n.ownerSVGElement || !isOriginal(n) || n.closest('.notes')) continue;
    const r = n.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || S.win.getComputedStyle(n).visibility === 'hidden') continue;
    const ink = inkRect(n);
    if (overlap(ink) >= REGION_COVER * area(ink)) covered.add(n);
  }
  return [...covered].filter(n => !covered.has(n.parentElement));
}
// ---- the group
export function setMulti(nodes, hit) {
  nodes = nodes.filter(n => n.isConnected && !nodes.some(o => o !== n && o.contains(n)));
  if (!nodes.length) { clearMulti(); return; }
  if (nodes.length === 1) { clearMulti(); select(nodes[0], { edit: false }); return; }
  deselect();
  S.multi = { nodes, hit };
  $('#multi-count').textContent = t('multi_count').replace('{n}', nodes.length);
}
export function toggleMulti(node) {
  const nodes = S.multi ? [...S.multi.nodes] : S.sel ? [S.sel] : [];
  const i = nodes.indexOf(node);
  if (i >= 0) nodes.splice(i, 1); else nodes.push(node);
  setMulti(nodes, null);
}
export function deleteMulti() {
  const nodes = (S.multi?.nodes || []).filter(n => n.isConnected);
  if (!nodes.length || nodes.some(n => commandBlocked(n))) return;
  clearMulti();
  deselect();
  // Removed one after the other, each remembering its place: undo puts them back in reverse.
  const ops = [];
  for (const node of nodes) {
    const m = modelEl(node.dataset.edId);
    if (!m) continue;
    const op = { type: 'remove', label: 'Delete', ...nodeRefs(m, node) };
    doRemove(op);
    ops.push(op);
  }
  if (!ops.length) return;
  pushOp(ops.length === 1 ? ops[0] : { type: 'batch', ops, label: 'Delete' });
  hooks.queueThumb(S.slides[S.cur]);
  hooks.buildOutline();
  if (hooks.layersVisible()) hooks.buildLayers();
  toast('Deleted · Ctrl+Z to undo');
}
// Each frame: the swept box and the blocks it would take, the group with its toolbar, the region
// a note popup is about, or the region of a hovered note.
export function positionRegion() {
  const box = $('#region-box'), outlines = $('#multi-boxes'), pill = $('#multi-pill');
  if (!S.doc) { box.hidden = true; outlines.replaceChildren(); pill.classList.remove('show'); return; }
  const fr = el.frame.getBoundingClientRect(), st = el.stage.getBoundingClientRect();
  const place = (n, r) => {
    n.style.transform = `translate(${fr.left - st.left + r.left * S.scale}px, ${fr.top - st.top + r.top * S.scale}px)`;
    n.style.width = r.width * S.scale + 'px';
    n.style.height = r.height * S.scale + 'px';
  };
  const m = S.marquee?.active ? S.marquee : null;
  const note = S.noteRegion && !$('#pop-note').hidden && S.noteRegion.owner.isConnected ? S.noteRegion : S.hoverRegion;
  const r = m ? spanRect(m.start, m.end) : note && note.owner.isConnected ? regionRect(note.owner, note.region) : null;
  box.hidden = !r;
  if (r) place(box, r);
  const group = (m ? m.preview : S.multi?.nodes || []).filter(n => n.isConnected);
  while (outlines.children.length < group.length) outlines.appendChild(document.createElement('div')).className = 'multi-box';
  while (outlines.children.length > group.length) outlines.lastChild.remove();
  group.forEach((n, i) => place(outlines.children[i], n.getBoundingClientRect()));
  if (!S.multi || m) { pill.classList.remove('show'); return; }
  const rs = group.map(n => n.getBoundingClientRect());
  if (!rs.length) { clearMulti(); return; }
  pill.classList.add('show');
  const right = Math.max(...rs.map(x => x.right)), top = Math.min(...rs.map(x => x.top));
  const x = fr.left - st.left + right * S.scale - pill.offsetWidth, y = fr.top - st.top + top * S.scale - pill.offsetHeight - 10;
  pill.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(60, y)}px)`;
}
