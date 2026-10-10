// GL layer. The per-frame work (interpolate the layout tween, update instances and ring, draw, keep titles inside the
// stage), picking and the hover tooltip, the camera moves and the two stage buttons.
//
// The loop is on demand (stage.loop, js/scheduler.js): renderFrame() draws once and answers whether it wants another frame
// (layout tween running, orbit damping or a camera tween moving, Spin on). Everything else wakes the loop explicitly:
// orbit controls, hover and selection, layout / recolor / theme, resize, fonts, tween updates. Idle = no rAF, no draw call.
import * as THREE from 'three';
import { $, ORDER, STEPS, anim, app, bus, cap, esc, fx, reduceMotion } from '../kernel.js';
import { AX } from '../model.js';
import { selectDrug } from '../view.js';
import { assignSlots, stage, wake } from './scene.js';

const _m = new THREE.Matrix4();
const camSig = new Float64Array(9);           // position (3), quaternion (4), zoom, aspect of the last frame
let firstFrame = true;

function cameraMoved() {
  const { camera: c } = stage, p = c.position, q = c.quaternion;
  const now = [p.x, p.y, p.z, q.x, q.y, q.z, q.w, c.zoom, c.aspect];
  let moved = false;
  for (let i = 0; i < 9; i++) if (camSig[i] !== now[i]) { moved = true; camSig[i] = now[i]; }
  return moved;
}

/**
 * One frame. Returns true when another frame is needed (the scheduler then keeps calling): a layout tween is running, the
 * orbit controls are still moving (drag, damping, camera tween) or Spin is on.
 * @param {number} [t] rAF timestamp  @param {number} [dt] ms since the previous frame of a continuous run, else 0
 */
export function renderFrame(t = 0, dt = 0) {
  const { points, controls, camera, ring, selLabel, quality } = stage;
  if (!points) return false;
  if (dt > 0) { quality.active(); quality.sample(dt, true); }   // may re-allocate the buffer: before drawing, never after
  const moved = controls.update();
  const D = stage.dirty, animating = anim.t < 1, C = anim.cur;
  if (animating || D.inst || D.t !== anim.t) {
    const n = app.drugs.length, F = anim.from, T = anim.to, a = anim.t;
    for (let i = 0; i < n * 4; i++) C[i] = F[i] + (T[i] - F[i]) * a;
  }
  if (!animating && D.settle) {                // the layout tween is over: only the visible drugs keep a slot
    D.settle = false;
    assignSlots();
    stage.recolor?.();
    D.inst = true;
  }
  if (animating || D.inst || D.t !== anim.t) {
    const { drugAt } = stage;
    for (let s = 0, count = points.count; s < count; s++) {
      const i = drugAt[s], k = i * 4;
      let sc = C[k + 3];
      if (i === app.hover && sc > 0) sc *= 1.7;
      else if (i === app.selected && sc > 0) sc *= 1.35;
      _m.makeScale(sc, sc, sc).setPosition(C[k], C[k + 1], C[k + 2]);
      points.setMatrixAt(s, _m);
    }
    points.instanceMatrix.needsUpdate = true;
    D.inst = false;
    D.t = anim.t;
  }
  if (app.selected >= 0 && C[app.selected * 4 + 3] > 0.5) {
    const k = app.selected * 4;
    ring.position.set(C[k], C[k + 1], C[k + 2]);
    ring.quaternion.copy(camera.quaternion);
    ring.visible = selLabel.visible = true;
    selLabel.position.copy(ring.position);
  } else ring.visible = selLabel.visible = false;
  const camMoved = cameraMoved();
  stage.renderer.render(stage.scene, camera);
  stage.labels.render(stage.scene, camera);
  if (D.labels || camMoved) { D.labels = false; keepTitlesInside(); }
  if (firstFrame) { firstFrame = false; bus.emit('gl:firstframe'); }
  return animating || moved === true || controls.autoRotate === true;
}

// Axis titles hang off the axis ends; slide any that would run past the stage edge back inside it, and below the legend
// or the buttons if they would sit on them. The CSS translate property composes with the transform CSS2DRenderer
// writes every frame, so the two do not fight. All rectangles are read before any style is written (no forced layout per title).
function keepTitlesInside() {
  const host = stage.labels.domElement, box = host.getBoundingClientRect();
  const keepOut = ['.hud', '.stage-tools'].map(q => $(q)?.getBoundingClientRect()).filter(r => r && r.width && r.height);
  const titles = [...host.querySelectorAll('.ax-title')].map(el => ({ el, r: el.getBoundingClientRect() })).filter(o => o.r.width);
  for (const { el, r } of titles) {
    const [wx, wy] = (el.dataset.shift || '0 0').split(' ').map(Number);
    const left = r.left - wx, right = r.right - wx, top = r.top - wy, bottom = r.bottom - wy;
    const x = Math.round(Math.max(box.left + 8 - left, Math.min(0, box.right - 8 - right)));
    let y = 0;
    for (const k of keepOut) if (left + x < k.right && right + x > k.left && top + y < k.bottom && bottom + y > k.top) y = Math.round(k.bottom + 6 - top);
    const shift = `${x} ${y}`;
    if (shift !== (el.dataset.shift || '0 0')) { el.dataset.shift = shift; el.style.translate = x || y ? `${x}px ${y}px` : ''; }
  }
}

