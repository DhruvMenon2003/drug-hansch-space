// Layer 4 (GL). The ligand-binding overlay: the drug's pocket, taken from a PDB co-crystal, with the ligand coming in along
// the approach vector, slowing, and seating itself in the pocket, after which the contacts it touches are named.
//
// WHAT THE GEOMETRY IS, AND WHAT IT IS NOT. Everything drawn here is read from data/binding/<target>.json, which tools
// built from one PDB co-crystal structure of that receptor: the pocket residues and their atoms, the backbone trace, the
// crystallographic ligand, and the contacts measured in that crystal. Each drug's pose is the crystal ligand's pose with
// the drug's shared substructure (its maximum common substructure) laid onto it, so it is an alignment, not a docking
// calculation. The path the ligand travels is the least-obstructed straight line out of the pocket in that same crystal,
// found by sampling directions; it is a way of showing the pocket's mouth, not a simulated binding trajectory or a
// kinetic pathway. The animation says nothing about affinity, residence time or mechanism.
import * as THREE from 'three';
import { matte, outline, softLights } from './chimera.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { $, app, bus, esc, cap, fx, reduceMotion } from '../kernel.js';
import { announce } from '../announce.js';
import { createScheduler } from '../scheduler.js';
import { disposeGroup, watchContext, watchDpr } from './scene.js';
import { CPK } from './molviewer.js';

const INDEX = 'data/binding/index.json';
/** How long the ligand takes to come in, and the share of that time after which the contacts appear. */
const FLY_MS = 3200, CONTACT_AT = 0.72;
/** Residues further than this from the ligand are left to the backbone trace, so the ligand stays readable. */
const NEAR_A = 7.5;
const _m = new THREE.Matrix4(), _c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);

/** The overlay singleton. Mutate it, never reassign it. */
const bv = { renderer: null, scene: null, camera: null, controls: null, group: null, lig: null, contacts: null, loop: null, open: false, id: null, sc: null, tween: null, fit: null, dispose: null };
const wake = () => bv.loop?.invalidate();
let index = null, scenes = new Map(), started = false;

/**
 * Which scene a drug belongs to. The Hansch target groups answer this for free and for most drugs, because a scene is keyed
 * by the same mechanism target. The groups cover only the drugs that were fitted, though, so when they miss, the scenes
 * themselves are read once (they carry the CID of every pose) and the answer is cached for the rest of the page.
 */
function sceneIdFor(d) {
  if (!index) return null;
  for (const s of index.scenes) if (app.groups.get(s.id)?.cids.has(d.cid)) return s.id;
  return null;
}

let cidMap = null;
/** cid -> scene id, built from every scene's poses. One crawl of the 20 scene files, and only when a group lookup missed. */
function allPoses() {
  cidMap ||= Promise.all(index.scenes.map(s => loadScene(s.id).then(sc => [s.id, sc]).catch(() => null))).then(got => {
    const m = new Map();
    for (const pair of got) if (pair) for (const p of pair[1].poses) if (!m.has(p.cid)) m.set(p.cid, pair[0]);
    return m;
  });
  return cidMap;
}

