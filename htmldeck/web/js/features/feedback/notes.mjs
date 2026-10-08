// AI Feedback: anchors, loading, saving notes.
import { $, clamp } from '../../core/utils.mjs';
import { S, el } from '../../editor/state.mjs';
import { alignTokens, tokenize } from '../../core/serializer.mjs';
import { api, postJSON } from '../../services/api.mjs';
import { liveEl, modelEl } from '../../editor/live-document.mjs';
import { REGION_MAX, regionHit, regionRect } from '../../editor/multi-selection.mjs';
import { clearMulti, setEditing } from '../../editor/selection.mjs';
import { stripItems } from '../../editor/slide-info.mjs';
import { t } from '../../shared/lang.mjs';
import { toast } from '../../shared/toast.mjs';
import { hooks } from '../../shared/hooks.mjs';

// ================================================================ review notes for agents
// Notes are anchored by a CSS path computed on the model (= the file's own structure), plus
// the source line and a text snippet, so an agent can find the spot without the editor.
// Anchors are computed on `S.pristine` — the structure of the file as it is on disk — so an
// unsaved insert cannot shift `nth-of-type` and the agent reads the same structure.
export function cssPath(m) {
  const parts = [], doc = m.ownerDocument;
  for (let n = m; n && n.localName !== 'html' && n.localName !== 'body'; n = n.parentElement) {
    if (n.id && doc.querySelectorAll('#' + CSS.escape(n.id)).length === 1) { parts.unshift('#' + CSS.escape(n.id)); break; }
    const same = [...n.parentElement.children].filter(c => c.localName === n.localName);
    parts.unshift(same.length > 1 ? `${n.localName}:nth-of-type(${same.indexOf(n) + 1})` : n.localName);
  }
  return parts.join(' > ') || m.localName;   // body: a region drawn on a page without sections
}
export function sourceLine(id) {
  if (S.lineMapText !== S.sourceText) { S.lineMap = alignTokens(tokenize(S.sourceText), S.pristine); S.lineMapText = S.sourceText; }
  const tok = S.lineMap?.get(id);
  if (!tok) return null;
  let line = 1;
  for (let i = S.sourceText.indexOf('\n'); i >= 0 && i < tok.start; i = S.sourceText.indexOf('\n', i + 1)) line++;
  return line;
}
export function snippetOf(node) { return (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160); }
export function noteTargetId(note) {
  let p = null;
  try { p = note.selector ? S.pristine.querySelector(note.selector) : null; } catch { p = null; }
  const snip = (note.text || '').slice(0, 30);
  if (p && snip && !snippetOf(p).includes(snip)) p = null;
  if (!p && snip) {
    // Several elements may carry the snippet: pick the innermost one nearest the pinned line.
    const cands = [...S.pristine.body.querySelectorAll('*')].filter(n => snippetOf(n).includes(snip) && ![...n.children].some(c => snippetOf(c).includes(snip)));
    p = cands.sort((a, b) => Math.abs((sourceLine(a.getAttribute('data-ed-id')) || 0) - (note.line || 0)) - Math.abs((sourceLine(b.getAttribute('data-ed-id')) || 0) - (note.line || 0)))[0] || null;
  }
  return p ? p.getAttribute('data-ed-id') : null;
}
export function noteTarget(note) {
  const id = noteTargetId(note);
  return id && modelEl(id) ? liveEl(id) : null;
}
// The notes, their pins and the agent command all belong to one document: drop them together.
export function clearFeedback() {
  hooks.flushRemoval();
  S.agentNotes = [];
  hooks.renderNoteList();
  hooks.renderPins();
}
export async function loadAgentNotes() {
  clearFeedback();   // never the previous document's notes or command, even if this load fails
  const token = S.loadToken, src = S.source;
  if (src?.kind === 'server') {
    try {
      const res = await api(`/api/notes?path=${encodeURIComponent(src.path)}`);
      if (token !== S.loadToken) return;
      S.agentNotes = res.notes || [];
    } catch (e) { if (token === S.loadToken) toast('Cannot read feedback: ' + e.message, { err: true }); }
  }
  hooks.renderNoteList();
  hooks.renderPins();
}
// The sidecar changed on disk (an agent marked notes done): show the list again, leaving a note
// being written, and one being removed (its request answers with the list), as they are.
export async function refreshAgentNotes() {
  const token = S.loadToken, src = S.source;
  if (src?.kind !== 'server' || S.removing) return;
  try {
    const res = await api(`/api/notes?path=${encodeURIComponent(src.path)}`);
    if (token !== S.loadToken || S.removing) return;
    S.agentNotes = res.notes || [];
  } catch { return; }
  hooks.renderNoteList();
  hooks.renderPins();
}
// Send operations, not the whole list: the server merges them into the sidecar as it is on
// disk, so an agent's `--done` made meanwhile is never overwritten by this stale copy.
// Resolves true once the server has written the sidecar, false when it has not, and null when
// another document was opened meanwhile (the result is then about a document no longer shown).
export async function noteOps(ops) {
  const src = S.source, token = S.loadToken;
  if (src?.kind !== 'server') { needWorkspaceFile(); return false; }
  let ok = false;
  try {
    const res = await postJSON('/api/notes', { path: src.path, ops });
    if (token !== S.loadToken) return null;
    S.agentNotes = res.notes || [];
    ok = true;
  } catch (e) {
    if (token !== S.loadToken) return null;
    toast('Cannot save feedback: ' + e.message, { err: true, ms: 5000 });
  }
  hooks.renderNoteList();
  hooks.renderPins();
  return ok;
}
// Feedback is kept beside the file on disk, which only a document opened from the workspace
// has: one opened from the computer or dropped in is text without a place. Say so, and lead
// to the workspace list (filtered to this file's name) instead of a button that does nothing.
export function needWorkspaceFile() {
  toast(t('note_workspace_only'), { err: true, ms: 7000, action: { label: t('fb_show_files'), fn: () => {
    hooks.openPanel('files', true);
    $('#file-search').value = S.source?.name || '';
    hooks.renderFileList();
  } } });
}
// Before a save: which element each note (and each element of a region note) points at, keyed
// by note id, since the list may be reloaded while the request is in flight.
export function noteAnchorIds() {
  return new Map((S.agentNotes || []).map(n => [n.id, { owner: noteTargetId(n), targets: n.kind === 'region' ? n.targets.map(noteTargetId) : null }]));
}
// After a save the file structure changed: re-anchor notes to the new structure. A region keeps
// the elements it was drawn over (never re-collected by geometry); one that is gone stays as it
// was, so the agent still gets its last known place.
export function reanchorNotes(before) {
  const anchor = id => {
    const p = id && S.pristine.querySelector(`[data-ed-id="${id}"]`);
    return p ? { selector: cssPath(p), line: sourceLine(id) } : null;
  };
  const ops = [];
  for (const n of S.agentNotes || []) {
    const b = before.get(n.id);
    if (!b) continue;
    const patch = {}, a = anchor(b.owner);
    if (a && (a.selector !== n.selector || a.line !== n.line)) Object.assign(patch, a);
    if (b.targets && b.targets.length === n.targets?.length) {
      const targets = n.targets.map((t, k) => ({ ...t, ...anchor(b.targets[k]) }));
      if (targets.some((t, k) => t.selector !== n.targets[k].selector || t.line !== n.targets[k].line)) patch.targets = targets;
    }
    if (Object.keys(patch).length) ops.push({ op: 'update', id: n.id, patch });
  }
  if (ops.length) noteOps(ops);
}
// target: the selected block, or a whole slide / report section pinned from the panel.
// region: { region, canvas, targets } of an area on `target` (see feedbackMulti).
export function openNotePop(target = S.sel, region = null) {
  if (!S.model) return toast('Please open a document first');
  if (S.source?.kind !== 'server') return needWorkspaceFile();
  if (!target) return toast('Select a block before writing feedback');
  if (noteSaving?.token === S.loadToken) return;   // the open popup is still sending its note
  $('#note-save').disabled = false;
  $('#note-input').readOnly = false;
  if (S.editing) setEditing(false);
  const pop = $('#pop-note');
  hooks.closePopups();
  S.noteTarget = target;
  S.noteRegion = region && { owner: target, ...region };
  const whole = !region && (target === S.slides[S.cur] || S.sections.includes(target));
  $('#note-target').textContent = region ? regionLabel(target, region.targets) : whole ? `${stripLabel(target)} · ${t('fb_whole_slide')}` : `“${snippetOf(target).slice(0, 70)}”`;
  $('#note-input').value = '';
  // Beside the target when there is room, so the block being described stays visible.
  const r = region ? regionRect(target, region.region) : target.getBoundingClientRect(), fr = el.frame.getBoundingClientRect(), st = el.stage.getBoundingClientRect();
  const L = fr.left - st.left + r.left * S.scale, R = fr.left - st.left + r.right * S.scale;
  const T = fr.top - st.top + r.top * S.scale, B = fr.top - st.top + r.bottom * S.scale;
  const W = Math.min(330, st.width - 16), H = 210;
  pop.style.width = W + 'px';
  let x, y;
  if (whole) { x = st.width - W - 16; y = 70; }
  else if (R + 12 + W <= st.width) { x = R + 12; y = T; }
  else if (L - 12 - W >= 0) { x = L - 12 - W; y = T; }
  else { x = L; y = B + 12 <= st.height - H ? B + 12 : T - H - 12; }
  pop.style.left = clamp(x, 8, Math.max(8, st.width - W - 8)) + 'px';
  pop.style.top = clamp(y, 60, Math.max(60, st.height - H)) + 'px';
  pop.hidden = false;
  setTimeout(() => $('#note-input').focus(), 20);
}
export function stripLabel(node) {
  const i = stripItems().indexOf(node);
  if (i < 0) return '';
  return S.mode === 'deck' ? `Slide ${i + 1}` : `${t('fb_section')} ${i + 1}`;
}
// "Slide 2 · region · 3 elements: “Growth”, <img>"
export function regionLabel(owner, targets) {
  const what = targets.length ? t('fb_region_items').replace('{n}', targets.length) + ': ' + targets.slice(0, 3).map(x => x.text ? `“${x.text.slice(0, 24)}”` : `<${x.tag}>`).join(', ') : t('fb_region_empty');
  return [stripLabel(owner), t('fb_region_tag'), what].filter(Boolean).join(' · ');
}
// The note being sent, tied to the document it belongs to: a slow request for a document
// already closed never blocks feedback on the one opened since.
export let noteSaving = null;
export async function addNoteFromPop() {
  const text = $('#note-input').value.trim(), target = S.noteTarget;
  if (noteSaving?.token === S.loadToken || !text || !target || !target.isConnected) return;
  const id = target.dataset.edId, p = S.pristine.querySelector(`[data-ed-id="${id}"]`);
  if (!p) return toast('This block is not in the file yet — save first, then write feedback', { err: true, ms: 4000 });
  const slide = S.slides.indexOf(target.closest('[data-ed-slide]'));
  const reg = S.noteRegion?.owner === target ? S.noteRegion : null;
  // The popup and its text stay until the server has the note: a failed save loses nothing.
  // Read-only meanwhile, so what is saved is what the popup shows.
  const mine = noteSaving = { token: S.loadToken };
  $('#note-save').disabled = true;
  $('#note-input').readOnly = true;
  const ok = await noteOps([{ op: 'add', note: {
    id: Math.random().toString(36).slice(2, 10), note: text, status: 'open', created: new Date().toISOString(),
    selector: cssPath(p), tag: p.localName, text: snippetOf(p), line: sourceLine(id), slide: slide >= 0 ? slide : null,
    ...(reg && { kind: 'region', region: reg.region, canvas: reg.canvas, targets: reg.targets }),
  } }]).finally(() => {
    if (noteSaving !== mine) return;   // another document took over the popup meanwhile
    noteSaving = null;
    $('#note-save').disabled = false;
    $('#note-input').readOnly = false;
  });
  if (!ok) return;
  if (S.noteTarget === target) { $('#pop-note').hidden = true; S.noteRegion = null; }
  toast('Feedback saved');
}

// One region note for the group: the area swept, or the blocks' bounding box when the group
// was built with Shift+click. Unsaved inserts are not in the file yet and are left out.
export function feedbackMulti() {
  const g = S.multi;
  if (!g) return;
  if (S.source?.kind !== 'server') return needWorkspaceFile();   // keep the selection
  let hit = g.hit;
  if (!hit) {
    const rs = g.nodes.map(n => n.getBoundingClientRect());
    const left = Math.min(...rs.map(r => r.left)), top = Math.min(...rs.map(r => r.top));
    hit = regionHit(new DOMRect(left, top, Math.max(...rs.map(r => r.right)) - left, Math.max(...rs.map(r => r.bottom)) - top));
    if (!hit) return;
  }
  const saved = n => S.pristine.querySelector(`[data-ed-id="${n.dataset.edId}"]`);
  const targets = g.nodes.filter(saved).slice(0, REGION_MAX).map(n => {
    const id = n.dataset.edId, p = saved(n);
    return { selector: cssPath(p), tag: p.localName, text: snippetOf(p), line: sourceLine(id) };
  });
  clearMulti();
  openNotePop(hit.owner, { region: hit.region, canvas: hit.canvas, targets });
}
