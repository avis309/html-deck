// Caret and range helpers for the preview document.
import { S } from './state.mjs';

export function placeCaretEnd(node) {
  const r = S.doc.createRange();
  r.selectNodeContents(node);
  r.collapse(false);
  const sel = S.win.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
export function selectAllIn(node) {
  const r = S.doc.createRange();
  r.selectNodeContents(node);
  const sel = S.win.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  S.savedRange = r.cloneRange();
}
