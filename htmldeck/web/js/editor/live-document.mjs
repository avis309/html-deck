// Model <-> live preview mapping, provenance and editable roots.
import * as Model from '../core/model.mjs';
import * as Reveal from '../formats/reveal.mjs';
import { $$ } from '../core/utils.mjs';
import { FRAME_CSS, FRAME_GUARD, S, SKIP_TAGS, formatFlags } from './state.mjs';
import { editFreeze } from '../runtime/freeze.mjs';
import { neuterScripts } from '../core/sanitize.mjs';
import { provenance } from '../runtime/provenance.mjs';
import { contentForSave as serializeForSave } from '../core/serializer.mjs';

// ================================================================ document model
// The model is a DOMParser copy of the source: scripts never run in it, so saving it back
// can never capture runtime DOM (minimaps, clones, classes added by the page's own JS).
// Every element gets a data-ed-id; the rendered iframe carries the same ids, which is how
// an edit in the live view is mapped back onto the model.
export function buildModel(html) { Model.buildModel(S, html); }
export function touchOp(op) { Model.touchOp(S, op); }
export function reId(root) { Model.reId(S, root); }
export function modelEl(id) { return Model.modelEl(S, id); }
// A live node is "original" only if it sits where the model says it does. A page script that
// clones an element keeps its data-ed-id, so id presence alone would let a clone edit the
// original's model node. The set is filled by walking model and live trees together.
export function isOriginal(node) { return !!node && !!S.liveOriginal && S.liveOriginal.has(node); }
export function markOriginals(live, model) {
  if (!live || !model) return;
  S.liveOriginal.add(live);
  // Siblings sharing one model id (a page script cloned it): which one is the authored node
  // cannot be told, so none of them is original and all are locked as ambiguous.
  const byId = new Map(), dup = new Set();
  for (const c of live.children) {
    const id = c.getAttribute('data-ed-id');
    if (!id) continue;
    if (byId.has(id)) { dup.add(id); S.liveAmbiguous.add(byId.get(id)); S.liveAmbiguous.add(c); } else byId.set(id, c);
  }
  for (const mc of model.children) { const id = mc.getAttribute('data-ed-id'); if (id && !dup.has(id)) markOriginals(byId.get(id), mc); }
}
// Provenance of a live node (plain data; see runtime/provenance.mjs).
export const PROV_ENV = {
  isOriginal: n => isOriginal(n),
  isAmbiguous: n => !!S.liveAmbiguous && S.liveAmbiguous.has(n),
  modelOf: n => modelEl(n.dataset?.edId),
};
export const provenanceOf = node => provenance(node, PROV_ENV);
export function liveEl(id) {
  let node = S.liveById.get(id);
  if (node && node.isConnected) return node;
  node = S.doc ? $$(`[data-ed-id="${id}"]`, S.doc).find(isOriginal) || null : null;
  if (node) S.liveById.set(id, node);
  return node;
}
// nonce: set for a document from outside the workspace; only the editor's scripts carry it.
export function renderHTML(nonce) {
  const root = S.model.documentElement.cloneNode(true);
  if (S.source && (S.source.kind !== 'server' || !S.workspaceTrusted)) neuterScripts(root);
  const head = root.querySelector('head');
  const guard = S.model.createElement('script');
  guard.textContent = FRAME_GUARD;
  head.insertBefore(guard, head.firstChild);
  const freeze = S.model.createElement('script');
  freeze.textContent = `(${editFreeze.toString()})(window);`;
  head.insertBefore(freeze, guard.nextSibling);
  // The document's FX runtime stays inert while editing (it also refuses to run here).
  for (const n of root.querySelectorAll('script[data-htmldeck-fx]')) n.setAttribute('type', 'text/x-htmldeck-inert');
  if (S.format?.format === 'reveal') {
    const boot = S.model.createElement('script');
    boot.textContent = Reveal.EDIT_BOOTSTRAP;
    head.insertBefore(boot, freeze.nextSibling);
  }
  if (nonce) for (const n of head.querySelectorAll('script')) n.setAttribute('nonce', nonce);
  const style = S.model.createElement('style');
  style.textContent = FRAME_CSS;
  head.appendChild(style);
  return (S.doctype || '<!DOCTYPE html>') + '\n' + root.outerHTML;
}
export function cleanFragment(html) { return Model.cleanFragment(S, html); }

export function contentForSave() { return serializeForSave(S); }

// ================================================================ editable roots
export function hasDirectText(node) {
  for (const c of node.childNodes) if (c.nodeType === 3 && /\S/.test(c.nodeValue)) return true;
  return false;
}
// Mark the outermost original elements that carry their own text as editable roots.
// Text inside an SVG diagram is marked apart (see openSvgText).
export function markRoots(scope, includeSelf) {
  const walk = (node, isScope) => {
    if (node.localName === 'svg' || node.ownerSVGElement) { if (isOriginal(node)) markSvgText(node); return; }
    if (SKIP_TAGS.has(node.localName) || !isOriginal(node) || node.classList.contains('notes')) return;
    if ((!isScope || includeSelf) && !node.hasAttribute('data-ed-slide') && hasDirectText(node)) {
      node.setAttribute('data-ed-edit', '');
      S.liveById.set(node.dataset.edId, node);
      return;
    }
    for (const c of node.children) walk(c, false);
  };
  walk(scope, true);
}
export const isRoot = node => !!node && node.hasAttribute('data-ed-edit');
// <text>, <tspan> and <textPath> that hold plain text only: editing one replaces its text and
// nothing else, so its position, styling and the rest of the diagram stay as authored.
export const SVG_TEXT = new Set(['text', 'tspan', 'textPath']);
export function markSvgText(scope) {
  for (const n of [scope, ...scope.querySelectorAll('*')]) {
    if (!SVG_TEXT.has(n.localName) || n.children.length || !/\S/.test(n.textContent) || !isOriginal(n)) continue;
    n.setAttribute('data-ed-svgtext', '');
    S.liveById.set(n.dataset.edId, n);
  }
}
export const isSvgText = node => !!node && node.hasAttribute?.('data-ed-svgtext');
// The diagram itself: the outermost <svg> around a node.
export function outerSvg(node) {
  let svg = node.closest('svg');
  while (svg?.ownerSVGElement) svg = svg.ownerSVGElement;
  return svg;
}

// Nearest original element that is a meaningful block (not the slide/body itself).
export function pickBlock(t) {
  let node = t.closest('[data-ed-id]');
  while (node && !isOriginal(node)) node = node.parentElement?.closest('[data-ed-id]');
  if (!node || node === S.doc.body || node === S.doc.documentElement || node.hasAttribute('data-ed-slide')) return null;
  if (formatFlags(node)?.section) return null;
  return node;
}

export function refreshRoots(node) {
  if (node.parentElement?.closest('[data-ed-edit]')) {
    node.removeAttribute('data-ed-edit');
    for (const n of node.querySelectorAll('[data-ed-edit],[data-ed-svgtext]')) { n.removeAttribute('data-ed-edit'); n.removeAttribute('data-ed-svgtext'); }
  } else markRoots(node, true);
}

// Reveal centres a slide vertically from its content height (config.center, or .center).
export function centerSlide(s) {
  if (!s || S.format?.format !== 'reveal') return;
  const on = S.revealCenter || s.classList.contains('center');
  const top = on ? Math.max(0, Math.round((S.deckH - s.offsetHeight) / 2)) : 0;
  s.style.setProperty('--ed-top', top + 'px');
}
