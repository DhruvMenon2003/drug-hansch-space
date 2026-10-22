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

test('QSAR records can be searched and filtered, then inspected in the frozen training equation @mobile', async ({ page }) => {
  const exported = readData();
  const drugs = JSON.parse(readFileSync(new URL('../../site/data/drugs.json', import.meta.url), 'utf8')).drugs;
  const drug = drugs.find(d => d.name === 'amisulpride');
  const compound = exported.compounds.find(p => p.pubchem_cid === drug.cid);
  await open(page);
  for (const text of ['195 training', '6.78353846', '55 held-out', '1.2139731436', '1.2564908302', 'Lower RMSE is better', 'does not beat'])
    await expect(page.locator('#qsar-baseline')).toContainText(text);
  await expect(page.locator('#qsar-baseline a')).toHaveAttribute('href', /944a7e8717ea6bf85815cb1fa103bcd2c4ca2fd4\/curation\/results\/hansch_drd2\/predictions.csv$/);
  await page.locator('#qsar-compound-summary').click();
  await expect(page.locator('#qsar-record-count')).toContainText(`Showing ${exported.n} of ${exported.n}`);
  await page.locator('#qsar-search').fill(compound.inchikey.slice(0, 10).toLowerCase());
  await expect(page.locator('#qsar-compounds tr')).toHaveCount(1);
  await page.locator('#qsar-search').fill(drug.name.toUpperCase());
  await expect(page.locator('#qsar-compounds')).toContainText(compound.inchikey);
  await page.locator('#qsar-search').fill(`CID ${compound.pubchem_cid}`);
  await expect(page.locator('#qsar-compounds')).toContainText(compound.inchikey);
  await page.locator('#qsar-search').fill('no-such-chemical-record');
  await expect(page.locator('#qsar-compounds tr')).toHaveCount(0);
  await expect(page.locator('#qsar-no-matches')).toBeVisible();
  await page.locator('#qsar-reset-filters').click();
  await expect(page.locator('#qsar-search')).toBeFocused();
  await page.locator('#qsar-split-filter').selectOption('test');
  await page.locator('#qsar-domain-filter').selectOption('outside');
  const selected = exported.compounds.filter(p => p.split === 'test' && p.outside_domain);
  await expect(page.locator('#qsar-compounds tr')).toHaveCount(selected.length);
  await expect(page.locator('#qsar-record-count')).toContainText(`Showing ${selected.length} of ${exported.n}`);
  await expect(page.locator('#qsar-prediction .qsar-point')).toHaveCount(exported.n);
  await page.locator('#qsar-reset-filters').click();
  await expect(page.locator('#qsar-compounds tr')).toHaveCount(exported.n);
  await page.locator('#qsar-search').fill(compound.inchikey);
  await page.locator('#qsar-compounds button[data-inspect]').click();
  await expect(page.locator('#qsar-equation-title')).toBeFocused();
  await expect(page.locator('#qsar-inspect-compound')).toHaveValue(compound.inchikey);
  await expect(page.locator('#qsar-equation-terms tr')).toHaveCount(exported.training_coefficients.length);
  await expect(page.locator('#qsar-equation-result')).toContainText('full-precision sum matches');
  await expect(page.locator('#qsar-equation-terms')).toContainText('Å²');
  await expect(page.locator('#qsar-equation-terms')).toContainText('Da');
  await expect(page.locator('#qsar-equation-inspector')).toContainText('not causal or mechanistic effects');
  await expect(page.locator('#qsar-equation-terms tr').filter({ has: page.getByRole('rowheader', { name: 'HBD', exact: true }) }).locator('td').first()).toHaveText('2');
  await expect(page.locator('#qsar-equation-terms tr').filter({ has: page.getByRole('rowheader', { name: 'HBA', exact: true }) }).locator('td').first()).toHaveText('6');
  for (const text of ['NumHDonors', 'CalcNumHBD', 'NumHAcceptors', 'CalcNumHBA', 'CalcNumLipinskiHBD', 'CalcNumLipinskiHBA'])
    await expect(page.locator('#qsar-hbond-method')).toContainText(text);
  for (const split of ['train', 'test']) for (const outside of [true, false]) {
    const record = exported.compounds.find(p => p.split === split && p.outside_domain === outside);
    await page.locator('#qsar-inspect-compound').selectOption(record.inchikey);
    const context = page.locator('#qsar-equation-context');
    await expect(context).toContainText(`${split === 'test' ? 'Held-out test' : 'Training'} record`);
    await expect(context).toContainText(`stored domain flag: ${outside ? 'Outside' : 'Within'} applicability domain`);
    await expect(context).toContainText(`Leverage ${Number(record.leverage.toPrecision(6))}`);
    await expect(context).toContainText(`warning threshold h* = ${Number(exported.applicability_domain.threshold.toPrecision(6))}`);
    await expect(context).toContainText(`Standardized residual ${Number(record.standardized_residual.toPrecision(6))}`);
    await expect(context).toContainText(`limit ±${exported.applicability_domain.standardized_residual_limit}`);
    await expect(context).toContainText('not predictive');
    await expect(context).toContainText('arithmetic match do not establish prediction reliability');
  }
  await page.locator('#qsar-inspect-compound').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.locator('#qsar-equation-context')).toHaveText('No valid dataset record is selected. Applicability-domain diagnostics are unavailable.');
  await expect(page.locator('#qsar-equation-result')).toContainText('unavailable');
  await expect(page.locator('#qsar-equation-terms tr')).toHaveCount(0);
  await page.locator('#qsar-inspect-compound').selectOption(compound.inchikey);
  await expect(page.locator('#qsar-equation-terms tr')).toHaveCount(exported.training_coefficients.length);
  await page.locator('#qsar-workflow > summary').click();
  await expect(page.locator('#qsar-workflow')).toContainText('Every training fold repeats descriptor selection');
  await expect(page.locator('#qsar-workflow-outcome')).toContainText('not predictive');
  await expect(page.locator('#qsar-workflow a').first()).toHaveAttribute('href', /f026e2dcac2f5fe6688387c6764e0aef3f43d7de\/curation\/hansch_drd2.ipynb$/);
  expect(await page.locator('#qsar-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).include('#qsar-dialog').analyze();
  expect(results.violations.filter(v => ['critical', 'serious'].includes(v.impact))).toEqual([]);
  await page.locator('#qsar-compounds button[data-cid]').click();
  const sheetHandle = page.locator('#sheet-handle');
  if (await sheetHandle.isVisible() && await page.locator('#detail').getAttribute('data-sheet') === 'peek') {
    await sheetHandle.click();
    await expect(sheetHandle).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(page.locator('#d-desc div').filter({ hasText: 'N/O-bound hydrogens · Lipinski count' }).locator('dd')).toHaveText('3');
  await expect(page.locator('#d-desc div').filter({ hasText: 'N + O atoms · Lipinski count' }).locator('dd')).toHaveText('7');
  await expect(page.locator('#d-hbond-method')).toBeVisible();
  await expect(page.locator('#d-hbond-method')).toContainText('3/7 here and 2/6 in the QSAR');
});
