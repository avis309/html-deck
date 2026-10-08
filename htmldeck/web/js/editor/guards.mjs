// Edit guards: whether a command may touch a node, and the hint shown when it may not.
import { S, formatFlags } from './state.mjs';
import { formatBlock, structureBlock } from '../policy/edit-policy.mjs';
import { provenanceOf } from './live-document.mjs';
import { t } from '../shared/lang.mjs';
import { toast } from '../shared/toast.mjs';

export function lockedHint(key, node = null) {
  const now = Date.now(), k = key + ':' + (node?.dataset?.edId || '') + ':' + S.loadToken;
  if (S.lockHint && S.lockHint.k === k && now - S.lockHint.t < 2500) return;
  S.lockHint = { k, t: now };
  toast(t(key), { ms: 5000 });
}

// Apply CSS properties to model + live and return the op (not pushed), or null if no change.
// Refuse a command on a node the policy locks (reason shown); true when blocked.
export function commandBlocked(node, kind = 'edit') {
  const block = node && (S.readOnly || structureBlock(provenanceOf(node)) || formatBlock(kind, formatFlags(node)));
  if (block) lockedHint(block, node);
  return !!block;
}
