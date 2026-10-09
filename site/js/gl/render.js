// GL layer. The per-frame work (interpolate the layout tween, update instances and ring, draw, keep titles inside the
// stage), picking and the hover tooltip, the camera moves and the two stage buttons.
import * as THREE from 'three';
import { $, STEPS, anim, app, bus, cap, esc, fx, reduceMotion } from '../kernel.js';
import { AX } from '../model.js';
import { selectDrug } from '../view.js';
import { stage } from './scene.js';

const _m = new THREE.Matrix4();

/** One animation frame: orbit damping, instance transforms from the layout tween, ring, both renderers, title fitting. */
export function frame() {
  const { points, controls, camera, ring, selLabel } = stage;
  controls.update();
  const t = anim.t, n = app.drugs.length, F = anim.from, T = anim.to, C = anim.cur;
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    for (let j = 0; j < 4; j++) C[k + j] = F[k + j] + (T[k + j] - F[k + j]) * t;
    let s = C[k + 3];
    if (i === app.hover && s > 0) s *= 1.7;
    else if (i === app.selected && s > 0) s *= 1.35;
    _m.makeScale(s, s, s).setPosition(C[k], C[k + 1], C[k + 2]);
    points.setMatrixAt(i, _m);
  }
  points.instanceMatrix.needsUpdate = true;
  if (app.selected >= 0 && C[app.selected * 4 + 3] > 0.5) {
    const k = app.selected * 4;
    ring.position.set(C[k], C[k + 1], C[k + 2]);
    ring.quaternion.copy(camera.quaternion);
    ring.visible = selLabel.visible = true;
    selLabel.position.copy(ring.position);
  } else ring.visible = selLabel.visible = false;
  stage.renderer.render(stage.scene, camera);
  stage.labels.render(stage.scene, camera);
  keepTitlesInside();
}

// Axis titles hang off the axis ends; slide any that would run past the stage edge back inside it, and below the legend
// or the buttons if they would sit on them. The CSS translate property composes with the transform CSS2DRenderer
// writes every frame, so the two do not fight.
function keepTitlesInside() {
  const host = stage.labels.domElement, box = host.getBoundingClientRect();
  const keepOut = ['.hud', '.stage-tools'].map(q => $(q).getBoundingClientRect()).filter(r => r.width && r.height);
  for (const el of host.querySelectorAll('.ax-title')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
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
function pick(ev, canvas) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  const hits = ray.intersectObject(stage.points);
  for (const h of hits) if (anim.cur[h.instanceId * 4 + 3] > 0.5) return h.instanceId;
  return -1;
}
/** Hover tooltip and click-to-select on the stage canvas. */
export function bindPointer(canvas, host) {
  const tip = $('#tooltip');
  let down = null, pending = null;
  canvas.addEventListener('pointermove', ev => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      const i = ev.buttons ? -1 : pick(ev, canvas);
      app.hover = i;
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
  });
  canvas.addEventListener('pointerleave', () => { app.hover = -1; tip.hidden = true; });
  canvas.addEventListener('pointerdown', ev => { down = [ev.clientX, ev.clientY]; });
  canvas.addEventListener('pointerup', ev => {
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5) return;
    const i = pick(ev, canvas);
    if (i >= 0) selectDrug(app.drugs[i].cid);
  });
}

// ---------------------------------------------------------------- camera moves
/** Move the camera to `pos` (scaled up on narrow stages) looking at the origin: tweened, or at once when `instant` or reduced motion. */
export function camTo(pos, { instant = false } = {}) {
  const c = stage.camera, k = Math.max(1, 1.2 / Math.max(0.3, c.aspect));
  const p = new THREE.Vector3(...pos).multiplyScalar(k);
  if (instant || reduceMotion.matches || !window.gsap) { c.position.copy(p); stage.controls.target.set(0, 0, 0); return; }
  window.gsap.killTweensOf(c.position);
  window.gsap.killTweensOf(stage.controls.target);
  window.gsap.to(c.position, { x: p.x, y: p.y, z: p.z, duration: 1.4, ease: 'power2.inOut' });
  window.gsap.to(stage.controls.target, { x: 0, y: 0, z: 0, duration: 1.4, ease: 'power2.inOut' });
}

/** Bind the camera command from the core (tour steps, "Show this fit in 3D") and the Reset view / Spin buttons. */
export function bindStageTools() {
  bus.on('cmd:camera', ({ preset, pos, instant }) => camTo(pos || STEPS[preset].cam, { instant }));
  $('#btn-reset').addEventListener('click', () => camTo(STEPS[app.step]?.cam || STEPS.space.cam));
  $('#btn-spin').addEventListener('click', e => {
    stage.controls.autoRotate = !stage.controls.autoRotate;
    e.currentTarget.setAttribute('aria-pressed', stage.controls.autoRotate);
  });
}