const getJson = url => fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${url}: HTTP ${r.status}`))));
const loadIndex = () => (index ? Promise.resolve(index) : getJson(INDEX).then(j => (index = j)));
function loadScene(id) {
  if (!scenes.has(id)) scenes.set(id, getJson(`data/binding/${id}.json`));
  return scenes.get(id);
}

function initViewer() {
  const canvas = $('#bind-canvas'), ac = new AbortController(), { signal } = ac;
  bv.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  bv.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  bv.loop = createScheduler();
  bv.scene = new THREE.Scene();
  bv.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
  softLights(bv.scene, bv.camera);
  bv.scene.add(bv.camera);
  bv.controls = new OrbitControls(bv.camera, canvas);
  bv.controls.enableDamping = true;
  bv.controls.enablePan = false;
  for (const ev of ['change', 'start', 'end']) bv.controls.addEventListener(ev, wake);
  const fit = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    bv.renderer.setSize(w, h, false);
    bv.camera.aspect = w / h;
    bv.camera.updateProjectionMatrix();
    bv.loop.renderNow();                         // resizing clears the buffer: draw again before the browser paints
  };
  bv.fit = fit;
  const ro = new ResizeObserver(fit);
  ro.observe(canvas);
  watchDpr(dpr => { bv.renderer.setPixelRatio(Math.min(dpr, 2)); fit(); }, signal);
  watchContext(canvas, {
    onLost() { bv.loop.pause(); announce('The binding view lost its graphics context and is restoring.'); },
    onRestored() { bv.loop.resume(); fit(); },
  }, signal);
  bv.loop.setRender(() => {
    if (!bv.open || !bv.group) return false;
    const moved = bv.controls.update();
    bv.renderer.render(bv.scene, bv.camera);
    return moved === true || !!bv.tween?.isActive?.();
  });
  bv.dispose = () => {
    ac.abort(); ro.disconnect(); bv.tween?.kill(); bv.loop.dispose(); bv.controls.dispose();
    disposeGroup(bv.group); bv.group = null;
    bv.renderer.dispose();
    Object.assign(bv, { renderer: null, scene: null, camera: null, controls: null, loop: null, group: null, lig: null, contacts: null, sc: null, fit: null, dispose: null });
  };
  fit();
}

/** Ball and stick for one molecule {e, xyz, b}, drawn exactly as the conformer viewer draws a conformer. */
function ballStick(mol, scale = 1) {
  const g = new THREE.Group(), n = mol.e.length;
  const P = i => new THREE.Vector3(mol.xyz[3 * i], mol.xyz[3 * i + 1], mol.xyz[3 * i + 2]);
  const rad = z => (z === 1 ? 0.17 : z <= 10 ? 0.3 : z <= 18 ? 0.36 : 0.42) * scale;
  const atoms = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), matte(), n);
  for (let i = 0; i < n; i++) {
    const r = rad(mol.e[i]);
    atoms.setMatrixAt(i, _m.makeScale(r, r, r).setPosition(P(i)));
    atoms.setColorAt(i, _c.set(CPK[mol.e[i]] || '#ff1493'));
  }
  g.add(atoms);
  outline(atoms, 0.14);
  const halves = [], q = new THREE.Quaternion();
  for (let k = 0; k < (mol.b?.length || 0); k += 3) {
    const [i, j, o] = [mol.b[k], mol.b[k + 1], mol.b[k + 2]];
    const a = P(i), b = P(j), dir = b.clone().sub(a);
    const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 * dir.length() ? UP : new THREE.Vector3(1, 0, 0)).normalize();
    const sticks = o === 2 ? [[-0.07, 0.055], [0.07, 0.055]] : o === 3 ? [[-0.1, 0.045], [0, 0.045], [0.1, 0.045]] : o === 4 ? [[0, 0.07], [0.12, 0.035]] : [[0, 0.08]];
    for (const [off, r] of sticks) {
      const sh = side.clone().multiplyScalar(off * scale), a2 = a.clone().add(sh), b2 = b.clone().add(sh), mid = a2.clone().add(b2).multiplyScalar(0.5);
      halves.push([a2, mid, r * scale, mol.e[i]], [mid, b2, r * scale, mol.e[j]]);
    }
  }
  const bonds = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1), matte(), Math.max(1, halves.length));
  halves.forEach(([a, b, r, z], k) => {
    const dir = b.clone().sub(a), len = dir.length();
    q.setFromUnitVectors(UP, dir.normalize());
    _m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r));
    bonds.setMatrixAt(k, _m);
    bonds.setColorAt(k, _c.set(CPK[z] || '#ff1493'));
  });
  bonds.count = halves.length;
  g.add(bonds);
  outline(bonds, 0.45);
  return g;
}

/** The pocket: its backbone trace, its residue atoms coloured by what kind of residue they belong to, and nothing else. */
function pocket(sc) {
  const T = app.tokens, g = new THREE.Group();
  const hue = { polar: T.s1 || '#2a78d6', apolar: T.point || '#7a8a85', charged: T.s2 || '#eb6834' };
  for (const [a, b] of sc.trace.seg) {
    const pts = [];
    for (let i = a; i <= b; i++) pts.push(new THREE.Vector3(sc.trace.xyz[3 * i], sc.trace.xyz[3 * i + 1], sc.trace.xyz[3 * i + 2]));
    // a smooth backbone tube, ChimeraX-style, instead of a jagged CA polyline
    if (pts.length > 1) g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 6, 0.22, 8), new THREE.MeshStandardMaterial({ color: new THREE.Color('#b9c3c9'), roughness: 0.85, transparent: true, opacity: 0.38, depthWrite: false })));
  }
  // only the residues that line the site are drawn as atoms: the whole 10 Å shell is a cloud the ligand disappears into
  const near = [];
  for (let i = 0; i < sc.atoms.e.length; i++) if ((sc.res[sc.atoms.r[i]]?.d ?? 99) <= NEAR_A) near.push(i);
  const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.85, transparent: true, opacity: 0.55 }), Math.max(1, near.length));
  near.forEach((i, j) => {
    const r = sc.atoms.e[i] === 6 ? 0.24 : 0.28;
    balls.setMatrixAt(j, _m.makeScale(r, r, r).setPosition(new THREE.Vector3(sc.atoms.xyz[3 * i], sc.atoms.xyz[3 * i + 1], sc.atoms.xyz[3 * i + 2])));
    balls.setColorAt(j, _c.set(hue[sc.res[sc.atoms.r[i]]?.k] || hue.apolar));
  });
  balls.count = near.length;
  g.add(balls);
  g.userData.nearRes = new Set(near.map(i => sc.atoms.r[i])).size;
  return g;
}

/**
 * The measured contacts as thin sticks, hidden until the ligand is nearly seated. They are drawn from the crystallographic
 * ligand's atoms, because that is the molecule they were measured on: a drug laid onto it by its shared substructure has
 * its own atom numbering, so drawing them from the drug's atoms would name the wrong atom.
 */
function contactSticks(sc) {
  const T = app.tokens, mol = sc.bound, g = new THREE.Group(), q = new THREE.Quaternion();
  const list = sc.contacts.filter(c => c.a < mol.e.length);
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }), Math.max(1, list.length));
  list.forEach((c, k) => {
    const a = new THREE.Vector3(mol.xyz[3 * c.a], mol.xyz[3 * c.a + 1], mol.xyz[3 * c.a + 2]);
    const b = new THREE.Vector3(sc.atoms.xyz[3 * c.p], sc.atoms.xyz[3 * c.p + 1], sc.atoms.xyz[3 * c.p + 2]);
    const dir = b.clone().sub(a), len = dir.length();
    q.setFromUnitVectors(UP, dir.clone().normalize());
    _m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(0.035, len, 0.035));
    mesh.setMatrixAt(k, _m);
    mesh.setColorAt(k, _c.set((c.t === 'hb' ? T.s1 : T.s2) || '#2a78d6'));
  });
  mesh.count = list.length;
  g.add(mesh);
  g.userData.material = mesh.material;
  return { group: g, list };
}

/** The caption: what crystal this is, which pose is shown, and the residues the ligand touches. */
function caption(sc, pose, d) {
  const p = sc.pdb;
  $('#bind-h').textContent = `${cap(d.name)} in ${sc.target}`;
  $('#bind-what').textContent = `${pose.xtal ? 'The crystallographic ligand itself' : `${cap(d.name)} placed on the crystallographic ligand by its ${pose.mcs}-atom shared substructure`}, in the pocket of PDB ${p.id} (${p.method}${p.resolution ? `, ${fx(p.resolution, 2)} Å` : ''}). ${sc.res.length} pocket residues were measured; the ${NEAR_A} Å shell around the ligand is drawn as atoms and the rest as the backbone trace. ${pose.xtal ? '' : 'The crystallographic ligand is left in place as a ghost. '}The contacts listed, and the sticks drawn, are the ones that ligand makes in this structure. The path in is the least obstructed straight line out of this crystal's pocket, not a docking or a simulation.`;
  const seen = new Map();
  for (const c of sc.contacts.filter(c => c.a < sc.bound.e.length)) {
    const r = sc.res[sc.atoms.r[c.p]];
    if (!r) continue;
    const key = `${r.n} ${r.c}${r.i}`;
    if (!seen.has(key) || seen.get(key).d > c.d) seen.set(key, { ...c, label: key });
  }
  const rows = [...seen.values()].sort((a, b) => a.d - b.d);
  $('#bind-contacts').innerHTML = rows.length
    ? rows.map(c => `<li><b>${esc(c.label)}</b> <span class="${c.t}">${c.t === 'hb' ? 'hydrogen bond' : 'hydrophobic'}</span> ${fx(c.d, 2)} Å</li>`).join('')
    : '<li>No contact in this crystal is within the measured cut-offs.</li>';
  $('#bind-cite').textContent = `Pocket, ligand and contact distances from PDB ${p.id}: ${p.title}. Deposited ${p.deposited}. Contacts within ${index.hbond_a} Å (polar) and ${index.hydrophobic_a} Å (apolar) of a pocket atom.`;
}

