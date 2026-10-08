// Which elements count as layers (the Layers panel, block reordering and containment use it).
import { S } from './state.mjs';
import { isOriginal } from './live-document.mjs';

export const LAYER_HIDDEN = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'br', 'wbr', 'title', 'base']);
export function layerKids(n) {
  if (n.localName === 'svg') return [];
  return [...n.children].filter(c => isOriginal(c) && !LAYER_HIDDEN.has(c.localName) && !c.classList.contains('notes'));
}
// Label text from the element's own text nodes only: reading textContent of every row
// rescans whole subtrees and stalls on multi-MB pages.
export function directText(n) {
  let out = '';
  for (const c of n.childNodes) {
    if (c.nodeType === 3) out += c.nodeValue.slice(0, 160 - out.length);
    if (out.length >= 120) break;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, 48);
}
export function layerScope() { return S.mode === 'deck' ? S.slides[S.cur] : S.doc?.body; }

// Text an end user recognises a block by: its own words, else the first words inside it.
export function contentSnippet(n) {
  if (n.localName === 'img') return n.getAttribute('alt') || '';
  let t = directText(n);
  if (!t) {
    const w = n.ownerDocument.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    for (let i = 0, c = w.nextNode(); c && i < 80; i++, c = w.nextNode()) {
      const v = c.nodeValue.slice(0, 200).replace(/\s+/g, ' ').trim();
      if (v && !c.parentElement.closest('script,style,svg')) { t = v; break; }
    }
  }
  return t.slice(0, 44);
}
