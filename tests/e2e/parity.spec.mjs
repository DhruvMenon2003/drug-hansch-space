// parity.spec.mjs - the S1 acceptance gate: the split, vendor-wired site must behave exactly like the ORIGINAL app.
// tests/golden/original.json was produced from the original by tests/tools/make-goldens.mjs (never from this code). The
// recipe in tests/helpers/snapshot.mjs is replayed here through window.__hansch (?debug) and every snapshot is compared.
// Also: zero console errors/warnings, zero cross-origin requests, selection through the search box, tour by scrolling.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { CONTEXT, STEP_NAMES, runSequence, settle, snapshot, waitReady } from '../helpers/snapshot.mjs';

const golden = JSON.parse(readFileSync(new URL('../golden/original.json', import.meta.url), 'utf8'));

/** Open the site with ?debug and collect console problems and every request origin. */
async function open(browser, baseURL) {
  const page = await (await browser.newContext(CONTEXT)).newPage();
  const watch = { problems: [], origins: new Set(), urls: [] };
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) watch.problems.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => watch.problems.push(`[pageerror] ${e.message}`));
  page.on('request', r => { const u = new URL(r.url()); if (!['data:', 'blob:'].includes(u.protocol)) { watch.origins.add(u.origin); watch.urls.push(r.url()); } });
  await page.goto(new URL('index.html?debug', baseURL).href);
  await page.waitForFunction(() => !!window.__hansch);
  return { page, watch, origin: new URL(baseURL).origin };
}

