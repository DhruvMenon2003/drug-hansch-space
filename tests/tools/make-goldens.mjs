#!/usr/bin/env node
// make-goldens.mjs - regenerates tests/golden/original.json from the ORIGINAL app (the pre-split, single-file app.js with
// vendor wiring and a window.__dbg hook), never from the code under test. It drives the recipe in tests/helpers/snapshot.mjs
// and writes what the original produced. Refuses to run against a page that is not the original.
//
//   python3 -m http.server 4183 --directory <path to the original, vendor-wired copy>
//   node tests/tools/make-goldens.mjs [--base http://localhost:4183/] [--out tests/golden/original.json]
//
// The output has no timestamps, so regenerating from the same original gives a byte-identical file.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GL_ARGS } from '../../playwright.config.mjs';
import { CONTEXT, SEQUENCE, hookOf, runSequence } from '../helpers/snapshot.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://localhost:4183/'), here = dirname(fileURLToPath(import.meta.url));
const out = resolve(arg('--out', resolve(here, '../golden/original.json')));
const ORIGINAL_APP_JS_SHA1 = 'f9bd470e083babe8525750998fdcf2b1852a3f03';   // explorer/app.js of the upstream project, 948 lines

const sha1 = b => createHash('sha1').update(b).digest('hex');
const appJs = await (await fetch(new URL('app.js', base))).text();
const withoutHook = appJs.split('\n').filter(l => !l.startsWith('window.__dbg')).join('\n');
if (sha1(withoutHook) !== ORIGINAL_APP_JS_SHA1) throw new Error(`${base}app.js is not the original app.js (sha1 ${sha1(withoutHook)} after dropping the window.__dbg lines)`);

const browser = await chromium.launch({ args: GL_ARGS });
const page = await (await browser.newContext(CONTEXT)).newPage();
const problems = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => problems.push(`[pageerror] ${e.message}`));
await page.goto(new URL('index.html', base).href);
const hook = await hookOf(page);
if (hook !== '__dbg') throw new Error(`expected the original app's window.__dbg hook, found ${hook}`);
const result = await runSequence(page, hook, id => process.stderr.write(`  ${id}\n`));
await browser.close();
if (problems.length) console.error('console problems while generating:\n' + problems.join('\n'));

const golden = {
  meta: {
    generator: 'tests/tools/make-goldens.mjs',
    source: 'the original single-file app (window.__dbg hook), not the code under test',
    originalAppJsSha1: ORIGINAL_APP_JS_SHA1, viewport: CONTEXT.viewport, hook, drugs: result.boot.options[9].n,
    recipe: ['load', ...SEQUENCE.map(s => s.id)],
  },
  boot: result.boot,
  views: result.views,
};
mkdirSync(dirname(out), { recursive: true });
// one view per line: small, and a diff shows which view moved
const line = o => JSON.stringify(o);
writeFileSync(out, `{\n"meta": ${line(golden.meta)},\n"boot": ${line(golden.boot)},\n"views": {\n${Object.entries(golden.views).map(([k, v]) => `${JSON.stringify(k)}: ${line(v)}`).join(',\n')}\n}\n}\n`);
console.log(`wrote ${out}: ${Object.keys(golden.views).length} views`);
