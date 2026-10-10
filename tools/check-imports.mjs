#!/usr/bin/env node
// Import-graph guard (node stdlib only). Reads tools/layers.json and every .js file under <root>/js and fails when:
// a file has no layer; an import (static or dynamic) points at the same or a higher layer; the graph has a cycle;
// 'three' is imported outside the GL files; a non-GL file imports a GL file (the entry may, dynamically);
// the entry's static imports go beyond mainStatic; a relative import does not resolve.   Usage: node tools/check-imports.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), cfg = JSON.parse(readFileSync(join(here, 'layers.json'), 'utf8'));
const root = resolve(here, '..', cfg.root), L = cfg.layers, errors = [], edges = new Map();
const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []);
const files = walk(join(root, 'js')).map(f => relative(root, f).split('\\').join('/'));
const isGl = f => cfg.glPrefixes.some(p => f.startsWith(p));
const RES = [/^\s*(?:import|export)\b[^'";]*?\bfrom\s*(['"])(.+?)\1/gm, /^\s*import\s*(['"])(.+?)\1/gm, /\bimport\(\s*(['"])(.+?)\1\s*\)/g];
for (const f of files) {
  if (!(f in L)) errors.push(`${f}: no layer in tools/layers.json`);
  const text = readFileSync(join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  edges.set(f, []);
  for (const [i, re] of RES.entries()) for (const m of text.matchAll(re)) {
    const spec = m[2], dynamic = i === 2;
    if (spec === 'three' || spec.startsWith('three/')) { if (!isGl(f)) errors.push(`${f}: imports '${spec}' outside the GL files`); continue; }
    if (!spec.startsWith('.')) { errors.push(`${f}: unsupported bare/absolute import '${spec}'`); continue; }
    const t = relative(root, resolve(root, dirname(f), spec)).split('\\').join('/');
    if (!existsSync(join(root, t))) { errors.push(`${f}: '${spec}' does not resolve`); continue; }
    edges.get(f).push(t);
    if (!(t in L) || !(f in L)) continue;
    if (L[t] >= L[f]) errors.push(`${f} (layer ${L[f]}) imports ${t} (layer ${L[t]}): imports must point to a strictly lower layer`);
    if (isGl(t) && !isGl(f) && f !== cfg.entry) errors.push(`${f}: core code must not import GL code (${t})`);
    if (f === cfg.entry && !dynamic && !cfg.mainStatic.includes(t)) errors.push(`${f}: static import of ${t}; the entry may only statically import ${cfg.mainStatic.join(', ')}`);
  }
}
const state = new Map();
const visit = (f, path) => {
  if (state.get(f) === 2) return;
  if (state.get(f) === 1) { errors.push(`import cycle: ${[...path.slice(path.indexOf(f)), f].join(' -> ')}`); return; }
  state.set(f, 1);
  for (const t of edges.get(f) || []) visit(t, [...path, f]);
  state.set(f, 2);
};
files.forEach(f => visit(f, []));
for (const f of Object.keys(L)) if (!files.includes(f)) errors.push(`${f}: listed in layers.json but missing on disk`);
if (errors.length) { console.error(`check-imports: ${errors.length} problem(s)\n  ` + errors.join('\n  ')); process.exit(1); }
console.log(`check-imports: ok (${files.length} modules, ${[...edges.values()].reduce((n, e) => n + e.length, 0)} imports, ${new Set(Object.values(L)).size} layers)`);
