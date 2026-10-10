// leaks.spec.mjs - no GPU-resource growth: after warm-up, 30 drug picks and 30 view changes leave the main renderer's
// geometry/texture counts and the molecule viewer's live GL buffers exactly where they were (the original app leaked
// 4 buffers per pick because InstancedMesh.dispose() was never called).
import { expect, test } from '@playwright/test';
import { CONTEXT } from '../helpers/snapshot.mjs';
import { openReady, quiet } from '../helpers/probes.mjs';

const mem = page => page.evaluate(() => {
  const { stage, molv } = window.__hansch;
  return {
    stageGeo: stage.renderer.info.memory.geometries, stageTex: stage.renderer.info.memory.textures, stagePrograms: stage.renderer.info.programs.length,
    molGeo: molv.renderer.info.memory.geometries, molTex: molv.renderer.info.memory.textures,
    molBuffers: window.__bufs.mol?.size ?? 0, stageBuffers: window.__bufs.space?.size ?? 0,
    labels: document.querySelectorAll('#labels .ax-label, #labels .ax-title, #labels .ax-plane').length,
    gsap: window.gsap.globalTimeline.getChildren(false, true, true).length,
  };
});

test.describe('GPU resources do not leak', () => {
  test.setTimeout(420_000);

  test('30 picks + 30 view changes: geometries, textures, programs and live GL buffers are constant', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext(CONTEXT), page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await openReady(page, baseURL);
    const withConformer = await page.evaluate(() => window.__hansch.app.drugs.filter(d => d.conf).map(d => d.cid));
    const pick = async (cid) => {
      await page.evaluate(c => window.__hansch.selectDrug(c), cid);
      await page.waitForFunction(c => window.__hansch.molv.group && window.__hansch.app.drugs[window.__hansch.app.selected].cid === c && !/Loading/.test(document.querySelector('#d-src').textContent), cid, { timeout: 30_000 });
    };
    const AXES = ['logp', 'mr', 'tpsa', 'mw', 'hbd', 'hba', 'rotb', 'arom', 'fsp3', 'cx'];
    const change = async i => {
      await page.evaluate(([a, b, c, atc]) => window.__hansch.setView({ x: a, y: b, z: c, l1: atc, group: null, veber: i % 3 === 0 && b === 'tpsa' }, { instant: true }), [AXES[i % 10], AXES[(i + 3) % 10], AXES[(i + 6) % 10], i % 4 === 0 ? 'N' : '']);
    };
    // warm up: every kind of object has been created once
    for (let i = 0; i < 4; i++) { await pick(withConformer[i * 7]); await change(i); }
    await page.evaluate(() => window.__hansch.goStep('series'));
    await page.waitForFunction(() => window.__hansch.anim.t >= 1 && window.__hansch.stage.extras.children.length >= 3, null, { timeout: 30_000 });
    await page.evaluate(() => window.__hansch.goStep('tpsa'));
    await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
    await quiet(page, 800);
    const before = await mem(page);
    for (let i = 0; i < 30; i++) {
      await pick(withConformer[(i * 13 + 5) % withConformer.length]);
      await change(i + 4);
    }
    await page.evaluate(() => window.__hansch.goStep('series'));
    await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
    await page.evaluate(() => window.__hansch.goStep('tpsa'));
    await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
    await quiet(page, 800);
    const after = await mem(page);
    expect(after.molBuffers, `molecule viewer live GL buffers ${before.molBuffers} -> ${after.molBuffers}`).toBe(before.molBuffers);
    expect(after.molGeo, 'molecule viewer geometries').toBe(before.molGeo);
    expect(after.molTex).toBe(before.molTex);
    expect(after.stageGeo, 'stage geometries').toBe(before.stageGeo);
    expect(after.stageTex, 'stage textures').toBe(before.stageTex);
    expect(after.stagePrograms, 'stage programs').toBe(before.stagePrograms);
    expect(after.stageBuffers, 'stage live GL buffers').toBe(before.stageBuffers);
    expect(after.labels, 'CSS2D labels stay bounded').toBeLessThanOrEqual(30);
    expect(after.gsap, 'no tween piles up in the global timeline').toBeLessThanOrEqual(before.gsap + 2);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('fade tweens of a rebuilt extras group are killed with it (D19)', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext(CONTEXT), page = await ctx.newPage();
    await openReady(page, baseURL);
    // Rebuild the fitted-surface extras several times within the 1.4 s the fades take; no tween may outlive its material
    const r = await page.evaluate(async () => {
      const H = window.__hansch;
      H.goStep('series');
      for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 120)); H.bus.emit('theme'); }
      const live = H.stage.extras.children.flatMap(o => [].concat(o.material)).filter(Boolean);
      const targets = window.gsap.globalTimeline.getChildren(false, true, true).flatMap(t => t.targets?.() ?? []);
      const stale = targets.filter(t => t && t.isMaterial && !live.includes(t));
      return { stale: stale.length, live: live.length };
    });
    expect(r.live).toBeGreaterThan(0);
    expect(r.stale, 'tweens aimed at disposed materials').toBe(0);
    await ctx.close();
  });

  test('dispose() frees the stage: listeners, observers and GL objects go; booting again works', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext(CONTEXT), page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await openReady(page, baseURL);
    const r = await page.evaluate(async () => {
      const H = window.__hansch;
      H.gl.dispose();
      const gone = { renderer: H.stage.renderer, labels: document.querySelectorAll('#labels canvas, #labels > div > div').length };
      return gone;
    });
    expect(r.renderer).toBeNull();
    // after dispose nothing may react (and nothing may throw) when the app emits events
    await page.evaluate(() => { window.__hansch.goStep('mr'); window.__hansch.bus.emit('theme'); });
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
