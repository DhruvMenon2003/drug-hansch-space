// data.spec.mjs - data and performance plumbing (stage S2b): conformer shards, lazy SmilesDrawer, idle structure text, preload
// hints, load budgets, cache revalidation and the "newer version" banner.
//
// Software GL (SwiftShader) is slow and the box is shared: nothing here asserts a frame rate or a tight wall-clock time. Long
// tasks and sizes are measured and compared with limits that have a margin; the exact numbers are printed.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const SITE = new URL('../../site/', import.meta.url);
const read = rel => readFileSync(new URL(rel, SITE), 'utf8');
const golden = JSON.parse(readFileSync(new URL('../golden/original.json', import.meta.url), 'utf8'));
const DRUGS = JSON.parse(read('data/drugs.json')).drugs;
const SHARDS = 32;
const shardOf = cid => cid % SHARDS;
const shardFile = n => JSON.parse(read(`data/mol/${n}.json`));
const CONTEXT = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'no-preference' };
const nameToCid = n => DRUGS.find(d => d.name === n).cid;

/** Deterministic pseudo-random numbers (the seed is printed so a failure can be replayed). */
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

/** Open the page with ?debug, record requests (and gzip sizes of responses), console output and long tasks. */
async function open(browser, baseURL, { init, route, wait = true, query = '?debug' } = {}) {
  const ctx = await browser.newContext(CONTEXT);
  const page = await ctx.newPage();
  const net = { requests: [], responses: [], console: [], bodies: [] };
  page.on('console', m => net.console.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => net.console.push({ type: 'pageerror', text: e.message }));
  page.on('request', r => net.requests.push({ url: r.url(), type: r.resourceType(), headers: r.headers(), t: Date.now() }));
  page.on('response', res => {
    net.bodies.push(res.body().then(buf => {
      const ct = res.headers()['content-type'] || '';
      const compressible = /text|json|javascript|svg|xml/.test(ct);
      net.responses.push({ url: res.url(), status: res.status(), type: res.request().resourceType(), raw: buf.length, wire: compressible ? gzipSync(buf, { level: 6 }).length : buf.length });
    }).catch(() => {}));
  });
  await page.addInitScript(() => {
    window.__long = []; window.__cls = 0; window.__paint = {};
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch { /* no longtask support */ }
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { /* none */ }
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__paint[e.name] = e.startTime; }).observe({ type: 'paint', buffered: true }); } catch { /* none */ }
  });
  if (init) await init(page);
  if (route) await route(page);
  await page.goto(new URL('index.html' + query, baseURL).href);
  if (wait) await ready(page);
  return { ctx, page, net };
}
const ready = page => page.waitForFunction(() => window.__hansch?.stage?.points && document.querySelector('#stage-status')?.hidden === true, null, { timeout: 90_000 });
const pick = (page, cid) => page.evaluate(c => window.__hansch.selectDrug(c), cid);
/** Wait for the selection's conformer status line to leave "Loading" and the 2D depiction to settle. */
const settleDetail = async page => {
  await page.waitForFunction(() => !/Loading conformer/.test(document.querySelector('#d-src').textContent), null, { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('#d-2d[data-state="pending"]'), null, { timeout: 30_000 });
};
const urls = (net, re) => net.requests.map(r => r.url).filter(u => re.test(u));
const kb = n => (n / 1024).toFixed(1);

test.describe('conformer shards', () => {
  test.setTimeout(240_000);

  test('10 random drugs: each fetches only its shard, and the viewer shows exactly the atoms of that shard entry', async ({ browser, baseURL }) => {
    const seed = Number(process.env.SEED || 20261010), rand = rng(seed);
    const withConf = DRUGS.filter(d => d.conf);
    const picks = new Set();
    while (picks.size < 10) picks.add(withConf[Math.floor(rand() * withConf.length)]);
    console.log(`random drugs (SEED=${seed}):`, [...picks].map(d => `${d.name}:${d.cid}->${shardOf(d.cid)}`).join(' '));
    const { ctx, page, net } = await open(browser, baseURL);
    const seen = new Set();
    for (const d of picks) {
      const before = urls(net, /\/data\/mol\//).length;
      await pick(page, d.cid);
      await page.waitForFunction(c => window.__hansch.molv.group && window.__hansch.app.drugs[window.__hansch.app.selected].cid === c && !/Loading/.test(document.querySelector('#d-src').textContent), d.cid, { timeout: 30_000 });
      const want = shardFile(shardOf(d.cid))[String(d.cid)];
      expect(want, `${d.name} is in shard ${shardOf(d.cid)}`).toBeTruthy();
      const got = await page.evaluate(() => ({ src: document.querySelector('#d-src').textContent, atoms: window.__hansch.molv.group.children[0].count, bonds: window.__hansch.molv.group.children[1].count }));
      expect(got.src, `${d.name}: source text`).toBe(want.src);
      expect(got.atoms, `${d.name}: atoms drawn (hydrogens shown)`).toBe(want.z.length);
      // bonds: one stick per bond order slot, two halves each (the viewer's own rule), so just require some for a molecule with bonds
      expect(got.bonds > 0, `${d.name}: bonds drawn`).toBe(want.b.length > 0);
      const fetched = urls(net, /\/data\/mol\//).slice(before);
      if (seen.has(shardOf(d.cid))) expect(fetched, `${d.name}: shard ${shardOf(d.cid)} is cached`).toEqual([]);
      else expect(fetched.map(u => new URL(u).pathname), `${d.name}: only its shard is fetched`).toEqual([`/data/mol/${shardOf(d.cid)}.json`]);
      seen.add(shardOf(d.cid));
    }
    expect(urls(net, /molecules\.json/), 'the full conformer table is never requested').toEqual([]);
    expect(net.console.filter(m => ['error', 'warning', 'pageerror'].includes(m.type)), 'no console noise').toEqual([]);
    await ctx.close();
  });

  test('a drug without a conformer costs no request and says so', async ({ browser, baseURL }) => {
    const none = DRUGS.find(d => !d.conf);
    const { ctx, page, net } = await open(browser, baseURL);
    await pick(page, none.cid);
    await settleDetail(page);
    await expect(page.locator('#d-src')).toHaveText(/^No 3D conformer \(PubChem has none/);
    expect(urls(net, /\/data\/mol\//)).toEqual([]);
    await ctx.close();
  });

  test('failure shows the usual message and a Retry button; a rejected fetch is never cached', async ({ browser, baseURL }) => {
    const target = DRUGS.find(d => d.conf && d.name === 'dexamethasone');
    const modes = ['503', 'abort', 'not-json'];
    for (const mode of modes) {
      const { ctx, page } = await open(browser, baseURL);
      let calls = 0;
      const file = `**/data/mol/${shardOf(target.cid)}.json`;
      await page.route(file, route => {
        if (++calls > 1) return route.continue();
        if (mode === '503') return route.fulfill({ status: 503, body: 'down' });
        if (mode === 'abort') return route.abort('failed');
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"truncated":' });
      });
      await pick(page, target.cid);
      await expect(page.locator('#d-src'), mode).toHaveText('Could not load the conformer file.');
      const retry = page.locator('#d-retry');
      await expect(retry, `${mode}: Retry button`).toBeVisible();
      const box = await retry.boundingBox();
      expect(box.width >= 44 && box.height >= 44, `${mode}: Retry is a 44 px target (${box.width}x${box.height})`).toBe(true);
      expect(await page.evaluate(() => document.querySelector('#sr-live').textContent === '' || /conformer/i.test(document.querySelector('#sr-live').textContent))).toBe(true);
      await retry.click();
      await page.waitForFunction(() => window.__hansch.molv.group && /^(PubChem|RDKit)/.test(document.querySelector('#d-src').textContent), null, { timeout: 30_000 });
      expect(calls, `${mode}: the retry fetched the shard again`).toBe(2);
      await expect(retry, `${mode}: the Retry button is gone after success`).toBeHidden();
      // a later selection in the same shard is served from the cache: still two requests
      const same = DRUGS.find(d => d.conf && d.cid !== target.cid && shardOf(d.cid) === shardOf(target.cid));
      if (same) { await pick(page, same.cid); await settleDetail(page); expect(calls, `${mode}: loaded shard is cached`).toBe(2); }
      await ctx.close();
    }
  });

  test('a failure on one selection does not poison the next one in the same shard', async ({ browser, baseURL }) => {
    const sh = shardOf(DRUGS.find(d => d.conf && d.name === 'dexamethasone').cid);
    const [a, b] = DRUGS.filter(d => d.conf && shardOf(d.cid) === sh).slice(0, 2);
    const { ctx, page } = await open(browser, baseURL);
    let calls = 0;
    await page.route(`**/data/mol/${sh}.json`, route => (++calls === 1 ? route.fulfill({ status: 500, body: 'x' }) : route.continue()));
    await pick(page, a.cid);
    await expect(page.locator('#d-src')).toHaveText('Could not load the conformer file.');
    await pick(page, b.cid);                                         // no Retry click: just choose another drug of the same shard
    await page.waitForFunction(() => window.__hansch.molv.group && /^(PubChem|RDKit)/.test(document.querySelector('#d-src').textContent), null, { timeout: 30_000 });
    expect(calls).toBe(2);
    await ctx.close();
  });

  test('the first pick downloads at most 40 KB (gzip) of data, in one request', async ({ browser, baseURL }) => {
    const { ctx, page, net } = await open(browser, baseURL);
    await Promise.all(net.bodies);
    const n0 = net.responses.length;
    await pick(page, nameToCid('dexamethasone'));
    await settleDetail(page);
    await Promise.all(net.bodies);
    const after = net.responses.slice(n0);
    const data = after.filter(r => /\/data\//.test(r.url));
    const dataKb = data.reduce((s, r) => s + r.wire, 0) / 1024;
    console.log(`first pick: ${data.map(r => `${new URL(r.url).pathname} ${kb(r.wire)} KB gz`).join(', ')}; also ${after.filter(r => !/\/data\//.test(r.url)).map(r => `${new URL(r.url).pathname} ${kb(r.wire)} KB`).join(', ')}`);
    expect(data.length, 'one data request').toBe(1);
    expect(dataKb, `${dataKb.toFixed(1)} KB gzip of data`).toBeLessThanOrEqual(40);
    await ctx.close();
  });

  test('every shard is under 40 KB gzip and the shards hold exactly the drugs that have a conformer', async () => {
    const seen = new Set();
    let biggest = 0;
    for (let n = 0; n < SHARDS; n++) {
      const text = read(`data/mol/${n}.json`);
      biggest = Math.max(biggest, gzipSync(text, { level: 6 }).length);
      for (const k of Object.keys(JSON.parse(text))) { expect(shardOf(+k)).toBe(n); seen.add(+k); }
    }
    expect(biggest / 1024, `largest shard ${kb(biggest)} KB gzip`).toBeLessThanOrEqual(40);
    expect(seen).toEqual(new Set(DRUGS.filter(d => d.conf).map(d => d.cid)));
  });
});

test.describe('SmilesDrawer is loaded on the first pick', () => {
  test.setTimeout(240_000);

  test('absent at load (no request, no global), present after the first pick, loaded once, and the depiction is drawn', async ({ browser, baseURL }) => {
    const { ctx, page, net } = await open(browser, baseURL);
    expect(await page.evaluate(() => typeof window.SmilesDrawer)).toBe('undefined');
    expect(urls(net, /smiles-drawer/), 'not requested while the page loads').toEqual([]);
    expect(await page.locator('script[src*="smiles-drawer"]').count()).toBe(0);
    await pick(page, nameToCid('dexamethasone'));
    await page.waitForFunction(() => document.querySelector('#d-2d[data-state="done"] svg'), null, { timeout: 30_000 });
    expect(await page.evaluate(() => typeof window.SmilesDrawer)).toBe('object');
    expect(urls(net, /smiles-drawer/).length).toBe(1);
    await pick(page, nameToCid('caffeine'));
    await page.waitForFunction(() => document.querySelector('#d-2d[data-state="done"] svg')?.getAttribute('aria-label') === '2D structure of caffeine', null, { timeout: 30_000 });
    expect(urls(net, /smiles-drawer/).length, 'loaded once').toBe(1);
    expect(net.console.filter(m => ['error', 'warning', 'pageerror'].includes(m.type))).toEqual([]);
    await ctx.close();
  });

  test('the depiction waits for the 3D conformer (and draws without one)', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, { init: p => p.addInitScript(() => { window.__order = []; }) });
    await page.evaluate(() => {
      const { bus } = window.__hansch;
      bus.on('conformer:shown', () => window.__order.push('conformer'));
      new MutationObserver(() => { if (document.querySelector('#d-2d[data-state="done"]') && !window.__order.includes('2d')) window.__order.push('2d'); })
        .observe(document.querySelector('#d-2d'), { attributes: true, childList: true });
    });
    await pick(page, nameToCid('dexamethasone'));
    await page.waitForFunction(() => window.__order.includes('2d'), null, { timeout: 30_000 });
    expect(await page.evaluate(() => window.__order)).toEqual(['conformer', '2d']);
    await page.evaluate(() => { window.__order.length = 0; });
    await pick(page, DRUGS.find(d => !d.conf && d.smiles && d.d.heavy < 60).cid);          // no conformer: the event still comes, the drawing follows
    await page.waitForFunction(() => window.__order.includes('2d'), null, { timeout: 30_000 });
    expect(await page.evaluate(() => window.__order)).toEqual(['conformer', '2d']);
    await ctx.close();
  });

  test('a library that does not load: the panel says so, nothing throws, and a pick storm does not become a request storm', async ({ browser, baseURL }) => {
    const { ctx, page, net } = await open(browser, baseURL, { route: p => p.route('**/vendor/smiles-drawer/**', r => r.abort('failed')) });
    for (const n of ['dexamethasone', 'caffeine', 'aspirin', 'ibuprofen', 'warfarin']) {
      const d = DRUGS.find(x => x.name === n);
      if (d) await pick(page, d.cid);
    }
    await page.waitForFunction(() => document.querySelector('#d-2d[data-state="unavailable"]'), null, { timeout: 30_000 });
    await expect(page.locator('#d-2d')).toContainText(/structure drawing not available/i);
    expect(urls(net, /smiles-drawer/).length, 'one failed request, not one per pick').toBe(1);
    const errors = net.console.filter(m => ['error', 'pageerror'].includes(m.type));
    expect(errors.length, `console errors: ${JSON.stringify(errors)}`).toBeLessThanOrEqual(1);          // the browser's own line for the failed load
    expect(errors.every(m => /Failed to load resource|ERR_FAILED/.test(m.text)), 'only the network message').toBe(true);
    // the rest of the panel still works
    await expect(page.locator('#d-name')).toBeVisible();
    await ctx.close();
  });

  test('a large molecule is not drawn by itself: no long task, a Draw anyway button, and the drawing on request', async ({ browser, baseURL }) => {
    const big = DRUGS.find(d => d.name === 'dalbavancin');
    expect(big.d.heavy, 'dalbavancin is above the automatic limit').toBeGreaterThan(110);
    const { ctx, page } = await open(browser, baseURL);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__long.length = 0; });
    await pick(page, big.cid);
    await settleDetail(page);
    await page.waitForTimeout(1200);
    const long = await page.evaluate(() => window.__long);
    const worst = Math.max(0, ...long.map(l => l[1]));
    console.log(`dalbavancin (${big.d.heavy} heavy atoms): long tasks after the pick ${JSON.stringify(long)}`);
    expect(await page.locator('#d-2d').getAttribute('data-state')).toBe('large');
    expect(await page.locator('#d-2d svg').count()).toBe(0);
    expect(worst, `longest task ${worst} ms`).toBeLessThan(150);
    const btn = page.getByRole('button', { name: 'Draw anyway' });
    const box = await btn.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    await btn.click();
    await page.waitForFunction(() => document.querySelector('#d-2d[data-state="done"] svg'), null, { timeout: 60_000 });
    await ctx.close();
  });

  test('a mid-sized molecule (within the limit) draws in one short task', async ({ browser, baseURL }) => {
    const mid = DRUGS.filter(d => d.d.heavy > 80 && d.d.heavy <= 110).sort((a, b) => b.d.heavy - a.d.heavy)[0];
    const { ctx, page } = await open(browser, baseURL);
    await page.waitForTimeout(1500);
    await pick(page, nameToCid('caffeine'));                                  // loads the library and draws a small one first
    await settleDetail(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__long.length = 0; });
    await pick(page, mid.cid);
    await settleDetail(page);
    await page.waitForTimeout(800);
    const long = await page.evaluate(() => window.__long);
    console.log(`${mid.name} (${mid.d.heavy} heavy atoms) drawn; long tasks ${JSON.stringify(long)}`);
    expect(await page.locator('#d-2d').getAttribute('data-state')).toBe('done');
    expect(Math.max(0, ...long.map(l => l[1])), 'longest task').toBeLessThan(200);
    await ctx.close();
  });
});

test.describe('structure-map text and the first seconds', () => {
  test.setTimeout(240_000);

  test('the step-2 sentence is computed after the first paint, from idle time, and equals the original', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL, {
      wait: false,
      init: p => p.addInitScript(() => {
        window.__tsAt = null;
        const watch = () => {
          const el = document.querySelector('#t-ts');
          if (!el) return requestAnimationFrame(watch);
          new MutationObserver(() => { if (el.textContent && window.__tsAt === null) window.__tsAt = performance.now(); }).observe(el, { childList: true, characterData: true, subtree: true });
        };
        watch();
      }),
    });
    await page.waitForFunction(() => window.__tsAt !== null, null, { timeout: 60_000 });
    const t = await page.evaluate(() => ({ at: window.__tsAt, fcp: window.__paint['first-contentful-paint'] }));
    expect(t.fcp, 'first contentful paint happened').toBeGreaterThan(0);
    expect(t.at, 'the sentence was filled after the first paint').toBeGreaterThan(t.fcp);
    await expect(page.locator('#t-ts')).toHaveText(golden.boot.tour[1]);
    await ctx.close();
  });

  test('no task longer than 250 ms in the first 3 seconds (software GL; the budget on a real GPU is 100 ms)', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL);
    await page.waitForFunction(() => performance.now() > 3200);
    const long = await page.evaluate(() => window.__long.filter(l => l[0] < 3000));
    const worst = Math.max(0, ...long.map(l => l[1]));
    console.log(`long tasks in the first 3 s: ${JSON.stringify(long)}`);
    expect(worst, `longest task ${worst} ms: ${JSON.stringify(long)}`).toBeLessThan(250);
    await ctx.close();
  });
});

