// quality.spec.mjs - the adaptive resolution governor, driven by SYNTHETIC frame times through the ?debug hook
// (window.__hansch.quality.sample), so the result does not depend on how fast SwiftShader happens to be.
import { expect, test } from '@playwright/test';
import { CONTEXT } from '../helpers/snapshot.mjs';
import { counts, expectInk, framesToDraw, hideOverlays, openReady, quiet } from '../helpers/probes.mjs';

const open = async (browser, baseURL, dsf) => {
  const ctx = await browser.newContext({ ...CONTEXT, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  await openReady(page, baseURL);
  await hideOverlays(page);
  // boot frames on software GL are slow, so the real governor may already have stepped down: start from a known state
  await page.evaluate(() => { window.__hansch.quality.injectOnly(true); window.__hansch.quality.reset(); });
  return { ctx, page };
};
// Feed frame times and read the state in the same task: after 200 ms of calm the page shows a crisp frame at the full cap,
// so the renderer's ratio between two evaluate() calls is not the learned rung. `learned` is.
const feed = (page, ms, n) => page.evaluate(([ms, n]) => { for (let i = 0; i < n; i++) window.__hansch.quality.sample(ms); return { learned: window.__hansch.quality.learned, ratio: window.__hansch.stage.renderer.getPixelRatio(), width: window.__hansch.stage.renderer.domElement.width, cssW: document.querySelector('.stage-inner').clientWidth }; }, [ms, n]);
const ratio = page => page.evaluate(() => window.__hansch.quality.learned);

test.describe('adaptive resolution', () => {
  test.setTimeout(180_000);

  test('DSF 2: slow frames step the pixel ratio down one rung at a time to the floor, fast frames step it back up to the cap', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, 2);
    expect(await ratio(page), 'starts at the cap, min(devicePixelRatio, 2)').toBe(2);
    expect(await page.evaluate(() => window.__hansch.quality.rungs)).toEqual([2, 1.5, 1, 0.75]);
    const seen = [2];
    for (let i = 0; i < 6; i++) {                       // frames over the threshold, in batches of 25
      const r = (await feed(page, 50, 25)).learned;
      if (r !== seen.at(-1)) seen.push(r);
    }
    expect(seen, 'one rung per verdict, never below 0.75').toEqual([2, 1.5, 1, 0.75]);
    const floor = await feed(page, 200, 200);
    expect(floor.learned, 'the floor holds').toBe(0.75);
    expect(floor.ratio, 'and the renderer is at it').toBe(0.75);
    expect(floor.width, 'the drawing buffer follows the ratio').toBe(Math.floor(floor.cssW * 0.75));
    await expectInk(page, '#space', 0.01, 'a lower resolution still draws the plot');
    // 3 fast verdicts of 90 frames each: back up, one rung per verdict, never above the cap
    const up = [0.75];
    for (let i = 0; i < 8; i++) {
      const r = (await feed(page, 3, 95)).learned;
      if (r !== up.at(-1)) up.push(r);
    }
    expect(up).toEqual([0.75, 1, 1.5, 2]);
    expect((await feed(page, 2, 500)).learned, 'never above min(devicePixelRatio, 2)').toBe(2);
    await ctx.close();
  });

  test('hysteresis: 19 slow frames or 89 fast frames are not enough; frames between 12 and 24 ms change nothing', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, 2);
    await feed(page, 18, 400);
    expect(await ratio(page)).toBe(2);
    await feed(page, 60, 3);
    await feed(page, 18, 300);
    expect(await ratio(page), 'a short stutter does not drop the resolution').toBe(2);
    await ctx.close();
  });

  test('DSF 1: the cap is 1 and the only rung below is 0.75', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, 1);
    expect(await page.evaluate(() => window.__hansch.quality.rungs)).toEqual([1, 0.75]);
    await feed(page, 80, 300);
    expect(await ratio(page)).toBe(0.75);
    await feed(page, 3, 400);
    expect(await ratio(page)).toBe(1);
    await ctx.close();
  });

  test('DSF 3 is capped at 2', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, 3);
    expect(await ratio(page)).toBe(2);
    expect(await page.evaluate(() => window.__hansch.quality.rungs[0])).toBe(2);
    await ctx.close();
  });

  test('a changed ratio repaints at once (no blank canvas), and the page returns to full resolution after 200 ms of calm', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, 2);
    await quiet(page, 800);
    const frames = await framesToDraw(page, 'space', () => feed(page, 80, 80));
    expect(frames).toBeLessThanOrEqual(2);
    expect(await ratio(page)).toBeLessThan(2);
    await expectInk(page, '#space', 0.01, 'canvas not blank after the resolution changed');
    // calm: crisp frame at the cap, remembered rung kept
    await page.waitForFunction(() => window.__hansch.stage.renderer.getPixelRatio() === 2, null, { timeout: 10_000 });
    expect(await page.evaluate(() => window.__hansch.quality.level), 'the learned rung is remembered').toBeGreaterThan(0);
    await expectInk(page, '#space', 0.01, 'the crisp frame is drawn');
    const a = await counts(page);
    await page.waitForTimeout(1500);
    expect((await counts(page)).draws.space, 'and then the page is idle again').toBe(a.draws.space);
    // interaction returns to the learned rung
    await page.mouse.move(500, 400); await page.mouse.down(); await page.mouse.move(540, 420, { steps: 3 });
    await page.waitForFunction(() => window.__hansch.stage.renderer.getPixelRatio() < 2, null, { timeout: 10_000 });
    await page.mouse.up();
    await ctx.close();
  });

  test('changing the device pixel ratio (browser zoom / another monitor) re-derives the cap and repaints', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, 2);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await page.waitForFunction(() => window.__hansch.stage.renderer.getPixelRatio() === 1, null, { timeout: 10_000 });
    expect(await page.evaluate(() => window.__hansch.quality.rungs)).toEqual([1, 0.75]);
    await quiet(page, 800);
    await expectInk(page, '#space', 0.01, 'canvas not blank after a devicePixelRatio change');
    await ctx.close();
  });
});
