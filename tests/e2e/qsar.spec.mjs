import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

const readData = () => JSON.parse(readFileSync(new URL('../../site/data/qsar_drd2.json', import.meta.url), 'utf8'));
async function open(page) {
  await page.goto('/?debug');
  await page.waitForFunction(() => document.querySelector('#stage-status')?.hidden === true);
  await page.locator('#qsar-open').click();
  await expect(page.locator('#qsar-body')).toBeVisible();
}

test('QSAR uses the real export in an accessible home overlay, supports domain colours and joins @mobile', async ({ page }) => {
  const exported = readData(), errors = [];
  expect(readFileSync(new URL('../../data/qsar_drd2.json', import.meta.url), 'utf8'))
    .toBe(readFileSync(new URL('../../site/data/qsar_drd2.json', import.meta.url), 'utf8'));
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page.locator('#qsar-summary')).toContainText(`${exported.n} compounds`);
  await expect(page.locator('#qsar-verdict')).toHaveText(exported.verdict);
  await expect(page.locator('#qsar-compounds tr')).toHaveCount(exported.n);
  await expect(page.locator('#qsar-prediction .qsar-point')).toHaveCount(exported.n);
  await expect(page.locator('#qsar-williams .qsar-flag')).toHaveCount(exported.compounds.filter(p => p.outside_domain).length);
  await expect(page.locator('#qsar-scrambling rect')).toHaveCount(15);
  expect(await page.locator('#qsar-surface polygon').count()).toBeGreaterThan(0);
  await expect(page.locator('#qsar-prediction-caption')).toContainText('training set');
  expect(await page.locator('#qsar-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).include('#qsar-dialog').analyze();
  expect(results.violations.filter(v => ['critical', 'serious'].includes(v.impact))).toEqual([]);
  const highlight = page.locator('#qsar-highlight');
  if (await highlight.isEnabled()) {
    await highlight.check();
    expect(await page.evaluate(() => window.__hansch.app.qsarHighlight)).toBe(true);
    await expect(page.locator('#legend')).toContainText('DRD2: outside domain');
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#qsar-dialog')).not.toBeVisible();
  await expect(page.locator('#qsar-open')).toBeFocused();
  if (await page.locator('#qsar-clear').isVisible()) {
    await page.locator('#qsar-clear').click();
    expect(await page.evaluate(() => window.__hansch.app.qsarHighlight)).toBe(false);
  }
  await page.locator('#qsar-open').click();
  const linked = page.locator('#qsar-compounds button[data-cid]').first();
  if (await linked.count()) {
    await page.locator('#qsar-compound-summary').click();
    const cid = Number(await linked.getAttribute('data-cid'));
    await linked.click();
    await expect(page.locator('#qsar-dialog')).not.toBeVisible();
    expect(await page.evaluate(() => window.__hansch.app.drugs[window.__hansch.app.selected].cid)).toBe(cid);
    await expect(page.locator('#d-qsar')).toContainText('DRD2 Ki QSAR');
  }
  expect(errors).toEqual([]);
});

test('QSAR reports missing data and retries without replacing it with invented values', async ({ page }) => {
  let fail = true;
  await page.route('**/data/qsar_drd2.json', async route => fail ? route.fulfill({ status: 404, body: '' }) : route.continue());
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('#stage-status')?.hidden === true);
  await page.locator('#qsar-open').click();
  await expect(page.locator('#qsar-status')).toContainText('unavailable');
  await expect(page.locator('#qsar-body')).toBeHidden();
  fail = false;
  await page.locator('#qsar-retry').click();
  await expect(page.locator('#qsar-body')).toBeVisible();
});
