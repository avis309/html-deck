// Applying recorded ops to the model and the live preview together (the LIVE adapter).
import { S } from './state.mjs';
import { liveEl, markOriginals, markRoots, refreshRoots } from './live-document.mjs';
import * as Ops from '../core/operations.mjs';

// How operations reach the rendered iframe (see core/operations.mjs).
export const LIVE = {
  el: id => liveEl(id),
  sync: (l, m) => markOriginals(l, m),
  adopt: (l, m) => { markOriginals(l, m); markRoots(l, true); },
  refresh: l => refreshRoots(l),
};
export function applyOp(op, redo) { return Ops.applyOp(S, op, redo, LIVE); }
export function applyMove(op, redo) { return Ops.applyMove(op, redo, LIVE, S); }
