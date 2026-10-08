// Find and replace.
import { $, clamp } from '../core/utils.mjs';
import { S } from '../editor/state.mjs';
import { cleanFragment, isOriginal, modelEl, provenanceOf } from '../editor/live-document.mjs';
import { flushPending } from '../editor/edits.mjs';
import { setEditing, showSlide } from '../editor/selection.mjs';
import { textEditBlock } from '../policy/edit-policy.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { lockedHint } from '../editor/guards.mjs';
import { pushOp } from '../editor/history.mjs';
import { hooks } from '../shared/hooks.mjs';

// ================================================================ find & replace
// Matches are found inside single text nodes of the editable roots and painted with the CSS
// Custom Highlight API, so searching never touches the document. Replacing goes through the
// same 'html' ops as typing: undoable (Replace all = one step) and saved as minimal patches.
export function openFind(replace) {
  if (!S.doc) return;
  $('#findbar').hidden = false;
  const sel = S.win.getSelection?.()?.toString().trim();
  if (sel && sel.length < 200 && !sel.includes('\n')) $('#find-q').value = sel;
  const inp = replace && $('#find-q').value ? $('#find-r') : $('#find-q');
  inp.focus();
  inp.select();
  runFind();
  if (S.find?.hits.length) revealHit(S.find.hits[S.find.i]);
}
export function closeFind() {
  $('#findbar').hidden = true;
  S.find = null;
  clearFindMarks();
}
export function clearFindMarks() {
  try { S.win?.CSS?.highlights?.delete('ed-find'); S.win?.CSS?.highlights?.delete('ed-find-cur'); } catch {}
}
export function findRoots() {
  if (!S.doc) return [];
  const scopes = S.mode === 'deck' ? S.slides : [S.doc.body];
  const out = [];
  for (const sc of scopes) for (const r of sc.querySelectorAll('[data-ed-edit]')) if (isOriginal(r) && !r.parentElement.closest('[data-ed-edit]')) out.push(r);
  return out;
}
export function runFind(keep) {
  clearFindMarks();
  const q = $('#find-q').value, cs = $('#find-case').checked, hits = [];
  if (q && S.doc) {
    const needle = cs ? q : q.toLowerCase(), hidden = new Map();
    // Text the page hides (e.g. the other language of a bilingual report) is skipped. The
    // walk stops at the slide, which the editor itself hides when it is not the current one.
    const isHidden = e => {
      if (!e || e === S.doc.body || e.hasAttribute('data-ed-slide')) return false;
      if (!hidden.has(e)) { const c = S.win.getComputedStyle(e); hidden.set(e, c.display === 'none' || c.visibility === 'hidden' || isHidden(e.parentElement)); }
      return hidden.get(e);
    };
    for (const root of findRoots()) {
      const w = S.doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (isHidden(n.parentElement)) continue;
        const hay = cs ? n.data : n.data.toLowerCase();
        if (hay.length !== n.data.length) continue;   // case folding changed offsets (rare letters)
        for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) hits.push({ n, s: i, e: i + needle.length, root });
      }
    }
  }
  let i = -1;
  if (hits.length) {
    if (keep && S.find) i = clamp(S.find.i, 0, hits.length - 1);   // -1 when the last search found nothing
    else if (S.mode === 'deck') i = Math.max(0, hits.findIndex(h => S.slides[S.cur]?.contains(h.root)));
    else i = 0;
  }
  S.find = { q, hits, i };
  paintFind();
}
export function hitRange(h) {
  const r = S.doc.createRange();
  r.setStart(h.n, h.s);
  r.setEnd(h.n, h.e);
  return r;
}
export function paintFind() {
  const f = S.find, hl = S.win?.CSS?.highlights, H = S.win?.Highlight;
  $('#find-count').textContent = !f || !f.q ? '' : f.hits.length ? `${f.i + 1}/${f.hits.length}` : t('find_none');
  $('#find-rep').disabled = $('#find-all').disabled = !f || !f.hits.length;
  if (!f || !f.hits.length || !hl || !H) return;
  hl.set('ed-find', new H(...f.hits.map(hitRange)));
  hl.set('ed-find-cur', new H(hitRange(f.hits[f.i])));
}
export function stepFind(d) {
  const f = S.find;
  if (!f || !f.hits.length) return;
  f.i = (f.i + d + f.hits.length) % f.hits.length;
  paintFind();
  revealHit(f.hits[f.i]);
}
export function revealHit(h) {
  if (S.mode === 'deck') {
    const k = S.slides.findIndex(s => s.contains(h.root));
    if (k >= 0 && k !== S.cur) showSlide(k);
    return;
  }
  const b = hitRange(h).getBoundingClientRect();
  if (b.top < 90 || b.bottom > S.win.innerHeight - 40) S.win.scrollBy({ top: b.top - S.win.innerHeight / 2, behavior: 'smooth' });
}
export function replaceHits(hits) {
  if (!hits.length) return 0;
  flushPending();
  if (S.editing) setEditing(false);
  const rep = $('#find-r').value, byRoot = new Map();
  for (const h of hits) { if (!byRoot.has(h.root)) byRoot.set(h.root, []); byRoot.get(h.root).push(h); }
  const ops = [];
  let locked = 0;
  for (const [root, list] of byRoot) {
    const m = modelEl(root.dataset.edId);
    if (!m) continue;
    // Replacing copies the live block back into the model, like typing: same rule applies.
    if (textEditBlock(provenanceOf(root))) { locked += list.length; continue; }
    const byNode = new Map();
    for (const h of list) { if (!byNode.has(h.n)) byNode.set(h.n, []); byNode.get(h.n).push(h); }
    // Right to left inside each text node, so the earlier offsets stay valid.
    for (const [n, hs] of byNode) for (const h of hs.sort((a, b) => b.s - a.s)) n.data = n.data.slice(0, h.s) + rep + n.data.slice(h.e);
    const before = m.innerHTML, after = cleanFragment(root.innerHTML);
    if (before === after) continue;
    m.innerHTML = after;
    ops.push({ type: 'html', id: root.dataset.edId, before, after, label: t('replace_one') });
    hooks.queueThumb(root);
  }
  if (locked) lockedHint('lock_find_skipped');
  if (!ops.length) return 0;
  pushOp(ops.length === 1 ? ops[0] : { type: 'batch', ops, label: t('replace_all') });
  return hits.length - locked;
}
export function bindFind() {
  const q = $('#find-q');
  q.addEventListener('input', () => { runFind(); if (S.find.hits.length) revealHit(S.find.hits[S.find.i]); });
  $('#find-case').addEventListener('change', () => runFind());
  for (const inp of [q, $('#find-r')]) inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (inp === q) stepFind(e.shiftKey ? -1 : 1); else $('#find-rep').click(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  $('#find-prev').addEventListener('click', () => stepFind(-1));
  $('#find-next').addEventListener('click', () => stepFind(1));
  $('#find-close').addEventListener('click', closeFind);
  $('#sb-find').addEventListener('click', () => openFind(false));
  $('#find-rep').addEventListener('click', () => {
    const f = S.find;
    if (!f?.hits.length) return;
    replaceHits([f.hits[f.i]]);
    runFind(true);
    if (S.find.hits.length) revealHit(S.find.hits[S.find.i]);
  });
  $('#find-all').addEventListener('click', () => {
    const n = replaceHits(S.find?.hits || []);
    runFind();
    if (n) toast(t('replaced_n').replace('{n}', n));
  });
}
