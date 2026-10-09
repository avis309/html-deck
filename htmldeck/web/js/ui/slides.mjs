// Filmstrip, thumbnails and section tracking.
import { $$, escapeHTML } from '../core/utils.mjs';
import { S, el, thumbCSS } from '../editor/state.mjs';
import { showSlide } from '../editor/selection.mjs';
import { slideTitle, stripItems } from '../editor/slide-info.mjs';
import * as Reveal from '../formats/reveal.mjs';

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
  stripItems().forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'thumb';
    b.title = `${i + 1}. ${slideTitle(s, i)}`;
    b.innerHTML = `<iframe tabindex="-1" aria-hidden="true" loading="lazy" sandbox></iframe><span class="num">${i + 1}</span>`;
    // Fit the document's slide size into the 132×76 card, centred.
    const f = b.querySelector('iframe'), sc = Math.min(132 / S.deckW, 76 / S.deckH);
    Object.assign(f.style, { width: S.deckW + 'px', height: S.deckH + 'px', transform: `translate(${(132 - S.deckW * sc) / 2}px, ${(76 - S.deckH * sc) / 2}px) scale(${sc})` });
    b.addEventListener('click', () => S.mode === 'deck' ? showSlide(i) : jumpSection(i));
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
