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
import { pushOp, topSeq } from '../editor/history.mjs';

// ================================================================ effects (data-fx)
// The same runtime the document carries (js/fx/runtime.mjs), in preview mode: it plays one
// effect on the live node with the Web Animations API, which writes nothing to the DOM.
export function fxApi() { return S.win ? (S.fxPreview ||= fxRuntime(S.win, { preview: true })) : null; }
export function stopFxPreview() { S.fxPreview?.stopPreview(); }
export const FX_ATTRS = ['data-fx', 'data-fx-delay', 'data-fx-dur', 'data-fx-stagger'];
// The side bar groups effects the way Canva does: basic entrances, then data & charts, then
// the extra (looping) ones. A preset the runtime knows but no group lists is not offered.
const FX_GROUPS = [
  ['basic', ['fade-up', 'fade-in', 'fade-down', 'slide-left', 'slide-right', 'zoom-in', 'zoom-out', 'blur-in', 'pop']],
  ['data', ['count-up', 'grow-x', 'grow-y', 'draw']],
  ['extra', ['spin', 'float', 'pulse']],
];
// Runtime refusal → the i18n key that explains it.
export const FX_WHY = { count: 'fx_count_bad', draw: 'fx_bad_draw', inline: 'fx_bad_inline', filter: 'fx_bad_filter', transform: 'fx_bad_transform', reveal: 'fx_bad_reveal' };
// Each tile's drawing (Canva-like): `m` is the part that moves on hover (editor.css).
const L = '#ddd6fe', M = '#c4b5fd', D = '#8b5cf6';
const SQ = (x, y, fill, cls = '') => `<rect${cls ? ` class="${cls}"` : ''} x="${x}" y="${y}" width="16" height="16" rx="4" fill="${fill}"/>`;
const ARROW = { up: 'M42 30V12M38 16l4-4 4 4', down: 'M42 10v18M38 24l4 4 4-4', right: 'M14 35h20M30 31l4 4-4 4', left: 'M34 35H14M18 31l-4 4 4 4' };
const arrow = d => `<path d="${ARROW[d]}" fill="none" stroke="${D}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
// Four diagonal arrows at the corners, pointing out (zoom, pulse) or in (stomp).
const CORNERS = [[8, 4, 1, 1], [48, 4, -1, 1], [8, 36, 1, -1], [48, 36, -1, -1]];
const corners = out => CORNERS.map(([x, y, dx, dy]) => {
  const [hx, hy, ax, ay] = out ? [x, y, dx, dy] : [x + 6 * dx, y + 6 * dy, -dx, -dy];   // arrow head, its arms' direction
  return `<path d="M${x} ${y}l${6 * dx} ${6 * dy}M${hx} ${hy + 4 * ay}V${hy}H${hx + 4 * ax}" stroke="${D}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}).join('');
