// shell.spec.mjs - the page shell: DOM contract (ids and attributes that the runtime and later stages rely on), head metadata,
// [hidden] semantics, no-JS rendering, skip links, axe (serious and critical = 0, light and dark, default state and after
// selecting a drug), 44 px targets at 1280x800 and at 390x844 touch, token contrast, Content-Security-Policy (zero violations,
// and the policy really is enforced), footer attribution, wording, links, licence files and layout shift (CLS).
//
// Some checks read the SOURCE of index.html (what the shell ships, e.g. which hooks start `hidden`) and some read the live DOM
// (what a browser makes of it). Later stages legitimately unhide hooks, so the "starts hidden" checks are static on purpose.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

const SITE = new URL('../../site/', import.meta.url);
const ROOT = new URL('../../', import.meta.url);
const read = (rel, base = SITE) => readFileSync(new URL(rel, base), 'utf8');
const CANONICAL = 'https://dhruvmenon2003.github.io/drug-hansch-space/';
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'no-preference' };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'light', reducedMotion: 'no-preference' };

// ------------------------------------------------------------------------------------------------ helpers
/** Open the site with watchers: console problems, CSP violations, request origins. `url` is relative to the site root. */
async function openSite(browser, baseURL, { context = DESKTOP, url = 'index.html', ready = true, init } = {}) {
  const ctx = await browser.newContext(context);
  const page = await ctx.newPage();
  const watch = { problems: [], origins: new Set(), urls: [] };
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) watch.problems.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => watch.problems.push(`[pageerror] ${e.message}`));
  page.on('request', r => { const u = new URL(r.url()); if (!['data:', 'blob:'].includes(u.protocol)) { watch.origins.add(u.origin); watch.urls.push(r.url()); } });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile || ''}:${e.lineNumber || ''}`));
    window.__cls = 0;
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { /* not supported */ }
  });
  if (init) await init(page);
  await page.goto(new URL(url, baseURL).href);
  if (ready) await waitReady(page);
  return { ctx, page, watch, origin: new URL(baseURL).origin };
}
/** The loading line is hidden at the end of boot (data in, scene built, first frame drawn). */
const waitReady = page => page.waitForFunction(() => document.querySelector('#stage-status')?.hidden === true, null, { timeout: 90_000 });
/** Pick a drug through the search box (no debug hook needed) and wait for its panel. */
async function pickDrug(page, name = 'dexamethasone') {
  await page.fill('#search', name);
  await page.press('#search', 'Enter');
  await expect(page.locator('#d-name')).toHaveText(name);
  await page.waitForFunction(() => !/Loading/.test(document.querySelector('#d-src').textContent), null, { timeout: 30_000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
/** DOMParser view of the shipped source: scripting is off in such a document, so <noscript> content is parsed as elements. */
async function sourceDom(browser) {
  const html = read('index.html');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('about:blank');
  const doc = await page.evaluateHandle(h => new DOMParser().parseFromString(h, 'text/html'), html);
  return { html, doc, close: () => ctx.close() };
}
const sha256b64 = s => createHash('sha256').update(s).digest('base64');
const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c.trim()); if (!m) throw new Error(`not a #rrggbb colour: ${c}`); return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)); };
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = rgb => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
/** WCAG contrast ratio of two colours given as [r,g,b] 0-255 arrays or #rrggbb strings. */
const contrast = (a, b) => { const [x, y] = [a, b].map(c => lum(typeof c === 'string' ? hex(c) : c)).sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const parseRgb = s => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) throw new Error(`not an rgb() colour: ${s}`); return m[1].split(/[ ,/]+/).slice(0, 3).map(Number); };
/** Width and height from a PNG's IHDR chunk. */
const pngSize = buf => { if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG'); return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; };

// ------------------------------------------------------------------------------------------------ DOM contract
test.describe('shell: DOM contract (SPEC-C C3)', () => {
  test('hooks exist in the source with the exact ids and attributes', async ({ browser }) => {
    const { doc, close } = await sourceDom(browser);
    const r = await doc.evaluate(d => {
      const $ = s => d.querySelector(s), attrs = el => (el ? Object.fromEntries([...el.attributes].map(a => [a.name, a.value])) : null);
      const skip = [...d.querySelectorAll('body > :first-child a.skip-link')].map(a => [a.getAttribute('href'), a.textContent.trim()]);
      return {
        firstChildIsSkipBlock: d.body.firstElementChild?.querySelectorAll('a.skip-link').length === 4,
        skip,
        noscriptIsBodyChild: !!$('body > noscript'), noscriptLinks: [...d.querySelectorAll('body > noscript a')].map(a => a.getAttribute('href')),
        noscriptStyle: $('head noscript style')?.textContent.replace(/\s+/g, ''),
        srLive: attrs($('#sr-live')), kbdHelp: { tag: $('#kbd-help')?.tagName, cls: $('#kbd-help')?.className, text: $('#kbd-help')?.textContent },
        space: attrs($('#space')), spaceTag: $('#space')?.tagName,
        tools: [...d.querySelectorAll('.stage-tools > button')].map(b => ({ id: b.id, ...attrs(b), text: b.textContent.trim() })),
        xr: attrs($('#xr-overlay')), xrAfterStage: !!$('#stage') && !!$('#xr-overlay'),
        status: attrs($('#stage-status')), progress: attrs($('#stage-status progress#load-progress')),
        fallback: attrs($('#fallback-2d')), fallbackTable: attrs($('#fallback-2d button#fallback-table')), fallbackTableText: $('#fallback-table')?.textContent.trim(),
        fatal: attrs($('#fatal')), fatalReload: attrs($('#fatal button#fatal-reload')), fatalLinks: [...d.querySelectorAll('#fatal a')].map(a => a.getAttribute('href')),
        tooltip: attrs($('#tooltip')), detail: attrs($('#detail')), count: attrs($('#count')),
        rail: attrs($('main#rail')), explore: attrs($('#explore')), tableDetails: attrs($('#table-details')),
        footer: attrs($('footer#sources')), liveRegions: [...d.querySelectorAll('[aria-live], [role="status"], [role="alert"]')].map(e => e.id || e.tagName),
        sourceOrder: [...d.querySelectorAll('.stage-tools > button')].map(b => b.id),
      };
    });
    await close();
    expect(r.firstChildIsSkipBlock, 'the skip links are the first element of <body>').toBe(true);
    expect(r.skip).toEqual([['#explore', 'Skip to controls'], ['#space-skip', 'Skip to the 3D plot'], ['#table-details', 'Skip to the data table'], ['#rail', 'Skip to the tour text']]);
    expect(r.noscriptIsBodyChild).toBe(true);
    expect(r.noscriptLinks).toEqual(expect.arrayContaining(['data/drugs.json', '#sources']));
    expect(r.noscriptStyle).toContain('.step{opacity:1');
    expect(r.noscriptStyle).toContain('.stage{display:none}');
    expect(r.noscriptStyle).toContain('.skip-link{display:none}');
    expect(r.srLive).toEqual({ id: 'sr-live', class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    expect(r.kbdHelp.tag).toBe('P');
    expect(r.kbdHelp.cls).toBe('sr-only');
    for (const w of ['arrow', 'Enter', 'Escape', 'D']) expect(r.kbdHelp.text).toContain(w);
    expect(r.spaceTag).toBe('CANVAS');
    expect(r.space).toMatchObject({ tabindex: '0', role: 'application', 'aria-roledescription': '3D scatter plot', 'aria-describedby': 'kbd-help', 'aria-keyshortcuts': 'ArrowLeft ArrowRight ArrowUp ArrowDown Enter Escape' });
    expect(r.space['aria-label'].length).toBeGreaterThan(30);
    expect(r.sourceOrder).toEqual(['btn-reset', 'btn-spin', 'btn-expand', 'btn-copy', 'btn-png', 'btn-csv', 'btn-vr', 'btn-ar']);
    const labels = { 'btn-expand': 'Expand', 'btn-copy': 'Copy link', 'btn-png': 'Save image', 'btn-csv': 'Download CSV', 'btn-vr': 'Enter VR', 'btn-ar': 'View in AR' };
    for (const b of r.tools) {
      expect(b.type, `${b.id} type`).toBe('button');
      expect(b.class, `${b.id} class`).toContain('ghost');
      if (b.id in labels) {
        expect(b, `${b.id} starts hidden`).toHaveProperty('hidden');
        expect(b['aria-label'], `${b.id} accessible name contains its visible text`).toContain(labels[b.id]);
        expect(b['aria-label'].toLowerCase()).toContain(b.text.toLowerCase().split(' ')[0]);
      }
    }
    expect(r.xr).toMatchObject({ id: 'xr-overlay' });
    expect(r.xr).toHaveProperty('hidden');
    expect(r.xrAfterStage).toBe(true);
    expect(r.status).toMatchObject({ role: 'status' });
    expect(r.progress).toMatchObject({ max: '4', value: '0', 'aria-label': 'Loading data and 3D scene' });
    expect(r.fallback).toHaveProperty('hidden');
    expect(r.fallbackTable).toMatchObject({ type: 'button' });
    expect(r.fallbackTableText).toBe('Open the data table');
    expect(r.fatal).toMatchObject({ role: 'alert' });
    expect(r.fatal).toHaveProperty('hidden');
    expect(r.fatalReload).toMatchObject({ type: 'button' });
    expect(r.fatalLinks).toContain('data/drugs.json');
    expect(r.tooltip, 'tooltip is hidden from assistive tech, not a live region').toMatchObject({ 'aria-hidden': 'true' });
    expect(r.tooltip).not.toHaveProperty('role');
    expect(r.detail, '#detail is not a live region').not.toHaveProperty('aria-live');
    expect(r.count, '#count is not a live region (#sr-live is the only one)').not.toHaveProperty('aria-live');
    expect(r.rail).toMatchObject({ tabindex: '-1' });
    expect(r.explore).toMatchObject({ tabindex: '-1' });
    expect(r.tableDetails).toMatchObject({ tabindex: '-1' });
    expect(r.footer).toMatchObject({ id: 'sources' });
    expect(r.liveRegions.sort(), 'live regions: #sr-live, the loading status and the fatal alert, nothing else').toEqual(['fatal', 'sr-live', 'stage-status']);
  });

  test('the live page keeps the hooks reachable and the checkbox labels explicit', async ({ browser, baseURL }) => {
    const { ctx, page, watch } = await openSite(browser, baseURL);
    for (const id of ['sr-live', 'kbd-help', 'space', 'btn-reset', 'btn-spin', 'btn-expand', 'btn-copy', 'btn-png', 'btn-csv', 'btn-vr', 'btn-ar', 'xr-overlay', 'fallback-2d', 'fallback-table', 'fatal', 'fatal-reload', 'load-progress', 'tooltip', 'rail', 'sources']) {
      expect(await page.locator('#' + id).count(), `#${id} exists`).toBe(1);
    }
    // every form control has a visible label (design_audit flagged #f-small and #show-h)
    for (const id of ['f-small', 'show-h', 'search', 'ax-x', 'ax-y', 'ax-z', 'color-by', 'f-l1', 'f-l2', 'f-l3', 'f-route', 'h-group']) {
      expect(await page.locator(`label[for="${id}"], label:has(#${id})`).count(), `label for #${id}`).toBeGreaterThan(0);
    }
    // one h1, headings never skip a level in document order
    const levels = await page.$$eval('h1,h2,h3,h4', hs => hs.map(h => +h.tagName[1]));
    expect(levels.filter(l => l === 1)).toHaveLength(1);
    expect(watch.problems).toEqual([]);
    await ctx.close();
  });
});

// ------------------------------------------------------------------------------------------------ [hidden]
test.describe('shell: [hidden] always wins (D26)', () => {
  test('#atc-pick-wrap disappears when the colour is not ATC; hidden buttons stay hidden', async ({ browser, baseURL }) => {
    const { ctx, page } = await openSite(browser, baseURL);
    const display = sel => page.$eval(sel, el => getComputedStyle(el).display);
    await page.selectOption('#color-by', 'atc');
    await expect.poll(() => page.$eval('#atc-pick-wrap', el => el.hidden)).toBe(false);
    expect(await display('#atc-pick-wrap')).toBe('flex');
    await page.selectOption('#color-by', 'single');
    await expect.poll(() => page.$eval('#atc-pick-wrap', el => el.hidden)).toBe(true);
    expect(await display('#atc-pick-wrap'), 'the hidden attribute beats .field { display: flex }').toBe('none');
    expect(await page.locator('#atc-pick-wrap').isVisible()).toBe(false);
    for (const id of ['btn-expand', 'btn-copy', 'btn-png', 'btn-csv', 'btn-vr', 'btn-ar', 'fallback-2d', 'fatal', 'xr-overlay']) {
      if (await page.$eval('#' + id, el => el.hasAttribute('hidden'))) expect(await display('#' + id), `#${id}[hidden]`).toBe('none');
    }
    // the rule is global: it also beats an author display on a made-up element
    const made = await page.evaluate(() => { const d = document.createElement('div'); d.className = 'field panel stage-card'; d.hidden = true; document.body.appendChild(d); return getComputedStyle(d).display; });
    expect(made).toBe('none');
    await ctx.close();
  });
});

test.describe('shell: fallback and fatal cards (revealed by the runtime when something is missing)', () => {
  for (const [name, context] of [['1280x800', DESKTOP], ['390x844 touch', PHONE]]) {
    test(`#fallback-2d and #fatal sit over the stage, readable, with 44 px buttons (${name})`, async ({ browser, baseURL }) => {
      const { ctx, page } = await openSite(browser, baseURL, { context });
      for (const id of ['fallback-2d', 'fatal']) {
        await page.evaluate(i => { for (const e of document.querySelectorAll('.stage-card')) e.hidden = e.id !== i; }, id);
        const r = await page.evaluate(i => {
          const card = document.getElementById(i), stage = document.querySelector('#stage').getBoundingClientRect(), cr = card.getBoundingClientRect();
          const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
          const bg = getComputedStyle(card).backgroundColor, fg = getComputedStyle(card.querySelector('p')).color;
          return { inStage: cr.left >= stage.left - 1 && cr.right <= stage.right + 1 && cr.top >= stage.top - 1 && cr.bottom <= stage.bottom + 1, covers: card.contains(document.elementFromPoint(cx, cy)), bg, fg,
            buttons: [...card.querySelectorAll('button:not([hidden])')].map(b => [b.id, b.getBoundingClientRect().width, b.getBoundingClientRect().height]), text: card.innerText.length, overflow: card.scrollHeight - card.clientHeight };
        }, id);
        expect(r.inStage, `#${id} is inside the stage`).toBe(true);
        expect(r.covers, `#${id} is painted above the labels and canvas`).toBe(true);
        expect(contrast(parseRgb(r.fg), parseRgb(r.bg))).toBeGreaterThanOrEqual(4.5);
        expect(r.buttons.length).toBeGreaterThan(0);
        for (const [bid, w, h] of r.buttons) { expect(w, bid).toBeGreaterThanOrEqual(44); expect(h, bid).toBeGreaterThanOrEqual(44); }
        expect(r.text).toBeGreaterThan(60);
      }
      await ctx.close();
    });
  }
});

// ------------------------------------------------------------------------------------------------ head metadata
test.describe('shell: head metadata', () => {
  test('title, description, canonical, theme-color, color-scheme, icons, manifest, Open Graph, Twitter, preload', async ({ browser, baseURL, request }) => {
    const { doc, close } = await sourceDom(browser);
    const m = await doc.evaluate(d => {
      const metas = sel => [...d.querySelectorAll(sel)].map(e => Object.fromEntries([...e.attributes].map(a => [a.name, a.value])));
      return {
        title: d.title, lang: d.documentElement.lang,
        names: Object.fromEntries(metas('meta[name]').map(e => [e.name + (e.media ? '|' + e.media : ''), e.content])),
        props: Object.fromEntries(metas('meta[property]').map(e => [e.property, e.content])),
        links: metas('link'), csp: d.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,
        importmap: d.querySelector('script[type="importmap"]')?.textContent,
        viewport: d.querySelector('meta[name="viewport"]')?.content, charset: d.querySelector('meta[charset]')?.getAttribute('charset'),
        stylesheets: metas('link[rel="stylesheet"]').map(l => l.href), preloadMarkers: d.head.innerHTML.includes('<!-- preload:start') && d.head.innerHTML.includes('<!-- preload:end -->'),
      };
    });
    await close();
    expect(m.lang).toBe('en');
    expect(m.charset.toLowerCase()).toBe('utf-8');
    expect(m.viewport).toContain('width=device-width');
    expect(m.viewport).toContain('viewport-fit=cover');
    expect(m.title).toMatch(/^Drug Hansch Space/);
    expect(m.names.description.length).toBeGreaterThan(80);
    expect(m.names.description.length).toBeLessThan(320);
    expect(m.names['color-scheme']).toBe('light dark');
    expect(m.names['theme-color|(prefers-color-scheme: light)']).toBe('#eef2f1');
    expect(m.names['theme-color|(prefers-color-scheme: dark)']).toBe('#0d1416');
    const link = rel => m.links.filter(l => l.rel === rel);
    expect(link('canonical')[0].href).toBe(CANONICAL);
    expect(link('canonical')[0].href).toMatch(/^https:\/\//);
    expect(link('icon').map(l => [l.type, l.sizes, l.href])).toEqual([['image/svg+xml', undefined, 'assets/favicon.svg'], ['image/png', '32x32', 'assets/icon-32.png']]);
    expect(link('apple-touch-icon')[0].href).toBe('assets/apple-touch-icon.png');
    expect(link('manifest')[0].href).toBe('manifest.webmanifest');
    // Open Graph and Twitter
    expect(m.props).toMatchObject({ 'og:type': 'website', 'og:title': 'Drug Hansch Space', 'og:url': CANONICAL, 'og:image': `${CANONICAL}assets/og.png`, 'og:image:width': '1200', 'og:image:height': '630' });
    expect(m.props['og:description'].length).toBeGreaterThan(40);
    expect(m.names['twitter:card']).toBe('summary_large_image');
    expect(m.names['twitter:title']).toBe('Drug Hansch Space');
    expect(m.names['twitter:description'].length).toBeGreaterThan(40);
    expect(m.names['twitter:image']).toBe(`${CANONICAL}assets/og.png`);
    // the og image itself is generated by the asset stage later: only its URL is checked here
    // preload of the two critical faces, with crossorigin (a font preload without it is fetched twice)
    const pre = link('preload');
    expect(pre.map(l => [l.as, l.type, 'crossorigin' in l, l.href])).toEqual([
      ['font', 'font/woff2', true, 'vendor/fonts/newsreader-normal-400-latin.woff2'],
      ['font', 'font/woff2', true, 'vendor/fonts/bricolage-grotesque-normal-500-latin.woff2'],
    ]);
    expect(m.preloadMarkers, 'preload:start / preload:end markers for the data stage').toBe(true);
    expect(m.stylesheets).toEqual(['vendor/fonts/fonts.css', 'style.css', 'css/layout.css', 'css/kbd.css', 'css/export.css', 'css/xr.css']);
    // every referenced local file exists and is served
    for (const href of [...m.links.map(l => l.href), ...pre.map(l => l.href)].filter(h => h && !/^https?:/.test(h))) {
      expect((await request.get(new URL(href, baseURL).href)).status(), href).toBe(200);
    }
    // CSP: the exact policy, plus the hash of the one inline script (the import map)
    const csp = Object.fromEntries(m.csp.split(';').map(s => s.trim()).filter(Boolean).map(s => { const [k, ...v] = s.split(/\s+/); return [k, v]; }));
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'", `'sha256-${sha256b64(m.importmap)}'`]);
    expect(csp['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp['img-src']).toEqual(["'self'", 'data:', 'blob:']);
    expect(csp['font-src']).toEqual(["'self'"]);
    expect(csp['connect-src']).toEqual(["'self'"]);
    expect(csp['worker-src']).toEqual(["'self'", 'blob:']);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'none'"]);
    expect(m.csp).not.toMatch(/unsafe-eval|https?:|\*/);
  });

  test('icon files have the right size and format; the manifest parses and its icons resolve', async ({ baseURL, request }) => {
    const want = { 'icon-32.png': [32, 32], 'icon-192.png': [192, 192], 'icon-512.png': [512, 512], 'apple-touch-icon.png': [180, 180] };
    for (const [f, dims] of Object.entries(want)) {
      expect(existsSync(new URL(`assets/${f}`, SITE)), f).toBe(true);
      expect(pngSize(readFileSync(new URL(`assets/${f}`, SITE))), f).toEqual(dims);
      const res = await request.get(new URL(`assets/${f}`, baseURL).href);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('image/png');
    }
    const svg = read('assets/favicon.svg');
    expect(svg).toMatch(/^<svg[^>]+viewBox="0 0 64 64"/);
    expect(svg, 'no script, no external references in the icon').not.toMatch(/<script|href=["']?https?:|xlink:href/i);
    const mf = JSON.parse(read('manifest.webmanifest'));
    expect(mf).toMatchObject({ name: 'Drug Hansch Space', display: 'browser', start_url: './', scope: './' });
    expect(mf.short_name.length).toBeGreaterThan(0);
    expect(mf.icons.map(i => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const i of mf.icons) expect((await request.get(new URL(i.src, new URL('manifest.webmanifest', baseURL)).href)).status(), i.src).toBe(200);
    expect(mf.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('robots.txt and 404.html are served, and the 404 page links home with an absolute URL', async ({ baseURL, request }) => {
    const robots = await request.get(new URL('robots.txt', baseURL).href);
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toMatch(/User-agent: \*/);
    const nf = read('404.html');
    expect((await request.get(new URL('404.html', baseURL).href)).status()).toBe(200);
    expect(nf).toMatch(/<meta name="robots" content="noindex">/);
    expect(nf).toContain(`href="${CANONICAL}"`);
    expect(nf, 'self-contained: no relative asset links that would break at a deep path').not.toMatch(/(?:src|href)="(?!https:\/\/dhruvmenon2003\.github\.io\/|#)[^"]*\.(?:css|js|png|svg)"/);
    expect(nf).toMatch(/Content-Security-Policy/);
  });
});

// ------------------------------------------------------------------------------------------------ no JavaScript
test.describe('shell: without JavaScript', () => {
  test('the text is readable, the steps are not dimmed, the explanation shows, the stage and skip links are gone', async ({ browser, baseURL }) => {
    const { ctx, page, watch } = await openSite(browser, baseURL, { context: { ...DESKTOP, javaScriptEnabled: false }, ready: false });
    await expect(page.locator('.noscript-note')).toBeVisible();
    await expect(page.locator('.noscript-note')).toContainText('JavaScript');
    await expect(page.locator('.noscript-note a[href="data/drugs.json"]')).toBeVisible();
    const css = await page.evaluate(() => {
      const steps = [...document.querySelectorAll('.step')];
      const bg = getComputedStyle(document.body).backgroundColor;
      return {
        n: steps.length, opacities: steps.map(s => getComputedStyle(s).opacity),
        h2: steps.map(s => getComputedStyle(s.querySelector('h2')).color), p: steps.map(s => getComputedStyle(s.querySelector('p:not(.eyebrow)')).color),
        stage: getComputedStyle(document.querySelector('#stage')).display, skip: [...document.querySelectorAll('.skip-link')].map(a => getComputedStyle(a).display),
        h1: document.querySelector('h1').getBoundingClientRect().height, bg, srLive: document.querySelector('#sr-live').textContent,
        stepText: steps.map(s => s.innerText.length),
      };
    });
    expect(css.n).toBe(8);
    expect(css.opacities, 'tour steps at full opacity').toEqual(Array(8).fill('1'));
    for (const c of [...css.h2, ...css.p]) expect(contrast(parseRgb(c), parseRgb(css.bg)), `step text ${c} on ${css.bg}`).toBeGreaterThanOrEqual(4.5);
    expect(css.stage, 'the 3D stage is not shown').toBe('none');
    expect(css.skip, 'skip links are not shown (their targets are not usable without JS)').toEqual(Array(4).fill('none'));
    expect(css.h1).toBeGreaterThan(10);
    for (const t of css.stepText) expect(t, 'each step has readable text').toBeGreaterThan(150);
    expect(watch.problems.filter(p => !/JavaScript/i.test(p))).toEqual([]);
    await ctx.close();
  });
});

// ------------------------------------------------------------------------------------------------ skip links
test.describe('shell: skip links', () => {
  const TARGETS = [['Skip to controls', '#explore', 'explore'], ['Skip to the 3D plot', '#space-skip', 'space'], ['Skip to the data table', '#table-details', 'table-details'], ['Skip to the tour text', '#rail', 'rail']];

  test('the first Tab stops on the first skip link, it is visible, high contrast and above the masthead', async ({ browser, baseURL }) => {
    const { ctx, page } = await openSite(browser, baseURL);
    const box = await page.locator('a.skip-link').first().boundingBox();
    expect(box.y + box.height, 'off-screen until focused').toBeLessThanOrEqual(0);
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const a = document.activeElement, r = a.getBoundingClientRect(), cs = getComputedStyle(a), mast = getComputedStyle(document.querySelector('.masthead'));
      return { text: a.textContent.trim(), href: a.getAttribute('href'), rect: r.toJSON(), z: +cs.zIndex, mastZ: +mast.zIndex, fg: cs.color, bg: cs.backgroundColor, vw: innerWidth, vh: innerHeight, pos: cs.position, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === a };
    });
    expect(info.text).toBe('Skip to controls');
    expect(info.rect.top, 'in the viewport').toBeGreaterThanOrEqual(0);
    expect(info.rect.bottom).toBeLessThanOrEqual(info.vh);
    expect(info.rect.left).toBeGreaterThanOrEqual(0);
    expect(info.rect.right).toBeLessThanOrEqual(info.vw);
    expect(info.rect.height, '44 px target').toBeGreaterThanOrEqual(44);
    expect(info.z, 'above the sticky masthead').toBeGreaterThan(info.mastZ);
    expect(info.hit, 'nothing paints over it').toBe(true);
    expect(contrast(parseRgb(info.fg), parseRgb(info.bg))).toBeGreaterThanOrEqual(7);
    expect(await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; }), 'visible focus ring').toBe(true);
    await ctx.close();
  });

  for (const [i, [text, href, targetId]] of TARGETS.entries()) {
    test(`"${text}" moves focus to #${targetId}`, async ({ browser, baseURL }) => {
      const { ctx, page } = await openSite(browser, baseURL);
      for (let k = 0; k <= i; k++) await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement.textContent.trim())).toBe(text);
      expect(await page.evaluate(() => document.activeElement.getAttribute('href'))).toBe(href);
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => document.activeElement?.id), { message: `focus after "${text}"` }).toBe(targetId);
      await ctx.close();
    });
  }

  test('focus targets: tabindex -1 on the containers a skip link lands on', async ({ browser, baseURL }) => {
    const { ctx, page } = await openSite(browser, baseURL);
    for (const id of ['explore', 'rail', 'table-details']) expect(await page.$eval('#' + id, e => e.getAttribute('tabindex')), id).toBe('-1');
    await ctx.close();
  });
});

// ------------------------------------------------------------------------------------------------ axe
test.describe('shell: axe-core (serious and critical violations must be zero)', () => {
  test.setTimeout(240_000);
  for (const scheme of ['light', 'dark']) {
    for (const state of ['default', 'drug selected']) {
      test(`${scheme} theme, ${state}`, async ({ browser, baseURL }, info) => {
        const { ctx, page } = await openSite(browser, baseURL, { context: { ...DESKTOP, colorScheme: scheme } });
        if (state === 'drug selected') {
          await pickDrug(page);
          await page.evaluate(() => { document.querySelector('#table-details').open = true; document.querySelector('.cands').open = true; });
          await page.waitForSelector('#table tbody tr');
        }
        const res = await new AxeBuilder({ page }).analyze();
        const bad = res.violations.filter(v => ['serious', 'critical'].includes(v.impact));
        const lower = res.violations.filter(v => !['serious', 'critical'].includes(v.impact));
        info.annotations.push({ type: 'axe-other', description: lower.map(v => `${v.impact}:${v.id}(${v.nodes.length})`).join(' ') || 'none' });
        expect(bad.map(v => `${v.impact} ${v.id}: ${v.help}\n  ${v.nodes.slice(0, 4).map(n => n.target.join(' ') + ' :: ' + (n.any[0]?.message || n.all[0]?.message || n.none[0]?.message || '')).join('\n  ')}`), 'serious/critical axe violations').toEqual([]);
        await ctx.close();
      });
    }
  }
});

// ------------------------------------------------------------------------------------------------ touch / click targets
test.describe('shell: every control is at least 44 x 44 CSS px (links inside running text excepted)', () => {
  test.setTimeout(240_000);
  for (const [name, context] of [['1280x800 desktop', DESKTOP], ['390x844 touch', PHONE]]) {
    test(name, async ({ browser, baseURL }, info) => {
      const { ctx, page } = await openSite(browser, baseURL, { context });
      await pickDrug(page);
      await page.evaluate(() => { document.querySelector('#table-details').open = true; });
      await page.waitForSelector('#table tbody tr');
      const found = await page.evaluate(() => {
        const SEL = 'button, a[href], select, input:not([type="hidden"]), summary, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
        const out = [], exceptions = [];
        const seen = new Set();
        for (const el of document.querySelectorAll(SEL)) {
          if (seen.has(el)) continue;
          seen.add(el);
          if (!el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false })) continue;
          if (el.matches('canvas')) continue;                                       // the 3D plot itself is a large focusable canvas
          if (el.closest('.table-wrap') && el.matches('div')) continue;
          let target = el, kind = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
          if (el.matches('input[type="checkbox"], input[type="radio"]')) { target = el.closest('label') || document.querySelector(`label[for="${el.id}"]`) || el; kind += ' (via its label)'; }
          const r = target.getBoundingClientRect();
          // a link that sits inside running text (its parent holds other text) is exempt
          if (el.matches('a[href]')) {
            const own = [...el.parentElement.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ');   // words next to the link, not other links
            if (/[A-Za-z]{3,}/.test(own)) { exceptions.push(`${kind} "${el.textContent.trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`); continue; }
          }
          out.push({ kind, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30) });
        }
        return { out, exceptions };
      });
      info.annotations.push({ type: 'checked', description: `${found.out.length} controls; ${found.exceptions.length} in-text links exempt` });
      info.annotations.push({ type: 'exempt links', description: found.exceptions.join(' | ').slice(0, 1500) });
      expect(found.out.length, 'the audit found the controls').toBeGreaterThan(40);
      expect(found.out.filter(c => c.w < 44 || c.h < 44).map(c => `${c.kind} "${c.text}" ${c.w}x${c.h}`), 'controls under 44 px').toEqual([]);
      if (name.includes('touch')) {
        // Hansch plot points: a transparent 34 px stroke around the 10 px point gives a 44 px hit circle on touch screens
        expect(await page.$eval('#h-plot circle[data-cid]', c => getComputedStyle(c).strokeWidth)).toBe('34px');
        const horizontal = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(horizontal, 'no horizontal page scroll at 390 px').toBeLessThanOrEqual(0);
      }
      await ctx.close();
    });
  }
});

// ------------------------------------------------------------------------------------------------ text size
test.describe('shell: no text under 12 px (SVG plot text excepted, see the note)', () => {
  for (const [name, context] of [['1280x800', DESKTOP], ['390x844 touch', PHONE]]) {
    test(name, async ({ browser, baseURL }, info) => {
      const { ctx, page } = await openSite(browser, baseURL, { context });
      await pickDrug(page);
      await page.evaluate(() => { document.querySelector('#table-details').open = true; document.querySelector('.cands').open = true; });
      await page.waitForSelector('#table tbody tr');
      const r = await page.evaluate(() => {
        const small = [], svg = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const el = n.parentElement;
          if (!el || el.closest('script, style, noscript, .sr-only, option, datalist') || !el.checkVisibility({ checkVisibilityCSS: true })) continue;
          const px = parseFloat(getComputedStyle(el).fontSize);
          if (el.closest('svg')) { const w = el.closest('svg').getBoundingClientRect().width, vb = el.closest('svg').viewBox?.baseVal?.width || w; svg.push(Math.round(px * w / vb * 10) / 10); continue; }
          if (px < 12) small.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} ${px}px "${n.textContent.trim().slice(0, 24)}"`);
        }
        return { small, svgMin: svg.length ? Math.min(...svg) : null };
      });
      info.annotations.push({ type: 'SVG plot text (effective px)', description: `smallest ${r.svgMin} px: the observed-against-predicted plot scales its 10-unit text with its viewBox; fixing it needs hansch.js (deferred)` });
      expect(r.small, 'HTML text under 12 px').toEqual([]);
      await ctx.close();
    });
  }
});

// ------------------------------------------------------------------------------------------------ contrast
test.describe('shell: contrast of the design tokens', () => {
  const TEXT = ['ink', 'ink-2', 'muted', 'accent', 'mark'], SURFACES = ['bg', 'panel'];
  for (const scheme of ['light', 'dark']) {
    test(`${scheme}: every text token on --bg and --panel is at least 4.5:1, grey spheres at least 3:1 against --bg`, async ({ browser, baseURL }) => {
      const { ctx, page } = await openSite(browser, baseURL, { context: { ...DESKTOP, colorScheme: scheme } });
      const t = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement), o = {}; for (const k of ['bg', 'panel', 'ink', 'ink-2', 'muted', 'accent', 'accent-ink', 'mark', 'point', 'line']) o[k] = cs.getPropertyValue('--' + k).trim(); return o; });
      const low = [];
      for (const fg of TEXT) for (const bg of SURFACES) { const c = contrast(t[fg], t[bg]); if (c < 4.5) low.push(`${fg} on ${bg} ${c.toFixed(2)}`); }
      expect(low, 'text pairs under 4.5:1').toEqual([]);
      expect(contrast(t['accent-ink'], t.accent), 'button label on accent').toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.point, t.bg), 'grey sphere against the background (non-text, 3:1)').toBeGreaterThanOrEqual(3);
      await ctx.close();
    });
    test(`${scheme}: the colours the page really paints on tour text (inactive and active steps) are at least 4.5:1`, async ({ browser, baseURL }) => {
      const { ctx, page } = await openSite(browser, baseURL, { context: { ...DESKTOP, colorScheme: scheme } });
      const rows = await page.evaluate(() => {
        const bg = getComputedStyle(document.body).backgroundColor, out = [];
        const active = document.querySelector('.step.is-active');
        for (const s of document.querySelectorAll('.step')) {
          for (const sel of ['.eyebrow', 'h2', 'p:not(.eyebrow):not(.fig):not(.hint)', '.hint']) {
            const el = s.querySelector(sel); if (!el) continue;
            const cs = getComputedStyle(el);
            out.push({ step: s.dataset.step, active: s === active, sel, color: cs.color, op: String(+cs.opacity * +getComputedStyle(s).opacity), bg });
          }
          const fig = s.querySelector('.fig:not(:empty)'); if (fig) out.push({ step: s.dataset.step, active: s === active, sel: '.fig', color: getComputedStyle(fig).color, op: getComputedStyle(s).opacity, bg });
        }
        return out;
      });
      expect(rows.length).toBeGreaterThan(30);
      expect(rows.some(r => r.active) && rows.some(r => !r.active), 'both an active and inactive step were measured').toBe(true);
      const low = rows.filter(r => r.op !== '1' || contrast(parseRgb(r.color), parseRgb(r.bg)) < 4.5).map(r => `${r.step} ${r.active ? 'active' : 'inactive'} ${r.sel} ${r.color} opacity ${r.op}`);
      expect(low, 'tour text under 4.5:1 (or dimmed with opacity)').toEqual([]);
      await ctx.close();
    });
  }
});

// ------------------------------------------------------------------------------------------------ CSP
test.describe('shell: Content-Security-Policy', () => {
  test.setTimeout(240_000);
  test('zero violations and no console problems across load and a set of interactions, and the policy is really enforced', async ({ browser, baseURL }) => {
    const { ctx, page, watch, origin } = await openSite(browser, baseURL);
    await page.selectOption('#ax-x', 'mw');
    await page.selectOption('#color-by', 'ro5');
    await page.selectOption('#f-route', { index: 1 });
    await pickDrug(page, 'caffeine');
    await page.click('#btn-spin');
    await page.click('#btn-spin');
    await page.evaluate(() => { document.querySelector('#table-details').open = true; });
    await page.selectOption('#h-group', { index: 2 });
    await page.click('#h-show');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => document.querySelector('[data-step="activity"]').scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => window.__csp), 'securitypolicyviolation events').toEqual([]);
    expect(watch.problems, 'console errors and warnings').toEqual([]);
    expect([...watch.origins], 'every request goes to the page origin').toEqual([origin]);
    // negative control: an injected inline script is refused (and reported as a script-src violation), so the zero above means something
    const refused = await page.evaluate(() => new Promise(resolve => {
      const seen = [];
      document.addEventListener('securitypolicyviolation', e => seen.push(e.violatedDirective), { once: false });
      const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.body.appendChild(s);
      setTimeout(() => resolve({ ran: window.__inline === 1, seen }), 200);
    }));
    expect(refused.ran, 'an injected inline script did not run').toBe(false);
    expect(refused.seen.join(' ')).toContain('script-src');
    await ctx.close();
  });
});

// ------------------------------------------------------------------------------------------------ footer, wording, links, licence files
test.describe('shell: attribution, wording, links', () => {
  test('the footer carries the attribution, the data sources section and the disclaimer', async ({ browser, baseURL }) => {
    const { ctx, page, origin } = await openSite(browser, baseURL);
    const foot = page.locator('footer#sources');
    await expect(foot).toBeVisible();
    await expect(foot.locator('h2')).toHaveText('Data sources and licences');
    const text = await foot.innerText();
    for (const s of ['Educational exploration only', 'not medical advice', 'not a toxicity predictor', 'non-commercial', 'DrugBank', 'ChEMBL', 'CC BY-SA 3.0', 'PubChem', 'WHO Collaborating Centre for Drug Statistics Methodology', 'ATC/DDD Index 2026', 'openFDA', 'DailyMed', 'RDKit', 'three.js', 'GSAP', 'SmilesDrawer', 'SIL Open Font License', 'Nucleic Acids Res', 'Changes made to the source data', 'About the data']) expect(text, s).toContain(s);
    expect(text, 'no unresolved placeholder reaches the page').not.toMatch(/\[CONFIRM|TODO|FIXME|lorem/i);
    expect(text).toContain('A licence for this project\'s own code and data has not been chosen yet');
    const links = await foot.locator('a[href]').evaluateAll(as => as.map(a => ({ href: a.getAttribute('href'), abs: a.href, rel: a.rel, target: a.target })));
    expect(links.length).toBeGreaterThan(25);
    const external = links.filter(l => !l.abs.startsWith(origin));
    expect(external.length).toBeGreaterThan(20);
    for (const l of external) {
      expect(l.abs, `external link ${l.href} is https`).toMatch(/^https:\/\//);
      expect(l.rel.split(/\s+/), `${l.href} rel`).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    }
    for (const must of ['https://creativecommons.org/licenses/by-sa/3.0/', 'https://atcddd.fhi.no/atc_ddd_index/', 'https://www.ebi.ac.uk/chembl/', 'https://pubchem.ncbi.nlm.nih.gov/', 'https://open.fda.gov/terms/', 'https://gsap.com/standard-license/', 'https://openfontlicense.org/']) expect(links.map(l => l.href), must).toContain(must);
    await ctx.close();
  });

  test('wording: no "approved", Method paths point into this repository, "Toxicity is still empty" stays', async ({ browser, baseURL, request }) => {
    const { ctx, page } = await openSite(browser, baseURL);
    const html = read('index.html');
    expect(html, 'the static source').not.toMatch(/approved/i);
    await pickDrug(page);
    const body = await page.evaluate(() => document.body.innerText + ' ' + document.title + ' ' + [...document.querySelectorAll('meta[content]')].map(m => m.content).join(' '));
    expect(body, 'the rendered page, after selecting a drug').not.toMatch(/approved/i);
    expect(body).toContain('drugs from a curated DrugBank-derived table');
    const method = await page.locator('#method').innerText();
    for (const s of ['tools/build_data.py', 'tools/hansch_marimo.py', 'data/provenance.csv', 'data/validation.md', 'Toxicity is still empty in the source table']) expect(method, s).toContain(s);
    for (const s of ['explorer/', 'curation/colab_curate_all.py']) expect(method + (await page.locator('#sources').innerText()), `stale path ${s}`).not.toContain(s);
    for (const href of ['data/provenance.csv', 'data/validation.md']) {
      expect(await page.locator(`#method a[href="${href}"]`).count(), href).toBe(1);
      const res = await request.get(new URL(href, baseURL).href);
      expect(res.status(), href).toBe(200);
      expect((await res.text()).length).toBeGreaterThan(100);
    }
    await ctx.close();
  });

  test('every relative link in the page resolves (200)', async ({ browser, baseURL, request }) => {
    const { ctx, page } = await openSite(browser, baseURL);
    await pickDrug(page);
    const hrefs = await page.$$eval('a[href]', as => [...new Set(as.map(a => a.getAttribute('href')).filter(h => h && !h.startsWith('#') && !/^[a-z]+:/i.test(h)))]);
    expect(hrefs).toEqual(expect.arrayContaining(['data/drugs.json', 'data/provenance.csv', 'data/validation.md', 'vendor/fonts/LICENSES.md']));
    for (const h of hrefs) expect((await request.get(new URL(h, baseURL).href)).status(), h).toBe(200);
    // ids that the in-page links point at exist
    const ids = await page.$$eval('a[href^="#"]', as => [...new Set(as.map(a => a.getAttribute('href').slice(1)).filter(Boolean))]);
    for (const id of ids) if (id !== 'space-skip') expect(await page.locator(`[id="${id}"]`).count(), `#${id}`).toBe(1);
    await ctx.close();
  });

  test('every external link on the page (static and app-generated) is https and opens with rel noopener', async ({ browser, baseURL }, info) => {
    const { ctx, page } = await openSite(browser, baseURL);
    await pickDrug(page);
    const links = await page.$$eval('a[href^="http"]', as => as.map(a => ({ href: a.href, rel: a.rel, target: a.target, inFooter: !!a.closest('footer') })));
    expect(links.length).toBeGreaterThan(25);
    expect(links.filter(l => !l.href.startsWith('https://')).map(l => l.href), 'plain-http links').toEqual([]);
    expect(links.filter(l => l.target === '_blank' && !/\bnoopener\b/.test(l.rel)).map(l => `${l.href} rel="${l.rel}"`), 'target=_blank without noopener').toEqual([]);
    // the footer (shell) links carry noreferrer too (asserted in the footer test); the links the app writes into the drug and Hansch
    // panels (detail.js, hansch.js) carry only noopener. Adding noreferrer there changes HTML that the parity goldens hash.
    const gaps = links.filter(l => !/\bnoreferrer\b/.test(l.rel)).map(l => l.href);
    info.annotations.push({ type: 'external links without noreferrer', description: `${gaps.length}: ${[...new Set(gaps.map(h => new URL(h).host + new URL(h).pathname.split('/').slice(0, 3).join('/')))].join(' ')}` });
    expect(gaps.filter(h => links.find(l => l.href === h)?.inFooter), 'footer links without noreferrer').toEqual([]);
    await ctx.close();
  });
});

test.describe('shell: licence files', () => {
  test('THIRD_PARTY_LICENSES.md lists the shipped code and fonts and marks the test tooling as not shipped', () => {
    const t = readFileSync(new URL('THIRD_PARTY_LICENSES.md', ROOT), 'utf8');
    for (const s of ['three.js', 'The MIT License', 'Copyright © 2010-2024 three.js authors', 'GSAP', 'Standard "No Charge" License', 'https://gsap.com/standard-license/', 'public Git repository', 'SmilesDrawer', 'Copyright (c) 2017 GDB / Reymond Research Group', 'Bricolage Grotesque', 'IBM Plex Mono', 'Newsreader', 'Copyright 2022 The Bricolage Grotesque Project Authors', 'Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"', 'Copyright 2020 The Newsreader Project Authors', 'SIL OFL 1.1']) expect(t, s).toContain(s);
    const testing = t.slice(t.indexOf('## 4. Test tooling'));
    for (const s of ['NOT shipped', 'iwer', '@iwer/sem', 'MIT', 'Playwright', 'Apache-2.0', 'axe-core', 'MPL-2.0', 'Meta Platforms']) expect(testing, s).toContain(s);
    expect(t.slice(0, t.indexOf('## 4. Test tooling')), 'test tooling is not mixed into the shipped sections').not.toMatch(/\|\s*(iwer|axe-core|Playwright)/);
  });

  test('vendor/fonts/LICENSES.md carries the verbatim OFL 1.1 text and the copyright line for each font', () => {
    const t = read('vendor/fonts/LICENSES.md');
    expect(t.match(/SIL OPEN FONT LICENSE Version 1\.1/g) || [], 'three OFL texts').toHaveLength(3);
    for (const s of ['Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage)', 'Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"', 'Copyright 2020 The Newsreader Project Authors (http://github.com/productiontype/Newsreader)', 'PERMISSION & CONDITIONS', 'DEFINITIONS', 'TERMINATION', 'DISCLAIMER', 'OTHER DEALINGS IN THE FONT SOFTWARE']) expect(t.includes(s), s).toBe(true);
    expect(t.match(/OTHER DEALINGS IN THE FONT SOFTWARE/g), 'each text is complete').toHaveLength(3);
    expect(read('vendor/fonts/fonts.css')).toContain('see LICENSES.md');
  });

  test('docs/LICENSING-NOTES.md states every open owner decision, plainly, and the build-provenance gaps', () => {
    const t = readFileSync(new URL('docs/LICENSING-NOTES.md', ROOT), 'utf8');
    const flag = 'OWNER DECISION REQUIRED - not decided by the build';
    expect((t.match(new RegExp(flag, 'g')) || []).length, 'one flag per open decision').toBeGreaterThanOrEqual(6);
    for (const s of ['DrugBank', 'trust.drugbank.com', 'Creative Commons', 'CC BY-NC 4.0', 'CC BY-SA 3.0', 'Changing or manipulating the material is not allowed', 'whocc@fhi.no', 'GSAP', 'public Git repository', 'Reserved Font Name', 'Plex', 'No `LICENSE` file', 'not legal advice']) expect(t, s).toContain(s);
    for (const s of ['DrugBank release', 'ChEMBL release', 'RDKit version', 'not recorded']) expect(t, s).toContain(s);
  });
});

// ------------------------------------------------------------------------------------------------ layout shift and fonts
test.describe('shell: layout shift', () => {
  test.setTimeout(240_000);
  for (const [name, context] of [['1280x800', DESKTOP], ['390x844 touch', PHONE]]) {
    test(`CLS <= 0.02 at ${name} (load, then scrolling through the tour)`, async ({ browser, baseURL }, info) => {
      const { ctx, page } = await openSite(browser, baseURL, { context });
      await page.waitForTimeout(1500);
      const atLoad = await page.evaluate(() => window.__cls);
      for (const s of ['space', 'structure', 'logp', 'mr', 'tpsa', 'activity', 'series', 'all']) {
        await page.evaluate(n => document.querySelector(`.step[data-step="${n}"]`).scrollIntoView({ block: 'center', behavior: 'instant' }), s);
        await page.waitForTimeout(250);
      }
      const total = await page.evaluate(() => window.__cls);
      info.annotations.push({ type: 'CLS', description: `at load ${atLoad.toFixed(4)}, after the tour ${total.toFixed(4)}` });
      expect(atLoad, 'CLS at load').toBeLessThanOrEqual(0.02);
      expect(total, 'CLS after scrolling the tour').toBeLessThanOrEqual(0.02);
      await ctx.close();
    });
  }

  test('fonts: preloaded faces are used, the size-adjusted fallbacks exist, font-display is swap', async ({ browser, baseURL }) => {
    const css = read('style.css'), fonts = read('vendor/fonts/fonts.css');
    for (const fam of ['Newsreader Fallback', 'Bricolage Fallback', 'Plex Mono Fallback']) {
      expect(css, fam).toContain(`font-family: "${fam}"`);
    }
    expect(css).toMatch(/size-adjust:\s*[\d.]+%/);
    expect(css).toMatch(/ascent-override/);
    expect(css).toContain('--font-display: "Bricolage Grotesque", "Bricolage Fallback"');
    expect(fonts.match(/font-display:\s*swap/g)?.length, 'every web face swaps').toBe((fonts.match(/@font-face/g) || []).length);
    const { ctx, page, watch } = await openSite(browser, baseURL);
    const loaded = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')); });
    expect(loaded).toEqual(expect.arrayContaining(['Newsreader', 'Bricolage Grotesque', 'IBM Plex Mono']));
    expect(watch.problems.filter(p => /preload/i.test(p)), 'no "preloaded but not used" warning').toEqual([]);
    await ctx.close();
  });
});

test('shell: the stage keeps its size from first paint (no collapse before the scene exists)', async ({ browser, baseURL }) => {
  const { ctx, page } = await openSite(browser, baseURL, { ready: false });
  const box = await page.locator('.stage').boundingBox();
  expect(box.height, 'the stage is tall before any script has built the scene').toBeGreaterThan(400);
  await waitReady(page);
  const after = await page.locator('.stage').boundingBox();
  expect(Math.abs(after.height - box.height), 'its height does not jump when the scene appears').toBeLessThan(40);
  await ctx.close();
});
