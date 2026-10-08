// Drag to move / resize a block, and nudge it with the arrow keys.
import { $, parseTranslate } from '../core/utils.mjs';
import { S, el } from '../editor/state.mjs';
import { SNAP_PX, drawSnapGuides, snapDelta, snapTargets } from './overlay.mjs';
import { closePopups, refreshToolbar } from './toolbar.mjs';
import { modelEl } from '../editor/live-document.mjs';
import { setEditing } from '../editor/selection.mjs';
import { styleEdit } from '../editor/commands.mjs';
import { t } from '../shared/lang.mjs';

// ================================================================ drag: move / resize
export function startDrag(kind, e) {
  const node = S.sel;
  if (!node || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  closePopups();
  if (S.editing) setEditing(false);
  const m = modelEl(node.dataset.edId);
  if (!m) return;
  const cs = S.win.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  const st = { x: e.clientX, y: e.clientY, tr: parseTranslate(cs.translate), w: rect.width, h: rect.height, fs: parseFloat(cs.fontSize), inline: cs.display === 'inline', img: node.localName === 'img', fit: cs.objectFit };
  const tip = $('#size-tip');
  el.shield.style.display = 'block';
  el.shield.style.cursor = kind === 'move' ? 'grabbing' : getComputedStyle(e.target).cursor;
  el.box.classList.add('dragging');
  const changed = {};
  const set = (k, v) => { node.style.setProperty(k, v); changed[k] = v; };
  // Snapping covers moves and the side (width) handles; corner handles scale text or keep an
  // image's ratio, where pulling one edge onto a line would fight the proportion.
  const snaps = kind === 'move' || kind === 'e' || kind === 'w' ? snapTargets(node) : null;
  const onMove = ev => {
    let dx = (ev.clientX - st.x) / S.scale, dy = (ev.clientY - st.y) / S.scale;
    if (snaps && !ev.altKey) {
      const th = SNAP_PX / S.scale;
      const L = rect.left, R = rect.right, T = rect.top, B = rect.bottom;
      if (kind === 'move') {
        dx += snapDelta(snaps.x, [L + dx, (L + R) / 2 + dx, R + dx], th);
        dy += snapDelta(snaps.y, [T + dy, (T + B) / 2 + dy, B + dy], th);
        drawSnapGuides(snaps, { l: L + dx, r: R + dx, t: T + dy, b: B + dy });
      } else {
        const edge = kind === 'e' ? R + dx : L + dx;
        dx += snapDelta(snaps.x, [edge], th);
        const cand = kind === 'e' ? { l: L, r: R + dx, t: T, b: B } : { l: L + dx, r: R, t: T, b: B };
        drawSnapGuides({ x: snaps.x.filter(g => Math.abs(g.v - (kind === 'e' ? cand.r : cand.l)) < 0.75), y: [] }, cand);
      }
    } else if (snaps) drawSnapGuides(null);
    if (kind === 'move') {
      if (st.inline) set('display', 'inline-block');
      set('translate', `${Math.round(st.tr[0] + dx)}px ${Math.round(st.tr[1] + dy)}px`);
      tip.textContent = `x ${Math.round(st.tr[0] + dx)} · y ${Math.round(st.tr[1] + dy)}`;
    } else if (st.img) {
      // Pictures: corners scale proportionally; sides change the width and crop to fill.
      const sx = kind.includes('e') ? 1 : -1, sy = kind.includes('s') ? 1 : -1;
      let w;
      if (kind.length === 2) {
        const rx = (st.w + sx * dx) / st.w, ry = (st.h + sy * dy) / st.h;
        w = Math.max(16, Math.round(st.w * (Math.abs(rx - 1) >= Math.abs(ry - 1) ? rx : ry)));
      } else w = Math.max(16, Math.round(st.w + sx * dx));
      const h = kind.length === 2 ? Math.max(16, Math.round(st.h * w / st.w)) : Math.round(st.h);
      set('width', w + 'px');
      set('height', h + 'px');
      set('max-width', 'none');
      if (kind.length === 1 && st.fit === 'fill' && !node.style.objectFit) set('object-fit', 'cover');
      if (kind.includes('w') || kind.includes('n')) set('translate', `${Math.round(st.tr[0] + (kind.includes('w') ? st.w - w : 0))}px ${Math.round(st.tr[1] + (kind.includes('n') ? st.h - h : 0))}px`);
      tip.textContent = `${w} × ${h} px`;
    } else if (kind === 'e' || kind === 'w') {
      const w = Math.max(24, Math.round(st.w + (kind === 'e' ? dx : -dx)));
      if (st.inline) set('display', 'inline-block');
      set('width', w + 'px');
      set('max-width', 'none');
      if (kind === 'w') set('translate', `${Math.round(st.tr[0] + st.w - w)}px ${Math.round(st.tr[1])}px`);
      tip.textContent = `${t('tip_width')} ${w}px`;
    } else {
      const sx = kind.includes('e') ? 1 : -1, sy = kind.includes('s') ? 1 : -1;
      const rx = (st.w + sx * dx) / st.w, ry = (st.h + sy * dy) / st.h;
      const ratio = Math.max(0.15, Math.abs(rx - 1) >= Math.abs(ry - 1) ? rx : ry);
      const fs = Math.round(st.fs * ratio * 10) / 10;
      set('font-size', fs + 'px');
      tip.textContent = `${t('tip_size')} ${fs}px`;
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    el.shield.style.display = 'none';
    el.box.classList.remove('dragging');
    drawSnapGuides(null);
    if (Object.keys(changed).length) styleEdit(node, changed);
    refreshToolbar();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
export function nudge(dx, dy) {
  if (!S.sel) return;
  const cs = S.win.getComputedStyle(S.sel);
  const [tx, ty] = parseTranslate(cs.translate);
  const props = { translate: `${tx + dx}px ${ty + dy}px` };
  if (cs.display === 'inline') props.display = 'inline-block';
  styleEdit(S.sel, props, 'nudge');
}
