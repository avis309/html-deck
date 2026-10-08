// Side panel and the workspace file list.
import { $, $$, fmtSize } from '../../core/utils.mjs';
import { S, el } from '../../editor/state.mjs';
import { api } from '../../services/api.mjs';
import { buildLayers } from './layers.mjs';
import { drawBoxPanel, renderBoxPanel } from './box.mjs';
import { layout } from '../layout.mjs';
import { openServerFile } from '../../editor/document.mjs';
import { showFxTab } from '../../features/effects.mjs';
import { renderNoteList } from '../feedback-view.mjs';
import { curLang, t } from '../../shared/lang.mjs';

// ================================================================ side panel + files
export function openPanel(name, keepOpen = false) {
  const panel = el.panel;
  const already = !keepOpen && panel.classList.contains('open') && panel.dataset.view === name;
  $$('.rail-item[data-panel]').forEach(b => b.classList.toggle('active', !already && b.dataset.panel === name));
  if (already) { panel.classList.remove('open'); setTimeout(layout, 220); return; }
  panel.dataset.view = name;
  $$('.panel-body', panel).forEach(b => { b.hidden = b.dataset.view !== name; });
  $('#panel-title').textContent = t('panel_' + name);
  if (name === 'layers') buildLayers();
  if (name === 'review') renderNoteList();
  panel.classList.add('open');
  if (name === 'box') { drawBoxPanel(); renderBoxPanel(); }
  if (name === 'files') { loadWorkspaceList(); setTimeout(() => $('#file-search').focus(), 60); }
  if (name === 'effects') showFxTab('effects');
  setTimeout(layout, 220);
}
export function closePanel() {
  el.panel.classList.remove('open');
  $$('.rail-item').forEach(b => b.classList.remove('active'));
  setTimeout(layout, 220);
}
export async function loadWorkspaceList() {
  try {
    const data = await api('/api/list_html');
    S.files = data.files || [];
  } catch (e) {
    $('#file-list').innerHTML = `<div class="hint">${t('error_list_files')}</div>`;
    return;
  }
  renderFileList();
}
export function renderFileList() {
  const box = $('#file-list');
  const q = $('#file-search').value.trim().toLowerCase();
  const files = S.files.filter(f => !q || f.path.toLowerCase().includes(q));
  if (!files.length) { box.innerHTML = `<div class="hint">${S.files.length ? t('no_match_files') : t('empty_workspace')}</div>`; return; }
  const groups = new Map();
  for (const f of files) {
    const dir = f.path.split('/').slice(0, -1).join('/') || '.';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(f);
  }
  box.innerHTML = '';
  for (const [dir, list] of groups) {
    const g = document.createElement('div');
    g.className = 'file-group';
    const name = document.createElement('div');
    name.className = 'file-group-name';
    name.textContent = dir;
    g.appendChild(name);
    for (const f of list) {
      const b = document.createElement('button');
      const current = S.source?.kind === 'server' && S.source.path === f.path;
      b.className = 'file-item' + (current ? ' current' : '');
      b.innerHTML = `<span class="fi-icon"><svg class="icon sm"><use href="#i-file"/></svg></span><span class="fi-text"><div class="fi-name"></div><div class="fi-meta"></div></span>`;
      b.querySelector('.fi-name').textContent = f.path.split('/').pop();
      const meta = b.querySelector('.fi-meta');
      const loc = curLang() === 'zh-Hant' ? 'zh-TW' : curLang() === 'zh' ? 'zh-CN' : curLang() === 'vi' ? 'vi-VN' : 'en-US';
      meta.textContent = fmtSize(f.size) + ' · ' + new Date(f.mtime * 1000).toLocaleDateString(loc);
      if (f.size > 3 * 1048576) meta.insertAdjacentHTML('beforeend', ' · <span class="fi-heavy">' + t('file_heavy') + '</span>');
      b.title = f.path;
      b.addEventListener('click', () => openServerFile(f.path));
      g.appendChild(b);
    }
    box.appendChild(g);
  }
}
