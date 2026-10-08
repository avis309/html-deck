// Selection overlay tracking and snap guides.
import { $, $$, clamp } from '../core/utils.mjs';
import { S, el } from '../editor/state.mjs';
import { deselect } from '../editor/selection.mjs';
import { isOriginal } from '../editor/live-document.mjs';
import { placeSvgText } from '../editor/edits.mjs';
import { refreshOffsets } from './panels/layers.mjs';

// ================================================================ overlay tracking
export function startTrack() {
  if (S.trackRaf) return;
  const loop = () => {
    if (!S.sel || S.presenting) { S.trackRaf = 0; hideOverlay(); refreshOffsets(); return; }
    positionOverlay();
    refreshOffsets();
    S.trackRaf = requestAnimationFrame(loop);
  };
  S.trackRaf = requestAnimationFrame(loop);
}
export function stopTrack() { cancelAnimationFrame(S.trackRaf); S.trackRaf = 0; }
export function hideOverlay() {
  el.box.classList.remove('show', 'editing', 'block');
  el.pill.classList.remove('show');
  el.menu.hidden = true;
  S.lastBox = '';
}
export function positionOverlay(force) {
  const node = S.sel;
  if (!node || !node.isConnected) { if (node) deselect(); return; }
  const r = node.getBoundingClientRect();
  const fr = el.frame.getBoundingClientRect(), st = el.stage.getBoundingClientRect(), sc = el.scroller.getBoundingClientRect();
  const s = S.scale;
  const x = fr.left - st.left + r.left * s, y = fr.top - st.top + r.top * s, w = r.width * s, h = r.height * s;
  const key = [x, y, w, h].map(v => v.toFixed(1)).join(',');
  if (!force && key === S.lastBox) return;
  S.lastBox = key;
  const visTop = sc.top - st.top, visBottom = sc.bottom - st.top;
  const visible = y + h > visTop && y < visBottom && w > 0;
  el.box.classList.toggle('show', visible);
  el.pill.classList.toggle('show', visible && !S.crop);
  if (!visible) { el.menu.hidden = true; return; }
  el.box.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
  el.box.style.width = w + 4 + 'px';
  el.box.style.height = h + 4 + 'px';
  el.box.classList.toggle('small', h < 26);
  if (S.svgEdit) placeSvgText();
  const pw = el.pill.offsetWidth || 170, ph = el.pill.offsetHeight || 40;
  let py = y - ph - 14;
  if (py < 64) py = y + h + 14;
  const px = clamp(x + w / 2 - pw / 2, 8, st.width - pw - 8);
  el.pill.style.transform = `translate(${px}px, ${clamp(py, 60, st.height - ph - 8)}px)`;
  if (!el.menu.hidden) placeMenu();
}
export function placeMenu() {
  const p = $('#pill-more').getBoundingClientRect(), st = el.stage.getBoundingClientRect();
  el.menu.style.left = clamp(p.right - st.left - 210, 8, st.width - 218) + 'px';
  el.menu.style.top = (p.bottom - st.top + 6) + 'px';
}

// ================================================================ snap guides
// Idea from GrapesJS ComponentDrag: static lines (edges + centre) of the neighbours are measured
// once at drag start; while dragging, the nearest line within a few screen pixels pulls the box.
export const SNAP_PX = 6;
export function snapTargets(node) {
  const rects = [], seen = new Set([node]);
  const add = (n, frame) => {
    if (!n || seen.has(n) || n.nodeType !== 1 || !isOriginal(n)) return;
    seen.add(n);
    const r = n.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    rects.push({ l: r.left, t: r.top, r: r.right, b: r.bottom, frame });
  };
  const parent = node.parentElement;
  if (parent && parent !== S.doc.documentElement) add(parent, true);
  const slide = node.closest('[data-ed-slide]');
  if (slide) add(slide, true);
  let k = 0;
  for (const c of parent ? parent.children : []) { if (k++ > 200) break; if (!node.contains(c) && !c.contains(node)) add(c, false); }
  // On a slide, everything the user can pick is a candidate too (Canva-style), not only siblings.
  if (slide) for (const n of $$('[data-ed-edit], img', slide)) { if (k++ > 400) break; if (!node.contains(n) && !n.contains(node)) add(n, false); }
  const lines = { x: [], y: [] };
  for (const r of rects) {
    for (const v of [r.l, (r.l + r.r) / 2, r.r]) lines.x.push({ v, r });
    for (const v of [r.t, (r.t + r.b) / 2, r.b]) lines.y.push({ v, r });
  }
  return lines;
}
// Correction that brings the nearest of `moving` onto a static line, or 0.
export function snapDelta(lines, moving, th) {
  let best = null;
  for (const m of moving) for (const s of lines) { const d = s.v - m; if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best))) best = d; }
  return best ?? 0;
}
export function drawSnapGuides(lines, cand) {
  const box = $('#snap-guides');
  if (!lines) { box.innerHTML = ''; return; }
  const fr = el.frame.getBoundingClientRect(), st = el.stage.getBoundingClientRect(), s = S.scale;
  const ox = fr.left - st.left, oy = fr.top - st.top;
  let html = '';
  const done = new Set();
  const gapLabel = (x, y, gap) => { if (gap >= 1) html += `<span class="snap-gap" style="transform:translate(${ox + x * s}px,${oy + y * s}px) translate(-50%,-50%)">${Math.round(gap)}</span>`; };
  for (const axis of ['x', 'y']) {
    const mov = axis === 'x' ? [cand.l, (cand.l + cand.r) / 2, cand.r] : [cand.t, (cand.t + cand.b) / 2, cand.b];
    for (const { v, r } of lines[axis]) {
      if (!mov.some(m => Math.abs(m - v) < 0.75)) continue;
      const key = axis + Math.round(v);
      if (done.has(key)) continue;
      done.add(key);
      if (axis === 'x') {
        const a = Math.min(cand.t, r.t), b = Math.max(cand.b, r.b);
        html += `<i class="snap-line" style="width:1px;height:${(b - a) * s}px;transform:translate(${ox + v * s}px,${oy + a * s}px)"></i>`;
        if (!r.frame) gapLabel(v, r.b < cand.t ? (r.b + cand.t) / 2 : (cand.b + r.t) / 2, r.b < cand.t ? cand.t - r.b : r.t - cand.b);
      } else {
        const a = Math.min(cand.l, r.l), b = Math.max(cand.r, r.r);
        html += `<i class="snap-line" style="height:1px;width:${(b - a) * s}px;transform:translate(${ox + a * s}px,${oy + v * s}px)"></i>`;
        if (!r.frame) gapLabel(r.r < cand.l ? (r.r + cand.l) / 2 : (cand.r + r.l) / 2, v, r.r < cand.l ? cand.l - r.r : r.l - cand.r);
      }
    }
  }
  box.innerHTML = html;
}
