// Architecture check for the editor's ES modules (run by `npm run lint`).
// Layers, bottom to top; a module may import from its own layer or below, never above:
//   0 foundation  core/ runtime/ policy/ formats/ fx/ shared/ i18n.mjs services/api.mjs
//   1 editor      editor/
//   2 features    features/ services/ present/ (except present/controller.mjs)
//   3 ui          ui/ present/controller.mjs
//   4 app         app.mjs
// Import cycles are forbidden at every layer. Every import must name an existing file with its
// exact case (macOS and Windows forgive a wrong case; Linux does not).
// The baseline (tools/architecture-baseline.json) lists the violations still to remove; it can
// only shrink: a new violation fails, and so does an allowance that is no longer needed.
//
//   node tools/check-architecture.mjs [--root htmldeck/web/js] [--baseline tools/architecture-baseline.json] [--write-baseline]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const espree = require('espree');
const eslintScope = require('eslint-scope');

const LAYERS = [
  ['services/api.mjs', 0], ['present/controller.mjs', 3],
  ['core/', 0], ['runtime/', 0], ['policy/', 0], ['formats/', 0], ['fx/', 0], ['shared/', 0], ['i18n.mjs', 0],
  ['editor/', 1], ['features/', 2], ['services/', 2], ['present/', 2], ['ui/', 3], ['app.mjs', 4],
];
const NAMES = ['foundation', 'editor', 'features', 'ui', 'app'];

function opts(argv) {
  const o = { root: 'htmldeck/web/js', baseline: 'tools/architecture-baseline.json', write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write-baseline') o.write = true;
    else o[argv[i].slice(2)] = argv[++i];
  }
  return o;
}

const layerOf = rel => {
  const hit = LAYERS.find(([p]) => rel === p || (p.endsWith('/') && rel.startsWith(p)));
  return hit ? hit[1] : null;
};

function modules(root) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  })(root);
  return out.sort();
}

// Specifiers of static imports, re-exports and literal dynamic imports; the names each static
// import asks for; the names the module exports (null when it re-exports `*`: not checked).
function parseModule(src) {
  const ast = espree.parse(src, { ecmaVersion: 2022, sourceType: 'module', range: true });
  const out = [], wants = [], exports = new Set();
  let star = false;
  const names = p => p.type === 'Identifier' ? [p.name]
    : p.type === 'ObjectPattern' ? p.properties.flatMap(q => names(q.type === 'RestElement' ? q.argument : q.value))
    : p.type === 'ArrayPattern' ? p.elements.filter(Boolean).flatMap(q => names(q.type === 'RestElement' ? q.argument : q))
    : p.type === 'AssignmentPattern' ? names(p.left) : [];
  const key = x => x.type === 'Literal' ? String(x.value) : x.name;
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration')
      for (const s of n.specifiers) {
        if (s.type === 'ImportSpecifier') wants.push([n.source.value, key(s.imported)]);
        if (s.type === 'ImportDefaultSpecifier') wants.push([n.source.value, 'default']);
      }
    if (n.type === 'ExportDefaultDeclaration') exports.add('default');
    if (n.type === 'ExportAllDeclaration') { if (n.exported) exports.add(key(n.exported)); else star = true; }
    if (n.type === 'ExportNamedDeclaration') {
      const d = n.declaration;
      if (d?.type === 'VariableDeclaration') d.declarations.forEach(x => names(x.id).forEach(i => exports.add(i)));
      else if (d?.id) exports.add(d.id.name);
      for (const s of n.specifiers) {
        exports.add(key(s.exported));
        if (n.source) wants.push([n.source.value, key(s.local)]);   // re-exported: must exist there
      }
    }
  }
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || n.type === 'ExportNamedDeclaration') && n.source) out.push(n.source.value);
    if (n.type === 'ImportExpression' && n.source.type === 'Literal') out.push(n.source.value);
    for (const k in n) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
  // Free names (not declared or imported here): a project name among them would silently
  // resolve to a browser global of the same name (History, Selection, Range…).
  const sm = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
  const free = new Set(sm.globalScope.childScopes[0].through.map(r => r.identifier.name));
  const aliases = new Set(ast.body.filter(n => n.type === 'ImportDeclaration').flatMap(n => n.specifiers.map(s => s.local.name)));
  // `hooks.x` uses, and the names app.mjs passes to installHooks({...}).
  const hookUses = new Set(), installs = [];
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === 'hooks') hookUses.add(n.property.name);
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'installHooks' && n.arguments[0]?.type === 'ObjectExpression')
      for (const p of n.arguments[0].properties) if (p.key) installs.push(p.key.name);
    for (const k in n) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
  return { specs: out, wants, exports: star ? null : exports, explicit: exports, free, aliases, hookUses, installs };
}

