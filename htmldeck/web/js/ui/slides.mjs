// Filmstrip, thumbnails and section tracking.
import { $$, escapeHTML } from '../core/utils.mjs';
import { S, el, thumbCSS } from '../editor/state.mjs';
import { showSlide } from '../editor/selection.mjs';
import { slideTitle, stripItems } from '../editor/slide-info.mjs';
import * as Reveal from '../formats/reveal.mjs';
import { deleteSlide, duplicateSlide, moveSlide, nudgeSlide, slideBlock } from '../editor/slide-actions.mjs';
import { t } from '../shared/lang.mjs';

export function buildFilmstrip() {
  const head = S.model.head.cloneNode(true);
  head.querySelectorAll('script').forEach(n => n.remove());
  S.thumbHead = head.innerHTML;
  const htmlEl = S.model.documentElement;
  const reveal = S.format?.format === 'reveal';
  S.thumbHtmlAttrs = [...htmlEl.attributes].filter(a => a.name !== 'data-ed-id' && a.name !== 'class').map(a => `${a.name}="${escapeHTML(a.value)}"`)
    .concat(`class="${escapeHTML(((htmlEl.getAttribute('class') || '') + ' ed-deck').trim())}"`).join(' ');
  S.thumbBodyClass = ((S.model.body.getAttribute('class') || '') + (reveal ? ' reveal-viewport' : '')).trim();
  S.thumbExtraCSS = reveal ? Reveal.editCSS() : '';
  el.filmstrip.innerHTML = '';
  closeSlideMenu();
  if (!keysBound) { keysBound = true; bindSlideKeys(); }
  stripItems().forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'thumb' + (S.mode === 'deck' && i === S.cur ? ' active' : '');
    b.title = `${i + 1}. ${slideTitle(s, i)}`;
    b.innerHTML = `<iframe tabindex="-1" aria-hidden="true" loading="lazy" sandbox></iframe><span class="num">${i + 1}</span>`;
    // Fit the document's slide size into the 132×76 card, centred.
    const f = b.querySelector('iframe'), sc = Math.min(132 / S.deckW, 76 / S.deckH);
    Object.assign(f.style, { width: S.deckW + 'px', height: S.deckH + 'px', transform: `translate(${(132 - S.deckW * sc) / 2}px, ${(76 - S.deckH * sc) / 2}px) scale(${sc})` });
    b.addEventListener('click', () => S.mode === 'deck' ? showSlide(i) : jumpSection(i));
    if (S.mode === 'deck') bindSlideThumb(b, i);
    el.filmstrip.appendChild(b);
    renderThumb(i);
  });
}
export function renderThumb(i) {
  const s = stripItems()[i], b = el.filmstrip.children[i];
  if (!s || !b) return;
  const c = s.cloneNode(true);
  c.setAttribute('data-ed-slide', '');
  c.removeAttribute('contenteditable');
  c.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
  c.style.setProperty('display', s.dataset.edDisplay || 'block', 'important');
  let html = c.outerHTML;
  for (let a = s.parentElement; a && a !== S.doc.body && a !== S.doc.documentElement; a = a.parentElement) {
    const attrs = [...a.attributes].filter(x => x.name !== 'data-ed-slide-anc').map(x => ` ${x.name}="${escapeHTML(x.value)}"`).join('');
    html = `<${a.localName}${attrs} data-ed-slide-anc>${html}</${a.localName}>`;
  }
  b.querySelector('iframe').srcdoc = `<!DOCTYPE html><html ${S.thumbHtmlAttrs}><head><base href="${escapeHTML(S.baseURL)}">${S.thumbHead}<style>${thumbCSS()}${S.thumbExtraCSS || ''}</style></head><body class="${escapeHTML(S.thumbBodyClass)}">${html}</body></html>`;
  b.title = `${i + 1}. ${slideTitle(s, i)}`;
}
export function jumpSection(i) {
  const s = S.sections[i];
  if (!s) return;
  // Land below the page's own fixed header, as the document's own navigation would.
  const head = [...S.doc.body.querySelectorAll('*')].find(n => !n.closest('.slide') && S.win.getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().top <= 0 && n.offsetHeight < 200 && n.offsetWidth > S.win.innerWidth / 2);
  const top = s.getBoundingClientRect().top + S.win.scrollY - (head ? head.offsetHeight : 0);
  S.win.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}
// Highlight the section at the top of the viewport while the page scrolls.
export function trackSection() {
  const mark = () => {
    if (!S.sections.length || !S.win) return;
    const y = S.win.innerHeight * 0.3;
    let i = 0;
    S.sections.forEach((s, k) => { if (s.getBoundingClientRect().top <= y) i = k; });
    if (i === S.cur && el.filmstrip.querySelector('.thumb.active')) return;
    S.cur = i;
    $$('.thumb', el.filmstrip).forEach((t, k) => t.classList.toggle('active', k === i));
    el.filmstrip.children[i]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };
  let raf = 0;
  S.win.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; mark(); }); }, { passive: true });
  mark();
}
export function queueThumb(node) {
  if (!node || !stripItems().length) return;
  const i = stripItems().findIndex(s => s === node || s.contains(node));
  if (i < 0) return;
  clearTimeout(S.thumbTimers.get(i));
  S.thumbTimers.set(i, setTimeout(() => { renderThumb(i); S.thumbTimers.delete(i); }, 450));
}

