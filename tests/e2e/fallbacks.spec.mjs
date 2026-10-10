// fallbacks.spec.mjs - what the page does when something is missing or breaks. Each failure must (1) say what is wrong,
// accurately, (2) keep every part of the page that can still work, (3) never throw an uncaught error.
import { expect, test } from '@playwright/test';
import { CONTEXT } from '../helpers/snapshot.mjs';
import { counts, expectInk, framesToDraw, hideOverlays, installCounters, openReady, quiet } from '../helpers/probes.mjs';

const noWebGL = () => {
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : get.call(this, type, ...rest); };
};

/** Open a page with a failure injected and collect uncaught errors and console errors. */
async function open(browser, baseURL, { init, route, query = '?debug' } = {}) {
  const ctx = await browser.newContext(CONTEXT), page = await ctx.newPage();
  const errors = [], consoleErrors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  if (init) await page.addInitScript(init);
  if (route) await route(page);
  await page.goto(new URL('index.html' + query, baseURL).href);
  return { ctx, page, errors, consoleErrors };
}
const ready2d = page => page.waitForFunction(() => document.querySelector('#load-progress')?.value === 4 && document.querySelector('#stage-status').hidden, null, { timeout: 30_000 });

/** The whole 2D app still works: selects, tour copy, Hansch fits, table, search, detail panel with its 2D depiction. */
async function expect2dAppWorks(page) {
  expect(await page.locator('#ax-x option').count(), 'Explore axis select filled').toBeGreaterThan(5);
  expect(await page.locator('#h-group option').count(), 'Hansch select filled').toBeGreaterThan(3);
  expect(await page.locator('#t-pca').textContent(), 'tour copy filled').toMatch(/variance/);
  expect(await page.locator('#t-all').textContent()).not.toBe('');
  expect(await page.locator('#h-out').textContent(), 'Hansch panel drawn').toMatch(/pChEMBL/);
  expect(await page.locator('#m-checks').textContent()).toMatch(/drugs/);
  await page.locator('#table-details > summary').click();
  expect(await page.locator('#table tbody tr').count(), 'data table opens with rows').toBeGreaterThan(100);
  await page.selectOption('#ax-x', 'mw');
  await page.waitForFunction(() => /Molecular weight/.test(document.querySelector('#axis-key').textContent));
  await page.fill('#search', 'dexamethasone');
  await page.press('#search', 'Enter');
  await expect(page.locator('#d-name')).toHaveText('dexamethasone');
  await page.waitForFunction(() => !!document.querySelector('#d-2d svg'), null, { timeout: 15_000 });
  expect(await page.locator('#d-ids').textContent()).toMatch(/PubChem CID/);
  // tour steps still change the view state (only the drawing is absent)
  expect(await page.locator('.step.is-active').count()).toBe(1);
}

test.describe('fallbacks', () => {
  test.setTimeout(120_000);

  test('WebGL unavailable: accurate message, 2D app fully working, nothing thrown', async ({ browser, baseURL }) => {
    const { ctx, page, errors, consoleErrors } = await open(browser, baseURL, { init: noWebGL });
    await ready2d(page);
    await expect(page.locator('#fallback-2d')).toBeVisible();
    await expect(page.locator('#fallback-2d')).toContainText('WebGL is not available in this browser');
    expect(await page.locator('#fatal').isHidden(), 'no fatal box').toBe(true);
    expect(await page.locator('#space').isHidden(), 'the canvas area is hidden').toBe(true);
    expect(await page.evaluate(() => document.querySelector('#stage-status').textContent)).not.toMatch(/Could not load the data/);
    expect(await page.evaluate(() => document.querySelector('#sr-live').textContent), 'announced').toMatch(/WebGL is not available/);
    await expect2dAppWorks(page);
    await page.click('#fallback-table');
    expect(await page.evaluate(() => document.querySelector('#table-details').open)).toBe(true);
    expect(errors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await ctx.close();
  });

  test('WebGL unavailable: the 3D layer is never even downloaded', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext(CONTEXT), page = await ctx.newPage(), urls = [];
    page.on('request', r => urls.push(r.url()));
    await page.addInitScript(noWebGL);
    await page.goto(new URL('index.html', baseURL).href);
    await ready2d(page);
    expect(urls.filter(u => /boot-gl|three\.module|OrbitControls|CSS2DRenderer/.test(u))).toEqual([]);
    await ctx.close();
  });

  test('three.js fails to load (404): the same 2D mode with an accurate, different message; the 2D app stays alive', async ({ browser, baseURL }) => {
    const { ctx, page, errors } = await open(browser, baseURL, { route: p => p.route('**/vendor/three/three.module.min.js', r => r.fulfill({ status: 404, body: 'nope' })) });
    await ready2d(page);
    await expect(page.locator('#fallback-2d')).toBeVisible();
    await expect(page.locator('#fallback-2d')).toContainText('could not be started');
    await expect(page.locator('#fallback-2d')).not.toContainText('WebGL is not available');
    expect(await page.locator('#fatal').isHidden()).toBe(true);
    await expect2dAppWorks(page);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('import maps unsupported (the bare "three" specifier does not resolve): 2D mode, app alive', async ({ browser, baseURL }) => {
    const { ctx, page, errors } = await open(browser, baseURL, {
      route: p => p.route(/\/index\.html/, async r => {
        const res = await r.fetch(), html = (await res.text()).replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
        await r.fulfill({ response: res, body: html });
      }),
    });
    await ready2d(page);
    await expect(page.locator('#fallback-2d')).toBeVisible();
    await expect(page.locator('#fallback-2d')).toContainText('could not be started');
    await expect2dAppWorks(page);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('the 3D scene throws while starting (shader / renderer error): 2D mode, app alive', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, {
      init: () => {
        // The probe in caps.js (first context) must pass, then the real renderer fails: refuse every context after the first one
        let n = 0; const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) { if (/webgl/i.test(type) && ++n > 1) return null; return get.call(this, type, ...rest); };
      },
    });
    await ready2d(page);
    await expect(page.locator('#fallback-2d')).toBeVisible();
    await expect(page.locator('#fallback-2d')).toContainText('could not be started');
    await expect2dAppWorks(page);
    await ctx.close();
  });

  test('boot-core fails to load: the fatal box says a script did not load (not "bad data"), with Reload and a data link', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, { route: p => p.route('**/js/boot-core.js', r => r.fulfill({ status: 404, body: 'nope' })) });
    await expect(page.locator('#fatal')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#fatal')).toContainText('script');
    await expect(page.locator('#fatal')).not.toContainText('Could not load the data');
    await expect(page.locator('#fatal-reload')).toBeVisible();
    expect(await page.locator('#fatal a[href$="drugs.json"]').count()).toBe(1);
    expect(await page.locator('#fatal').getAttribute('role')).toBe('alert');
    await ctx.close();
  });

  test('the data file fails (HTTP 500): the fatal box says the data could not be loaded', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, { route: p => p.route('**/data/drugs.json', r => r.fulfill({ status: 500, body: 'nope' })) });
    await expect(page.locator('#fatal')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#fatal')).toContainText('Could not load the data');
    await expect(page.locator('#fatal')).toContainText('drugs.json');
    await ctx.close();
  });

  test('a bug while building the page is reported as that, not as bad data', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, { route: p => p.route('**/data/hansch.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"groups":[]}' })) });
    await expect(page.locator('#fatal')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#fatal')).not.toContainText('Could not load the data');
    await ctx.close();
  });

  test('loading progress goes 1, 2, 3, 4 and the status line is hidden after the first frame', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext(CONTEXT), page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__prog = [];
      new MutationObserver(() => {}).observe(document, { childList: true, subtree: true });
      const poll = () => { const p = document.querySelector('#load-progress'); if (p && window.__prog.at(-1) !== p.value) window.__prog.push(p.value); requestAnimationFrame(poll); };
      requestAnimationFrame(poll);
    });
    await page.goto(new URL('index.html', baseURL).href);
    await page.waitForFunction(() => document.querySelector('#stage-status').hidden, null, { timeout: 60_000 });
    const seen = await page.evaluate(() => window.__prog);
    expect(seen.at(-1)).toBe(4);
    expect(seen.filter(v => v > 0)).toEqual([...seen.filter(v => v > 0)].sort((a, b) => a - b));
    expect(await page.evaluate(() => document.querySelector('#load-progress').value)).toBe(4);
    await ctx.close();
  });
});

