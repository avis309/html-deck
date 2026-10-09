// HtmlDeck FX runtime: declarative effects (data-fx) on the Web Animations API.
// fxRuntime is self-contained: it is serialized into documents (inline <script data-htmldeck-fx>)
// and also called directly by the editor for previews and parsing, so it takes the window it
// works on and touches no module scope.
//
// Animations never write attributes or inline styles: transform offsets are composited onto the
// author's transform, opacity ends at the author's computed value, and once an animation ends or
// is cancelled the element is exactly as authored. The only DOM state the runtime owns: the class
// `fx-on` on <html>, `fx-wait` on targets waiting to play, and count-up text while it counts —
// all undone by settle()/dispose(). It never runs in the editor's edit frame.

export const FX_VERSION = 4;
// Presets each runtime version knows: a file carrying an older runtime ignores newer ones (the
// element then simply shows as authored).
var V2 = ['fade-in', 'fade-up', 'zoom-in', 'slide-left', 'count-up'];
var V3 = V2.concat(['fade-down', 'slide-right', 'zoom-out', 'blur-in', 'pop', 'grow-x', 'grow-y', 'draw', 'spin', 'float', 'pulse']);
export const FX_PRESETS_BY_VERSION = {
  2: V2,
  3: V3,
  4: V3.concat(['wipe', 'baseline', 'zoom-blur', 'tumble', 'stomp', 'scrapbook', 'flicker', 'wiggle', 'blink']),
};