// Exact-case existence: every path segment must match a directory entry.
function existsExact(root, rel) {
  let dir = root;
  for (const seg of rel.split('/')) {
    if (!fs.existsSync(dir) || !fs.readdirSync(dir).includes(seg)) return false;
    dir = path.join(dir, seg);
  }
  return true;
}

function cycles(graph) {
  const idx = new Map(), low = new Map(), on = new Set(), stack = [], groups = [];
  let n = 0;
  const visit = v => {
    idx.set(v, n); low.set(v, n); n++; stack.push(v); on.add(v);
    for (const w of graph.get(v) || []) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const g = [];
      let w;
      do { w = stack.pop(); on.delete(w); g.push(w); } while (w !== v);
      if (g.length > 1 || (graph.get(v) || []).includes(v)) groups.push(g.sort());
    }
  };
  for (const v of graph.keys()) if (!idx.has(v)) visit(v);
  return groups;
}

function main() {
  const o = opts(process.argv.slice(2));
  const root = path.resolve(o.root);
  const errors = [], upward = [], graph = new Map(), parsed = new Map();
  for (const rel of modules(root)) parsed.set(rel, parseModule(fs.readFileSync(path.join(root, rel), 'utf8')));
  const projectNames = new Set();
  for (const mod of parsed.values()) { mod.explicit.forEach(n => projectNames.add(n)); mod.aliases.forEach(n => projectNames.add(n)); }
  projectNames.delete('default');
  for (const rel of parsed.keys()) if (layerOf(rel) === null) errors.push(`${rel}: not in any layer (add its folder to LAYERS in tools/check-architecture.mjs)`);
  // Every hook a module calls must be installed by app.mjs, and every installed one used.
  const app = parsed.get('app.mjs');
  if (app?.installs.length) {
    const used = new Set([...parsed].filter(([r]) => r !== 'app.mjs' && r !== 'shared/hooks.mjs').flatMap(([, m]) => [...m.hookUses]));
    for (const h of used) if (!app.installs.includes(h)) errors.push(`hook '${h}' is used but app.mjs does not install it`);
    for (const h of app.installs) if (!used.has(h)) errors.push(`app.mjs installs hook '${h}' that nothing uses`);
  }
  for (const [rel, mod] of parsed) {
    for (const n of mod.free) if (projectNames.has(n)) errors.push(`${rel}: uses '${n}' without importing it (it would be the browser's global '${n}', if any)`);
    const deps = new Set();
    // A missing export makes the browser reject the whole module graph: a blank editor.
    for (const [spec, name] of mod.wants) {
      if (!spec.startsWith('.')) continue;
      const exp = parsed.get(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)))?.exports;
      if (exp && !exp.has(name)) errors.push(`${rel}: imports '${name}' from '${spec}', which does not export it`);
    }
    for (const spec of mod.specs) {
      if (!spec.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (!existsExact(root, target)) { errors.push(`${rel}: import '${spec}' does not name an existing file (check the case)`); continue; }
      deps.add(target);
      const a = layerOf(rel), b = layerOf(target);
      if (a !== null && b !== null && b > a) upward.push(`${rel} -> ${target}`);
    }
    graph.set(rel, [...deps]);
  }
  const inCycles = [...new Set(cycles(graph).flat())].sort();
  const found = { upward: [...new Set(upward)].sort(), cycles: inCycles };
  if (o.write) {
    fs.writeFileSync(o.baseline, JSON.stringify(found, null, 2) + '\n');
    console.log(`baseline written: ${found.upward.length} upward imports, ${found.cycles.length} modules in cycles`);
    return;
  }
  const base = JSON.parse(fs.readFileSync(o.baseline, 'utf8'));
  const allowed = { upward: new Set(base.upward || []), cycles: new Set(base.cycles || []) };
  for (const e of found.upward) if (!allowed.upward.has(e)) {
    const [a, b] = e.split(' -> ');
    errors.push(`upward import ${e} (${NAMES[layerOf(a)]} may not import ${NAMES[layerOf(b)]})`);
  }
  for (const m of found.cycles) if (!allowed.cycles.has(m)) errors.push(`import cycle through ${m}`);
  for (const e of allowed.upward) if (!found.upward.includes(e)) errors.push(`baseline: ${e} is no longer imported — remove it (--write-baseline)`);
  for (const m of allowed.cycles) if (!found.cycles.includes(m)) errors.push(`baseline: ${m} is no longer in a cycle — remove it (--write-baseline)`);
  if (errors.length) {
    console.error(`architecture check failed (${errors.length}):\n` + errors.map(e => '  - ' + e).join('\n'));
    process.exit(1);
  }
  console.log(`architecture OK: ${found.upward.length} upward imports and ${found.cycles.length} modules in cycles left in the baseline`);
}

main();
