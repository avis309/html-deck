/**
 * HtmlDeck — FX runtime spec: the runtime alone (js/fx/runtime.mjs) in a blank page, driven in
 * controlled mode through its public API (show / settle / preview / check / catalog).
 * Run: `node tests/spec/fx-runtime.spec.mjs` (part of `npm run spec`).
 */
import { chromium } from 'playwright';
import { fxRuntime } from '../../htmldeck/web/js/fx/runtime.mjs';

const failures = [];
let passed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); return true; }
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`  ✖ ${name}${detail ? ' — ' + detail : ''}`);
  return false;
}
const section = t => console.log(`\n┌─ ${t}`);

// A page holding `body`, with the runtime installed in controlled mode (nothing plays until show()).
async function open(browser, body, { reducedMotion = 'no-preference', css = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.setContent(`<!DOCTYPE html><html><head><style>body{margin:0}${css}</style></head><body>${body}</body></html>`);
  await pg.addScriptTag({ content: `(${fxRuntime.toString()})(window, { controlled: true });` });
  return { pg, ctx, errs };
}
// The authored markup as a string. Removing fx-wait from an element that had no class leaves
// class="" behind (existing behaviour), which is not an authored change.
const markup = pg => pg.evaluate(() => document.body.innerHTML.replace(/ class=""/g, ''));
const anims = (pg, sel) => pg.evaluate(s => document.querySelector(s).getAnimations().map(a => ({
  frames: a.effect.getKeyframes().map(k => { const o = { ...k }; delete o.offset; delete o.computedOffset; delete o.easing; delete o.composite; return o; }),
  composite: a.effect.composite, delay: a.effect.getTiming().delay, duration: a.effect.getTiming().duration,
  iterations: a.effect.getTiming().iterations, direction: a.effect.getTiming().direction, easing: a.effect.getTiming().easing,
})), sel);
const show = (pg, sel) => pg.evaluate(s => window.__htmldeckFx.show(document.querySelector(s)), sel);
const leave = pg => pg.evaluate(() => { window.__htmldeckFx.show(null); window.__htmldeckFx.settle(); });

async function legacy(browser) {
  section('runtime: the five v2 presets keep their meaning; leaving restores the authored DOM');
  const body = `<section id="s">
    <p id="a" data-fx="fade-in">A</p><p id="b" data-fx="fade-up" data-fx-delay="200">B</p>
    <p id="c" data-fx="zoom-in" data-fx-dur="500">C</p><p id="d" data-fx="slide-left">D</p>
    <p id="n" data-fx="count-up">1.250,5 ₫</p>
    <ul id="l" data-fx="fade-in" data-fx-stagger="100"><li>x</li><li>y</li></ul></section>`;
  const { pg, ctx, errs } = await open(browser, body);
  const before = await markup(pg);
  check('loaded: waiting targets hidden with fx-wait (count-up is not)',
    await pg.evaluate(() => ['#a', '#b', '#c', '#d', '#l li'].every(s => document.querySelector(s).classList.contains('fx-wait')) && !document.querySelector('#n').classList.contains('fx-wait')));
  await show(pg, '#s');
  const b = await anims(pg, '#b');
  check('fade-up: opacity 0 → authored, translateY(40px) added, delay 200, 700 ms',
    b.length === 2 && b[0].frames[0].opacity === '0' && b[0].frames[1].opacity === '1' && b[1].composite === 'add' &&
    b[1].frames[0].transform === 'translateY(40px)' && b[0].delay === 200 && b[0].duration === 700, JSON.stringify(b));
  const c = await anims(pg, '#c');
  check('zoom-in: scale(0.85), duration from data-fx-dur', c[1].frames[0].transform === 'scale(0.85)' && c[0].duration === 500, JSON.stringify(c));
  const d = await anims(pg, '#d');
  check('slide-left: translateX(60px)', d[1].frames[0].transform === 'translateX(60px)', JSON.stringify(d));
  const a = await anims(pg, '#a');
  check('fade-in: opacity only', a.length === 1 && a[0].frames[0].opacity === '0', JSON.stringify(a));
  const li = await pg.evaluate(() => [...document.querySelectorAll('#l li')].map(n => n.getAnimations()[0]?.effect.getTiming().delay));
  check('stagger: children delayed 0 / 100', li[0] === 0 && li[1] === 100, JSON.stringify(li));
  check('count-up: counting', (await pg.textContent('#n')) !== '1.250,5 ₫');
  await leave(pg);
  check('leave + settle: no animation, authored DOM back', (await pg.evaluate(() => document.getAnimations().length)) === 0 && (await markup(pg)) === before.replace(/ class="fx-wait"/g, ''), await markup(pg));
  check('no errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

async function api(browser) {
  section('runtime: check() and catalog() for the editor');
  const { pg, ctx } = await open(browser, '<p id="w">words</p><p id="n">42</p>');
  const r = await pg.evaluate(() => ({
    words: window.__htmldeckFx.check(document.querySelector('#w'), 'count-up'),
    num: window.__htmldeckFx.check(document.querySelector('#n'), 'count-up'),
    fade: window.__htmldeckFx.check(document.querySelector('#w'), 'fade-up'),
    nope: window.__htmldeckFx.check(document.querySelector('#w'), 'nope'),
    cat: window.__htmldeckFx.catalog(),
  }));
  check('check: count-up on words → "count", on a number → null', r.words === 'count' && r.num === null, JSON.stringify(r));
  check('check: fade-up → null, unknown preset → "unknown"', r.fade === null && r.nope === 'unknown', JSON.stringify(r));
  check('catalog: the five v2 presets with categories',
    ['fade-in', 'fade-up', 'zoom-in', 'slide-left', 'count-up'].every(n => r.cat.some(p => p.name === n && p.category)), JSON.stringify(r.cat));
  await ctx.close();
}

async function isolation(browser) {
  section('runtime: a module that throws shows its target and the rest still plays');
  const { pg, ctx, errs } = await open(browser, '<section id="s"><p id="bad" data-fx="fade-up">Bad</p><p id="ok" data-fx="fade-up">Ok</p></section>');
  await pg.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) { if (this.id === 'bad') throw new Error('boom'); return animate.apply(this, args); };
  });
  await show(pg, '#s');
  const st = await pg.evaluate(() => ({ badWait: document.querySelector('#bad').classList.contains('fx-wait'), ok: document.querySelector('#ok').getAnimations().length }));
  check('thrown module: its target is visible, the next one animates', !st.badWait && st.ok > 0, JSON.stringify(st));
  check('thrown module: logged once with the module name', errs.filter(e => /HtmlDeck FX "fade-up"/.test(e)).length === 1, errs.join(' | '));
  await ctx.close();
}

