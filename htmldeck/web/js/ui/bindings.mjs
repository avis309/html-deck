// Event wiring of the editor chrome.
import { $, $$ } from '../core/utils.mjs';
import { DEFAULT_COLORS, FONTS, S, el } from '../editor/state.mjs';
import { PAGE_W_KEY, applyPageWidth } from './chrome.mjs';
import { addNoteFromPop, feedbackMulti, openNotePop } from '../features/feedback/notes.mjs';
import { applyAlt, enterCrop, exitCrop, flipImage, normalizeImageURL, openAltPop, openImagePop, replaceImage, replaceWithFile, resetImage, selectedImg, setFit, startCropDrag } from '../features/images.mjs';
import { applyFont, cycleAlign, setFontSize, toggleCase, toggleStyle } from '../features/formatting.mjs';
import { applyFx, fxDocAction, openFxPop, previewFx, previewSlideFx } from '../features/effects.mjs';
import { applyLink, openLinkPop, removeLink } from '../features/links.mjs';
import { bindBoxPanel } from './panels/box.mjs';
import { bindFind } from '../features/find.mjs';
import { nudgeOrder } from '../editor/reorder.mjs';
import { bindSvgText, flushPending } from '../editor/edits.mjs';
import { buildLayers, layerNode, showHoverBox } from './panels/layers.mjs';
import { deleteMulti, endMarquee, framePoint, moveMarquee, startMarquee } from '../editor/multi-selection.mjs';
import { clearStyle, copyStyle, deleteSel, duplicateSel, insertText, pasteStyle, selectParent } from '../editor/element-actions.mjs';
import { closePanel, openPanel, renderFileList } from './panels/side-panel.mjs';
import { closePopups, togglePop } from './toolbar.mjs';
import { confirmDiscard, openFromHandle, openUpload, pickLocalFile, rerender, setLoading, setTrust, storeMode } from '../editor/document.mjs';
import { contentForSave } from '../editor/live-document.mjs';
import { copyFeedbackRequest, flushRemoval, renderNoteList, renderPins } from './feedback-view.mjs';
import { clearMulti, deselect, select, showSlide } from '../editor/selection.mjs';
import { download, save } from '../services/save.mjs';
import { exportPDF, exportSingleFile, openExportMenu } from '../services/export.mjs';
import { fitZoom, layout, setZoom, zoomBy } from './layout.mjs';
import { layoutPresent, togglePresent } from '../present/controller.mjs';
import { nextOverflow } from '../features/overflow.mjs';
import { onKey } from './keyboard.mjs';
import { openLangMenu, selectLanguage } from './language.mjs';
import { placeMenu, positionOverlay } from './overlay.mjs';
import { redo, styleEdit, undo } from '../editor/commands.mjs';
import { startDrag } from './drag.mjs';
import { writeDraft } from '../services/drafts.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { bindLayerDrag } from './panels/layer-drag.mjs';
import { renderSwatches } from './panels/colors.mjs';
import { isDirty } from '../editor/history.mjs';
import { loadNotes, saveNotes } from '../editor/speaker-notes.mjs';

