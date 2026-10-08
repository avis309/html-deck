// Opening, mounting and re-rendering documents.
import * as Reveal from '../formats/reveal.mjs';
import { $, $$, textHash } from '../core/utils.mjs';
import { DECK_H, DECK_W, S, el } from './state.mjs';
import { api, postJSON } from '../services/api.mjs';
import { buildModel, centerSlide, isOriginal, markOriginals, markRoots, renderHTML } from './live-document.mjs';
import { clearMulti, deselect, showSlide } from './selection.mjs';
import { endEditSession, flushPending } from './edits.mjs';
import { inspect as inspectFormat } from '../formats/registry.mjs';
import { newNonce } from '../core/sanitize.mjs';
import { curLang, t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { hooks } from '../shared/hooks.mjs';
import { lockedHint } from './guards.mjs';
import { isDirty } from './history.mjs';

// ================================================================ open / load
export const LAST_FILE_KEY = 'gs9_editor_last_file';
// The display mode picked by hand is remembered per file.
export const modeKey = src => src ? 'gs9_editor_mode:' + (src.kind === 'server' ? src.path : src.name) : null;
export function storedMode(src) {
  try { const m = localStorage.getItem(modeKey(src)); return m === 'deck' || m === 'page' ? m : null; } catch { return null; }
}
export function storeMode(src, mode) {
  try { mode ? localStorage.setItem(modeKey(src), mode) : localStorage.removeItem(modeKey(src)); } catch {}
}
// Every open request takes a number: a slower response for an older request must not replace
// the document opened since (and its edits) after the discard prompt has already been passed.
export let openSeq = 0;
// force: the caller already settled the unsaved edits (live sync reloading the agent's version).
export async function openServerFile(path, { force = false } = {}) {
  if (!force && !confirmDiscard()) return;
  const seq = ++openSeq;
  setLoading(true);
  docState('loading', path);
  try {
    const data = await api(`/api/load?path=${encodeURIComponent(path)}`);
    if (seq !== openSeq) return false;
    if (!await openDocument(data.content, { kind: 'server', path: data.path, name: data.filename, mtime: data.mtime_ns, rev: data.rev, size: data.size })) return false;
    try { localStorage.setItem(LAST_FILE_KEY, data.path); } catch {}
    return true;
  } catch (e) {
    if (seq !== openSeq) return false;
    setLoading(false);
    docState('error');
    toast('Cannot open file: ' + e.message, { err: true, ms: 5000 });
    return false;
  }
}
export async function openFromHandle(handle) {
  const seq = ++openSeq;
  const file = await handle.getFile();
  const text = await file.text();
  if (seq !== openSeq) return;
  await openDocument(text, { kind: 'handle', handle, name: file.name, size: file.size });
}
export async function pickLocalFile() {
  if (!confirmDiscard()) return;
  if (!window.showOpenFilePicker) { $('#file-input').click(); return; }
  try {
    const [handle] = await window.showOpenFilePicker({ types: [{ description: 'HTML', accept: { 'text/html': ['.html', '.htm'] } }] });
    setLoading(true);
    await openFromHandle(handle);
  } catch (e) {
    setLoading(false);
    if (e.name !== 'AbortError') toast('Cannot open file: ' + e.message, { err: true });
  }
}
export async function openUpload(file) {
  setLoading(true);
  const seq = ++openSeq;
  try { const text = await file.text(); if (seq !== openSeq) return; await openDocument(text, { kind: 'upload', name: file.name, size: file.size }); }
  catch (e) { if (seq !== openSeq) return; setLoading(false); toast('Cannot read file: ' + e.message, { err: true }); }
}
export function confirmDiscard() {
  flushPending();
  if (!isDirty()) return true;
  const ok = confirm(curLang() === 'zh-Hant' ? '文件有尚未儲存的變更。是否捨棄這些變更？' : curLang() === 'zh' ? '文档有未保存的更改。是否放弃这些更改？' : curLang() === 'vi' ? 'Tài liệu có thay đổi chưa lưu. Bỏ các thay đổi đó?' : 'Document has unsaved changes. Discard changes?');
  if (ok) hooks.clearDraft();
  return ok;
}
export function resetState() {
  hooks.endPresent({ restore: false });
  S.revealObs?.disconnect(); S.revealObs = null;
  S.centerRO?.disconnect(); S.centerRO = null;
  S.readOnly = null;
  hooks.stopFxPreview(); S.fxPreview = null;
  hooks.stopTrack();
  endEditSession();
  S.touchedInFlight = null;
  S.sel = null; S.editing = false; S.textDirty = false; S.savedRange = null; S.lastWrap = null;
  S.svgEdit = null; $('#svg-text').hidden = true;
  clearTimeout(S.commitTimer);
  S.undo = []; S.redo = []; S.seq = 0; S.savedSeq = 0; S.saveError = '';
  if (S.crop) { S.crop.cancelDrag?.(); S.crop = null; el.ctx.classList.remove('crop-mode'); el.box.classList.remove('crop'); }
  clearTimeout(S.notesTimer); S.notesTimer = 0; S.saving = false;
  clearTimeout(S.draftTimer);
  S.liveById = new Map(); S.slides = []; S.sections = []; S.cur = 0; S.doc = null; S.win = null;
  S.layerScope = null; S.linkCtx = null; S.spacingDrag = false;
  S.noteRegion = null; S.hoverRegion = null; S.marquee = null;
  clearMulti();
  S.find = null; S.overflows = []; clearTimeout(S.findTimer); clearTimeout(S.overflowTimer);
  $('#sb-overflow').hidden = true;
  S.thumbTimers.forEach(t => clearTimeout(t)); S.thumbTimers.clear();
  hooks.hideOverlay();
  hooks.drawOffsets(null);
  hooks.drawSnapGuides(null);
  hooks.closePopups();
  hooks.refreshToolbar();
}
export async function openDocument(html, source) {
  const token = ++S.loadToken;
  resetState();
  S.forceMode = storedMode(source);
  $('#sb-mode').value = S.forceMode || 'auto';
  try {
    buildModel(html);
    S.format = inspectFormat(S.model);
    S.source = source;
    // Nothing of the previous document's feedback stays usable while this one is mounted:
    // the preview may be slow or fail, and loadAgentNotes only runs after it.
    hooks.clearFeedback();
    S.diskHash = source.diskHash || textHash(html);
    const dir = source.kind === 'server' ? source.path.split('/').slice(0, -1).map(encodeURIComponent).join('/') : '';
    S.baseURL = location.origin + '/' + (dir ? dir + '/' : '');
    await mountModel(token);
    if (token !== S.loadToken) return false;
    hooks.loadAgentNotes();
    hooks.watchSource();
    if (!source.restored) hooks.offerDraft(html, source).catch(() => {});
    return true;
  } catch (e) {
    // A newer open took over meanwhile: its document is not this one's to clear.
    if (token !== S.loadToken) return false;
    if (e.status === 404) e.message = 'the running server is an older version — stop it (Ctrl+C) and run htmldeck again';
    // Never leave the previous document on screen bound to a half-built model.
    S.model = null; S.source = null;
    hooks.clearFeedback();
    el.frame.onload = null;
    el.frame.src = 'about:blank';
    el.stage.classList.add('empty');
    hooks.updateChrome();
    throw e;
  }
}
// Remote scripts (CDN…) do not run in the edit frame unless the user trusted this file: the
// server's CSP enforces it in the browser (also for scripts loaded dynamically). Trust is kept
// per file together with the list of remote script URLs it was given for.
export function remoteScripts() {
  const out = [];
  for (const n of S.model?.querySelectorAll('script') || []) {
    const src = n.getAttribute('src') || '';
    if (/^(https?:)?\/\//i.test(src)) out.push(src);
    for (const m of (n.textContent || '').matchAll(/(?:import\s*\(?|from)\s*['"]((?:https?:)?\/\/[^'"]+)['"]/gi)) out.push(m[1]);
  }
  return [...new Set(out)].sort();
}
// Remote scripts that generate the page's CSS in the browser.
export const RUNTIME_CSS = /\/\/cdn\.tailwindcss\.com|@tailwindcss\/browser|\/twind|@unocss\/runtime|unocss\/runtime/i;
export const trustKey = () => S.source?.kind === 'server' ? 'htmldeck_trust:' + S.source.path : null;
export function trustRemote() {
  const k = trustKey(), sig = remoteScripts().join('\n');
  if (!k || !sig) return false;
  try { return localStorage.getItem(k) === sig; } catch { return false; }
}
// Applied first, remembered only once the edit frame was rebuilt with it: a cancelled or
// failed rebuild leaves both the stored choice and the running frame as they were.
export async function setTrust(on) {
  const k = trustKey();
  if (!k) return;
  S.trustOverride = on;
  let ok = false;
  try { ok = await rerender(); } finally { S.trustOverride = undefined; }
  if (ok) try { on ? localStorage.setItem(k, remoteScripts().join('\n')) : localStorage.removeItem(k); } catch {}
  renderTrustChip();
}
export function renderTrustChip() {
  const b = $('#sb-trust'), remote = S.source?.kind === 'server' && remoteScripts().length;
  b.hidden = !remote;
  if (!remote) return;
  const on = !!S.mountedTrust;   // what the running frame was built with
  b.classList.toggle('on', on);
  b.textContent = t(on ? 'trust_on' : 'trust_off');
  b.title = t(on ? 'trust_on_title' : 'trust_off_title');
}
export async function mountModel(token) {
  const trust = S.trustOverride ?? trustRemote();
  const nonce = S.source.kind === 'server' ? undefined : newNonce();
  const { url } = await postJSON('/api/preview', { path: S.source.kind === 'server' ? S.source.path : null, content: renderHTML(nonce), target: 'edit', trust_remote: trust, nonce });
  S.mountedTrust = trust;
  if (token !== S.loadToken) return;
  el.frame.onload = () => { if (token === S.loadToken) onFrameReady(); };
  el.frame.src = url;
}
// Re-render the current model (e.g. after switching slide/page mode). Live nodes are
// replaced, so undo history cannot survive; unsaved edits are kept in the model.
export async function rerender({ force = false, dirty: knownDirty } = {}) {
  if (!S.model) return false;
  if (S.saving) { toast('Saving — please wait before switching display mode'); return false; }
  if (!force) flushPending();
  if (!force && (S.undo.length || S.redo.length) && !confirm(curLang() === 'zh-Hant' ? '切換顯示模式將清空復原記錄（變更仍會保留）。是否繼續？' : curLang() === 'zh' ? '切换显示模式将清空撤销历史（更改仍将保留）。是否继续？' : curLang() === 'vi' ? 'Đổi cách hiển thị sẽ xoá lịch sử hoàn tác (các thay đổi vẫn giữ nguyên). Tiếp tục?' : 'Switching display mode will clear undo history (changes will remain). Continue?')) return false;
  const dirty = knownDirty ?? isDirty(), token = ++S.loadToken;
  resetState();
  S.savedSeq = dirty ? -1 : 0;
  setLoading(true);
  try { await mountModel(token); }
  catch (e) { setLoading(false); toast('Cannot rebuild: ' + e.message, { err: true }); return false; }
  return true;
}
export function onFrameReady() {
  const doc = el.frame.contentDocument, win = el.frame.contentWindow;
  if (!doc || !doc.body) { setLoading(false); toast('Cannot render document', { err: true }); return; }
  S.doc = doc; S.win = win;
  S.liveOriginal = new WeakSet();
  S.liveAmbiguous = new WeakSet();
  markOriginals(doc.documentElement, S.model.documentElement);
  // Detection measures layout: the frame must be displayed first. On the first document of a
  // session the empty stage hides it, and every block would measure 0×0.
  el.stage.classList.remove('empty');

  S.deckW = DECK_W; S.deckH = DECK_H; S.revealCenter = false;
  const slides = S.format?.format === 'reveal' ? setupReveal(doc, win) : detectSlides(doc, win);
  const fmtStyle = doc.createElement('style');
  fmtStyle.id = 'ed-format';
  fmtStyle.textContent = `:root { --ed-deck-w: ${S.deckW}px; --ed-deck-h: ${S.deckH}px; }` + (S.format?.format === 'reveal' ? Reveal.editCSS() + Reveal.backgroundCSS(Reveal.leaves(S.model)) : '');
  doc.head.appendChild(fmtStyle);
  S.mode = S.forceMode || (slides.length ? 'deck' : 'page');
  if (S.mode === 'deck' && !slides.length) {
    S.mode = 'page';
    S.forceMode = null;
    $('#sb-mode').value = 'auto';
    toast('Document has no .slide blocks — keeping web page mode', { ms: 4000 });
  }
  if (S.mode === 'page') slides.length = 0;
  for (const s of slides) {
    const d = win.getComputedStyle(s).display;
    s.dataset.edDisplay = d && d !== 'none' ? d : 'block';
    s.setAttribute('data-ed-slide', '');
  }
  S.slides = slides;
  // A transformed ancestor (e.g. a deck track with will-change: transform) becomes the containing
  // block of the fixed slide, which the 0-height overflow-hidden body then clips to nothing.
  const ancs = new Set();
  for (const s of slides) for (let n = s.parentElement; n && n !== doc.documentElement; n = n.parentElement) ancs.add(n);
  ancs.forEach(n => n.setAttribute('data-ed-slide-anc', ''));
  doc.documentElement.classList.add(S.mode === 'deck' ? 'ed-deck' : 'ed-page');
  if (S.mode === 'deck') slides.forEach(s => markRoots(s, false));
  else if (isOriginal(doc.body)) markRoots(doc.body, false);

  hooks.bindFrameEvents(doc, win);
  // Feedback lives in a sidecar next to a workspace file; for other files the button stays
  // clickable and explains why (see needWorkspaceFile).
  $('#pill-note').classList.toggle('unavailable', S.source.kind !== 'server');
  S.fit = true;
  hooks.applyModeUI();
  if (S.mode === 'deck') { showSlide(0); centerAllSlides(); hooks.buildFilmstrip(); }
  else if (S.sections.length) { hooks.buildFilmstrip(); hooks.trackSection(); }
  hooks.buildOutline();
  hooks.buildDocColors();
  hooks.layout();
  hooks.updateChrome();
  hooks.renderPins();
  setLoading(false);
  docState('ready', S.source.kind === 'server' ? S.source.path : S.source.name);
  hooks.renderFileList();
  if (!$('#findbar').hidden) hooks.runFind();
  S.overflows = [];
  setTimeout(() => { if (S.doc === doc) hooks.checkOverflow(true); }, 700);
  const n = S.liveById.size;
  renderTrustChip();
  if (S.readOnly) toast(t(S.readOnly), { ms: 6000 });
  else if (!$('#sb-trust').hidden && !S.mountedTrust) {
    // A runtime CSS framework (Tailwind Play CDN, Twind, UnoCSS runtime) styles the whole page:
    // blocked, the page looks broken rather than merely static, so say so and keep it up longer.
    const css = remoteScripts().some(u => RUNTIME_CSS.test(u));
    toast(t(css ? 'trust_toast_css' : 'trust_toast'), { ms: css ? 15000 : 8000, action: { label: t('trust_action'), fn: () => setTrust(true) } });
  }
  else toast(`Opened ${S.source.name} · ${S.mode === 'deck' ? S.slides.length + ' slides' : 'web page'} · ${n} editable text blocks`);
  if (S.afterReady) { const f = S.afterReady; S.afterReady = null; f(); }
}
// A deck is a group of ≥2 sibling `.slide` blocks at presentation width; a carousel of small
// `.slide` cards on a normal page must stay in page mode.
export function detectSlides(doc, win) {
  const all = $$('.slide', doc).filter(s => isOriginal(s) && !s.parentElement.closest('.slide'));
  const groups = new Map();
  for (const s of all) groups.set(s.parentElement, [...(groups.get(s.parentElement) || []), s]);
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0] || [];
  if (S.forceMode === 'deck') return best;
  // `.slide` blocks laid out as one long scrolling page are report sections, not slides: keep
  // page mode (nothing gets cut off) and use them only as jump targets in the filmstrip.
  if (isSectionReport(best, win)) { S.sections = best.filter(s => win.getComputedStyle(s).display !== 'none'); return []; }
  const wide = best.filter(s => { const w = parseFloat(win.getComputedStyle(s).width); return !(w > 0) || w >= 900; });
  return best.length >= 2 && wide.length === best.length ? best : [];
}
// Reveal deck in the edit preview: its runtime was intercepted by the bootstrap (see
// formats/reveal.mjs), so the DOM is the authored one. Returns the leaf slides.
export function setupReveal(doc, win) {
  const st = win.__htmldeckReveal || {};
  const size = Reveal.slideSize(st.config);
  S.deckW = Math.round(size.width); S.deckH = Math.round(size.height); S.revealCenter = size.center;
  if (size.unsupported) toast(t('reveal_size_warn'), { ms: 5000 });
  // A runtime that ran (or may still run: an ES module cannot be intercepted) owns this DOM.
  const rt = S.format.runtime;
  if (Reveal.runtimeRan(doc) || rt.module || (rt.classic && win.Reveal && !st.intercepted)) setReadOnly('lock_reveal_runtime');
  else {
    // A late start (plugin loaded after load, a timer) is caught when it marks the DOM.
    const box = doc.querySelector('.reveal');
    S.revealObs = new win.MutationObserver(() => { if (Reveal.runtimeRan(doc)) setReadOnly('lock_reveal_runtime'); });
    if (box) S.revealObs.observe(box, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }
  // The theme styles the body through this class, which Reveal's runtime would have added.
  doc.body.classList.add('reveal-viewport');
  return Reveal.leaves(doc).map(l => l.el).filter(isOriginal);
}
// Read-only document: every path that writes the model is refused (pushOp is the safety net).
export function setReadOnly(key) {
  if (S.readOnly) return;
  flushPending();
  if (S.sel) deselect();
  S.readOnly = key;
  el.notesText.disabled = true;
  lockedHint(key);
  hooks.updateChrome();
}
export function centerAllSlides() {
  if (S.format?.format !== 'reveal' || S.mode !== 'deck') return;
  S.slides.forEach((s, i) => {
    const hidden = i !== S.cur;
    if (hidden) s.style.setProperty('display', s.dataset.edDisplay, 'important');
    centerSlide(s);
    if (hidden) s.style.setProperty('display', 'none', 'important');
  });
  S.centerRO?.disconnect();
  S.centerRO = new S.win.ResizeObserver(() => centerSlide(S.slides[S.cur]));
  if (S.slides[S.cur]) S.centerRO.observe(S.slides[S.cur]);
}
// Judged on the layout the document actually renders, not on class names: ≥2 visible blocks
// in normal flow, stacked top to bottom, and not all 16:9 (a Marp-style export that stacks
// real slides vertically keeps every block at 16:9 and stays a deck).
export function isSectionReport(list, win) {
  const vis = list.filter(s => win.getComputedStyle(s).display !== 'none');
  if (vis.length < 2) return false;
  if (!vis.every(s => ['static', 'relative', 'sticky'].includes(win.getComputedStyle(s).position))) return false;
  const r = vis.map(s => s.getBoundingClientRect());
  if (!r.slice(1).every((b, k) => b.top >= r[k].bottom - 2)) return false;
  return !r.every(x => x.width > 0 && Math.abs(x.height / x.width - 9 / 16) < 0.06);
}
export function setLoading(on) { $('#loading').classList.toggle('show', on); }
// Stable, DOM-level load signal (tests and tools wait on it instead of on timers):
// <body data-doc-state="loading|ready|error" data-doc-path="…" data-doc-seq="n">.
export function docState(state, path) {
  const b = document.body;
  b.dataset.docState = state;
  if (path != null) b.dataset.docPath = path;
  if (state === 'ready') b.dataset.docSeq = String((+b.dataset.docSeq || 0) + 1);
}
