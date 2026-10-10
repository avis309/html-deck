/** Filmstrip slide management: black-box UI and exact disk bytes. Run: node tests/spec/slides.spec.mjs */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIX = path.join(ROOT, 'tests/fixtures');
const PY = process.env.PYTHON || (fs.existsSync(path.join(ROOT, '.venv/bin/python')) ? path.join(ROOT, '.venv/bin/python') : 'python3');
// The fixtures' workspace: a temp folder the server is started on (--root).
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'htmldeck-spec-'));
const wpath = f => f;
// Workspace trust is remembered in the user's config folder: the spec uses its own, and its
// servers trust the workspace (--trust) unless a scenario says otherwise.
const CONFIG = fs.mkdtempSync(path.join(os.tmpdir(), 'htmldeck-config-'));   // document paths are relative to the workspace
const disk = f => fs.readFileSync(path.join(WORK, f), 'utf8');

const failures = [];
let passed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); return true; }
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`  ✖ ${name}${detail ? ' — ' + detail : ''}`);
  return false;
}
function firstDiff(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return `type ${typeof a} vs ${typeof b}`;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return `@${i}: ${JSON.stringify(a.slice(Math.max(0, i - 10), i + 50))} vs ${JSON.stringify(b.slice(Math.max(0, i - 10), i + 50))}`;
  return a.length === b.length ? '' : `length ${a.length} vs ${b.length}`;
}
const section = t => console.log(`\n┌─ ${t}`);

