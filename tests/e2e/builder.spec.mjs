import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

const index = JSON.parse(readFileSync(new URL('../../site/data/qsar/index.json', import.meta.url), 'utf8'));
async function open(page) {
  await page.goto('/?debug');
  await page.waitForFunction(() => document.querySelector('#stage-status')?.hidden === true);
  await page.locator('#qsb-open').click();
  await expect(page.locator('#qsb-body')).toBeVisible();
}

test('the QSAR builder walks every OECD step for a target on the home page @mobile', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await open(page);
  expect(new URL(page.url()).pathname).toBe('/');
  const usable = index.targets.filter(t => t.file);
  await expect(page.locator('#qsb-target option')).toHaveCount(usable.length);
  await expect(page.locator('#qsb-ledger tr')).toHaveCount(8);
  await expect(page.locator('#qsb-hist rect')).toHaveCount(14);
  await page.locator('#qsb-col').selectOption('tpsa');
  await expect(page.locator('#qsb-hist-cap')).toContainText('TPSA');
  await page.locator('#qsb-t-out').click();
  await expect(page.locator('#qsb-p-out')).toBeVisible();
  await expect(page.locator('#qsb-kept')).toContainText('compounds kept');
  await page.locator('#qsb-t-split').click();
  await page.locator('#qsb-split').selectOption('ks');
  await expect(page.locator('#qsb-split-note')).toContainText('training');
  await page.locator('#qsb-t-model').click();
  await expect(page.locator('#qsb-metrics tr')).toHaveCount(10);
  await expect(page.locator('#qsb-eq')).toContainText('logP²');
  await page.locator('#qsb-t-ad').click();
  expect(await page.locator('#qsb-will .qsar-point').count()).toBeGreaterThan(10);
  const download = page.waitForEvent('download');
  await page.locator('#qsb-export').click();
  const recipe = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  expect(recipe.split.method).toBe('ks');
  expect(recipe.target.id).toBe(usable[0].id);
  expect(await page.locator('#qsb-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).include('#qsb-dialog').analyze();
  expect(results.violations.filter(v => ['critical', 'serious'].includes(v.impact))).toEqual([]);
  expect(errors).toEqual([]);
});
