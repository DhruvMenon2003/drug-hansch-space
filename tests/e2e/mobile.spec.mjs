// mobile.spec.mjs - the responsive layout (stage S2c): collapsing header + Contents menu, stage height policy, anchors, Expand,
// the drug panel as a bottom sheet, touch picking, 3D legibility on small stages, controls density, reading aids, resize and
// rotation behaviour, layout shift, axe, and dark-theme screenshots for the verifier.
//
// Viewports: 320x568, 390x844, 412x915 (stacked phones), 768x1024 (tablet: two columns), 844x390 (landscape phone: two columns,
// static header), 1280x800 (desktop, mouse). Touch contexts use isMobile + hasTouch, which makes (pointer: coarse) true.
// Nothing here asserts a frame rate; software GL is slow. Screenshots go to SHOTS (the verifier looks at them).
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { canvasInk, installCounters, quiet } from '../helpers/probes.mjs';

const SHOTS = process.env.S2C_SHOTS || '/tmp/claude-0/-home-user/4e3cf7ab-5b7b-584c-b07b-dec53f6d1b23/scratchpad/s2c-shots';
const SITE = new URL('../../site/', import.meta.url);

const touchCtx = (w, h, extra = {}) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'light', reducedMotion: 'no-preference', ...extra });
const VP = {
  '320x568': touchCtx(320, 568),
  '390x844': touchCtx(390, 844),
  '412x915': touchCtx(412, 915),
  '768x1024': touchCtx(768, 1024),
  '844x390': touchCtx(844, 390),
  '1280x800': { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'no-preference' },
};
const STACKED = ['320x568', '390x844', '412x915'];
const STEPS = ['space', 'structure', 'logp', 'mr', 'tpsa', 'activity', 'series', 'all'];

// ------------------------------------------------------------------------------------------------ helpers
async function open(browser, baseURL, context, { query = '?debug', counters = true } = {}) {
  const ctx = await browser.newContext(context), page = await ctx.newPage(), errors = [], requests = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror ' + e.message));
  page.on('request', r => { const u = new URL(r.url()); if (!['data:', 'blob:'].includes(u.protocol)) requests.push(u.origin); });
  await page.addInitScript(() => {
    window.__cls = 0;
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { /* unsupported */ }
  });
  if (counters) await page.addInitScript(installCounters);
  await page.goto(new URL('index.html' + query, baseURL).href);
  await page.waitForFunction(() => window.__hansch?.stage?.points && document.querySelector('#stage-status').hidden, null, { timeout: 90_000 });
  await tweensDone(page);
  return { ctx, page, errors, requests };
}
const tweensDone = page => page.waitForFunction(() => window.__hansch.anim.t >= 1 && window.gsap.globalTimeline.getChildren(false, true, true).every(k => k.paused()), null, { timeout: 30_000 });
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 140)))));
const scrollToY = async (page, y) => { await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), y); await frames(page); };
/**
 * Wait until the page has stopped scrolling (smooth or not): the same scrollY for 350 ms and for 6 animation frames. Time alone
 * is not enough here: with software WebGL one frame can take 0.2 to 1.3 s (a tour step's first draw), and a smooth scroll that
 * has not drawn its next frame looked settled (back-to-top was read at 13509 px at 1280 x 800 and at 58 px at 768 x 1024).
 */
const scrollSettled = page => page.waitForFunction(() => { const y = scrollY, t = performance.now(), s = window.__ss; if (!s || s.y !== y) { window.__ss = { y, t, n: 0 }; return false; } return ++s.n >= 6 && t - s.t > 350; }, null, { timeout: 15_000, polling: 'raf' });

/** Geometry of what sticks to the top of the screen, in the current layout. */
const geom = page => page.evaluate(() => {
  const r = s => document.querySelector(s)?.getBoundingClientRect();
  const narrow = matchMedia('(max-width: 700px) and (orientation: portrait)').matches, land = matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
  const m = r('.masthead'), st = r('.stage-inner'), head = Math.max(0, m.bottom);
  return { narrow, land, H: innerHeight, W: innerWidth, headH: m.height, headBottom: m.bottom, stageH: st.height, stageBottom: st.bottom, stack: narrow ? Math.max(head, st.bottom) : land ? 0 : head };
});
/** Click a section link the way a reader would: the Contents button where there is one, else the inline navigation. */
async function jump(page, id) {
  const btn = page.locator('#contents-btn');
  if (await btn.isVisible()) { await btn.click(); await page.locator(`#contents-menu a[href="#${id}"]`).click(); }
  else await page.locator(`.jump a[href="#${id}"]`).click();
  await scrollSettled(page);
  await frames(page);
}
const HEADING = { tour: '.step[data-step="space"] h2', explore: '#explore-h', hansch: '#hansch-h', method: '#method-h' };
/** Put step `name`'s heading just under the sticky stack (header + stage on a phone, with the header counted even when it has slid away). */
async function scrollToStepHeading(page, name) {
  await page.evaluate(name => {
    const q = s => document.querySelector(s), narrow = matchMedia('(max-width: 700px) and (orientation: portrait)').matches, land = matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
    const head = q('.masthead').offsetHeight, stage = q('.stage-inner').offsetHeight;
    const want = (narrow ? head + stage : land ? 0 : head) + 12;
    const h = q(`.step[data-step="${name}"] h2`).getBoundingClientRect();
    window.scrollBy({ top: h.top - want, behavior: 'instant' });
  }, name);
  await frames(page);
}
const settle = async page => { await tweensDone(page); await quiet(page, 400); };
/** Put the page back to the top with nothing open. */
async function tidy(page) {
  if (await page.evaluate(() => document.body.classList.contains('stage-full'))) await page.keyboard.press('Escape');
  const close = page.locator('#sheet-close');
  if (await close.isVisible()) await close.click();
  if (await page.locator('#contents-btn').getAttribute('aria-expanded') === 'true') await page.keyboard.press('Escape');
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.waitForTimeout(350);
  await frames(page);
}
const selectByName = (page, re = 'dexamethasone') => page.evaluate(re => { const h = window.__hansch, d = h.app.drugs.find(x => new RegExp(re, 'i').test(x.name)); h.selectDrug(d.cid); return d.cid; }, re);
/** Screen position (viewport CSS px) of drug `idx` on the stage canvas, from the live camera and the interpolated positions. */
const screenOf = (page, idx) => page.evaluate(i => {
  const h = window.__hansch, c = document.querySelector('#space').getBoundingClientRect(), k = i * 4, cur = h.anim.cur;
  h.stage.camera.updateMatrixWorld();
  const v = new h.THREE.Vector3(cur[k], cur[k + 1], cur[k + 2]).project(h.stage.camera);
  return { x: c.left + (v.x * 0.5 + 0.5) * c.width, y: c.top + (-v.y * 0.5 + 0.5) * c.height, left: c.left, top: c.top, right: c.right, bottom: c.bottom };
}, idx);
const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

test.describe.configure({ mode: 'serial' });

