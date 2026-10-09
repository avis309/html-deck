// Edit ownership, text and SVG text commits.
import { $ } from '../core/utils.mjs';
import { EDITOR_ATTRS } from '../runtime/provenance.mjs';
import { S, el, formatFlags } from './state.mjs';
import { cleanFragment, isOriginal, isSvgText, markOriginals, modelEl, provenanceOf } from './live-document.mjs';
import { formatBlock, textEditBlock } from '../policy/edit-policy.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { placeCaretEnd } from './caret.mjs';
import { hooks } from '../shared/hooks.mjs';
import { saveNotes } from './speaker-notes.mjs';
import { lockedHint } from './guards.mjs';
import { pushOp } from './history.mjs';

// ================================================================ history
export function scheduleCommit() {
  clearTimeout(S.commitTimer);
  S.commitTimer = setTimeout(commitText, 700);
}
export function flushPending() {
  closeSvgText(true);
  if (S.notesTimer) { clearTimeout(S.notesTimer); S.notesTimer = 0; saveNotes(); }
  commitText();
}
// ---------------------------------------------------------------- edit session
// While a block is being typed into, its live subtree is copied back into the model on commit.
// A MutationObserver watches that subtree: changes the editor makes itself (typing, paste,
// formatting, links) are claimed synchronously through markTextDirty(); anything still
// reaching the observer was done by the page's own scripts, and the commit is refused.
export function startEditSession(node) {
  endEditSession();
  const mo = new S.win.MutationObserver(records => {
    if (!S.session || S.session.node !== node) return;
    if (records.some(isForeignRecord)) S.session.conflicted = true;
  });
  mo.observe(node, { subtree: true, childList: true, characterData: true, attributes: true });
  S.session = { node, mo, conflicted: false, typed: node.innerText };
}
// Attributes of the block itself are not saved by a text commit (only its children are), and
// the editor's own markers never count.
export function isForeignRecord(r) {
  if (r.type !== 'attributes') return true;
  return r.target !== S.session?.node && !EDITOR_ATTRS.has(r.attributeName);
}
export function endEditSession() {
  if (!S.session) return;
  S.session.mo.disconnect();
  S.session = null;
}
// Claim the pending records as the editor's own: only right after a synchronous editor change
// (or from the capture-phase input listener), when no page code has run in between.
export function markTextDirty() {
  S.textDirty = true;
  claimOwn();
}
export function claimOwn() {
  if (!S.session) return;
  S.session.mo.takeRecords();
  // Once the page has rewritten the block, its text is no longer what the user typed.
  if (!S.session.conflicted) S.session.typed = S.session.node.innerText;
}
export function noteForeign(records) {
  if (S.session && records.some(isForeignRecord)) S.session.conflicted = true;
}
// Give elements the user created while typing (bold, links, Enter) model ids before they are
// committed, so the block stays editable afterwards. A browser splitting a paragraph copies its
// attributes, data-ed-id included: a repeated id is reassigned too.
export function adoptNewElements(root) {
  // An id stays with the original element holding it, wherever a copy of it appears.
  const owner = new Map();
  for (const n of root.querySelectorAll('[data-ed-id]')) if (isOriginal(n)) owner.set(n.getAttribute('data-ed-id'), n);
  const seen = new Set();
  for (const n of root.querySelectorAll('*')) {
    const id = n.getAttribute('data-ed-id');
    const keep = id && id !== root.dataset.edId && (owner.has(id) ? owner.get(id) === n : !seen.has(id));
    if (!keep) n.setAttribute('data-ed-id', String(S.nextId++));
    seen.add(n.getAttribute('data-ed-id'));
  }
}
export function commitText() {
  clearTimeout(S.commitTimer);
  const node = S.sel;
  if (!node || !S.textDirty) return;
  S.textDirty = false;
  const id = node.dataset.edId, m = modelEl(id);
  if (!m) return;
  // Only an edit session started on this block may write it back (see startEditSession).
  const session = S.session?.node === node ? S.session : null;
  if (!session) return;
  noteForeign(session.mo.takeRecords());
  if (session.conflicted) {
    // The page rewrote this block while it was being edited: its subtree is no longer the
    // authored one, so nothing of it may reach the model. Put the authored content back and
    // offer what the user had typed (recorded at their last own input) for copying.
    const typed = session.typed;
    node.innerHTML = m.innerHTML;
    markOriginals(node, m);
    S.savedRange = null; S.lastWrap = null;
    placeCaretEnd(node);
    session.mo.takeRecords();
    session.conflicted = false;
    session.typed = node.innerText;
    toast(t('lock_conflict'), { ms: 9000, err: true, action: { label: t('lock_copy_typed'), fn: () => navigator.clipboard?.writeText(typed) } });
    hooks.updateChrome();
    return;
  }
  adoptNewElements(node);
  session.mo.takeRecords();
  const before = m.innerHTML, after = cleanFragment(node.innerHTML);
  if (before === after) { hooks.updateChrome(); return; }
  m.innerHTML = after;
  markOriginals(node, m);
  pushOp({ type: 'html', id, before, after, label: 'Edit text' });
  hooks.queueThumb(node);
}
// ---------------------------------------------------------------- SVG text
// contenteditable does nothing on SVG, so a marked <text>/<tspan> is typed into an input laid
// over it. The diagram follows each keystroke; the model is written once, on commit (Enter,
// leaving the field, selecting something else), as one 'html' op like any text edit.
export function openSvgText(node) {
  closeSvgText(true);
  if (!isSvgText(node) || node.children.length) return;
  const block = S.readOnly || textEditBlock(provenanceOf(node)) || formatBlock('text', formatFlags(node));
  if (block) { lockedHint(block, node); return; }
  const input = $('#svg-text'), cs = S.win.getComputedStyle(node);
  const ctm = node.getScreenCTM(), k = (ctm ? Math.hypot(ctm.a, ctm.b) : 1) * S.scale;
  // SVG collapses white space when it draws text, and a one-line field would drop line breaks
  // (gluing the words): show the words with single spaces and keep the outer white space.
  const original = node.textContent, [, lead, words, trail] = original.match(/^(\s*)([\s\S]*?)(\s*)$/);
  input.value = words.replace(/\s+/g, ' ');
  // `last` is what the editor itself put in the diagram: anything else got there by a script.
  S.svgEdit = { node, original, shown: input.value, lead, trail, last: original, rect: null };
  input.style.fontFamily = cs.fontFamily;
  input.style.fontWeight = cs.fontWeight;
  input.style.fontStyle = cs.fontStyle;
  input.style.fontSize = parseFloat(cs.fontSize) * k + 'px';
  input.style.letterSpacing = cs.letterSpacing === 'normal' ? 'normal' : parseFloat(cs.letterSpacing) * k + 'px';
  input.style.textTransform = cs.textTransform;
  const anchor = cs.textAnchor;
  input.style.textAlign = anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left';
  input.hidden = false;
  el.box.classList.add('editing');
  placeSvgText();
  // After the press that opened it: the frame would take the focus back on mousedown.
  setTimeout(() => { if (S.svgEdit?.node === node) { input.focus(); input.select(); } });
}
export function placeSvgText() {
  const ed = S.svgEdit;
  if (!ed) return;
  const input = $('#svg-text');
  const live = ed.node.getBoundingClientRect();
  // An emptied text has no box: keep the field where the text was.
  const r = ed.rect = live.width || !ed.rect ? live : ed.rect;
  const fr = el.frame.getBoundingClientRect(), st = el.stage.getBoundingClientRect(), s = S.scale;
  const x = fr.left - st.left + r.left * s, y = fr.top - st.top + r.top * s, w = r.width * s, h = r.height * s;
  const W = Math.max(w + 16, 60), H = Math.max(h + 6, 22);
  const align = input.style.textAlign;
  const left = align === 'center' ? x + w / 2 - W / 2 : align === 'right' ? x + w + 8 - W : x - 8;
  input.style.transform = `translate(${left}px, ${y + h / 2 - H / 2}px)`;
  input.style.width = W + 'px';
  input.style.height = H + 'px';
}
export function closeSvgText(commit) {
  const ed = S.svgEdit;
  if (!ed) return;
  S.svgEdit = null;
  const input = $('#svg-text'), value = input.value, { node } = ed;
  input.hidden = true;
  el.box.classList.remove('editing');
  // The page rewrote the text while it was being typed: its text is not the authored one any
  // more, so neither it nor the typed value may reach the model (as for HTML text, commitText).
  if (node.isConnected && node.textContent !== ed.last) { lockedHint('lock_runtime_changed', node); return; }
  const restore = () => { if (node.isConnected && node.textContent !== ed.original) node.textContent = ed.last = ed.original; };
  // An empty text could no longer be clicked: deleting it is the block's Delete.
  if (!commit || value === ed.shown || !value.trim() || !node.isConnected) { restore(); if (S.sel) hooks.positionOverlay(true); return; }
  const id = node.dataset.edId, m = modelEl(id);
  if (!m) { restore(); return; }
  node.textContent = ed.lead + value + ed.trail;
  const before = m.innerHTML, after = cleanFragment(node.innerHTML);
  if (before === after) return;
  m.innerHTML = after;
  pushOp({ type: 'html', id, before, after, label: 'Edit text' });
  hooks.queueThumb(node);
}
export function bindSvgText() {
  const input = $('#svg-text');
  input.addEventListener('input', () => {
    const ed = S.svgEdit;
    if (!ed) return;
    ed.node.textContent = ed.last = ed.lead + input.value + ed.trail;
    placeSvgText();
    if (S.sel === ed.node) hooks.positionOverlay(true);
  });
  input.addEventListener('keydown', e => {
    // Enter that ends an IME composition (Vietnamese, Chinese…) only accepts the composed text.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSvgText(e.key === 'Enter'); }
  });
  input.addEventListener('blur', () => closeSvgText(true));
}
