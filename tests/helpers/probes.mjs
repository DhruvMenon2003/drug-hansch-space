// probes.mjs - page-side counters and readers shared by the runtime specs (idle, quality, fallbacks, lod, leaks, tour-scroll).
// Counters are installed with addInitScript so they exist before any app code runs:
//   window.__raf          requestAnimationFrame callbacks that RAN (any caller: three, gsap, the app)
//   window.__draws[id]    draw calls per canvas id (drawArrays / drawElements and their instanced forms, WebGL1 and 2)
//   window.__bufs[id]     live WebGL buffers per canvas id (createBuffer minus deleteBuffer)
import { expect } from '@playwright/test';
import { colourSpread, decodePng } from './png.mjs';

/** Runs in every page before any script. */
export function installCounters() {
  window.__raf = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(t => { window.__raf++; cb(t); });
  window.__draws = {}; window.__bufs = {};
  for (const P of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype]) {
    if (!P) continue;
    for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const o = P[f];
      P[f] = function (...a) { const id = this.canvas?.id || '?'; window.__draws[id] = (window.__draws[id] || 0) + 1; return o.apply(this, a); };
    }
    const cb = P.createBuffer, db = P.deleteBuffer;
    P.createBuffer = function () { const b = cb.call(this); (window.__bufs[this.canvas?.id || '?'] ||= new Set()).add(b); return b; };
    P.deleteBuffer = function (b) { window.__bufs[this.canvas?.id || '?']?.delete(b); return db.call(this, b); };
  }
}

/** Open the site with ?debug and wait until the 3D scene has drawn its first frame and the layout tween is over. */
export async function openReady(page, baseURL, query = '?debug') {
  await page.addInitScript(installCounters);
  await page.goto(new URL('index.html' + query, baseURL).href);
  await page.waitForFunction(() => window.__hansch?.stage?.points && document.querySelector('#stage-status').hidden, null, { timeout: 60_000 });
  await settled(page);
}

/** Wait until the layout tween is over and the render loop has gone quiet (no frame for 600 ms). */
export async function settled(page, quietMs = 600) {
  await page.waitForFunction(() => window.__hansch.anim.t >= 1 && window.gsap.globalTimeline.getChildren(false, true, true).every(k => k.paused()), null, { timeout: 30_000 });
  await quiet(page, quietMs);
}

/** Wait until the main loop's frame counter has not moved for `ms`. */
export async function quiet(page, ms = 600, timeout = 30_000) {
  await page.waitForFunction(([ms]) => {
    const w = window, now = performance.now(), f = w.__hansch.stats.frames;
    if (w.__q?.f !== f) { w.__q = { f, at: now }; return false; }
    return now - w.__q.at >= ms;
  }, [ms], { timeout, polling: 50 });
}

/** Wait until no rAF callback has run for `ms` (the loop AND gsap's ticker, which sleeps ~20 ticks after its last tween). */
export async function rafQuiet(page, ms = 1000, timeout = 30_000) {
  await page.waitForFunction(([ms]) => {
    const n = window.__raf, now = performance.now();
    if (window.__rq?.n !== n) { window.__rq = { n, at: now }; return false; }
    return now - window.__rq.at >= ms;
  }, [ms], { timeout, polling: 100 });
}

/** { raf, draws: {canvasId: n}, frames, mol: frames of the molecule loop } */
export const counts = page => page.evaluate(() => ({
  raf: window.__raf, draws: { ...window.__draws }, frames: window.__hansch.stats.frames, molFrames: window.__hansch.molv.loop?.stats.frames ?? 0,
}));

/**
 * Run `action`, then wait until `canvasId` has drawn more than before. Returns the number of animation frames that passed
 * after the action finished and before the draw (0 when the draw already happened during the action).
 */
export async function framesToDraw(page, canvasId, action, timeout = 15_000) {
  const before = await page.evaluate(id => window.__draws[id] || 0, canvasId);
  await action();
  return page.evaluate(([id, before, timeout]) => new Promise((resolve, reject) => {
    let frames = 0; const t0 = performance.now();
    const step = () => {
      if ((window.__draws[id] || 0) > before) return resolve(frames);
      if (performance.now() - t0 > timeout) return reject(new Error(`no draw on #${id} within ${timeout} ms`));
      frames++; requestAnimationFrame(step);
    };
    step();
  }), [canvasId, before, timeout]);
}

/** Hide everything drawn over the canvas so a screenshot of the stage shows only the WebGL canvas on the page background. */
export function hideOverlays(page) {
  return page.addStyleTag({ content: '.hud, #labels, .stage-tools, #tooltip, #stage-status, #fallback-2d { visibility: hidden !important; }' });
}

/** Share of the canvas area that is not the dominant (background) colour, from a screenshot of the canvas element. */
export async function canvasInk(page, selector = '#space') {
  const img = decodePng(await page.locator(selector).screenshot());
  return colourSpread(img).nonBackground;
}

/** Assert the stage canvas is not blank right now. */
export async function expectInk(page, selector = '#space', min = 0.01, message = 'canvas has content') {
  expect(await canvasInk(page, selector), message).toBeGreaterThan(min);
}

/** A page-side wait for `fn` (string-free helper to keep specs short). */
export const until = (page, fn, arg, timeout = 15_000) => page.waitForFunction(fn, arg, { timeout });

/** Fake "the tab is hidden / visible" (headless Chromium never hides a tab): overrides document.hidden and fires visibilitychange. */
export function setTabHidden(page, hidden) {
  return page.evaluate(h => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}
