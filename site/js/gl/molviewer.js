// GL layer. The ball-and-stick conformer viewer in the drug panel: its own small renderer, created on the first selection.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { $, ORDER, app, bus, reduceMotion } from '../kernel.js';
import { loadMolecule } from '../data.js';
import { announce } from '../announce.js';
import { expectConformer, setConformerRetry } from '../detail.js';
import { createScheduler } from '../scheduler.js';
import { disposeGroup, watchContext, watchDpr } from './scene.js';

const _m = new THREE.Matrix4(), _c = new THREE.Color();
const CPK = { 1: '#e8e8e8', 3: '#cc80ff', 5: '#ffb5b5', 6: '#909090', 7: '#3050f8', 8: '#ff0d0d', 9: '#90e050', 11: '#ab5cf2', 12: '#8aff00',
  13: '#bfa6a6', 14: '#f0c8a0', 15: '#ff8000', 16: '#e6c629', 17: '#1ff01f', 19: '#8f40d4', 20: '#3dff00', 26: '#e06633', 27: '#f090a0',
  29: '#c88033', 30: '#7d80b0', 31: '#c28f8f', 33: '#bd80e3', 34: '#ffa100', 35: '#a62929', 43: '#3b9e9e', 47: '#c0c0c0', 51: '#9e63b5',
  53: '#940094', 57: '#70d4ff', 64: '#45ffc7', 78: '#d0d0e0', 79: '#ffd123', 80: '#b8b8d0', 83: '#9e4fb5' };
/** The viewer singleton. Filled on the first selection; mutate it, never reassign it. */
export const molv = { renderer: null, scene: null, camera: null, controls: null, group: null, loop: null, visible: false, spinUntil: 0, src: '', abort: null };

/** The conformer turns by itself for this long after it appears, then the viewer stops drawing (battery). */
export const SPIN_MS = 8000;
const wake = () => molv.loop?.invalidate();

