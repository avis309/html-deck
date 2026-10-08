// What the editor and its features need from the layers above them (UI views, panels, overlay,
// presentation, drafts), filled in once by app.mjs before boot. Calls through `hooks.x()` run the
// same function, at the same place and in the same order, as a direct import would; the lower
// layer just never imports the upper one. tools/check-architecture.mjs keeps it that way.
export const hooks = {};

export function installHooks(impl) {
  for (const [name, fn] of Object.entries(impl)) {
    if (typeof fn !== 'function') throw new Error(`hook ${name}: not a function`);
    hooks[name] = fn;
  }
}
