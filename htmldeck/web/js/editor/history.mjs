// The edit history: recording an op, dirty state, and what refreshes after a change.
import { $ } from '../core/utils.mjs';
import { S } from './state.mjs';
import { hooks } from '../shared/hooks.mjs';
import { lockedHint } from './guards.mjs';
import { applyOp } from './ops.mjs';
import * as History from '../core/history.mjs';

export const topSeq = () => History.topSeq(S);
export const isDirty = () => History.isDirty(S);
export function pushOp(op) {
  hooks.stopFxPreview();
  // Read-only: whatever slipped past the UI gates is undone before it is recorded.
  if (S.readOnly) { applyOp(op, false); lockedHint(S.readOnly); return; }
  History.recordOp(S, op);
  hooks.updateChrome();
  if (hooks.layersVisible()) { clearTimeout(S.layerTimer); S.layerTimer = setTimeout(hooks.buildLayers, 150); }
  afterChange();
}
// Keep find results and overflow warnings in step with the document.
export function afterChange() {
  if (hooks.effectsVisible()) { clearTimeout(S.fxListTimer); S.fxListTimer = setTimeout(hooks.renderFxList, 150); }
  if (!$('#findbar').hidden) { clearTimeout(S.findTimer); S.findTimer = setTimeout(() => hooks.runFind(true), 200); }
  hooks.scheduleOverflowCheck(true);
}