function initMolViewer() {
  const canvas = $('#mol'), ac = (molv.abort = new AbortController()), { signal } = ac;
  molv.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  molv.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  molv.loop = createScheduler();
  molv.scene = new THREE.Scene();
  molv.scene.add(new THREE.HemisphereLight(0xffffff, 0x666f6d, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(5, 8, 10);
  molv.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
  molv.camera.add(sun);
  molv.scene.add(molv.camera);
  molv.controls = new OrbitControls(molv.camera, canvas);
  molv.controls.enableDamping = true;
  molv.controls.enableZoom = false;              // the page scrolls over this canvas
  molv.controls.enablePan = false;
  molv.controls.autoRotate = false;              // switched on for SPIN_MS by each new molecule, never under reduced motion
  molv.controls.autoRotateSpeed = 1.2;
  for (const ev of ['change', 'start', 'end']) molv.controls.addEventListener(ev, wake);
  const fit = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    molv.renderer.setSize(w, h, false);
    molv.camera.aspect = w / h;
    molv.camera.updateProjectionMatrix();
    molv.loop.renderNow();                       // resizing clears the buffer: draw again before the browser paints
  };
  const ro = new ResizeObserver(fit);
  ro.observe(canvas);
  // draw only while the canvas is on screen and the panel is open; scrolling back wakes it
  const io = new IntersectionObserver(entries => { molv.visible = entries[entries.length - 1].isIntersecting; if (molv.visible) wake(); });
  io.observe(canvas);
  watchDpr(dpr => { molv.renderer.setPixelRatio(Math.min(dpr, 2)); fit(); }, signal);
  watchContext(canvas, {
    onLost() { molv.loop.pause(); announce('The 3D conformer view lost its graphics context and is restoring.'); if (molv.group) $('#d-src').textContent = 'Graphics context lost, restoring…'; },
    onRestored() { if (molv.group) $('#d-src').textContent = molv.src; molv.loop.resume(); fit(); },
  }, signal);
  molv.loop.setRender(() => {
    if (!molv.group || $('#detail-body').hidden || !molv.visible) return false;
    if (molv.controls.autoRotate && performance.now() > molv.spinUntil) molv.controls.autoRotate = false;
    const moved = molv.controls.update();
    molv.renderer.render(molv.scene, molv.camera);
    return moved === true || molv.controls.autoRotate;
  });
  molv.dispose = () => {
    ac.abort(); ro.disconnect(); io.disconnect(); molv.loop.dispose(); molv.controls.dispose();
    disposeGroup(molv.group); molv.group = null;
    molv.renderer.dispose();
    Object.assign(molv, { renderer: null, scene: null, camera: null, controls: null, loop: null, visible: false, abort: null, dispose: null });
  };
}

/** Build and show the conformer of drug `d` (loading the conformer file on first use). */
export async function showMolecule(d) {
  if (!molv.renderer) initMolViewer();
  $('#d-src').textContent = 'Loading conformer…';
  setConformerRetry(null);
  let m;
  try { m = await loadMolecule(d.cid); }     // one shard of the conformer table, not the whole table
  catch {
    if (app.drugs[app.selected] !== d) return;
    $('#d-src').textContent = 'Could not load the conformer file.';
    setConformerRetry(() => showMolecule(d));
    announce('Could not load the 3D conformer. A Retry button is next to the message.');
    bus.emit('conformer:shown', { cid: d.cid });      // settled, without a conformer: the 2D depiction need not wait
    return;
  }
  if (app.drugs[app.selected] !== d) return;
  disposeGroup(molv.group);
  molv.group = null;
  if (!m) { $('#d-src').textContent = 'No 3D conformer (PubChem has none and RDKit could not embed it).'; molv.renderer.clear(); bus.emit('conformer:shown', { cid: d.cid }); return; }
  $('#d-src').textContent = molv.src = m.src;
  const showH = $('#show-h').checked, n = m.z.length, keep = [];
  for (let i = 0; i < n; i++) if (showH || m.z[i] !== 1) keep.push(i);
  const P = i => new THREE.Vector3(m.xyz[3 * i], m.xyz[3 * i + 1], m.xyz[3 * i + 2]);
  const g = new THREE.Group();
  const rad = z => (z === 1 ? 0.17 : z <= 10 ? 0.3 : z <= 18 ? 0.36 : 0.42);
  const atoms = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ roughness: 0.45 }), keep.length);
  keep.forEach((i, j) => {
    const r = rad(m.z[i]);
    atoms.setMatrixAt(j, _m.makeScale(r, r, r).setPosition(P(i)));
    atoms.setColorAt(j, _c.set(CPK[m.z[i]] || '#ff1493'));
  });
  g.add(atoms);
  // bonds: each half takes its atom's colour; double, triple and aromatic bonds as parallel sticks
  const halves = [], up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
  for (let k = 0; k < m.b.length; k += 3) {
    const [i, j, o] = [m.b[k], m.b[k + 1], m.b[k + 2]];
    if (!showH && (m.z[i] === 1 || m.z[j] === 1)) continue;
    const a = P(i), b = P(j), dir = b.clone().sub(a);
    let side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 * dir.length() ? up : new THREE.Vector3(1, 0, 0)).normalize();
    const sticks = o === 2 ? [[-0.07, 0.055], [0.07, 0.055]] : o === 3 ? [[-0.1, 0.045], [0, 0.045], [0.1, 0.045]] : o === 4 ? [[0, 0.07], [0.12, 0.035]] : [[0, 0.08]];
    for (const [off, r] of sticks) {
      const sh = side.clone().multiplyScalar(off), a2 = a.clone().add(sh), b2 = b.clone().add(sh), mid = a2.clone().add(b2).multiplyScalar(0.5);
      halves.push([a2, mid, r, m.z[i]], [mid, b2, r, m.z[j]]);
    }
  }
  const bonds = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1), new THREE.MeshStandardMaterial({ roughness: 0.5 }), Math.max(1, halves.length));
  halves.forEach(([a, b, r, z], k) => {
    const dir = b.clone().sub(a), len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    _m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r));
    bonds.setMatrixAt(k, _m);
    bonds.setColorAt(k, _c.set(CPK[z] || '#ff1493'));
  });
  bonds.count = halves.length;
  g.add(bonds);
  molv.scene.add(g);
  molv.group = g;
  let R = 1;
  for (const i of keep) R = Math.max(R, P(i).length());
  const dist = (R + 0.6) / Math.sin(THREE.MathUtils.degToRad(molv.camera.fov / 2)) * (molv.camera.aspect < 1 ? 1 / molv.camera.aspect : 1);
  molv.camera.position.set(0, 0, dist);
  molv.controls.target.set(0, 0, 0);
  molv.controls.update();
  molv.controls.autoRotate = !reduceMotion.matches;
  molv.spinUntil = performance.now() + SPIN_MS;
  wake();
  bus.emit('conformer:shown', { cid: d.cid });      // the 2D depiction waits for this (detail.js)
}

/**
 * Draw the conformer on `selection` (after the panel text, as before), redraw on the Hydrogens toggle, stop the spin when
 * reduced motion is switched on. Returns a function that removes the subscriptions and tears the viewer down.
 */
export function initMolEvents() {
  const ac = new AbortController(), { signal } = ac;
  const off = bus.on('selection', ({ index }) => showMolecule(app.drugs[index]), ORDER.LATE);
  expectConformer(true);
  $('#show-h').addEventListener('change', () => { if (app.selected >= 0) showMolecule(app.drugs[app.selected]); }, { signal });
  reduceMotion.addEventListener('change', () => { if (molv.controls && reduceMotion.matches) molv.controls.autoRotate = false; }, { signal });
  return () => { off(); expectConformer(false); setConformerRetry(null); ac.abort(); molv.dispose?.(); };
}