test.describe('preload hints and the load budget', () => {
  test.setTimeout(240_000);

  test('the head preloads exactly the modules the page runs, the two data files and the two fonts; nothing third-party; nothing wasted', async ({ browser, baseURL }) => {
    const { ctx, page, net } = await open(browser, baseURL);
    await page.waitForTimeout(5500);                       // Chrome warns about an unused preload about 3 s after load
    const hints = await page.evaluate(() => [...document.querySelectorAll('head link')].filter(l => /preload|prefetch|preconnect/.test(l.rel)).map(l => ({ rel: l.rel, href: l.href, as: l.getAttribute('as'), cross: l.getAttribute('crossorigin'), prio: l.getAttribute('fetchpriority') })));
    const origin = new URL(baseURL).origin;
    const mods = hints.filter(h => h.rel === 'modulepreload').map(h => h.href);
    const scripts = [...new Set(net.requests.filter(r => r.type === 'script' && !/vendor\/gsap\//.test(r.url)).map(r => r.url))];
    expect(new Set(mods).size, 'no duplicate hints').toBe(mods.length);
    expect(new Set(mods)).toEqual(new Set(scripts));
    const data = hints.filter(h => h.rel === 'preload' && h.as === 'fetch');
    expect(data.map(h => new URL(h.href).pathname).sort()).toEqual(['/data/drugs.json', '/data/hansch.json']);
    for (const h of data) { expect(h.cross, `${h.href}: crossorigin`).not.toBeNull(); expect(h.prio).toBe('low'); }
    const fonts = hints.filter(h => h.rel === 'preload' && h.as === 'font');
    expect(fonts.length).toBe(2);
    for (const h of fonts) expect(h.cross).not.toBeNull();
    expect(hints.every(h => h.href.startsWith(origin + '/')), 'no hint leaves the origin').toBe(true);
    expect(hints.filter(h => /preconnect|prefetch/.test(h.rel))).toEqual([]);
    // each URL once: the app's own fetch of the data files uses the preloaded response (a second request would double the bytes)
    const count = u => net.requests.filter(r => new URL(r.url).pathname === u).length;
    expect(count('/data/drugs.json'), 'drugs.json requested once').toBe(1);
    expect(count('/data/hansch.json'), 'hansch.json requested once').toBe(1);
    const dup = Object.entries(net.requests.reduce((m, r) => ((m[r.url] = (m[r.url] || 0) + 1), m), {})).filter(([, n]) => n > 1);
    expect(dup, 'no URL is requested twice').toEqual([]);
    expect(net.console.filter(m => /preload/i.test(m.text)), 'no "preloaded but not used" warning').toEqual([]);
    expect(net.console.filter(m => ['error', 'warning', 'pageerror'].includes(m.type))).toEqual([]);
    await ctx.close();
  });

  test('first load: at most 45 requests, one origin, <= 450 KB gzip without fonts, layout shift under 0.02', async ({ browser, baseURL }) => {
    const { ctx, page, net } = await open(browser, baseURL);
    await page.waitForTimeout(1500);
    await Promise.all(net.bodies);
    const origin = new URL(baseURL).origin;
    const reqs = net.requests.filter(r => !/^(data|blob):/.test(r.url));
    const nonFont = net.responses.filter(r => r.type !== 'font'), fonts = net.responses.filter(r => r.type === 'font');
    const nonFontKb = nonFont.reduce((s, r) => s + r.wire, 0) / 1024, fontKb = fonts.reduce((s, r) => s + r.wire, 0) / 1024;
    const cls = await page.evaluate(() => window.__cls);
    console.log(`first load: ${reqs.length} requests; ${nonFontKb.toFixed(0)} KB gzip without fonts + ${fontKb.toFixed(0)} KB fonts = ${(nonFontKb + fontKb).toFixed(0)} KB; CLS ${cls.toFixed(4)}`);
    console.log('  largest: ' + [...net.responses].sort((a, b) => b.wire - a.wire).slice(0, 6).map(r => `${new URL(r.url).pathname} ${kb(r.wire)}`).join(', '));
    test.info().annotations.push({ type: 'first-load', description: `${reqs.length} requests, ${nonFontKb.toFixed(0)} KB without fonts, ${fontKb.toFixed(0)} KB fonts, CLS ${cls.toFixed(4)}` });
    expect(reqs.length, 'requests').toBeLessThanOrEqual(45);
    expect([...new Set(reqs.map(r => new URL(r.url).origin))], 'third-party origins').toEqual([origin]);
    expect(nonFontKb, 'KB gzip without fonts').toBeLessThanOrEqual(450);
    // The aim is 450 KB INCLUDING fonts. The five vendored woff2 files are ~300 KB and are already compressed; reaching the aim needs
    // font subsetting, which SPEC-B B1.4 rules out. This ceiling keeps the current state from growing.
    expect(nonFontKb + fontKb, 'KB gzip including fonts (ceiling; aim 450)').toBeLessThanOrEqual(740);
    expect(cls, 'cumulative layout shift').toBeLessThan(0.02);
    await ctx.close();
  });

  test('the data files are revalidated, not trusted for the ten minutes GitHub Pages allows (cache: no-cache)', async ({ browser, baseURL }) => {
    const { ctx, page, net } = await open(browser, baseURL);
    const n0 = net.requests.length;
    // a shard that the page has not fetched yet, and a second loadData(): both are fresh requests made by the app's own code
    await page.evaluate(async () => {
      const m = await import('/js/data.js');
      await m.loadData();
      await m.loadMolecule(m.MOL_SHARDS * 1000 + 7).catch(() => {});       // a CID no drug has: only the request matters
    });
    const fresh = net.requests.slice(n0).filter(r => /\/data\//.test(r.url));
    expect(fresh.map(r => new URL(r.url).pathname).sort()).toEqual(['/data/drugs.json', '/data/hansch.json'].sort());
    for (const r of fresh) expect(r.headers['cache-control'] || r.headers.pragma || '', r.url).toMatch(/max-age=0|no-cache/);
    // and the shard request carries it too (use a real drug with a conformer whose shard is not loaded yet)
    const n1 = net.requests.length;
    await pick(page, nameToCid('dexamethasone'));
    await settleDetail(page);
    const shard = net.requests.slice(n1).find(r => /\/data\/mol\//.test(r.url));
    expect(shard, 'a shard request was made').toBeTruthy();
    expect(shard.headers['cache-control'] || '', shard.url).toMatch(/max-age=0|no-cache/);
    await ctx.close();
  });
});

test.describe('"a newer version is available" banner', () => {
  test.setTimeout(240_000);
  const withBuilds = (codeBuild, dataBuild) => async page => {
    if (codeBuild) await page.route('**/js/version.js*', async route => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: (await res.text()).replace("APP_BUILD = 'dev'", `APP_BUILD = '${codeBuild}'`) });
    });
    await page.route('**/data/drugs.json*', async route => {
      const res = await route.fetch();
      const json = await res.json();
      if (dataBuild === null) delete json.meta.app_build; else json.meta.app_build = dataBuild;
      await route.fulfill({ response: res, body: JSON.stringify(json) });
    });
  };

  test('code build and data build differ: banner, Reload button, polite announcement; the page keeps working', async ({ browser, baseURL }) => {
    const { ctx, page, net } = await open(browser, baseURL, { route: withBuilds('abc123def456', 'zzz999zzz999') });
    const banner = page.locator('#version-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('A newer version of this page is available');
    const btn = banner.getByRole('button', { name: 'Reload' });
    const box = await btn.boundingBox();
    expect(box.width >= 44 && box.height >= 44).toBe(true);
    await expect(page.locator('#sr-live')).toContainText(/newer version/i, { timeout: 5000 });
    expect(await page.evaluate(() => document.querySelector('#sr-live').getAttribute('aria-live'))).toBe('polite');
    // not blocking: the 3D scene is up and a drug can be picked
    await pick(page, nameToCid('caffeine'));
    await expect(page.locator('#d-name')).toHaveText('caffeine');
    expect(net.console.filter(m => ['error', 'pageerror'].includes(m.type))).toEqual([]);
    const nav = page.waitForNavigation({ timeout: 30_000 });
    await btn.click();
    await nav;
    await ctx.close();
  });

  for (const [label, code, data] of [
    ['same build', 'abc123def456', 'abc123def456'],
    ['dev build against stamped data', null, 'zzz999zzz999'],
    ['stamped code, data without a build id', 'abc123def456', null],
  ]) {
    test(`no banner: ${label}`, async ({ browser, baseURL }) => {
      const { ctx, page } = await open(browser, baseURL, { route: withBuilds(code, data) });
      await expect(page.locator('#version-banner')).toBeHidden();
      expect(await page.locator('#version-banner').getAttribute('hidden')).not.toBeNull();
      await ctx.close();
    });
  }

  test('the shipped page is unstamped (dev) and the banner is hidden by default in the HTML', async () => {
    expect(read('js/version.js')).toMatch(/export const APP_BUILD = 'dev';/);
    expect(read('index.html')).toMatch(/<div id="version-banner"[^>]*\bhidden\b/);
    expect(JSON.parse(read('data/drugs.json')).meta.app_build).toBeUndefined();
  });
});