test.describe('WebGL context loss', () => {
  test.setTimeout(180_000);

  const lose = (page, id) => page.evaluate(i => { const gl = document.getElementById(i).getContext('webgl2') || document.getElementById(i).getContext('webgl'); window.__ext = gl.getExtension('WEBGL_lose_context'); window.__ext.loseContext(); }, id);
  const restore = page => page.evaluate(() => window.__ext.restoreContext());

  test('main stage: lost -> message and no drawing; restored -> redrawn, message gone, canvas not blank', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext(CONTEXT), page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await openReady(page, baseURL);
    await hideOverlays(page);
    await quiet(page, 800);
    await lose(page, 'space');
    await page.waitForFunction(() => !document.querySelector('#stage-status').hidden && /Graphics context lost/.test(document.querySelector('#stage-status').textContent), null, { timeout: 15_000 });
    expect(await page.evaluate(() => document.querySelector('#sr-live').textContent)).toMatch(/lost its graphics context/);
    expect(await page.evaluate(() => window.__hansch.loop.paused)).toBe(true);
    // something that would normally draw does not, and does not throw
    const a = await counts(page);
    await page.selectOption('#ax-x', 'mw');
    await page.waitForTimeout(1500);
    expect((await counts(page)).draws.space, 'no draw calls on a lost context').toBe(a.draws.space);
    const frames = await framesToDraw(page, 'space', () => restore(page), 30_000);
    expect(frames).toBeLessThanOrEqual(4);
    await page.waitForFunction(() => document.querySelector('#stage-status').hidden);
    await page.waitForFunction(() => window.__hansch.anim.t >= 1 && !window.__hansch.loop.paused, null, { timeout: 30_000 });
    await quiet(page, 800);
    await expectInk(page, '#space', 0.02, 'the restored canvas shows the plot of the CURRENT view (axis changed while lost)');
    expect(await page.evaluate(() => window.__hansch.app.view.x)).toBe('mw');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('conformer viewer: lost -> message and no drawing; restored -> redrawn and the conformer is back', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext(CONTEXT), page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await openReady(page, baseURL);
    await page.evaluate(() => window.__hansch.selectDrug(window.__hansch.app.drugs.find(d => d.name === 'caffeine').cid));
    await page.waitForFunction(() => window.__hansch.molv.group, null, { timeout: 30_000 });
    await page.locator('#mol').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.__hansch.molv.visible && window.__draws.mol > 0);
    const src = await page.locator('#d-src').textContent();
    await lose(page, 'mol');
    await expect(page.locator('#d-src')).toContainText('Graphics context lost');
    expect(await page.evaluate(() => window.__hansch.molv.loop.paused)).toBe(true);
    const a = await counts(page);
    await page.waitForTimeout(1200);
    expect((await counts(page)).draws.mol).toBe(a.draws.mol);
    await framesToDraw(page, 'mol', () => restore(page), 30_000);
    await expect(page.locator('#d-src')).toHaveText(src);
    expect(await page.evaluate(() => window.__hansch.molv.loop.paused)).toBe(false);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