/** Build the scene for drug `d` and play the approach. */
async function show(d) {
  const id = sceneIdFor(d) || (await allPoses()).get(d.cid);
  if (!id) return false;
  let sc;
  try { sc = await loadScene(id); } catch { scenes.delete(id); return false; }
  const pose = sc.poses.find(p => p.cid === d.cid) || { ...sc.bound, cid: d.cid, name: d.name, mcs: 0, xtal: true };
  if (!bv.renderer) initViewer();
  disposeGroup(bv.group);
  bv.group = new THREE.Group();
  bv.id = id;
  bv.group.add(pocket(sc));
  const lig = ballStick(pose);
  const { group: cg } = contactSticks(sc);
  bv.group.add(lig, cg);
  if (!pose.xtal) {
    // the crystallographic ligand stays as a ghost: it is what the contacts were measured on, and what the drug was laid onto
    const ghost = ballStick(sc.bound, 0.55);
    ghost.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = 0.16; o.material.depthWrite = false; } });
    bv.group.add(ghost);
  }
  bv.lig = lig;
  bv.contacts = cg;
  bv.scene.add(bv.group);
  caption(sc, pose, d);
  // frame the ligand with a little of the pocket around it, the way the conformer viewer frames a conformer
  let R = 1;
  for (let i = 0; i < pose.e.length; i++) R = Math.max(R, Math.hypot(pose.xyz[3 * i], pose.xyz[3 * i + 1], pose.xyz[3 * i + 2]));
  R += 4;
  const dist = R / Math.sin(THREE.MathUtils.degToRad(bv.camera.fov / 2)) * (bv.camera.aspect < 1 ? 1 / bv.camera.aspect : 1);
  bv.camera.position.set(0.45, 0.25, 0.86).multiplyScalar(dist);
  bv.controls.target.set(0, 0, 0);
  bv.controls.update();
  bv.sc = sc;
  return true;                                   // the approach is played once the overlay is on screen, not before
}

