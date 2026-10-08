// Images: replace, alt text, crop, fit, flip.
import { $, $$, clamp, fmtSize } from '../core/utils.mjs';
import { S, el } from '../editor/state.mjs';
import { attrsEdit, buildAttrsOp, buildStyleOp, styleEdit } from '../editor/commands.mjs';
import { commitText } from '../editor/edits.mjs';
import { isOriginal, modelEl, touchOp } from '../editor/live-document.mjs';
import { setEditing } from '../editor/selection.mjs';
import { setStyleAttr } from '../core/operations.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';
import { hooks } from '../shared/hooks.mjs';
import { pushOp } from '../editor/history.mjs';

// ================================================================ images
export const IMG_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif']);
export const IMG_MAX_BYTES = 1_000_000, IMG_MAX_EDGE = 2560, IMG_HARD_LIMIT = 4 * 1048576;
export function selectedImg() { return S.sel && S.sel.localName === 'img' ? S.sel : null; }
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Failed to load image'));
    im.src = src;
  });
}
export const readDataURL = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});
export const dataURLBytes = u => Math.round((u.length - u.indexOf(',') - 1) * 3 / 4);
// Embed a picked file as a data URL; big raster images are re-encoded so the page stays shareable.
export async function fileToDataURL(file) {
  if (!IMG_TYPES.has(file.type)) throw new Error('Only PNG, JPG, WebP, GIF, SVG, AVIF images are supported');
  if ((file.type === 'image/svg+xml' || file.type === 'image/gif') && file.size > IMG_HARD_LIMIT)
    throw new Error(`${file.type === 'image/gif' ? 'GIF' : 'SVG'} size is ${fmtSize(file.size)} — maximum ${fmtSize(IMG_HARD_LIMIT)}`);
  const raw = await readDataURL(file);
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return raw;
  const im = await loadImage(raw);
  const edge = Math.max(im.naturalWidth, im.naturalHeight);
  if (file.size <= IMG_MAX_BYTES && edge <= IMG_MAX_EDGE) return raw;
  // Lower quality first, then size, until the embedded image is at most ~1.5 MB.
  const encode = (k, q) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.naturalWidth * k));
    c.height = Math.max(1, Math.round(im.naturalHeight * k));
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0, c.width, c.height);
    const webp = c.toDataURL('image/webp', q);
    if (webp.startsWith('data:image/webp')) return webp;
    // No WebP encoder (older Safari): JPEG has no alpha, so flatten onto white first.
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  };
  let k = Math.min(1, IMG_MAX_EDGE / edge), out = raw;
  for (let step = 0; step < 8; step++) {
    const q = step < 3 ? [0.86, 0.75, 0.62][step] : 0.62;
    if (step >= 3) k *= 0.8;
    const next = encode(k, q);
    if (next.length < out.length) out = next;
    if (dataURLBytes(out) <= IMG_MAX_BYTES * 1.5) break;
  }
  if (dataURLBytes(out) > IMG_HARD_LIMIT) throw new Error('Image is still too large after compression — please reduce image dimensions');
  return out;
}
export function normalizeImageURL(raw) {
  const v = raw.replace(/[\t\n\r]/g, '').trim();
  if (!v) return '';
  const probe = v.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
  if (probe.startsWith('javascript:') || probe.startsWith('vbscript:')) return null;
  if (probe.startsWith('data:') && !probe.startsWith('data:image/')) return null;
  return v;
}
// Swap an image's source as one undo step. If the new picture has another aspect ratio and
// the box does not follow it, crop to fill (object-fit: cover) instead of stretching.
export async function replaceImage(node, src) {
  if (!node || !node.isConnected) return toast('Select an image on the page first');
  const token = S.loadToken;
  let probe;
  // Resolve like the <img> will: against the document's own base (it may have a <base href>).
  try { probe = await loadImage(new URL(src, S.doc.baseURI).href); }
  catch (e) { toast(e.message, { err: true }); return; }
  if (token !== S.loadToken || !node.isConnected || selectedImg() !== node) return;
  commitText();
  const ops = [];
  const main = buildAttrsOp(node, { src, srcset: null, sizes: null }, 'Replace image');
  if (main) ops.push(main);
  const pic = node.parentElement?.localName === 'picture' ? node.parentElement : null;
  if (pic) for (const srcEl of $$('source[srcset]', pic)) {
    if (isOriginal(srcEl)) { const o = buildAttrsOp(srcEl, { srcset: null }, 'Replace image'); if (o) ops.push(o); }
    else srcEl.removeAttribute('srcset');   // added by the page's script: preview only, never saved
  }
  if (!ops.length) return toast('This image is already in use');
  // Record the step now, so a save or undo while the picture decodes already includes it.
  const batch = { type: 'batch', ops, label: 'Replace image' };
  pushOp(batch);
  try { await node.decode(); } catch { /* the box is still measurable */ }
  if (token !== S.loadToken || S.undo[S.undo.length - 1] !== batch) return;
  const r = node.getBoundingClientRect(), fit = S.win.getComputedStyle(node).objectFit;
  const boxAR = r.width / r.height, newAR = probe.naturalWidth / probe.naturalHeight;
  if (r.width && r.height && fit === 'fill' && !node.style.objectFit && Math.abs(newAR - boxAR) / boxAR > 0.02) {
    const o = buildStyleOp(node, { 'object-fit': 'cover' });
    if (o) {
      batch.ops.push(o);
      batch.seq = ++S.seq;   // changed after it may have been saved
      touchOp(o);
      hooks.updateChrome();
    }
  }
  hooks.queueThumb(node);
  hooks.refreshToolbar();
  const size = src.startsWith('data:') ? ' · embedded ' + fmtSize(dataURLBytes(src)) : '';
  toast(`Image replaced (${probe.naturalWidth}×${probe.naturalHeight}${size})`);
}
export async function replaceWithFile(node, file) {
  if (!node) return toast('Select an image on the page first');
  try { await replaceImage(node, await fileToDataURL(file)); }
  catch (e) { toast(e.message, { err: true }); }
}
export function openAltPop() {
  const img = selectedImg();
  if (!img) return;
  hooks.closePopups();
  $('#alt-input').value = img.getAttribute('alt') || '';
  const p = el.pill.getBoundingClientRect(), st = el.stage.getBoundingClientRect();
  const pop = $('#pop-alt');
  pop.style.left = clamp(p.left - st.left, 8, st.width - 350) + 'px';
  pop.style.top = clamp(p.bottom - st.top + 8, 60, st.height - 160) + 'px';
  pop.hidden = false;
  setTimeout(() => $('#alt-input').focus(), 20);
}
export function applyAlt() {
  const img = selectedImg();
  $('#pop-alt').hidden = true;
  if (img) attrsEdit(img, { alt: $('#alt-input').value.trim() }, 'Image description');
}
// "Replace image ▾": upload, reuse a picture already in the document, or paste a link.
export function openImagePop() {
  if (!selectedImg()) return;
  const open = $('#pop-img').hidden;
  hooks.closePopups();
  if (!open) return;
  const b = $('#tb-img-replace').getBoundingClientRect(), st = el.stage.getBoundingClientRect();
  const pop = $('#pop-img');
  pop.style.left = clamp(b.left - st.left, 8, st.width - 360) + 'px';
  renderImageGrid();
  pop.hidden = false;
}
// The attribute value (relative, as written in the file) of the candidate the browser shows.
export function displayedSource(n) {
  const shown = n.currentSrc, base = n.ownerDocument.baseURI;
  const cands = [n.getAttribute('src')];
  const addSet = set => { for (const part of (set || '').split(',')) { const url = part.trim().split(/\s+/)[0]; if (url) cands.push(url); } };
  addSet(n.getAttribute('srcset'));
  if (n.parentElement?.localName === 'picture') for (const src of n.parentElement.querySelectorAll('source')) addSet(src.getAttribute('srcset'));
  for (const c of cands) { try { if (c && new URL(c, base).href === shown) return c; } catch { /* malformed candidate */ } }
  return n.getAttribute('src');
}
export function renderImageGrid() {
  const grid = $('#img-grid');
  const seen = new Map();
  if (S.doc) for (const n of $$('img', S.doc)) if (isOriginal(n)) { const v = displayedSource(n); if (v && !seen.has(v)) seen.set(v, n.currentSrc || n.src); }
  grid.innerHTML = seen.size ? '' : `<div class="hint" style="grid-column:1/-1">${t('no_other_imgs')}</div>`;
  for (const [value, shown] of seen) {
    const b = document.createElement('button');
    b.title = t('use_this_img');
    const im = document.createElement('img');
    im.src = shown;
    im.alt = '';
    b.appendChild(im);
    b.addEventListener('click', () => { $('#pop-img').hidden = true; replaceImage(selectedImg(), value); });
    grid.appendChild(b);
  }
}
// ---- crop & position: drag the picture inside its frame (object-fit: cover + object-position)
export function enterCrop() {
  const img = selectedImg();
  if (!img) return;
  hooks.closePopups();
  if (S.editing) setEditing(false);
  if (S.win.getComputedStyle(img).objectFit !== 'cover') styleEdit(img, { 'object-fit': 'cover' });
  S.crop = { img };
  el.ctx.classList.add('crop-mode');
  el.box.classList.add('crop');
  el.pill.classList.remove('show');
}
export function exitCrop() {
  if (!S.crop) return;
  S.crop.cancelDrag?.();
  S.crop = null;
  el.ctx.classList.remove('crop-mode');
  el.box.classList.remove('crop');
  if (S.sel) hooks.positionOverlay(true);
  hooks.refreshToolbar();
}
export function setFit(fit) {
  const img = S.crop?.img || selectedImg();
  if (!img) return;
  styleEdit(img, { 'object-fit': fit });
  if (fit !== 'cover') exitCrop();
}
export function startCropDrag(e) {
  const img = S.crop?.img;
  if (!img || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const r = img.getBoundingClientRect(), nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh || !r.width || !r.height) return;
  const k = Math.max(r.width / nw, r.height / nh);
  const over = { x: nw * k - r.width, y: nh * k - r.height };
  // object-position may be %, px or keywords; turn each axis into a 0–100 % of the overflow.
  const KW = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };
  const toPct = (v, o) => v in KW ? KW[v] : v.endsWith('%') ? parseFloat(v) : v.endsWith('px') && o > 0.5 ? clamp(-parseFloat(v) / o * 100, 0, 100) : 50;
  const parts = S.win.getComputedStyle(img).objectPosition.trim().split(/\s+/);
  const start = { x: e.clientX, y: e.clientY, px: toPct(parts[0] || '50%', over.x), py: toPct(parts[1] || parts[0] || '50%', over.y) };
  el.shield.style.display = 'block';
  el.shield.style.cursor = 'grabbing';
  let last = null;
  const onMove = ev => {
    const dx = (ev.clientX - start.x) / S.scale, dy = (ev.clientY - start.y) / S.scale;
    const x = over.x > 0.5 ? clamp(start.px - dx / over.x * 100, 0, 100) : 50;
    const y = over.y > 0.5 ? clamp(start.py - dy / over.y * 100, 0, 100) : 50;
    last = `${Math.round(x * 10) / 10}% ${Math.round(y * 10) / 10}%`;
    img.style.setProperty('object-position', last);
  };
  const detach = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    el.shield.style.display = 'none';
    if (S.crop) S.crop.cancelDrag = null;
  };
  const onUp = () => { detach(); if (last) styleEdit(img, { 'object-position': last }, 'crop-pos'); };
  // Esc / leaving crop mid-drag: drop the live preview, record nothing.
  S.crop.cancelDrag = () => { detach(); setStyleAttr(img, modelEl(img.dataset.edId)?.getAttribute('style')); };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
