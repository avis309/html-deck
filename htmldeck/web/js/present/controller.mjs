// Presentation mode: start, end, layout, full screen.
import * as Reveal from '../formats/reveal.mjs';
import { $ } from '../core/utils.mjs';
import { NS as PRESENT_NS, VERSION as PRESENT_V, createPresentSession, newSessionId } from './session.mjs';
import { S, el } from '../editor/state.mjs';
import { deselect, showSlide } from '../editor/selection.mjs';
import { flushPending } from '../editor/edits.mjs';
import { hideOverlay } from '../ui/overlay.mjs';
import { layout } from '../ui/layout.mjs';
import { newNonce } from '../core/sanitize.mjs';
import { postJSON } from '../services/api.mjs';
import { renderPresentHTML } from './render.mjs';
import { save } from '../services/save.mjs';
import { stopFxPreview } from '../features/effects.mjs';
import { t } from '../shared/lang.mjs';
import { placeToast, toast } from '../shared/toast.mjs';
import { topSeq } from '../editor/history.mjs';

// Present runs in its own iframe built from the model (js/present/): the edit iframe, its
// selection mapping and the undo history stay untouched underneath, and the deck gets its keys.
// Scripts neuterScripts strips that would have run: data blocks (JSON, import maps…) do not count.
export function hasAuthorCode(model) {
  return [...model.querySelectorAll('script:not([data-htmldeck-fx])')].some(n => {
    const ty = (n.getAttribute('type') || '').trim().toLowerCase();
    return !ty || ty === 'module' || /^(text|application)\/(x-)?(java|ecma)script$/.test(ty);
  });
}
export function togglePresent() { if (S.present) endPresent(); else startPresent(); }
export function startPresent() {
  if (!S.doc || S.present) return;
  stopFxPreview();
  flushPending();
  deselect();
  const mode = S.mode === 'deck' && S.slides.length ? 'deck' : 'page';
  const slideIds = mode === 'deck' ? S.slides.map(s => s.dataset.edId) : [];
  const displays = mode === 'deck' ? S.slides.map(s => s.dataset.edDisplay) : [];
  const untrusted = S.source.kind !== 'server', reveal = S.format?.format === 'reveal';
  // Reveal decks present with the author's own runtime; without it (untrusted, or no Reveal
  // script) the legacy provider shows the leaves statically.
  const provider = mode !== 'deck' ? 'page' : reveal && !untrusted && S.format.present === 'reveal' ? 'reveal' : 'legacy';
  const p = { sessionId: newSessionId(), docRevision: topSeq(), mode, provider, count: slideIds.length, start: mode === 'deck' ? S.cur : 0, session: null, fullscreen: false };
  const staticReveal = reveal && provider === 'legacy';
  const nonce = untrusted ? newNonce() : undefined;
  let html;
  try {
    html = renderPresentHTML(S.model, S.doctype, {
      untrusted, nonce, mode, provider, slideIds, displays, start: p.start, deckW: S.deckW, deckH: S.deckH,
      extraCSS: staticReveal ? Reveal.editCSS() + Reveal.backgroundCSS(Reveal.leaves(S.model), '[data-ed-cur]') : '',
      bodyClass: staticReveal ? 'reveal-viewport' : '',
      session: { ns: PRESENT_NS, v: PRESENT_V, sessionId: p.sessionId, docRevision: p.docRevision, origin: location.origin },
    });
  } catch (e) { toast('Cannot start presenting: ' + e.message, { err: true }); return; }
  S.present = p;
  S.presenting = true;
  el.stage.classList.add('presenting');
  hideOverlay();
  // Requested inside the click, before any await: browsers only grant it to a user gesture.
  // Refused (or unsupported), the present layer still covers the window.
  // A request that completes after the session already ended must not leave the stage full screen.
  el.stage.requestFullscreen?.().then(() => { if (S.present !== p && document.fullscreenElement === el.stage) document.exitFullscreen().catch(() => {}); }, () => {});
  const fail = msg => { if (S.present !== p) return; endPresent(); toast('Cannot start presenting' + (msg ? ': ' + msg : ''), { err: true }); };
  // One deadline from the click to the frame's ready, staging included.
  p.deadline = setTimeout(() => { if (p.session?.state !== 'active') fail('timed out'); }, 10000);
  postJSON('/api/preview', { path: S.source.kind === 'server' ? S.source.path : null, content: html, target: 'present', nonce }).then(({ url }) => {
    if (S.present !== p) return;
    p.session = createPresentSession({
      host: $('#present-host'), url, title: S.source.name, sessionId: p.sessionId, docRevision: p.docRevision,
      count: p.count, start: p.start, origin: S.previewOrigin,
      on: {
        ready: m => { clearTimeout(p.deadline); layoutPresent(); p.session.frame.focus(); p.session.frame.contentWindow?.focus(); document.body.dataset.presentIndex = String(m.index); document.body.dataset.presentState = 'active'; if (untrusted && hasAuthorCode(S.model)) toast(t('present_untrusted'), { ms: 6000 }); if (m.split) toast(t('present_split'), { ms: 5000 }); },
        state: i => { document.body.dataset.presentIndex = String(i); },
        exit: () => endPresent(),
        save: () => save(),
        fail: reason => fail(reason),
      },
    });
    layoutPresent();
  }, e => fail(e.message));
  document.body.dataset.presentState = 'loading';
  document.body.dataset.presentIndex = String(p.start);
}
// restore: false when the document itself is going away (open / re-render).
export function endPresent({ restore = true } = {}) {
  const p = S.present;
  if (!p) return;
  S.present = null;
  S.presenting = false;
  const index = p.session ? p.session.index : p.start;
  clearTimeout(p.deadline);
  p.session?.dispose();
  el.stage.classList.remove('presenting');
  delete document.body.dataset.presentState;
  delete document.body.dataset.presentIndex;
  if (document.fullscreenElement === el.stage) document.exitFullscreen().catch(() => {});
  if (!restore) return;
  if (S.mode === 'deck' && index !== S.cur) showSlide(index);
  // The window keeps its full-screen size for a moment after exit; lay out again once it settles.
  requestAnimationFrame(layout);
  setTimeout(layout, 120);
  setTimeout(layout, 400);
}
export function layoutPresent() {
  const p = S.present, f = p?.session?.frame;
  if (!f) return;
  const host = $('#present-host'), W = host.clientWidth, H = host.clientHeight;
  if (p.provider === 'legacy') {
    const sc = Math.min(W / S.deckW, H / S.deckH);
    f.style.width = S.deckW + 'px';
    f.style.height = S.deckH + 'px';
    f.style.transform = `translate(${(W - S.deckW * sc) / 2}px, ${(H - S.deckH * sc) / 2}px) scale(${sc})`;
  } else {
    f.style.width = W + 'px';
    f.style.height = H + 'px';
    f.style.transform = '';
  }
}
// Registered once by app.mjs before boot (was a module-level statement).
export function installPresentListeners() {
  document.addEventListener('fullscreenchange', () => {
    const p = S.present;
    // Only the session's own full screen ending closes it; a refused request never opened one.
    if (p && document.fullscreenElement === el.stage) p.fullscreen = true;
    else if (p && p.fullscreen) endPresent();
    placeToast();
    requestAnimationFrame(layoutPresent);
    setTimeout(layoutPresent, 120);
  });
}