const FX_ICONS = {
  '': `<circle cx="28" cy="20" r="11" fill="none" stroke="#8a8a94" stroke-width="2.2"/><path d="M20 28l16-16" stroke="#8a8a94" stroke-width="2.2" stroke-linecap="round"/>`,
  'fade-up': SQ(16, 22, L) + SQ(16, 16, M) + SQ(16, 8, D, 'm') + arrow('up'),
  'fade-down': SQ(16, 6, L) + SQ(16, 12, M) + SQ(16, 18, D, 'm') + arrow('down'),
  'slide-right': SQ(8, 10, L) + SQ(14, 10, M) + SQ(22, 10, D, 'm') + arrow('right'),
  'slide-left': SQ(34, 10, L) + SQ(28, 10, M) + SQ(20, 10, D, 'm') + arrow('left'),
  'fade-in': `<g class="m"><rect x="17" y="10" width="7" height="20" rx="2" fill="${L}"/><rect x="23" y="10" width="7" height="20" fill="${M}"/><rect x="29" y="10" width="9" height="20" rx="2" fill="${D}"/></g>`,
  'zoom-in': `<rect class="m blur" x="19" y="11" width="18" height="18" rx="4" fill="${D}"/>` + corners(true),
  'zoom-out': `<rect x="15" y="7" width="26" height="26" rx="6" fill="none" stroke="${M}" stroke-width="1.5"/><rect class="m" x="20" y="12" width="16" height="16" rx="4" fill="${D}"/>` + corners(false),
  'blur-in': `<rect class="m blur" x="17" y="9" width="22" height="22" rx="5" fill="${D}"/>`,
  'pop': `<rect x="16" y="8" width="24" height="24" rx="6" fill="${L}"/><rect class="m" x="20" y="12" width="16" height="16" rx="4" fill="${D}"/><path d="M10 14q-3 6 0 12M46 14q3 6 0 12M6 11q-5 9 0 18M50 11q5 9 0 18" stroke="${M}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  'count-up': `<text class="m" x="28" y="26" text-anchor="middle" font-size="15" font-weight="800" fill="${D}" font-family="system-ui, sans-serif">123</text>`,
  'grow-x': `<rect x="9" y="16" width="38" height="9" rx="4.5" fill="${L}"/><rect class="m gx" x="9" y="16" width="24" height="9" rx="4.5" fill="${D}"/>`,
  'grow-y': `<rect x="23" y="5" width="10" height="30" rx="5" fill="${L}"/><rect class="m gy" x="23" y="17" width="10" height="18" rx="5" fill="${D}"/>`,
  'draw': `<polyline points="7,31 17,19 26,24 37,10 49,15" fill="none" stroke="${L}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><polyline class="m draw" points="7,31 17,19 26,24 37,10 49,15" fill="none" stroke="${D}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  'spin': `<circle cx="28" cy="20" r="8" fill="${D}"/><g class="m"><path d="M15 12a15 15 0 0 1 14-7" stroke="${D}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M26 2l3 3-3 3" stroke="${D}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M41 28a15 15 0 0 1-14 7" stroke="${D}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M30 38l-3-3 3-3" stroke="${D}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`,
  'float': `<circle class="m" cx="28" cy="20" r="9" fill="${D}"/><path d="M13 9q2 2 0 4t0 4M43 23q2 2 0 4t0 4" stroke="${D}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  'pulse': `<circle cx="28" cy="20" r="11" fill="${L}"/><circle class="m" cx="28" cy="20" r="7" fill="${D}"/>` + corners(true),
};
const fxName = name => name ? t('fx_n_' + name.replace('-', '_')) : t('fx_none');
let fxCatalog = null;
function fxTile(name) {
  const b = document.createElement('button');
  b.className = 'fx-tile';
  b.dataset.preset = name;
  b.innerHTML = `<span class="fx-ico" data-anim="${name || 'none'}"><svg viewBox="0 0 56 40" aria-hidden="true">${FX_ICONS[name] || ''}</svg></span><span class="n"></span>`;
  b.querySelector('.n').textContent = fxName(name);
  b.addEventListener('click', () => pickFx(name));
  return b;
}
// The Effects side bar: tiles in groups; only presets the runtime has (same code the file runs).
export function renderFxPresets() {
  const box = $('#fx-tiles');
  fxCatalog ||= fxRuntime(window, { preview: true }).catalog();
  const known = new Set(fxCatalog.map(p => p.name));
  box.replaceChildren();
  const none = document.createElement('div');
  none.className = 'fx-none-row';
  none.appendChild(fxTile(''));
  box.appendChild(none);
  for (const [group, names] of FX_GROUPS) {
    const g = document.createElement('div');
    g.className = 'fx-group';
    g.innerHTML = `<div class="sec-label"></div><div class="fx-grid-tiles"></div>`;
    g.querySelector('.sec-label').textContent = t('fx_cat_' + group);
    for (const n of names.filter(n => known.has(n))) g.lastChild.appendChild(fxTile(n));
    box.appendChild(g);
  }
  if (effectsVisible()) renderFxSel();
}
// A tile clicked: the block gets that effect (or none), and it plays once on the slide.
export function pickFx(name) {
  if (!S.sel) return;
  $('#fx-preset').value = name;
  applyFx();   // re-renders the side bar before the preview moves the block
  if (name && modelEl(S.sel.dataset.edId)?.getAttribute('data-fx') === name) previewFx();
}
// Which presets can run on a block, measured on the block as authored: once per block and
// document change, never while a preview is moving it (and not on every toolbar refresh).
let fxFit = { node: null, seq: -1, why: {} };
function fxRefusals(node) {
  const seq = topSeq();
  if (fxFit.node === node && fxFit.seq === seq) return fxFit.why;
  const api = fxApi(), why = {};
  if (api) for (const b of $$('#fx-tiles .fx-tile')) if (b.dataset.preset) why[b.dataset.preset] = api.check(node, b.dataset.preset);
  fxFit = { node, seq, why };
  return why;
}
// The selected block's part of the side bar: its effect, timing and what the file can play.
export function renderFxSel() {
  const node = S.multi ? null : S.sel;
  $('#fx-sel').hidden = !node;
  $('#fx-nosel').hidden = !!node;
  if (!node) return;
  const m = modelEl(node.dataset.edId);
  const snippet = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
  $('#fx-target').textContent = node.localName + (snippet ? ': ' + snippet : '');
  $('#fx-preset').value = m?.getAttribute('data-fx') || '';
  for (const [sel, attr] of [['#fx-delay', 'data-fx-delay'], ['#fx-dur', 'data-fx-dur'], ['#fx-stagger', 'data-fx-stagger']]) {
    if (document.activeElement !== $(sel)) $(sel).value = m?.getAttribute(attr) || '';
  }
  // Effects that cannot run on this block stay shown, disabled, with the reason as title.
  const cur = $('#fx-preset').value, refusals = fxRefusals(node);
  for (const b of $$('#fx-tiles .fx-tile')) {
    const why = refusals[b.dataset.preset] || null;
    b.classList.toggle('on', b.dataset.preset === cur);
    b.disabled = !!why && b.dataset.preset !== cur;
    b.title = why ? t(FX_WHY[why] || 'fx_bad_draw') : '';
  }
  syncFxDur();
  renderFxDoc();
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
// ▶ on the toolbar: the Effects side bar, on the selected block.
export function openFxPanel() {
  hooks.openPanel('effects', true);
  renderFxSel();
}
export function applyFx() {
  const node = S.sel;
  if (!node) return;
  // A preview still moving the block would be measured instead of the block as authored.
  stopFxPreview();
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
  if (effectsVisible()) { renderFxList(); renderFxSel(); }
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
