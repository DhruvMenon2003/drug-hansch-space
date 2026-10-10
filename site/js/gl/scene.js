// GL layer. The main stage: renderer, CSS2D label layer, scene, camera, lights, orbit controls, the instanced spheres, the
// selection ring and label, the render-on-demand scheduler, the adaptive resolution governor and the context-loss
// helper. Only files under js/gl/ (and boot-gl.js) may import three.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { $, S, anim, app } from '../kernel.js';
import { createScheduler } from '../scheduler.js';
import { createGovernor } from './quality.js';

/**
 * The stage singleton. Filled by initScene(); mutate it, never reassign it.
 * `drugAt[slot]` is the drug index drawn in instance slot `slot` and `slotOf[drug]` its inverse (-1: not drawn): the drawn
 * instances are compacted to the front and `points.count` is their number, so hidden drugs cost no vertex work.
 */
export const stage = {
  renderer: null, labels: null, scene: null, camera: null, controls: null, points: null, axes: null, extras: null, ring: null, selLabel: null,
  loop: null, quality: null, drugAt: null, slotOf: null, warm: [], onResize: null,
  // what the next frame has to redo: instance matrices (inst), title placement (labels), the compaction that follows a
  // finished layout tween (settle), and the animation time the matrices were last written for (t)
  dirty: { inst: true, labels: true, settle: false, t: -1 },
  // set by scenery.js: repaint the instance colours for the current slots
  recolor: null,
};
const _c = new THREE.Color();

/** Ask for one frame of the main stage (no-op before initScene). */
export const wake = () => stage.loop?.invalidate();

/** Sphere geometry: 10 x 7 segments (120 triangles), antialiasing hides the facets. 759 spheres = 91k triangles. */
export const SPHERE_SEGMENTS = [10, 7];

/**
 * Create the renderer, scene, controls and instanced points for the loaded drugs. Needs WebGL and the data.
 * @returns {() => void} dispose(): stops the loop, removes every listener and observer it added and frees the GL objects
 */
export function initScene() {
  const canvas = $('#space'), host = $('.stage-inner');
  const ac = new AbortController(), { signal } = ac;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const loop = createScheduler();
  const quality = createGovernor({
    dpr: devicePixelRatio,
    // resize() re-allocates the drawing buffer; renderNow() paints it again before the browser does (no blank canvas)
    apply: ratio => { renderer.setPixelRatio(ratio); resize(); loop.renderNow(); },
  });
  renderer.setPixelRatio(quality.ratio);
  renderer.setClearColor(0x000000, 0);
  // three restarts its own window rAF when an XR session ends; this app never uses three's loop, so stop it again
  renderer.xr.addEventListener('sessionend', () => renderer.setAnimationLoop(null), { signal });
  const labels = new CSS2DRenderer();
  labels.domElement.style.position = 'absolute';
  labels.domElement.style.inset = '0';
  $('#labels').appendChild(labels.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  camera.position.set(24, 14, 26);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a96, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(12, 24, 16);
  scene.add(sun);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 8;
  controls.maxDistance = 90;
  controls.autoRotateSpeed = 0.6;
  for (const ev of ['change', 'start', 'end']) controls.addEventListener(ev, wake);
  controls.addEventListener('start', () => quality.active());   // back to the learned resolution before the first interactive frame
  // Plain wheel scrolls the page (the tour is scroll-driven); Ctrl/⌘ + wheel or a trackpad pinch zooms.
  host.addEventListener('wheel', e => { if (!e.ctrlKey && !e.metaKey) e.stopImmediatePropagation(); }, { capture: true, signal });

  const n = app.drugs.length;
  const geo = new THREE.SphereGeometry(0.22, ...SPHERE_SEGMENTS);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.0 });
  const points = new THREE.InstancedMesh(geo, mat, n);
  points.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  points.frustumCulled = false;                 // instances move between layouts; keep culling and picking bounds fixed to the plot cube
  points.boundingSphere = new THREE.Sphere(new THREE.Vector3(), S * 2);
  for (let i = 0; i < n; i++) points.setColorAt(i, _c.set('#888888'));
  scene.add(points);

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.48, 40), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, depthTest: false, transparent: true }));
  ring.renderOrder = 10;
  ring.visible = false;
  scene.add(ring);
  const selDiv = document.createElement('div');
  selDiv.className = 'sel-label';
  const selLabel = new CSS2DObject(selDiv);
  selLabel.center.set(0, 1.4);
  selLabel.visible = false;
  scene.add(selLabel);

  Object.assign(stage, { renderer, labels, scene, camera, controls, points, ring, selLabel, loop, quality, drugAt: new Int32Array(n), slotOf: new Int32Array(n).fill(-1) });
  warmShaders();

  const ro = new ResizeObserver(() => { resize(); stage.onResize?.(); loop.renderNow(); });
  ro.observe(host);
  resize();

  // browser zoom or a move to another monitor changes devicePixelRatio: re-derive the rungs and repaint
  watchDpr(dpr => { if (!quality.setDpr(dpr)) { resize(); stage.onResize?.(); loop.renderNow(); } }, signal);
  // fonts arriving change the label widths (CSS2D labels are DOM)
  document.fonts?.ready.then(() => { stage.onResize?.(); wake(); });
  document.fonts?.addEventListener?.('loadingdone', () => { stage.onResize?.(); wake(); }, { signal });
  loop.setOnIdle(() => { quality.idle(); });   // apply() repaints at the full cap

  return function dispose() {
    ac.abort();
    ro.disconnect();
    loop.dispose();
    controls.dispose();
    disposeGroup(stage.axes); disposeGroup(stage.extras);
    scene.remove(points); points.dispose(); geo.dispose(); mat.dispose();
    scene.remove(ring); ring.geometry.dispose(); ring.material.dispose();
    scene.remove(selLabel); selDiv.remove();
    for (const m of stage.warm) m.dispose();
    stage.warm = [];
    labels.domElement.remove();
    renderer.dispose();                           // no forceContextLoss: a lost context cannot be handed to a second renderer on the same canvas
    Object.assign(stage, { renderer: null, labels: null, scene: null, camera: null, controls: null, points: null, axes: null, extras: null, ring: null, selLabel: null, loop: null, quality: null, drugAt: null, slotOf: null, onResize: null });
  };
}