async function nesting(browser) {
  section('runtime: a child with its own effect is animated once; the parent keeps its timing');
  const { pg, ctx } = await open(browser, `<section id="s"><ul data-fx="fade-in" data-fx-stagger="100">
    <li id="a" data-fx="zoom-in">A</li><li id="b">B</li><li id="c">C</li></ul></section>`);
  await show(pg, '#s');
  const st = await pg.evaluate(() => ({
    a: document.querySelector('#a').getAnimations().length,
    aFrom: document.querySelector('#a').getAnimations().map(x => x.effect.getKeyframes()[0].transform).filter(Boolean),
    c: document.querySelector('#c').getAnimations()[0]?.effect.getTiming().delay,
  }));
  check('own effect wins: #a runs zoom-in only (2 animations, not 3)', st.a === 2 && st.aFrom[0] === 'scale(0.85)', JSON.stringify(st));
  check('parent stagger keeps the index: #c still delayed 200', st.c === 200, JSON.stringify(st));
  await ctx.close();
}

async function entrances(browser) {
  section('runtime: new entrances and pop');
  const { pg, ctx, errs } = await open(browser, `<section id="s">
    <p id="fd" data-fx="fade-down">a</p><p id="sr" data-fx="slide-right">b</p><p id="zo" data-fx="zoom-out">c</p>
    <p id="bl" data-fx="blur-in">d</p><p id="pp" data-fx="pop">e</p><p id="fl" data-fx="blur-in" style="filter: grayscale(1)">f</p></section>`);
  const before = await markup(pg);
  await show(pg, '#s');
  const from = async s => (await anims(pg, s)).map(a => a.frames[0].transform || a.frames[0].filter).filter(Boolean);
  check('fade-down: translateY(-40px)', (await from('#fd'))[0] === 'translateY(-40px)', JSON.stringify(await anims(pg, '#fd')));
  check('slide-right: translateX(-60px)', (await from('#sr'))[0] === 'translateX(-60px)');
  check('zoom-out: scale(1.15)', (await from('#zo'))[0] === 'scale(1.15)');
  const bl = await anims(pg, '#bl');
  check('blur-in: blur(12px) → none, with opacity, 800 ms', bl[0].frames[0].filter === 'blur(12px)' && bl[0].frames[1].filter === 'none' && bl[0].frames[0].opacity === '0' && bl[0].duration === 800, JSON.stringify(bl));
  const pp = await anims(pg, '#pp');
  check('pop: scale(0.6) with overshoot easing, 600 ms', pp[1].frames[0].transform === 'scale(0.6)' && /1\.56/.test(pp[0].easing) && pp[0].duration === 600, JSON.stringify(pp));
  const fl = await pg.evaluate(() => ({ why: window.__htmldeckFx.check(document.querySelector('#fl'), 'blur-in'), n: document.querySelector('#fl').getAnimations().length, wait: document.querySelector('#fl').classList.contains('fx-wait') }));
  check('blur-in on an authored filter: refused ("filter"), shown as authored', fl.why === 'filter' && fl.n === 0 && !fl.wait, JSON.stringify(fl));
  const cat = await pg.evaluate(() => window.__htmldeckFx.catalog());
  check('catalog: pop is emphasis, the others enter', cat.find(p => p.name === 'pop').category === 'emphasis' && cat.find(p => p.name === 'zoom-out').category === 'enter', JSON.stringify(cat));
  await leave(pg);
  check('leave: authored DOM back', (await markup(pg)) === before.replace(/ class="fx-wait"/g, ''));
  check('no errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

async function grow(browser) {
  section('runtime: grow-x / grow-y scale from an edge, the author\'s transform kept');
  const css = '.bar{display:block;height:10px;width:200px;background:#f60}.moved{transform:translateX(30px)}';
  const { pg, ctx } = await open(browser, `<section id="s">
    <span id="gx" class="bar moved" data-fx="grow-x"></span><span id="gy" class="bar" data-fx="grow-y"></span>
    <span id="rtl" class="bar" dir="rtl" data-fx="grow-x"></span><span id="in" data-fx="grow-x">inline</span></section>`, { css });
  await show(pg, '#s');
  const gx = await anims(pg, '#gx');
  const origin = gx.find(a => a.frames[0].transformOrigin)?.frames[0].transformOrigin;
  const scale = gx.find(a => a.composite === 'add');
  check('grow-x: scaleX(0) added, origin at the left edge, 900 ms', scale?.frames[0].transform === 'scaleX(0)' && /^left/.test(origin) && scale.duration === 900, JSON.stringify(gx));
  const gy = await anims(pg, '#gy');
  check('grow-y: scaleY(0) from the bottom', gy.some(a => a.frames[0].transform === 'scaleY(0)') && gy.some(a => /bottom/.test(a.frames[0].transformOrigin || '')), JSON.stringify(gy));
  const rtl = await anims(pg, '#rtl');
  check('grow-x in rtl: from the right edge', rtl.some(a => /^right/.test(a.frames[0].transformOrigin || '')), JSON.stringify(rtl));
  const inl = await pg.evaluate(() => ({ why: window.__htmldeckFx.check(document.querySelector('#in'), 'grow-x'), n: document.querySelector('#in').getAnimations().length }));
  check('grow on an inline element: refused ("inline"), not animated', inl.why === 'inline' && inl.n === 0, JSON.stringify(inl));
  await pg.evaluate(() => document.getAnimations().forEach(a => a.finish()));
  const t = await pg.evaluate(() => getComputedStyle(document.querySelector('#gx')).transform);
  check('after grow-x: the authored translateX(30px) is intact', t === 'matrix(1, 0, 0, 1, 30, 0)', t);
  await ctx.close();
}

const browser = await chromium.launch();
try {
  for (const scenario of [legacy, api, isolation, nesting, entrances, grow]) {
    try { await scenario(browser); } catch (e) { failures.push(`${scenario.name}: ${e.message}`); console.log(`  ✖ ${scenario.name} crashed: ${e.stack}`); }
  }
} finally { await browser.close(); }
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach(f => console.log('  ✖ ' + f)); process.exit(1); }