// ---------------------------------------------------------------- server
// Each run's session key, by its address: every new browser context carries all of them.
const SESSIONS = new Map();
function signedIn(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => {
    const ctx = await newContext(...a);
    await ctx.addInitScript(keys => { if (keys[location.origin]) try { localStorage.setItem('htmldeck_session_key', keys[location.origin]); } catch {} }, Object.fromEntries(SESSIONS));
    return ctx;
  };
  browser.anonymousContext = newContext;
  return browser;
}
function startServer(extra = [], root = WORK, { trust = true } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-u', '-m', 'htmldeck', '--root', root, '--no-browser', '--port', '0', ...(trust ? ['--trust'] : []), ...extra];
    const proc = spawn(PY, args, { cwd: ROOT, env: { ...process.env, PYTHONPATH: ROOT, HTMLDECK_CONFIG_DIR: CONFIG } });
    let out = '';
    const fail = err => { clearTimeout(timer); proc.kill(); reject(err); };
    const timer = setTimeout(() => fail(new Error('server did not start: ' + out)), 15000);
    proc.on('error', fail);
    proc.stdout.on('data', d => {
      out += d;
      const m = out.match(/Editor URL\s*:\s*((http:\/\/127\.0\.0\.1:\d+)\/\?key=([\w-]+))/);
      if (m) { clearTimeout(timer); SESSIONS.set(m[2], m[3]); resolve({ proc, url: m[2], link: m[1] }); }
    });
    proc.stderr.on('data', d => { out += d; });
    proc.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited (${code}): ${out}`)); });
  });
}
async function stopServer(s) {
  if (!s || s.proc.exitCode !== null) return;
  const gone = new Promise(r => s.proc.once('exit', r));
  s.proc.kill();
  await gone;
}

// ---------------------------------------------------------------- editor session (black box)
class Session {
  constructor(browser, url) { this.browser = browser; this.url = url; this.expected = []; this.errors = []; this.downloads = 0; this.assets = new Set(); }
  async start() {
    this.ctx = await this.browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
    this.page = await this.ctx.newPage();
    this.page.on('pageerror', e => { this.errors.push(e.message); console.log(`  ! JS error: ${e.message}`); });
    if (process.env.HTMLDECK_SPEC_DEBUG) this.page.on('console', m => console.log(`  · console.${m.type()}: ${m.text().slice(0, 160)}`));
    this.page.on('dialog', d => this.onDialog(d));
    // Editor's own assets: a 404 or a wrong MIME on a module leaves a blank editor, silently.
    this.page.on('response', r => {
      const u = new URL(r.url());
      if (!u.pathname.startsWith('/__htmldeck/') || r.status() === 304) return;  // 304: cached copy, no type
      const type = r.headers()['content-type'] || '';
      const want = /\.m?js$/.test(u.pathname) ? /javascript/ : /\.css$/.test(u.pathname) ? /text\/css/ : null;
      if (r.status() >= 400 || (want && !want.test(type))) this.errors.push(`asset ${u.pathname}: ${r.status()} ${type}`);
      else if (want) this.assets.add(u.pathname);
    });
    // A request that never gets a response (connection reset, refused) has no response event.
    this.page.on('requestfailed', q => {
      const u = new URL(q.url());
      if (u.pathname.startsWith('/__htmldeck/')) this.errors.push(`asset ${u.pathname}: ${q.failure()?.errorText}`);
    });
    return this;
  }
  // Every native dialog must be announced with expectDialog(); anything else fails the run.
  // optional: may legitimately not appear (Chromium only asks beforeunload after a user gesture).
  expectDialog(type, re, accept, { optional = false } = {}) { this.expected.push({ type, re, accept, optional }); }
  async onDialog(d) {
    if (process.env.HTMLDECK_SPEC_DEBUG) console.log(`  · dialog ${d.type()}: ${d.message().slice(0, 100)}`);
    const i = this.expected.findIndex(x => x.type === d.type());
    const e = i >= 0 ? this.expected.splice(i, 1)[0] : null;
    if (!e || (e.re && !e.re.test(d.message()))) {
      failures.push(`unexpected dialog: ${d.type()} "${d.message().slice(0, 80)}"`);
      console.log(`  ✖ unexpected dialog: ${d.type()} "${d.message().slice(0, 80)}"`);
      return d.dismiss();
    }
    return e.accept ? d.accept() : d.dismiss();
  }
  get frame() { return this.page.frameLocator('#frame'); }
  async waitReady(p, prevSeq = 0) {
    const ready = this.page.waitForFunction(([p, seq]) => {
      const b = document.body;
      return b.dataset.docState === 'ready' && b.dataset.docPath === p && +(b.dataset.docSeq || 0) > seq;
    }, [p, prevSeq], { timeout: 60000 });
    // An editor module that fails to load leaves a blank editor: say so now, not after the timeout.
    let timer;
    const broken = new Promise((_, reject) => {
      timer = setInterval(() => { const a = this.errors.find(e => e.startsWith('asset ')); if (a) reject(new Error(a)); }, 100);
    });
    try { await Promise.race([ready, broken]); }
    finally { clearInterval(timer); ready.catch(() => {}); }
  }
  seq() { return this.page.evaluate(() => +(document.body.dataset.docSeq || 0)); }
  async open(p) {
    await this.page.goto(`${this.url}/?file=${encodeURIComponent(p)}`);
    await this.waitReady(p);
    return this;
  }
  // What the editor would save, read through the user-facing "download" button.
  // Chromium silently drops a burst of automatic downloads (the 11th in a row), so a missing
  // download is retried once; a second miss is a real failure.
  // Chromium drops one download in a long burst from the same page (seen: the 11th). Long
  // scenarios pass { retry: true }; every retry is logged, and the first download of each
  // fresh session (detection, real files) never retries, so a dead button still fails.
  async content({ retry = this.downloads > 0 } = {}) {
    for (let attempt = 0; ; attempt++) {
      const got = this.page.waitForEvent('download', { timeout: retry && !attempt ? 5000 : 30000 }).catch(e => { if (!retry || attempt) throw e; return null; });
      // The document exactly as edited (no files embedded): the hidden hook behind Save ▾ → HTML.
      await this.page.evaluate(() => document.querySelector('#btn-download').click());
      const dl = await got;
      if (dl) { this.downloads++; return fs.readFileSync(await dl.path(), 'utf8'); }
      console.log('  · download dropped by Chromium, clicking once more');
    }
  }
  dirty() { return this.page.evaluate(() => document.querySelector('#btn-save').classList.contains('dirty')); }
  canUndo() { return this.page.isEnabled('#btn-undo'); }
  canRedo() { return this.page.isEnabled('#btn-redo'); }
  // A click on the words of a text block edits it (here: at the end of its last line); beside
  // them it picks the block up.
  async clickText(selector) {
    const loc = this.frame.locator(selector).first();
    // Where the words are depends on layout: wait until the block stops moving (a slide change).
    let last = null;
    for (let i = 0; i < 20; i++) {
      const b = await loc.boundingBox();
      if (b && last && Math.abs(b.x - last.x) < 0.5 && Math.abs(b.y - last.y) < 0.5 && Math.abs(b.width - last.width) < 0.5) break;
      last = b;
      await this.page.waitForTimeout(50);
    }
    const position = await loc.evaluate(el => {
      if (!el.closest('[data-ed-edit]')) return null;
      const r = document.createRange();
      r.selectNodeContents(el);
      const b = [...r.getClientRects()].filter(x => x.width > 1).pop(), e = el.getBoundingClientRect();
      return b ? { x: b.right - 1 - e.left, y: b.top + b.height / 2 - e.top, w: e.width } : null;
    });
    if (!position) { await loc.click(); return; }
    // The frame is shown scaled: positions are in the page's pixels.
    const k = (await loc.boundingBox()).width / position.w;
    await loc.click({ position: { x: position.x * k, y: position.y * k } });
  }
  async typeAtEnd(selector, text) {
    await this.clickText(selector);
    await this.page.keyboard.press('End');
    await this.page.keyboard.type(text);
  }
  async select(selector) { await this.clickText(selector); }
  // The present iframe runs on the preview origin: read it as its own frame, never through the parent.
  async presentFrame() { return (await this.page.waitForSelector('.present-frame')).contentFrame(); }
  async undo() { await this.page.click('#btn-undo'); }
  // The Effects side bar, on its "slide timeline" tab (the slide's effects, auto-animate).
  async fxTimeline() {
    if (await this.page.isHidden('#fx-tabs')) await this.page.click('.rail-item[data-panel="effects"]');
    await this.page.click('#fx-tabs [data-tab="timeline"]');
  }
  async redo() { await this.page.click('#btn-redo'); }
  async saveKey() { await this.page.keyboard.press('Control+s'); }
  async waitSaved() {
    await this.page.waitForFunction(() => {
      const st = document.querySelector('#save-state');
      return !document.querySelector('#btn-save').classList.contains('dirty') && !/dirty|error/.test(st.className);
    }, null, { timeout: 15000 });
  }
  async close() {
    this.expected = this.expected.filter(e => !e.optional);
    if (this.expected.length) failures.push(`expected dialog never appeared: ${this.expected.map(e => e.type).join(', ')}`);
    if (this.errors.length) failures.push(`JS errors: ${this.errors.slice(0, 3).join(' | ')}`);
    await this.ctx.close();
  }
}

// Each scenario opens its own untouched fixture copy and context (no shared drafts/history).
const originals = Object.fromEntries(['deck.html', 'reveal.html'].map(f => [f, fs.readFileSync(path.join(FIX, f), 'utf8')]));
const deck = originals['deck.html'];
// The whitespace text immediately before a section belongs to that slide.
const units = [...deck.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/g)].map(m => {
  const leading = deck.slice(0, m.index).match(/\s*$/)[0];
  return { text: leading + m[0], start: m.index - leading.length, end: m.index + m[0].length };
});
const thumbs = s => s.page.locator('#filmstrip .thumb');
const titles = s => thumbs(s).evaluateAll(ns => ns.map(n => (n.title || '').replace(/^\d+\.\s*/, '')));
const active = s => thumbs(s).evaluateAll(ns => ns.findIndex(n => n.classList.contains('active')));
async function count(s, n, label) {
  await s.page.waitForFunction(n => +document.body.dataset.slideCount === n && document.querySelectorAll('#filmstrip .thumb').length === n, n, { timeout: 5000 }).catch(() => {});
  return check(label, await thumbs(s).count() === n && await s.page.getAttribute('body', 'data-slide-count') === String(n), `expected ${n}; thumbs=${await thumbs(s).count()}, body=${await s.page.getAttribute('body', 'data-slide-count')}`);
}
async function menu(s, i) {
  await thumbs(s).nth(i).click({ button: 'right' });
  await s.page.locator('#slide-menu.show').waitFor({ state: 'visible', timeout: 5000 });
}
async function action(s, i, act) {
  await menu(s, i);
  await s.page.locator(`#slide-menu [data-slide-act="${act}"]`).click();
}
async function key(s, i, chord) {
  await thumbs(s).nth(i).focus();
  await s.page.keyboard.press(chord);
}
async function saved(s, f, want, label) {
  await s.page.locator('#btn-save').click();
  await s.page.waitForFunction(() => !document.querySelector('#btn-save').classList.contains('dirty') || document.querySelector('#modal-reformat')?.classList.contains('show'), null, { timeout: 15000 });
  const rewrite = await s.page.locator('#modal-reformat').isVisible();
  check(`${label}: no rewrite dialog`, !rewrite);
  if (rewrite) return;
  const got = disk(f);
  check(`${label}: exact disk bytes`, got === want, firstDiff(got, want));
}
async function duplicate(s, f) {
  const before = await titles(s);
  await menu(s, 0);
  check('menu shown', await s.page.locator('#slide-menu').isVisible());
  check('first slide cannot move left', await s.page.locator('[data-slide-act="left"]').isDisabled());
  await s.page.keyboard.press('Escape');
  check('Escape closes menu', !(await s.page.locator('#slide-menu').isVisible()));
  await menu(s, 0);
  await s.page.locator('#page-count').click();
  check('outside click closes menu', !(await s.page.locator('#slide-menu').isVisible()));
  await action(s, 0, 'duplicate');
  await count(s, 4, 'duplicate adds one slide');
  check('duplicate is current slide 2', await active(s) === 1);
  check('duplicate title follows original', JSON.stringify(await titles(s)) === JSON.stringify([before[0], before[0], ...before.slice(1)]));
  await saved(s, f, deck.slice(0, units[0].end) + units[0].text + deck.slice(units[0].end), 'duplicate');
}
async function deletion(s, f) {
  await key(s, 1, 'Delete');
  await count(s, 2, 'Delete removes focused slide 2');
  await s.page.keyboard.press('ControlOrMeta+z');
  await count(s, 3, 'one undo restores deleted slide');
  check('undo selects restored slide 2', await active(s) === 1);
  await saved(s, f, deck, 'delete then undo');
}
async function move(s, f) {
  const before = await titles(s);
  await key(s, 0, 'Alt+ArrowRight');
  check('move right swaps titles', JSON.stringify(await titles(s)) === JSON.stringify([before[1], before[0], before[2]]));
  check('moved slide is current', await active(s) === 1);
  await count(s, 3, 'move preserves count');
  const want = deck.slice(0, units[0].start) + units[1].text + units[0].text + deck.slice(units[1].end);
  await saved(s, f, want, 'move');
}
async function drag(s) {
  const before = await titles(s);
  const target = thumbs(s).nth(0);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  await thumbs(s).nth(2).dragTo(target, { targetPosition: { x: box.width * 0.25, y: box.height / 2 } });
  check('drag slide 3 to left half of slide 1 makes it first', JSON.stringify(await titles(s)) === JSON.stringify([before[2], before[0], before[1]]));
  check('dragged slide is current', await active(s) === 0);
  await count(s, 3, 'drag preserves count');
}
async function lastSlide(s) {
  await key(s, 2, 'Backspace');
  await count(s, 2, 'Backspace removes focused slide');
  await key(s, 1, 'Delete');
  await count(s, 1, 'delete down to one');
  await key(s, 0, 'Delete');
  await count(s, 1, 'last slide delete refused');
  check('last slide refusal shows toast', await s.page.locator('#toast').isVisible() && !!(await s.page.locator('#toast').textContent())?.trim());
}
async function revealStack(s) {
  const before = await titles(s), n = before.length;
  const leaf = before.findIndex(t => /Down A/.test(t));
  check('Reveal fixture exposes stack leaf', leaf >= 0);
  if (leaf < 0) return;
  await action(s, leaf, 'duplicate');
  await count(s, n + 2, 'duplicating stack leaf adds both leaves');
  const after = await titles(s);
  check('whole vertical stack copied after original', JSON.stringify(after.slice(leaf, leaf + 4)) === JSON.stringify([...before.slice(leaf, leaf + 2), ...before.slice(leaf, leaf + 2)]), JSON.stringify(after));
  check('duplicated stack becomes current', await active(s) === leaf + 2);
  // Markdown stays authored as a textarea in edit mode and may have a fallback title.
  const md = await s.frame.locator('body').evaluate(body => [...body.querySelectorAll('[data-ed-slide]')].findIndex(n => n.matches('section[data-markdown]') || n.closest('section[data-markdown]')));
  check('Reveal fixture exposes markdown slide', md >= 0);
  if (md < 0) return;
  for (const act of ['duplicate', 'delete']) {
    await menu(s, md);
    const btn = s.page.locator(`#slide-menu [data-slide-act="${act}"]`);
    if (await btn.isDisabled()) await s.page.keyboard.press('Escape');
    else await btn.click();
    await count(s, n + 2, `markdown ${act} disabled or refused`);
    check(`markdown ${act} preserves order`, JSON.stringify(await titles(s)) === JSON.stringify(after));
  }
  await s.page.keyboard.press('ControlOrMeta+z');
  await count(s, n, 'one undo removes entire duplicate stack');
}
async function history(s, f) {
  const originalTitles = await titles(s);
  await key(s, 0, 'ControlOrMeta+d');
  await count(s, 4, 'history: duplicate');
  await key(s, 1, 'Alt+ArrowRight');
  check('history: moved duplicate is current', await active(s) === 2);
  await key(s, 2, 'Delete');
  await count(s, 3, 'history: delete');
  await s.page.keyboard.press('ControlOrMeta+z');
  await count(s, 4, 'undo delete');
  check('undo delete selects restored copy', await active(s) === 2);
  await s.page.keyboard.press('ControlOrMeta+z');
  check('undo move selects copy in original position', await active(s) === 1);
  await s.page.keyboard.press('ControlOrMeta+z');
  await count(s, 3, 'undo duplicate');
  check('three undos restore original order', JSON.stringify(await titles(s)) === JSON.stringify(originalTitles));
  await saved(s, f, deck, 'history undo chain');
  await s.page.keyboard.press('ControlOrMeta+Shift+z');
  await count(s, 4, 'redo duplicate');
  check('redo duplicate selects copy', await active(s) === 1);
  await s.page.keyboard.press('ControlOrMeta+Shift+z');
  check('redo move selects moved copy', await active(s) === 2);
  await s.page.keyboard.press('ControlOrMeta+Shift+z');
  await count(s, 3, 'redo delete');
  check('three redos restore final order', JSON.stringify(await titles(s)) === JSON.stringify(originalTitles));
}
async function groupSelection(s, f) {
  const makeGroup = async () => {
    await thumbs(s).nth(0).click();
    // As in characterization.spec.mjs: select one block, Shift+click adds the next.
    await s.select('#t1');
    // Near its left edge: the selection's toolbar covers the middle of the next line.
    await s.frame.locator('p.lead').click({ modifiers: ['Shift'], position: { x: 4, y: 4 } });
    await s.page.locator('#multi-pill.show').waitFor({ state: 'visible' });
    check('group setup: title and lead selected', /^2\b/.test(await s.page.textContent('#multi-count')) && await s.page.locator('#multi-boxes > .multi-box').count() === 2);
  };
  const originalStyles = await s.frame.locator('.slide').first().locator('#t1, p.lead').evaluateAll(ns => ns.map(n => n.getAttribute('style')));
  for (const focus of ['thumb', 'body']) {
    await makeGroup();
    await action(s, 0, 'duplicate');
    await count(s, 4, `${focus}: group then duplicate adds one slide`);
    check(`${focus}: duplicate clears group pill`, await s.page.locator('#multi-pill.show').count() === 0);
    if (focus === 'thumb') await thumbs(s).nth(1).focus();
    else await s.page.locator('body').evaluate(body => { body.tabIndex = -1; body.focus(); });
    check(`${focus}: ArrowRight focus is on requested target`, await s.page.evaluate(focus => focus === 'body' ? document.activeElement === document.body : document.activeElement.matches('#filmstrip .thumb'), focus));
    await s.page.keyboard.press('ArrowRight');
    const styles = await s.frame.locator('.slide').first().locator('#t1, p.lead').evaluateAll(ns => ns.map(n => n.getAttribute('style')));
    check(`${focus}: ArrowRight preserves original blocks' styles (no translate)`, JSON.stringify(styles) === JSON.stringify(originalStyles), JSON.stringify(styles));
    check(`${focus}: ArrowRight leaves group cleared`, await s.page.locator('#multi-pill.show').count() === 0);
    await s.page.keyboard.press('ControlOrMeta+z');
    await count(s, 3, `${focus}: one undo removes the duplicate`);
    check(`${focus}: no additional dirty operation remains`, !(await s.dirty()) && !(await s.canUndo()));
    await saved(s, f, deck, `${focus}: group duplicate undo`);
  }
  await makeGroup();
  await thumbs(s).nth(1).click();
  check('clicking thumb 2 clears group from slide 1', await s.page.locator('#multi-pill.show').count() === 0);
  check('group navigation leaves document clean', !(await s.dirty()));
}