export function flipImage() {
  const img = selectedImg();
  if (!img) return;
  const cur = S.win.getComputedStyle(img).scale;
  const [sx, sy] = cur === 'none' ? [1, 1] : (() => { const v = cur.split(/\s+/).map(Number); return [v[0], v[1] ?? v[0]]; })();
  const next = [-sx, sy];
  styleEdit(img, { scale: next[0] === 1 && next[1] === 1 ? null : `${next[0]} ${next[1]}` });
}
// Back to the picture the file had: source attributes, <picture> sources and inline style.
export function resetImage() {
  const img = selectedImg();
  const orig = img && S.pristine.querySelector(`[data-ed-id="${img.dataset.edId}"]`);
  if (!orig) return toast('This image was newly added, no original exists');
  commitText();
  exitCrop();
  const ops = [];
  const a = buildAttrsOp(img, Object.fromEntries(['src', 'srcset', 'sizes', 'alt'].map(n => [n, orig.getAttribute(n)])), 'Reset image');
  if (a) ops.push(a);
  const pic = img.parentElement?.localName === 'picture' ? img.parentElement : null;
  if (pic) for (const srcEl of $$('source', pic)) {
    const o = isOriginal(srcEl) && S.pristine.querySelector(`[data-ed-id="${srcEl.dataset.edId}"]`);
    const op = o && buildAttrsOp(srcEl, { srcset: o.getAttribute('srcset') }, 'Reset image');
    if (op) ops.push(op);
  }
  const m = modelEl(img.dataset.edId), before = m.getAttribute('style'), after = orig.getAttribute('style');
  if (before !== after) {
    setStyleAttr(m, after);
    setStyleAttr(img, after);
    ops.push({ type: 'style', id: img.dataset.edId, before, after, label: 'Reset image' });
  }
  if (!ops.length) return toast('Image already matches original');
  pushOp({ type: 'batch', ops, label: 'Reset image' });
  hooks.queueThumb(img);
  hooks.refreshToolbar();
  toast('Reset to original image');
}
