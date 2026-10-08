// UI language: switching it (re-renders the chrome and panels) and the language menu.
import { $ } from '../core/utils.mjs';
import { el } from '../editor/state.mjs';
import { applyModeUI, updateChrome } from './chrome.mjs';
import { boxVisible, drawBoxPanel } from './panels/box.mjs';
import { buildLayers, layersVisible } from './panels/layers.mjs';
import { renderFxPresets } from '../features/effects.mjs';
import { renderFileList } from './panels/side-panel.mjs';
import { renderNoteList } from './feedback-view.mjs';
import { toast } from '../shared/toast.mjs';
import { curLang, setLang, t } from '../shared/lang.mjs';

export function applyLanguage(lang) {
  setLang(lang);
  try { localStorage.setItem('gs9_editor_lang', lang); } catch {}
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang === 'zh-Hant' ? 'zh-Hant' : lang;
  const ind = $('#lang-indicator');
  if (ind) ind.textContent = lang === 'zh' ? 'ZH' : lang === 'zh-Hant' ? '繁' : lang.toUpperCase();
  
  // Update elements with data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (!val) return;
    const textNodes = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
    if (textNodes.length) {
      const hasPrecedingIcon = el.classList.contains('rail-item') || el.classList.contains('tb-ghost') || el.classList.contains('btn-download') || el.classList.contains('btn-save') || el.classList.contains('btn-primary');
      textNodes[textNodes.length - 1].textContent = hasPrecedingIcon ? ' ' + val.trim() : val.trim();
    } else {
      const spanTarget = el.querySelector('span:not(.ic):not(.dot)');
      if (spanTarget) spanTarget.textContent = val;
      else if (!el.querySelector('svg, img')) el.textContent = val;
    }
  });

  // Update data-i18n-html
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    const val = t(key);
    if (val) el.innerHTML = val;
  });

  // Update data-i18n-title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    const val = t(key);
    if (val) el.title = val;
  });

  // Update data-i18n-placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const val = t(key);
    if (val) el.placeholder = val;
  });

  // Update dynamic elements
  if (typeof el !== 'undefined' && el.panel && el.panel.dataset.view) {
    const titleKey = 'panel_' + el.panel.dataset.view;
    const pt = $('#panel-title');
    if (pt) pt.textContent = t(titleKey);
  }
  if (typeof updateChrome === 'function') updateChrome();
  const idle = $('#idle-text');
  if (idle) idle.textContent = t('idle_hint');

  // Re-render open panels & dynamic views
  if (typeof boxVisible === 'function' && boxVisible()) drawBoxPanel();
  if (typeof layersVisible === 'function' && layersVisible()) buildLayers();
  if (typeof el !== 'undefined' && el.panel?.classList.contains('open')) {
    const view = el.panel.dataset.view;
    if (view === 'review' && typeof renderNoteList === 'function') renderNoteList();
    else if (view === 'files' && typeof renderFileList === 'function') renderFileList();
  }
  if (typeof applyModeUI === 'function') applyModeUI();
  renderFxPresets();
}

export function openLangMenu() {
  const pop = $('#pop-lang');
  if (!pop) return;
  const isShowing = pop.classList.contains('show');
  if (isShowing) { pop.classList.remove('show'); return; }
  
  const cur = curLang();
  pop.querySelectorAll('.lang-opt').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.lang === cur);
  });
  
  const btn = $('#btn-lang');
  if (btn) {
    const r = btn.getBoundingClientRect();
    pop.style.left = (r.right + 10) + 'px';
    pop.style.bottom = Math.max(12, innerHeight - r.bottom) + 'px';
  }
  pop.classList.add('show');
}

export function selectLanguage(lang) {
  const pop = $('#pop-lang');
  if (pop) pop.classList.remove('show');
  applyLanguage(lang);
  const msgs = {
    vi: 'Đã chuyển sang Tiếng Việt',
    en: 'Switched language to English',
    zh: '已切换为中文',
    'zh-Hant': '已切換為繁體中文'
  };
  toast(msgs[lang] || lang);
}