export function fxRuntime(win, opts) {
  opts = opts || {};
  var doc = win.document, root = doc.documentElement;
  var EASE = 'cubic-bezier(.16,1,.3,1)';
  // ---- modules: data-fx value → { category, waits (hidden until played), dur (default ms),
  // from (a transform, or transform keyframes ending at none) / opacity / fade ([fraction of the
  // author's opacity, offset] keyframes) / filter / clip(el) (the clip-path it opens from) / ease
  // (entrances), single (never staggers its children),
  // previewAs (preset its editor preview plays), why + applies(el) (where it can run),
  // targets(el, c) (what animates), play(target, i, c, run) }. Every module plays through `run`.
  var MODULES = {};
  function mod(name, m) { m.name = name; m.dur = m.dur || 700; MODULES[name] = m; }
  function entrance(from, extra) {
    var m = { category: 'enter', waits: true, opacity: true, from: from, play: playEnter };
    for (var k in extra || {}) m[k] = extra[k];
    return m;
  }

  // One number with an unambiguous format, the rest of the text kept verbatim.
  // → { pre, post, value, decimals, group, dec } | null
  function parseCount(text) {
    var m = /^(\D*?)(-?\d[\d.,   ]*\d|-?\d)(\D*)$/.exec(text);
    if (!m) return null;
    var num = m[2], neg = num.charAt(0) === '-';
    if (neg) num = num.slice(1);
    var seps = num.replace(/\d/g, ''), kinds = [];
    for (var i = 0; i < seps.length; i++) if (kinds.indexOf(seps[i]) < 0) kinds.push(seps[i]);
    var group = '', dec = '';
    if (kinds.length === 2) { dec = num.match(/\D(?=\d+$)/)[0]; group = kinds[0] === dec ? kinds[1] : kinds[0]; }
    else if (kinds.length === 1) {
      var k = kinds[0], parts = num.split(k);
      if (parts.length > 2 || /[   ]/.test(k)) group = k;
      else if (parts[1].length === 3) return null;           // "1.234": thousands or decimals?
      else dec = k;
    } else if (kinds.length > 2) return null;
    if (dec && !/[.,]/.test(dec)) return null;
    var intPart = dec ? num.slice(0, num.lastIndexOf(dec)) : num, frac = dec ? num.slice(num.lastIndexOf(dec) + 1) : '';
    if (group) {
      var g = intPart.split(group);
      if (!/^\d{1,3}$/.test(g[0]) || g.slice(1).some(function (x) { return !/^\d{3}$/.test(x); })) return null;
      intPart = g.join('');
    }
    if (!/^\d+$/.test(intPart) || (frac && !/^\d+$/.test(frac))) return null;
    var value = parseFloat(intPart + (frac ? '.' + frac : '')) * (neg ? -1 : 1);
    return { pre: m[1], post: m[3], value: value, decimals: frac.length, group: group, dec: dec, neg: neg };
  }
  function formatCount(p, v) {
    var s = Math.abs(v).toFixed(p.decimals), ip = s.split('.')[0], fp = s.split('.')[1];
    if (p.group) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, p.group);
    return p.pre + (v < 0 ? '-' : '') + ip + (fp ? p.dec + fp : '') + p.post;
  }
  // The single text node a count-up animates, or null.
  function countNode(el) {
    if (el.children.length) return null;
    var texts = [];
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) texts.push(c); else if (c.nodeType !== 8) return null;
    return texts.length === 1 && parseCount(texts[0].nodeValue) ? texts[0] : null;
  }
  mod('fade-in', entrance(null));
  mod('fade-up', entrance('translateY(40px)'));
  mod('zoom-in', entrance('scale(0.85)'));
  mod('slide-left', entrance('translateX(60px)'));
  mod('count-up', { category: 'data', waits: false, single: true, previewAs: 'fade-in', why: 'count', applies: function (el) { return !!countNode(el); }, play: playCount });
  mod('fade-down', entrance('translateY(-40px)'));
  mod('slide-right', entrance('translateX(-60px)'));
  mod('zoom-out', entrance('scale(1.15)'));
  // Only where the author set no filter: the blur would replace it while it plays.
  mod('blur-in', entrance(null, { dur: 800, filter: 'blur(12px)', why: 'filter', applies: function (el) { return unfiltered(el); } }));
  mod('pop', entrance('scale(0.6)', { category: 'emphasis', dur: 600, ease: 'cubic-bezier(.34,1.56,.64,1)' }));
  mod('grow-x', { category: 'data', waits: true, dur: 900, why: growWhy, applies: growable, play: playGrow('x') });
  mod('grow-y', { category: 'data', waits: true, dur: 900, why: growWhy, applies: growable, play: playGrow('y') });
  mod('draw', { category: 'data', waits: true, dur: 1400, why: 'draw', applies: function (el) { return shapesOf(el).length > 0; }, targets: shapesOf, play: playDraw });
  mod('spin', loop([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], 'linear', false, 20000));
  mod('float', loop([{ transform: 'translateY(0px)' }, { transform: 'translateY(-8px)' }], 'ease-in-out', true, 3000));
  mod('pulse', loop([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }], 'ease-in-out', true, 1200));
  // v4. Wipe opens the way the block reads (from the right in a right-to-left block); baseline
  // rises while it opens from the bottom (the clip moves with the block: no fixed line).
  mod('wipe', entrance(null, { opacity: false, why: 'clip', applies: clippable, clip: function (el) { return win.getComputedStyle(el).direction === 'rtl' ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)'; } }));
  mod('baseline', entrance('translateY(24px)', { opacity: false, why: 'clip', applies: clippable, clip: function () { return 'inset(100% 0 0 0)'; } }));
  mod('zoom-blur', entrance('scale(0.85)', { dur: 800, filter: 'blur(12px)', why: function (el) { return transformable(el) ? 'filter' : 'inline'; }, applies: function (el) { return transformable(el) && unfiltered(el); } }));
  mod('tumble', entrance([{ transform: 'translateY(-32px) rotate(-18deg)' }, { transform: 'none' }], { dur: 750, why: 'inline', applies: transformable }));
  // Stomp lands hard: big, then a squash and a small rebound, each leg with its own easing.
  mod('stomp', entrance([{ transform: 'scale(1.8)', easing: 'cubic-bezier(.55,0,1,.45)' }, { transform: 'scale(0.94)', offset: 0.65, easing: 'ease-out' },
    { transform: 'scale(1.03)', offset: 0.82, easing: 'ease-in-out' }, { transform: 'none' }],
  { category: 'emphasis', dur: 600, ease: 'linear', fade: [[0, 0], [1, 0.2], [1, 1]], why: 'inline', applies: transformable }));
  mod('scrapbook', entrance([{ transform: 'translateY(-16px) rotate(-8deg) scale(1.25)' }, { transform: 'rotate(2deg) scale(0.98)', offset: 0.72 }, { transform: 'none' }],
    { dur: 650, why: 'inline', applies: transformable }));
  mod('flicker', entrance(null, { dur: 900, ease: 'linear', fade: [[0, 0], [0.85, 0.2], [0.25, 0.35], [1, 0.55], [0.6, 0.7], [1, 1]] }));
  mod('wiggle', loop([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-3deg)', offset: 0.15 }, { transform: 'rotate(3deg)', offset: 0.3 },
    { transform: 'rotate(-2deg)', offset: 0.45 }, { transform: 'rotate(2deg)', offset: 0.6 }, { transform: 'rotate(0deg)' }], 'ease-in-out', false, 1200));
  // A gentle blink (never a hard flash), between the author's opacity and a quarter of it.
  mod('blink', { category: 'loop', waits: false, dur: 1600, play: function (target, i, c, run) {
    var o = parseFloat(win.getComputedStyle(target).opacity);
    run.animate(target, [{ opacity: o }, { opacity: o * 0.25 }, { opacity: o }], loopTiming(c, i, 'ease-in-out', false));
  } });
  function num(v, d) { var n = parseFloat(v); return isFinite(n) && n >= 0 ? n : d; }
  function config(el) {
    var m = MODULES[el.getAttribute('data-fx')];
    if (!m) return null;
    return { m: m, delay: num(el.getAttribute('data-fx-delay'), 0), dur: num(el.getAttribute('data-fx-dur'), m.dur), stagger: num(el.getAttribute('data-fx-stagger'), 0) };
  }
  // Why module m cannot run on el (its `why` key), or null.
  function refusal(el, m) { return m.applies && !m.applies(el) ? (typeof m.why === 'function' ? m.why(el) : m.why || 'bad') : null; }
  // el's effect when it can run here, else null.
  function usable(el) { var c = config(el); return c && !revealOwned(el) && !refusal(el, c.m) ? c : null; }
  // Elements Reveal animates itself: opacity/transform there belong to Reveal.
  function revealOwned(el) {
    return !!(el.closest('.fragment') || el.querySelector('.fragment') ||
      (el.closest('section[data-auto-animate]') && (el.closest('[data-id]') || el.querySelector('[data-id]'))));
  }
  function targets(el, c) {
    if (c.m.targets) return c.m.targets(el, c);
    // A child with its own runnable effect plays that one only; its slot keeps the timing.
    return c.stagger > 0 && !c.m.single
      ? Array.prototype.slice.call(el.children).map(function (n) { return usable(n) || refusal(n, c.m) ? null : n; })
      : [el];
  }
  var reduce = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---- state
  var disposed = false, anims = new Set(), rafs = new Set(), texts = new Map(), active = new Set();
  // One run token per scope: leaving (or replaying) a scope ends only its own count-ups.
  var runs = new Map();
  function track(a) { anims.add(a); a.finished.then(function () { anims.delete(a); }, function () { anims.delete(a); }); return a; }
  function stop(scope) {
    if (scope) runs.set(scope, (runs.get(scope) || 0) + 1); else runs.clear();
    anims.forEach(function (a) { var t = a.effect && a.effect.target; if (!scope || (t && scope.contains(t))) { a.cancel(); anims.delete(a); } });
    texts.forEach(function (orig, node) { if (!scope || scope.contains(node)) { node.nodeValue = orig; texts.delete(node); } });
  }
  // What a module plays through: every animation, frame and text change it makes is tracked
  // here, so stop / replay / settle / dispose / preview undo all of it the same way.
  function runner(scope, t) {
    return {
      alive: function () { return !disposed && (runs.get(scope) || 0) === t; },
      show: function (el) { el.classList.remove('fx-wait'); },
      animate: function (el, frames, o) { return track(el.animate(frames, o)); },
      raf: function (fn) { var id = win.requestAnimationFrame(function (now) { rafs.delete(id); fn(now); }); rafs.add(id); },
      text: function (node, value) { if (!texts.has(node)) texts.set(node, node.nodeValue); node.nodeValue = value; },
      done: function (node) { if (texts.has(node)) { node.nodeValue = texts.get(node); texts.delete(node); } },
      owns: function (node) { return texts.has(node); },
    };
  }

  // ---- scenes: author code per scope (registerScene). The runtime owns their lifecycle: it
  // tracks timers / animations through ctx, and on leaving the scope stops them, removes
  // anime.js (v3) animations on the scope's elements, and restores the scope's authored markup
  // (snapshotted before any scene ran). Scenes should bind listeners by delegation: the scope's
  // children are replaced on restore.
  var scenes = [], sceneRuns = new Map(), sceneBase = new Map();
  function sceneDefsFor(el) { return scenes.filter(function (d) { return el.matches(d.selector); }); }
  function sceneEls(scope) {
    var out = [];
    scenes.forEach(function (d) {
      if (scope.matches(d.selector) && out.indexOf(scope) < 0) out.push(scope);
      Array.prototype.forEach.call(scope.querySelectorAll(d.selector), function (n) { if (out.indexOf(n) < 0) out.push(n); });
    });
    return out;
  }
  // The scope's markup as it is when its scene starts (after any runtime such as Reveal set it
  // up). Only the children are restored: the scope's own class/style can belong to that runtime.
  function snapshot(el) { sceneBase.set(el, el.innerHTML); }
  function startScenes(el) {
    stopScene(el);
    snapshot(el);
    var timers = new Set(), cleanups = [], owned = [], ctrl = 'AbortController' in win ? new win.AbortController() : null, live = true;
    var alive = function () { return live && !disposed; };
    var ctx = {
      alive: alive,
      signal: ctrl && ctrl.signal,
      // Resolves after ms while the scene is alive; never once it is stopped.
      wait: function (ms) { return new Promise(function (r) { var id = win.setTimeout(function () { timers.delete(id); if (alive()) r(); }, ms); timers.add(id); }); },
      timeout: function (fn, ms) { var id = win.setTimeout(function () { timers.delete(id); if (alive()) fn(); }, ms); timers.add(id); return id; },
      animate: function (t, frames, o) { var a = t.animate(frames, o); track(a); owned.push(a); return a; },
      anime: function (params) { var A = win.anime; if (!A) return null; var i = A(params); cleanups.push(function () { i.pause(); }); return i; },
      onCleanup: function (fn) { cleanups.push(fn); },
    };
    sceneRuns.set(el, { stop: function () { live = false; if (ctrl) ctrl.abort(); owned.forEach(function (a) { a.cancel(); anims.delete(a); }); timers.forEach(function (id) { win.clearTimeout(id); }); cleanups.forEach(function (f) { try { f(); } catch (e) { /* scene cleanup */ } }); } });
    sceneDefsFor(el).forEach(function (d) {
      try { var r = d.fn(el, ctx); if (r && typeof r.catch === 'function') r.catch(function () {}); }
      catch (e) { if (win.console) win.console.error('HtmlDeck scene "' + d.name + '":', e); }
    });
  }
  function stopScene(el) {
    var run = sceneRuns.get(el);
    if (!run) return;
    sceneRuns.delete(el);
    run.stop();
    var A = win.anime;
    if (A && typeof A.remove === 'function') { try { A.remove([el].concat(Array.prototype.slice.call(el.querySelectorAll('*')))); } catch (e) { /* not v3 */ } }
    stop(el);
    var html = sceneBase.get(el);
    sceneBase.delete(el);
    if (html != null && el.innerHTML !== html) el.innerHTML = html;
    // Reveal re-applies fragment visibility for the current slide after its children changed.
    var R = win.Reveal;
    if (R && typeof R.syncFragments === 'function' && el.closest && el.closest('.reveal')) { try { R.syncFragments(); } catch (e) { /* not ready */ } }
  }
  function registerScene(name, fn, o) {
    if (opts.preview || typeof fn !== 'function') return;
    var d = { name: String(name), fn: fn, selector: (o && o.selector) || '[data-fx-scene="' + String(name).replace(/"/g, '') + '"]' };
    scenes.push(d);
    if (io) Array.prototype.forEach.call(doc.querySelectorAll(d.selector), function (n) { io.observe(n); });
    active.forEach(function (scope) { sceneEls(scope).forEach(function (n) { if (sceneDefsFor(n).indexOf(d) >= 0) startScenes(n); }); });
  }

  // Entrances: shown first, then measured, so the author's opacity / filter (not the waiting
  // state's) is the end value; same task as animate(), so nothing is painted in between. A clip
  // ends fully open (inset 0), the author having none: the animation then ends and leaves none.
  function playEnter(target, i, c, run) {
    var m = c.m, o = { duration: c.dur, delay: c.delay + i * c.stagger, easing: m.ease || EASE, fill: 'backwards' }, cs;
    run.show(target);
    var frames = [{}, {}];
    if (m.opacity || m.filter) cs = win.getComputedStyle(target);
    if (m.opacity && m.fade) {
      var op = parseFloat(cs.opacity);
      run.animate(target, m.fade.map(function (f) { return { opacity: f[0] * op, offset: f[1] }; }), o);
    } else if (m.opacity) { frames[0].opacity = 0; frames[1].opacity = cs.opacity; }
    if (m.filter) { frames[0].filter = m.filter; frames[1].filter = cs.filter; }
    if (m.clip) { frames[0].clipPath = m.clip(target); frames[1].clipPath = 'inset(0 0 0 0)'; }
    if (Object.keys(frames[0]).length) run.animate(target, frames, o);
    if (m.from) run.animate(target, typeof m.from === 'string' ? [{ transform: m.from }, { transform: 'none' }] : m.from,
      { duration: o.duration, delay: o.delay, easing: o.easing, fill: o.fill, composite: 'add' });
  }
  function playCount(target, i, c, run) {
    var node = countNode(target);
    run.show(target);
    if (!node) return;
    var spec = parseCount(node.nodeValue), delay = c.delay + i * c.stagger, t0 = null;
    run.text(node, formatCount(spec, 0));
    run.raf(function step(now) {
      if (!run.alive() || !run.owns(node)) return;
      if (t0 === null) t0 = now + delay;
      var k = Math.min(1, Math.max(0, (now - t0) / c.dur)), e = 1 - Math.pow(1 - k, 3);
      if (k >= 1) { run.done(node); return; }
      node.nodeValue = formatCount(spec, spec.value * e);
      run.raf(step);
    });
  }
  // Bars, rules, columns: a scale from one edge composited onto the author's transform. The
  // origin is an animation too (replace mode, same timing), never a written style.
  function playGrow(axis) {
    return function (target, i, c, run) {
      var o = { duration: c.dur, delay: c.delay + i * c.stagger, easing: EASE, fill: 'backwards' };
      var origin = axis === 'y' ? 'center bottom' : win.getComputedStyle(target).direction === 'rtl' ? 'right center' : 'left center';
      // An SVG shape scales from its own box, not from the viewport's.
      var pivot = svgShape(target) ? { transformOrigin: origin, transformBox: 'fill-box' } : { transformOrigin: origin };
      run.show(target);
      run.animate(target, [pivot, pivot], o);
      run.animate(target, [{ transform: axis === 'y' ? 'scaleY(0)' : 'scaleX(0)' }, { transform: 'none' }], { duration: o.duration, delay: o.delay, easing: o.easing, fill: o.fill, composite: 'add' });
    };
  }
  function svgShape(el) { return !!el.ownerSVGElement; }
  // A transform does nothing on inline text.
  function transformable(el) { return svgShape(el) || win.getComputedStyle(el).display !== 'inline'; }
  // grow moves the pivot while it plays: only where the author's transform has none that
  // matters (no transform, or a pure translation).
  function plainTransform(el) {
    var cs = win.getComputedStyle(el), tf = cs.transform;
    if ((cs.rotate && cs.rotate !== 'none') || (cs.scale && cs.scale !== 'none')) return false;
    if (tf === 'none') return true;
    var m = /^matrix(3d)?\(([^)]*)\)$/.exec(tf);
    if (!m) return false;
    var v = m[2].split(',').map(parseFloat);
    // Identity apart from the translation entries (2D: e, f; 3D: m41..m43).
    var id = m[1] ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, null, null, null, 1] : [1, 0, 0, 1, null, null];
    for (var i = 0; i < id.length; i++) if (id[i] !== null && v[i] !== id[i]) return false;
    return true;
  }
  function unfiltered(el) { return win.getComputedStyle(el).filter === 'none'; }
  // A clip-path replaces the author's own, and clips an HTML box (not an SVG shape or a run of text).
  function clippable(el) { var cs = win.getComputedStyle(el); return !svgShape(el) && cs.display !== 'inline' && cs.clipPath === 'none'; }
  function growable(el) { return (svgShape(el) || win.getComputedStyle(el).display !== 'inline') && plainTransform(el); }
  function growWhy(el) { return svgShape(el) || win.getComputedStyle(el).display !== 'inline' ? 'transform' : 'inline'; }
  // Strokes of the SVG shapes inside an element (or the shape itself), drawn in document order.
  // Authored dashes are the author's; shapes with their own data-fx play that instead.
  var SHAPES = 'path,line,polyline,polygon,circle,ellipse,rect';
  // Dash units follow an authored pathLength; getTotalLength() does not.
  function strokeLength(s) {
    var pl = parseFloat(s.getAttribute('pathLength'));
    if (pl > 0) return pl;
    try { return s.getTotalLength(); } catch (e) { return 0; }
  }
  function ownShape(s, el) { for (var n = s; n && n !== el; n = n.parentElement) if (n.hasAttribute('data-fx')) return false; return true; }
  function shapesOf(el) {
    var list = el.matches(SHAPES) ? [el] : Array.prototype.slice.call(el.querySelectorAll(SHAPES));
    return list.filter(function (s) {
      var cs = win.getComputedStyle(s);
      // The nearest data-fx owns a shape (a nested draw group keeps its own timing); a
      // non-scaling stroke is dashed in other units than its length.
      return ownShape(s, el) && cs.stroke !== 'none' && cs.strokeDasharray === 'none' && cs.display !== 'none' &&
        cs.vectorEffect !== 'non-scaling-stroke' && strokeLength(s) > 0;
    });
  }
  function playDraw(shape, i, c, run) {
    var len = strokeLength(shape), dash = len + ' ' + len;
    run.show(shape);
    run.animate(shape, [{ strokeDasharray: dash, strokeDashoffset: len }, { strokeDasharray: dash, strokeDashoffset: 0 }],
      { duration: c.dur, delay: c.delay + i * c.stagger, easing: 'ease-in-out', fill: 'backwards' });
  }
  // Loops: added onto the author's transform, stopped like every other animation on leaving.
  function loop(frames, easing, alternate, dur) {
    return {
      category: 'loop', waits: false, dur: dur, why: 'inline', applies: transformable,
      play: function (target, i, c, run) {
        var o = loopTiming(c, i, easing, alternate);
        o.composite = 'add';
        run.animate(target, frames, o);
      },
    };
  }
  // An editor preview plays 2 short iterations, never forever.
  function loopTiming(c, i, easing, alternate) {
    return { duration: c.preview ? Math.min(c.dur, 2000) : c.dur, delay: c.delay + i * c.stagger, easing: easing,
      iterations: c.preview ? 2 : Infinity, direction: alternate ? 'alternate' : 'normal' };
  }
  // Play el's effect inside `scope` under run token t. A module that throws leaves its target
  // visible as authored; the rest of the scope keeps playing.
  var failed = {};
  function play(el, c, scope, t) {
    var run = runner(scope, t);
    targets(el, c).forEach(function (target, i) {
      if (!target) return;
      try { c.m.play(target, i, c, run); }
      catch (e) {
        anims.forEach(function (a) { if (a.effect && a.effect.target === target) { a.cancel(); anims.delete(a); } });
        target.classList.remove('fx-wait');
        if (!failed[c.m.name] && win.console) { failed[c.m.name] = true; win.console.error('HtmlDeck FX "' + c.m.name + '":', e); }
      }
    });
  }
  function fxIn(scope) {
    var list = scope.matches && scope.matches('[data-fx]') ? [scope] : [];
    return list.concat(Array.prototype.slice.call(scope.querySelectorAll('[data-fx]')));
  }
  function prepare(scope) {
    fxIn(scope).forEach(function (el) {
      var c = usable(el);
      if (c && c.m.waits) targets(el, c).forEach(function (t) { if (t) t.classList.add('fx-wait'); });
    });
  }
  function activate(scope) {
    if (disposed || !scope) return;
    deactivate(scope);
    active.add(scope);
    var t = runs.get(scope) || 0;
    if (reduce) return;
    fxIn(scope).forEach(function (el) { var c = usable(el); if (c) play(el, c, scope, t); });
    // Whatever was prepared but did not play (refused by now, e.g. a class added since) shows.
    if (scope.classList) scope.classList.remove('fx-wait');
    Array.prototype.forEach.call(scope.querySelectorAll('.fx-wait'), function (n) { n.classList.remove('fx-wait'); });
    sceneEls(scope).forEach(startScenes);
  }
  // Leaving a scope: cancel and re-arm, so it plays again next time.
  function deactivate(scope) {
    if (!scope) return;
    sceneEls(scope).forEach(stopScene);
    stop(scope);
    active.delete(scope);
    if (!disposed && !reduce) prepare(scope);
  }
  function settle() {
    stop(null);
    rafs.forEach(function (id) { win.cancelAnimationFrame(id); }); rafs.clear();
    Array.prototype.forEach.call(doc.querySelectorAll('.fx-wait'), function (n) { n.classList.remove('fx-wait'); });
  }

  // ---- automatic triggers (standalone file, or a page): IntersectionObserver / Reveal events.
  var io = null, revealHooks = null;
  function scopeOf(el) { return el.closest('section, .slide') || el; }
  function auto() {
    var R = win.Reveal;
    if (R && typeof R.on === 'function' && doc.querySelector('.reveal .slides')) {
      var onChange = function () { if (R.isOverview && R.isOverview()) { settleScopes(); return; } activeOnly(R.getCurrentSlide()); };
      var onReady = function () { onChange(); };
      var hook = function () { ['slidechanged', 'overviewshown', 'overviewhidden'].forEach(function (e) { R.on(e, onChange); }); };
      try { hook(); if (R.isReady && R.isReady()) onReady(); else R.on('ready', onReady); } catch (e) { return; }
      revealHooks = function () { ['slidechanged', 'overviewshown', 'overviewhidden', 'ready'].forEach(function (e) { try { R.off(e, onChange); R.off(e, onReady); } catch (x) {} }); };
      return;
    }
    if (!('IntersectionObserver' in win)) { settle(); return; }
    io = new win.IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var tall = e.boundingClientRect.height > win.innerHeight * 0.6;
        if (e.isIntersecting && (e.intersectionRatio >= 0.3 || tall)) { if (!active.has(e.target)) activate(e.target); }
        else if (!e.isIntersecting && active.has(e.target)) deactivate(e.target);
      });
    }, { threshold: [0, 0.3] });
    var seen = new Set();
    Array.prototype.forEach.call(doc.querySelectorAll('[data-fx]'), function (el) { var s = scopeOf(el); if (!seen.has(s)) { seen.add(s); io.observe(s); } });
    scenes.forEach(function (d) { Array.prototype.forEach.call(doc.querySelectorAll(d.selector), function (n) { if (!seen.has(n)) { seen.add(n); io.observe(n); } }); });
  }
  function activeOnly(scope) {
    active.forEach(function (s) { if (s !== scope) deactivate(s); });
    if (scope) activate(scope);
  }
  function settleScopes() { sceneRuns.forEach(function (r, el) { stopScene(el); }); active.forEach(function (s) { stop(s); }); active.clear(); settle(); }

  // Editor previews never write the DOM: a count-up previews as a fade (its text is what the
  // editor is editing); loops play 2 short iterations.
  function forPreview(c) {
    var m = c.m.previewAs ? MODULES[c.m.previewAs] : c.m;
    return { m: m, delay: c.delay, dur: c.dur, stagger: c.m.previewAs ? 0 : c.stagger, preview: true };
  }
  var api = {
    version: 4,
    parseCount: parseCount,
    presets: Object.keys(MODULES),
    // Editor: why preset `name` cannot run on el (null when it can), and the module list.
    check: function (el, name) { var m = MODULES[name]; return !m ? 'unknown' : revealOwned(el) ? 'reveal' : refusal(el, m); },
    catalog: function () { return Object.keys(MODULES).map(function (n) { return { name: n, category: MODULES[n].category, dur: MODULES[n].dur }; }); },
    // Present bootstraps drive the slides themselves.
    control: function () { if (io) { io.disconnect(); io = null; } if (revealHooks) { revealHooks(); revealHooks = null; } return api; },
    show: activeOnly,
    registerScene: registerScene,
    // Play a scope again from its authored state (e.g. a replay button).
    replay: function (scope) { if (scope && !disposed) { deactivate(scope); activate(scope); } },
    settle: function () { settleScopes(); },
    dispose: function () {
      if (disposed) return;
      disposed = true;
      api.control();
      settleScopes();
      root.classList.remove('fx-on');
      if (style) style.remove();
    },
    // Editor preview: play one element's effect now, cancelled by stopPreview(). Never writes
    // the DOM: a count-up previews as a fade (its text is what the editor is editing).
    preview: function (el) {
      api.stopPreview();
      var c = usable(el);
      if (!c || reduce) return;
      play(el, forPreview(c), el, runs.get(el) || 0);
    },
    stopPreview: function () { stop(null); settle(); },
    // Every data-fx inside a scope at once (the effects panel's "preview slide").
    previewAll: function (scope) {
      api.stopPreview();
      if (reduce || !scope) return;
      fxIn(scope).forEach(function (el) { var c = usable(el); if (c) play(el, forPreview(c), scope, runs.get(scope) || 0); });
    },
  };
  if (opts.preview) return api;

  // Never in the editor's edit frame: only when presenting (ed-presenting is set before scripts).
  var editor = false;
  try { editor = win.parent !== win && typeof win.parent.__edKey === 'function'; } catch (e) { editor = false; }
  if (editor && !root.classList.contains('ed-presenting')) return api;
  if (win.__htmldeckFx) return win.__htmldeckFx;            // one runtime per document
  var style = doc.createElement('style');
  style.setAttribute('data-htmldeck-fx-style', '');
  style.textContent = 'html.fx-on .fx-wait{opacity:0!important}';
  doc.head.appendChild(style);
  win.__htmldeckFx = api;
  // Scenes registered before the runtime loaded wait in a queue (see registerScene).
  var queued = win.__htmldeckScenes;
  win.__htmldeckScenes = { push: function (args) { registerScene.apply(null, args); } };
  if (queued && queued.forEach) queued.forEach(function (args) { registerScene.apply(null, args); });
  if (!reduce) {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-fx]'), function (el) { prepare(el); });
    root.classList.add('fx-on');
  }
  if (!opts.controlled) auto();
  return api;
}

// The inline block a document carries once FX is enabled.
// LF only: a checkout with CRLF line ends (git on Windows) must not put \r into the document,
// whose saved bytes are matched against the source.
export function fxScriptSource() {
  return `\n/* HtmlDeck FX v${FX_VERSION} — data-fx effects (Web Animations). Managed by HtmlDeck: "Disable FX" removes it. */\n(${fxRuntime.toString().replace(/\r\n?/g, '\n')})(window);\n`;
}
