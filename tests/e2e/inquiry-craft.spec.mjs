import { test, expect } from '@playwright/test';

const ready = async page => {
  await page.goto('/?debug');
  await page.waitForFunction(() => document.querySelector('#stage-status').hidden);
  await page.click('#inquiry-start');
  await expect(page.locator('#inquiry-name')).toHaveText('Caffeine');
  await page.click('[data-neighbour="2153"]');
  await expect(page.locator('[data-pair-structure="a"] svg')).toBeVisible();
};
const structurePaint = page => page.locator('[data-pair-structure] svg').evaluateAll(svgs =>
  svgs.map(svg => [...svg.querySelectorAll('[stroke], [fill], [stop-color]')].map(e =>
    [e.tagName, ...['stroke','fill','stop-color'].map(key => {
      const color=e.getAttribute(key);return color?.startsWith('url(') ? null : color;
    })]).filter(x => x.slice(1).some(Boolean))));

test('explicit application theme overrides the OS preference in both molecular drawings', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await ready(page);
  const dark = await structurePaint(page);
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  await expect.poll(() => structurePaint(page)).not.toEqual(dark);
  const light = await structurePaint(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => structurePaint(page)).toEqual(light);
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await expect.poll(() => structurePaint(page)).toEqual(dark);
  expect(await page.evaluate(() => {
    const q = window.__hansch.app.inquiry;
    return [q.cid, q.comparisonCid, q.descriptor];
  })).toEqual([2519, 2153, 'tpsa']);
});

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`mobile labels reserve the population beacon and open sheet (${reducedMotion}) @mobile`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => {
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      const rect = CanvasRenderingContext2D.prototype.roundRect;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (this.canvas.classList.contains('inquiry-pair-tags')) window.__paintedPairBoxes = [];
        return clear.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.roundRect = function (x,y,w,h,...args) {
        if (this.canvas.classList.contains('inquiry-pair-tags')) window.__paintedPairBoxes.push({x,y,w,h});
        return rect.call(this,x,y,w,h,...args);
      };
    });
    await ready(page);
    await page.click('[data-inquiry-map="pca"]');
    await page.fill('#search','aminophylline');
    await page.press('#search','Enter');
    await page.waitForFunction(() => window.__hansch.anim.t === 1);
    const check = () => page.evaluate(() => {
      const canvas = document.querySelector('.inquiry-pair-tags'), c = canvas.getBoundingClientRect();
      const boxes = window.__paintedPairBoxes || [];
      const overlaps = ['inquiry-beacon','detail'].some(id => {
        const e=document.getElementById(id), r=e.getBoundingClientRect();
        return !e.hidden && r.width>0 && r.height>0 && boxes.some(b =>
          c.left+b.x<r.right && c.left+b.x+b.w>r.left && c.top+b.y<r.bottom && c.top+b.y+b.h>r.top);
      });
      return { count: boxes.length, overlaps };
    });
    await expect.poll(check).toEqual({ count: 2, overlaps: false });
    await page.click('#inquiry-focus');
    await page.waitForFunction(() => window.__hansch.anim.t === 1);
    await expect.poll(check).toEqual({ count: 2, overlaps: false });
    await expect.poll(() => page.evaluate(() => {
      const b=document.querySelector('#inquiry-beacon').getBoundingClientRect();
      return [...document.querySelectorAll('.ax-title,.ax-label')].some(e=>{
        const r=e.getBoundingClientRect();
        return getComputedStyle(e).visibility!=='hidden' && r.width && r.height &&
          r.left<b.right && r.right>b.left && r.top<b.bottom && r.bottom>b.top;
      });
    })).toBe(false);
    await page.click('#inquiry-evidence');
    // Check the settled sheet, not the still-unobstructed first frame of its transition.
    await page.waitForTimeout(700);
    await expect.poll(async () => (await check()).overlaps).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__hansch.loop.pending)).toBe(false);
    const frames=await page.evaluate(()=>window.__hansch.loop.stats.frames);
    await page.waitForTimeout(500);
    expect(await page.evaluate(()=>window.__hansch.loop.stats.frames)).toBe(frames);
    expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
