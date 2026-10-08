// Speaker notes of the current slide (Reveal aside.notes or data-notes).
import { $, $$, escapeHTML } from '../core/utils.mjs';
import { S, el, formatFlags } from './state.mjs';
import { commandBlocked } from './guards.mjs';
import { formatBlock } from '../policy/edit-policy.mjs';
import { isOriginal } from './live-document.mjs';
import { pushOp } from './history.mjs';
import { t } from '../shared/lang.mjs';
import { modelEl } from './live-document.mjs';

export function notesEl() {
  const s = S.slides[S.cur];
  return s ? $$('.notes', s).find(isOriginal) || null : null;
}
// Reveal also keeps notes in the slide's data-notes attribute (used when there is no aside).
export function notesAttrSlide() {
  const s = S.slides[S.cur];
  return S.format?.format === 'reveal' && s && !notesEl() && s.hasAttribute('data-notes') ? s : null;
}
export function loadNotes() {
  const n = notesEl(), a = notesAttrSlide();
  el.notesText.disabled = (!n && !a) || !!S.readOnly || !!formatBlock('edit', formatFlags(n || a));
  el.notesText.value = n ? n.textContent.trim() : a ? a.getAttribute('data-notes') : '';
  $('#notes-title').textContent = `${t('speaker_notes')} · Slide ${S.cur + 1}`;
}
export function saveNotes() {
  const n = notesEl(), a = notesAttrSlide();
  if (!n && a) {
    const id = a.dataset.edId, m = modelEl(id);
    if (!m || commandBlocked(a)) return;
    const before = m.getAttribute('data-notes'), after = el.notesText.value;
    if (before === after) return;
    m.setAttribute('data-notes', after);
    a.setAttribute('data-notes', after);
    pushOp({ type: 'attrs', id, before: { 'data-notes': before }, after: { 'data-notes': after }, key: 'notes:' + id, label: 'Speaker notes' });
    return;
  }
  if (!n || commandBlocked(n)) return;
  const id = n.dataset.edId, m = modelEl(id);
  if (!m) return;
  const before = m.innerHTML, after = escapeHTML(el.notesText.value);
  if (before === after) return;
  m.innerHTML = after;
  n.innerHTML = after;
  pushOp({ type: 'html', id, before, after, key: 'notes:' + id, label: 'Speaker notes' });
}
