// HtmlDeck editor — composition root: installs the hooks and global listeners, then boots.
// Layers, bottom to top (imports only go down; tools/check-architecture.mjs enforces it):
// core/ runtime/ policy/ formats/ fx/ shared/ services/api.mjs → editor/ → features/ services/ present/
// → ui/ present/controller.mjs → app.mjs.
// What the lower layers call in the upper ones goes through shared/hooks.mjs, filled in here.
import { LAST_FILE_KEY, openServerFile, rerender } from './editor/document.mjs';
import { S } from './editor/state.mjs';
import { effectsVisible, renderFxList, stopFxPreview } from './features/effects.mjs';
import { clearFeedback, loadAgentNotes } from './features/feedback/notes.mjs';
import { watchSource } from './services/live-sync.mjs';
import { flushRemoval, pinLoop, renderNoteList, renderPins } from './ui/feedback-view.mjs';
import { runFind } from './features/find.mjs';
import { exitCrop } from './features/images.mjs';
import { checkOverflow, scheduleOverflowCheck } from './features/overflow.mjs';
import { endPresent, installPresentListeners } from './present/controller.mjs';
import { api } from './services/api.mjs';
import { clearDraft, offerDraft } from './services/drafts.mjs';
import { installHooks } from './shared/hooks.mjs';
import { curLang } from './shared/lang.mjs';
import { toast } from './shared/toast.mjs';
import { bindUI } from './ui/bindings.mjs';
import { applyModeUI, updateChrome } from './ui/chrome.mjs';
import { bindFrameEvents } from './ui/frame-events.mjs';
import { installFrameBridges } from './ui/keyboard.mjs';
import { applyLanguage } from './ui/language.mjs';
import { layout } from './ui/layout.mjs';
import { drawSnapGuides, hideOverlay, positionOverlay, startTrack, stopTrack } from './ui/overlay.mjs';
import { renderBoxPanel } from './ui/panels/box.mjs';
import { buildLayers, drawOffsets, layersVisible, syncLayers } from './ui/panels/layers.mjs';
import { loadWorkspaceList, openPanel, renderFileList } from './ui/panels/side-panel.mjs';
import { closePopups, refreshToolbar, togglePop } from './ui/toolbar.mjs';
import { buildDocColors } from './ui/panels/colors.mjs';
import { buildFilmstrip, queueThumb, trackSection } from './ui/slides.mjs';

async function boot() {
  bindUI();
  applyLanguage(curLang());
  requestAnimationFrame(pinLoop);
  updateChrome();
  let cfg = {};
  try { cfg = await api('/api/config'); }
  catch (e) { if (e.status === 404) toast('Server is running an older version — please restart htmldeck', { err: true, ms: 10000 }); }
  // Presenting runs on this second origin (no API there); the editor's own origin otherwise.
  S.previewOrigin = cfg.preview_origin || location.origin;
  // The workspace's own scripts run in the edit view only once the user trusted the workspace.
  S.workspaceTrusted = cfg.trusted === true;
  loadWorkspaceList();
  // ?file= wins, then an explicit --file, then the last file opened here, then the server default.
  let last = null;
  try { last = localStorage.getItem(LAST_FILE_KEY); } catch {}
  // Test hook, only when the server runs with --test-hooks: the next batch undo/redo fails
  // after its first sub-op, to exercise recovery.
  const fault = cfg.test_hooks && new URLSearchParams(location.search).get('htmldeck-fault');
  if (fault === 'step' || fault === 'single') S.faultNextStep = fault;
  const path = new URLSearchParams(location.search).get('file') || (cfg.explicit ? cfg.default_path : last || cfg.default_path);
  if (!path) return openPanel('files');
  if (await openServerFile(path)) return;
  if (path === last) try { localStorage.removeItem(LAST_FILE_KEY); } catch {}
  if (path === last && cfg.default_path && cfg.default_path !== last && await openServerFile(cfg.default_path)) return;
  openPanel('files');
}
installHooks({
  applyModeUI,
  bindFrameEvents,
  buildDocColors,
  buildFilmstrip,
  buildLayers,
  checkOverflow,
  clearDraft,
  clearFeedback,
  closePopups,
  drawOffsets,
  drawSnapGuides,
  effectsVisible,
  endPresent,
  exitCrop,
  flushRemoval,
  hideOverlay,
  layersVisible,
  layout,
  loadAgentNotes,
  offerDraft,
  openPanel,
  positionOverlay,
  queueThumb,
  refreshToolbar,
  renderBoxPanel,
  renderFileList,
  renderFxList,
  renderNoteList,
  renderPins,
  rerender,
  runFind,
  scheduleOverflowCheck,
  startTrack,
  stopFxPreview,
  stopTrack,
  syncLayers,
  togglePop,
  trackSection,
  updateChrome,
  watchSource,
});
installPresentListeners();
installFrameBridges();
boot();
