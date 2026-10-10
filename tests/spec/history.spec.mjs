// Version history flows, with the document and server boundaries controlled.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { I18N } from '../../htmldeck/web/js/i18n.mjs';

const file = new URL('../../htmldeck/web/js/services/history.mjs', import.meta.url);
assert.ok(fs.existsSync(file), 'version history module exists');
const code = fs.readFileSync(file, 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
class Node {
  constructor() {
    this.children = []; this.disabled = false; this.hidden = false;
    const classes = new Set();
    this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  querySelectorAll() { return this.children.flatMap(n => [n, ...n.querySelectorAll()]).filter(n => n.tagName === 'button'); }
  focus() {}
}
function setup() {
  const ids = Object.fromEntries(['modal-history', 'history-list', 'history-status', 'history-close', 'history-file', 'btn-export', 'pop-export'].map(id => ['#' + id, new Node()]));
  const S = { source: { kind: 'server', path: 'deck.html', rev: 'current' }, saving: false, loadToken: 1 };
  const calls = [], toasts = [], cleared = [], loads = [], downloads = [];
  let dirty = false, confirmOK = true, response = { backups: [{ name: 'backup.html', time: '2026-10-10 12:00:00', size: 2048 }] }, postError = null, postWait = null;
  const ctx = vm.createContext({
    S, $: id => ids[id], openSeq: 1,
    document: { createElement: tag => Object.assign(new Node(), { tagName: tag }) },
    t: key => I18N.en[key] || key, toast: (text, options) => toasts.push({ text, options }),
    flushPending: () => calls.push('flush'), isDirty: () => dirty,
    confirm: () => confirmOK,
    contentForSave: () => ({ content: '<p>unsaved</p>' }), download: (content, name) => downloads.push({ content, name }),
    api: async url => { calls.push(url); return response; },
    postJSON: async (url, body) => { calls.push({ url, body }); if (postWait) await postWait; if (postError) throw postError; return { rev: 'restored' }; },
    openServerFile: async (path, options) => { ctx.openSeq++; loads.push({ path, options }); S.source = { ...S.source, rev: 'restored' }; return true; },
    clearDraft: async key => cleared.push(key), draftKey: src => 'server:' + src.path,
    hooks: { updateChrome() {} },
  });
  vm.runInContext(code, ctx);
  return { ctx, S, ids, calls, toasts, cleared, loads, downloads,
    dirty: value => { dirty = value; }, confirmOK: value => { confirmOK = value; },
    response: value => { response = value; }, postError: value => { postError = value; }, postWait: value => { postWait = value; },
    button: () => ids['#history-list'].querySelectorAll()[0],
    ready: () => { toasts.push({ text: 'Opened document' }); const callback = S.afterReady; S.afterReady = null; callback?.(); },
  };
}

{
  const h = setup();
  await h.ctx.openVersionHistory();
  assert.ok(h.ids['#modal-history'].classList.contains('show'));
  assert.ok(h.calls.includes('/api/backups?path=deck.html'));
  assert.equal(h.ids['#history-list'].children.length, 1);
  const row = h.ids['#history-list'].children[0];
  assert.ok(row.children.some(n => n.textContent?.includes('2026-10-10 12:00:00')));
  assert.ok(row.children.some(n => n.textContent?.includes('2.0 KB')));
  await h.button().onclick();
  const request = h.calls.find(c => c.url === '/api/restore');
  assert.equal(request.body.rev, 'current');
  assert.equal(request.body.path, 'deck.html');
  assert.equal(request.body.name, 'backup.html');
  assert.equal(h.loads[0].path, 'deck.html');
  assert.equal(h.loads[0].options.force, true);
  assert.equal(h.cleared[0], 'server:deck.html');
  assert.equal(h.S.saving, false);
  assert.equal(h.ids['#modal-history'].classList.contains('show'), false);
  h.ready();
  assert.ok(h.toasts.at(-1).text.includes('2026-10-10 12:00:00'), 'restore toast follows the iframe ready message');
}
{
  const h = setup(); h.dirty(true); h.confirmOK(false);
  await h.ctx.openVersionHistory(); await h.button().onclick();
  assert.equal(h.calls.filter(c => c.url).length, 0);
  assert.equal(h.loads.length, 0); assert.equal(h.cleared.length, 0);
  assert.equal(h.downloads.length, 0);   // cancelled: nothing downloaded
}
{
  // Confirmed with unsaved edits: a copy of them is downloaded before the restore.
  const h = setup(); h.dirty(true);
  await h.ctx.openVersionHistory(); await h.button().onclick();
  assert.deepEqual(h.downloads, [{ content: '<p>unsaved</p>', name: undefined }]);
  assert.equal(h.loads.length, 1);
}
{
  const h = setup(); h.dirty(true); h.postError(Object.assign(new Error('file changed on disk'), { status: 409 }));
  await h.ctx.openVersionHistory(); await h.button().onclick();
  assert.equal(h.loads.length, 0); assert.equal(h.cleared.length, 0);
  assert.ok(h.toasts.some(t => t.options?.err));
  assert.ok(h.ids['#modal-history'].classList.contains('show'));
  assert.equal(h.S.saving, false); assert.equal(h.button().disabled, false);
}
{
  const h = setup(); h.response({ backups: [] });
  await h.ctx.openVersionHistory();
  assert.equal(h.ids['#history-status'].textContent, I18N.en.version_history_empty);
  assert.equal(h.ids['#history-list'].children.length, 0);
}
{
  const h = setup(); h.S.source.kind = 'upload';
  await h.ctx.openVersionHistory();
  assert.equal(h.calls.length, 0);
}
{
  const h = setup();
  await h.ctx.openVersionHistory();
  let release; h.postWait(new Promise(resolve => { release = resolve; }));
  const first = h.button().onclick(); await h.button().onclick();
  assert.equal(h.calls.filter(c => c.url === '/api/restore').length, 1);
  h.S.source = { kind: 'server', path: 'other.html', rev: 'other' };
  release(); await first;
  assert.equal(h.loads.length, 0);
}
for (const lang of ['vi', 'zh', 'zh-Hant', 'en']) {
  for (const key of Object.keys(I18N.en).filter(k => k.startsWith('version_history_'))) assert.ok(I18N[lang][key], `${lang}: ${key}`);
}
console.log('Version history: restore, discard cancellation, conflict, empty list, local file and concurrent navigation checks passed');