// ================================================================ slide actions (deck mode)
// Right-click menu, drag to reorder, and keys on a focused thumb (Delete, Ctrl+D, Alt+arrows).
const ACTS = [['duplicate', 'slide_dup'], ['left', 'slide_left'], ['right', 'slide_right'], ['delete', 'slide_del']];
function runAct(act, i) {
  if (act === 'duplicate') return duplicateSlide(i);
  if (act === 'delete') return deleteSlide(i);
  return nudgeSlide(i, act === 'left' ? -1 : 1);
}
// The thumbs are rebuilt by every op: keep the keyboard on the current one.
const refocus = () => el.filmstrip.children[S.cur]?.focus({ preventScroll: true });
function bindSlideThumb(b, i) {
  b.draggable = true;
  b.addEventListener('contextmenu', e => { e.preventDefault(); openSlideMenu(i, e.clientX, e.clientY); });
  b.addEventListener('dragstart', e => {
    S.slideDrag = { from: i };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
    b.classList.add('dragging');
  });
  b.addEventListener('dragover', e => {
    if (!S.slideDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const before = e.offsetX < b.offsetWidth / 2;
    b.classList.toggle('drop-before', before);
    b.classList.toggle('drop-after', !before);
  });
  b.addEventListener('dragleave', () => b.classList.remove('drop-before', 'drop-after'));
  b.addEventListener('drop', e => {
    const d = S.slideDrag;
    if (!d) return;
    e.preventDefault();
    const mode = e.offsetX < b.offsetWidth / 2 ? 'before' : 'after';
    endSlideDrag();
    if (d.from !== i) moveSlide(d.from, S.slides[i], mode);
  });
  b.addEventListener('dragend', endSlideDrag);
}
function endSlideDrag() {
  S.slideDrag = null;
  $$('.thumb', el.filmstrip).forEach(t => t.classList.remove('dragging', 'drop-before', 'drop-after'));
}
// Bound once: the filmstrip element itself outlives its thumbs.
let keysBound = false;
function bindSlideKeys() {
  el.filmstrip.addEventListener('keydown', e => {
    const b = e.target.closest?.('.thumb');
    if (!b || S.mode !== 'deck' || S.editing) return;
    const i = [...el.filmstrip.children].indexOf(b), k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    let act = null;
    if ((k === 'delete' || k === 'backspace') && !mod && !e.altKey) act = 'delete';
    else if (mod && !e.altKey && !e.shiftKey && k === 'd') act = 'duplicate';
    else if (e.altKey && !mod && (k === 'arrowleft' || k === 'arrowup')) act = 'left';
    else if (e.altKey && !mod && (k === 'arrowright' || k === 'arrowdown')) act = 'right';
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    if (runAct(act, i)) refocus();
  });
}
function slideMenu() {
  let m = document.getElementById('slide-menu');
  if (m) return m;
  m = document.createElement('div');
  m.className = 'lang-menu slide-menu';
  m.id = 'slide-menu';
  m.setAttribute('role', 'menu');
  m.hidden = true;
  m.innerHTML = ACTS.map(([act]) => `<button class="lang-opt" role="menuitem" data-slide-act="${act}"><span class="name"></span></button>`).join('');
  m.addEventListener('click', e => {
    const btn = e.target.closest('[data-slide-act]');
    if (!btn || btn.disabled) return;
    const i = +m.dataset.index;
    closeSlideMenu();
    if (runAct(btn.dataset.slideAct, i)) refocus();
  });
  m.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeSlideMenu(); el.filmstrip.children[+m.dataset.index]?.focus(); } });
  document.body.appendChild(m);
  // Any press outside, a scroll of the strip or the window losing focus closes it.
  document.addEventListener('pointerdown', e => { if (!m.hidden && !m.contains(e.target)) closeSlideMenu(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !m.hidden) closeSlideMenu(); }, true);
  el.filmstrip.addEventListener('scroll', closeSlideMenu, { passive: true });
  window.addEventListener('blur', closeSlideMenu);
  return m;
}
export function openSlideMenu(i, x, y) {
  if (S.mode !== 'deck' || !S.slides[i]) return;
  const m = slideMenu();
  m.dataset.index = String(i);
  for (const [act, key] of ACTS) {
    const btn = m.querySelector(`[data-slide-act="${act}"]`);
    btn.querySelector('.name').textContent = t(key);
    // Locks (read-only, Markdown…) are explained when the action is tried, so only position-bound
    // limits disable an entry here.
    btn.disabled = ['slide_unavailable', 'slide_last'].includes(slideBlock(i, act));
  }
  m.hidden = false;
  m.classList.add('show');
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y - r.height, innerHeight - r.height - 8)) + 'px';
  m.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
export function closeSlideMenu() {
  const m = document.getElementById('slide-menu');
  if (!m || m.hidden) return;
  m.hidden = true;
  m.classList.remove('show');
}