// ---------------------------------------------------------------- hover, click, tooltip
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
/** Drug index under the pointer, or -1. Instances are compacted, so the hit's slot is mapped back to its drug. */
function pick(ev, canvas) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  const hits = ray.intersectObject(stage.points);
  for (const h of hits) { const i = stage.drugAt[h.instanceId]; if (anim.cur[i * 4 + 3] > 0.5) return i; }
  return -1;
}
let tipEl = null, canvasEl = null;
function setHover(i) {
  if (i === app.hover) return;
  app.hover = i;
  stage.dirty.inst = true;
  wake();
}
/** Forget the hovered drug and hide its tooltip (a layout moves every sphere, so the old pick is stale). */
function clearHover() {
  setHover(-1);
  if (tipEl) tipEl.hidden = true;
  if (canvasEl) canvasEl.style.cursor = '';
}
/** Hover tooltip and click-to-select on the stage canvas. Returns a function that removes the listeners. */
export function bindPointer(canvas, host) {
  const tip = $('#tooltip'), ac = new AbortController(), { signal } = ac;
  tipEl = tip; canvasEl = canvas;
  let down = null, pending = null;
  canvas.addEventListener('pointermove', ev => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      if (!stage.points) return;
      const i = ev.buttons ? -1 : pick(ev, canvas);
      setHover(i);
      canvas.style.cursor = i >= 0 ? 'pointer' : '';
      if (i < 0) { tip.hidden = true; return; }
      const d = app.drugs[i], v = app.view, hr = host.getBoundingClientRect();
      const rows = ['x', 'y', 'z'].filter(a => !AX[v[a]].pseudo)
        .map(a => `<div class="t-row">${esc(AX[v[a]].label)} ${fx(AX[v[a]].get(d), AX[v[a]].dec)}${AX[v[a]].unit ? ' ' + AX[v[a]].unit : ''}</div>`).join('');
      tip.innerHTML = `<div class="t-name">${esc(cap(d.name))}</div>${rows}<div class="t-row">ATC ${esc(d.atc.map(a => a.code).slice(0, 3).join(', '))}${d.atc.length > 3 ? '…' : ''}</div>`;
      tip.hidden = false;
      const x = ev.clientX - hr.left, y = ev.clientY - hr.top, w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.min(x + 14, hr.width - w - 8) + 'px';
      tip.style.top = (y + h + 18 > hr.height ? y - h - 12 : y + 16) + 'px';
    });
  }, { signal });
  canvas.addEventListener('pointerleave', () => { setHover(-1); tip.hidden = true; }, { signal });
  canvas.addEventListener('pointerdown', ev => { down = [ev.clientX, ev.clientY]; }, { signal });
  canvas.addEventListener('pointerup', ev => {
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5) return;
    const i = pick(ev, canvas);
    if (i >= 0) selectDrug(app.drugs[i].cid);
  }, { signal });
  return () => { ac.abort(); if (pending) cancelAnimationFrame(pending); tipEl = canvasEl = null; };
}

// ---------------------------------------------------------------- camera moves
/** Move the camera to `pos` (scaled up on narrow stages) looking at the origin: tweened, or at once when `instant` or reduced motion. */
export function camTo(pos, { instant = false } = {}) {
  const c = stage.camera, k = Math.max(1, 1.2 / Math.max(0.3, c.aspect));
  const p = new THREE.Vector3(...pos).multiplyScalar(k);
  if (instant || reduceMotion.matches || !window.gsap) { c.position.copy(p); stage.controls.target.set(0, 0, 0); wake(); return; }
  window.gsap.killTweensOf(c.position);
  window.gsap.killTweensOf(stage.controls.target);
  window.gsap.to(c.position, { x: p.x, y: p.y, z: p.z, duration: 1.4, ease: 'power2.inOut', onUpdate: wake, onComplete: wake });
  window.gsap.to(stage.controls.target, { x: 0, y: 0, z: 0, duration: 1.4, ease: 'power2.inOut', onUpdate: wake, onComplete: wake });
}

/**
 * Bind the camera command from the core (tour steps, "Show this fit in 3D"), the Reset view / Spin buttons, and the bus
 * events that change what the next frame must redraw. Returns a function that undoes it all.
 */
export function bindStageTools() {
  const D = stage.dirty, offs = [];
  offs.push(bus.on('cmd:camera', ({ preset, pos, instant }) => camTo(pos || STEPS[preset].cam, { instant })));
  // after the GL handlers (ORDER.GL) and the HUD: mark what changed and ask for a frame
  offs.push(bus.on('layout', () => { clearHover(); D.inst = true; D.labels = true; wake(); }, ORDER.LATE));
  offs.push(bus.on('recolor', () => wake(), ORDER.LATE));
  offs.push(bus.on('theme', () => { D.labels = true; wake(); }, ORDER.LATE));
  offs.push(bus.on('selection', () => { D.inst = true; D.labels = true; wake(); }, ORDER.LATE));
  stage.onResize = () => { D.labels = true; };
  const reset = () => camTo(STEPS[app.step]?.cam || STEPS.space.cam);
  const spin = e => {
    stage.controls.autoRotate = !stage.controls.autoRotate;
    e.currentTarget.setAttribute('aria-pressed', stage.controls.autoRotate);
    wake();
  };
  $('#btn-reset')?.addEventListener('click', reset);
  $('#btn-spin')?.addEventListener('click', spin);
  return () => {
    for (const off of offs) off();
    $('#btn-reset')?.removeEventListener('click', reset);
    $('#btn-spin')?.removeEventListener('click', spin);
    stage.onResize = null;
  };
}
