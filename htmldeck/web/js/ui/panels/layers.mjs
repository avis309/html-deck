// Layers panel: layer tree, hover box, offsets.
import { $, $$ } from '../../core/utils.mjs';
import { S, el } from '../../editor/state.mjs';
import { liveEl } from '../../editor/live-document.mjs';
import { slideTitle } from '../../editor/slide-info.mjs';
import { getLayerName, t } from '../../shared/lang.mjs';
import { contentSnippet, layerKids, layerScope } from '../../editor/layer-tree.mjs';

// ================================================================ layer tree
export const LAYER_LIMIT = 2500;
export function layersVisible() { return el.panel.classList.contains('open') && el.panel.dataset.view === 'layers'; }
export function buildLayers() {
  const tree = $('#layer-tree');
  const scope = S.doc && layerScope();
  if (!scope) { tree.innerHTML = `<div class="hint">${t('layer_empty')}</div>`; $('#layer-scope').textContent = ''; return; }
  $('#layer-scope').textContent = S.mode === 'deck' ? `Slide ${S.cur + 1} · ${slideTitle(scope, S.cur)}` : t('scope_whole_page');
  if (S.layerScope !== scope) { S.layerScope = scope; S.layerOpen = new Set(layerKids(scope).map(c => c.dataset.edId)); }
  if (S.sel && scope.contains(S.sel)) for (let n = S.sel.parentElement; n && n !== scope; n = n.parentElement) if (n.dataset.edId) S.layerOpen.add(n.dataset.edId);
  let count = 0;
  const frag = document.createDocumentFragment();
  const render = (n, box) => {
    for (const c of layerKids(n)) {
      if (++count > LAYER_LIMIT) {
        if (count === LAYER_LIMIT + 1) {
          const more = document.createElement('div');
          more.className = 'hint';
          more.textContent = t('layer_limit_more');
          box.appendChild(more);
        }
        return;
      }
      const kids = layerKids(c), open = S.layerOpen.has(c.dataset.edId);
      const row = document.createElement('div');
      row.className = 'layer-row' + (open && kids.length ? ' open' : '') + (c === S.sel ? ' sel' : '');
      row.dataset.id = c.dataset.edId;
      const text = contentSnippet(c), role = getLayerName(c.localName) || c.localName;
      row.innerHTML = `<span class="tg${kids.length ? '' : ' leaf'}"><svg class="icon"><use href="#i-caret"/></svg></span><span class="lk"></span><span class="lt"></span>`;
      row.querySelector('.lk').textContent = role;
      row.querySelector('.lt').textContent = text;
      row.title = text ? role + ': ' + text : role;
      box.appendChild(row);
      if (kids.length && open) {
        const sub = document.createElement('div');
        sub.className = 'layer-kids';
        box.appendChild(sub);
        render(c, sub);
      }
    }
  };
  render(scope, frag);
  tree.innerHTML = '<div class="drop-line" id="drop-line" hidden></div>';
  tree.appendChild(frag);
  if (!count) tree.innerHTML = `<div class="hint">${t('layer_no_blocks')}</div>`;
  tree.querySelector('.layer-row.sel')?.scrollIntoView({ block: 'nearest' });
}
export function syncLayers() {
  if (!layersVisible()) return;
  const row = S.sel && $(`#layer-tree .layer-row[data-id="${S.sel.dataset.edId}"]`);
  if (S.sel && !row && layerScope()?.contains(S.sel)) { buildLayers(); return; }
  $$('#layer-tree .layer-row.sel').forEach(r => r.classList.remove('sel'));
  if (row) { row.classList.add('sel'); row.scrollIntoView({ block: 'nearest' }); }
}
export function layerNode(row) { return row ? liveEl(row.dataset.id) : null; }
export function showHoverBox(node) {
  const hb = $('#hover-box');
  if (!node || !node.isConnected) { hb.classList.remove('show'); return; }
  const r = node.getBoundingClientRect(), fr = el.frame.getBoundingClientRect(), st = el.stage.getBoundingClientRect();
  if (!r.width && !r.height) { hb.classList.remove('show'); return; }
  hb.style.transform = `translate(${fr.left - st.left + r.left * S.scale}px, ${fr.top - st.top + r.top * S.scale}px)`;
  hb.style.width = r.width * S.scale + 'px';
  hb.style.height = r.height * S.scale + 'px';
  hb.classList.add('show');
}
// Margin (orange) and padding (green) bands around one element, as GrapesJS ShowOffset draws
// them. Shown only while the user works the spacing controls (pointer over the padding / margin
// section, or a slider held), so normal editing stays uncluttered.
export function drawOffsets(node) {
  const box = $('#offset-box');
  if (!node || !node.isConnected || S.presenting || S.crop) { if (S.offsetKey) { box.classList.remove('show'); S.offsetKey = ''; } return; }
  const r = node.getBoundingClientRect(), cs = S.win.getComputedStyle(node);
  const px = k => Math.max(0, parseFloat(cs[k]) || 0);
  const m = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'].map(px);
  const b = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].map(px);
  const p = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(px);
  const fr = el.frame.getBoundingClientRect(), st = el.stage.getBoundingClientRect(), s = S.scale;
  const key = [r.left, r.top, r.width, r.height, ...m, ...b, ...p, s, fr.left, fr.top].map(v => v.toFixed(1)).join(',');
  if (key === S.offsetKey) return;
  S.offsetKey = key;
  if (!r.width && !r.height) { box.classList.remove('show'); return; }
  const X = v => fr.left - st.left + v * s, Y = v => fr.top - st.top + v * s;
  const put = (i, x, y, w, h) => {
    const n = box.children[i];
    n.style.transform = `translate(${X(x)}px, ${Y(y)}px)`;
    n.style.width = Math.max(0, w * s) + 'px';
    n.style.height = Math.max(0, h * s) + 'px';
  };
  const { left: L, top: T, right: R, bottom: B } = r;
  put(0, L - m[3], T - m[0], r.width + m[3] + m[1], m[0]);
  put(1, R, T, m[1], r.height);
  put(2, L - m[3], B, r.width + m[3] + m[1], m[2]);
  put(3, L - m[3], T, m[3], r.height);
  const iL = L + b[3], iT = T + b[0], iR = R - b[1], iB = B - b[2];
  put(4, iL, iT, iR - iL, p[0]);
  put(5, iR - p[1], iT + p[0], p[1], iB - iT - p[0] - p[2]);
  put(6, iL, iB - p[2], iR - iL, p[2]);
  put(7, iL, iT + p[0], p[3], iB - iT - p[0] - p[2]);
  box.classList.add('show');
}
export function refreshOffsets() {
  const boxOpen = el.panel.classList.contains('open') && el.panel.dataset.view === 'box';
  drawOffsets(boxOpen && (S.spacingHover || S.spacingDrag) ? S.sel : null);
}
