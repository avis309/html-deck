// Pointer and input events of the preview frame.
import { S } from '../editor/state.mjs';
import { endMarquee, moveMarquee, startMarquee, toggleMulti } from '../editor/multi-selection.mjs';
import { closePopups, refreshToolbar } from './toolbar.mjs';
import { clearMulti, deselect, select } from '../editor/selection.mjs';
import { enterCrop, replaceWithFile } from '../features/images.mjs';
import { isOriginal, outerSvg, pickBlock, provenanceOf } from '../editor/live-document.mjs';
import { openSvgText, scheduleCommit } from '../editor/edits.mjs';
import { positionOverlay } from './overlay.mjs';
import { updateChrome } from './chrome.mjs';
import { toast } from '../shared/toast.mjs';
import { lockedHint } from '../editor/guards.mjs';

// ================================================================ frame events
export function bindFrameEvents(doc, win) {
  doc.addEventListener('pointerdown', e => {
    if (S.presenting || e.button !== 0) return;
    closePopups();
    const t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (e.altKey) {
      const block = t && pickBlock(t);
      e.preventDefault();
      if (block) select(block, { edit: false }); else deselect();
      return;
    }
    const img = t && t.closest('img');
    const root = t && t.closest('[data-ed-edit]');
    // A diagram is picked as one block (AI Feedback, delete, move); its text is edited in place.
    const svgText = !root && t?.closest('[data-ed-svgtext]');
    const svg = !root && t && outerSvg(t);
    const hit = img && isOriginal(img) ? img : root && isOriginal(root) ? root
      : svgText && isOriginal(svgText) ? svgText : svg && isOriginal(svg) ? svg : null;
    if (hit && e.shiftKey && (S.sel || S.multi)) {
      e.preventDefault();
      toggleMulti(hit);
      return;
    }
    if (!e.shiftKey) clearMulti();
    if (img && isOriginal(img)) {
      e.preventDefault();
      select(img, { edit: false });
      return;
    }
    if (root && isOriginal(root)) {
      if (root !== S.sel || !S.editing) select(root, { edit: true });
      return;
    }
    if (svgText && isOriginal(svgText)) {
      e.preventDefault();
      select(svgText, { edit: false });
      openSvgText(svgText);
      return;
    }
    if (svg && isOriginal(svg)) {
      e.preventDefault();
      select(svg, { edit: false });
      return;
    }
    if (S.sel) deselect();
    startMarquee({ x: e.clientX, y: e.clientY }, e.shiftKey, false);
    // Text the user clicked that the editor will not touch: say why instead of doing nothing.
    if (t && t !== doc.body && !t.hasAttribute('data-ed-slide') && /\S/.test(t.textContent || '')) {
      const p = provenanceOf(t);
      if (p.mapping !== 'authored') lockedHint(p.mapping === 'ambiguous' ? 'lock_ambiguous' : 'lock_generated');
    }
  }, true);

  // A press held inside the frame keeps sending moves here, even outside it.
  doc.addEventListener('pointermove', e => { if (S.marquee && !S.marquee.fromStage) moveMarquee({ x: e.clientX, y: e.clientY }); }, true);
  doc.addEventListener('pointerup', e => { if (S.marquee && !S.marquee.fromStage) { moveMarquee({ x: e.clientX, y: e.clientY }); endMarquee(); } }, true);
  doc.addEventListener('click', e => {
    const a = e.target.closest?.('a[href]');
    if (a) {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href.startsWith('#') && href.length > 1) {
        const target = doc.getElementById(decodeURIComponent(href.slice(1)));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (!a.closest('[data-ed-edit]')) {
        toast('Links are disabled while editing');
      }
    }
    if (e.target.closest?.('form') && e.target.closest('[type=submit]')) e.preventDefault();
  }, true);
  doc.addEventListener('submit', e => e.preventDefault(), true);

  // Ownership of the browser's edit is claimed by window.__edInput (called from the frame
  // guard, the first capture listener of the frame); this one only schedules the commit.
  doc.addEventListener('input', e => {
    if (!e.isTrusted || !S.editing || !S.session || !S.session.node.contains(e.target)) return;
    S.textDirty = true;
    scheduleCommit();
    updateChrome();
  }, true);
  doc.addEventListener('paste', e => {
    if (!S.editing || !S.sel.contains(e.target)) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    doc.execCommand('insertText', false, text);
  });
  doc.addEventListener('dragstart', e => { if (S.editing || e.target.closest?.('img')) e.preventDefault(); });
  // Drop an image file straight onto a picture on the page to replace it.
  const dropImg = e => { const t = e.target.nodeType === 1 ? e.target : e.target.parentElement; const img = t?.closest('img'); return img && isOriginal(img) ? img : null; };
  doc.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files') && dropImg(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  doc.addEventListener('drop', e => {
    const img = dropImg(e), file = e.dataTransfer?.files?.[0];
    if (img && file) { e.preventDefault(); select(img, { edit: false }); replaceWithFile(img, file); return; }
    if (S.sel && S.sel.contains(e.target)) e.preventDefault();
  });
  doc.addEventListener('dblclick', e => {
    const img = e.target.closest?.('img');
    if (img && isOriginal(img) && !S.presenting) { select(img, { edit: false }); enterCrop(); }
  });
  doc.addEventListener('selectionchange', () => {
    if (!S.editing || !S.sel) return;
    const sel = win.getSelection();
    if (sel.rangeCount && S.sel.contains(sel.getRangeAt(0).commonAncestorContainer)) S.savedRange = sel.getRangeAt(0).cloneRange();
    cancelAnimationFrame(refreshToolbar.raf);
    refreshToolbar.raf = requestAnimationFrame(refreshToolbar);
  });
  win.addEventListener('scroll', () => { if (S.sel) positionOverlay(true); }, { passive: true });
}
