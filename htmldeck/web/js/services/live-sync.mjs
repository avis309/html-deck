// Live sync with the file on disk: when an agent (or anything else) changes the open workspace
// file, the editor takes the new version at once if nothing is unsaved here, keeping the slide,
// scroll, zoom and selection; with unsaved edits it asks (#modal-disk) and never drops either
// side silently. A change of the notes sidecar only refreshes the feedback list.
import { $ } from '../core/utils.mjs';
import { withKey } from './api.mjs';
import { S, el } from '../editor/state.mjs';
import { openSeq, openServerFile } from '../editor/document.mjs';
import { flushPending } from '../editor/edits.mjs';
import { isDirty } from '../editor/history.mjs';
import { contentForSave, isOriginal } from '../editor/live-document.mjs';
import { select, showSlide } from '../editor/selection.mjs';
import { refreshAgentNotes } from '../features/feedback/notes.mjs';
import { clearDraft } from './drafts.mjs';
import { download } from './save.mjs';
import { hooks } from '../shared/hooks.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';

const RETRY_MS = 500, RECONNECT_MS = 2000;
let stream = null, pending = null, retry = 0, reconnect = 0, notesRetry = 0;

// The revision goes in the URL, so a dropped stream is reopened by hand with the one this tab
// has now (EventSource would reuse the first URL), and the notes are read again: a change made
// while it was down sent no event.
export function watchSource(again = false) {
  stopWatch();
  const src = S.source;
  if (src?.kind !== 'server' || !window.EventSource) return;
  const es = stream = new EventSource(withKey(`/api/watch?path=${encodeURIComponent(src.path)}&rev=${encodeURIComponent(src.rev || '')}`));
  es.addEventListener('doc', e => { if (S.source === src) { pending = { src, seq: openSeq, ...JSON.parse(e.data) }; settle(); } });
  es.addEventListener('notes', () => { if (S.source === src) refreshNotes(); });
  es.onerror = () => {
    es.close();
    if (stream !== es) return;
    stream = null;
    reconnect = setTimeout(() => { if (S.source === src) watchSource(true); }, RECONNECT_MS);
  };
  if (again) refreshNotes();
}
export function stopWatch() {
  stream?.close();
  stream = null;
  pending = null;
  clearTimeout(retry);
  clearTimeout(reconnect);
  clearTimeout(notesRetry);
  $('#modal-disk').classList.remove('show');
  $('#disk-stale').hidden = true;
}
// A note being written in the list is rebuilt away by a refresh: wait until it is left.
function refreshNotes() {
  clearTimeout(notesRetry);
  if ($('#note-list').contains(document.activeElement)) { notesRetry = setTimeout(refreshNotes, RETRY_MS * 2); return; }
  refreshAgentNotes();
}
// Not while the editor is in the middle of something: a save (its answer carries the revision it
// wrote), a presentation, a drag, an IME composition, a block open for typing with nothing typed
// yet (a reload would drop the caret: it waits until the block is left), or a dialog about this
// file. Checked again shortly. Typed text does not wait: it is unsaved, so the dialog asks.
function busy() {
  return S.saving || S.presenting || S.present || S.marquee || S.spacingDrag || S.composing
    || ((S.editing || S.svgEdit) && !isDirty())
    || S.doc?.documentElement.classList.contains('ed-press')
    || $('#modal-conflict').classList.contains('show') || $('#modal-reformat').classList.contains('show');
}
function settle() {
  clearTimeout(retry);
  const p = pending;
  // Another file was asked for since (its load may still be on the way): this change is moot.
  if (!p || p.src !== S.source || p.seq !== openSeq) { pending = null; return; }
  if (p.rev === p.src.rev) { pending = null; return; }   // the version this tab has (its own save)
  if (busy()) { retry = setTimeout(settle, RETRY_MS); return; }
  flushPending();
  if (!isDirty()) { pending = null; reload(p.src); return; }
  askAboutDisk(p);
}
async function reload(src) {
  const view = viewState();
  S.afterReady = () => { restoreView(view); toast(t('disk_reloaded')); };
  if (!await openServerFile(src.path, { force: true })) S.afterReady = null;
}
function askAboutDisk(p) {
  const m = $('#modal-disk');
  $('#disk-stale').hidden = true;
  m.classList.add('show');
  m.onclick = e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'mine') { download(contentForSave().content, p.src.name); return; }
    m.classList.remove('show');
    if (act === 'later') {
      // Kept as it is; saving now meets the conflict dialog, which offers the same choices.
      pending = null;
      $('#disk-stale').hidden = false;
      $('#disk-stale').onclick = () => { pending = p; askAboutDisk(p); };
      return;
    }
    // Take the agent's version: a copy of this one is downloaded first, nothing is lost.
    download(contentForSave().content, p.src.name);
    pending = null;
    clearDraft();
    reload(p.src);
  };
}

function viewState() {
  return { mode: S.mode, cur: S.cur, y: S.win?.scrollY || 0, top: el.scroller.scrollTop, left: el.scroller.scrollLeft, fit: S.fit, scale: S.scale, id: S.sel?.id || null };
}
function restoreView(v) {
  if (!v.fit) { S.fit = false; S.scale = v.scale; hooks.layout(); }
  if (S.mode === 'deck' && v.mode === 'deck' && S.slides.length) showSlide(Math.min(v.cur, S.slides.length - 1));
  if (S.mode === 'page' && v.mode === 'page') S.win?.scrollTo(0, v.y);
  el.scroller.scrollTop = v.top;
  el.scroller.scrollLeft = v.left;
  const n = v.id && S.doc?.getElementById(v.id);
  if (n && isOriginal(n)) select(n, { edit: false });
}
