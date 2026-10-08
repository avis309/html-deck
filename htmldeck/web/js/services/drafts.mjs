// Draft recovery (IndexedDB).
import { S } from '../editor/state.mjs';
import { commitText } from '../editor/edits.mjs';
import { contentForSave } from '../editor/live-document.mjs';
import { openDocument } from '../editor/document.mjs';
import { textHash } from '../core/utils.mjs';
import { curLang, t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { hooks } from '../shared/hooks.mjs';
import { isDirty } from '../editor/history.mjs';

// ================================================================ draft recovery
// Idea from GrapesJS StorageManager (autosave + recovery): unsaved work is copied to IndexedDB
// shortly after each change, so a crash or a closed tab does not lose it. IndexedDB, not
// localStorage: an embedded picture alone can be 4 MB, past localStorage's ~5 MB quota.
export const DRAFT_DB = 'gs9_editor', DRAFT_STORE = 'drafts', DRAFT_DELAY = 1500;
export function draftDB() {
  if (!S.draftDB) {
    S.draftDB = new Promise((resolve, reject) => {
      const req = indexedDB.open(DRAFT_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DRAFT_STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    S.draftDB.catch(() => { S.draftDB = null; });
  }
  return S.draftDB;
}
// Draft reads/writes run one at a time, in call order, so a late delete never lands on a newer put.
export function draftTx(mode, fn) {
  const run = (S.draftQ || Promise.resolve()).then(() => draftTxNow(mode, fn));
  S.draftQ = run.catch(() => {});
  return run;
}
export async function draftTxNow(mode, fn) {
  const db = await draftDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, mode), req = fn(tx.objectStore(DRAFT_STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
// A server path names one file. A local name does not (two index.html in different folders),
// so local drafts are also keyed by the hash of the text they were made from.
export const draftKey = (src, hash = S.diskHash) => src ? (src.kind === 'server' ? 'server:' + src.path : 'local:' + src.name + ':' + hash) : null;
export function scheduleDraft() {
  clearTimeout(S.draftTimer);
  if (!S.model || !S.source || !isDirty()) return;
  S.draftTimer = setTimeout(() => (window.requestIdleCallback || (f => f()))(() => writeDraft().catch(() => {}), { timeout: 2000 }), DRAFT_DELAY);
}
export async function writeDraft() {
  clearTimeout(S.draftTimer);
  if (!S.model || !S.source || !isDirty()) return;
  commitText();
  const key = draftKey(S.source), token = S.loadToken;
  const { content } = contentForSave();
  if (content.length > 60 * 1048576) return;
  const rec = { key, base: S.diskHash, content, savedAt: Date.now(), name: S.source.name, rev: Math.random().toString(36).slice(2) };
  await draftTx('readwrite', st => st.put(rec));
  // A save or another document may have landed while the write was queued: drop this record,
  // but never a newer one written under the same key in the meantime.
  if (token !== S.loadToken || !isDirty()) {
    // Compare and delete in one transaction: a newer draft put in between must survive.
    await draftTx('readwrite', st => {
      const r = st.get(key);
      r.onsuccess = () => { if (r.result?.rev === rec.rev) st.delete(key); };
      return r;
    }).catch(() => {});
  }
}
export async function clearDraft(key = draftKey(S.source)) {
  clearTimeout(S.draftTimer);
  if (key) await draftTx('readwrite', st => st.delete(key)).catch(() => {});
}
// Called once a document is open. Returns true when a draft replaced the loaded text.
export async function offerDraft(html, source) {
  if (source.restored) return false;
  const token = S.loadToken;
  let rec;
  try { rec = await draftTx('readonly', st => st.get(draftKey(source, textHash(html)))); } catch { return false; }
  if (!rec || rec.content === html) { if (rec) clearDraft(rec.key); return false; }
  // Restoring reopens the document; never do that over edits made while IndexedDB was read.
  // The draft stays, and the next autosave of the new edits replaces it.
  if (token !== S.loadToken || S.undo.length || isDirty()) return false;
  const time = new Date(rec.savedAt).toLocaleString(curLang() === 'vi' ? 'vi-VN' : curLang() === 'zh-Hant' ? 'zh-TW' : curLang() === 'zh' ? 'zh-CN' : 'en-GB');
  let msg = t('draft_restore').replace('{name}', source.name).replace('{time}', time);
  if (rec.base && rec.base !== textHash(html)) msg += t('draft_changed');
  if (!confirm(msg)) { clearDraft(rec.key); return false; }
  // The draft becomes the working text; the file's mtime stays, so the server still refuses
  // to overwrite a file that changed on disk (409) without asking.
  await openDocument(rec.content, { ...source, restored: true, diskHash: textHash(html) });
  S.savedSeq = -1;
  hooks.updateChrome();
  toast(t('draft_restored'), { ms: 5000 });
  return true;
}