// ================================================================================================ per viewport
for (const [label, context] of Object.entries(VP)) {
  const stacked = STACKED.includes(label), landscape = label === '844x390', desktopMouse = label === '1280x800', tablet = label === '768x1024';
  test.describe(`mobile layout @ ${label}`, () => {
    let ctx, page, errors, requests;
    test.beforeAll(async ({ browser, baseURL }, info) => {
      info.setTimeout(150_000);
      ({ ctx, page, errors, requests } = await open(browser, baseURL, context));
    });
    test.afterAll(async () => { await ctx?.close(); });
    test.setTimeout(240_000);

    test('shape: stacked on phones in portrait, two columns elsewhere; header is one row; no horizontal scroll', async () => {
      const g = await geom(page);
      expect(g.narrow, 'stacked layout').toBe(stacked);
      expect(g.land, 'landscape phone layout').toBe(landscape);
      expect(await noHorizontalScroll(page), 'document.scrollWidth - innerWidth').toBeLessThanOrEqual(0);
      const cols = await page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { stage: r('#stage'), rail: r('#rail'), head: r('.masthead'), headPos: getComputedStyle(document.querySelector('.masthead')).position, sub: getComputedStyle(document.querySelector('.brand .sub')).display, h1: r('.brand h1') }; });
      if (stacked) {
        expect(cols.rail.top, 'text under the stage').toBeGreaterThanOrEqual(cols.stage.bottom - 1);
        expect(cols.head.height, 'one row, 44 to 56 px').toBeGreaterThanOrEqual(44);
        expect(cols.head.height).toBeLessThanOrEqual(56);
        expect((g.headH + g.stageH) / g.H, '(header + stage) / viewport height').toBeLessThanOrEqual(0.45);
      } else {
        expect(cols.rail.left, 'text beside the stage').toBeGreaterThanOrEqual(cols.stage.right - 1);
        expect(cols.stage.left).toBeLessThanOrEqual(1);
      }
      if (landscape) {
        expect(cols.headPos, 'static header on a landscape phone').toBe('static');
        expect(cols.head.height).toBeLessThanOrEqual(48);
        expect(Math.round(g.stageH), 'the stage is as tall as the screen').toBe(g.H);
      } else if (!desktopMouse && !stacked) expect(cols.head.height, 'one-row header on a tablet').toBeLessThanOrEqual(64);
      if (!desktopMouse) expect(cols.sub, 'the long sentence is hidden below 1280 px').toBe('none');
      expect(errors.filter(e => !/favicon/.test(e)), 'console errors').toEqual([]);
      expect([...new Set(requests)], 'every request goes to the page origin').toHaveLength(1);
    });

    test('navigation: Contents button on phones and landscape phones, inline links from 701 px (not landscape)', async () => {
      const vis = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!e && e.checkVisibility({ checkVisibilityCSS: true }); }; return { jump: v('.jump'), contents: v('#contents-btn'), fab: v('#fab-top') }; });
      if (stacked || landscape) expect(vis, 'Contents replaces the inline links').toMatchObject({ jump: false, contents: true });
      else expect(vis, 'inline links').toMatchObject({ jump: true, contents: false });
      expect(vis.fab, 'no back-to-top button at the top').toBe(false);
    });

    test('anchors: after each jump the target heading is fully below the sticky stack (UX-04)', async () => {
      const seen = [];
      for (const id of ['explore', 'hansch', 'method', 'tour']) {
        await jump(page, id);
        const r = await page.evaluate(sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; }, HEADING[id]);
        const g = await geom(page);
        seen.push(`${id}: heading ${Math.round(r.top)}..${Math.round(r.bottom)} stack ${Math.round(g.stack)}`);
        expect(r.top, `#${id} heading top vs stack bottom`).toBeGreaterThanOrEqual(g.stack - 0.5);
        expect(r.bottom, `#${id} heading inside the screen`).toBeLessThanOrEqual(g.H);
      }
      test.info().annotations.push({ type: 'jumps', description: seen.join(' | ') });
      await tidy(page);
    });

    test('anchors: the page opened on #explore lands with the heading visible', async ({ browser, baseURL }) => {
      const c = await browser.newContext(context), p = await c.newPage();
      await p.goto(new URL('index.html?debug#explore', baseURL).href);
      await p.waitForFunction(() => window.__hansch?.stage?.points && document.querySelector('#stage-status').hidden, null, { timeout: 90_000 });
      await scrollSettled(p);
      await p.waitForTimeout(500);
      const r = await p.evaluate(() => document.querySelector('#explore-h').getBoundingClientRect().top), g = await geom(p);
      expect(r, 'heading under the stack').toBeGreaterThanOrEqual(g.stack - 0.5);
      expect(r, 'heading on the screen').toBeLessThan(g.H - 40);
      await c.close();
    });

    test('tour: the active step is the step whose heading is first visible below the stack (UX-08), all eight steps', async () => {
      const bad = [];
      for (const name of STEPS) {
        await scrollToStepHeading(page, name);
        await page.waitForTimeout(250);
        const t = await page.evaluate(name => {
          const q = s => document.querySelector(s), narrow = matchMedia('(max-width: 700px) and (orientation: portrait)').matches, land = matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
          const stack = narrow ? q('.masthead').offsetHeight + q('.stage-inner').offsetHeight : land ? 0 : q('.masthead').offsetHeight;
          const first = [...document.querySelectorAll('.step')].find(s => s.querySelector('h2').getBoundingClientRect().top >= stack - 1);
          return { first: first?.dataset.step, active: window.__hansch.app.step, line: window.__hansch.tour.band().line, stack };
        }, name);
        if (t.first !== name || t.active !== name) bad.push(`${name}: first visible ${t.first}, active ${t.active}, line ${t.line}, stack ${t.stack}`);
        expect(t.line, 'the reading line is below the stack').toBeGreaterThan(t.stack);
      }
      expect(bad).toEqual([]);
      await tidy(page);
    });

    test('3D: no axis title or visible tick label outside .stage-inner; the cube fits the canvas; the legend is not truncated', async () => {
      const report = [];
      const states = [...STEPS.map(n => ['step', n]), ['explore', 'explore']];
      for (const [kind, name] of states) {
        if (kind === 'step') await scrollToStepHeading(page, name); else await jump(page, 'explore');
        await settle(page);
        const m = await page.evaluate(() => {
          const h = window.__hansch, inner = document.querySelector('.stage-inner').getBoundingClientRect(), cv = document.querySelector('#space');
          const outside = [...document.querySelectorAll('#labels .ax-title, #labels .ax-label')].filter(e => e.style.visibility !== 'hidden' && e.offsetParent !== null && e.getBoundingClientRect().width)
            .filter(e => { const b = e.getBoundingClientRect(); return b.left < inner.left - 1 || b.right > inner.right + 1 || b.top < inner.top - 1 || b.bottom > inner.bottom + 1; }).map(e => `${e.className.split(' ')[0]} "${e.textContent}"`);
          const titles = [...document.querySelectorAll('#labels .ax-title')].filter(e => e.getBoundingClientRect().width).length;
          const cam = h.stage.camera; cam.updateMatrixWorld();
          let worst = 0; const v = new h.THREE.Vector3();
          for (const x of [-10, 10]) for (const y of [-10, 10]) for (const z of [-10, 10]) { v.set(x, y, z).project(cam); worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y)); }
          const lg = document.querySelector('#legend'), spans = [...lg.children];
          const trunc = spans.filter(s => getComputedStyle(s).textOverflow === 'ellipsis' && s.scrollWidth > s.clientWidth + 1).map(s => s.textContent);
          return { outside, titles, worst, canvas: [cv.clientWidth, cv.clientHeight], trunc, legendScrolls: lg.scrollWidth > lg.clientWidth + 1, legendFocusable: lg.tabIndex === 0, size: document.body.dataset.stageSize, titleCount: titles };
        });
        report.push(`${name}: cube ${m.worst.toFixed(2)} canvas ${m.canvas.join('x')}`);
        expect(m.outside, `${name}: labels outside the stage`).toEqual([]);
        expect(m.trunc, `${name}: legend items cut with an ellipsis`).toEqual([]);
        if (m.legendScrolls) expect(m.legendFocusable, `${name}: a scrolling legend is keyboard reachable`).toBe(true);
        // camera fit: every corner of the plot cube is inside the canvas on compact stages (a big desktop stage keeps the original distance, where the near corner may be cropped)
        const compact = Math.min(...m.canvas) < 560;
        if (compact) expect(m.worst, `${name}: cube corners inside the canvas (NDC)`).toBeLessThanOrEqual(1.0);
        else test.info().annotations.push({ type: `fit ${name}`, description: `desktop stage, original distance, corner at ${m.worst.toFixed(2)}` });
      }
      test.info().annotations.push({ type: 'camera fit (NDC of the worst cube corner)', description: report.join('; ') });
      await tidy(page);
    });

    test('legend: each colour mode shows every item whole (ramp, counts, names)', async () => {
      await scrollToStepHeading(page, 'space');
      for (const color of ['atc', 'oral', 'act', 'ro5', 'single']) {
        await page.evaluate(c => window.__hansch.setView({ color: c }), color);
        await frames(page);
        const r = await page.evaluate(() => {
          const lg = document.querySelector('#legend'), box = lg.getBoundingClientRect();
          const parts = [...lg.children].map(s => { const b = s.getBoundingClientRect(), cs = getComputedStyle(s); return { t: s.textContent, w: b.width, fits: s.scrollWidth <= s.clientWidth + 1, ellipsis: cs.textOverflow === 'ellipsis' && cs.overflow !== 'visible' }; });
          const ramp = lg.querySelector('.ramp')?.getBoundingClientRect().width ?? null;
          return { parts, ramp, scrolls: lg.scrollWidth > lg.clientWidth + 1, boxW: box.width, ox: getComputedStyle(lg).overflowX };
        });
        expect(r.parts.filter(p => !p.fits || p.ellipsis).map(p => p.t), `${color}: cut items`).toEqual([]);
        if (r.ramp !== null) expect(r.ramp, 'the colour ramp keeps its width').toBeGreaterThanOrEqual(80);
        if (r.scrolls) expect(['auto', 'scroll'], 'a legend wider than its box scrolls sideways').toContain(r.ox);
      }
      await tidy(page);
    });

    test('every visible interactive element is at least 44 x 44 CSS px (default state, menu open, sheet open)', async () => {
      const audit = () => page.evaluate(() => {
        const SEL = 'button, a[href], select, input:not([type="hidden"]), summary, textarea, [role="button"], [tabindex]:not([tabindex="-1"])', bad = [], seen = new Set(); let n = 0;
        for (const el of document.querySelectorAll(SEL)) {
          if (seen.has(el) || el.matches('canvas') || !el.checkVisibility({ checkVisibilityCSS: true })) continue;
          seen.add(el);
          // A scroll container that js/layout.js made focusable (the legend when it overflows, a wide table's wrapper) is
          // reachable so a keyboard can scroll it, not so it can be pressed; the 44 px rule is about press targets.
          if (el.matches('div[tabindex="0"]') && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) continue;
          let t = el;
          if (el.matches('input[type="checkbox"], input[type="radio"]')) t = el.closest('label') || document.querySelector(`label[for="${el.id}"]`) || el;
          if (el.matches('a[href]')) { const own = [...el.parentElement.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join(' '); if (/[A-Za-z]{3,}/.test(own)) continue; }
          if (el.closest('.skip-links')) continue;
          const b = t.getBoundingClientRect();
          if (!b.width && !b.height) continue;
          n++;
          if (b.width < 43.9 || b.height < 43.9) bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
        }
        return { n, bad };
      });
      const results = {};
      const run = async name => { results[name] = await audit(); expect(results[name].bad, `controls under 44 px (${name})`).toEqual([]); };
      await run('default');
      await jump(page, 'explore');
      await page.evaluate(() => document.querySelectorAll('#explore details').forEach(d => { d.open = true; }));
      await run('explore, all groups open');
      await page.evaluate(() => document.querySelectorAll('#explore details').forEach((d, i) => { d.open = i === 0; }));
      await jump(page, 'hansch');
      await run('hansch (strip: Show 3D)');
      if (await page.locator('#contents-btn').isVisible()) {
        await page.locator('#contents-btn').click();
        await run('Contents menu open');
        await page.keyboard.press('Escape');
      }
      await selectByName(page);
      await page.waitForTimeout(400);
      if (await page.locator('#sheet-handle').isVisible()) { await page.locator('#sheet-handle').click(); await page.waitForTimeout(500); await run('sheet half'); }
      else await run('card');
      test.info().annotations.push({ type: 'controls checked', description: Object.entries(results).map(([k, v]) => `${k}: ${v.n}`).join(', ') });
      await tidy(page);
    });

    test('drug panel: a sheet on touch screens (peek, half, full), a card in the text column with a mouse', async () => {
      await scrollToY(page, 0);
      const cid = await selectByName(page);
      await page.waitForTimeout(500);
      const info = () => page.evaluate(() => { const d = document.querySelector('#detail'), b = d.getBoundingClientRect(), hd = document.querySelector('#sheet-handle'); return { sheet: d.dataset.sheet, pos: getComputedStyle(d).position, left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width, h: b.height, H: innerHeight, W: innerWidth, expanded: hd.getAttribute('aria-expanded'), handleH: hd.getBoundingClientRect().height, handleVisible: hd.checkVisibility({ checkVisibilityCSS: true }), scrollY, ob: getComputedStyle(document.querySelector('#sheet-body')).overscrollBehaviorY }; });
      if (desktopMouse) {
        const i = await info();
        expect(i.pos, 'a card in the text column').not.toBe('fixed');
        expect(i.handleVisible, 'no sheet handle on a desktop').toBe(false);
        expect(i.top, 'scrolled into view (nearest)').toBeLessThan(i.H);
        expect(i.bottom).toBeGreaterThan(0);
        expect(await page.evaluate(() => document.querySelector('#d-name').textContent.length), 'the panel shows the drug').toBeGreaterThan(3);
        await tidy(page);
        return;
      }
      // peek: name, three numbers, handle; the selection ring stays on the stage above it
      let i = await info();
      expect(i.sheet, 'opens in peek on a selection').toBe('peek');
      expect(i.pos).toBe('fixed');
      expect(i.h, 'peek height').toBeGreaterThanOrEqual(90);
      expect(i.h).toBeLessThanOrEqual(104);
      expect(i.handleH, 'handle is a 44 px button').toBeGreaterThanOrEqual(44);
      expect(i.expanded).toBe('false');
      // a full-width sheet sits on the bottom edge; on tablets and landscape phones css/layout.css floats a card 12 px above it
      if (tablet || landscape) expect(Math.round(i.bottom), 'a card 12 px above the bottom edge').toBe(i.H - 12);
      else expect(i.bottom, 'sits on the bottom edge').toBeGreaterThanOrEqual(i.H - 1);
      expect(await page.locator('#sheet-metrics').textContent()).toMatch(/log P .* MR .* TPSA/);
      expect(await page.locator('#sheet-title').textContent()).toMatch(/dexamethasone/i);
      const idx = await page.evaluate(c => window.__hansch.app.drugs.findIndex(d => d.cid === c), cid);
      const s = await screenOf(page, idx);
      expect(await page.evaluate(() => window.__hansch.stage.ring.visible), 'the selection ring is drawn').toBe(true);
      expect(s.y, 'ring above the sheet').toBeLessThan(i.top - 4);
      expect(s.y).toBeGreaterThan(s.top);
      expect(s.x).toBeGreaterThan(s.left);
      expect(s.x).toBeLessThan(s.right);
      if (tablet || landscape) { expect(Math.round(i.w), 'a 360 px card beside the text').toBe(360); expect(i.right).toBeLessThanOrEqual(i.W - 11); }
      else expect(Math.round(i.w), 'full width').toBe(i.W);
      expect(i.ob, 'the sheet does not chain scrolling to the page').toBe('contain');
      // half, with the conformer drawn
      await page.locator('#sheet-handle').click();
      await page.waitForTimeout(500);
      i = await info();
      expect(i.sheet).toBe('half');
      expect(i.expanded, 'aria-expanded on the handle').toBe('true');
      if (stacked || tablet) expect(i.h / i.H, 'half = 50 svh').toBeGreaterThan(0.47);
      if (stacked || tablet) expect(i.h / i.H).toBeLessThan(0.53);
      await page.waitForFunction(() => { const t = document.querySelector('#d-src').textContent; return t && !/Loading/.test(t); }, null, { timeout: 30_000 });
      // a landscape phone's half card is 195 px tall and shows about 100 px of panel under the name, so the conformer is one
      // scroll down inside the sheet, as a reader would scroll to it; js/gl/molviewer.js draws only while its canvas is on screen
      if (landscape) await page.locator('#sheet-body').evaluate(b => { b.scrollTop += document.querySelector('#mol').getBoundingClientRect().top - b.getBoundingClientRect().top; });
      await page.waitForFunction(() => (window.__draws.mol || 0) > 0, null, { timeout: 20_000 });
      await page.waitForFunction(() => window.__hansch.molv.visible, null, { timeout: 10_000 });
      await expect.poll(() => canvasInk(page, '#mol'), { timeout: 15_000, message: 'the conformer is drawn in the open sheet' }).toBeGreaterThan(0.01);
      // scrolling inside the sheet does not scroll the page behind it
      const y0 = await page.evaluate(() => scrollY);
      await page.locator('#sheet-body').evaluate(el => { el.scrollTop = 0; });
      const box = await page.locator('#sheet-body').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => scrollY), 'page stays put while the sheet scrolls').toBe(y0);
      // full
      await page.locator('#sheet-handle').click();
      await page.waitForTimeout(500);
      i = await info();
      expect(i.sheet).toBe('full');
      if (stacked) { expect(i.h / i.H).toBeGreaterThan(0.85); expect(i.h / i.H).toBeLessThan(0.91); }
      if (tablet) expect(Math.abs(i.h - Math.min(0.88 * i.H, 760)), 'the card stops at 760 px (88 svh would be 901 px)').toBeLessThan(2);
      // Escape steps down: full > half > peek > closed, and focus ends on the plot
      await page.keyboard.press('Escape');
      expect((await info()).sheet).toBe('half');
      await page.keyboard.press('Escape');
      expect((await info()).sheet).toBe('peek');
      await page.keyboard.press('Escape');
      expect((await info()).sheet).toBe('closed');
      expect(await page.evaluate(() => document.activeElement?.id), 'focus returns to the plot').toBe('space');
      // reopen through the search box (a different route), close with the button
      await jump(page, 'explore');
      await page.fill('#search', 'ibuprofen');
      await page.press('#search', 'Enter');
      await page.waitForTimeout(500);
      expect((await info()).sheet, 'opens from the search box too').toBe('peek');
      await page.locator('#sheet-close').click();
      expect((await info()).sheet).toBe('closed');
      await tidy(page);
    });

    test('Expand: the stage fills the screen, one finger turns it, Close / Escape put it back, focus returns, the page does not scroll behind', async () => {
      await scrollToY(page, 700);
      const y0 = await page.evaluate(() => scrollY);
      const btn = page.locator('#btn-expand');
      await expect(btn, 'the Expand button is shown once the 3D view is up').toBeVisible();
      const bb = await btn.boundingBox();
      expect(bb.width).toBeGreaterThanOrEqual(44);
      expect(bb.height).toBeGreaterThanOrEqual(44);
      // Pressed where it is on screen, as a finger or a mouse would. locator.click() first scrolls the button "into view", and the
      // sticky stage sits under the scroll-padding-top that css/layout.css sets for anchors (263 px here), so the test driver itself moved
      // the page from 700 to 307 and the tour announced the step it landed on.
      const press = async () => { const b = await btn.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
      const compact = await page.evaluate(() => [document.querySelector('#space').clientWidth, document.querySelector('#space').clientHeight]);
      await press();
      await page.waitForTimeout(500);
      const on = await page.evaluate(() => { const i = document.querySelector('.stage-inner').getBoundingClientRect(), h = window.__hansch; return { full: document.body.classList.contains('stage-full'), rect: [i.left, i.top, i.width, i.height], W: innerWidth, H: innerHeight, pressed: document.querySelector('#btn-expand').getAttribute('aria-expanded'), label: document.querySelector('#btn-expand').getAttribute('aria-label'), overflow: getComputedStyle(document.body).overflow, ta: getComputedStyle(document.querySelector('#space')).touchAction, one: h.stage.controls.touches.ONE, focus: document.activeElement?.id, live: document.querySelector('#sr-live').textContent }; });
      expect(on.full).toBe(true);
      expect(on.rect, 'covers the viewport').toEqual([0, 0, on.W, on.H]);
      expect(on.pressed).toBe('true');
      expect(on.label).toMatch(/Close/);
      expect(on.overflow, 'body scroll lock').toBe('hidden');
      expect(on.ta, 'one finger is the plot\'s own').toBe('none');
      expect(on.one, 'one finger rotates (THREE.TOUCH.ROTATE = 0)').toBe(0);
      expect(on.focus, 'focus stays on the (now Close) button inside the expanded view').toBe('btn-expand');
      expect(on.live, 'announced').toMatch(/fills the screen/);
      // the plot is redrawn at the new size and the cube still fits
      await settle(page);
      const fit = await page.evaluate(() => { const h = window.__hansch, cam = h.stage.camera; cam.updateMatrixWorld(); let w = 0; const v = new h.THREE.Vector3(); for (const x of [-10, 10]) for (const y of [-10, 10]) for (const z of [-10, 10]) { v.set(x, y, z).project(cam); w = Math.max(w, Math.abs(v.x), Math.abs(v.y)); } return { w, canvas: [document.querySelector('#space').clientWidth, document.querySelector('#space').clientHeight], buf: [h.stage.renderer.domElement.width, h.stage.renderer.domElement.height] }; });
      expect(fit.w, 'cube inside the expanded canvas').toBeLessThanOrEqual(1.0);
      // bigger than the stage in the page, not taller than a fixed 400 px: a landscape phone's screen is 390 px tall and its stage
      // in the page is already full height (346 px), so there the expanded canvas gains width
      expect(fit.canvas[0], `no narrower than the compact stage (${compact})`).toBeGreaterThanOrEqual(compact[0]);
      expect(fit.canvas[1], 'no shorter').toBeGreaterThanOrEqual(compact[1]);
      expect(fit.canvas[0] * fit.canvas[1], 'and bigger').toBeGreaterThan(1.2 * compact[0] * compact[1]);
      // Escape closes; scroll position and focus come back
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      let off = await page.evaluate(() => ({ full: document.body.classList.contains('stage-full'), y: scrollY, focus: document.activeElement?.id, pressed: document.querySelector('#btn-expand').getAttribute('aria-expanded'), overflow: getComputedStyle(document.body).overflow, ta: getComputedStyle(document.querySelector('#space')).touchAction, live: document.querySelector('#sr-live').textContent }));
      expect(off.full).toBe(false);
      expect(off.y, 'the page is where it was').toBe(y0);
      expect(off.focus, 'focus returns to the Expand button').toBe('btn-expand');
      expect(off.pressed).toBe('false');
      expect(off.overflow).not.toBe('hidden');
      expect(off.live).toMatch(/back in the page/);
      if (stacked) expect(off.ta, 'compact stage on touch: one finger scrolls the page').toBe('pan-y');
      // and the Close button does the same
      await press();
      await page.waitForTimeout(400);
      await press();
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => document.body.classList.contains('stage-full'))).toBe(false);
      await tidy(page);
    });

    test('touch picking: the nearest sphere within 22 px wins; hit rate of a synthetic tap grid, mouse (exact ray) against touch', async () => {
      test.skip(desktopMouse, 'touch picking only applies to touch and pen');
      await scrollToY(page, 0);
      await settle(page);
      const r = await page.evaluate(() => {
        const h = window.__hansch, c = document.querySelector('#space').getBoundingClientRect(), cur = h.anim.cur; let mouse = 0, touch = 0, n = 0, reach = 0;
        // the screen position of every visible sphere centre in front of the camera, worked out here and not through the app's picking
        h.stage.camera.updateMatrixWorld();
        const v = new h.THREE.Vector3(), pts = [];
        for (let s = 0; s < h.stage.points.count; s++) { const i = h.stage.drugAt[s], k = i * 4; if (cur[k + 3] <= 0.5) continue; v.set(cur[k], cur[k + 1], cur[k + 2]).project(h.stage.camera); if (v.z >= -1 && v.z <= 1) pts.push([c.left + (v.x * 0.5 + 0.5) * c.width, c.top + (-v.y * 0.5 + 0.5) * c.height]); }
        for (let y = c.top + 4; y < c.bottom; y += 8) for (let x = c.left + 4; x < c.right; x += 8) {
          n++;
          const m = h.pickAt(x, y, 'mouse') >= 0;
          if (m) mouse++;
          if (h.pickAt(x, y, 'touch') >= 0) touch++;
          if (m || pts.some(([px, py]) => Math.hypot(px - x, py - y) <= 22)) reach++;   // a sphere centre within 22 px, or an exact ray hit (the fallback)
        }
        return { n, mouse, touch, reach, pen: (() => { let k = 0; for (let y = c.top + 4; y < c.bottom; y += 8) for (let x = c.left + 4; x < c.right; x += 8) if (h.pickAt(x, y, 'pen') >= 0) k++; return k; })() };
      });
      const rate = { mouse: r.mouse / r.n, touch: r.touch / r.n };
      test.info().annotations.push({ type: 'hit rate', description: `${label}: ${r.n} taps on an 8 px grid; selects a drug: mouse (exact ray) ${(rate.mouse * 100).toFixed(1)} %, touch (nearest within 22 px) ${(rate.touch * 100).toFixed(1)} %` });
      console.log(`HIT-RATE ${label}: mouse ${(rate.mouse * 100).toFixed(1)} % touch ${(rate.touch * 100).toFixed(1)} % (${r.n} taps)`);
      expect(rate.touch, 'touch reaches far more of the plot').toBeGreaterThan(rate.mouse * 3);
      // Exactly the taps within 22 px of a sphere select one. This replaced a floor of 20 % on the touch rate: how much of the grid
      // lies that close to a sphere depends on how the cloud spreads over the stage, and since the camera fits the cube to a compact
      // stage the 320 x 568 rate is 17 % with the picking rule unchanged (main gives the same number).
      expect(r.touch, 'every tap within 22 px of a sphere centre selects a drug, and no other tap does').toBe(r.reach);
      expect(r.pen, 'pen picks like touch').toBe(r.touch);
      // end to end: a real touch tap 10 px beside an isolated sphere selects it; a mouse click at the same point does not
      const target = await page.evaluate(() => {
        const h = window.__hansch, c = document.querySelector('#space').getBoundingClientRect(), cur = h.anim.cur; h.stage.camera.updateMatrixWorld();
        const v = new h.THREE.Vector3(), pts = [];
        for (let s = 0; s < h.stage.points.count; s++) { const i = h.stage.drugAt[s], k = i * 4; if (cur[k + 3] <= 0.5) continue; v.set(cur[k], cur[k + 1], cur[k + 2]).project(h.stage.camera); pts.push({ i, x: c.left + (v.x * 0.5 + 0.5) * c.width, y: c.top + (-v.y * 0.5 + 0.5) * c.height }); }
        // the only sphere within reach of the tap point (10, -9 px from its centre): on the 320 px stage no sphere is 40 px clear of all others
        const ok = pts.filter(p => p.x > c.left + 30 && p.x < c.right - 30 && p.y > c.top + 30 && p.y < c.bottom - 30 && !pts.some(q => q !== p && Math.hypot(q.x - p.x - 10, q.y - p.y + 9) <= 22));
        const p = ok[0];
        return p ? { ...p, mouseAt: h.pickAt(p.x + 10, p.y - 9, 'mouse'), touchAt: h.pickAt(p.x + 10, p.y - 9, 'touch') } : null;
      });
      expect(target, 'an isolated sphere exists').not.toBeNull();
      expect(target.mouseAt, 'an exact ray misses a point 13 px away').toBe(-1);
      expect(target.touchAt, 'nearest picking finds it').toBe(target.i);
      await page.touchscreen.tap(target.x + 10, target.y - 9);
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => window.__hansch.app.selected), 'a real touch tap selected the sphere').toBe(target.i);
      expect(await page.evaluate(() => document.querySelector('#detail').dataset.sheet), 'and the sheet opened in peek').toBe('peek');
      await tidy(page);
    });

    test('mouse picking is unchanged: only an exact ray hit selects', async () => {
      test.skip(!desktopMouse, 'desktop only');
      await settle(page);
      const r = await page.evaluate(() => {
        const h = window.__hansch, c = document.querySelector('#space').getBoundingClientRect(); let hits = 0, n = 0, farTouch = 0;
        for (let y = c.top + 4; y < c.bottom; y += 8) for (let x = c.left + 4; x < c.right; x += 8) { n++; if (h.pickAt(x, y) >= 0) hits++; if (h.pickAt(x, y, 'touch') >= 0) farTouch++; }
        return { n, hits, farTouch };
      });
      console.log(`HIT-RATE ${label}: mouse ${(100 * r.hits / r.n).toFixed(1)} % touch ${(100 * r.farTouch / r.n).toFixed(1)} %`);
      test.info().annotations.push({ type: 'hit rate', description: `${label}: mouse ${(100 * r.hits / r.n).toFixed(1)} %, touch ${(100 * r.farTouch / r.n).toFixed(1)} %` });
      expect(r.hits / r.n, 'exact picking: the spheres are a small part of the plot').toBeLessThan(0.15);
      expect(r.farTouch).toBeGreaterThan(r.hits * 2);
    });

    test('reading aids: back-to-top button and progress bar', async () => {
      await scrollToY(page, 0);
      expect(await page.locator('#fab-top').isVisible(), 'hidden at the top').toBe(false);
      await scrollToY(page, 2400);
      await expect(page.locator('#fab-top')).toBeVisible();
      const r = await page.evaluate(() => { const b = document.querySelector('#fab-top').getBoundingClientRect(); return { w: b.width, h: b.height, rightGap: innerWidth - b.right, bottomGap: innerHeight - b.bottom, p: parseFloat(document.querySelector('#read-progress').style.getPropertyValue('--p')), bar: document.querySelector('#read-progress').getBoundingClientRect().height }; });
      expect(r.w).toBeGreaterThanOrEqual(44);
      expect(r.h).toBeGreaterThanOrEqual(44);
      expect(r.rightGap, 'bottom right').toBeLessThan(40);
      expect(r.bottomGap).toBeLessThan(120);
      expect(r.p, 'progress is part way').toBeGreaterThan(0.02);
      expect(r.p).toBeLessThan(0.9);
      expect(r.bar, 'a 3 px bar').toBe(3);
      await scrollToY(page, 1e6);
      expect(await page.evaluate(() => parseFloat(document.querySelector('#read-progress').style.getPropertyValue('--p'))), 'full at the bottom').toBeGreaterThan(0.97);
      await page.locator('#fab-top').click();
      await scrollSettled(page);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      expect(await page.evaluate(() => document.activeElement?.tagName), 'focus moves to the page title').toBe('H1');
    });

    test('Explore: three groups, Find a drug first, one column below 480 px, short option labels with the long name as a hint; Show this fit under the group select', async () => {
      await jump(page, 'explore');
      const r = await page.evaluate(() => {
        const q = s => document.querySelector(s), groups = [...document.querySelectorAll('#explore details.group')];
        const kids = [...q('#explore').children].map(e => e.classList[0] || e.id || e.tagName);   // by class: the groups have ids too (g-axes ...)
        const cols = getComputedStyle(q('#g-axes .controls')).gridTemplateColumns.split(' ').length;
        const opts = [...q('#ax-x').options].map(o => o.textContent);
        return { open: groups.map(g => [g.id, g.open]), order: kids, cols, opts, hint: q('#ax-x-hint').textContent, w: q('#explore').getBoundingClientRect().width,
          showUnderSelect: q('#h-show').previousElementSibling === q('#h-group').closest('.field'), viewW: innerWidth };
      });
      expect(r.open).toEqual([['g-axes', true], ['g-atc', false], ['g-filters', false]]);
      expect(r.order.indexOf('field')).toBeLessThan(r.order.indexOf('group'));
      if (r.viewW < 480) expect(r.cols, 'one column below 480 px').toBe(1);
      expect(r.opts.every(o => o.length <= 22), `short labels in the select: ${r.opts.join(' | ')}`).toBe(true);
      expect(r.opts).toContain('log P');
      expect(r.hint, 'the long name is the hint').toMatch(/\(/);
      expect(r.showUnderSelect, 'Show this fit in 3D directly under the select').toBe(true);
      await tidy(page);
    });

    test('Hansch observed-vs-predicted plot: text is at least 12 px on screen', async () => {
      await jump(page, 'hansch');
      const r = await page.evaluate(() => { const svg = document.querySelector('#h-plot'), vb = svg.viewBox.baseVal, scale = svg.clientWidth / vb.width, t = svg.querySelector('text'); return { scale, fs: parseFloat(getComputedStyle(t).fontSize), eff: parseFloat(getComputedStyle(t).fontSize) * scale, cw: svg.clientWidth }; });
      expect(r.eff, `effective text size (${r.fs}px x ${r.scale.toFixed(2)})`).toBeGreaterThanOrEqual(11.95);
      await tidy(page);
    });

    test('static: safe-area insets are used on the left, right and bottom', async () => {
      const css = readFileSync(new URL('css/layout.css', SITE), 'utf8') + readFileSync(new URL('style.css', SITE), 'utf8');
      for (const side of ['left', 'right', 'bottom']) expect(css, `env(safe-area-inset-${side})`).toContain(`env(safe-area-inset-${side}`);
      expect(readFileSync(new URL('index.html', SITE), 'utf8')).toContain('viewport-fit=cover');
    });

    if (['320x568', '390x844', '412x915', '768x1024', '844x390', '1280x800'].includes(label)) {
      test('dark theme: screenshots for the verifier (top, a tour step, Explore, drug panel)', async () => {
        mkdirSync(SHOTS, { recursive: true });
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.waitForFunction(() => getComputedStyle(document.documentElement).colorScheme.includes('dark'), null, { timeout: 5000 });
        await scrollToY(page, 0);
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/spec-${label}-dark-top.png` });
        await scrollToStepHeading(page, 'activity'); await settle(page);
        await page.screenshot({ path: `${SHOTS}/spec-${label}-dark-step-activity.png` });
        await jump(page, 'explore'); await settle(page);
        await page.screenshot({ path: `${SHOTS}/spec-${label}-dark-explore.png` });
        await selectByName(page);
        await page.waitForTimeout(600);
        if (await page.locator('#sheet-handle').isVisible()) { await page.locator('#sheet-handle').click(); await page.waitForTimeout(700); }
        await page.screenshot({ path: `${SHOTS}/spec-${label}-dark-drug.png` });
        expect(existsSync(`${SHOTS}/spec-${label}-dark-drug.png`)).toBe(true);
        expect(errors.filter(e => !/favicon/.test(e)), 'no console errors in the whole run').toEqual([]);
        await page.emulateMedia({ colorScheme: 'light' });
        await tidy(page);
      });
    }
  });
}

// ================================================================================================ phone-only behaviour
test.describe('collapsing header and Contents menu @ 390x844', () => {
  let ctx, page;
  test.beforeAll(async ({ browser, baseURL }, info) => { info.setTimeout(150_000); ({ ctx, page } = await open(browser, baseURL, VP['390x844'])); });
  test.afterAll(async () => { await ctx?.close(); });
  test.setTimeout(180_000);

  test('Contents: keyboard (Enter, arrows, Home, End, Escape) and focus handling', async () => {
    const btn = page.locator('#contents-btn'), menu = page.locator('#contents-menu');
    const state = () => page.evaluate(() => ({ expanded: document.querySelector('#contents-btn').getAttribute('aria-expanded'), hidden: document.querySelector('#contents-menu').hidden, active: document.activeElement?.getAttribute('href') || document.activeElement?.id }));
    expect(await btn.getAttribute('aria-controls')).toBe('contents-menu');
    await btn.focus();
    await page.keyboard.press('Enter');
    expect(await state()).toEqual({ expanded: 'true', hidden: false, active: '#tour' });
    const rows = await menu.locator('a').evaluateAll(as => as.map(a => [a.textContent.trim(), Math.round(a.getBoundingClientRect().height)]));
    expect(rows.map(r => r[0]), 'Tour, Explore, Hansch fits, Method, Back to top').toEqual(['Tour', 'Explore', 'Hansch fits', 'Method', 'Back to top']);
    for (const [, h] of rows) expect(h, '48 px rows').toBeGreaterThanOrEqual(48);
    await page.keyboard.press('ArrowDown'); expect((await state()).active).toBe('#explore');
    await page.keyboard.press('End'); expect((await state()).active).toBe('#app');
    await page.keyboard.press('ArrowDown'); expect((await state()).active, 'wraps').toBe('#tour');
    await page.keyboard.press('ArrowUp'); expect((await state()).active, 'wraps up').toBe('#app');
    await page.keyboard.press('Home'); expect((await state()).active).toBe('#tour');
    await page.keyboard.press('Escape');
    expect(await state()).toEqual({ expanded: 'false', hidden: true, active: 'contents-btn' });
    // Enter on an item follows it, closes the menu, and the heading is below the stack
    await btn.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await scrollSettled(page);
    expect((await state()).expanded).toBe('false');
    const g = await geom(page), top = await page.evaluate(() => document.querySelector('#hansch-h').getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(g.stack - 0.5);
    // Tab out of the menu and a click outside both close it
    await btn.click(); expect((await state()).expanded).toBe('true');
    // opening puts focus on the first item (js/layout.js, as with Enter above), so the first Shift+Tab reaches the Contents
    // button, which belongs to the menu, and the second one leaves it
    await page.keyboard.press('Shift+Tab');
    expect(await state(), 'the button is part of the menu').toEqual({ expanded: 'true', hidden: false, active: 'contents-btn' });
    await page.keyboard.press('Shift+Tab');
    expect((await state()).expanded, 'focus left the menu').toBe('false');
    await btn.click(); expect((await state()).expanded).toBe('true');
    await page.mouse.click(200, 400);
    expect((await state()).expanded, 'a click outside closes').toBe('false');
    // the button toggles, and the page title area is not covered
    await btn.click(); await btn.click();
    expect((await state()).expanded).toBe('false');
    await tidy(page);
  });

  test('the header hides on scroll-down and returns on scroll-up (transform only), the stage rides with it', async () => {
    await scrollToY(page, 0);
    const read = () => page.evaluate(() => { const m = document.querySelector('.masthead'), cs = getComputedStyle(m); return { hidden: document.body.classList.contains('header-hidden'), top: Math.round(m.getBoundingClientRect().top), tp: cs.transitionProperty, td: cs.transitionDuration, stageTop: Math.round(document.querySelector('.stage-inner').getBoundingClientRect().top), stack: document.documentElement.style.getPropertyValue('--sticky-stack') }; });
    let s = await read();
    expect(s.hidden).toBe(false);
    expect(s.tp, 'only the transform animates').toBe('transform');
    await scrollToY(page, 600);
    await page.waitForTimeout(450);
    s = await read();
    expect(s.hidden, 'hidden after scrolling down').toBe(true);
    expect(s.top, 'slid off the top').toBeLessThan(-40);
    expect(s.stageTop, 'the stage rides up with it').toBeLessThanOrEqual(1);
    const stackBefore = s.stack;
    await page.evaluate(() => window.scrollBy({ top: -60, behavior: 'instant' }));
    await page.waitForTimeout(450);
    s = await read();
    expect(s.hidden, 'back after scrolling up').toBe(false);
    expect(s.top).toBe(0);
    expect(s.stack, 'the published stack does not depend on the header sliding').toBe(stackBefore);
    // a jitter of a few pixels does not toggle it
    await page.evaluate(() => window.scrollBy({ top: 10, behavior: 'instant' })); await page.waitForTimeout(100);
    await page.evaluate(() => window.scrollBy({ top: -8, behavior: 'instant' })); await page.waitForTimeout(300);
    expect((await read()).hidden, 'small movements keep the header').toBe(false);
    // focus in the header keeps it
    await scrollToY(page, 900); await page.waitForTimeout(400);
    expect((await read()).hidden).toBe(true);
    await page.locator('#contents-btn').focus();
    await page.waitForTimeout(300);
    expect((await read()).hidden, 'keyboard focus in the header shows it').toBe(false);
    await tidy(page);
  });

  test('stage strip: a focused input or select collapses the stage to the 56 px strip; blur restores it (UX-21)', async () => {
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'the touch context reports a coarse pointer').toBe(true);
    await jump(page, 'explore');
    const read = () => page.evaluate(() => ({ size: document.body.dataset.stageSize, kb: document.body.classList.contains('kb'), h: Math.round(document.querySelector('.stage-inner').getBoundingClientRect().height), space: getComputedStyle(document.querySelector('#space')).visibility, stack: document.documentElement.style.getPropertyValue('--sticky-stack') }));
    const before = await read();
    expect(before.size).toBe('explore');
    await page.focus('#search');
    await page.waitForTimeout(500);
    let s = await read();
    expect(s).toMatchObject({ size: 'strip', kb: true, h: 56, space: 'hidden' });
    await page.locator('#search').blur();
    await page.waitForTimeout(500);
    s = await read();
    expect(s, 'restored').toMatchObject({ size: 'explore', kb: false, space: 'visible' });
    expect(s.h).toBe(before.h);
    // a select does the same
    await page.focus('#ax-y'); await page.waitForTimeout(400);
    expect((await read()).size).toBe('strip');
    await page.locator('#ax-y').blur(); await page.waitForTimeout(400);
    expect((await read()).size).toBe('explore');
    await tidy(page);
  });

  test('stage height policy: tour, explore, and a 56 px strip with Show 3D while reading the rest', async () => {
    const sizeAt = async id => { await jump(page, id); await page.waitForTimeout(300); return page.evaluate(() => ({ mode: document.body.dataset.stage, size: document.body.dataset.stageSize, h: Math.round(document.querySelector('.stage-inner').getBoundingClientRect().height), H: innerHeight, head: document.querySelector('.masthead').offsetHeight, show: !document.querySelector('#btn-show3d').hidden })); };
    const tour = await sizeAt('tour'), ex = await sizeAt('explore'), hansch = await sizeAt('hansch'), method = await sizeAt('method');
    expect(tour).toMatchObject({ mode: 'tour', size: 'tour', show: false });
    expect(ex).toMatchObject({ mode: 'explore', size: 'explore', show: false });
    expect(hansch).toMatchObject({ mode: 'read', size: 'strip', h: 56, show: true });
    expect(method).toMatchObject({ mode: 'read', size: 'strip', h: 56, show: true });
    expect(tour.h, 'tour stage: clamp(190px, 38svh, 360px)').toBeGreaterThanOrEqual(190);
    expect(tour.h).toBeLessThanOrEqual(360);
    expect(ex.h, 'explore stage is smaller than the tour stage').toBeLessThan(tour.h);
    expect(ex.h / ex.H, '30 svh').toBeLessThan(0.34);
    // Show 3D brings the plot back, Hide 3D puts the strip back, and moving to another section resets it
    await page.locator('#btn-show3d').click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.body.dataset.stageSize)).toBe('explore');
    expect(await page.locator('#btn-show3d').textContent()).toBe('Hide 3D');
    await page.locator('#btn-show3d').click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.body.dataset.stageSize)).toBe('strip');
    // the skip link to the plot works even from the strip
    await page.keyboard.press('Home');
    await page.evaluate(() => document.querySelector('a[href="#space-skip"]').focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => ({ focus: document.activeElement?.id, size: document.body.dataset.stageSize })), 'the plot is revealed and focused').toEqual({ focus: 'space', size: 'explore' });
    await tidy(page);
  });

  test('compact stage on touch: the canvas lets the page scroll (touch-action pan-y) and one finger swipes the page, two fingers are the plot\'s', async () => {
    await scrollToY(page, 0);
    const r = await page.evaluate(() => ({ ta: getComputedStyle(document.querySelector('#space')).touchAction, ONE: window.__hansch.stage.controls.touches.ONE, TWO: window.__hansch.stage.controls.touches.TWO, mol: getComputedStyle(document.querySelector('#mol')).touchAction }));
    expect(r.ta).toBe('pan-y');
    expect(r.ONE, 'one finger does nothing to the camera').toBeNull();
    expect(r.TWO, 'two fingers: dolly + rotate (THREE.TOUCH.DOLLY_ROTATE = 3)').toBe(3);
    expect(r.mol, 'the conformer canvas does not trap a scroll either').toBe('pan-y');
    const cdp = await page.context().newCDPSession(page);
    const c = await page.evaluate(() => { const b = document.querySelector('#space').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height * 0.6) }; });
    const before = await page.evaluate(() => scrollY);
    await cdp.send('Input.synthesizeScrollGesture', { x: c.x, y: c.y, yDistance: -250, gestureSourceType: 'touch', speed: 800 });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => scrollY), 'a one-finger swipe that starts on the stage scrolls the page').toBeGreaterThan(before + 100);
    await tidy(page);
  });

  test('address-bar resize (844 to 764), a resize storm and rotation leave the reading place alone', async () => {
    await scrollToStepHeading(page, 'activity');
    await settle(page);
    const snap = () => page.evaluate(() => ({ step: window.__hansch.app.step, y: Math.round(scrollY), stage: Math.round(document.querySelector('.stage-inner').getBoundingClientRect().height), head: Math.round(document.querySelector('[data-step="activity"] h2').getBoundingClientRect().top), buf: [window.__hansch.stage.renderer.domElement.width, window.__hansch.stage.renderer.domElement.height], stack: document.documentElement.style.getPropertyValue('--sticky-stack'), cls: window.__cls }));
    const a = await snap();
    expect(a.step).toBe('activity');
    // the 9-step sweep of a sliding browser toolbar: width unchanged, height 844 to 764 in 10 px steps and back
    for (let h = 834; h >= 764; h -= 10) { await page.setViewportSize({ width: 390, height: h }); await page.waitForTimeout(60); }
    await page.waitForTimeout(500);
    let b = await snap();
    expect(b.step, 'active step').toBe(a.step);
    expect(b.y, 'scroll position').toBe(a.y);
    expect(b.stage, 'stage height').toBe(a.stage);
    expect(b.head, 'heading position').toBe(a.head);
    expect(b.buf, 'the drawing buffer is not re-allocated').toEqual(a.buf);
    expect(b.stack).toBe(a.stack);
    // a storm: 40 same-width resizes without pausing
    for (let k = 0; k < 40; k++) await page.setViewportSize({ width: 390, height: 764 + ((k * 37) % 80) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(700);
    b = await snap();
    expect(b.step).toBe(a.step);
    expect(b.y).toBe(a.y);
    expect(b.stage).toBe(a.stage);
    expect(b.buf).toEqual(a.buf);
    test.info().annotations.push({ type: 'CLS', description: `after the address-bar sweep and the storm: ${(b.cls).toFixed(4)}` });
    // rotation: the reading place (the step being read) survives a turn to landscape and back
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(900);
    const land = await page.evaluate(() => { const q = s => document.querySelector(s).getBoundingClientRect(), line = window.__hansch.tour.band().line, st = q('[data-step="activity"]'); return { step: window.__hansch.app.step, stepHasLine: st.top <= line && st.bottom >= line, layout: matchMedia('(orientation: landscape) and (max-height: 520px)').matches, stageH: Math.round(q('.stage-inner').height), H: innerHeight }; });
    expect(land.layout).toBe(true);
    expect(land.step, 'still reading the same step in landscape').toBe('activity');
    expect(land.stepHasLine, 'the step is under the reading line').toBe(true);
    expect(land.stageH).toBe(land.H);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(900);
    const back = await page.evaluate(() => { const q = s => document.querySelector(s).getBoundingClientRect(), line = window.__hansch.tour.band().line, st = q('[data-step="activity"]'); return { step: window.__hansch.app.step, stepHasLine: st.top <= line && st.bottom >= line, heading: Math.round(q('[data-step="activity"] h2').top), stack: parseFloat(document.documentElement.style.getPropertyValue('--sticky-stack')), cls: window.__cls }; });
    expect(back.step).toBe('activity');
    expect(back.stepHasLine, 'back in portrait the step is under the reading line again').toBe(true);
    expect(back.heading, 'its heading is below the stack').toBeGreaterThanOrEqual(back.stack - 0.5);
    test.info().annotations.push({ type: 'CLS', description: `after rotation to landscape and back: ${back.cls.toFixed(4)}` });
    await tidy(page);
  });
});

test.describe('layout shift and axe @ 390x844', () => {
  test.setTimeout(240_000);

  test('CLS <= 0.05 at load, through the tour, an address-bar resize and a rotation', async ({ browser, baseURL }, info) => {
    const { ctx, page } = await open(browser, baseURL, VP['390x844']);
    const cls = () => page.evaluate(() => window.__cls), log = {};
    await page.waitForTimeout(800);
    log.load = await cls();
    for (const n of STEPS) { await scrollToStepHeading(page, n); await page.waitForTimeout(150); }
    await jump(page, 'explore'); await jump(page, 'hansch'); await jump(page, 'method');
    log.scrolling = await cls();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await page.waitForTimeout(500);
    const base = await cls();
    for (let h = 834; h >= 764; h -= 10) { await page.setViewportSize({ width: 390, height: h }); await page.waitForTimeout(80); }
    await page.waitForTimeout(500);
    for (let h = 774; h <= 844; h += 10) { await page.setViewportSize({ width: 390, height: h }); await page.waitForTimeout(80); }
    await page.waitForTimeout(500);
    log.addressBar = (await cls()) - base;
    const afterBar = await cls();
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(900);
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(900);
    log.rotate = (await cls()) - afterBar;
    info.annotations.push({ type: 'CLS', description: Object.entries(log).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(', ') });
    console.log('CLS', JSON.stringify(log));
    expect(log.load, 'at load').toBeLessThanOrEqual(0.05);
    expect(log.scrolling - log.load, 'scrolling the whole page and jumping between sections').toBeLessThanOrEqual(0.05);
    expect(log.addressBar, 'address bar 844 to 764 and back').toBeLessThanOrEqual(0.05);
    expect(log.rotate, 'rotate to landscape and back').toBeLessThanOrEqual(0.05);
    await ctx.close();
  });

  for (const scheme of ['light', 'dark']) {
    test(`axe: zero serious or critical violations (default, Contents open, sheet open) - ${scheme}`, async ({ browser, baseURL }, info) => {
      const { ctx, page } = await open(browser, baseURL, touchCtx(390, 844, { colorScheme: scheme }));
      const run = async name => {
        const res = await new AxeBuilder({ page }).analyze();
        const bad = res.violations.filter(v => ['serious', 'critical'].includes(v.impact));
        info.annotations.push({ type: `axe ${name}`, description: `${res.violations.map(v => `${v.impact}:${v.id}(${v.nodes.length})`).join(' ') || 'none'}` });
        expect(bad.map(v => `${v.impact} ${v.id}: ${v.help}\n  ${v.nodes.slice(0, 4).map(n => n.target.join(' ') + ' :: ' + (n.any[0]?.message || n.all[0]?.message || n.none[0]?.message || '')).join('\n  ')}`), `serious/critical axe violations (${name})`).toEqual([]);
      };
      await run('default');
      await page.locator('#contents-btn').click();
      await run('Contents open');
      await page.keyboard.press('Escape');
      await jump(page, 'explore');
      await selectByName(page);
      await page.waitForTimeout(500);
      await page.locator('#sheet-handle').click();
      await page.waitForFunction(() => { const t = document.querySelector('#d-src').textContent; return t && !/Loading/.test(t); }, null, { timeout: 30_000 });
      await page.waitForTimeout(500);
      await run('sheet half');
      await page.locator('#sheet-handle').click();
      await page.waitForTimeout(500);
      await run('sheet full');
      await ctx.close();
    });
  }
});

test.describe('reduced motion @ 390x844', () => {
  test.setTimeout(180_000);
  test('the header still hides and returns, nothing animates, jumps and back-to-top are instant', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, touchCtx(390, 844, { reducedMotion: 'reduce' }));
    const d = await page.evaluate(() => ({ head: getComputedStyle(document.querySelector('.masthead')).transitionDuration, stage: getComputedStyle(document.querySelector('.stage')).transitionDuration, step: getComputedStyle(document.querySelector('.step')).transitionDuration }));
    expect(d).toEqual({ head: '0s', stage: '0s', step: '0s' });
    await scrollToY(page, 700); await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.body.classList.contains('header-hidden')), 'hides').toBe(true);
    await page.evaluate(() => window.scrollBy({ top: -80, behavior: 'instant' })); await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.body.classList.contains('header-hidden')), 'returns').toBe(false);
    await page.locator('#fab-top').click();
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => scrollY), 'back to top is instant under reduced motion').toBe(0);
    await page.locator('#btn-expand').click(); await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.body.classList.contains('stage-full'))).toBe(true);
    await page.keyboard.press('Escape');
    await ctx.close();
  });
});

test.describe('desktop window keeps the original layout @ 1280x800', () => {
  test.setTimeout(150_000);
  test('inline navigation, sticky header, text beside a sticky stage, the sheet is not used', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, VP['1280x800']);
    const r = await page.evaluate(() => { const q = s => document.querySelector(s); const b = s => q(s).getBoundingClientRect(); return { jump: q('.jump').checkVisibility({ checkVisibilityCSS: true }), contents: q('#contents-btn').checkVisibility({ checkVisibilityCSS: true }), sub: getComputedStyle(q('.brand .sub')).display, head: b('.masthead').height, headPos: getComputedStyle(q('.masthead')).position, stagePos: getComputedStyle(q('#stage')).position, stage: b('#stage'), rail: b('#rail'), expandText: q('#btn-expand').textContent, size: document.body.dataset.stageSize, ta: getComputedStyle(q('#space')).touchAction, one: window.__hansch.stage.controls.touches.ONE }; });
    expect(r).toMatchObject({ jump: true, contents: false, headPos: 'sticky', stagePos: 'sticky', size: 'tour', one: 0 });
    expect(r.rail.left, 'two columns').toBeGreaterThan(r.stage.right - 2);
    expect(r.ta, 'the original touch-action on the plot').toBe('none');
    // the header never hides on a desktop, whatever the scroll direction
    await scrollToY(page, 1500);
    expect(await page.evaluate(() => document.body.classList.contains('header-hidden'))).toBe(false);
    await ctx.close();
  });
});
