// AI Feedback: pins, note list, removal, copy request.
import { $, $$ } from '../core/utils.mjs';
import { S, el } from '../editor/state.mjs';
import { agentCmdLines, noteOps, noteTarget } from '../features/feedback/notes.mjs';
import { api } from '../services/api.mjs';
import { deselect, select, showSlide } from '../editor/selection.mjs';
import { positionRegion, regionRect } from '../editor/multi-selection.mjs';
import { stripItems } from '../editor/slide-info.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { hooks } from '../shared/hooks.mjs';
import { showHoverBox } from './panels/layers.mjs';

// Hovering a note (pin or card) outlines what it is about: its block, or its region.
export function hoverNote(n, target) {
  const shown = target && (S.mode !== 'deck' || target.closest('[data-ed-slide]') === S.slides[S.cur]);
  if (n.kind === 'region') { S.hoverRegion = shown ? { owner: target, region: n.region } : null; return; }
  showHoverBox(shown ? target : null);
}
export function unhoverNote() { S.hoverRegion = null; showHoverBox(null); }
export function renderPins() {
  const box = $('#pins');
  box.innerHTML = '';
  S.pinEls = [];
  const perStrip = new Map();
  (S.agentNotes || []).forEach((n, i) => {
    const target = S.doc && noteTarget(n);
    if (target && n.status === 'open' && !isRemoving(n)) {
      const k = stripItems().findIndex(s => s === target || s.contains(target));
      if (k >= 0) perStrip.set(k, (perStrip.get(k) || 0) + 1);
    }
    if (!target || n.status !== (S.noteFilter || 'open') || isRemoving(n)) return;
    const pin = document.createElement('button');
    pin.className = 'pin' + (n.status === 'done' ? ' done' : '');
    pin.textContent = i + 1;
    pin.title = n.note;
    pin.addEventListener('click', () => focusNote(i));
    pin.addEventListener('mouseenter', () => hoverNote(n, target));
    pin.addEventListener('mouseleave', unhoverNote);
    box.appendChild(pin);
    S.pinEls.push({ pin, target, region: n.kind === 'region' ? n.region : null });
  });
  // Filmstrip: how many open notes each slide / section still has.
  [...el.filmstrip.children].forEach((b, k) => {
    let dot = b.querySelector('.note-dot');
    const c = perStrip.get(k) || 0;
    if (!c) { dot?.remove(); return; }
    if (!dot) { dot = document.createElement('span'); dot.className = 'note-dot'; b.appendChild(dot); }
    dot.textContent = c;
  });
  $('#note-count').hidden = !liveNotes().some(n => n.status === 'open');
  $('#note-count').textContent = liveNotes().filter(n => n.status === 'open').length;
  positionPins();
}
export function positionPins() {
  if (!S.pinEls?.length || !S.doc) return;
  const fr = el.frame.getBoundingClientRect(), st = el.stage.getBoundingClientRect(), sc = el.scroller.getBoundingClientRect();
  for (const { pin, target, region } of S.pinEls) {
    const r = !target.isConnected ? null : region ? regionRect(target, region) : target.getBoundingClientRect();
    const onSlide = S.mode !== 'deck' || target.closest('[data-ed-slide]') === S.slides[S.cur];
    if (!r || !r.width || !onSlide) { pin.style.display = 'none'; continue; }
    // A whole-slide / section note sits just inside its top-right corner, not off the page;
    // a region note sits on its region's corner, like a block note.
    const whole = !region && stripItems().includes(target);
    const x = fr.left - st.left + r.right * S.scale + (whole ? -34 : 8), y = fr.top - st.top + Math.max(r.top, 0) * S.scale + (whole ? 10 : -26);
    const visible = y > sc.top - st.top - 10 && y < sc.bottom - st.top;
    pin.style.display = visible ? '' : 'none';
    pin.style.transform = `translate(${x}px, ${y}px)`;
  }
}
export function pinLoop() { positionPins(); positionRegion(); requestAnimationFrame(pinLoop); }
export function focusNote(i) {
  const n = S.agentNotes[i], target = n && noteTarget(n);
  if (!el.panel.classList.contains('open') || el.panel.dataset.view !== 'review') hooks.openPanel('review');
  $$('.note-card').forEach(c => c.classList.toggle('hot', +c.dataset.i === i));
  $(`.note-card[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  if (!target) return toast('Target element for this feedback no longer found');
  const slideIdx = S.slides.indexOf(target.closest('[data-ed-slide]'));
  if (slideIdx >= 0 && slideIdx !== S.cur) showSlide(slideIdx);
  if (n.kind === 'region') {
    // Nothing to select: bring the region into view and outline it for a moment.
    deselect();
    if (S.mode === 'page') { const r = regionRect(target, n.region); S.win.scrollBy({ top: r.top + r.height / 2 - S.win.innerHeight / 2, behavior: 'smooth' }); }
    const hot = S.hoverRegion = { owner: target, region: n.region };
    setTimeout(() => { if (S.hoverRegion === hot) S.hoverRegion = null; }, 1800);
    return;
  }
  if (S.mode === 'page') target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => select(target, { edit: false }), S.mode === 'page' ? 300 : 0);
}
export function renderNoteList() {
  const box = $('#note-list');
  const notes = liveNotes(), filter = S.noteFilter || 'open';
  const open = notes.filter(n => n.status === 'open').length;
  const fb = $('#fb-filter');
  fb.children[0].textContent = t('fb_open').replace('{n}', open);
  fb.children[1].textContent = t('fb_done').replace('{n}', notes.filter(n => n.status === 'done').length);
  [...fb.children].forEach(b => b.classList.toggle('on', b.dataset.f === filter));
  const server = S.source?.kind === 'server';
  $('#fb-copy').disabled = !server || !open;
  const whole = S.mode === 'deck' ? S.slides[S.cur] : S.sections[S.cur];
  $('#fb-slide').hidden = !server || !whole;
  $('#fb-slide-label').textContent = t(S.mode === 'deck' ? 'fb_slide' : 'fb_page');
  if (!notes.length) { box.innerHTML = `<div class="hint">${t('no_notes_yet')}</div>`; return; }
  const shown = (S.agentNotes || []).map((n, i) => [n, i]).filter(([n]) => n.status === filter && !isRemoving(n));
  if (!shown.length) { box.innerHTML = `<div class="hint">${t(filter === 'open' ? 'fb_none_open' : 'fb_none_done')}</div>`; return; }
  box.innerHTML = '';
  for (const [n, i] of shown) {
    const c = document.createElement('div');
    c.className = 'note-card' + (n.status === 'done' ? ' done' : '');
    c.dataset.i = i;
    // Remove sits apart in the corner (the one destructive action); done and edit act on the
    // content, in their own row. All stay visible: touch screens have no hover.
    const doneLabel = n.status === 'done' ? t('note_reopen') : t('note_resolve');
    c.innerHTML = `<div class="nc-head"><span class="nc-num">${i + 1}</span><span class="nc-where"></span>${n.status === 'done'
      ? `<button class="nc-reopen" data-a="toggle" title="${doneLabel}" aria-label="${doneLabel}"><svg class="icon sm"><use href="#i-undo"/></svg></button>`
      : `<button class="nc-check" data-a="toggle" title="${doneLabel}" aria-label="${doneLabel}"><span class="ring"><svg class="icon"><use href="#i-check"/></svg></span></button>`}<button class="nc-x" data-a="del" title="${t('note_del')}" aria-label="${t('note_del')}"><svg class="icon sm"><use href="#i-x"/></svg></button></div><div class="nc-snip nc-quote"></div><div class="nc-text" data-a="edit" title="${t('fb_edit_hint')}"></div>`;
    const target = S.doc && noteTarget(n);
    const where = target ? stripItems().findIndex(s => s === target || s.contains(target)) : -1;
    const region = n.kind === 'region';
    const whole = !region && target && stripItems()[where] === target;
    c.querySelector('.nc-where').textContent = (where >= 0 ? (S.mode === 'deck' ? `Slide ${where + 1}` : `${t('fb_section')} ${where + 1}`) + (whole ? ' · ' + t('fb_whole_slide') : '')
      : n.slide != null ? `Slide ${n.slide + 1}` : '') + (region ? (where >= 0 || n.slide != null ? ' · ' : '') + t('fb_region_tag') : '');
    // Line and tag are for agents; keep them out of sight but available on hover.
    c.querySelector('.nc-where').title = [n.line ? `line ${n.line}` : '', n.tag ? `<${n.tag}>` : ''].filter(Boolean).join(' · ');
    c.querySelector('.nc-text').textContent = n.note;
    const q = c.querySelector('.nc-quote');
    if (region) q.textContent = n.targets.length ? n.targets.map(x => x.text ? `“${x.text.slice(0, 40)}”` : `<${x.tag}>`).join(', ') : t('fb_region_empty');
    else if (n.text && !whole) q.textContent = n.text; else q.remove();
    if (!target && S.doc) c.insertAdjacentHTML('beforeend', `<div class="nc-lost">${t('fb_lost')}</div>`);
    c.addEventListener('mouseenter', () => hoverNote(n, target));
    c.addEventListener('mouseleave', unhoverNote);
    c.addEventListener('click', e => {
      if (e.target.closest('.nc-edit')) return;
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'toggle') toggleNoteDone(c, n);
      else if (a === 'del') removeNote(n);
      else if (a === 'edit') editNoteCard(c, n);
      else focusNote(i);
    });
    box.appendChild(c);
  }
}
// Remove is applied 3 s later: until then the note is only hidden and Undo brings it back in
// place (same number). The request carries its own path, so switching documents meanwhile
// can never remove a note from the wrong file.
export const REMOVE_DELAY = 3000;
export const liveNotes = () => (S.agentNotes || []).filter(n => !isRemoving(n));
export const isRemoving = n => S.removing?.id === n.id;
export function removeNote(n) {
  if (S.source?.kind !== 'server') return;
  flushRemoval();
  const pending = { id: n.id, path: S.source.path };
  pending.timer = setTimeout(() => flushRemoval(), REMOVE_DELAY);
  S.removing = pending;
  renderNoteList();
  renderPins();
  toast(t('fb_removed'), { ms: REMOVE_DELAY, action: { label: t('fb_undo'), fn: () => {
    if (S.removing !== pending) return;
    clearTimeout(pending.timer);
    S.removing = null;
    renderNoteList();
    renderPins();
  } } });
}
export function flushRemoval() {
  const p = S.removing;
  if (!p) return;
  clearTimeout(p.timer);
  S.removing = null;
  // keepalive: the request still goes out when this runs from pagehide.
  api('/api/notes', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p.path, ops: [{ op: 'delete', id: p.id }] }) })
    .then(res => { if (S.source?.path === p.path) { S.agentNotes = res.notes || []; renderNoteList(); renderPins(); } })
    .catch(e => { renderNoteList(); renderPins(); toast('Cannot remove feedback: ' + e.message, { err: true }); });
}
export function editNoteCard(card, n) {
  const text = card.querySelector('.nc-text');
  if (!text || card.querySelector('.nc-edit')) return;
  const ed = document.createElement('div');
  ed.className = 'nc-edit';
  ed.innerHTML = '<textarea rows="1"></textarea>';
  const ta = ed.querySelector('textarea');
  ta.value = n.note;
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
  text.replaceWith(ed);
  fit();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  let closed = false;
  const done = save => {
    if (closed) return;
    closed = true;
    const v = ta.value.trim();
    if (save && v && v !== n.note) noteOps([{ op: 'update', id: n.id, patch: { note: v } }]);
    else renderNoteList();
  };
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); }
    else if (e.key === 'Escape') { e.preventDefault(); done(false); }
  });
  ta.addEventListener('blur', () => done(true));
}
// Check fills and pops, then the card slides out of the current tab before the list updates.
export function toggleNoteDone(card, n) {
  if (card.classList.contains('leaving')) return;
  const toDone = n.status !== 'done';
  if (toDone) card.classList.add('completing');
  setTimeout(() => {
    card.style.maxHeight = card.offsetHeight + 'px';
    card.offsetHeight;   // commit the start height so the collapse animates
    card.classList.add('leaving');
    card.style.maxHeight = '0px';
    card.style.marginBottom = '0px';
    card.style.paddingTop = card.style.paddingBottom = '0px';
    card.style.borderWidth = '0px';
  }, toDone ? 380 : 60);
  setTimeout(() => noteOps([{ op: 'update', id: n.id, patch: { status: toDone ? 'done' : 'open' } }]), toDone ? 720 : 400);
}
// One message the user pastes into Claude / Codex: what to fix, where, and how to report back.
export function copyFeedbackRequest() {
  const notes = (S.agentNotes || []).map((n, i) => [n, i]).filter(([n]) => n.status === 'open' && !isRemoving(n));
  if (!notes.length) return toast(t('fb_nothing'));
  const lines = [t('fb_prompt_head').replace('{n}', notes.length).replace('{path}', S.source.path), ''];
  for (const [n, i] of notes) {
    const target = noteTarget(n);
    const k = target ? stripItems().findIndex(s => s === target || s.contains(target)) : -1;
    const region = n.kind === 'region';
    const whole = !region && k >= 0 && stripItems()[k] === target;
    const where = [(k >= 0 ? (S.mode === 'deck' ? `Slide ${k + 1}` : `${t('fb_section')} ${k + 1}`) : n.slide != null ? `Slide ${n.slide + 1}` : ''),
      whole ? t('fb_whole_slide') : '', region ? t('fb_region_tag') : ''].filter(Boolean).join(' · ');
    const quote = region ? (n.targets.length ? n.targets.slice(0, 4).map(x => x.text ? `“${x.text.slice(0, 40)}”` : `<${x.tag}>`).join(', ') : t('fb_region_empty')) + ' → '
      : n.text && !whole ? '“' + n.text.slice(0, 80) + '” → ' : '';
    lines.push(`${i + 1}. ${where ? '[' + where + '] ' : ''}${quote}${n.note}`);
  }
  if (S.notesCmds?.length) lines.push('', t('fb_prompt_read'), ...agentCmdLines(), '', t('fb_prompt_done'), ...agentCmdLines(' --done ID'));
  const text = lines.join('\n');
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
    .then(() => toast(t('fb_copied')), () => { S.lastRequest = text; toast(text.slice(0, 120) + '…', { ms: 6000 }); });
}
