// lod.spec.mjs - sphere LOD (10 x 7 segments) and instance compaction: the drawn instances are the visible drugs,
// compacted to the front (points.count == visible), and everything that works by drug index still does: picking, hover
// scale, the selection ring, recolouring.
import { expect, test } from '@playwright/test';
import { CONTEXT } from '../helpers/snapshot.mjs';
import { hideOverlays, openReady, quiet } from '../helpers/probes.mjs';

const state = page => page.evaluate(() => {
  const { stage, app, anim } = window.__hansch, n = stage.points.count;
  // every drawn slot maps to a distinct, visible drug; every visible drug has exactly one slot
  const slots = Array.from({ length: n }, (_, s) => stage.drugAt[s]);
  const visible = new Set(app.visible.map(d => app.drugs.indexOf(d)));
  return {
    count: n, visible: app.visible.length, distinct: new Set(slots).size, allVisible: slots.every(i => visible.has(i)),
    inverse: slots.every((i, s) => stage.slotOf[i] === s), hiddenUnmapped: app.drugs.every((_, i) => visible.has(i) || stage.slotOf[i] === -1),
    allScaled: slots.every(i => anim.cur[i * 4 + 3] > 0.99), t: anim.t,
  };
});
const renderTris = page => page.evaluate(() => { const { stage } = window.__hansch; stage.loop.renderNow(); return { tris: stage.renderer.info.render.triangles, calls: stage.renderer.info.render.calls, geo: stage.points.geometry.parameters }; });

