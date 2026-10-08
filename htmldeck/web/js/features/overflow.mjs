// Overflow warnings.
import { $, $$ } from '../core/utils.mjs';
import { S, el } from '../editor/state.mjs';
import { isOriginal } from '../editor/live-document.mjs';
import { select, showSlide } from '../editor/selection.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';

// ================================================================ overflow warnings
// Text cut off by its frame is easy to miss after an edit. An editable root is flagged when it
// sticks out of the slide or of an ancestor that clips (overflow hidden/clip) while still partly
// inside it (items parked fully outside on purpose, like carousel pages or captions waiting for
// an animation, are not flagged), or when its own clipped box is too small for its text.
export function clipCulprit(r, cache) {
  const rr = r.getBoundingClientRect();
  if (!rr.width && !rr.height) return null;
  const own = S.win.getComputedStyle(r);
  if (own.textOverflow !== 'ellipsis' && /hidden|clip/.test(own.overflowX + own.overflowY) && (r.scrollHeight > r.clientHeight + 2 || r.scrollWidth > r.clientWidth + 2)) return r;
  for (let a = r.parentElement; a && a !== S.doc.body; a = a.parentElement) {
    const slide = a.hasAttribute('data-ed-slide');
    let clips = cache.get(a);
    if (clips === undefined) { const cs = S.win.getComputedStyle(a); clips = slide || /hidden|clip/.test(cs.overflowX + cs.overflowY); cache.set(a, clips); }
    if (clips) {
      const ar = a.getBoundingClientRect();
      const out = rr.bottom > ar.bottom + 2 || rr.right > ar.right + 2 || rr.top < ar.top - 2 || rr.left < ar.left - 2;
      const touches = rr.right > ar.left && rr.left < ar.right && rr.bottom > ar.top && rr.top < ar.bottom;
      if (out && touches) return a;
    }
    if (slide) break;
  }
  return null;
}
// all = every slide (on open); otherwise only the current slide, or the whole page.
export function checkOverflow(all) {
  if (!S.doc || S.presenting) return;
  const cache = new Map();
  const test = root => { const bad = !!clipCulprit(root, cache); root.toggleAttribute('data-ed-overflow', bad); return bad; };
  const roots = sc => $$('[data-ed-edit]', sc).filter(isOriginal);
  if (S.mode === 'deck') {
    for (const s of all ? S.slides : [S.slides[S.cur]].filter(Boolean)) {
      const i = S.slides.indexOf(s), hidden = i !== S.cur;
      // Hidden slides are shown for the measurement only; nothing is painted in between.
      if (hidden) s.style.setProperty('display', s.dataset.edDisplay, 'important');
      const n = roots(s).filter(test).length;
      if (hidden) s.style.setProperty('display', 'none', 'important');
      el.filmstrip.children[i]?.classList.toggle('warn', n > 0);
    }
  } else roots(S.doc.body).forEach(test);
  S.overflows = $$('[data-ed-overflow]', S.doc).filter(isOriginal);
  const b = $('#sb-overflow');
  b.hidden = !S.overflows.length;
  b.textContent = '⚠ ' + t('overflow_n').replace('{n}', S.overflows.length);
}
export function scheduleOverflowCheck(fromEdit) {
  clearTimeout(S.overflowTimer);
  S.overflowTimer = setTimeout(() => {
    const before = new Set(S.overflows || []);
    checkOverflow(false);
    if (fromEdit && S.overflows.some(n => !before.has(n))) toast(t('overflow_new'), { err: true, ms: 5000 });
  }, 500);
}
export function nextOverflow() {
  const list = (S.overflows || []).filter(n => n.isConnected);
  if (!list.length) return;
  S.ovIdx = ((S.ovIdx ?? -1) + 1) % list.length;
  const node = list[S.ovIdx];
  if (S.mode === 'deck') {
    const k = S.slides.findIndex(s => s.contains(node));
    if (k >= 0 && k !== S.cur) showSlide(k);
  } else node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  select(node, { edit: false });
}
