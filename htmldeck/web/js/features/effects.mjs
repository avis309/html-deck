// Effects (data-fx): picker, preview, document script.
import { $, $$, escapeHTML, fmtSize } from '../core/utils.mjs';
import { FX_PRESETS_BY_VERSION, FX_VERSION, fxRuntime, fxScriptSource } from '../fx/runtime.mjs';
import { S, el, formatFlags } from '../editor/state.mjs';
import { deselect, select } from '../editor/selection.mjs';
import { doRemove, nodeRefs, setAttrs } from '../core/operations.mjs';
import { flushPending } from '../editor/edits.mjs';
import { formatBlock, structureBlock } from '../policy/edit-policy.mjs';
import { isOriginal, liveEl, markOriginals, modelEl, provenanceOf } from '../editor/live-document.mjs';
import { slideTitle } from '../editor/slide-info.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { hooks } from '../shared/hooks.mjs';
import { lockedHint } from '../editor/guards.mjs';
import { pushOp } from '../editor/history.mjs';

// ================================================================ effects (data-fx)
// The same runtime the document carries (js/fx/runtime.mjs), in preview mode: it plays one
// effect on the live node with the Web Animations API, which writes nothing to the DOM.
export function fxApi() { return S.win ? (S.fxPreview ||= fxRuntime(S.win, { preview: true })) : null; }
export function stopFxPreview() { S.fxPreview?.stopPreview(); }
export const FX_ATTRS = ['data-fx', 'data-fx-delay', 'data-fx-dur', 'data-fx-stagger'];
// The picker: presets by category, from the runtime's own catalog (same code the file runs).
const FX_CATS = ['enter', 'emphasis', 'data', 'loop'];
const FX_LABELS = {
  'fade-in': 'Fade in', 'fade-up': 'Fade up', 'fade-down': 'Fade down', 'zoom-in': 'Zoom in', 'zoom-out': 'Zoom out',
  'slide-left': 'Slide left', 'slide-right': 'Slide right', 'blur-in': 'Blur in', 'pop': 'Pop', 'count-up': 'Count up',
  'grow-x': 'Grow →', 'grow-y': 'Grow ↑', 'draw': 'Draw lines', 'spin': 'Spin', 'float': 'Float', 'pulse': 'Pulse',
};
// Runtime refusal → the i18n key that explains it.
export const FX_WHY = { count: 'fx_count_bad', draw: 'fx_bad_draw', inline: 'fx_bad_inline', filter: 'fx_bad_filter', transform: 'fx_bad_transform', reveal: 'fx_bad_reveal' };
let fxCatalog = null;
export function renderFxPresets() {
  const sel = $('#fx-preset'), keep = sel.value;
  fxCatalog ||= fxRuntime(window, { preview: true }).catalog();
  sel.replaceChildren(new Option(t('fx_none'), ''));
  for (const cat of FX_CATS) {
    const g = document.createElement('optgroup');
    g.label = t('fx_cat_' + cat);
    for (const p of fxCatalog.filter(p => p.category === cat)) g.appendChild(new Option(FX_LABELS[p.name] || p.name, p.name));
    sel.appendChild(g);
  }
  sel.value = keep;
}
// The duration field shows the chosen preset's own default (a loop's is seconds, not 700 ms).
export function syncFxDur() {
  const p = (fxCatalog || []).find(x => x.name === $('#fx-preset').value);
  $('#fx-dur').placeholder = String(p?.dur || 700);
}
export function fxBlock(node, preset) {
  const block = S.readOnly || structureBlock(provenanceOf(node)) || formatBlock('fx', formatFlags(node));
  if (block) return block;
  const why = preset && fxApi()?.check(node, preset);
  if (why) return FX_WHY[why] || 'fx_bad_draw';
  return null;
}
export function openFxPop(btn) {
  hooks.togglePop('#pop-fx', btn);
  if ($('#pop-fx').hidden || !S.sel) return;
  const m = modelEl(S.sel.dataset.edId);
  $('#fx-preset').value = m?.getAttribute('data-fx') || '';
  $('#fx-delay').value = m?.getAttribute('data-fx-delay') || '';
  $('#fx-dur').value = m?.getAttribute('data-fx-dur') || '';
  $('#fx-stagger').value = m?.getAttribute('data-fx-stagger') || '';
  // Presets that cannot run on this block stay listed, disabled, with the reason as title.
  const cur = $('#fx-preset').value, api = fxApi();
  for (const o of $$('#fx-preset option')) {
    const why = o.value && api ? api.check(S.sel, o.value) : null;
    o.disabled = !!why && o.value !== cur;
    o.title = why ? t(FX_WHY[why] || 'fx_bad_draw') : '';
  }
  syncFxDur();
  renderFxDoc();
}
export function applyFx() {
  const node = S.sel;
  if (!node) return;
  const preset = $('#fx-preset').value;
  const block = preset ? fxBlock(node, preset) : (S.readOnly || structureBlock(provenanceOf(node)));
  if (block) { lockedHint(block, node); $('#fx-preset').value = modelEl(node.dataset.edId)?.getAttribute('data-fx') || ''; return; }
  const id = node.dataset.edId, m = modelEl(id);
  if (!m) return;
  const val = sel => { const v = $(sel).value.trim(); return preset && /^\d+$/.test(v) ? v : null; };
  const after = { 'data-fx': preset || null, 'data-fx-delay': val('#fx-delay'), 'data-fx-dur': val('#fx-dur'), 'data-fx-stagger': val('#fx-stagger') };
  const before = Object.fromEntries(FX_ATTRS.map(a => [a, m.getAttribute(a)]));
  if (FX_ATTRS.every(a => before[a] === after[a])) return;
  setAttrs(m, after);
  setAttrs(node, after);
  pushOp({ type: 'attrs', id, before, after, key: 'fx:' + id, label: 'Effect' });
  syncFxDur();
  renderFxDoc();
}
export function previewFx() {
  const node = S.sel;
  if (!node || !$('#fx-preset').value) return;
  applyFx();
  if (!node.getAttribute('data-fx')) return;
  // The edit frame freezes animations (runtime/freeze.mjs); the preview's own are exempt.
  S.win.__edNoFreeze = true;
  try { fxApi()?.preview(node); } finally { S.win.__edNoFreeze = false; }
}
// Effects panel: the data-fx blocks and scene scopes on the current slide (or the page).
export function fxScope() { return S.mode === 'deck' ? S.slides[S.cur] : S.doc?.body; }
// Scenes a document registers from its script (window.__htmldeckScenes: [name, fn, {selector}]);
// in the edit frame the FX runtime never runs, so the queue is still a plain array. Only the
// name and selector are read.
export function registeredScenes() {
  let q;
  try { q = S.win?.__htmldeckScenes; } catch { return []; }
  if (!Array.isArray(q)) return [];
  return q.map(e => Array.isArray(e) ? { name: String(e[0] ?? ''), selector: typeof e[2]?.selector === 'string' ? e[2].selector : `[data-fx-scene="${String(e[0] ?? '').replace(/"/g, '')}"]` } : null).filter(Boolean);
}
export function sceneNamesFor(n) {
  const names = new Set();
  if (n.getAttribute('data-fx-scene')) names.add(n.getAttribute('data-fx-scene'));
  for (const d of registeredScenes()) { try { if (n.matches(d.selector)) names.add(d.name); } catch { /* bad selector */ } }
  return [...names];
}
export function renderFxList() {
  const list = $('#fx-list'), scope = fxScope();
  if (!list || !scope) return;
  list.innerHTML = '';
  const sel = ['[data-fx]', '[data-fx-scene]', ...registeredScenes().map(d => d.selector)];
  const hits = n => sel.some(q => { try { return n.matches(q); } catch { return false; } });
  const items = [scope, ...scope.querySelectorAll('*')].filter(n => isOriginal(n) && hits(n));
  if (!items.length) { list.innerHTML = `<div class="hint">${t('fx_list_empty')}</div>`; return; }
  if (items.some(n => sceneNamesFor(n).length)) list.insertAdjacentHTML('beforeend', `<div class="hint" style="margin:0 2px 8px">${t('fx_scene_hint')}</div>`);
  for (const n of items) {
    const b = document.createElement('div');
    b.className = 'fx-item';
    b.setAttribute('role', 'button');
    const fx = n.getAttribute('data-fx'), scene = sceneNamesFor(n).join(', ');
    const extra = [n.getAttribute('data-fx-delay') && `+${n.getAttribute('data-fx-delay')}ms`, n.getAttribute('data-fx-stagger') && `⇉${n.getAttribute('data-fx-stagger')}ms`].filter(Boolean).join(' ');
    b.innerHTML = `<span class="k"></span><span class="t"></span>${fx ? `<button class="x" title="${escapeHTML(t('fx_remove'))}">×</button>` : ''}`;
    b.querySelector('.k').textContent = fx || `${t('fx_scene')}: ${scene}`;
    const what = !fx && n === scope && S.mode === 'deck' ? slideTitle(n, S.cur) : (n.textContent || n.localName).replace(/\s+/g, ' ').trim().slice(0, 60);
    b.querySelector('.t').textContent = `${extra ? extra + ' · ' : ''}${what}`;
    b.addEventListener('click', e => {
      if (e.target.closest('.x')) { select(n, { edit: false }); $('#fx-preset').value = ''; applyFx(); renderFxList(); return; }
      if (n !== fxScope()) select(n, { edit: false });
    });
    list.appendChild(b);
  }
}
export function previewSlideFx() {
  const scope = fxScope();
  if (!scope) return;
  deselect();
  S.win.__edNoFreeze = true;
  try { fxApi()?.previewAll(scope); } finally { S.win.__edNoFreeze = false; }
}
export const effectsVisible = () => el.panel.classList.contains('open') && el.panel.dataset.view === 'effects';
// Whether the file carries the runtime, and the button that enables / updates / removes it.
export function fxScriptEl() { return S.model?.querySelector('script[data-htmldeck-fx]') || null; }
export function renderFxDoc() {
  const box = $('#fx-doc'), script = fxScriptEl(), used = !!S.model?.querySelector('[data-fx]');
  box.hidden = !script && !used;
  if (box.hidden) return;
  const ver = script ? +script.getAttribute('data-htmldeck-fx') : 0;
  const old = script && ver !== FX_VERSION;
  // Present always runs the current runtime; the file's own copy may not know a preset it uses.
  // Only presets an update would actually make playable count (not typos).
  const known = FX_PRESETS_BY_VERSION[ver] || [], current = FX_PRESETS_BY_VERSION[FX_VERSION];
  const stale = old && [...S.model.querySelectorAll('[data-fx]')].some(n => { const p = n.getAttribute('data-fx'); return current.includes(p) && !known.includes(p); });
  $('#fx-doc-state').textContent = t(!script ? 'fx_doc_off' : stale ? 'fx_doc_stale' : old ? 'fx_doc_old' : 'fx_doc_on');
  const b = $('#fx-doc-btn');
  b.textContent = t(!script ? 'fx_enable' : old ? 'fx_update' : 'fx_disable');
  b.dataset.act = !script ? 'enable' : old ? 'update' : 'disable';
}
export function fxDocAction() {
  if (!S.model) return;
  if (S.readOnly) return lockedHint(S.readOnly);
  const act = $('#fx-doc-btn').dataset.act;
  if (act === 'disable') return removeFxScript();
  const src = fxScriptSource(), modal = $('#modal-fx');
  $('#fx-modal-h').textContent = t(act === 'update' ? 'fx_update_h' : 'fx_enable_h');
  $('#fx-modal-b').textContent = t('fx_enable_b');
  $('#fx-modal-ok').textContent = t(act === 'update' ? 'fx_update_ok' : 'fx_enable_ok');
  $('#fx-diff').textContent = `+ <script data-htmldeck-fx="${FX_VERSION}">  … ${fmtSize(src.length)} …  </script>\n  </body>`;
  modal.classList.add('show');
  modal.onclick = e => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (!a && e.target !== modal) return;
    modal.classList.remove('show');
    if (a === 'ok') act === 'update' ? updateFxScript(src) : insertFxScript(src);
  };
}
// The live copy is created inert: a script inserted into a document runs, and the edit frame
// must never run the document's code that the model gains.
export function insertFxScript(src) {
  flushPending();
  const m = S.model.createElement('script');
  m.setAttribute('data-htmldeck-fx', String(FX_VERSION));
  m.setAttribute('data-ed-id', String(S.nextId++));
  m.textContent = src;
  const l = S.doc.importNode(m, true);
  l.setAttribute('type', 'text/x-htmldeck-inert');
  // After the last element, not after the trailing whitespace: text after </body> in the file
  // is parsed into the body, so an appended node could not be spliced in place.
  const mRef = S.model.body.lastElementChild?.nextSibling || null;
  const lLast = S.model.body.lastElementChild && $$(`[data-ed-id="${S.model.body.lastElementChild.getAttribute('data-ed-id')}"]`, S.doc)[0];
  S.model.body.insertBefore(m, mRef);
  S.doc.body.insertBefore(l, lLast ? lLast.nextSibling : null);
  markOriginals(l, m);
  pushOp({ type: 'insert', label: 'Enable FX', ...nodeRefs(m, l) });
  renderFxDoc();
  toast(t('fx_doc_on'));
}
export function updateFxScript(src) {
  const m = fxScriptEl(), id = m?.getAttribute('data-ed-id'), l = id && liveEl(id) || $$(`[data-ed-id="${id}"]`, S.doc)[0];
  if (!m || !l) return;
  const html = { type: 'html', id, before: m.innerHTML, after: src };
  const attrs = { type: 'attrs', id, before: { 'data-htmldeck-fx': m.getAttribute('data-htmldeck-fx') }, after: { 'data-htmldeck-fx': String(FX_VERSION) } };
  m.textContent = src; l.textContent = src;
  setAttrs(m, attrs.after); setAttrs(l, attrs.after);
  pushOp({ type: 'batch', label: 'Update FX', ops: [html, attrs] });
  renderFxDoc();
}
export function removeFxScript() {
  const m = fxScriptEl(), id = m?.getAttribute('data-ed-id'), l = id && $$(`[data-ed-id="${id}"]`, S.doc)[0];
  if (!m || !l) return;
  const op = { type: 'remove', label: 'Disable FX', ...nodeRefs(m, l) };
  doRemove(op);
  pushOp(op);
  renderFxDoc();
}
