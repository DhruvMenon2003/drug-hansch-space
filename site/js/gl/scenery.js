// GL layer. What hangs in the scene besides the spheres: axes, grid and tick labels; the Veber plane, fitted surface and
// residual sticks; the instance colours. initScenery() subscribes to the bus, running first on every event, so the
// scene is rebuilt in the order it always was (axes, extras, colours) before the HUD and the table redraw.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { $, S, ORDER, anim, app, bus, cap, neg, reduceMotion } from '../kernel.js';
import { AX, axLong, colorOf } from '../model.js';
import { assignSlots, disposeGroup, stage, wake } from './scene.js';

const _c = new THREE.Color();

function label(text, cls, pos, center = [0.5, 0.5]) {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.position.copy(pos);
  o.center.set(...center);
  return o;
}
const tickText = (key, v) => neg(Math.abs(v) >= 1000 ? v.toFixed(0) : +v.toPrecision(4) + '');

/** Rebuild the grid, frame and tick/title labels for the current scales. */
export function buildAxes() {
  disposeGroup(stage.axes);
  const g = new THREE.Group(), { x: sx, y: sy, z: sz } = app.scales, v = app.view, T = app.tokens;
  const grid = [], frame = [];
  const seg = (arr, a, b) => arr.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  // floor (y = −S): x ticks run along z, z ticks run along x
  if (!sx.pseudo) for (const t of sx.ticks) seg(grid, [sx.map(t), -S, -S], [sx.map(t), -S, S]);
  if (!sz.pseudo) for (const t of sz.ticks) seg(grid, [-S, -S, sz.map(t)], [S, -S, sz.map(t)]);
  if (!sy.pseudo) {
    for (const t of sy.ticks) { seg(grid, [-S, sy.map(t), -S], [S, sy.map(t), -S]); seg(grid, [-S, sy.map(t), -S], [-S, sy.map(t), S]); }
    if (!sx.pseudo) for (const t of sx.ticks) seg(grid, [sx.map(t), -S, -S], [sx.map(t), S, -S]);
    if (!sz.pseudo) for (const t of sz.ticks) seg(grid, [-S, -S, sz.map(t)], [-S, S, sz.map(t)]);
  }
  seg(frame, [-S, -S, S], [S, -S, S]);
  seg(frame, [S, -S, -S], [S, -S, S]);
  if (!sy.pseudo) seg(frame, [-S, -S, S], [-S, S, S]);
  const mk = (arr, color, opacity) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  };
  g.add(mk(grid, T.line, 0.75), mk(frame, T['ink-2'], 0.9));
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  // t-SNE units mean nothing, so those axes get no numbers and a short name (the axis key carries the long one);
  // phone-width stages get the short names throughout
  const narrow = $('.stage-inner').clientWidth < 600, title = k => narrow || AX[k].arbitrary ? AX[k].label + (AX[k].unit ? ` (${AX[k].unit})` : '') : axLong(k), ticks = (k, sc) => AX[k].arbitrary ? [] : sc.ticks;
  if (!sx.pseudo) {
    for (const t of ticks(v.x, sx)) g.add(label(tickText(v.x, t), 'ax-label', P(sx.map(t), -S, S + 0.9)));
    g.add(label(title(v.x), 'ax-title', P(0, -S, S + 2.4)));
  }
  if (!sz.pseudo) {
    for (const t of ticks(v.z, sz)) g.add(label(tickText(v.z, t), 'ax-label', P(S + 0.9, -S, sz.map(t)), [0, 0.5]));
    g.add(label(title(v.z), 'ax-title', P(S + 2.2, -S, 0), [0, 0.5]));
  }
  if (!sy.pseudo) {
    for (const t of ticks(v.y, sy)) g.add(label(tickText(v.y, t), 'ax-label', P(-S - 0.6, sy.map(t), S), [1, 0.5]));
    g.add(label(title(v.y), 'ax-title', P(-S + 0.3, S, S), [0, 0]));   // beside the top of the axis, clear of the legend and the canvas edge
  }
  stage.scene.add(g);
  stage.axes = g;
}

