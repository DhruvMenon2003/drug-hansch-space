// Layer 2. The view state machine: patch the view, recompute the layout, change the selection. Imports no three; it tells
// the rest of the app what happened through the bus (view:patched, layout, selection).
import { app, anim, bus, reduceMotion } from './kernel.js';
import { AX, makeScale, passes } from './model.js';

/** Allocate the per-drug animation buffers; call once after the data are loaded. */
export function initView() {
  const n = app.drugs.length;
  anim.from = new Float32Array(n * 4);
  anim.to = new Float32Array(n * 4);
  anim.cur = new Float32Array(n * 4);
}

/** Merge `patch` into the view, let the controls mirror it, then re-layout. `opts` is passed to layout(). */
export function setView(patch, opts) {
  Object.assign(app.view, patch);
  bus.emit('view:patched', { patch });
  layout(opts);
}

/**
 * Recompute app.visible, the scales and the tween targets, then emit `layout` (the GL scene, HUD and table redraw from it,
 * in that order).
 */
export function layout({ instant = false } = {}) {
  const v = app.view, list = app.drugs.filter(d => passes(d));
  app.visible = list;
  const vis = new Set(list);
  const sx = makeScale(v.x, list), sy = makeScale(v.y, list), sz = makeScale(v.z, list);
  app.scales = { x: sx, y: sy, z: sz };
  // start from wherever the points are now, so a change in mid-flight does not jump
  anim.from.set(anim.cur);
  app.drugs.forEach((d, i) => {
    const k = i * 4;
    if (vis.has(d)) {
      anim.to[k] = sx.map(AX[v.x].get?.(d) ?? 0);
      anim.to[k + 1] = sy.map(AX[v.y].get?.(d) ?? 0);
      anim.to[k + 2] = sz.map(AX[v.z].get?.(d) ?? 0);
      anim.to[k + 3] = 1;
      if (anim.from[k + 3] === 0) { anim.from[k] = anim.to[k]; anim.from[k + 1] = anim.to[k + 1]; anim.from[k + 2] = anim.to[k + 2]; }
    } else {
      anim.to[k] = anim.from[k]; anim.to[k + 1] = anim.from[k + 1]; anim.to[k + 2] = anim.from[k + 2];
      anim.to[k + 3] = 0;
    }
  });
  anim.tween?.kill();
  if (instant || reduceMotion.matches || !window.gsap) { anim.t = 1; anim.from.set(anim.to); anim.cur.set(anim.to); }
  else { anim.t = 0; anim.tween = window.gsap.to(anim, { t: 1, duration: 1.1, ease: 'power2.inOut' }); }
  bus.emit('layout', { instant });
}

/**
 * Select the drug with PubChem CID `cid` (ignored when unknown) and announce it on the bus.
 * `reveal: false` is for selections that are not a reader's action (restoring a link): the drug panel is then not scrolled into view.
 * @param {number} cid @param {{ reveal?: boolean }} [opts]
 */
export function selectDrug(cid, { reveal = true } = {}) {
  const i = app.drugs.findIndex(d => d.cid === cid);
  if (i < 0) return;
  app.selected = i;
  bus.emit('selection', { index: i, cid, reveal });
}