// Deliberately core-level: detached whitespace references must be rebound after an ancestor
// html operation replaces descendants, independently of slide UI and document history.
async function whitespaceCompanions(s) {
  const results = await s.page.evaluate(async () => {
    const { buildModel, reId } = await import('/__htmldeck/js/core/model.mjs');
    const { doInsert, doRemove, applyOp, applyMove, nodeRefs, positionOf } = await import('/__htmldeck/js/core/operations.mjs');
    const results = [];
    for (const kind of ['insert', 'insert-merged', 'remove', 'move']) {
      const type = kind.split('-')[0];
      const st = {};
      buildModel(st, '<!doctype html><html><body><main>\n  <section>A</section>\n  <section>B</section>\n</main></body></html>');
      const doc = st.model.cloneNode(true);
      const live = { el: id => doc.querySelector(`[data-ed-id="${id}"]`), sync() {}, adopt() {}, refresh() {} };
      const mParent = st.model.querySelector('main'), lParent = doc.querySelector('main');
      const original = { m: mParent.innerHTML, l: lParent.innerHTML };
      let op;
      if (type === 'insert') {
        const m = st.model.createElement('section'); m.textContent = 'copy'; reId(st, m);
        const l = doc.importNode(m, true);
        // insert-merged: put in right before a section, after its indentation, so two text nodes
        // touch (an ancestor html op then merges them into one).
        const mNext = kind === 'insert-merged' ? mParent.querySelectorAll('section')[1] : mParent.lastChild;
        const lNext = kind === 'insert-merged' ? lParent.querySelectorAll('section')[1] : lParent.lastChild;
        op = { type, m, l, mParent, lParent, mNext, lNext,
          ws: { m: st.model.createTextNode('\n  '), l: doc.createTextNode('\n  ') } };
        doInsert(op, live, st);
        Object.assign(op, nodeRefs(m, l, op.ws));
      } else {
        const m = mParent.querySelector('section'), l = lParent.querySelector('section');
        const ws = { m: m.previousSibling, l: l.previousSibling };
        if (type === 'remove') {
          op = { type, ws, ...nodeRefs(m, l, ws) };
          doRemove(op, live, st);
        } else {
          op = { type, m, l, ws,
            from: { mP: mParent, lP: lParent, mN: m.nextSibling, lN: l.nextSibling, ...positionOf(m, l, ws) },
            to: { mP: mParent, lP: lParent, mN: mParent.lastChild, lN: lParent.lastChild } };
          applyMove(op, true, live, st);
          Object.assign(op.to, positionOf(m, l, ws));
        }
      }
      const changed = { m: mParent.innerHTML, l: lParent.innerHTML };
      results.push({ name: `${kind}: structural operation actually changes both docs`, ok: changed.m !== original.m && changed.l !== original.l });
      // An ancestor html op replaces every text node with an equal copy (merging touching ones).
      const reparse = () => { for (const parent of [mParent, lParent]) parent.innerHTML = parent.innerHTML; };
      reparse();
      applyOp(st, op, false, live);
      for (const [key, parent] of [['m', mParent], ['l', lParent]]) {
        results.push({ name: `${kind}: ancestor html op then structural undo restores ${key === 'm' ? 'model' : 'live'} bytes`, ok: parent.innerHTML === original[key], got: parent.innerHTML, want: original[key] });
      }
      reparse();
      applyOp(st, op, true, live);
      for (const [key, parent] of [['m', mParent], ['l', lParent]]) {
        results.push({ name: `${kind}: another html op then redo gives the ${key === 'm' ? 'model' : 'live'} bytes again`, ok: parent.innerHTML === changed[key], got: parent.innerHTML, want: changed[key] });
      }
    }
    return results;
  });
  for (const r of results) check(r.name, r.ok, r.got === undefined ? '' : firstDiff(r.got, r.want));
}

