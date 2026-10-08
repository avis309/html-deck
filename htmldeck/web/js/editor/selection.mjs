// Selection and text editing mode.
import { S, el, formatFlags } from './state.mjs';
import { closeSvgText, commitText, endEditSession, startEditSession } from './edits.mjs';
import { formatBlock, textEditBlock } from '../policy/edit-policy.mjs';
import { centerSlide, isRoot, provenanceOf } from './live-document.mjs';
import { hooks } from '../shared/hooks.mjs';
import { lockedHint } from './guards.mjs';
import { $, $$, clamp } from '../core/utils.mjs';
import { loadNotes, saveNotes } from './speaker-notes.mjs';

// ================================================================ selection
export function select(node, { edit = true } = {}) {
  hooks.stopFxPreview();
  clearMulti();
  if (S.crop && S.crop.img !== node) hooks.exitCrop();
  if (S.sel && S.sel !== node) deselect();
  S.sel = node;
  setEditing(edit && isRoot(node));
  el.pill.classList.add('show');
  el.box.classList.add('show');
  el.box.classList.toggle('block', !isRoot(node));
  el.box.classList.toggle('svg', !!node.ownerSVGElement);
  const slideIdx = S.slides.indexOf(node.closest('[data-ed-slide]'));
  if (slideIdx >= 0 && slideIdx !== S.cur) showSlide(slideIdx, { keepSel: true });
  hooks.refreshToolbar();
  hooks.startTrack();
  hooks.syncLayers();
}
export function setEditing(on) {
  const node = S.sel;
  if (!node) return;
  if (on === S.editing && (!on || node.isContentEditable)) return;
  if (on) {
    const block = S.readOnly || textEditBlock(provenanceOf(node)) || formatBlock('text', formatFlags(node));
    if (block) { lockedHint(block, node); return; }
    node.setAttribute('contenteditable', 'true');
    node.setAttribute('spellcheck', 'false');
    S.editing = true;
    startEditSession(node);
    if (S.doc.activeElement !== node) node.focus({ preventScroll: true });
  } else {
    commitText();
    endEditSession();
    node.removeAttribute('contenteditable');
    node.removeAttribute('spellcheck');
    S.editing = false;
    S.savedRange = null;
    S.win.getSelection().removeAllRanges();
    node.blur();
  }
  el.box.classList.toggle('editing', S.editing);
}
export function deselect() {
  hooks.stopFxPreview();
  hooks.exitCrop();
  closeSvgText(true);
  if (!S.sel) return;
  setEditing(false);
  S.sel = null;
  S.lastWrap = null;
  hooks.closePopups();
  hooks.hideOverlay();
  hooks.refreshToolbar();
  hooks.syncLayers();
}

export function clearMulti() {
  if (!S.multi) return;
  S.multi = null;
  $('#multi-pill').classList.remove('show');
}

export function showSlide(i, { keepSel = false } = {}) {
  hooks.stopFxPreview();
  if (S.mode !== 'deck' || !S.slides.length) return;
  // Notes typed within the debounce belong to the slide being left: save them before S.cur moves
  // (a panel button keeps the focus, so the textarea's blur does not flush them).
  if (S.notesTimer) { clearTimeout(S.notesTimer); S.notesTimer = 0; saveNotes(); }
  i = clamp(i, 0, S.slides.length - 1);
  if (!keepSel) deselect();
  S.cur = i;
  S.slides.forEach((s, k) => {
    s.style.setProperty('display', k === i ? s.dataset.edDisplay : 'none', 'important');
    s.classList.toggle('ed-cur', k === i);
  });
  if (S.centerRO) { S.centerRO.disconnect(); S.centerRO.observe(S.slides[i]); centerSlide(S.slides[i]); }
  $$('.thumb', el.filmstrip).forEach((t, k) => t.classList.toggle('active', k === i));
  el.filmstrip.children[i]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  hooks.updateChrome();
  if (!el.notes.hidden) loadNotes();
  if (hooks.layersVisible()) hooks.buildLayers();
  if (hooks.effectsVisible()) hooks.renderFxList();
  if (el.panel.classList.contains('open') && el.panel.dataset.view === 'review') hooks.renderNoteList();
}
