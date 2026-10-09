// snapshot.mjs - parity harness shared by tests/tools/make-goldens.mjs (which drives the ORIGINAL app) and
// tests/e2e/parity.spec.mjs (which drives the current site). The recipe below says WHAT to do; the golden file holds what
// the original app produced. This file contains no expected values.
//
// A snapshot is a JSON-able description of the app after a settled action: filtered/visible counts, scales, hashes of the
// layout targets, instance colours and instance matrices, the HUD texts, the table, the scene's object counts, the camera,
// the drug detail panel and the Hansch panel. Both apps expose the same debug names (original: window.__dbg, new: window.__hansch).
import { createHash } from 'node:crypto';

export const sha1 = s => createHash('sha1').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex');

/** Browser context shared by the generator and the spec, so both see the same viewport, scheme and motion settings. */
export const CONTEXT = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'no-preference' };

export const STEP_NAMES = ['space', 'structure', 'logp', 'mr', 'tpsa', 'activity', 'series', 'all'];
const RESET = { l1: '', l2: '', l3: '', route: '', small: false, group: null, veber: false };

/** Name of the debug hook the page exposes: window.__hansch (new) or window.__dbg (original), or null. */
export const hookOf = page => page.evaluate(() => (window.__hansch ? '__hansch' : window.__dbg ? '__dbg' : null));

/** Wait until the layout tween, every other running gsap tween (ScrollTrigger keeps a paused delayedCall) and the next frames are done, and a pending conformer has loaded. */
export async function settle(page, hook) {
  await page.waitForFunction(h => {
    const H = window[h];
    return H.anim.t >= 1 && (!window.gsap || window.gsap.globalTimeline.getChildren(false, true, true).every(k => k.paused()));
  }, hook, { timeout: 30_000 }).catch(() => {});
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  await page.waitForFunction(() => document.querySelector('#detail-body').hidden || document.querySelector('#d-src').textContent !== 'Loading conformer…', null, { timeout: 30_000 });
  await page.waitForTimeout(250);
}

/** Wait for the app to be ready (status line hidden, scene built). */
export async function waitReady(page, hook) {
  await page.waitForFunction(h => window[h]?.stage?.points && document.querySelector('#stage-status').hidden, hook, { timeout: 60_000 });
  await settle(page, hook);
}

