// Kept versions of a workspace document, restored through the server's revision check.
import { $ } from '../core/utils.mjs';
import { S } from '../editor/state.mjs';
import { openSeq, openServerFile } from '../editor/document.mjs';
import { flushPending } from '../editor/edits.mjs';
import { isDirty } from '../editor/history.mjs';
import { contentForSave } from '../editor/live-document.mjs';
import { api, postJSON } from './api.mjs';
import { download } from './save.mjs';
import { clearDraft, draftKey } from './drafts.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { hooks } from '../shared/hooks.mjs';

let request = 0, restoring = false;
export async function openVersionHistory() {
  const src = S.source;
  if (src?.kind !== 'server' || S.saving || restoring) return;
  flushPending();
  const seq = openSeq, id = ++request, m = $('#modal-history'), list = $('#history-list'), status = $('#history-status');
  const current = () => id === request && src === S.source && seq === openSeq;
  const visible = () => current() && m.classList.contains('show');
  const close = () => { if (!restoring) { m.classList.remove('show'); $('#btn-export').focus(); } };
  const controls = disabled => {
    list.querySelectorAll('button').forEach(b => { b.disabled = disabled; });
    $('#history-close').disabled = disabled;
  };
  $('#history-file').textContent = src.path;
  list.replaceChildren();
  status.textContent = t('version_history_loading');
  status.hidden = false;
  controls(false);
  m.classList.add('show');
  $('#history-close').focus();
  m.onclick = e => { if (e.target === m || e.target.closest('[data-act="close"]')) close(); };
  m.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  async function restore(backup) {
    if (!visible() || S.saving || restoring) return;
    flushPending();
    if (isDirty() && !confirm(t('version_history_confirm'))) return;
    // As when taking the agent's version: a copy of the unsaved edits is downloaded first.
    if (isDirty()) download(contentForSave().content, src.name);
    const token = S.loadToken;
    restoring = S.saving = true;
    controls(true);
    hooks.updateChrome();
    try {
      await postJSON('/api/restore', { path: src.path, name: backup.name, rev: src.rev });
      if (!current()) return;
      await clearDraft(draftKey(src));
      if (!current()) return;
      m.classList.remove('show');
      // The frame's ready message comes after openServerFile resolves. Show this one last.
      const reloadSeq = openSeq + 1;
      const ready = () => {
        if (openSeq === reloadSeq && S.source?.kind === 'server' && S.source.path === src.path)
          toast(t('version_history_restored').replace('{time}', backup.time));
      };
      S.afterReady = ready;
      if (!await openServerFile(src.path, { force: true }) && S.afterReady === ready) S.afterReady = null;
    } catch (e) {
      if (current()) toast(e.message, { err: true, ms: 6000 });
    } finally {
      restoring = false;
      if (token === S.loadToken) { S.saving = false; hooks.updateChrome(); }
      if (id === request) controls(false);
    }
  }
  try {
    const data = await api(`/api/backups?path=${encodeURIComponent(src.path)}`);
    if (!visible()) return;
    status.textContent = t('version_history_empty');
    status.hidden = data.backups.length > 0;
    for (const backup of data.backups) {
      const row = document.createElement('div');
      row.className = 'history-row';
      const time = document.createElement('span');
      time.className = 'history-time';
      time.textContent = backup.time;
      const size = document.createElement('span');
      size.className = 'history-size';
      size.textContent = `${(backup.size / 1024).toFixed(1)} KB`;
      const button = document.createElement('button');
      button.className = 'btn-soft';
      button.textContent = t('version_history_restore');
      button.onclick = () => restore(backup);
      row.append(time, size, button);
      list.append(row);
    }
  } catch (e) {
    if (!visible()) return;
    status.textContent = t('version_history_error');
    toast(e.message, { err: true, ms: 6000 });
  }
}
