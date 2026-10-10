#!/usr/bin/env node
// pixel-compare.mjs - live screenshot comparison of the ORIGINAL app against the current site for the 8 tour steps, at
// 1280x800 and 390x844 (sphere LOD acceptance: <= 1 % of pixels visibly differ per step; pctAny also counts silhouette
// anti-aliasing differences of a few grey levels, which no lower sphere resolution can avoid). Not part of the test run (it needs the
// oracle server); the S2a numbers are in tests/golden/README.md.
//
//   python3 -m http.server 4203 --directory <scratchpad>/arch/site          # the oracle
//   node tests/tools/pixel-compare.mjs --orig http://localhost:4203/ --new http://localhost:4201/ [--head-shell] [--out dir]
//
// --head-shell serves the committed (HEAD) index.html and style.css to the new site, so that deliberate shell changes
// (tokens, layout) do not count as pixel differences and only the 3D rendering is compared.
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GL_ARGS } from '../../playwright.config.mjs';
import { decodePng, diffPerceptual, diffPng } from '../helpers/png.mjs';
import { STEP_NAMES } from '../helpers/snapshot.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const orig = arg('--orig', 'http://localhost:4203/'), neu = arg('--new', 'http://localhost:4201/'), out = resolve(arg('--out', 'test-results/pixels'));
const headShell = process.argv.includes('--head-shell');
mkdirSync(out, { recursive: true });
const head = p => execSync(`git show HEAD:${p}`, { cwd: resolve(import.meta.dirname, '../..'), maxBuffer: 1 << 24 });

async function shoot(browser, base, hook, opts, name, useHead) {
  const page = await (await browser.newContext(opts)).newPage();
  if (useHead) {
    await page.route('**/style.css*', r => r.fulfill({ body: head('site/style.css'), contentType: 'text/css' }));
    await page.route(/\/index\.html/, r => r.fulfill({ body: head('site/index.html'), contentType: 'text/html' }));
  }
  await page.goto(new URL(hook === '__hansch' ? 'index.html?debug' : 'index.html', base).href);
  await page.waitForFunction(h => window[h]?.stage?.points && document.querySelector('#stage-status').hidden, hook, { timeout: 60_000 });
  const shots = {};
  for (const s of STEP_NAMES) {
    await page.evaluate(([h, n]) => window[h].goStep(n), [hook, s]);
    await page.waitForFunction(h => window[h].anim.t >= 1 && window.gsap.globalTimeline.getChildren(false, true, true).every(k => k.paused()), hook, { timeout: 30_000 }).catch(() => {});
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
    await page.waitForTimeout(500);
    const buf = await page.screenshot({ type: 'png' });
    writeFileSync(`${out}/${name}-${s}.png`, buf);
    shots[s] = decodePng(buf);
  }
  await page.context().close();
  return shots;
}

const browser = await chromium.launch({ args: GL_ARGS });
const configs = [
  ['desktop-1280x800', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light' }],
  ['phone-390x844', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'light' }],
];
let worst = 0;
for (const [label, opts] of configs) {
  const A = await shoot(browser, orig, '__dbg', opts, `orig-${label}`, false);
  const B = await shoot(browser, neu, '__hansch', opts, `new-${label}`, headShell);
  console.log(`== ${label}`);
  for (const s of STEP_NAMES) {
    const d = { ...diffPng(A[s], B[s]), ...diffPerceptual(A[s], B[s]) };
    worst = Math.max(worst, d.pctPerceptual ?? 100);
    console.log(s.padEnd(10), JSON.stringify(d));
  }
}
await browser.close();
console.log(`worst share of visibly differing pixels (pixelmatch YIQ, threshold 0.2) in any step: ${worst} %  (limit 1 %)`);
process.exit(worst <= 1 ? 0 : 1);
