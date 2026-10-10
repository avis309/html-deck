// Download and export (single HTML file, PDF).
import * as Reveal from '../formats/reveal.mjs';
import { $, fmtSize } from '../core/utils.mjs';
import { S } from '../editor/state.mjs';
import { contentForSave } from '../editor/live-document.mjs';
import { download } from './save.mjs';
import { flushPending } from '../editor/edits.mjs';
import { postJSON } from './api.mjs';
import { renderPrintHTML } from '../present/print.mjs';
import { toast } from '../shared/toast.mjs';

// ---------------------------------------------------------------- export
export function openExportMenu() {
  const pop = $('#pop-export');
  $('#export-history').hidden = S.source?.kind !== 'server';
  if (pop.classList.toggle('show')) {
    const r = $('#btn-export').getBoundingClientRect();
    pop.style.left = Math.max(8, r.right - pop.offsetWidth) + 'px';
    pop.style.top = r.bottom + 8 + 'px';
  }
}
// One self-contained file: the server embeds what the document loads (it knows the folder the
// relative paths start from), from the editor's current text, unsaved edits included.
export async function exportSingleFile() {
  if (!S.model) return;
  flushPending();
  // A file dropped in (not from the workspace): nothing tells which folder its links start
  // from, so it downloads as edited.
  if (S.source?.kind !== 'server') return download(contentForSave().content, S.source.name);
  const remote = $('#export-remote').checked;
  toast(remote ? 'Preparing the file (downloading web files)…' : 'Preparing the file…', { ms: 20000 });
  try {
    const res = await postJSON('/api/export', { path: S.source.path, content: contentForSave().content, remote });
    download(res.html, S.source.name);
    const left = res.missing.length + res.remote.length;
    const files = n => `${n} file${n === 1 ? '' : 's'}`;
    toast(`Downloaded · ${fmtSize(new Blob([res.html]).size)} · ${files(res.embedded)} embedded` + (left ? ` · ${files(left)} kept as link${left === 1 ? '' : 's'}` : ''), { ms: 6000 });
    if (left) console.warn('HtmlDeck export: kept as links', { missing: res.missing, remote: res.remote });
  } catch (e) { toast('Export failed: ' + e.message, { err: true, ms: 6000 }); }
}
// PDF: the browser's own print to PDF, of a print copy of the document (a deck: one page per slide;
// no motion). Opened in its own tab, which is asked for inside the click: pop-up blockers only
// let a user gesture open one.
export async function exportPDF() {
  if (!S.model) return;
  flushPending();
  const mode = S.mode === 'deck' && S.slides.length ? 'deck' : 'page';
  const reveal = S.format?.format === 'reveal';
  let html;
  try {
    html = renderPrintHTML(S.model, S.doctype, {
      mode, slideIds: mode === 'deck' ? S.slides.map(s => s.dataset.edId) : [], displays: mode === 'deck' ? S.slides.map(s => s.dataset.edDisplay) : [],
      deckW: S.deckW, deckH: S.deckH, title: S.source.name.replace(/\.html?$/i, ''),
      extraCSS: reveal && mode === 'deck' ? Reveal.editCSS() + Reveal.backgroundCSS(Reveal.leaves(S.model), '[data-ed-slide]') : '',
      bodyClass: reveal && mode === 'deck' ? 'reveal-viewport' : '',
    });
  } catch (e) { toast('Export failed: ' + e.message, { err: true }); return; }
  const w = window.open('', '_blank');
  if (!w) return toast('The browser blocked the print tab. Allow pop-ups for this page and try again.', { err: true, ms: 6000 });
  w.document.write('<!doctype html><meta charset="utf-8"><title>PDF</title><p style="font:15px system-ui;padding:32px;color:#555">Preparing the PDF…</p>');
  try {
    // The print copy has no scripts at all (renderPrintHTML removes them): none may run.
    const res = await postJSON('/api/preview', { path: S.source.kind === 'server' ? S.source.path : null, content: html, no_scripts: true });
    w.location.replace(res.url);
    const t0 = Date.now();
    await new Promise(done => (function wait() {
      let ready = false;
      try { ready = w.location.pathname === new URL(res.url, location.href).pathname && w.document.readyState === 'complete'; } catch { ready = false; }
      if (ready || w.closed || Date.now() - t0 > 30000) return done();
      setTimeout(wait, 100);
    })());
    if (w.closed) return;
    await w.document.fonts?.ready;
    await Promise.all([...w.document.images].map(i => i.decode?.().catch(() => {})));
    w.addEventListener('afterprint', () => w.close());
    w.focus();
    w.print();
  } catch (e) { w.close(); toast('Export failed: ' + e.message, { err: true, ms: 6000 }); }
}
