// Stage layout and zoom.
import { $, clamp } from '../core/utils.mjs';
import { S, el } from '../editor/state.mjs';
import { positionOverlay } from './overlay.mjs';

// ================================================================ layout / zoom / present
export function layout() {
  if (!S.doc) return;
  const deck = S.mode === 'deck';
  const pad = { x: 40, t: 72, b: 28 };
  el.scroller.style.padding = `${pad.t}px ${pad.x}px ${pad.b}px`;
  const availW = el.scroller.clientWidth - pad.x * 2, availH = el.scroller.clientHeight - pad.t - pad.b;
  const w = deck ? S.deckW : S.pageW;
  if (S.fit) S.scale = deck ? Math.min(availW / S.deckW, availH / S.deckH) : Math.min(1, availW / w);
  S.scale = clamp(S.scale, 0.1, 3);
  const h = deck ? S.deckH : Math.max(200, Math.floor(availH / S.scale));
  el.frame.style.width = w + 'px';
  el.frame.style.height = h + 'px';
  el.sheet.style.transform = `scale(${S.scale})`;
  el.sizer.style.width = w * S.scale + 'px';
  el.sizer.style.height = h * S.scale + 'px';
  const pct = Math.round(S.scale * 100);
  $('#zoom').value = pct;
  $('#zoom-pct').textContent = pct + '%';
  if (S.sel) positionOverlay(true);
}
export function setZoom(pct) { S.fit = false; S.scale = clamp(pct / 100, 0.1, 3); layout(); }
export function zoomBy(f) { setZoom(S.scale * 100 * f); }
export function fitZoom() { S.fit = true; layout(); }