test.describe('parity with the original app', () => {
  test.setTimeout(420_000);

  test('every recorded view matches the original, with no console noise and no third-party requests', async ({ browser, baseURL }) => {
    const { page, watch, origin } = await open(browser, baseURL);
    const actual = await runSequence(page, '__hansch');
    expect(Object.keys(actual.views), 'same recipe as the golden file').toEqual(golden.meta.recipe);
    expect.soft(actual.boot, 'copy and controls filled at load').toEqual(golden.boot);
    for (const id of golden.meta.recipe) expect.soft(actual.views[id], `view ${id}`).toEqual(golden.views[id]);
    // guard against a vacuous golden: the pointer really picked and selected a sphere in the original too
    expect(golden.views['pointer:hover'].hover).toBeGreaterThanOrEqual(0);
    expect(golden.views['pointer:hover'].tooltip.hidden).toBe(false);
    expect(golden.views['pointer:click'].selected).toBe(golden.views['pointer:hover'].hover);
    expect(watch.problems, 'console errors and warnings').toEqual([]);
    expect([...watch.origins], 'request origins').toEqual([origin]);
    await page.context().close();
  });

  test('the debug hook exposes the same names as the original and is absent without ?debug', async ({ browser, baseURL }) => {
    const { page } = await open(browser, baseURL);
    await waitReady(page, '__hansch');
    const names = await page.evaluate(() => Object.keys(window.__hansch));
    for (const n of ['app', 'stage', 'anim', 'molv', 'selectDrug', 'setView', 'goStep', 'STEPS', 'camTo', 'THREE']) expect(names).toContain(n);
    expect(await page.evaluate(() => Object.keys(window.__hansch.STEPS))).toEqual(STEP_NAMES);
    await page.goto(new URL('index.html', baseURL).href);
    await page.waitForFunction(() => document.querySelector('#stage-status').hidden);
    expect(await page.evaluate(() => typeof window.__hansch)).toBe('undefined');
    await page.context().close();
  });

  test('picking a drug in the search box fills the panel and loads its conformer', async ({ browser, baseURL }) => {
    const { page, watch } = await open(browser, baseURL);
    await waitReady(page, '__hansch');
    await page.fill('#search', 'dexamethasone');
    await page.press('#search', 'Enter');
    await settle(page, '__hansch');
    await expect(page.locator('#d-name')).toHaveText('dexamethasone');
    const s = await snapshot(page, '__hansch');
    const want = golden.views['select:dexamethasone'].detail;
    expect(s.detail.name).toBe(want.name);
    expect(s.detail.html, 'detail panel HTML (identifiers, descriptors, activity, ATC)').toBe(want.html);
    expect(s.detail.src).toBe(want.src);
    expect(s.detail.mol, 'conformer atoms and bonds are built').toEqual(want.mol);
    expect(s.detail.mol.length).toBe(2);
    expect(watch.problems).toEqual([]);
    await page.context().close();
  });

  test('scrolling the tour still drives the steps (ScrollTrigger is unchanged in this stage)', async ({ browser, baseURL }) => {
    const { page } = await open(browser, baseURL);
    await waitReady(page, '__hansch');
    for (const name of STEP_NAMES) {
      await page.evaluate(n => document.querySelector(`.step[data-step="${n}"]`).scrollIntoView({ block: 'center', behavior: 'instant' }), name);
      await page.waitForFunction(n => window.__hansch.app.step === n, name, { timeout: 10_000 });
      expect(await page.evaluate(n => document.querySelector('.step.is-active').dataset.step, name)).toBe(name);
    }
    await page.context().close();
  });

  test('the first camera pose does not depend on how late three.js arrives', async ({ browser, baseURL }) => {
    // The camera distance of a camTo scales with the stage aspect at the time of the call. The original app made its first
    // move in the same task that created the masthead observer (which later changes the stage height); the split must too.
    const page = await (await browser.newContext(CONTEXT)).newPage();
    await page.route('**/vendor/three/three.module.min.js', async route => { await new Promise(r => setTimeout(r, 1500)); await route.continue(); });
    await page.goto(new URL('index.html?debug', baseURL).href);
    await waitReady(page, '__hansch');
    const s = await snapshot(page, '__hansch');
    expect(s.step).toBe('space');
    expect(s.camera).toEqual(golden.views.load.camera);
    await page.context().close();
  });

  test('swapping the conformer disposes the old one, instanced buffers included', async ({ browser, baseURL }) => {
    const { page } = await open(browser, baseURL);
    await waitReady(page, '__hansch');
    await page.evaluate(() => window.__hansch.selectDrug(window.__hansch.app.drugs.find(d => d.name === 'dexamethasone').cid));
    await page.waitForFunction(() => window.__hansch.molv.group, null, { timeout: 30_000 });
    // watch the old group for three.js 'dispose' events on the meshes (frees instanceMatrix/instanceColor), geometries and materials
    await page.evaluate(() => {
      const old = window.__hansch.molv.group, seen = (window.__disposed = { meshes: 0, geometries: 0, materials: 0, group: old });
      for (const m of old.children) {
        m.addEventListener('dispose', () => seen.meshes++);
        m.geometry.addEventListener('dispose', () => seen.geometries++);
        m.material.addEventListener('dispose', () => seen.materials++);
      }
    });
    await page.evaluate(() => window.__hansch.selectDrug(window.__hansch.app.drugs.find(d => d.name === 'caffeine').cid));
    await page.waitForFunction(() => window.__hansch.molv.group !== window.__disposed.group && window.__hansch.molv.group, null, { timeout: 30_000 });
    expect(await page.evaluate(() => ({ meshes: window.__disposed.meshes, geometries: window.__disposed.geometries, materials: window.__disposed.materials }))).toEqual({ meshes: 2, geometries: 2, materials: 2 });
    expect(await page.evaluate(() => window.__disposed.group.parent), 'the old group left the scene').toBeNull();
    await page.context().close();
  });

  test('a failed conformer fetch is reported with the usual text and the next selection retries it', async ({ browser, baseURL }) => {
    const { page } = await open(browser, baseURL);
    await waitReady(page, '__hansch');
    let calls = 0;
    await page.route('**/data/molecules.json', route => (++calls === 1 ? route.fulfill({ status: 503, body: 'nope' }) : route.continue()));
    await page.evaluate(() => window.__hansch.selectDrug(window.__hansch.app.drugs[10].cid));
    await expect(page.locator('#d-src')).toHaveText('Could not load the conformer file.');
    await page.evaluate(() => window.__hansch.selectDrug(window.__hansch.app.drugs[11].cid));
    await page.waitForFunction(() => window.__hansch.molv.group && !/Loading|Could not/.test(document.querySelector('#d-src').textContent), null, { timeout: 30_000 });
    expect(calls, 'the second selection fetched again').toBe(2);
    await page.context().close();
  });
});
