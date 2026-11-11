// dose-trend.spec.mjs - the dose-trend explorable at site/dose-trend/: it loads only from this origin under its CSP, the
// numbers in its prose equal the model's, its figures answer to the keyboard, the analyzer recomputes when the table is
// edited, the figure studio exports a PDF with embedded TrueType fonts, and nothing breaks when WebGL is missing.
// The statistics themselves are checked against independent arithmetic here (Cochran-Armitage with the binomial variance),
// not against the page's own code.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const PAGE = 'dose-trend/index.html';
const SITE = new URL('../../site/', import.meta.url);
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light' };

// The headache row of the example table: doses, cases, group sizes.
const X = [0, 400, 800, 1200, 1600], R = [4, 3, 4, 6, 8], N = [13, 11, 12, 14, 13];
function erfc(x) { // Numerical Recipes 6.2, |error| < 1.2e-7
  const z = Math.abs(x), t = 1 / (1 + z / 2);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const normSf = z => 0.5 * erfc(z / Math.SQRT2);
function trend(x, r, n) {
  const Nt = n.reduce((a, b) => a + b, 0), Rt = r.reduce((a, b) => a + b, 0), p = Rt / Nt;
  const t = x.reduce((s, xi, i) => s + xi * (r[i] - n[i] * p), 0);
  const sx = x.reduce((s, xi, i) => s + n[i] * xi, 0), sxx = x.reduce((s, xi, i) => s + n[i] * xi * xi, 0);
  const z = t / Math.sqrt(p * (1 - p) * (sxx - sx * sx / Nt));
  return { z, pTwo: 2 * normSf(Math.abs(z)) };
}
const fmtP = p => (p < 0.001 ? '<0.001' : p > 0.99 ? '>0.99' : p < 0.1 ? p.toFixed(3) : p.toFixed(2));

async function open(browser, baseURL, { context = DESKTOP, init } = {}) {
  const ctx = await browser.newContext(context), page = await ctx.newPage();
  const problems = [], origins = new Set();
  page.on('console', m => { if (m.type() === 'error') problems.push(`[console] ${m.text()}`); });
  page.on('pageerror', e => problems.push(`[pageerror] ${e.message}`));
  page.on('request', r => { const u = new URL(r.url()); if (!['data:', 'blob:'].includes(u.protocol)) origins.add(u.origin); });
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  if (init) await page.addInitScript(init);
  await page.goto(new URL(PAGE, baseURL).href);
  await page.waitForFunction(() => !!window.__bindings && !!window.__tool?.result, null, { timeout: 30_000 });
  return { ctx, page, problems, origins, origin: new URL(baseURL).origin };
}
const readout = (page, fig) => page.locator(`#${fig} .readout`).innerText();

test.describe('dose-trend page', () => {
  test('loads from this origin only, under its CSP, without errors', async ({ browser, baseURL }) => {
    const { ctx, page, problems, origins, origin } = await open(browser, baseURL);
    await page.waitForTimeout(1500);
    expect([...origins], 'every request stays on the site').toEqual([origin]);
    expect(await page.evaluate(() => window.__csp), 'no CSP violation').toEqual([]);
    expect(problems).toEqual([]);
    const head = readFileSync(new URL(PAGE, SITE), 'utf8');
    expect(head).toMatch(/Content-Security-Policy/);
    expect(head).not.toMatch(/googleapis|jsdelivr|unpkg|cdnjs/);
    expect(await page.locator('.site-nav a[href="../"]').count(), 'links back to the explorer').toBe(1);
    await ctx.close();
  });

  test('every number typed into the prose equals the model, and the model equals independent arithmetic', async ({ browser, baseURL }) => {
    const { ctx, page } = await open(browser, baseURL);
    const B = await page.evaluate(() => window.__bindings);
    const html = readFileSync(new URL(PAGE, SITE), 'utf8');
    const typed = [...html.matchAll(/<span data-b="(\w+)">([^<]*)<\/span>/g)].map(m => [m[1], m[2].replace(/&amp;/g, '&')]);
    expect(typed.length).toBeGreaterThan(50);
    const drift = typed.filter(([k, v]) => k !== 'formula' && String(B[k]) !== v);
    expect(drift, 'fallback text out of step with the model').toEqual([]);
    const t = trend(X, R, N);
    expect(B.pAsym).toBe(fmtP(t.pTwo));
    expect(B.pAsym).toBe('0.077');
    expect(B.z).toBe(t.z.toFixed(2));
    expect(B.pRefMinus).toBe(fmtP(trend(X, [3, 3, 4, 6, 8], N).pTwo));
    expect(B.pTopPlus).toBe(fmtP(trend(X, [4, 3, 4, 6, 9], N).pTwo));
    await ctx.close();
  });

  test('the figures answer to the keyboard and the analyzer follows an edited cell', async ({ browser, baseURL }) => {
    const { ctx, page, problems } = await open(browser, baseURL);
    await page.locator('#fig-dots canvas').scrollIntoViewIfNeeded();
    await page.focus('#fig-dots canvas');
    await page.keyboard.press('ArrowUp');
    expect(await readout(page, 'fig-dots')).toMatch(/9 of 13/);
    await page.locator('#fig-verdicts canvas').scrollIntoViewIfNeeded();
    await page.click('#fig-verdicts [data-preset=stair]');
    expect(await readout(page, 'fig-verdicts')).toContain('P = ' + fmtP(trend(X, [3, 3, 5, 7, 8], N).pTwo));
    await page.locator('#fig-land canvas').scrollIntoViewIfNeeded();
    await page.focus('#fig-land canvas');
    await page.keyboard.press('ArrowDown');
    expect(await readout(page, 'fig-land')).toMatch(/Placebo 3 of 13.*P = 0\.031/);
    // the analyzer: nasal congestion at 1600 mg from 2 to 6
    await page.locator('#tiles').scrollIntoViewIfNeeded();
    const options = await page.locator('#sel-event option').evaluateAll(o => o.map(e => [e.value, e.textContent]));
    await page.selectOption('#sel-event', options.find(([, t]) => t.startsWith('Nasal'))[0]);
    const cell = page.locator('#grid tbody tr').nth(2).locator('input[type=text]').nth(5);
    await cell.fill('6'); // edits are debounced, so these expectations retry
    await expect(page.locator('#tiles')).toContainText(fmtP(trend(X, [1, 1, 1, 3, 6], N).pTwo));
    await cell.fill('20');
    await expect(page.locator('#errors'), 'a count above its group size is refused').not.toHaveText('');
    expect(problems).toEqual([]);
    await ctx.close();
  });

  test('the figure studio exports a PDF with embedded TrueType fonts and an SVG with live text', async ({ browser, baseURL }) => {
    const { ctx, page, problems } = await open(browser, baseURL);
    await page.locator('#btn-pdf').scrollIntoViewIfNeeded();
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('#btn-pdf')]);
    const bytes = readFileSync(await pdf.path());
    const text = bytes.toString('latin1');
    expect(pdf.suggestedFilename()).toBe('fig1_headache_dose_trend.pdf');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toMatch(/\/Subtype \/TrueType/);
    expect(text).toMatch(/\/FontFile2 \d+ 0 R/);
    expect(text).not.toMatch(/\/Type3|\/Subtype \/Type1/);
    expect(text).toMatch(/\/MediaBox \[0 0 518\.6\d* /); // 183 mm at 300 dpi is 2161 px = 518.64 pt
    const [svg] = await Promise.all([page.waitForEvent('download'), page.click('#btn-svg')]);
    const s = readFileSync(await svg.path(), 'utf8');
    expect(s).toContain('width="183mm"');
    expect(s).toContain('<!-- Target: Nature');
    expect((s.match(/<text\b/g) || []).length).toBeGreaterThan(30);
    expect(problems).toEqual([]);
    await ctx.close();
  });

  test('the molecule is drawn without WebGL, and in 3D with it', async ({ browser, baseURL }) => {
    const noWebGL = () => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : get.call(this, type, ...rest); }; };
    const flat = await open(browser, baseURL, { init: noWebGL });
    await flat.page.waitForTimeout(2500);
    expect(await flat.page.evaluate(() => window.__hero || null), 'no engine without WebGL').toBeNull();
    expect(await flat.page.locator('#fig-molecule canvas.flat').evaluate(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; }), 'the flat drawing has ink').toBeGreaterThan(1000);
    expect(flat.problems).toEqual([]);
    await flat.ctx.close();
    const lit = await open(browser, baseURL);
    await lit.page.waitForFunction(() => !!window.__hero, null, { timeout: 30_000 });
    const hero = await lit.page.evaluate(() => window.__hero);
    expect(hero.engine).toMatch(/^three r\d+/);
    expect(hero.entities).toBe(56);
    expect(lit.problems).toEqual([]);
    await lit.ctx.close();
  });

  test('no horizontal overflow on a phone @mobile', async ({ browser, baseURL }) => {
    const { ctx, page, problems } = await open(browser, baseURL, { context: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } });
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(problems).toEqual([]);
    await ctx.close();
  });
});