let server, browser;
try {
  for (const d of ['dist', 'plugin']) fs.cpSync(path.join(ROOT, 'node_modules/reveal.js', d), path.join(WORK, 'reveal', d), { recursive: true });
  server = await startServer(['--test-hooks']);
  browser = signedIn(await chromium.launch());
  for (const scenario of [duplicate, deletion, move, drag, lastSlide, revealStack, history, groupSelection, whitespaceCompanions]) {
    section(scenario.name);
    const source = scenario === revealStack ? 'reveal.html' : 'deck.html';
    const f = `${scenario.name}.html`;
    fs.writeFileSync(path.join(WORK, f), originals[source]);
    let s;
    try {
      s = await new Session(browser, server.url).start();
      s.page.setDefaultTimeout(5000);
      await s.open(f);
      await count(s, await thumbs(s).count(), 'load exposes matching slide count');
      await scenario(s, f);
    } catch (e) {
      failures.push(`${scenario.name} stopped half way: ${e.message.split('\n')[0]}`);
      console.log(`  ✖ ${failures.at(-1)}`);
    } finally { await s?.close(); }
  }
} catch (e) {
  failures.push(`setup: ${e.message.split('\n')[0]}`);
  console.log(`  ✖ ${e.stack}`);
} finally {
  await browser?.close();
  await stopServer(server);
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.rmSync(CONFIG, { recursive: true, force: true });
}
if (!passed) failures.push('no check ran');
console.log(`\n${failures.length ? '✖' : '✔'} ${passed} pass, ${failures.length} fail, 0 known`);
for (const f of failures) console.log('  - ' + f);
process.exitCode = failures.length ? 1 : 0;