/**
 * Compile the programs the Veber plane and the fitted surface need before they are first used (the first TPSA step used
 * to show a ~13 ms program-compile hitch). The throw-away materials are kept: disposing them would release the programs.
 */
function warmShaders() {
  const { renderer, camera } = stage, warm = new THREE.Scene();
  const plane = new THREE.PlaneGeometry(1, 1);
  const parts = [
    new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, depthWrite: false, transparent: true })),   // Veber plane, fitted surface, selection ring
    new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ wireframe: true, transparent: true })),                              // surface wireframe
    new THREE.LineSegments(new THREE.EdgesGeometry(plane), new THREE.LineBasicMaterial({ transparent: true })),              // plane edge, residual sticks, axes
  ];
  for (const p of parts) { p.frustumCulled = false; warm.add(p); }
  // the light counts are part of every program's cache key, even an unlit material's: mirror the main scene's lights
  warm.add(new THREE.HemisphereLight(), new THREE.DirectionalLight());
  try { renderer.compile(warm, camera); } catch (err) { console.warn('shader pre-warm failed', err); }
  plane.dispose();
  parts[2].geometry.dispose();
  stage.warm = parts.map(p => p.material);
}

/** Fit the renderer, the label layer and the camera to the stage element. */
export function resize() {
  const host = $('.stage-inner'), w = host.clientWidth, h = host.clientHeight;
  if (!w || !h || !stage.renderer) return;
  stage.renderer.setSize(w, h, false);
  stage.labels.setSize(w, h);
  stage.camera.aspect = w / h;
  stage.camera.updateProjectionMatrix();
}

/**
 * Decide which drugs get an instance slot and compact them to the front. While a layout tween runs, a drug is drawn when it is
 * visible at either end of the tween (it grows in or shrinks out); once the tween is over only the visible ones remain.
 * @returns {number} the number of drawn instances (`points.count`)
 */
export function assignSlots() {
  const { drugAt, slotOf, points } = stage, n = app.drugs.length, T = anim.to, F = anim.from, settled = anim.t >= 1;
  let c = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 4 + 3;
    if (T[k] > 0 || (!settled && F[k] > 0)) { drugAt[c] = i; slotOf[i] = c++; } else slotOf[i] = -1;
  }
  points.count = c;
  return c;
}

/** Call `onChange(devicePixelRatio)` whenever the device pixel ratio changes (browser zoom, another monitor). */
export function watchDpr(onChange, signal) {
  const arm = () => matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { onChange(devicePixelRatio); arm(); }, { once: true, signal });
  arm();
}

/**
 * Tell the page the GL context was lost or came back. Calls preventDefault() on loss (so the browser may restore it).
 * @param {HTMLCanvasElement} canvas @param {{ onLost?: () => void, onRestored?: () => void }} handlers @param {AbortSignal} [signal]
 */
export function watchContext(canvas, { onLost, onRestored }, signal) {
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); onLost?.(); }, { signal });
  canvas.addEventListener('webglcontextrestored', () => onRestored?.(), { signal });
}

/**
 * Remove `g` from its parent and free what it owns: geometries, materials (single or array) and their textures, the GPU
 * buffers of instanced meshes (InstancedMesh.dispose), the DOM element of CSS2D labels, and any gsap tween still aimed at
 * one of its materials (a fade that outlives its material would keep the ticker busy and write to freed objects).
 */
export function disposeGroup(g) {
  if (!g) return;
  g.parent?.remove(g);
  // CSS2D labels only drop their DOM element when they themselves are removed, not when an ancestor group is
  g.traverse(o => {
    o.geometry?.dispose();
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      window.gsap?.killTweensOf(m);
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose?.();
    }
    if (o.isInstancedMesh) o.dispose();
    if (o.isCSS2DObject) o.element.remove();
  });
}