// SmilesDrawer prefixes the SVG ids with 5 random characters; neutralise them so the hash is stable across runs.
const unrandom = h => { const m = h.match(/id="([A-Za-z0-9]{5})-/); return m ? h.split(m[1] + '-').join('ID-') : h; };

/** Everything observable about the current state, as plain JSON (large arrays are hashed on the node side). */
export async function snapshot(page, hook, keepRaw = false) {
  const raw = await page.evaluate(h => {
    const H = window[h], { app, anim, stage, molv } = H, $ = s => document.querySelector(s), r3 = a => Array.from(a, v => Math.round(v * 1000));
    const sc = s => (s.pseudo ? { pseudo: true } : { lo: s.lo, hi: s.hi, step: s.step, ticks: s.ticks });
    const opac = g => { const out = []; g.traverse(o => { if (o.material) for (const m of [].concat(o.material)) out.push(Math.round(m.opacity * 1000)); }); return out; };
    const sel = ['#ax-x', '#ax-y', '#ax-z', '#color-by', '#f-l1', '#f-l2', '#f-l3', '#f-route', '#h-group'].map(q => $(q).value);
    const det = app.selected >= 0 && !$('#detail-body').hidden ? {
      name: $('#d-name').textContent, ids: $('#d-ids').innerHTML, desc: $('#d-desc').innerHTML, act: $('#d-act').innerHTML, atc: $('#d-atc').innerHTML,
      flags: $('#d-flags').textContent, src: $('#d-src').textContent, depiction: $('#d-2d').innerHTML, depictionHasSvg: !!$('#d-2d svg'),
      emptyHidden: $('#detail-empty').hidden, mol: molv.group ? molv.group.children.map(c => c.count) : null,
      molDist: molv.group ? Math.round(molv.camera.position.length() * 100) : null,   // the viewer auto-rotates, so only the distance is stable
    } : null;
    return {
      step: app.step, view: JSON.parse(JSON.stringify(app.view)), selected: app.selected, hover: app.hover,
      visible: app.visible.length, scales: { x: sc(app.scales.x), y: sc(app.scales.y), z: sc(app.scales.z) },
      animT: anim.t, animTo: r3(anim.to), colors: Array.from(stage.points.instanceColor.array, v => Math.round(v * 10000)), matrices: r3(stage.points.instanceMatrix.array),
      legend: { text: $('#legend').textContent, html: $('#legend').innerHTML }, axisKey: { text: $('#axis-key').textContent, html: $('#axis-key').innerHTML },
      count: $('#count').textContent, atcWrapHidden: $('#atc-pick-wrap').hidden, selects: sel, small: $('#f-small').checked,
      chips: [...document.querySelectorAll('#atc-pick .chip')].map(c => [c.getAttribute('aria-pressed'), c.disabled, c.querySelector('.sw').style.background]),
      table: { open: $('#table-details').open, rows: document.querySelectorAll('#table tbody tr').length, text: $('#table').textContent, selectedRows: [...document.querySelectorAll('#table tbody tr[aria-selected="true"]')].map(t => t.dataset.cid) },
      scene: { axes: stage.axes.children.length, extras: stage.extras.children.length, extrasOpacity: opac(stage.extras), axesOpacity: opac(stage.axes), ring: [stage.ring.visible, stage.ring.material.color.getHexString()], selLabel: [stage.selLabel.visible, stage.selLabel.element.textContent], autoRotate: stage.controls.autoRotate },
      labels: [...document.querySelectorAll('#labels .ax-label, #labels .ax-title, #labels .ax-plane, #labels .sel-label')].map(e => [e.className, e.textContent, e.dataset.shift ?? '', e.style.translate]),
      camera: { pos: stage.camera.position.toArray().map(v => Math.round(v * 100)), target: stage.controls.target.toArray().map(v => Math.round(v * 100)), aspect: Math.round(stage.camera.aspect * 1000) },
      spin: $('#btn-spin').getAttribute('aria-pressed'),
      tooltip: { hidden: $('#tooltip').hidden, html: $('#tooltip').innerHTML, left: $('#tooltip').style.left, top: $('#tooltip').style.top, cursor: $('#space').style.cursor },
      detail: det,
      hansch: { out: $('#h-out').innerHTML, cands: $('#h-cands').innerHTML, plot: $('#h-plot').innerHTML },
      tokens: app.tokens,
    };
  }, hook);
  const { animTo, colors, matrices, detail, hansch, ...rest } = raw;
  return {
    ...(keepRaw ? { _raw: raw } : {}),
    ...rest, animToSha1: sha1(animTo), animToN: animTo.length, colorsSha1: sha1(colors), colorsN: colors.length, matricesSha1: sha1(matrices),
    detail: detail && { name: detail.name, src: detail.src, flags: detail.flags, emptyHidden: detail.emptyHidden, mol: detail.mol, molDist: detail.molDist, depictionHasSvg: detail.depictionHasSvg, depiction: sha1(unrandom(detail.depiction)), depictionLen: detail.depiction.length, html: sha1([detail.ids, detail.desc, detail.act, detail.atc]) },
    hansch: { out: sha1(hansch.out), cands: sha1(hansch.cands), plot: sha1(hansch.plot) },
    labels: sha1(rest.labels), labelsN: rest.labels.length, table: { ...rest.table, text: sha1(rest.table.text) },
    legend: { text: rest.legend.text, html: sha1(rest.legend.html) }, axisKey: { text: rest.axisKey.text, html: sha1(rest.axisKey.html) },
    chips: sha1(rest.chips), chipsN: rest.chips.length, tokens: sha1(rest.tokens),
  };
}

/** The static, data-derived copy and control contents that boot() fills in (compared once, at load). */
export function bootSnapshot(page) {
  return page.evaluate(() => {
    const $ = s => document.querySelector(s), t = s => $(s).textContent;
    return {
      tour: ['#t-pca', '#t-ts', '#t-logp', '#t-mr', '#t-tpsa', '#t-act', '#t-series-h', '#t-series', '#t-all'].map(t),
      tourEq: ['#t-series-eq', '#t-all-eq'].map(s => $(s).innerHTML), seriesTail: $('[data-step="series"] p:last-of-type').textContent,
      method: [t('#m-count'), t('#m-checks')],
      options: ['#ax-x', '#ax-y', '#ax-z', '#color-by', '#f-l1', '#f-l2', '#f-l3', '#f-route', '#h-group', '#drug-names'].map(q => [...document.querySelectorAll(q + ' option')].map(o => o.value + '|' + o.textContent)),
      chipsHtml: $('#atc-pick').innerHTML, hanschOut: $('#h-out').innerHTML, stageTop: document.documentElement.style.getPropertyValue('--stage-top'),
    };
  }).then(b => ({ ...b, options: b.options.map(o => ({ n: o.length, sha1: sha1(o) })), chipsHtml: sha1(b.chipsHtml), hanschOut: sha1(b.hanschOut) }));
}

/** Screen position (page coordinates) of the visible sphere nearest the camera, i.e. one a ray through its centre must hit first. */
const frontPoint = (page, hook) => page.evaluate(h => {
  const { app, anim, stage, THREE } = window[h], r = document.querySelector('#space').getBoundingClientRect(), v = new THREE.Vector3();
  let best = -1, bd = Infinity;
  for (let i = 0; i < app.drugs.length; i++) {
    if (anim.cur[i * 4 + 3] < 0.5) continue;
    v.set(anim.cur[i * 4], anim.cur[i * 4 + 1], anim.cur[i * 4 + 2]);
    const d = v.distanceTo(stage.camera.position);
    if (d < bd) { bd = d; best = i; }
  }
  v.set(anim.cur[best * 4], anim.cur[best * 4 + 1], anim.cur[best * 4 + 2]).project(stage.camera);
  return { i: best, x: Math.round((v.x * 0.5 + 0.5) * r.width + r.left), y: Math.round((-v.y * 0.5 + 0.5) * r.height + r.top) };
}, hook);

const view = (id, patch) => ({ id, run: (page, h) => page.evaluate(([hook, p]) => window[hook].setView(p), [h, { ...RESET, ...patch }]) });
const search = (id, text) => ({ id, run: async page => { await page.fill('#search', text); await page.press('#search', 'Enter'); } });
const select = (id, byName) => ({ id, run: (page, h) => page.evaluate(([hook, n]) => { const H = window[hook], d = n ? H.app.drugs.find(x => x.name === n) : H.app.drugs.find(x => !x.conf); H.selectDrug(d.cid); }, [h, byName]) });

/** The ordered list of actions. Each is run, the app is settled, and a snapshot is taken. */
export const SEQUENCE = [
  ...STEP_NAMES.map(n => ({ id: `step:${n}`, run: (page, h) => page.evaluate(([hook, s]) => window[hook].goStep(s), [h, n]) })),
  view('explore:pc-atc', { x: 'pc1', y: 'pc2', z: 'pc3', color: 'atc' }),
  { id: 'ui:atc-chip', run: page => page.click('#atc-pick .chip[aria-pressed="true"]') },
  view('explore:logp-act-mr-group-all', { x: 'logp', y: 'act', z: 'mr', color: 'act', group: 'ALL' }),
  view('explore:tpsa-veber', { x: 'logp', y: 'tpsa', z: 'mr', color: 'oral', veber: true }),
  view('explore:filter-ro5', { x: 'mw', y: 'none', z: 'jitter', color: 'ro5', l1: 'C', route: 'ORAL' }),
  search('search:filtered-out-drug', 'caffeine'),
  view('explore:xlogp-small-n05', { x: 'xlogp', y: 'hbd', z: 'rotb', color: 'single', small: true, l1: 'N', l2: 'N05' }),
  select('select:no-conformer', null),
  select('select:dexamethasone', 'dexamethasone'),
  { id: 'theme:dark', run: page => page.emulateMedia({ colorScheme: 'dark' }) },
  { id: 'theme:light', run: page => page.emulateMedia({ colorScheme: 'light' }) },
  { id: 'cam:camTo', run: (page, h) => page.evaluate(hook => window[hook].camTo([27, 12, 24]), h) },
  { id: 'ui:reset-view', run: page => page.click('#btn-reset') },
  { id: 'step:series-again', run: (page, h) => page.evaluate(hook => window[hook].goStep('series'), h) },
  { id: 'ui:show-fit', run: async page => { await page.selectOption('#h-group', { index: 3 }); await page.click('#h-show'); } },
  search('search:prefix', 'dexa'),
  { id: 'pointer:hover', run: async (page, h) => { const p = await frontPoint(page, h); await page.mouse.move(p.x - 40, p.y - 40); await page.mouse.move(p.x, p.y); } },
  { id: 'pointer:click', run: async (page, h) => { const p = await frontPoint(page, h); await page.mouse.click(p.x, p.y); } },
  // last: the camera turns for an unpredictable time and then coasts (orbit damping), so nothing after this is comparable
  { id: 'ui:spin-on', skip: ['camera', 'labels', 'labelsN'], run: page => page.click('#btn-spin') },
  { id: 'ui:spin-off', skip: ['camera', 'labels', 'labelsN'], run: page => page.click('#btn-spin') },
];

/** Run the whole recipe on a loaded page; returns { boot, views: {id: snapshot} } in recipe order. */
export async function runSequence(page, hook, log = () => {}) {
  await waitReady(page, hook);
  const out = { boot: await bootSnapshot(page), views: { 'load': await snapshot(page, hook) } };
  await page.evaluate(() => { document.querySelector('#table-details').open = true; });
  await page.waitForFunction(() => document.querySelectorAll('#table tbody tr').length > 0);
  for (const step of SEQUENCE) {
    await step.run(page, hook);
    await settle(page, hook);
    const snap = await snapshot(page, hook);
    for (const k of step.skip || []) delete snap[k];
    out.views[step.id] = snap;
    log(step.id);
  }
  return out;
}
