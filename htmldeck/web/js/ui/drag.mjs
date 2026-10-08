// Drag to move / resize a block (or move a group), and nudge it with the arrow keys.
import { $, parseTranslate } from '../core/utils.mjs';
import { S, el } from '../editor/state.mjs';
import { SNAP_PX, drawSnapGuides, snapDelta, snapTargets } from './overlay.mjs';
import { closePopups, refreshToolbar } from './toolbar.mjs';
import { modelEl } from '../editor/live-document.mjs';
import { setEditing } from '../editor/selection.mjs';
import { buildStyleOp, styleEdit } from '../editor/commands.mjs';
import { commitText } from '../editor/edits.mjs';
import { commandBlocked } from '../editor/guards.mjs';
import { pushOp } from '../editor/history.mjs';
import { setStyleAttr } from '../core/operations.mjs';
import { hooks } from '../shared/hooks.mjs';
import { t } from '../shared/lang.mjs';

export const MOVE_MIN_PX = 5;   // screen px: a smaller drag is a click

// ================================================================ move: one block or a group
// The blocks follow the pointer by one offset and their outer box snaps like one block (Alt: free).
// x, y: the press in client px of the editor page. null when one of them may not change.
export function moveSession(nodes, x, y) {
  nodes = nodes.filter(n => n.isConnected);
  if (!nodes.length || nodes.some(n => !modelEl(n.dataset.edId) || commandBlocked(n, 'move'))) return null;
  if (S.editing) setEditing(false);
  const items = nodes.map(n => {
    const cs = S.win.getComputedStyle(n);
    return { n, style: n.getAttribute('style'), tr: parseTranslate(cs.translate), inline: cs.display === 'inline' };
  });
  const rs = nodes.map(n => n.getBoundingClientRect());
  const L = Math.min(...rs.map(r => r.left)), R = Math.max(...rs.map(r => r.right));
  const T = Math.min(...rs.map(r => r.top)), B = Math.max(...rs.map(r => r.bottom));
  const snaps = snapTargets(nodes), one = nodes.length === 1, tip = $('#size-tip');
  el.shield.style.display = 'block';
  el.shield.style.cursor = 'grabbing';
  if (one) el.box.classList.add('dragging');
  const props = (it, dx, dy) => ({ translate: `${Math.round(it.tr[0] + dx)}px ${Math.round(it.tr[1] + dy)}px`, ...(it.inline ? { display: 'inline-block' } : {}) });
  let dx = 0, dy = 0, moved = false;
  return {
    move(cx, cy, alt) {
      dx = (cx - x) / S.scale;
      dy = (cy - y) / S.scale;
      if (!alt) {
        const th = SNAP_PX / S.scale;
        dx += snapDelta(snaps.x, [L + dx, (L + R) / 2 + dx, R + dx], th);
        dy += snapDelta(snaps.y, [T + dy, (T + B) / 2 + dy, B + dy], th);
        drawSnapGuides(snaps, { l: L + dx, r: R + dx, t: T + dy, b: B + dy });
      } else drawSnapGuides(null);
      for (const it of items) for (const [k, v] of Object.entries(props(it, dx, dy))) it.n.style.setProperty(k, v);
      moved = true;
      if (one) tip.textContent = `x ${Math.round(items[0].tr[0] + dx)} · y ${Math.round(items[0].tr[1] + dy)}`;
    },
    // keep = false (a cancelled press) puts the blocks back where they were, unrecorded.
    end(keep = true) {
      el.shield.style.display = 'none';
      el.box.classList.remove('dragging');
      drawSnapGuides(null);
      if (!moved) return;
      if (!keep) { items.forEach(it => setStyleAttr(it.n, it.style)); return; }
      if (one) styleEdit(nodes[0], props(items[0], dx, dy));
      else commitMoves(items.map(it => [it.n, props(it, dx, dy)]));
      refreshToolbar();
    },
  };
}
// Several blocks changed by one gesture: one undo step for all of them.
function commitMoves(changes) {
  commitText();
  const ops = changes.map(([n, p]) => buildStyleOp(n, p)).filter(Boolean);
  if (ops.length) pushOp({ type: 'batch', ops, label: 'Move' });
  for (const [n] of changes) hooks.queueThumb(n);
}
// A press inside the page that may become a move. Past MOVE_MIN_PX it moves what nodes() returns;
// let go before that, click() runs. The page gets the pointer once the move starts.
export function pressMove(e, nodes, click) {
  const doc = S.doc, html = doc.documentElement, id = e.pointerId;
  e.preventDefault();
  html.classList.add('ed-press');
  const toPage = ev => { const f = el.frame.getBoundingClientRect(); return [f.left + ev.clientX * S.scale, f.top + ev.clientY * S.scale]; };
  const [x0, y0] = toPage(e);
  let ms = null, done = false;
  const track = (x, y, ev) => {
    if (S.doc !== doc) { finish(false); return; }
    if (!ms) {
      if (Math.hypot(x - x0, y - y0) < MOVE_MIN_PX) return;
      ms = moveSession(nodes(), x0, y0);
      if (!ms) { finish(false); return; }
      try { html.setPointerCapture(id); } catch { /* the pointer is gone: the up ends it */ }
      html.classList.add('ed-moving');
      S.win.getSelection()?.removeAllRanges();
    }
    ms.move(x, y, ev.altKey);
  };
  const inFrame = ev => { if (ev.pointerId === id) track(...toPage(ev), ev); };
  const inPage = ev => { if (ev.pointerId === id) track(ev.clientX, ev.clientY, ev); };
  const up = ev => { if (ev.pointerId === id) finish(true); };
  const cancel = ev => { if (ev.pointerId === id) finish(false); };
  const on = [[doc, 'pointermove', inFrame], [window, 'pointermove', inPage], [doc, 'pointerup', up], [window, 'pointerup', up],
    [doc, 'pointercancel', cancel], [window, 'pointercancel', cancel], [doc, 'lostpointercapture', cancel]];
  function finish(keep) {
    if (done) return;
    done = true;
    for (const [target, type, fn] of on) target.removeEventListener(type, fn, true);
    html.classList.remove('ed-press', 'ed-moving');
    if (ms) { try { html.releasePointerCapture(id); } catch { /* released already */ } ms.end(keep); }
    else if (keep) click();
  }
  for (const [target, type, fn] of on) target.addEventListener(type, fn, true);
}