test.describe('sphere LOD and instance compaction', () => {
  test.setTimeout(240_000);
  let page, ctx;
  test.beforeEach(async ({ browser, baseURL }) => {
    ctx = await browser.newContext(CONTEXT);
    page = await ctx.newPage();
    await openReady(page, baseURL);
  });
  test.afterEach(() => ctx.close());

  test('spheres are 10 x 7 and the triangles per frame stay <= 100k in every tour step', async () => {
    const seen = {};
    for (const step of ['space', 'structure', 'logp', 'mr', 'tpsa', 'activity', 'series', 'all']) {
      await page.evaluate(s => window.__hansch.goStep(s), step);
      await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
      await quiet(page, 500);
      const r = await renderTris(page);
      seen[step] = r.tris;
      expect(r.geo.widthSegments).toBe(10);
      expect(r.geo.heightSegments).toBe(7);
      expect(r.tris, `triangles in step ${step}`).toBeLessThanOrEqual(100_000);
      expect(r.calls, `draw calls in step ${step}`).toBeLessThanOrEqual(10);
    }
    // 120 triangles per sphere, so 759 spheres are 91 080 and the series step (a handful of drugs) is tiny
    expect(seen.space).toBeGreaterThanOrEqual(759 * 120);
    expect(seen.series, 'series step: only the visible drugs are drawn').toBeLessThan(20_000);
  });

  test('points.count equals the visible drugs after every step, filter and size change; slots map back to distinct visible drugs', async () => {
    const actions = [
      ['step logp (small only)', () => window.__hansch.goStep('logp')],
      ['step series', () => window.__hansch.goStep('series')],
      ['step all', () => window.__hansch.goStep('all')],
      ['ATC N filter', () => window.__hansch.setView({ l1: 'N', l2: '', l3: '', route: '', group: null, small: false, x: 'logp', y: 'tpsa', z: 'mr', color: 'atc', veber: false })],
      ['ATC N05 + oral', () => window.__hansch.setView({ l1: 'N', l2: 'N05', route: 'ORAL' })],
      ['back to everything', () => window.__hansch.setView({ l1: '', l2: '', l3: '', route: '', group: null, small: false, x: 'pc1', y: 'pc2', z: 'pc3' })],
      ['flat axis + size filter', () => window.__hansch.setView({ x: 'mw', y: 'none', z: 'jitter', small: true })],
    ];
    for (const [name, fn] of actions) {
      await page.evaluate(fn);
      await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
      await quiet(page, 400);
      const s = await state(page);
      expect(s.count, `${name}: count == visible`).toBe(s.visible);
      expect(s.distinct, `${name}: one slot per drug`).toBe(s.count);
      expect(s.allVisible && s.inverse && s.hiddenUnmapped, `${name}: slot maps consistent`).toBe(true);
      expect(s.allScaled, `${name}: every drawn instance is full size`).toBe(true);
    }
  });

  test('during a layout tween the drawn set is the union of the old and new visible drugs, and it shrinks to the visible ones at the end', async () => {
    await page.evaluate(() => window.__hansch.goStep('series'));       // 8 drugs
    await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
    await quiet(page, 400);
    const small = await state(page);
    expect(small.count).toBeLessThan(20);
    await page.evaluate(() => window.__hansch.goStep('space'));        // 759 drugs grow in
    const mid = await page.evaluate(() => ({ t: window.__hansch.anim.t, count: window.__hansch.stage.points.count }));
    expect(mid.t).toBeLessThan(1);
    expect(mid.count, 'new drugs get a slot at once, so they can grow in').toBe(759);
    await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
    await page.evaluate(() => window.__hansch.goStep('series'));       // and out again
    const out = await page.evaluate(() => window.__hansch.stage.points.count);
    expect(out, 'drugs that shrink away are still drawn while they shrink').toBeGreaterThan(small.count);
    await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
    await quiet(page, 500);
    const end = await state(page);
    expect(end.count).toBe(end.visible);
  });

  test('picking: the sphere under the pointer is the drug that was aimed at, in a compacted view (20 random drugs)', async () => {
    // a filter that reorders the slots (drug index != slot), then aim at 20 isolated drugs by projected position
    await page.evaluate(() => window.__hansch.setView({ x: 'ts1', y: 'none', z: 'ts2', color: 'atc', l1: '', l2: '', l3: '', route: 'ORAL', group: null, small: false, veber: false }));
    await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
    await page.evaluate(() => window.__hansch.camTo([0, 37, 3], { instant: true }));
    await quiet(page, 600);
    const targets = await page.evaluate(() => {
      const { app, anim, stage, THREE } = window.__hansch, r = document.querySelector('#space').getBoundingClientRect(), v = new THREE.Vector3(), pts = [];
      app.drugs.forEach((d, i) => {
        if (anim.cur[i * 4 + 3] < 0.5) return;
        v.set(anim.cur[i * 4], anim.cur[i * 4 + 1], anim.cur[i * 4 + 2]).project(stage.camera);
        if (Math.abs(v.x) > 0.9 || Math.abs(v.y) > 0.9 || v.z > 1) return;
        pts.push({ i, x: (v.x * 0.5 + 0.5) * r.width + r.left, y: (-v.y * 0.5 + 0.5) * r.height + r.top });
      });
      const iso = pts.filter(p => pts.every(q => q === p || Math.hypot(p.x - q.x, p.y - q.y) > 12));
      // a deterministic shuffle so a failure reproduces
      let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      for (let k = iso.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [iso[k], iso[j]] = [iso[j], iso[k]]; }
      return { total: pts.length, picks: iso.slice(0, 20).map(p => ({ ...p, slot: stage.slotOf[p.i], name: app.drugs[p.i].name })) };
    });
    expect(targets.picks.length, `isolated drugs available (of ${targets.total} visible)`).toBeGreaterThanOrEqual(15);
    expect(targets.picks.some(p => p.slot !== p.i), 'the view really is compacted (some slot differs from its drug index)').toBe(true);
    for (const p of targets.picks) {
      await page.mouse.move(p.x - 30, p.y - 30);
      await page.mouse.move(p.x, p.y);
      await page.waitForFunction(i => window.__hansch.app.hover === i, p.i, { timeout: 10_000 }).catch(() => {});
      const got = await page.evaluate(() => window.__hansch.app.hover);
      expect(got, `hover at the projection of ${p.name} (slot ${p.slot}, index ${p.i})`).toBe(p.i);
      expect(await page.evaluate(() => document.querySelector('#tooltip').textContent)).toContain(p.name.charAt(0).toUpperCase() + p.name.slice(1));
    }
    // clicking selects that drug, and the ring sits on it
    const p = targets.picks[0];
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(i => window.__hansch.app.selected === i, p.i, { timeout: 10_000 });
    await quiet(page, 500);
    const ring = await page.evaluate(i => { const { stage, anim } = window.__hansch; return { visible: stage.ring.visible, d: stage.ring.position.distanceTo({ x: anim.cur[i * 4], y: anim.cur[i * 4 + 1], z: anim.cur[i * 4 + 2], isVector3: true }) , label: stage.selLabel.visible }; }, p.i);
    expect(ring.visible && ring.label).toBe(true);
    expect(ring.d).toBeLessThan(1e-3);
  });

  test('hover and selection scale the right instance (1.7x and 1.35x), whatever its slot', async () => {
    await page.evaluate(() => window.__hansch.setView({ l1: 'C', x: 'pc1', y: 'pc2', z: 'pc3' }));
    await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
    const r = await page.evaluate(() => {
      const { stage, app } = window.__hansch, i = app.drugs.indexOf(app.visible[Math.floor(app.visible.length / 2)]);
      const scaleAt = idx => stage.points.instanceMatrix.array[stage.slotOf[idx] * 16];
      return { i, slot: stage.slotOf[i], base: scaleAt(i) };
    });
    expect(r.slot).toBeGreaterThanOrEqual(0);
    await page.evaluate(i => { const { app, stage } = window.__hansch; app.hover = i; stage.dirty.inst = true; stage.loop.renderNow(); }, r.i);
    expect(await page.evaluate(([i]) => { const { stage } = window.__hansch; return stage.points.instanceMatrix.array[stage.slotOf[i] * 16]; }, [r.i])).toBeCloseTo(r.base * 1.7, 4);
    await page.evaluate(i => { const { app, stage } = window.__hansch; app.hover = -1; app.selected = i; stage.dirty.inst = true; stage.loop.renderNow(); }, r.i);
    expect(await page.evaluate(([i]) => { const { stage } = window.__hansch; return stage.points.instanceMatrix.array[stage.slotOf[i] * 16]; }, [r.i])).toBeCloseTo(r.base * 1.35, 4);
  });

  test('recolour goes to the drawn slots: a colour-mode change repaints the compacted instances by drug', async () => {
    await page.evaluate(() => window.__hansch.setView({ l1: 'N', color: 'ro5', x: 'logp', y: 'tpsa', z: 'mr' }));
    await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
    await quiet(page, 400);
    const bad = await page.evaluate(() => {
      const { stage, app, THREE } = window.__hansch, c = new THREE.Color(), got = new THREE.Color(); let wrong = 0;
      for (let s = 0; s < stage.points.count; s++) {
        stage.points.getColorAt(s, got);
        const d = app.drugs[stage.drugAt[s]], T = app.tokens, ro5 = d.d.ro5;
        c.set(ro5 == null ? T.point : T[['q2', 'q4', 'q5'][Math.min(2, ro5)]]);
        if (Math.abs(c.r - got.r) + Math.abs(c.g - got.g) + Math.abs(c.b - got.b) > 0.01) wrong++;
      }
      return wrong;
    });
    expect(bad).toBe(0);
  });

  test('extras and the molecule viewer still work by drug index (Veber plane, fit surface, conformer of a compacted pick)', async () => {
    await page.evaluate(() => window.__hansch.goStep('tpsa'));
    await page.waitForFunction(() => window.__hansch.anim.t >= 1 && window.__hansch.stage.extras.children.length > 0, null, { timeout: 30_000 });
    await page.evaluate(() => window.__hansch.goStep('series'));
    await page.waitForFunction(() => window.__hansch.anim.t >= 1 && window.__hansch.stage.extras.children.length >= 3, null, { timeout: 30_000 });
    const name = await page.evaluate(() => window.__hansch.app.visible[0].name);
    await page.evaluate(() => window.__hansch.selectDrug(window.__hansch.app.visible[0].cid));
    await page.waitForFunction(() => window.__hansch.molv.group, null, { timeout: 30_000 });
    await expect(page.locator('#d-name')).toHaveText(name);
  });

  test('shader programs are pre-warmed at boot: the Veber plane, the fitted surface and the selection ring compile nothing new', async () => {
    const programs = () => page.evaluate(() => window.__hansch.stage.renderer.info.programs.length);
    const boot = await programs();
    await page.evaluate(() => window.__hansch.goStep('tpsa'));
    await page.waitForFunction(() => window.__hansch.anim.t >= 1 && window.__hansch.stage.extras.children.length > 0, null, { timeout: 30_000 });
    await quiet(page, 400);
    expect(await programs(), 'the first TPSA step (Veber plane + edge) used to compile two programs on the spot').toBe(boot);
    await page.evaluate(() => window.__hansch.selectDrug(window.__hansch.app.visible[0].cid));     // the selection ring
    await page.waitForFunction(() => window.__hansch.stage.ring.visible, null, { timeout: 30_000 });
    await quiet(page, 400);
    await page.evaluate(() => window.__hansch.goStep('series'));                                    // surface, wireframe, residual sticks
    await page.waitForFunction(() => window.__hansch.anim.t >= 1 && window.__hansch.stage.extras.children.length >= 3, null, { timeout: 30_000 });
    await quiet(page, 400);
    expect(await programs()).toBe(boot);
  });

  test('a selected drug that a filter leaves out loses its ring and gets a note in the panel (D23)', async () => {
    await page.fill('#search', 'dexamethasone');
    await page.press('#search', 'Enter');
    await page.waitForFunction(() => window.__hansch.app.selected >= 0 && window.__hansch.stage.ring.visible, null, { timeout: 20_000 });
    await page.evaluate(() => window.__hansch.setView({ l1: 'N' }));      // dexamethasone is not an N drug
    await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
    await quiet(page, 400);
    expect(await page.evaluate(() => window.__hansch.stage.ring.visible)).toBe(false);
    await expect(page.locator('#d-note')).toContainText('not in the current view');
    await page.evaluate(() => window.__hansch.setView({ l1: '' }));
    await page.waitForFunction(() => window.__hansch.anim.t >= 1, null, { timeout: 30_000 });
    await expect(page.locator('#d-note')).toHaveText('');
  });
});
