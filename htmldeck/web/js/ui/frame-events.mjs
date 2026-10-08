// Pointer and input events of the preview frame.
import { S } from '../editor/state.mjs';
import { endMarquee, moveMarquee, showsBox, startMarquee, toggleMulti } from '../editor/multi-selection.mjs';
import { pressMove } from './drag.mjs';
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
    press(e, false);
  }, true);
  // A press on the page. replay: the click that ends a press on the group, run again where it
  // was let go (nothing can be dragged then).
  function press(e, replay) {
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
    // A press on one of the group moves the whole group; let go where it was, it is a click there.
    if (!replay && !e.shiftKey && S.multi?.nodes.some(n => within(n.getBoundingClientRect(), e))) {
      const group = S.multi;
      pressMove(e, () => { group.hit = null; return group.nodes; }, () => { clearMulti(); press(e, true); });
      return;
    }
    if (!e.shiftKey) clearMulti();
    // Pick a block up: select it, and a drag moves it.
    const pick = node => {
      e.preventDefault();
      select(node, { edit: false });
      if (!replay && S.sel === node) pressMove(e, () => [node], () => {});
    };
    if (img && isOriginal(img)) { pick(img); return; }
    if (root && isOriginal(root)) {
      // On its words: edit the text. Around them (the rest of the line, the padding): the block.
      const editing = root === S.sel && S.editing;
      if (!editing && !onGlyph(root, e)) { pick(root); return; }
      if (!editing) select(root, { edit: true });
      if (replay && S.editing) placeCaret(root, e);
      return;
    }
    if (svgText && isOriginal(svgText)) {
      e.preventDefault();
      select(svgText, { edit: false });
      openSvgText(svgText);
      return;
    }
    if (svg && isOriginal(svg)) { pick(svg); return; }
    // The padding of a card or a badge: the block with the box, not a sweep over the slide.
    const boxed = t && boxedBlock(t);
    if (boxed) { pick(boxed); return; }
    if (S.sel) deselect();
    if (replay) return;
    startMarquee({ x: e.clientX, y: e.clientY }, e.shiftKey, false);
    // Text the user clicked that the editor will not touch: say why instead of doing nothing.
    if (t && t !== doc.body && !t.hasAttribute('data-ed-slide') && /\S/.test(t.textContent || '')) {
      const p = provenanceOf(t);
      if (p.mapping !== 'authored') lockedHint(p.mapping === 'ambiguous' ? 'lock_ambiguous' : 'lock_generated');
    }
  }
  const within = (r, e) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  const caretAt = (x, y) => {
    if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
    const p = doc.caretPositionFromPoint?.(x, y);
    if (!p) return null;
    const r = doc.createRange();
    r.setStart(p.offsetNode, p.offset);
    return r;
  };
  // Is the point on root's text: on its lines of words (the spaces between them and a little
  // above and below count), not beside them in the rest of the box?
  const onGlyph = (root, e) => {
    // Text nodes only: the range of an element would also give the boxes of its child elements.
    const walk = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT), r = doc.createRange();
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      r.selectNodeContents(n);
      for (const b of r.getClientRects()) {
        if (b.width < 0.5) continue;
        const pad = Math.max(2, b.height * 0.3);
        if (e.clientX >= b.left - 2 && e.clientX <= b.right + 2 && e.clientY >= b.top - pad && e.clientY <= b.bottom + pad) return true;
      }
    }
    return false;
  };
  const placeCaret = (root, e) => {
    const c = caretAt(e.clientX, e.clientY);
    if (!c || !root.contains(c.startContainer)) return;
    const sel = win.getSelection();
    sel.removeAllRanges();
    sel.addRange(c);
  };
  // The nearest block around t that shows a box; one as large as its slide is the slide's backdrop.
  const boxedBlock = t => {
    for (let n = pickBlock(t); n; n = n.parentElement && pickBlock(n.parentElement)) {
      if (!showsBox(n)) continue;
      const slide = n.closest('[data-ed-slide]');
      if (slide) {
        const a = n.getBoundingClientRect(), b = slide.getBoundingClientRect();
        if (Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) <= 2) return null;
      }
      return n;
    }
    return null;
  };

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
  // Live sync waits while an IME (Vietnamese, Chinese…) is composing.
  S.composing = false;
  doc.addEventListener('compositionstart', () => { S.composing = true; }, true);
  doc.addEventListener('compositionend', () => { S.composing = false; }, true);

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
  doc.addEventListener('dragstart', e => { if (S.editing || doc.documentElement.classList.contains('ed-press') || e.target.closest?.('img')) e.preventDefault(); });
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