// ================================================================ drag: move / resize
export function startDrag(kind, e) {
  const node = S.sel;
  if (!node || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  closePopups();
  if (kind === 'move') {
    const ms = moveSession([node], e.clientX, e.clientY);
    if (!ms) return;
    const onMove = ev => ms.move(ev.clientX, ev.clientY, ev.altKey);
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); ms.end(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return;
  }
  if (S.editing) setEditing(false);
  const m = modelEl(node.dataset.edId);
  if (!m) return;
  const cs = S.win.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  const st = { x: e.clientX, y: e.clientY, tr: parseTranslate(cs.translate), w: rect.width, h: rect.height, fs: parseFloat(cs.fontSize), inline: cs.display === 'inline', img: node.localName === 'img', fit: cs.objectFit };
  const tip = $('#size-tip');
  el.shield.style.display = 'block';
  el.shield.style.cursor = getComputedStyle(e.target).cursor;
  el.box.classList.add('dragging');
  const changed = {};
  const set = (k, v) => { node.style.setProperty(k, v); changed[k] = v; };
  // Snapping covers the side (width) handles; corner handles scale text or keep an image's
  // ratio, where pulling one edge onto a line would fight the proportion.
  const snaps = kind === 'e' || kind === 'w' ? snapTargets(node) : null;
  const onMove = ev => {
    let dx = (ev.clientX - st.x) / S.scale, dy = (ev.clientY - st.y) / S.scale;
    if (snaps && !ev.altKey) {
      const th = SNAP_PX / S.scale;
      const L = rect.left, R = rect.right, T = rect.top, B = rect.bottom;
      const edge = kind === 'e' ? R + dx : L + dx;
      dx += snapDelta(snaps.x, [edge], th);
      const cand = kind === 'e' ? { l: L, r: R + dx, t: T, b: B } : { l: L + dx, r: R, t: T, b: B };
      drawSnapGuides({ x: snaps.x.filter(g => Math.abs(g.v - (kind === 'e' ? cand.r : cand.l)) < 0.75), y: [] }, cand);
    } else if (snaps) drawSnapGuides(null);
    if (st.img) {
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
  const shift = n => {
    const cs = S.win.getComputedStyle(n);
    const [tx, ty] = parseTranslate(cs.translate);
    return { translate: `${tx + dx}px ${ty + dy}px`, ...(cs.display === 'inline' ? { display: 'inline-block' } : {}) };
  };
  if (S.multi) {
    // Not merged like one block's nudges: a merged step would keep the first press's sub-ops.
    const nodes = S.multi.nodes.filter(n => n.isConnected);
    if (!nodes.length || nodes.some(n => commandBlocked(n, 'move'))) return;
    S.multi.hit = null;
    commitMoves(nodes.map(n => [n, shift(n)]));
    return;
  }
  if (S.sel) styleEdit(S.sel, shift(S.sel), 'nudge');
}