// ================================================================ UI wiring
export function bindUI() {
  document.addEventListener('keydown', e => onKey(e, false));
  bindFind();
  bindSvgText();
  $('#sb-overflow').addEventListener('click', nextOverflow);
  // Ctrl/Cmd+S must work from any field, including ones that stop key propagation; blur first
  // so a value typed but not yet committed (change event) is part of the save.
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (document.activeElement && document.activeElement !== document.body && document.activeElement !== el.frame) document.activeElement.blur();
      save();
    }
  }, true);
  window.addEventListener('resize', () => requestAnimationFrame(() => { layout(); layoutPresent(); }));
  window.addEventListener('pagehide', () => { writeDraft().catch(() => {}); flushRemoval(); });
  window.addEventListener('beforeunload', e => { flushPending(); if (S.model && isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  el.scroller.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); } }, { passive: false });
  el.scroller.addEventListener('scroll', () => { if (S.sel) positionOverlay(true); }, { passive: true });
  el.scroller.addEventListener('pointerdown', e => {
    if (e.target !== el.scroller && e.target !== el.sizer) return;
    deselect();
    if (!e.shiftKey) clearMulti();
    if (e.button === 0 && S.doc) { e.preventDefault(); startMarquee(framePoint(e), e.shiftKey, true); }
  });
  window.addEventListener('pointermove', e => { if (S.marquee?.fromStage) moveMarquee(framePoint(e)); });
  window.addEventListener('pointerup', e => { if (S.marquee?.fromStage) { moveMarquee(framePoint(e)); endMarquee(); } });

  // Keep the iframe's text selection alive while toolbar buttons are pressed.
  for (const zone of [el.ctx, el.pill, el.menu, $('#pop-spacing'), $('#pop-opacity'), $('#pop-fx'), $('#pop-note'), $('#pop-link'), $('#pop-alt'), $('#pop-img'), el.panel]) {
    zone.addEventListener('mousedown', e => { if (!e.target.closest('input, select, textarea')) e.preventDefault(); });
  }

  $$('[data-panel]').forEach(b => b.addEventListener('click', () => openPanel(b.dataset.panel)));
  $('#panel-close').addEventListener('click', closePanel);
  $('#empty-open').addEventListener('click', () => openPanel('files'));
  $('#btn-pick').addEventListener('click', pickLocalFile);
  $('#file-input').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f && confirmDiscard()) openUpload(f); });
  $('#file-search').addEventListener('input', renderFileList);
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-save').addEventListener('click', () => save());
  $('#btn-download').addEventListener('click', () => { if (!S.model) return; flushPending(); download(contentForSave().content, S.source.name); });
  $('#sb-full').addEventListener('click', togglePresent);
  $('#btn-lang').addEventListener('click', e => {
    e.stopPropagation();
    openLangMenu();
  });
  $$('#pop-lang .lang-opt').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      selectLanguage(btn.dataset.lang);
    });
  });
  window.addEventListener('click', e => {
    if (!e.target.closest('#pop-lang') && !e.target.closest('#btn-lang')) {
      const pop = $('#pop-lang');
      if (pop) pop.classList.remove('show');
    }
  });
  $('#btn-export').addEventListener('click', e => { e.stopPropagation(); openExportMenu(); });
  $$('#pop-export .lang-opt').forEach(btn => btn.addEventListener('click', () => {
    $('#pop-export').classList.remove('show');
    if (btn.dataset.x === 'single') exportSingleFile();
    else if (btn.dataset.x === 'pdf') exportPDF();
  }));
  try { $('#export-remote').checked = localStorage.getItem('htmldeck_export_remote') !== '0'; } catch { /* storage blocked */ }
  $('#export-remote').addEventListener('change', e => { try { localStorage.setItem('htmldeck_export_remote', e.target.checked ? '1' : '0'); } catch { /* storage blocked */ } });
  window.addEventListener('click', e => { if (!e.target.closest('#pop-export') && !e.target.closest('#btn-export')) $('#pop-export').classList.remove('show'); });
  $('#btn-present').addEventListener('click', togglePresent);
  $('#rail-keys').addEventListener('click', () => $('#modal-keys').classList.add('show'));
  $('#sb-help').addEventListener('click', () => $('#modal-keys').classList.add('show'));
  $('#modal-keys').addEventListener('click', e => { if (e.target.id === 'modal-keys' || e.target.closest('[data-act]')) $('#modal-keys').classList.remove('show'); });

  $$('[data-preset]').forEach(b => b.addEventListener('click', () => insertText(b.dataset.preset)));
  $$('#color-target button').forEach(b => b.addEventListener('click', () => {
    S.colorTarget = b.dataset.target;
    $$('#color-target button').forEach(x => x.classList.toggle('on', x === b));
  }));
  renderSwatches($('#default-colors'), DEFAULT_COLORS, false);

  const fontSel = $('#tb-font');
  for (const [name, fb] of FONTS) {
    const o = new Option(name, name);
    o.style.fontFamily = `'${name}', ${fb}`;
    fontSel.appendChild(o);
  }
  fontSel.addEventListener('change', () => applyFont(fontSel.value));
  $('#tb-size-dn').addEventListener('click', () => setFontSize((parseFloat($('#tb-size').value) || 16) - 1));
  $('#tb-size-up').addEventListener('click', () => setFontSize((parseFloat($('#tb-size').value) || 16) + 1));
  $('#tb-size').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setFontSize(parseFloat(e.target.value)); } e.stopPropagation(); });
  $('#tb-size').addEventListener('change', e => setFontSize(parseFloat(e.target.value)));
  $('#tb-color').addEventListener('click', () => { S.colorTarget = 'text'; $$('#color-target button').forEach(x => x.classList.toggle('on', x.dataset.target === 'text')); if (!el.panel.classList.contains('open') || el.panel.dataset.view !== 'colors') openPanel('colors'); });
  $('#tb-bold').addEventListener('click', () => toggleStyle('bold'));
  $('#tb-italic').addEventListener('click', () => toggleStyle('italic'));
  $('#tb-underline').addEventListener('click', () => toggleStyle('underline'));
  $('#tb-strike').addEventListener('click', () => toggleStyle('strikeThrough'));
  $('#tb-case').addEventListener('click', toggleCase);
  $('#tb-align').addEventListener('click', cycleAlign);
  $('#tb-clear').addEventListener('click', clearStyle);
  $('#tb-spacing').addEventListener('click', e => togglePop('#pop-spacing', e.currentTarget));
  $('#tb-opacity').addEventListener('click', e => togglePop('#pop-opacity', e.currentTarget));
  $('#tb-fx').addEventListener('click', e => openFxPop(e.currentTarget));
  for (const id of ['#fx-preset', '#fx-delay', '#fx-dur', '#fx-stagger']) $(id).addEventListener('change', applyFx);
  for (const id of ['#fx-delay', '#fx-dur', '#fx-stagger']) $(id).addEventListener('keydown', e => e.stopPropagation());
  $('#fx-preview').addEventListener('click', previewFx);
  $('#fx-doc-btn').addEventListener('click', fxDocAction);
  $('#fx-play-slide').addEventListener('click', previewSlideFx);
  $('#sb-trust').addEventListener('click', () => {
    if (S.mountedTrust) setTrust(false);
    else if (confirm(t('trust_confirm'))) setTrust(true);
  });
  $('#ls-range').addEventListener('input', e => { $('#ls-out').textContent = e.target.value; if (S.sel) styleEdit(S.sel, { 'letter-spacing': (e.target.value / 1000) + 'em' }, 'ls'); });
  $('#lh-range').addEventListener('input', e => { $('#lh-out').textContent = e.target.value; if (S.sel) styleEdit(S.sel, { 'line-height': e.target.value }, 'lh'); });
  $('#op-range').addEventListener('input', e => { $('#op-out').textContent = e.target.value; if (S.sel) styleEdit(S.sel, { opacity: String(e.target.value / 100) }, 'op'); });

  $$('[data-h]', el.box).forEach(h => h.addEventListener('pointerdown', e => startDrag(h.dataset.h, e)));
  $('[data-h="move"]', el.pill).addEventListener('pointerdown', e => startDrag('move', e));
  $('#pill-dup').addEventListener('click', duplicateSel);
  $('#pill-del').addEventListener('click', deleteSel);
  $('#pill-more').addEventListener('click', () => {
    const open = el.menu.hidden;
    closePopups();
    if (!open) return;
    $$('.img-menu', el.menu).forEach(b => { b.hidden = !selectedImg(); });
    el.menu.hidden = false;
    placeMenu();
  });
  $('#m-up').addEventListener('click', () => { el.menu.hidden = true; nudgeOrder(-1); });
  $('#m-down').addEventListener('click', () => { el.menu.hidden = true; nudgeOrder(1); });
  $('#m-copy-style').addEventListener('click', () => { el.menu.hidden = true; copyStyle(); });
  $('#m-paste-style').addEventListener('click', () => { el.menu.hidden = true; pasteStyle(); });
  $('#m-clear').addEventListener('click', () => { el.menu.hidden = true; clearStyle(); });

  $('#zoom').addEventListener('input', e => setZoom(+e.target.value));
  $('#zoom-pct').addEventListener('click', fitZoom);
  $('#sb-fit').addEventListener('click', fitZoom);
  $('#sb-prev').addEventListener('click', () => showSlide(S.cur - 1));
  $('#sb-next').addEventListener('click', () => showSlide(S.cur + 1));
  $('#sb-mode').addEventListener('change', async e => {
    const prev = S.forceMode;
    S.forceMode = e.target.value === 'auto' ? null : e.target.value;
    if (!(await rerender())) { S.forceMode = prev; e.target.value = prev || 'auto'; }
    else storeMode(S.source, S.forceMode);
  });
  $('#pill-note').addEventListener('click', () => openNotePop());
  $('#tb-link').addEventListener('click', openLinkPop);
  $('#tb-img-replace').addEventListener('click', openImagePop);
  $('#tb-img-crop').addEventListener('click', enterCrop);
  $('#crop-cover').addEventListener('click', () => setFit('cover'));
  $('#crop-contain').addEventListener('click', () => setFit('contain'));
  $('#crop-done').addEventListener('click', exitCrop);
  el.box.addEventListener('pointerdown', e => { if (S.crop && !e.target.closest('.hd')) startCropDrag(e); });
  $('#tb-box').addEventListener('click', () => openPanel('box', true));
  bindBoxPanel();
  $('#alt-apply').addEventListener('click', applyAlt);
  $('#alt-cancel').addEventListener('click', () => { $('#pop-alt').hidden = true; });
  $('#alt-input').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); applyAlt(); } if (e.key === 'Escape') $('#pop-alt').hidden = true; });
  $('#img-upload').addEventListener('click', () => { $('#pop-img').hidden = true; $('#img-input').click(); });
  $('#img-input').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) replaceWithFile(selectedImg(), f); });
  $('#img-url-apply').addEventListener('click', () => {
    const v = normalizeImageURL($('#img-url').value);
    if (v === null) return toast('Invalid image link', { err: true });
    if (v) { $('#pop-img').hidden = true; replaceImage(selectedImg(), v); }
  });
  $('#img-url').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') $('#img-url-apply').click(); });
  $('#pill-parent').addEventListener('click', selectParent);
  $('#m-alt').addEventListener('click', () => { el.menu.hidden = true; openAltPop(); });
  $('#m-flip').addEventListener('click', () => { el.menu.hidden = true; flipImage(); });
  $('#m-img-reset').addEventListener('click', () => { el.menu.hidden = true; resetImage(); });
  $('#link-apply').addEventListener('click', applyLink);
  $('#link-remove').addEventListener('click', removeLink);
  $('#link-cancel').addEventListener('click', () => { $('#pop-link').hidden = true; });
  $('#link-url').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') $('#pop-link').hidden = true; });
  const tree = $('#layer-tree');
  bindLayerDrag();
  tree.addEventListener('click', e => {
    const row = e.target.closest('.layer-row');
    if (!row || Date.now() - (S.layerDragEnded || 0) < 250) return;
    const id = row.dataset.id;
    if (e.target.closest('.tg')) {
      S.layerOpen.has(id) ? S.layerOpen.delete(id) : S.layerOpen.add(id);
      buildLayers();
      return;
    }
    const node = layerNode(row);
    if (!node) return;
    if (S.mode === 'page') node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    select(node, { edit: false });
  });
  tree.addEventListener('mouseover', e => showHoverBox(layerNode(e.target.closest('.layer-row'))));
  tree.addEventListener('mouseleave', () => showHoverBox(null));
  $('#note-save').addEventListener('click', addNoteFromPop);
  $('#fb-copy').addEventListener('click', copyFeedbackRequest);
  $('#fb-slide').addEventListener('click', () => openNotePop(S.mode === 'deck' ? S.slides[S.cur] : S.sections[S.cur]));
  $('#multi-note').addEventListener('click', feedbackMulti);
  $('#multi-del').addEventListener('click', deleteMulti);
  $('#fb-filter').addEventListener('click', e => {
    const f = e.target.closest('[data-f]')?.dataset.f;
    if (!f || f === S.noteFilter) return;
    S.noteFilter = f;
    renderNoteList();
    renderPins();
  });
  $('#note-cancel').addEventListener('click', () => { $('#pop-note').hidden = true; });
  $('#note-input').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNoteFromPop(); if (e.key === 'Escape') $('#pop-note').hidden = true; });
  $('#sb-width').addEventListener('change', e => {
    try { localStorage.setItem(PAGE_W_KEY, e.target.value); } catch {}
    applyPageWidth(e.target.value);
  });
  let savedW = '1600';
  try { savedW = localStorage.getItem(PAGE_W_KEY) || '1600'; } catch {}
  if (![...$('#sb-width').options].some(o => o.value === savedW)) savedW = '1600';
  $('#sb-width').value = savedW;
  applyPageWidth(savedW, true);
  $('#sb-notes').addEventListener('click', () => {
    el.notes.hidden = !el.notes.hidden;
    $('#sb-notes').classList.toggle('on', !el.notes.hidden);
    if (!el.notes.hidden) loadNotes();
    requestAnimationFrame(layout);
  });
  $('#notes-close').addEventListener('click', () => $('#sb-notes').click());
  el.notesText.addEventListener('input', () => { clearTimeout(S.notesTimer); S.notesTimer = setTimeout(() => { S.notesTimer = 0; saveNotes(); }, 400); });
  el.notesText.addEventListener('blur', flushPending);

  // Drag & drop a file anywhere to open it (keeps a writable handle where supported).
  let dragDepth = 0;
  const draggingImage = e => [...(e.dataTransfer?.items || [])].some(i => i.kind === 'file' && i.type.startsWith('image/'));
  window.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files') && !draggingImage(e)) { dragDepth++; $('#drop-veil').classList.add('show'); } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-veil').classList.remove('show'); } });
  window.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', async e => {
    dragDepth = 0;
    $('#drop-veil').classList.remove('show');
    const item = [...(e.dataTransfer?.items || [])].find(i => i.kind === 'file');
    if (!item) return;
    e.preventDefault();
    const handlePromise = item.getAsFileSystemHandle?.();
    const file = item.getAsFile();
    if (file && file.type.startsWith('image/')) return selectedImg() ? replaceWithFile(selectedImg(), file) : toast('Select an image on the page then drop the new image on it');
    if (!file || !/\.html?$/i.test(file.name)) return toast('Only .html / .htm files are supported', { err: true });
    if (!confirmDiscard()) return;
    const handle = handlePromise ? await handlePromise.catch(() => null) : null;
    if (handle && handle.kind === 'file') { setLoading(true); openFromHandle(handle).catch(err => { setLoading(false); toast(err.message, { err: true }); }); }
    else openUpload(file);
  });
}
