// Drag and drop of rows in the Layers panel: drop targets and the drop indicator.
import { $, $$ } from '../../core/utils.mjs';
import { S } from '../../editor/state.mjs';
import { canContain, moveNode } from '../../editor/reorder.mjs';
import { layerNode, showHoverBox } from './layers.mjs';
import { toast } from '../../shared/toast.mjs';

// ---- dragging rows in the layer tree
export function computeDrop(ev, node) {
  const hit = document.elementFromPoint(ev.clientX, ev.clientY);
  const row = hit?.closest?.('#layer-tree .layer-row');
  if (!row) return null;
  const target = layerNode(row);
  if (!target || target === node || node.contains(target)) return null;
  const r = row.getBoundingClientRect(), y = (ev.clientY - r.top) / r.height;
  const order = y < 0.28 ? ['before'] : y > 0.72 ? ['after', 'inside'] : ['inside', y < 0.5 ? 'before' : 'after'];
  for (const mode of order) {
    const parent = mode === 'inside' ? target : target.parentElement;
    if (canContain(parent, node)) return { mode, target, row };
  }
  return null;
}
export function showDropIndicator(drop) {
  const tree = $('#layer-tree'), line = $('#drop-line');
  $$('#layer-tree .layer-row.drop-in').forEach(r => r.classList.remove('drop-in'));
  if (!line) return;
  if (!drop) { line.hidden = true; showHoverBox(null); return; }
  showHoverBox(drop.mode === 'inside' ? drop.target : drop.target.parentElement);
  if (drop.mode === 'inside') { drop.row.classList.add('drop-in'); line.hidden = true; return; }
  const tr = tree.getBoundingClientRect(), rr = drop.row.getBoundingClientRect(), label = drop.row.querySelector('.lk').getBoundingClientRect();
  line.style.top = (drop.mode === 'before' ? rr.top : rr.bottom) - tr.top - 1 + 'px';
  line.style.left = label.left - tr.left - 6 + 'px';
  line.hidden = false;
}
export function bindLayerDrag() {
  const tree = $('#layer-tree'), scroller = $('.panel-body[data-view="layers"]'), ghost = $('#drag-ghost');
  tree.addEventListener('pointerdown', e => {
    const row = e.target.closest('.layer-row');
    if (!row || e.button !== 0 || e.target.closest('.tg')) return;
    const node = layerNode(row);
    if (!node) return;
    const start = { x: e.clientX, y: e.clientY }, pid = e.pointerId;
    let dragging = false, drop = null, scrollTimer = 0;
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      clearInterval(scrollTimer);
      ghost.hidden = true;
      document.body.classList.remove('layer-dragging');
      row.classList.remove('dragging');
      showDropIndicator(null);
    };
    const onMove = ev => {
      if (ev.pointerId !== pid) return;
      if (!dragging) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        dragging = true;
        row.classList.add('dragging');
        document.body.classList.add('layer-dragging');
        ghost.textContent = row.querySelector('.lk').textContent + ' ' + row.querySelector('.lt').textContent;
        ghost.hidden = false;
      }
      ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 10}px)`;
      drop = computeDrop(ev, node);
      showDropIndicator(drop);
      // Auto-scroll near the panel's edges.
      clearInterval(scrollTimer);
      const sr = scroller.getBoundingClientRect(), edge = 36;
      const dir = ev.clientY < sr.top + edge ? -1 : ev.clientY > sr.bottom - edge ? 1 : 0;
      if (dir) scrollTimer = setInterval(() => { scroller.scrollTop += dir * 14; drop = computeDrop(ev, node); showDropIndicator(drop); }, 30);
    };
    const onCancel = ev => { if (ev.pointerId === pid) { dragging = false; stop(); } };
    const onUp = ev => {
      if (ev.pointerId !== pid) return;
      stop();
      if (!dragging) return;
      S.layerDragEnded = Date.now();
      if (drop && !moveNode(node, drop)) toast('Cannot place block at that position');
    };
    const onKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); dragging = false; stop(); } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  });
}
