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
  const unknown = await open(browser, '<section id="s"><p id="u" data-fx="from-the-future">later</p></section>');
  await show(unknown.pg, '#s');
  check('unknown preset (a newer file in an older runtime): shown as authored, not hidden', await unknown.pg.evaluate(() => !document.querySelector('#u').classList.contains('fx-wait') && !document.querySelector('#u').getAnimations().length));
  await unknown.ctx.close();
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

async function draw(browser) {
  section('runtime: draw strokes the SVG shapes inside, in order; dashes and zero-length shapes left alone');
  const { pg, ctx, errs } = await open(browser, `<section id="s"><svg id="g" width="300" height="100" data-fx="draw" data-fx-stagger="100">
    <path id="p1" d="M0 50 L300 50" stroke="#000" fill="none"/>
    <path id="p2" d="M0 80 L300 80" stroke="#000" fill="none" stroke-dasharray="4 4"/>
    <path id="p3" d="M10 10" stroke="#000" fill="none"/>
    <circle id="c1" cx="50" cy="50" r="20" stroke="#000" fill="none"/>
    <rect id="r1" x="0" y="0" width="10" height="10" fill="#000"/></svg>
    <svg id="none" data-fx="draw"><rect width="10" height="10" fill="#000"/></svg></section>`);
  const before = await markup(pg);
  await show(pg, '#s');
  const p1 = await anims(pg, '#p1');
  check('draw: the first path dashes from its length to 0, 1400 ms', p1.length === 1 && parseFloat(p1[0].frames[0].strokeDashoffset) === 300 && parseFloat(p1[0].frames[1].strokeDashoffset) === 0 && p1[0].duration === 1400, JSON.stringify(p1));
  const c1 = await anims(pg, '#c1');
  check('draw: the circle comes next (stagger 100)', c1.length === 1 && c1[0].delay === 100, JSON.stringify(c1));
  const left = await pg.evaluate(() => ['#p2', '#p3', '#r1'].map(s => ({ s, n: document.querySelector(s).getAnimations().length, wait: document.querySelector(s).classList.contains('fx-wait') })));
  check('draw: dashed path, zero-length path, unstroked rect untouched and visible', left.every(x => x.n === 0 && !x.wait), JSON.stringify(left));
  const no = await pg.evaluate(() => window.__htmldeckFx.check(document.querySelector('#none'), 'draw'));
  check('draw on an SVG without strokes: refused ("draw")', no === 'draw', String(no));
  await leave(pg);
  check('leave: authored DOM back', (await markup(pg)) === before.replace(/ class="fx-wait"/g, ''), await markup(pg));
  check('no errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

async function loops(browser) {
  section('runtime: loops run while shown, stop on leaving, preview briefly, never under reduced motion');
  const body = `<section id="s1"><p id="sp" data-fx="spin">a</p><p id="fl" data-fx="float" data-fx-delay="300">b</p><p id="pu" data-fx="pulse">c</p></section>
    <section id="s2"><p>other</p></section>`;
  const { pg, ctx } = await open(browser, body);
  check('loops are not hidden while waiting', await pg.evaluate(() => !document.querySelector('.fx-wait')));
  await show(pg, '#s1');
  const sp = await anims(pg, '#sp'), fl = await anims(pg, '#fl'), pu = await anims(pg, '#pu');
  check('spin: rotate 0 → 360deg, linear, infinite, 20 s, added', sp[0].frames[1].transform === 'rotate(360deg)' && sp[0].easing === 'linear' && sp[0].iterations === Infinity && sp[0].duration === 20000 && sp[0].composite === 'add', JSON.stringify(sp));
  check('float: -8px alternate, delay 300', fl[0].frames[1].transform === 'translateY(-8px)' && fl[0].direction === 'alternate' && fl[0].delay === 300, JSON.stringify(fl));
  check('pulse: scale(1.06) alternate, 1200 ms', pu[0].frames[1].transform === 'scale(1.06)' && pu[0].duration === 1200, JSON.stringify(pu));
  for (let k = 0; k < 6; k++) await show(pg, k % 2 ? '#s1' : '#s2');
  await show(pg, '#s2');
  check('rapid slide changes: no loop left once its slide is not shown', (await pg.evaluate(() => document.getAnimations().length)) === 0);
  await pg.evaluate(() => window.__htmldeckFx.preview(document.querySelector('#sp')));
  const pv = await anims(pg, '#sp');
  check('preview: 2 iterations of at most 2000 ms', pv[0].iterations === 2 && pv[0].duration === 2000, JSON.stringify(pv));
  await pg.evaluate(() => window.__htmldeckFx.stopPreview());
  await ctx.close();

  const rm = await open(browser, `${body}<section id="s3"><span id="g" style="display:block;width:50px;height:5px" data-fx="grow-x"></span></section>`, { reducedMotion: 'reduce' });
  await show(rm.pg, '#s1');
  await show(rm.pg, '#s3');
  check('reduced motion: loops and grow never animate, nothing hidden', (await rm.pg.evaluate(() => document.getAnimations().length + document.querySelectorAll('.fx-wait').length)) === 0);
  await rm.ctx.close();
}

async function reviewFixes(browser) {
  section('runtime: review fixes (partial failure, orphaned waits, staggered refusals, grow pivots, count-up end)');
  // A module that throws after creating one animation: nothing of it keeps running.
  let o = await open(browser, '<section id="s"><p id="bad" data-fx="fade-up" data-fx-delay="500">Bad</p></section>');
  await o.pg.evaluate(() => {
    const animate = Element.prototype.animate; let n = 0;
    Element.prototype.animate = function (...a) { if (this.id === 'bad' && ++n === 2) throw new Error('boom'); return animate.apply(this, a); };
  });
  await show(o.pg, '#s');
  check('partial failure: the half-made animation is cancelled, the target visible', await o.pg.evaluate(() => document.querySelector('#bad').getAnimations().length === 0 && !document.querySelector('#bad').classList.contains('fx-wait')));
  await o.ctx.close();
  // Prepared while it could run, refused when shown: it must not stay hidden.
  o = await open(browser, '<section id="s"><p id="late" data-fx="blur-in">late</p></section>', { css: '.gray{filter:grayscale(1)}' });
  await o.pg.evaluate(() => document.querySelector('#late').classList.add('gray'));
  await show(o.pg, '#s');
  check('refused at play time: not left hidden', await o.pg.evaluate(() => !document.querySelector('#late').classList.contains('fx-wait')));
  await o.ctx.close();
  // A staggered parent: children the module cannot run on are skipped (shown, not animated).
  o = await open(browser, '<section id="s"><div data-fx="blur-in" data-fx-stagger="100"><p id="k1">a</p><p id="k2" style="filter:grayscale(1)">b</p></div></section>');
  await show(o.pg, '#s');
  const k = await o.pg.evaluate(() => ({ k1: document.querySelector('#k1').getAnimations().length, k2: document.querySelector('#k2').getAnimations().length, wait: !!document.querySelector('.fx-wait') }));
  check('stagger: a child with its own filter is not blurred, nothing hidden', k.k1 > 0 && k.k2 === 0 && !k.wait, JSON.stringify(k));
  await o.ctx.close();
  // grow keeps the author's pivot: refused on a rotated / scaled element; SVG bars grow from their own edge.
  o = await open(browser, `<section id="s"><span id="rot" style="display:block;width:200px;height:10px;transform:rotate(90deg)" data-fx="grow-x"></span>
    <svg width="400" height="100"><rect id="bar" x="100" y="20" width="80" height="40" fill="#f60" data-fx="grow-x"/></svg></section>`);
  const why = await o.pg.evaluate(() => window.__htmldeckFx.check(document.querySelector('#rot'), 'grow-x'));
  check('grow on a rotated element: refused ("transform")', why === 'transform', String(why));
  await show(o.pg, '#s');
  const bar = await o.pg.evaluate(() => { const r = document.querySelector('#bar'), as = r.getAnimations(); as.forEach(a => { a.pause(); a.currentTime = 450; }); const b = r.getBoundingClientRect(); return { n: as.length, left: b.left - document.querySelector('svg').getBoundingClientRect().left, width: b.width }; });
  check('grow-x on an SVG rect: grows (narrower mid-way) with its left edge kept at x=100', bar.n > 0 && bar.width < 79 && Math.abs(bar.left - 100) < 1, JSON.stringify(bar));
  await o.ctx.close();
  // draw: authored pathLength, non-scaling strokes, nested draw groups keep their own timing.
  o = await open(browser, `<section id="s"><svg width="400" height="200" data-fx="draw">
    <path id="pl" d="M0 10 H300" pathLength="1" stroke="#000" fill="none"/>
    <path id="ns" d="M0 40 H100" transform="scale(2 1)" vector-effect="non-scaling-stroke" stroke="#000" fill="none"/>
    <g id="grp" data-fx="draw" data-fx-delay="1000"><path id="inner" d="M0 80 H300" stroke="#000" fill="none"/></g></svg></section>`);
  await show(o.pg, '#s');
  const d = await o.pg.evaluate(() => {
    const a = s => document.querySelector(s).getAnimations().map(x => ({ off: x.effect.getKeyframes()[0].strokeDashoffset, delay: x.effect.getTiming().delay }));
    return { pl: a('#pl'), ns: a('#ns'), inner: a('#inner') };
  });
  check('draw: an authored pathLength sets the dash length', d.pl.length === 1 && parseFloat(d.pl[0].off) === 1, JSON.stringify(d.pl));
  check('draw: a non-scaling stroke is left alone', d.ns.length === 0, JSON.stringify(d.ns));
  check('draw: a nested draw group plays its own delay, once', d.inner.length === 1 && d.inner[0].delay === 1000, JSON.stringify(d.inner));
  await o.ctx.close();
  // check() on blocks with no effect yet (what the picker and Animate this slide ask).
  o = await open(browser, `<svg id="plain" width="300" height="50"><path d="M0 10 H300" stroke="#000" fill="none"/></svg>
    <span id="r2" style="display:block;width:50px;rotate:90deg"></span><span id="s2" style="display:block;width:50px;scale:2"></span>
    <span id="t3" style="display:block;width:50px;transform:translate3d(30px,0,10px)"></span>`);
  const ck = await o.pg.evaluate(() => { const c = (s, n) => window.__htmldeckFx.check(document.querySelector(s), n); return { draw: c('#plain', 'draw'), rot: c('#r2', 'grow-x'), sc: c('#s2', 'grow-y'), t3: c('#t3', 'grow-x') }; });
  check('check: draw on an SVG with strokes and no data-fx yet → allowed', ck.draw === null, JSON.stringify(ck));
  check('check: grow refused on CSS rotate / scale properties, allowed on a 3D translation', ck.rot === 'transform' && ck.sc === 'transform' && ck.t3 === null, JSON.stringify(ck));
  await o.ctx.close();
  // count-up really counts and ends on the authored text by itself.
  o = await open(browser, '<section id="s"><p id="n" data-fx="count-up" data-fx-dur="400">1.250,5 ₫</p></section>');
  await show(o.pg, '#s');
  await o.pg.waitForTimeout(200);
  const mid = await o.pg.textContent('#n');
  await o.pg.waitForTimeout(500);
  const end = await o.pg.textContent('#n');
  check('count-up: an intermediate value, then the authored text', mid !== '1.250,5 ₫' && mid !== '0,0 ₫' && end === '1.250,5 ₫', JSON.stringify({ mid, end }));
  await o.ctx.close();
}

const browser = await chromium.launch();
try {
  for (const scenario of [legacy, api, isolation, nesting, entrances, grow, draw, loops, reviewFixes]) {
    try { await scenario(browser); } catch (e) { failures.push(`${scenario.name}: ${e.message}`); console.log(`  ✖ ${scenario.name} crashed: ${e.stack}`); }
  }
} finally { await browser.close(); }
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach(f => console.log('  ✖ ' + f)); process.exit(1); }
