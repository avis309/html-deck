// Files from outside the workspace are untrusted: they render without their scripts, since
// the preview shares the editor's origin (and with it /api/save). Works on a detached clone.
// Defence in depth: such a preview is also staged with a nonce CSP (see newNonce), so a handler
// that reaches the live page another way (duplicate, undo) still never runs.
export function newNonce() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function neuterScripts(root) {
  for (const n of root.querySelectorAll('script, object, embed, meta[http-equiv], set, animate')) n.remove();
  for (const n of root.querySelectorAll('iframe, frame')) { n.removeAttribute('srcdoc'); n.setAttribute('sandbox', ''); }
  // The root too: querySelectorAll does not include it, and <html onpointerdown> is a handler.
  for (const n of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...n.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|action|formaction|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
    }
  }
}
