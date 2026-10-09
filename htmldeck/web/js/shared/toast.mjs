// Toast notifications: a self-contained widget on #toast (any layer may show one).
import { $ } from '../core/utils.mjs';
import { curLang } from './lang.mjs';
import { translateToastFor } from '../i18n.mjs';

export function translateToast(msg) { return translateToastFor(curLang(), msg); }

// In full screen only the full-screen element is painted: the toast must live inside it.
export function placeToast() {
  const tEl = $('#toast'), host = document.fullscreenElement || document.body;
  if (tEl.parentElement !== host) host.appendChild(tEl);
  return tEl;
}
export function toast(msg, { err = false, ms = 2600, action = null } = {}) {
  const tEl = placeToast();
  tEl.textContent = translateToast(msg);
  tEl.classList.toggle('has-action', !!action);
  if (action) {
    const b = document.createElement('button');
    b.className = 't-act';
    b.textContent = action.label;
    b.addEventListener('click', () => { clearTimeout(toast.timer); tEl.classList.remove('show', 'has-action'); action.fn(); });
    tEl.appendChild(b);
  }
  tEl.classList.toggle('err', err);
  tEl.classList.add('show');
  clearTimeout(toast.timer);
  // Hidden with the toast: an action toast must not keep catching clicks once it fades.
  toast.timer = setTimeout(() => tEl.classList.remove('show', 'has-action'), ms);
}
