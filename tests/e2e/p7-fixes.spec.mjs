// p7-fixes.spec.mjs - the cheap defect fixes of stage S2a stay fixed, each guarded by the behaviour it changed:
//   D21 search runs once (Enter and the later blur-"change" must not select twice) and tells the user when nothing matches
//   D22 table rows use aria-current (aria-selected is not valid on a table row)
//   D23 hover is cleared when a layout moves the spheres; a selected drug that is filtered out gets a note
//   R8  the live region (#sr-live) says what was selected, what was not found, and what is not in the current view
// The tour-line fix (UX-08) is swept at 320x568 in tour-scroll.spec.mjs.
import { expect, test } from '@playwright/test';
import { CONTEXT } from '../helpers/snapshot.mjs';
import { openReady, quiet } from '../helpers/probes.mjs';

test.describe('P7 fixes', () => {
  test.setTimeout(120_000);
  let ctx, page;
  test.beforeEach(async ({ browser, baseURL }) => {
    ctx = await browser.newContext(CONTEXT);
    page = await ctx.newPage();
    await openReady(page, baseURL);
  });
  test.afterEach(() => ctx.close());

  const selections = () => page.evaluate(() => window.__sel.length);
  const countSelections = () => page.evaluate(() => { window.__sel = []; window.__hansch.bus.on('selection', e => window.__sel.push(e.cid)); });

  test('D21: Enter selects once even though the input fires "change" on blur afterwards; typing and leaving selects once too', async () => {
    await countSelections();
    await page.fill('#search', 'caffeine');
    await page.press('#search', 'Enter');
    await page.waitForFunction(() => window.__sel.length >= 1);
    await page.locator('#search').blur();                      // the browser's "change" event arrives here
    await page.waitForTimeout(400);
    expect(await selections(), 'Enter + blur = one selection, not two').toBe(1);
    await page.fill('#search', 'dexamethasone');
    await page.locator('#search').blur();                      // no Enter: the change event alone must search
    await page.waitForFunction(() => window.__sel.length >= 2);
    await page.waitForTimeout(400);
    expect(await selections(), 'a blur without Enter = one selection').toBe(2);
    // the same text again after a different one searches again (the consumed query is forgotten)
    await page.fill('#search', 'caffeine');
    await page.press('#search', 'Enter');
    await page.locator('#search').blur();
    await page.waitForFunction(() => window.__sel.length >= 3);
    await page.waitForTimeout(400);
    expect(await selections()).toBe(3);
  });

  test('D21: a name that matches nothing says so next to the box and marks the input invalid; typing clears it', async () => {
    await page.fill('#search', 'zzzznotadrug');
    await page.press('#search', 'Enter');
    await expect(page.locator('#search-note')).toContainText('No drug named');
    expect(await page.locator('#search').getAttribute('aria-invalid')).toBe('true');
    await page.locator('#search').pressSequentially('x');
    await expect(page.locator('#search-note')).toBeHidden();
    expect(await page.locator('#search').getAttribute('aria-invalid')).toBeNull();
  });

  test('D22: the selected table row carries aria-current="true"; no row carries aria-selected', async () => {
    await page.evaluate(() => { document.querySelector('#table-details').open = true; });
    await page.waitForFunction(() => document.querySelectorAll('#table tbody tr').length > 0);
    await page.evaluate(() => { const H = window.__hansch; H.selectDrug(H.app.visible[3].cid); });
    await expect(page.locator('#table tbody tr[aria-current="true"]')).toHaveCount(1);
    await expect(page.locator('#table [aria-selected]')).toHaveCount(0);
    const first = await page.evaluate(() => document.querySelector('#table tbody tr[aria-current="true"]').dataset.cid);
    await page.evaluate(() => { const H = window.__hansch; H.selectDrug(H.app.visible[5].cid); });
    await expect(page.locator('#table tbody tr[aria-current="true"]')).toHaveCount(1);
    expect(await page.evaluate(() => document.querySelector('#table tbody tr[aria-current="true"]').dataset.cid), 'the mark moves with the selection').not.toBe(first);
    await expect(page.locator('#table [aria-selected]')).toHaveCount(0);
  });

  test('D23: a hovered sphere and its tooltip are forgotten when a layout moves the spheres', async () => {
    await quiet(page, 500);
    const target = await page.evaluate(() => {
      const { app, anim, stage, THREE } = window.__hansch, r = document.querySelector('#space').getBoundingClientRect(), v = new THREE.Vector3(), pts = [];
      app.drugs.forEach((d, i) => {
        if (anim.cur[i * 4 + 3] < 0.5) return;
        v.set(anim.cur[i * 4], anim.cur[i * 4 + 1], anim.cur[i * 4 + 2]).project(stage.camera);
        if (Math.abs(v.x) > 0.8 || Math.abs(v.y) > 0.8 || v.z > 1) return;
        pts.push({ i, x: (v.x * 0.5 + 0.5) * r.width + r.left, y: (-v.y * 0.5 + 0.5) * r.height + r.top });
      });
      return pts.find(p => pts.every(q => q === p || Math.hypot(p.x - q.x, p.y - q.y) > 14));
    });
    expect(target, 'an isolated drug on screen').toBeTruthy();
    await page.mouse.move(target.x - 30, target.y - 30);
    await page.mouse.move(target.x, target.y);
    await page.waitForFunction(i => window.__hansch.app.hover === i && !document.querySelector('#tooltip').hidden, target.i, { timeout: 15_000 });
    await page.evaluate(() => window.__hansch.setView({ x: 'mw' }, { instant: true }));           // every sphere moves; the pointer does not
    await page.waitForFunction(() => window.__hansch.app.hover === -1 && document.querySelector('#tooltip').hidden, null, { timeout: 15_000 });
    expect(await page.evaluate(() => document.querySelector('#space').style.cursor), 'the pointer cursor goes with it').toBe('');
  });

  test('R8: the live region announces a selection, a failed search, and a drug the view leaves out', async () => {
    const live = page.locator('#sr-live');
    // selection: name, log P and TPSA
    await page.fill('#search', 'dexamethasone');
    await page.press('#search', 'Enter');
    await expect(live).toHaveText(/^Selected Dexamethasone\. log P -?\d+\.\d, TPSA \d+\.$/, { timeout: 8000 });
    // a filter that leaves the selected drug out (layout path)
    await page.evaluate(() => window.__hansch.setView({ l1: 'N' }, { instant: true }));
    await expect(live).toHaveText('Dexamethasone is not in the current view.', { timeout: 8000 });
    // selecting a drug that is already outside the view (selection path): ONE message with both facts
    const outside = await page.evaluate(() => { const H = window.__hansch, d = H.app.drugs.find(x => !H.app.visible.includes(x)); H.selectDrug(d.cid); return d.name; });
    await expect(live).toHaveText(new RegExp(`^Selected ${outside.charAt(0).toUpperCase()}${outside.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\..* is not in the current view\\.$`, 'i'), { timeout: 8000 });
    // a name that matches nothing
    await page.evaluate(() => window.__hansch.setView({ l1: '' }, { instant: true }));
    await page.fill('#search', 'zzzznotadrug');
    await page.press('#search', 'Enter');
    await expect(live).toHaveText('No drug named “zzzznotadrug”.', { timeout: 8000 });
    // and the region is emptied again so a screen reader does not keep an old message
    await expect(live).toHaveText('', { timeout: 8000 });
  });
});
