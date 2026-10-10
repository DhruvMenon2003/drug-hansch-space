// tour-scroll.spec.mjs - the guided tour without ScrollTrigger: an IntersectionObserver band picks the step. The active
// step is compared with geometric truth (which step box contains the reading line) over scroll sweeps at 1280x800 and
// 390x844; section jumps (#explore, #hansch) must leave a sensible stage view; ScrollTrigger must be gone.
import { expect, test } from '@playwright/test';
import { CONTEXT, STEP_NAMES } from '../helpers/snapshot.mjs';
import { installCounters } from '../helpers/probes.mjs';

const VIEWPORTS = [
  ['1280x800', CONTEXT],
  ['390x844', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'light', reducedMotion: 'no-preference' }],
];

async function boot(browser, baseURL, opts) {
  const ctx = await browser.newContext(opts), page = await ctx.newPage(), requests = [], errors = [];
  page.on('request', r => requests.push(r.url()));
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(installCounters);
  await page.goto(new URL('index.html?debug', baseURL).href);
  await page.waitForFunction(() => window.__hansch?.stage?.points && document.querySelector('#stage-status').hidden, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
  return { ctx, page, requests, errors };
}

/** Geometric truth: the step whose box contains the reading line; below the tour the last step stays. */
const truth = page => page.evaluate(() => {
  const line = window.__hansch.tour.band().line;
  const hit = [...document.querySelectorAll('.step')].find(el => { const r = el.getBoundingClientRect(); return r.top <= line && r.bottom >= line; });
  const last = document.querySelector('.step:last-of-type').getBoundingClientRect();
  return { line, expected: hit?.dataset.step ?? (last.bottom < line ? 'all' : 'space'), active: window.__hansch.app.step, scrollY: Math.round(scrollY) };
});
const scrollTo = async (page, y) => {
  await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), y);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 90)))));
};

for (const [label, opts] of VIEWPORTS) {
  test.describe(`tour without ScrollTrigger @ ${label}`, () => {
    test.setTimeout(300_000);

    test('no ScrollTrigger: not on window, not requested, not in the page; gsap core still there', async ({ browser, baseURL }) => {
      const { ctx, page, requests } = await boot(browser, baseURL, opts);
      expect(await page.evaluate(() => typeof window.ScrollTrigger)).toBe('undefined');
      expect(await page.evaluate(() => typeof window.gsap?.to)).toBe('function');
      expect(await page.evaluate(() => !!window.gsap.core.globals().ScrollTrigger)).toBe(false);
      expect(requests.filter(u => /ScrollTrigger/i.test(u))).toEqual([]);
      expect(await page.evaluate(() => [...document.scripts].map(s => s.src).filter(s => /ScrollTrigger/i.test(s)))).toEqual([]);
      await ctx.close();
    });

    test('the reading line is inside the visible reading area, below whatever sticks on top', async ({ browser, baseURL }) => {
      const { ctx, page } = await boot(browser, baseURL, opts);
      const g = await page.evaluate(() => {
        const q = s => document.querySelector(s)?.getBoundingClientRect();
        return { line: window.__hansch.tour.band().line, H: innerHeight, mast: q('.masthead').bottom, stage: q('#stage'), narrow: matchMedia('(max-width: 900px)').matches, margin: window.__hansch.tour.band().margin };
      });
      const stackBottom = g.narrow ? Math.max(g.mast, g.stage.bottom) : g.mast;
      expect(g.line, 'below the sticky stack').toBeGreaterThan(stackBottom);
      expect(g.line, 'inside the viewport').toBeLessThan(g.H - 2);
      expect(g.margin).toMatch(/^-\d+px 0px -\d+px 0px$/);
      await ctx.close();
    });

    test('sweep down and up: the active step equals geometric truth (<= 1 lagging sample per 40)', async ({ browser, baseURL }) => {
      const { ctx, page, errors } = await boot(browser, baseURL, opts);
      const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      const ys = []; for (let y = 0; y <= max; y += 90) ys.push(y);
      const order = [...ys, ...[...ys].reverse()];
      let bad = []; const seen = new Set();
      for (const y of order) {
        await scrollTo(page, y);
        const t = await truth(page);
        seen.add(t.active);
        if (t.active !== t.expected) {
          await page.waitForTimeout(250);                      // one retry for a slow software-GL frame; a second miss is a real lag
          const t2 = await truth(page);
          if (t2.active !== t2.expected) bad.push(t2);
        }
      }
      expect(bad.length, `lagging samples: ${JSON.stringify(bad.slice(0, 4))}`).toBeLessThanOrEqual(Math.floor(order.length / 40));
      expect([...seen].sort(), 'every step was active at some point').toEqual([...STEP_NAMES].sort());
      expect(errors).toEqual([]);
      await ctx.close();
    });

    test('each step scrolled to the middle of the reading area becomes active, with its view applied', async ({ browser, baseURL }) => {
      const { ctx, page } = await boot(browser, baseURL, opts);
      for (const name of [...STEP_NAMES, ...[...STEP_NAMES].reverse()]) {
        await page.evaluate(n => {
          const el = document.querySelector(`.step[data-step="${n}"]`), r = el.getBoundingClientRect(), line = window.__hansch.tour.band().line;
          window.scrollTo({ top: scrollY + r.top + Math.min(r.height / 2, 200) - line + 4, behavior: 'instant' });
        }, name);
        await page.waitForFunction(n => window.__hansch.app.step === n, name, { timeout: 15_000 });
        expect(await page.evaluate(() => document.querySelector('.step.is-active').dataset.step)).toBe(name);
        const expected = await page.evaluate(n => window.__hansch.STEPS[n].view.x, name);
        expect(await page.evaluate(() => window.__hansch.app.view.x)).toBe(expected);
      }
      await ctx.close();
    });

    test('jump links: #explore shows the all-drugs view, #hansch the selected fit, #method keeps the view, #tour goes back to step 1', async ({ browser, baseURL }) => {
      const { ctx, page } = await boot(browser, baseURL, opts);
      const go = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150))))); };
      await go('#explore');
      await page.waitForFunction(() => window.__hansch.app.step === 'all', null, { timeout: 15_000 });
      expect(await page.evaluate(() => window.__hansch.app.view.group), 'step "all" fits every drug with an activity value').toBe('ALL');
      await go('#hansch');
      await page.waitForFunction(() => window.__hansch.app.view.group === document.querySelector('#h-group').value, null, { timeout: 15_000 });
      expect(await page.evaluate(() => [window.__hansch.app.view.x, window.__hansch.app.view.y, window.__hansch.app.view.z])).toEqual(['logp', 'act', 'mr']);
      const hanschView = await page.evaluate(() => JSON.stringify(window.__hansch.app.view));
      await go('#method');
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => JSON.stringify(window.__hansch.app.view)), 'Method does not touch the stage').toBe(hanschView);
      await go('#tour');
      // the step under the reading line (on a phone the first step sits partly under the sticky stack when #tour is scrolled to the top)
      await page.waitForFunction(() => { const line = window.__hansch.tour.band().line, el = [...document.querySelectorAll('.step')].find(e => { const r = e.getBoundingClientRect(); return r.top <= line && r.bottom >= line; }); return el && window.__hansch.app.step === el.dataset.step; }, null, { timeout: 15_000 });
      // landing straight on #hansch from the top (the tour skipped entirely) also shows the fit
      await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); });
      await page.waitForFunction(() => window.__hansch.app.step === 'space');
      await go('#hansch');
      await page.waitForFunction(() => window.__hansch.app.view.group === document.querySelector('#h-group').value && window.__hansch.app.view.y === 'act', null, { timeout: 15_000 });
      await ctx.close();
    });

    test('scrolling on from Explore through the drug panel into Hansch does not reset a view the user built there', async ({ browser, baseURL }) => {
      const { ctx, page } = await boot(browser, baseURL, opts);
      await page.evaluate(() => { location.hash = '#explore'; });
      await page.waitForFunction(() => window.__hansch.app.step === 'all');
      await page.selectOption('#ax-x', 'mw');
      await page.waitForFunction(() => window.__hansch.app.view.x === 'mw');
      // read down the page the way a person does: Explore, the drug panel, the Hansch panel, the table, Method (no jump links)
      for (const id of ['#detail', '#hansch', '#method', '#explore']) {
        await page.evaluate(sel => document.querySelector(sel).scrollIntoView({ block: 'start', behavior: 'instant' }), id);
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => window.__hansch.app.view.x), `after scrolling to ${id} the custom view is still there`).toBe('mw');
      }
      await ctx.close();
    });
  });
}

