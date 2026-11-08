import { test, expect } from '@playwright/test';

async function openRanked(page) {
  await page.goto('/?debug');
  await page.waitForFunction(() => window.__hansch?.app.tiReady);
  await expect(page.locator('#ti-rank-style')).toHaveCount(0);
  await page.click('#ti-open');
  await expect(page.locator('#ti-rows tr').first()).toBeVisible();
  await expect(page.locator('#ti-rank-style')).toHaveCount(1);
  return page.getByRole('region', { name: 'Ranked molecules', exact: true });
}

test('ranked endpoints retain molecule identity during horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const wrap = await openRanked(page);
  const identity = page.locator('#ti-rows tr').first().getByRole('rowheader');
  const name = await identity.innerText();
  await expect(identity).toHaveCSS('position', 'sticky');
  await wrap.evaluate(el => { el.scrollLeft = el.scrollWidth - el.clientWidth; });
  const bounds = await identity.boundingBox(), viewport = await wrap.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(viewport.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.x + viewport.width);
  await expect(identity).toHaveText(name);
  await expect(identity.locator('.ti-rank-target-key')).toContainText(/CHEMBL\d+ · (recorded|inferred|ambiguous)/);
  await expect(page.locator('#ti-rows tr').first().locator('[data-label="hERG"] .small')).not.toBeEmpty();
  await page.selectOption('#ti-filter', 'measured');
  for (const row of await page.locator('#ti-rows tr').all()) {
    await expect(row.getByRole('rowheader')).not.toBeEmpty();
    await expect(row.locator('[data-label="Activity"]')).toContainText('measured aggregate');
    await expect(row.locator('[data-label="hERG"]')).toContainText('measured aggregate');
  }
  expect(errors).toEqual([]);
});

test('@mobile ranked rows expose every field and source without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const wrap = await openRanked(page);
  await expect(page.locator('#ti-rows tr').first()).toHaveCSS('display', 'grid');
  const widths = await wrap.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  const row = page.locator('#ti-rows tr').first();
  await expect(row.getByRole('rowheader')).not.toBeEmpty();
  await expect(row.getByRole('rowheader')).toHaveCSS('position', 'static');
  await expect(row.getByRole('rowheader')).toHaveCSS('max-width', 'none');
  for (const label of ['Rank in target', 'Target', 'Activity', 'hERG', 'Index', 'Domain']) {
    await expect(row.locator(`[data-label="${label}"]`)).not.toBeEmpty();
  }
  await expect(row.locator('[data-label="Activity"] .small')).not.toBeEmpty();
  await expect(row.locator('[data-label="hERG"] .small')).not.toBeEmpty();
  await page.selectOption('#ti-filter', 'series');
  await expect(page.locator('#ti-rows')).toContainText('Hansch series');
  await expect(page.locator('#ti-rows tr').first().getByRole('rowheader')).not.toBeEmpty();
});
