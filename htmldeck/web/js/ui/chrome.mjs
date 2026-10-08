// Top bar / status bar state and page width.
import { $, $$ } from '../core/utils.mjs';
import { S, el } from '../editor/state.mjs';
import { isOriginal } from '../editor/live-document.mjs';
import { layout } from './layout.mjs';
import { scheduleDraft } from '../services/drafts.mjs';
import { curLang, t } from '../shared/lang.mjs';
import { isDirty } from '../editor/history.mjs';

// ================================================================ chrome
// Page-mode frame width: 1600 by default; a width picked by hand is remembered.
export const PAGE_W_KEY = 'gs9_editor_page_width';
export function applyPageWidth(v, quiet) {
  S.pageW = +v;
  if (quiet) return;
  S.fit = true;
  layout();
}
export function applyModeUI() {
  const deck = S.mode === 'deck';
  el.filmstrip.hidden = !deck && !S.sections.length;
  $('#sb-notes').hidden = !deck;
  $('#sb-width').hidden = deck;
  $('#page-count').hidden = !deck;
  $('#sb-prev').hidden = !deck;
  $('#sb-next').hidden = !deck;
  if (!deck) { el.notes.hidden = true; $('#sb-notes').classList.remove('on'); }
  $('#sb-notes').disabled = deck && !S.slides.some(s => $$('.notes', s).some(isOriginal));
  $('#text-hint').innerHTML = deck
    ? (curLang() === 'zh-Hant' ? '點擊以在目前投影片新增文字方塊。拖曳區塊即可調整位置。' : curLang() === 'zh' ? '点击向当前幻灯片添加文本框。拖动区块即可调整位置。' : curLang() === 'vi' ? 'Nhấp để thêm hộp chữ vào slide hiện tại. Kéo khối để đặt lại vị trí.' : 'Click to add text box to current slide. Drag the block to move it.')
    : (curLang() === 'zh-Hant' ? '新文字會插入目前選取的區塊後（或畫面中央的區塊後）。' : curLang() === 'zh' ? '新文字插入在当前选定区块后（或屏幕中央的区块后）。' : curLang() === 'vi' ? 'Chữ mới được chèn ngay sau khối đang chọn (hoặc khối ở giữa màn hình).' : 'New text is inserted after the selected block (or block in center of screen).');
}
export function updateChrome() {
  const dirty = S.model ? isDirty() : false;
  const st = $('#save-state');
  let icon = '#i-cloud-ok', text = t('save_saved'), cls = '';
  if (!S.model) text = t('save_no_doc');
  else if (S.saving) { icon = '#i-cloud'; text = t('save_saving'); }
  else if (S.saveError) { icon = '#i-cloud'; text = t('save_error'); cls = 'error'; }
  else if (dirty) { icon = '#i-cloud'; text = t('save_dirty'); cls = 'dirty'; }
  st.className = 'save-state ' + cls;
  st.querySelector('use').setAttribute('href', icon);
  st.querySelector('span').textContent = text;
  $('#btn-save').classList.toggle('dirty', dirty);
  $('#btn-undo').disabled = !S.undo.length && !S.textDirty;
  $('#btn-redo').disabled = !S.redo.length;
  if (S.source) {
    const dn = $('#doc-name');
    dn.querySelector('.name').textContent = S.source.name;
    dn.title = S.source.kind === 'server' ? S.source.path : S.source.kind === 'handle' ? (S.source.name + ' (' + t('local_file') + ')') : (S.source.name + ' (' + t('download_only') + ')');
    const badge = $('#mode-badge');
    badge.hidden = false;
    badge.textContent = S.mode === 'deck' ? `${t('sb_deck')} · ${S.slides.length}` : t('sb_page');
    document.title = (dirty ? '• ' : '') + S.source.name + ' — HtmlDeck';
  }
  if (dirty && !S.saving) scheduleDraft();
  if (S.mode === 'deck' && S.slides.length) {
    $('#page-count').textContent = `${S.cur + 1} / ${S.slides.length}`;
    $('#sb-prev').disabled = S.cur === 0;
    $('#sb-next').disabled = S.cur === S.slides.length - 1;
  }
}