test.describe('tour band rebuild policy', () => {
  test.setTimeout(120_000);
  const phone = VIEWPORTS[1][1];

  test('a same-width height change under 150 px (browser chrome) keeps the band; a real resize rebuilds it', async ({ browser, baseURL }) => {
    const { ctx, page } = await boot(browser, baseURL, phone);
    const band = () => page.evaluate(() => window.__hansch.tour.band());
    const a = await band();
    await page.setViewportSize({ width: 390, height: 780 });
    await page.waitForTimeout(500);
    expect(await band(), 'toolbar-sized change ignored').toEqual(a);
    await page.setViewportSize({ width: 390, height: 600 });
    await page.waitForFunction(m => window.__hansch.tour.band().margin !== m, a.margin, { timeout: 10_000 });
    await page.setViewportSize({ width: 844, height: 390 });                       // landscape: the narrow query may flip
    await page.waitForTimeout(500);
    const l = await band();
    expect(l.line).toBeGreaterThan(0);
    await ctx.close();
  });

  test('a preset app.step stands until the page is scrolled', async ({ browser, baseURL }) => {
    const { ctx, page } = await boot(browser, baseURL, CONTEXT);
    await page.evaluate(() => { window.__hansch.tour.off(); window.__hansch.app.step = 'tpsa'; window.__hansch.tour.init(); });
    await page.waitForFunction(() => window.__hansch.app.view.veber === true, null, { timeout: 10_000 });
    expect(await page.evaluate(() => window.__hansch.app.step)).toBe('tpsa');
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => window.__hansch.app.step), 'the first IntersectionObserver batch (page at the top) does not override it').toBe('tpsa');
    expect(await page.evaluate(() => document.querySelector('.step.is-active').dataset.step)).toBe('tpsa');
    await page.evaluate(() => document.querySelector('.step[data-step="mr"]').scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction(() => window.__hansch.app.step === 'mr', null, { timeout: 15_000 });
    await ctx.close();
  });

  test('goStep keeps its early return: the same step twice applies the view once', async ({ browser, baseURL }) => {
    const { ctx, page } = await boot(browser, baseURL, CONTEXT);
    const n = await page.evaluate(() => { let c = 0; window.__hansch.bus.on('view:patched', () => c++); window.__hansch.goStep('mr'); window.__hansch.goStep('mr'); return c; });
    expect(n).toBe(1);
    await ctx.close();
  });
});
