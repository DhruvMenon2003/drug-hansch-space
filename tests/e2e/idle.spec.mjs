// idle.spec.mjs - render on demand. After the scene settles the page must schedule nothing: no rAF callbacks, no draw calls
// on either canvas. Every wake trigger must then draw again within 2 animation frames and leave a non-blank canvas.
// SwiftShader paces frames at ~10 fps, so nothing here asserts a frame RATE, only counts that must stay equal or grow.
import { expect, test } from '@playwright/test';
import { CONTEXT } from '../helpers/snapshot.mjs';
import { counts, expectInk, framesToDraw, hideOverlays, openReady, quiet, rafQuiet, setTabHidden } from '../helpers/probes.mjs';

test.describe('idle: render on demand', () => {
  test.setTimeout(240_000);
  let page, ctx;

  test.beforeEach(async ({ browser, baseURL }) => {
    ctx = await browser.newContext(CONTEXT);
    page = await ctx.newPage();
    page.on('pageerror', e => { throw e; });
    await openReady(page, baseURL);
    await hideOverlays(page);
  });
  test.afterEach(() => ctx.close());

  test('0 rAF growth and 0 draw calls over 3 s after the scene has settled (both canvases)', async () => {
    await rafQuiet(page, 1500);
    const a = await counts(page);
    await page.waitForTimeout(3000);
    const b = await counts(page);
    expect(b.raf - a.raf, 'rAF callbacks in 3 s of idle').toBeLessThanOrEqual(2);
    expect(b.draws.space ?? 0, 'draw calls on #space').toBe(a.draws.space ?? 0);
    expect(b.draws.mol ?? 0, 'draw calls on #mol').toBe(a.draws.mol ?? 0);
    expect(b.frames, 'scheduler frames').toBe(a.frames);
    expect(await page.evaluate(() => window.__hansch.loop.pending), 'no rAF pending').toBe(false);
    expect(await page.evaluate(() => !!window.__hansch.stage.renderer.xr.isPresenting), 'no XR session').toBe(false);
  });

  test('first paint: the scheduler drew, the status line is gone and the progress bar reached 4', async () => {
    expect((await counts(page)).draws.space).toBeGreaterThan(0);
    expect(await page.locator('#stage-status').isHidden()).toBe(true);
    expect(await page.evaluate(() => document.querySelector('#load-progress')?.value)).toBe(4);
    await expectInk(page, '#space', 0.02, 'spheres are on screen at rest');
  });

  const settleAgain = async () => { await quiet(page, 800); await rafQuiet(page, 600); };
  const wakes = {
    'drag (orbit)': () => page.mouse.move(500, 400).then(() => page.mouse.down()).then(() => page.mouse.move(560, 430, { steps: 4 })).then(() => page.mouse.up()),
    'ctrl + wheel (zoom)': async () => { await page.mouse.move(500, 400); await page.keyboard.down('Control'); await page.mouse.wheel(0, -240); await page.keyboard.up('Control'); },
    'axis change': () => page.selectOption('#ax-x', 'mw'),
    'colour change': () => page.selectOption('#color-by', 'ro5'),
    'drug select (search)': async () => { await page.fill('#search', 'aspirin'); await page.press('#search', 'Enter'); },
    'theme change (prefers-color-scheme)': () => page.emulateMedia({ colorScheme: 'dark' }),
    'tour step (camera + layout tweens)': () => page.evaluate(() => window.__hansch.goStep('tpsa')),
    'reset view button': () => page.evaluate(() => document.querySelector('#btn-reset').click()),   // the overlays are hidden for the ink checks, so click through the DOM
  };
  for (const [name, action] of Object.entries(wakes)) {
    test(`wake: ${name} draws within 2 frames, then the page goes quiet again`, async () => {
      await settleAgain();
      const frames = await framesToDraw(page, 'space', action);
      expect(frames, 'animation frames between the action and the first draw').toBeLessThanOrEqual(2);
      await page.waitForFunction(() => window.__hansch.anim.t >= 1 && window.gsap.globalTimeline.getChildren(false, true, true).every(k => k.paused()), null, { timeout: 30_000 });
      await settleAgain();
      await expectInk(page, '#space', 0.01, `canvas not blank after ${name}`);
      await rafQuiet(page, 1000);
      const a = await counts(page);
      await page.waitForTimeout(1500);
      const b = await counts(page);
      expect(b.draws.space, 'idle again: no draw calls').toBe(a.draws.space);
      expect(b.raf - a.raf, 'idle again: rAF').toBeLessThanOrEqual(2);
    });
  }

  test('wake: resize draws synchronously (no blank canvas) and again at rest', async () => {
    await settleAgain();
    const frames = await framesToDraw(page, 'space', () => page.setViewportSize({ width: 1000, height: 700 }));
    expect(frames).toBeLessThanOrEqual(2);
    await settleAgain();
    await expectInk(page, '#space', 0.01, 'canvas not blank after a resize');
    await page.setViewportSize({ width: 1280, height: 800 });
    await settleAgain();
    await expectInk(page, '#space', 0.01, 'canvas not blank after resizing back');
  });

  test('wake: a resize is painted before the browser paints (the ResizeObserver callback renders)', async () => {
    // A resize clears the drawing buffer; if only a later frame redrew it, a paint in between would show nothing. The
    // renderer's own counter proves the draw happens inside the same task as the buffer reallocation.
    const r = await page.evaluate(() => new Promise(resolve => {
      const { stage } = window.__hansch, id = 'space', host = document.querySelector('.stage-inner');
      const before = window.__draws[id] || 0;
      host.style.width = '900px';
      // ResizeObserver callbacks run after layout in the same frame, before paint: check at the next rAF *after* that frame
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({ drawn: (window.__draws[id] || 0) - before, w: stage.renderer.domElement.width })));
    }));
    expect(r.drawn).toBeGreaterThan(0);
  });

  test('Spin: frames keep coming while it is on and stop after it is turned off', async () => {
    await settleAgain();
    await page.evaluate(() => document.querySelector('#btn-spin').click());
    const a = await counts(page);
    await page.waitForFunction(f => window.__hansch.stats.frames >= f + 3, a.frames, { timeout: 30_000 });
    expect((await counts(page)).draws.space, 'spinning draws').toBeGreaterThan(a.draws.space);
    await page.evaluate(() => document.querySelector('#btn-spin').click());
    await page.waitForFunction(() => !window.__hansch.stage.controls.autoRotate);
    await quiet(page, 1500, 60_000);
    await rafQuiet(page, 1000);
    const b = await counts(page);
    await page.waitForTimeout(2000);
    const c = await counts(page);
    expect(c.draws.space).toBe(b.draws.space);
    expect(c.raf - b.raf).toBeLessThanOrEqual(2);
  });

  test('hidden tab: no frames while hidden (even when something asks for one), and a frame when it is visible again', async () => {
    await settleAgain();
    await setTabHidden(page, true);
    const a = await counts(page);
    await page.selectOption('#ax-x', 'tpsa');                      // asks for frames: layout tween, rebuilt axes
    await page.waitForTimeout(2500);
    const b = await counts(page);
    expect(b.draws.space, 'no draw calls while hidden').toBe(a.draws.space);
    expect(b.frames).toBe(a.frames);
    const frames = await framesToDraw(page, 'space', () => setTabHidden(page, false));
    expect(frames).toBeLessThanOrEqual(2);
    await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
    await settleAgain();
    await expectInk(page, '#space', 0.01, 'canvas not blank after the tab came back');
  });

  test('molecule viewer: draws only while on screen, stops spinning after ~8 s, wakes on scroll-back', async () => {
    await settleAgain();
    // before any selection the viewer does not even exist
    expect(await page.evaluate(() => !!window.__hansch.molv.renderer)).toBe(false);
    await page.evaluate(() => window.__hansch.selectDrug(window.__hansch.app.drugs.find(d => d.name === 'dexamethasone').cid));
    await page.waitForFunction(() => window.__hansch.molv.group, null, { timeout: 30_000 });
    await page.locator('#mol').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.__hansch.molv.visible, null, { timeout: 10_000 });
    const m0 = await counts(page);
    await page.waitForFunction(m => window.__draws.mol > m, m0.draws.mol ?? 0, { timeout: 15_000 });
    // scroll the viewer off screen: it must stop drawing even though its spin timer is still running
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => !window.__hansch.molv.visible, null, { timeout: 10_000 });
    await page.waitForTimeout(400);
    const a = await counts(page);
    await page.waitForTimeout(2000);
    const b = await counts(page);
    expect(b.draws.mol, 'no draws on #mol while it is off screen').toBe(a.draws.mol);
    // scroll back: it wakes
    const frames = await framesToDraw(page, 'mol', () => page.locator('#mol').scrollIntoViewIfNeeded());
    expect(frames).toBeLessThanOrEqual(3);
    // the spin is time-boxed: afterwards the viewer is quiet although it is on screen
    await page.waitForFunction(() => !window.__hansch.molv.controls.autoRotate, null, { timeout: 30_000 });
    await page.waitForFunction(() => { const w = window; const n = w.__draws.mol; const r = w.__q2; if (!r || r.n !== n) { w.__q2 = { n, at: performance.now() }; return false; } return performance.now() - r.at > 1500; }, null, { timeout: 30_000, polling: 100 });
    const c = await counts(page);
    await page.waitForTimeout(2000);
    expect((await counts(page)).draws.mol, 'on screen but not spinning: quiet').toBe(c.draws.mol);
    // dragging the conformer wakes it
    const box = await page.locator('#mol').boundingBox();
    const f2 = await framesToDraw(page, 'mol', async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 10, { steps: 3 }); await page.mouse.up();
    });
    expect(f2).toBeLessThanOrEqual(2);
  });
});