/** The approach: in along the approach vector, fast then slowing into the pocket, then the contacts fade up. */
function play(sc) {
  const dir = new THREE.Vector3(...sc.approach).normalize(), start = Math.max(9, sc.radius * 0.55);
  const mat = bv.contacts?.userData.material;
  bv.tween?.kill();
  if (reduceMotion.matches || !window.gsap) {
    bv.lig.position.set(0, 0, 0);
    if (mat) mat.opacity = 0.9;
    wake();
    return;
  }
  const state = { t: 0 };
  bv.lig.position.copy(dir).multiplyScalar(start);
  if (mat) mat.opacity = 0;
  bv.tween = window.gsap.to(state, {
    t: 1, duration: FLY_MS / 1000, ease: 'power2.out',
    onUpdate() {
      bv.lig.position.copy(dir).multiplyScalar(start * (1 - state.t));
      if (mat) mat.opacity = state.t < CONTACT_AT ? 0 : ((state.t - CONTACT_AT) / (1 - CONTACT_AT)) * 0.9;
      wake();
    },
    onComplete: wake,
  });
  wake();
}

/** Open the overlay on the selected drug, or close it if it is open. */
export async function toggleOverlay() {
  if (bv.open) { close(); return; }
  const d = app.drugs[app.selected];
  if (!d) return;
  const btn = $('#d-bind');
  try { await loadIndex(); } catch { note('The binding data could not be loaded.'); return; }
  const ok = await show(d);
  if (!ok) { note(`There is no annotated receptor pocket for ${cap(d.name)}.`); return; }
  note('');
  bv.open = true;
  $('#bind').hidden = false;
  btn?.setAttribute('aria-expanded', 'true');
  bv.loop.resume();
  bv.fit?.();                                    // the canvas had no size while the overlay was hidden
  play(bv.sc);
  bv.loop.renderNow();
  $('#bind-close').focus();
  announce(`${$('#bind-h').textContent}. The ligand is coming into the pocket.`);
}

/** Close the overlay, stop drawing and put the focus back on the button that opened it. */
export function close() {
  if (!bv.open) return;
  bv.open = false;
  bv.tween?.kill();
  $('#bind').hidden = true;
  bv.loop?.pause();
  $('#d-bind')?.setAttribute('aria-expanded', 'false');
  $('#d-bind')?.focus();
}

const note = text => { const el = $('#d-bind-note'); if (el) { el.textContent = text; if (text) announce(text); } };

/** Bind the overlay's own controls. Called once, by js/extras.js, on the first press of the button or the B key. */
export function initBinding() {
  if (started) return;
  started = true;
  $('#bind-close').addEventListener('click', close);
  $('#bind-replay').addEventListener('click', () => { if (bv.sc) play(bv.sc); });
  $('#bind').addEventListener('click', e => { if (e.target === $('#bind')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && bv.open && !e.defaultPrevented) { e.preventDefault(); close(); } });
  // a new drug closes the overlay rather than showing the old pocket under a new name
  bus.on('selection', () => { if (bv.open) close(); note(''); });
}
