// Editor state (S), DOM references (el) and shared constants.
import * as Reveal from '../formats/reveal.mjs';
import { $ } from '../core/utils.mjs';

export const DECK_W = 1280, DECK_H = 720;
export const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math', 'iframe', 'canvas', 'video', 'audio', 'object', 'embed', 'select', 'textarea', 'input', 'button', 'img', 'picture', 'head', 'option']);
// Tags an inserted flow block must not land inside (the browser would re-parent it on reload).
export const NO_BLOCK_PARENT = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'b', 'strong', 'em', 'i', 'u', 's', 'small', 'label', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'summary', 'code', 'pre', 'sup', 'sub', 'mark']);
export const FONTS = [
  ['Be Vietnam Pro', 'sans-serif', '400;500;600;700;800;900'], ['Inter', 'sans-serif', '400;500;600;700;800;900'],
  ['Inter Tight', 'sans-serif', '400;500;600;700;800;900'], ['Montserrat', 'sans-serif', '400;500;600;700;800;900'],
  ['Roboto', 'sans-serif', '400;500;700;900'], ['Open Sans', 'sans-serif', '400;500;600;700;800'],
  ['Lexend', 'sans-serif', '400;500;600;700;800'], ['Oswald', 'sans-serif', '400;500;600;700'],
  ['Anton', 'sans-serif', '400'], ['Playfair Display', 'serif', '400;500;600;700;800;900'],
  ['JetBrains Mono', 'monospace', '400;500;700'], ['Arial', 'sans-serif', null], ['Georgia', 'serif', null],
  ['Times New Roman', 'serif', null],
];
export const DEFAULT_COLORS = ['#0e0e11', '#3a3a42', '#55555e', '#8a8a94', '#dcdce2', '#ffffff', '#ff5a1f', '#e94209', '#b73108', '#ffe0d3', '#ec7f00', '#ffe7be', '#2e8a36', '#d1edcf', '#0072e0', '#cee5fe', '#da1e28', '#ffdad5', '#007995', '#e0f7fe', '#db41a5', '#ffe9f4', '#8e4ec6', '#f5eeff', '#44a948', '#5553e8', '#20a578'];
export const PRESETS = {
  heading: { tag: 'h2', text: 'Add a heading', css: { 'font-size': '56px', 'font-weight': '800', 'line-height': '1.05' }, top: 250 },
  subheading: { tag: 'h3', text: 'Add a subheading', css: { 'font-size': '30px', 'font-weight': '700', 'line-height': '1.15' }, top: 330 },
  body: { tag: 'p', text: 'Add a paragraph', css: { 'font-size': '18px', 'font-weight': '400', 'line-height': '1.5' }, top: 380 },
};

// Editor CSS injected into the rendered document only (never into the saved model).
export const FRAME_CSS = `
html.ed-deck, html.ed-deck body { overflow: hidden !important; height: 100% !important; }
html.ed-deck [data-ed-slide] { position: fixed !important; left: 0 !important; top: 0 !important; right: auto !important; bottom: auto !important;
  width: var(--ed-deck-w, ${DECK_W}px) !important; height: var(--ed-deck-h, ${DECK_H}px) !important; min-height: 0 !important; max-height: none !important; margin: 0 !important;
  transform: none !important; translate: none !important; scale: none !important; z-index: 2147483000 !important;
  box-shadow: none !important; border-radius: 0 !important; visibility: visible !important; opacity: 1 !important; }
html.ed-deck [data-ed-slide-anc] { transform: none !important; translate: none !important; scale: none !important; rotate: none !important;
  will-change: auto !important; filter: none !important; backdrop-filter: none !important; perspective: none !important; contain: none !important; }
[data-ed-edit] { cursor: text; }
[data-ed-edit]:not([contenteditable]):hover { outline: 1.5px solid rgba(255,90,31,.6) !important; outline-offset: 2px; }
[data-ed-edit][contenteditable] { outline: none !important; caret-color: #ff5a1f; }
[data-ed-svgtext] { cursor: text; }
[data-ed-svgtext]:hover { outline: 1.5px solid rgba(255,90,31,.6) !important; outline-offset: 2px; }
::selection { background: rgba(255,90,31,.24); }
::highlight(ed-find) { background-color: rgba(255,196,0,.45); }
::highlight(ed-find-cur) { background-color: #ff9a1f; color: #000; }
[data-ed-overflow] { outline: 2px dashed #e5484d !important; outline-offset: 2px; }
html.ed-marquee, html.ed-marquee * { user-select: none !important; cursor: crosshair !important; }
html.ed-press, html.ed-press * { user-select: none !important; }
html.ed-moving, html.ed-moving * { cursor: grabbing !important; }`;

// Runs before the document's own scripts: keyboard goes to the editor, never to deck handlers.
export const FRAME_GUARD = `(function(){var P=window.parent;if(!P||P===window)return;
['keydown','keyup','keypress'].forEach(function(t){window.addEventListener(t,function(e){if(t==='keydown'&&P.__edKey)P.__edKey(e,true);e.stopImmediatePropagation();},true);});
window.addEventListener('wheel',function(e){if((e.ctrlKey||e.metaKey)&&P.__edWheel){e.preventDefault();e.stopImmediatePropagation();P.__edWheel(e);}},{capture:true,passive:false});
['beforeinput','input'].forEach(function(t){window.addEventListener(t,function(e){if(e.isTrusted&&P.__edInput)P.__edInput(e);},true);});})();`;

// Thumbnails render the slide inside a copy of its ancestor chain (theme selectors such as
// `.reveal .slides section` keep matching), with the same neutralised ancestors as the preview.
export const thumbCSS = () => `html,body{margin:0!important;padding:0!important;width:${S.deckW}px!important;height:${S.deckH}px!important;overflow:hidden!important}
[data-ed-slide]{position:fixed!important;left:0!important;top:0!important;width:${S.deckW}px!important;height:${S.deckH}px!important;min-height:0!important;max-height:none!important;margin:0!important;transform:none!important;translate:none!important;scale:none!important;box-shadow:none!important;border-radius:0!important;visibility:visible!important;opacity:1!important}
[data-ed-slide-anc]{transform:none!important;translate:none!important;scale:none!important;rotate:none!important;will-change:auto!important;filter:none!important;backdrop-filter:none!important;perspective:none!important;contain:none!important}
*,*::before,*::after{animation:none!important;transition:none!important}`;

export const S = {
  source: null, doctype: '', model: null, nextId: 1, doc: null, win: null, baseURL: '',
  mode: 'page', slides: [], sections: [], cur: 0, scale: 1, fit: true, pageW: 1600,
  sel: null, editing: false, textDirty: false, savedRange: null, lastWrap: null, commitTimer: 0,
  undo: [], redo: [], seq: 0, savedSeq: 0, loadToken: 0, liveById: new Map(),
  presenting: false, present: null, format: null, readOnly: null, deckW: DECK_W, deckH: DECK_H, colorTarget: 'text', styleClip: null, trackRaf: 0, lastBox: '',
  thumbTimers: new Map(), files: [], saving: false, saveError: '',
};

export const el = {
  frame: $('#frame'), stage: $('#stage'), scroller: $('#scroller'), sizer: $('#sizer'), sheet: $('#sheet'),
  ctx: $('#ctx'), box: $('#sel-box'), pill: $('#pill'), menu: $('#pill-menu'), shield: $('#shield'),
  filmstrip: $('#filmstrip'), notes: $('#notes'), notesText: $('#notes-text'), panel: $('#panel'),
};

export const formatFlags = node => S.format?.format === 'reveal' ? Reveal.nodeFlags(node) : null;