/** Rebuild the Veber plane and the fitted surface with its residual sticks, when the current view calls for them. */
export function buildExtras() {
  disposeGroup(stage.extras);
  const g = new THREE.Group(), v = app.view, T = app.tokens, sc = app.scales;
  const fade = (mat, to) => {
    mat.transparent = true;
    if (reduceMotion.matches || !window.gsap) { mat.opacity = to; return; }
    mat.opacity = 0;
    window.gsap.to(mat, { opacity: to, duration: 0.8, delay: 0.6, onUpdate: wake, onComplete: wake });   // each tick is a frame: the loop is on demand
  };
  // Veber et al. 2002: oral bioavailability falls above 140 Å² of polar surface
  const axisOf = ['x', 'y', 'z'].find(a => v[a] === 'tpsa');
  if (v.veber && axisOf && 140 >= sc[axisOf].lo && 140 <= sc[axisOf].hi) {
    const at = sc[axisOf].map(140);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * S, 2 * S), new THREE.MeshBasicMaterial({ color: T.mark, side: THREE.DoubleSide, depthWrite: false }));
    if (axisOf === 'y') { plane.rotation.x = -Math.PI / 2; plane.position.y = at; }
    else if (axisOf === 'x') { plane.rotation.y = Math.PI / 2; plane.position.x = at; }
    else plane.position.z = at;
    fade(plane.material, 0.13);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plane.geometry), new THREE.LineBasicMaterial({ color: T.mark }));
    edge.rotation.copy(plane.rotation); edge.position.copy(plane.position);
    fade(edge.material, 0.9);
    const lp = axisOf === 'y' ? new THREE.Vector3(S, at, -S) : axisOf === 'x' ? new THREE.Vector3(at, S, -S) : new THREE.Vector3(S, S, at);
    g.add(plane, edge, label('TPSA 140 Å² (Veber)', 'ax-plane', lp, [1, 1.2]));
  }
  const grp = v.group && app.groups.get(v.group);
  if (grp && v.x === 'logp' && v.z === 'mr' && v.y === 'act') {
    const h = grp.fit, members = app.visible.filter(d => grp.cids.has(d.cid));
    const lps = members.map(d => d.d.logp), mrs = members.map(d => d.d.mr);
    const tpsaMean = members.reduce((a, d) => a + (d.d.tpsa ?? 0), 0) / Math.max(1, members.length);
    const f = (lp, mr, tp) => h.coef.const + (h.coef.logP ?? 0) * lp + (h.coef['logP²'] ?? 0) * lp * lp + (h.coef.MR ?? 0) * mr + (h.coef.TPSA ?? 0) * tp;
    const [l0, l1] = [Math.min(...lps), Math.max(...lps)], [m0, m1] = [Math.min(...mrs), Math.max(...mrs)];
    const N = 28, geo = new THREE.PlaneGeometry(1, 1, N, N), pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + 0.5, w = pos.getY(i) + 0.5, lp = l0 + (l1 - l0) * u, mr = m0 + (m1 - m0) * w;
      pos.setXYZ(i, sc.x.map(lp), THREE.MathUtils.clamp(sc.y.map(f(lp, mr, tpsaMean)), -S, S), sc.z.map(mr));
    }
    geo.computeVertexNormals();
    const surf = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: T.accent, side: THREE.DoubleSide, depthWrite: false }));
    fade(surf.material, parseFloat(T['surface-alpha']) || 0.3);
    const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: T.accent, wireframe: true }));
    fade(wire.material, 0.35);
    // residual sticks: observed pChEMBL to the model's fitted value for that drug
    const fitBy = new Map(h.points.map(p => [p.cid, p.fit])), sticks = [];
    for (const d of members) {
      const x = sc.x.map(d.d.logp), z = sc.z.map(d.d.mr);
      sticks.push(x, sc.y.map(d.act.p), z, x, THREE.MathUtils.clamp(sc.y.map(fitBy.get(d.cid)), -S, S), z);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sticks, 3));
    const stickLines = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: T.ink }));
    fade(stickLines.material, 0.55);
    g.add(surf, wire, stickLines);
  }
  stage.scene.add(g);
  stage.extras = g;
}

/** Paint the instance colours of the drawn slots for the current colour mode and tint the selection ring. */
export function recolor() {
  const { points, drugAt } = stage;
  for (let s = 0, n = points.count; s < n; s++) points.setColorAt(s, _c.set(colorOf(app.drugs[drugAt[s]]) || '#888'));
  points.instanceColor.needsUpdate = true;
  stage.ring.material.color.set(app.tokens.mark);
}

/**
 * Subscribe the scene to layout, recolor, theme and selection events. Call once, after initScene().
 * @returns {() => void} unsubscribe
 */
export function initScenery() {
  stage.recolor = recolor;
  const offs = [
    // the slots come first (axes and colours are painted for them); a running tween keeps every drug that is visible at either end
    bus.on('layout', () => { assignSlots(); stage.dirty.settle = anim.t < 1; buildAxes(); buildExtras(); recolor(); }, ORDER.GL),
    bus.on('recolor', recolor, ORDER.GL),
    bus.on('theme', () => { recolor(); buildAxes(); buildExtras(); }, ORDER.GL),
    bus.on('selection', ({ index }) => { stage.selLabel.element.textContent = cap(app.drugs[index].name); }, ORDER.GL),
  ];
  return () => { for (const off of offs) off(); stage.recolor = null; };
}
