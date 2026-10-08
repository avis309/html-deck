// Slide and section lists of the open document, and slide titles.
import { S } from './state.mjs';

// ================================================================ slides / filmstrip / outline / notes
export function slideTitle(s, i) {
  const t = s.getAttribute('data-title') || s.querySelector('h1, h2, h3')?.textContent || '';
  return t.replace(/\s+/g, ' ').trim().replace(/^\d+\s*[·.-]\s*/, '') || `Slide ${i + 1}`;
}
// Filmstrip entries: the slides of a deck, or the sections of a report opened as a page.
export const stripItems = () => S.mode === 'deck' ? S.slides : S.sections;
