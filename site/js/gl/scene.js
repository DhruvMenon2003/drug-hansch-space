// GL layer. The main stage: renderer, CSS2D label layer, scene, camera, lights, orbit controls, the instanced spheres, the
// selection ring and label. Only files under js/gl/ (and boot-gl.js) may import three.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { $, S, app } from '../kernel.js';

/** The stage singleton. Filled by initScene(); mutate it, never reassign it. */
export const stage = { renderer: null, labels: null, scene: null, camera: null, controls: null, points: null, axes: null, extras: null, ring: null, selLabel: null };
const _c = new THREE.Color();

/** Create the renderer, scene, controls and instanced points for the loaded drugs. Needs WebGL and the data. */
export function initScene() {
  const canvas = $('#space'), host = $('.stage-inner');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
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
  // Plain wheel scrolls the page (the tour is scroll-driven); Ctrl/⌘ + wheel or a trackpad pinch zooms.
  host.addEventListener('wheel', e => { if (!e.ctrlKey && !e.metaKey) e.stopImmediatePropagation(); }, { capture: true });

  const n = app.drugs.length;
  const geo = new THREE.SphereGeometry(0.22, 18, 12);
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

  Object.assign(stage, { renderer, labels, scene, camera, controls, points, ring, selLabel });
  new ResizeObserver(resize).observe(host);
  resize();
}

/** Fit the renderer, the label layer and the camera to the stage element. */
export function resize() {
  const host = $('.stage-inner'), w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  stage.renderer.setSize(w, h, false);
  stage.labels.setSize(w, h);
  stage.camera.aspect = w / h;
  stage.camera.updateProjectionMatrix();
}

/**
 * Remove `g` from its parent and free what it owns: geometries, materials (single or array) and their textures, the GPU
 * buffers of instanced meshes (InstancedMesh.dispose), and the DOM element of CSS2D labels.
 */
export function disposeGroup(g) {
  if (!g) return;
  g.parent?.remove(g);
  // CSS2D labels only drop their DOM element when they themselves are removed, not when an ancestor group is
  g.traverse(o => {
    o.geometry?.dispose();
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose?.();
    }
    if (o.isInstancedMesh) o.dispose();
    if (o.isCSS2DObject) o.element.remove();
  });
}
