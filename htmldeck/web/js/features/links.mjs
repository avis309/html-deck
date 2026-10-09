// Links and attribute edits.
import { $, $$, clamp } from '../core/utils.mjs';
import { S, el } from '../editor/state.mjs';
import { commitText, markTextDirty } from '../editor/edits.mjs';
import { focusSel } from './formatting.mjs';
import { isOriginal } from '../editor/live-document.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { attrsEdit } from '../editor/commands.mjs';
import { hooks } from '../shared/hooks.mjs';

// ================================================================ links
export function activeRange() {
  if (!S.editing || !S.sel) return null;
  const sel = S.win.getSelection();
  const r = sel.rangeCount ? sel.getRangeAt(0) : null;
  if (r && S.sel.contains(r.commonAncestorContainer)) return r;
  return S.savedRange && S.sel.contains(S.savedRange.commonAncestorContainer) ? S.savedRange : null;
}
// Where a link edit applies: a link inside the text being edited (html change), a link that
// is the selected block itself or wraps it (attribute change), or a new link on the selection.
export function linkContext() {
  const node = S.sel;
  if (!node) return null;
  const outer = node.localName === 'a' ? node : node.parentElement?.closest('a');
  if (outer && isOriginal(outer)) return { kind: 'attr', a: outer };
  const r = activeRange();
  if (r) {
    let n = r.commonAncestorContainer;
    if (n.nodeType === 3) n = n.parentElement;
    const inner = n.closest('a');
    if (inner && node.contains(inner)) return { kind: 'inner', a: inner };
    if (!r.collapsed) return { kind: 'new', range: r.cloneRange() };
  }
  return null;
}
export function normalizeURL(raw) {
  // URL parsers drop ASCII tab/newline anywhere and control chars/spaces at the start, so
  // `java\tscript:` is still javascript:. Strip them before checking the scheme.
  const v = raw.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+/, '').trim();
  if (!v) return '';
  if (/^(javascript|vbscript|data):/i.test(v.replace(/[\u0000-\u001f\u007f-\u009f\s]/g, ''))) return null;
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(v)) return v;
  if (/^[^\s/@]+@[^\s/@]+\.[a-z]{2,}$/i.test(v)) return 'mailto:' + v;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return 'https://' + v;
  return v;
}
export function openLinkPop() {
  if (!S.sel) return toast('Select text first');
  const ctx = linkContext();
  if (!ctx) return toast(S.editing ? 'Highlight the text to link' : 'Click text and highlight the part to link');
  S.linkCtx = ctx;
  hooks.closePopups();
  const a = ctx.a;
  $('#link-url').value = a ? a.getAttribute('href') || '' : '';
  $('#link-blank').checked = a ? a.getAttribute('target') === '_blank' : false;
  $('#link-mode').textContent = ctx.kind === 'new' ? t('link_mode_new') : t('link_mode_existing');
  $('#link-remove').hidden = ctx.kind === 'new';
  const b = $('#tb-link').getBoundingClientRect(), st = el.stage.getBoundingClientRect();
  const pop = $('#pop-link');
  pop.style.left = clamp(b.left - st.left + b.width / 2 - 170, 8, st.width - 350) + 'px';
  pop.hidden = false;
  setTimeout(() => { $('#link-url').focus(); $('#link-url').select(); }, 20);
}
export function setLinkAttrs(a, href, blank) {
  a.setAttribute('href', href);
  if (blank) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
  else if (a.getAttribute('target') === '_blank') { a.removeAttribute('target'); if (a.getAttribute('rel') === 'noopener noreferrer') a.removeAttribute('rel'); }
}
export function applyLink() {
  const ctx = S.linkCtx;
  const href = normalizeURL($('#link-url').value), blank = $('#link-blank').checked;
  if (href === null) return toast('javascript: and data: links are not allowed', { err: true });
  if (!href) { if (ctx && ctx.kind !== 'new') removeLink(); else toast('Please enter a link URL'); return; }
  $('#pop-link').hidden = true;
  if (!ctx || !S.sel) return;
  if (ctx.kind === 'attr') {
    commitText();
    const a = ctx.a, changes = { href };
    if (blank) Object.assign(changes, { target: '_blank', rel: 'noopener noreferrer' });
    else if (a.getAttribute('target') === '_blank') Object.assign(changes, { target: null, rel: a.getAttribute('rel') === 'noopener noreferrer' ? null : a.getAttribute('rel') });
    attrsEdit(a, changes, 'Link');
  } else if (ctx.kind === 'inner') {
    setLinkAttrs(ctx.a, href, blank);
    markTextDirty();
    commitText();
  } else {
    focusSel();
    const sel = S.win.getSelection();
    sel.removeAllRanges();
    sel.addRange(ctx.range);
    const a = S.doc.createElement('a');
    setLinkAttrs(a, href, blank);
    a.appendChild(ctx.range.extractContents());
    ctx.range.insertNode(a);
    for (const nested of $$('a', a)) nested.replaceWith(...nested.childNodes);
    const nr = S.doc.createRange();
    nr.selectNodeContents(a);
    sel.removeAllRanges();
    sel.addRange(nr);
    S.savedRange = nr.cloneRange();
    markTextDirty();
    commitText();
  }
  hooks.queueThumb(S.sel);
  toast('Link attached');
}
export function removeLink() {
  const ctx = S.linkCtx;
  $('#pop-link').hidden = true;
  if (!ctx || ctx.kind === 'new' || !ctx.a.isConnected) return;
  if (ctx.kind === 'attr') {
    // The link is a whole block: keep the element (and its layout), drop what makes it a link.
    commitText();
    attrsEdit(ctx.a, { href: null, target: null, rel: null }, 'Remove link');
    toast('Link removed');
    return;
  }
  ctx.a.replaceWith(...ctx.a.childNodes);
  markTextDirty();
  commitText();
  hooks.queueThumb(S.sel);
  toast('Link removed');
}
