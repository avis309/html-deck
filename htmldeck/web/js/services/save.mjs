// Saving to the workspace and save conflicts.
import { $, fmtSize, textHash } from '../core/utils.mjs';
import { S } from '../editor/state.mjs';
import { clearDraft, draftKey, writeDraft } from './drafts.mjs';
import { contentForSave } from '../editor/live-document.mjs';
import { flushPending } from '../editor/edits.mjs';
import { noteAnchorIds, reanchorNotes } from '../features/feedback/notes.mjs';
import { postJSON } from './api.mjs';
import { toast } from '../shared/toast.mjs';
import { hooks } from '../shared/hooks.mjs';
import { isDirty, topSeq } from '../editor/history.mjs';

// ================================================================ save / download
export async function save({ force = false, rewriteOk = false } = {}) {
  if (!S.model || S.saving) return;
  flushPending();
  if (!isDirty() && !force) return toast('No changes to save');
  const { content, minimal } = contentForSave();
  // Ask before rewriting a file whose edits could not be patched in place (an upload only
  // downloads a new copy, so there is nothing to protect).
  if (!minimal && !rewriteOk && S.source.kind !== 'upload') return askRewrite(content);
  if (content.length > 60 * 1048576) return toast(`File is ${fmtSize(content.length)} after editing, over the 60 MB save limit — remove some embedded images`, { err: true, ms: 7000 });
  const seqAtSave = topSeq();
  // Edits made while the request is in flight belong to the next save.
  const snapshot = S.model.cloneNode(true), touchedAtSave = S.touched;
  S.inFlightSeq = seqAtSave;
  const noteIds = noteAnchorIds();
  S.touched = new Set();
  // Still differs from pristine until the request lands: a download meanwhile must patch it too.
  S.touchedInFlight = touchedAtSave;
  const src = S.source, token = S.loadToken;
  S.saving = true;
  $('#sb-mode').disabled = true;
  hooks.updateChrome();
  try {
    if (src.kind === 'server') {
      const res = await postJSON('/api/save', { path: src.path, content, mtime_ns: src.mtime, force });
      src.mtime = res.mtime_ns;
      if (token !== S.loadToken) return;
      toast(`Saved ${res.file} · ${fmtSize(res.bytes_written)} · backup: ${res.backup.split('/').pop()}`);
    } else if (src.kind === 'handle') {
      // No server mtime here: compare the file on disk with the text we opened or last saved.
      if (!force && textHash(await (await src.handle.getFile()).text()) !== S.diskHash) {
        const err = new Error('file changed on disk'); err.status = 409; throw err;
      }
      const w = await src.handle.createWritable();
      await w.write(content);
      await w.close();
      if (token !== S.loadToken) return;
      toast(`Saved directly to ${src.name}`);
    } else {
      download(content, src.name);
      toast('Browser blocked direct write to dropped file — downloaded new copy instead', { ms: 4500 });
    }
    S.savedSeq = seqAtSave;
    S.saveError = '';
    S.sourceText = content;
    const oldKey = draftKey(src);
    S.diskHash = textHash(content);
    S.pristine = snapshot;
    // Edits made during the request are still unsaved: replace the draft now rather than
    // leaving the pre-save one as the recovery copy until the debounce fires.
    if (oldKey !== draftKey(src) || !isDirty()) clearDraft(oldKey);
    if (isDirty()) writeDraft().catch(() => {});
    if (src.kind === 'server') reanchorNotes(noteIds);
  } catch (e) {
    if (token !== S.loadToken) return;
    for (const id of touchedAtSave) S.touched.add(id);
    if (e.status === 409) { S.saving = false; hooks.updateChrome(); return showConflict(content); }
    S.saveError = e.message;
    toast('Save failed: ' + e.message, { err: true, ms: 6000 });
  } finally {
    S.inFlightSeq = null;
    if (token === S.loadToken) S.touchedInFlight = null;
    $('#sb-mode').disabled = false;
    if (token === S.loadToken) { S.saving = false; hooks.updateChrome(); }
  }
}
export function askRewrite(content) {
  const m = $('#modal-reformat');
  m.classList.add('show');
  m.onclick = e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act && e.target !== m) return;
    m.classList.remove('show');
    if (act === 'save') save({ rewriteOk: true });
    else if (act === 'download') download(content, S.source.name);
  };
}
export function download(content, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/html;charset=utf-8' }));
  a.download = name || 'document.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function showConflict(content) {
  const m = $('#modal-conflict');
  m.classList.add('show');
  m.onclick = e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act && e.target !== m) return;
    m.classList.remove('show');
    if (act === 'force') save({ force: true, rewriteOk: true });
    else if (act === 'download') download(content, S.source.name);
  };
}
