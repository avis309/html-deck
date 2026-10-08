// Keyboard shortcuts and the frame bridges.
import { $, isTypingTarget } from '../core/utils.mjs';
import { S, el } from '../editor/state.mjs';
import { claimOwn, noteForeign, openSvgText } from '../editor/edits.mjs';
import { deleteMulti } from '../editor/multi-selection.mjs';
import { closePopups } from './toolbar.mjs';
import { copyStyle, deleteSel, duplicateSel, pasteStyle } from '../editor/element-actions.mjs';
import { clearMulti, deselect, setEditing, showSlide } from '../editor/selection.mjs';
import { endPresent } from '../present/controller.mjs';
import { exitCrop } from '../features/images.mjs';
import { fitZoom, zoomBy } from './layout.mjs';
import { isRoot, isSvgText } from '../editor/live-document.mjs';
import { nudge } from './drag.mjs';
import { nudgeOrder } from '../editor/reorder.mjs';
import { openFind } from '../features/find.mjs';
import { openLinkPop } from '../features/links.mjs';
import { feedbackMulti, openNotePop } from '../features/feedback/notes.mjs';
import { redo, undo } from '../editor/commands.mjs';
import { save } from '../services/save.mjs';
import { placeCaretEnd } from '../editor/caret.mjs';

// ================================================================ keyboard
export function onKey(e, fromFrame) {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 's') { if (fromFrame) { e.preventDefault(); save(); } return; }   // editor side: see the capture listener in bindUI
  if (!S.doc) return;
  // The present frame has the keys; any that reach the editor meanwhile only end the session.
  if (S.present) { if (e.key === 'Escape') { e.preventDefault(); endPresent(); } return; }
  if (mod && (k === 'f' || k === 'h')) { e.preventDefault(); openFind(k === 'h'); return; }
  if (!fromFrame && isTypingTarget(e.target)) return;
  if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if (mod && e.altKey && k === 'c') { e.preventDefault(); copyStyle(); return; }
  if (mod && e.altKey && k === 'v') { e.preventDefault(); pasteStyle(); return; }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomBy(1.15); return; }
  if (mod && k === '-') { e.preventDefault(); zoomBy(1 / 1.15); return; }
  if (mod && k === '0') { e.preventDefault(); fitZoom(); return; }
  if (mod && k === 'd' && S.sel) { e.preventDefault(); duplicateSel(); return; }
  if (mod && e.shiftKey && k === 'm') { e.preventDefault(); if (S.multi) feedbackMulti(); else openNotePop(); return; }
  if (mod && !e.shiftKey && k === 'k' && S.sel) { e.preventDefault(); openLinkPop(); return; }
  if (e.key === 'Escape' && S.multi && $('#pop-note').hidden) { clearMulti(); return; }
  if (S.multi && !S.editing && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); deleteMulti(); return; }
  if (e.key === 'Escape' && S.crop) { exitCrop(); return; }
  if (e.key === 'Escape') {
    if (!el.menu.hidden || !$('#pop-spacing').hidden || !$('#pop-opacity').hidden || !$('#pop-note').hidden || !$('#pop-link').hidden || !$('#pop-alt').hidden || !$('#pop-img').hidden) { closePopups(); return; }
    if (S.editing) setEditing(false); else deselect();
    return;
  }
  if (S.editing) return;
  if (S.multi && !mod && !e.altKey && k.startsWith('arrow')) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    nudge(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
    return;
  }
  if (S.sel) {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
    else if (e.key === 'Enter' && isRoot(S.sel)) { e.preventDefault(); setEditing(true); placeCaretEnd(S.sel); }
    else if (e.key === 'Enter' && isSvgText(S.sel)) { e.preventDefault(); openSvgText(S.sel); }
    else if (e.altKey && (k === 'arrowup' || k === 'arrowdown')) { e.preventDefault(); nudgeOrder(k === 'arrowup' ? -1 : 1); }
    else if (k.startsWith('arrow')) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      nudge(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
    }
    return;
  }
  if (S.mode === 'deck') {
    if (['arrowright', 'arrowdown', 'pagedown'].includes(k)) { e.preventDefault(); showSlide(S.cur + 1); }
    else if (['arrowleft', 'arrowup', 'pageup'].includes(k)) { e.preventDefault(); showSlide(S.cur - 1); }
  }
}
// The preview's frame guard calls these: set by app.mjs before boot, before any document loads.
export function installFrameBridges() {
  window.__edKey = onKey;
  // Trusted beforeinput/input of the preview, from the frame guard's window capture listener: it
  // was registered before any page script, so it runs before every page input handler. Records
  // pending at beforeinput predate the edit (foreign); at input they are the browser's edit.
  window.__edInput = e => {
    const ss = S.session;
    if (!ss || !S.editing || !ss.node.contains(e.target)) return;
    if (e.type === 'beforeinput') noteForeign(ss.mo.takeRecords());
    else claimOwn();
  };
  window.__edWheel = e => zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
}
