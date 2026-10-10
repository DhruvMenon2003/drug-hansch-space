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
// Feed frame times and read the state in the same task. After 200 ms of calm the page shows a crisp frame at the full cap
// (by design), and while it is crisp a further governor move does not touch the renderer, so the renderer's ratio between
// two evaluate() calls is NOT the learned rung when the round trip took longer than 200 ms (a loaded machine). Calling
// quality.active() first returns the renderer to the learned rung inside the same task, which makes every read deterministic;
// `learned` is the governor's own verdict and does not depend on it.
const feed = (page, ms, n) => page.evaluate(([ms, n]) => {
  const q = window.__hansch.quality, r = window.__hansch.stage.renderer;
  q.active();
  for (let i = 0; i < n; i++) q.sample(ms);
  return { learned: q.learned, ratio: r.getPixelRatio(), width: r.domElement.width, cssW: document.querySelector('.stage-inner').clientWidth };
}, [ms, n]);
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

  // Recovery is relative to the display's own refresh interval (Wave 2 note N6: the first version needed frames under an absolute
  // 12 ms, which a 60 Hz display, whose frames come every 16.7 ms at best, can never deliver). Feeds are rAF gaps with a little
  // deterministic jitter, as a real display delivers them, through the same sample() the scheduler calls.
  const feedHz = (page, ms, n, start = 0) => page.evaluate(([ms, n, start]) => {
    const q = window.__hansch.quality, r = window.__hansch.stage.renderer;
    q.active();
    for (let i = 0; i < n; i++) q.sample(ms + ((((start + i) * 7919) % 13) - 6) / 6 * 0.4);
    return { learned: q.learned, interval: q.interval, ratio: r.getPixelRatio(), level: q.level };
  }, [ms, n, start]);

  for (const hz of [60, 120]) {
    test(`${hz} Hz display: a transient slowdown drops the resolution and the page recovers to the top rung`, async ({ browser, baseURL }) => {
      const { ctx, page } = await open(browser, baseURL, 2);
      const frame = 1000 / hz;
      const healthy = await feedHz(page, frame, 200);
      expect(healthy.learned, 'a display that delivers its own refresh rate never drops').toBe(2);
      expect(Math.abs(healthy.interval - frame), `measured refresh interval ${healthy.interval.toFixed(2)} ms`).toBeLessThan(0.6);
      const slow = await feedHz(page, 45, 150, 200);                           // a GPU hiccup: heavy view, background work
      expect(slow.learned, 'the slowdown steps the resolution down').toBeLessThanOrEqual(1);
      expect(slow.ratio).toBe(slow.learned);
      let last = slow, fed = 0;
      while (last.learned < 2 && fed < 1500) { last = await feedHz(page, frame, 100, 350 + fed); fed += 100; }
      expect(last.learned, `back at the cap after ${fed} frames at the display's pace`).toBe(2);
      expect(last.ratio, 'and the renderer is there').toBe(2);
      await expectInk(page, '#space', 0.01, 'still drawing at the recovered resolution');
      await ctx.close();
    });
  }

  test('30 Hz display: the page settles on the lowest rung without flapping, and recovers when frames come at 60 Hz again', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, 2);
    await feedHz(page, 1000 / 60, 100);
    const changes = [];
    let last = 2;
    for (let i = 0; i < 30; i++) {                                              // 3000 frames of 33 ms in batches
      const r = await feedHz(page, 1000 / 30, 100, 100 + 100 * i);
      if (r.learned !== last) { changes.push(r.learned); last = r.learned; }
    }
    expect(changes, 'only downward moves, one rung at a time').toEqual([1.5, 1, 0.75]);
    expect(last, 'a sustained 33 ms frame time is a slow page: the lowest rung').toBe(0.75);
    let r = { learned: 0.75 }, fed = 0;
    while (r.learned < 2 && fed < 2500) { r = await feedHz(page, 1000 / 60, 100, 5000 + fed); fed += 100; }
    expect(r.learned, `recovered after ${fed} frames at 60 Hz`).toBe(2);
    await ctx.close();
  });

  test('real frame times reach the governor: a continuously spinning plot at DSF 2 on software GL steps the ratio down (not injected)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ ...CONTEXT, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await openReady(page, baseURL);
    await hideOverlays(page);
    // NOT injectOnly: the frame times come from the scheduler itself. Start from the cap, then keep frames coming.
    await page.evaluate(() => { window.__hansch.quality.injectOnly(false); window.__hansch.quality.reset(); });
    expect(await ratio(page)).toBe(2);
    const spin = () => page.evaluate(() => document.querySelector('#btn-spin').click());          // the stage tools are hidden for the ink check
    await spin();
    await page.waitForFunction(() => window.__hansch.quality.level >= 1, null, { timeout: 90_000 });       // SwiftShader draws 2560x1600 at a few fps
    expect(await ratio(page), 'a lower rung, learned from measured frames only').toBeLessThan(2);
    await spin();                                                                                           // spin off: the page settles
    await quiet(page, 800);
    await expectInk(page, '#space', 0.01, 'still drawing after the governor stepped down');
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
