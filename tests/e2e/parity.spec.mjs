// parity.spec.mjs - the S1 acceptance gate: the split, vendor-wired site must behave exactly like the ORIGINAL app.
// tests/golden/original.json was produced from the original by tests/tools/make-goldens.mjs (never from this code). The
// recipe in tests/helpers/snapshot.mjs is replayed here through window.__hansch (?debug) and every snapshot is compared.
// Also: zero console errors/warnings, zero cross-origin requests, selection through the search box, tour by scrolling.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { CONTEXT, STEP_NAMES, runSequence, settle, sha1, snapshot, waitReady } from '../helpers/snapshot.mjs';

const golden = JSON.parse(readFileSync(new URL('../golden/original.json', import.meta.url), 'utf8'));

// ---------------------------------------------------------------------------------------------------------------------
// ALLOW-LIST: the deliberate, listed differences from the original app (shell stage). Everything else stays strict.
//
// 1. DESIGN TOKENS (values). Contrast fixes (WCAG AA, scout/mobile-ux.json UX-17): the light --muted, --mark and grey --point
//    and the dark grey --point were too faint. Each value below is the ORIGINAL and the reason it changed. The tokens reach
//    the snapshot in four places (the `tokens` hash, the legend's swatch HTML, the selection ring colour and the instance
//    colours hash), so a plain comparison would fail on all four for one intended reason. Instead of loosening those fields
//    the parity run puts the ORIGINAL values back (a CSS override appended to style.css by the route below), after which every
//    field, those four included, must equal the golden exactly. Another test asserts that the shipped tokens differ from the
//    original in exactly the fields listed here (plus the new `bg` token that the PNG export will read) and nowhere else.
// 2. [hidden] (D26): `#atc-pick-wrap[hidden]` used to stay visible because `.field { display: flex }` beat the attribute.
//    The snapshot field atcWrapHidden is the DOM property, which this CSS fix does not change, so it stays strict; the
//    computed-display half of the fix is asserted in shell.spec.mjs.
const ORIGINAL_TOKENS = {
  light: { panel: '#f8faf9', ink: '#12201d', 'ink-2': '#44544f', muted: '#6f7e7a', line: '#d2dbd8', grid: '#e0e7e5', accent: '#1f6fb2', mark: '#c94f24', point: '#9aaaa5', s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', q1: '#cde2fb', q2: '#86b6ef', q3: '#3987e5', q4: '#1c5cab', q5: '#0d366b', 'surface-alpha': '0.28' },
  dark: { panel: '#131c1f', ink: '#e4ecea', 'ink-2': '#a9b8b4', muted: '#7a8b87', line: '#27353a', grid: '#1b272b', accent: '#5aa8ea', mark: '#f07a4a', point: '#4f605c', s1: '#3987e5', s2: '#d95926', s3: '#199e70', q1: '#184f95', q2: '#256abf', q3: '#3987e5', q4: '#86b6ef', q5: '#cde2fb', 'surface-alpha': '0.32' },
};
/** The only token values that differ from the original, with the contrast reason (ratios are against --bg unless noted). */
const DELIBERATE_TOKENS = {
  light: { muted: '#5a6a66' /* 3.8:1 -> 5.0:1 */, mark: '#b3441c' /* 4.0:1 -> 4.9:1 */, point: '#7a8a85' /* 2.2:1 -> 3.2:1, grey spheres need 3:1 */ },
  dark: { point: '#5f726d' /* 2.8:1 -> 3.6:1 */ },
};
/** New tokens (not in the original): the page background, for the PNG export. */
const NEW_TOKENS = { light: { bg: '#eef2f1' }, dark: { bg: '#0d1416' } };
const ORIGINAL_TOKENS_CSS = `
:root { --muted: ${ORIGINAL_TOKENS.light.muted}; --mark: ${ORIGINAL_TOKENS.light.mark}; --point: ${ORIGINAL_TOKENS.light.point}; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --point: ${ORIGINAL_TOKENS.dark.point}; } }
:root[data-theme="dark"] { --point: ${ORIGINAL_TOKENS.dark.point}; }
`;
const withoutTokens = ({ tokens, ...rest }) => rest;
// 3. HANSCH PANEL FOLLOWS THE VIEW (runtime stage, UX-18). In the original the target-group select changed with the view (tour
//    step 8, Explore, "Show this fit") but the equation, statistics and plot kept describing the previous group. Wherever the
//    GOLDEN's select and panel disagree (`selects[8]` against `hanschFor`) the three panel hashes are not compared; instead the
//    panel must describe the group the select shows. Everywhere else they are compared strictly.
//    Also: the search box no longer searches a second time when it loses focus (D21); the recipe blurs the input inside the
//    search steps so both apps reach the same state. See tests/golden/README.md.
const hanschStale = v => v.selects[8] !== v.hanschFor;
const withoutHansch = ({ hansch, hanschFor, ...rest }) => rest;
/** The view as compared against the golden: tokens never (checked directly), the Hansch panel only where the original showed it consistently. */
const comparable = (actual, gold) => (hanschStale(gold) ? withoutHansch(withoutTokens(actual)) : withoutTokens(actual));
const comparableGold = gold => (hanschStale(gold) ? withoutHansch(withoutTokens(gold)) : withoutTokens(gold));

/** Open the site with ?debug and collect console problems and every request origin. `originalTokens` restores the pre-fix token values (see the allow-list). */
async function open(browser, baseURL, { originalTokens = false } = {}) {
  const page = await (await browser.newContext(CONTEXT)).newPage();
  if (originalTokens) {
    await page.route('**/style.css*', async route => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: (await res.text()) + ORIGINAL_TOKENS_CSS });
    });
  }
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
    const { page, watch, origin } = await open(browser, baseURL, { originalTokens: true });   // allow-list item 1: original token values restored
    const actual = await runSequence(page, '__hansch');
    expect(Object.keys(actual.views), 'same recipe as the golden file').toEqual(golden.meta.recipe);
    expect.soft(actual.boot, 'copy and controls filled at load').toEqual(golden.boot);
    // every field strict, except the tokens hash: the page now also reads the new `bg` token, so the object it hashes has one more key
    for (const id of golden.meta.recipe) {
      expect.soft(comparable(actual.views[id], golden.views[id]), `view ${id}`).toEqual(comparableGold(golden.views[id]));
      if (hanschStale(golden.views[id])) expect.soft(actual.views[id].hanschFor, `view ${id}: the Hansch panel describes the group the select shows`).toBe(actual.views[id].selects[8]);
    }
    expect(golden.meta.recipe.filter(id => hanschStale(golden.views[id])).length, 'the stale-panel views of the original (allow-list item 3)').toBeGreaterThan(5);
    // ... and the tokens themselves are checked directly: the original values (the reconstruction is proven against the golden hashes) plus bg
    expect(sha1(ORIGINAL_TOKENS.light), 'the reconstructed original light tokens are the ones the original app had').toBe(golden.views.load.tokens);
    expect(sha1(ORIGINAL_TOKENS.dark), 'the reconstructed original dark tokens are the ones the original app had').toBe(golden.views['theme:dark'].tokens);
    expect(await page.evaluate(() => ({ ...window.__hansch.app.tokens })), 'tokens with the original values restored').toEqual({ ...ORIGINAL_TOKENS.light, ...NEW_TOKENS.light });
    // guard against a vacuous golden: the pointer really picked and selected a sphere in the original too
    expect(golden.views['pointer:hover'].hover).toBeGreaterThanOrEqual(0);
    expect(golden.views['pointer:hover'].tooltip.hidden).toBe(false);
    expect(golden.views['pointer:click'].selected).toBe(golden.views['pointer:hover'].hover);
    expect(watch.problems, 'console errors and warnings').toEqual([]);
    expect([...watch.origins], 'request origins').toEqual([origin]);
    await page.context().close();
  });

  test('allow-list: the shipped design tokens differ from the original in exactly the listed values (light and dark)', async ({ browser, baseURL }) => {
    const { page } = await open(browser, baseURL);
    await waitReady(page, '__hansch');
    const read = () => page.evaluate(() => ({ ...window.__hansch.app.tokens }));
    expect(await read(), 'light').toEqual({ ...ORIGINAL_TOKENS.light, ...DELIBERATE_TOKENS.light, ...NEW_TOKENS.light });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => window.__hansch.app.tokens.panel === '#131c1f');
    expect(await read(), 'dark').toEqual({ ...ORIGINAL_TOKENS.dark, ...DELIBERATE_TOKENS.dark, ...NEW_TOKENS.dark });
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

  test('scrolling the tour still drives the steps (IntersectionObserver band, no ScrollTrigger)', async ({ browser, baseURL }) => {
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
