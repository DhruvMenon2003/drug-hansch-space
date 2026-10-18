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
import { loadMolecule } from '../data.js';

const INDEX = 'data/binding/index.json';
/** How long the ligand takes to come in, and the share of that time after which the contacts appear. */
const FLY_MS = 3200, CONTACT_AT = 0.72;
/** Residues further than this from the ligand are left to the backbone trace, so the ligand stays readable. */
const NEAR_A = 7.5;
const _m = new THREE.Matrix4(), _c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);

/** The overlay singleton. Mutate it, never reassign it. */
const bv = { renderer: null, scene: null, camera: null, controls: null, group: null, lig: null, contacts: null, loop: null, open: false, id: null, sc: null, anim: null, labels: null, trail: null, q0: null, dist: 0, fit: null, dispose: null };
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
    const run = bv.anim?.playing;
    if (run) step();
    return moved === true || !!run;
  });
  bv.dispose = () => {
    ac.abort(); ro.disconnect(); bv.loop.dispose(); bv.controls.dispose();
    disposeGroup(bv.group); bv.group = null;
    bv.renderer.dispose();
    Object.assign(bv, { renderer: null, scene: null, camera: null, controls: null, loop: null, group: null, lig: null, contacts: null, sc: null, fit: null, dispose: null });
  };
  fit();
}

/** Ball and stick for one molecule {e, xyz, b}, drawn exactly as the conformer viewer draws a conformer. */
function ballStick(mol, scale = 1, carbon = null) {
  const g = new THREE.Group(), n = mol.e.length;
  const P = i => new THREE.Vector3(mol.xyz[3 * i], mol.xyz[3 * i + 1], mol.xyz[3 * i + 2]);
  const rad = z => (z === 1 ? 0.17 : z <= 10 ? 0.3 : z <= 18 ? 0.36 : 0.42) * scale;
  const atoms = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), matte(), n);
  for (let i = 0; i < n; i++) {
    const r = rad(mol.e[i]);
    atoms.setMatrixAt(i, _m.makeScale(r, r, r).setPosition(P(i)));
    atoms.setColorAt(i, _c.set((carbon && mol.e[i] === 6 ? carbon : CPK[mol.e[i]]) || '#ff1493'));
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
    bonds.setColorAt(k, _c.set((carbon && z === 6 ? carbon : CPK[z]) || '#ff1493'));
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
  // the chain as a ChimeraX-style cartoon: a thick ribbon coloured blue at the N terminus to red at the C terminus
  const nTot = sc.trace.xyz.length / 3;
  for (const [a, b] of sc.trace.seg) {
    const pts = [];
    for (let i = a; i <= b; i++) pts.push(new THREE.Vector3(sc.trace.xyz[3 * i], sc.trace.xyz[3 * i + 1], sc.trace.xyz[3 * i + 2]));
    if (pts.length < 2) continue;
    const tub = pts.length * 6, rad = 10;
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), tub, 0.62, rad);
    // flatten the tube into a ribbon: squash it along its binormal
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), path = geo.parameters.path, fr = path.computeFrenetFrames(tub, false);
    for (let k = 0; k <= tub; k++) {
      const c = path.getPointAt(k / tub), B = fr.binormals[k];
      _c.setHSL(0.66 * (1 - (a + (b - a) * k / tub) / Math.max(1, nTot - 1)), 0.62, 0.58);
      for (let r = 0; r <= rad; r++) {
        const v = k * (rad + 1) + r, x = pos.getX(v) - c.x, y = pos.getY(v) - c.y, z = pos.getZ(v) - c.z;
        const along = x * B.x + y * B.y + z * B.z;
        pos.setXYZ(v, pos.getX(v) - B.x * along * 0.6, pos.getY(v) - B.y * along * 0.6, pos.getZ(v) - B.z * along * 0.6);
        col.set([_c.r, _c.g, _c.b], 3 * v);
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, transparent: true, opacity: 0.72, depthWrite: false })));
  }
  // the residues the ligand touches are drawn as sticks (ChimeraX's "show contacts" look); the rest of the 7.5 A shell as
  // faint dots that give the pocket its shape without hiding the ligand
  const touch = new Set(sc.contacts.filter(c => c.a < sc.bound.e.length).map(c => sc.atoms.r[c.p]));
  const near = [], hot = [];
  for (let i = 0; i < sc.atoms.e.length; i++) {
    const r = sc.atoms.r[i];
    if (touch.has(r)) hot.push(i); else if ((sc.res[r]?.d ?? 99) <= NEAR_A) near.push(i);
  }
  const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.9, transparent: true, opacity: 0.32, depthWrite: false }), Math.max(1, near.length));
  near.forEach((i, j) => {
    balls.setMatrixAt(j, _m.makeScale(0.2, 0.2, 0.2).setPosition(new THREE.Vector3(sc.atoms.xyz[3 * i], sc.atoms.xyz[3 * i + 1], sc.atoms.xyz[3 * i + 2])));
    balls.setColorAt(j, _c.set(hue[sc.res[sc.atoms.r[i]]?.k] || hue.apolar));
  });
  balls.count = near.length;
  // an artistic fold draws its helices as cylinders (ChimeraX's "cartoon style tube" look)
  (sc.rods || []).forEach(([base, u, len], k) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(1.8, len, 6, 18), new THREE.MeshStandardMaterial({ color: _c.setHSL(0.66 * (1 - k / Math.max(1, sc.rods.length - 1)), 0.55, 0.6).clone(), roughness: 0.5, transparent: true, opacity: 0.42, depthWrite: false }));
    m.position.copy(base).addScaledVector(u, len / 2);
    m.quaternion.setFromUnitVectors(UP, u);
    g.add(m);
  });
  // cartoon style: no atom cloud; the ribbon carries the fold and the contact residues carry the chemistry
  if (hot.length) {
    // bonds inferred from distance within each residue: the scene files carry atoms, not residue topology
    const xyz = new Float32Array(hot.length * 3), e = [], b = [];
    hot.forEach((i, k) => { xyz.set(sc.atoms.xyz.slice(3 * i, 3 * i + 3), 3 * k); e.push(sc.atoms.e[i]); });
    for (let x = 0; x < hot.length; x++) for (let y = x + 1; y < hot.length; y++) {
      if (sc.atoms.r[hot[x]] !== sc.atoms.r[hot[y]]) continue;
      const d = Math.hypot(xyz[3 * x] - xyz[3 * y], xyz[3 * x + 1] - xyz[3 * y + 1], xyz[3 * x + 2] - xyz[3 * y + 2]);
      if (d < (e[x] === 16 || e[y] === 16 ? 1.95 : 1.7)) b.push(x, y, 1);
    }
    g.add(ballStick({ e, xyz, b }, 0.62, '#b7bfc7'));
  }
  g.userData.touch = touch;
  return g;
}

/**
 * The measured contacts as dashed lines, the way ChimeraX and PLIP draw them: blue for hydrogen bonds, amber for apolar
 * contacts. They are drawn from the crystallographic ligand's atoms, because that is the molecule they were measured on: a
 * drug laid onto it by its shared substructure has its own atom numbering, so drawing them from the drug's atoms would name
 * the wrong atom. Hidden until the ligand is nearly seated.
 */
function contactSticks(sc) {
  const T = app.tokens, mol = sc.bound, g = new THREE.Group(), q = new THREE.Quaternion();
  const list = sc.contacts.filter(c => c.a < mol.e.length);
  const dashes = [];
  for (const c of list) {
    const a = new THREE.Vector3(mol.xyz[3 * c.a], mol.xyz[3 * c.a + 1], mol.xyz[3 * c.a + 2]);
    const b = new THREE.Vector3(sc.atoms.xyz[3 * c.p], sc.atoms.xyz[3 * c.p + 1], sc.atoms.xyz[3 * c.p + 2]);
    const dir = b.clone().sub(a), len = dir.length(), n = Math.max(2, Math.round(len / 0.36));
    dir.normalize();
    for (let k = 0; k < n; k += 2) dashes.push([a.clone().addScaledVector(dir, (k + 0.5) * len / n), dir, len / n, c.t]);
  }
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), Math.max(1, dashes.length));
  dashes.forEach(([p, dir, l, t], k) => {
    q.setFromUnitVectors(UP, dir);
    const w = t === 'hb' ? 0.055 : 0.04;
    _m.compose(p, q, new THREE.Vector3(w, l, w));
    mesh.setMatrixAt(k, _m);
    mesh.setColorAt(k, _c.set(t === 'hb' ? '#2f8fe8' : (T.s2 || '#e0902f')));
  });
  mesh.count = dashes.length;
  g.add(mesh);
  g.userData.material = mesh.material;
  return { group: g, list };
}

/** A text label that stays the same size on screen and is never hidden behind atoms. */
function label(text, color) {
  const dpr = 2, fs = 26, c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = `600 ${fs}px system-ui, sans-serif`;
  const w = Math.ceil(x.measureText(text).width) + 20, h = fs + 14;
  c.width = w * dpr; c.height = h * dpr;
  x.scale(dpr, dpr);
  x.font = `600 ${fs}px system-ui, sans-serif`;
  x.fillStyle = 'rgba(20,22,26,0.78)';
  x.beginPath(); x.roundRect(0, 0, w, h, h / 2); x.fill();
  x.fillStyle = color; x.textBaseline = 'middle'; x.fillText(text, 10, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, sizeAttenuation: false }));
  sp.scale.set(0.00105 * w, 0.00105 * h, 1);
  sp.renderOrder = 10;
  return sp;
}

/** One label per touched residue, at the residue's centre, pushed a little outward so it does not sit on the ligand. */
function residueLabels(sc, touch) {
  const g = new THREE.Group(), kinds = new Map();
  for (const c of sc.contacts) if (c.a < sc.bound.e.length) { const r = sc.atoms.r[c.p]; if (kinds.get(r) !== 'hb') kinds.set(r, c.t); }
  for (const r of touch) {
    const res = sc.res[r];
    if (!res) continue;
    const p = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < sc.atoms.e.length; i++) if (sc.atoms.r[i] === r) { p.x += sc.atoms.xyz[3 * i]; p.y += sc.atoms.xyz[3 * i + 1]; p.z += sc.atoms.xyz[3 * i + 2]; n++; }
    if (!n) continue;
    p.divideScalar(n);
    p.addScaledVector(p.clone().normalize(), 1.2);
    const sp = label(`${cap(res.n.toLowerCase())}${res.i}`, kinds.get(r) === 'hb' ? '#8cc6ff' : '#ffc979');
    sp.position.copy(p);
    g.add(sp);
  }
  return g;
}

/** The approach path: a dotted line from where the ligand starts to the pocket, fading once the ligand is seated. */
function approachTrail(dir, start) {
  const pts = [];
  for (let k = 0; k <= 60; k++) pts.push(dir.clone().multiplyScalar(start * k / 60));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#8fa3b5', size: 3, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
  return line;
}

/** Target artwork: the RCSB PDB image of the receptor structure (tools/build_art.py), shown as a linked, credited inset. */
let artIndex = null;
async function artCard(sc, d) {
  const a = $('#bind-art'), token = bv.id;
  a.hidden = true;
  try { artIndex ||= await getJson('data/art.json'); } catch { return; }
  const hit = artIndex.drugs[d.cid];
  const id = (sc.art ? hit?.pdb : sc.pdb?.id)?.toLowerCase();
  if (!id || !artIndex.pdbs.includes(id)) return;
  const who = sc.art ? hit.target : sc.target;
  a.href = `https://www.rcsb.org/structure/${id.toUpperCase()}`;
  a.querySelector('img').src = `art/${id}.webp`;
  a.querySelector('img').alt = `${who}, PDB structure ${id.toUpperCase()}`;
  a.querySelector('span').textContent = `${who} · PDB ${id.toUpperCase()} · image RCSB PDB`;
  a.title = `Open PDB ${id.toUpperCase()} on rcsb.org`;
  if (bv.id !== token) return;                    // another drug was opened while the index loaded
  if (sc.art) $('#bind-what').textContent += ` The inset is a real structure of ${who}, the target ChEMBL lists for ${cap(d.name)} (${hit.moa ? hit.moa.toLowerCase() : 'mechanism of action'}), as rendered by the RCSB PDB.`;
  a.hidden = false;
}

/** The caption: what crystal this is, which pose is shown, and the residues the ligand touches. */
function caption(sc, pose, d) {
  const p = sc.pdb;
  if (sc.art) {
    $('#bind-h').textContent = `${cap(d.name)}: an artistic view`;
    $('#bind-what').textContent = `There is no annotated co-crystal for ${cap(d.name)} in this site's data, so this is an illustration: ${sc.target} drawn as a cartoon fold, with ${cap(d.name)}'s own 3D conformer settling into it. The fold, the pocket and the pose are not measured, and no contacts are claimed. For a real pose, dock the conformer with a program such as AutoDock Vina.`;
    $('#bind-contacts').innerHTML = '<li>Illustration: no measured contacts</li>';
    $('#bind-cite').textContent = `Ligand geometry: the drug's 3D conformer (${d.conf || 'PubChem / RDKit'}). Receptor: illustrative only.`;
    return;
  }
  $('#bind-h').textContent = `${cap(d.name)} in ${sc.target}`;
  $('#bind-what').textContent = `${pose.xtal ? 'The crystallographic ligand itself' : `${cap(d.name)} placed on the crystallographic ligand by its ${pose.mcs}-atom shared substructure`}, in the pocket of PDB ${p.id} (${p.method}${p.resolution ? `, ${fx(p.resolution, 2)} Å` : ''}). ${sc.res.length} pocket residues were measured; the residues the ligand touches are drawn as sticks, the rest of the ${NEAR_A} Å shell as faint dots and the chain as a ribbon. ${pose.xtal ? '' : 'The crystallographic ligand is left in place as a ghost. '}The contacts listed, and the dashed lines drawn, are the ones that ligand makes in this structure. The dotted path in is the least obstructed straight line out of this crystal's pocket, and the tumble on the way in is decoration: this is not a docking or a simulation. Scores and poses belong to a docking program such as AutoDock Vina.`;
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

/**
 * An ARTISTIC receptor for a drug with no annotated co-crystal: a cartoon fold drawn from simple helices (a seven-helix
 * bundle for receptors, a globular helix cluster otherwise) with the drug's own 3D conformer settling into a cleft at the
 * centre. Nothing here is measured: no residues, no contacts, no pose. It is an illustration, and the caption says so.
 */
function artScene(d, m) {
  const xyz = [], seg = [];
  const rods = [];
  const helix = (base, axis, len) => {
    rods.push([base.clone(), axis.clone().normalize(), len * 1.5]);
    const start = xyz.length / 3, u = axis.clone().normalize(), w = new THREE.Vector3().crossVectors(u, Math.abs(u.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)).normalize(), v = new THREE.Vector3().crossVectors(u, w);
    for (let i = 0; i < len; i++) {
      const t = i * 1.745, p = base.clone().addScaledVector(u, i * 1.5).addScaledVector(w, 2.3 * Math.cos(t)).addScaledVector(v, 2.3 * Math.sin(t));
      xyz.push(p.x, p.y, p.z);
    }
    return [start, xyz.length / 3 - 1];
  };
  const names = app.meta.atc_names || {}, code = d.atc?.[0]?.code || '';
  const what = names[code.slice(0, 5)] || names[code.slice(0, 4)] || names[code.slice(0, 3)] || 'target';
  const gpcr = /receptor|antagon|agonist|blocker|antihistamin/i.test(what);
  let prev = null;
  const link = (s0, s1) => { if (prev != null) seg.push([prev, s0]); prev = s1; };
  if (gpcr) {
    // seven transmembrane helices around a central pocket open to the top (+y), up and down alternately
    for (let h = 0; h < 7; h++) {
      const ang = 2 * Math.PI * h / 7, r = 8.5, up = h % 2 === 0;
      const base = new THREE.Vector3(r * Math.cos(ang), up ? -24 : 6, r * Math.sin(ang));
      const [s0, s1] = helix(base, new THREE.Vector3(0.12 * Math.sin(ang), up ? 1 : -1, -0.12 * Math.cos(ang)), 20);
      seg.push([s0, s1]); link(s0, s1);
    }
  } else {
    // a globular cluster of helices on a sphere, leaving a cleft facing +y
    for (let h = 0; h < 9; h++) {
      const phi = Math.acos(-0.95 + 1.5 * h / 8), th = h * 2.4, r = 12;
      const c = new THREE.Vector3(r * Math.sin(phi) * Math.cos(th), -r * Math.cos(phi) - 2, r * Math.sin(phi) * Math.sin(th));
      const ax = new THREE.Vector3(-Math.sin(th), 0.4, Math.cos(th));
      const [s0, s1] = helix(c.clone().addScaledVector(ax.clone().normalize(), -9), ax, 13);
      seg.push([s0, s1]); link(s0, s1);
    }
  }
  // the loops between helices, as their own trace segments, bowed outward so they read as loops
  const loops = [];
  for (let k = 0; k + 1 < rods.length; k++) {
    const A = rods[k][0].clone().addScaledVector(rods[k][1], rods[k][2]), B = rods[k + 1][0].clone();
    const mid = A.clone().add(B).multiplyScalar(0.5), out = mid.clone().setY(0).normalize().multiplyScalar(3).add(new THREE.Vector3(0, Math.sign(mid.y || 1) * 3, 0));
    const s0 = xyz.length / 3;
    for (let i = 0; i <= 6; i++) { const t = i / 6, p = A.clone().lerp(B, t).addScaledVector(out, Math.sin(Math.PI * t)); xyz.push(p.x, p.y, p.z); }
    loops.push([s0, xyz.length / 3 - 1]);
  }
  // the conformer, centred on the cleft
  const n = m.z.length, c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += m.xyz[3 * i + k] / n;
  const lx = m.xyz.map((v, i) => v - c[i % 3]);
  const keep = [], map = new Map();
  for (let i = 0; i < n; i++) if (m.z[i] !== 1) { map.set(i, keep.length); keep.push(i); }
  const lig = { e: keep.map(i => m.z[i]), xyz: keep.flatMap(i => lx.slice(3 * i, 3 * i + 3)), b: [] };
  for (let k = 0; k < (m.b?.length || 0); k += 3) if (map.has(m.b[k]) && map.has(m.b[k + 1])) lig.b.push(map.get(m.b[k]), map.get(m.b[k + 1]), m.b[k + 2]);
  return { art: true, rods, gpcr, what, approach: [0.25, 1, 0.2], radius: 34, trace: { xyz, seg: loops }, res: [], atoms: { e: [], xyz: [], r: [] }, contacts: [], bound: lig, poses: [], target: `an illustrative ${gpcr ? 'seven-helix receptor' : 'protein'} (${what})` };
}

/** Build the scene for drug `d` and play the approach. */
async function show(d) {
  const id = sceneIdFor(d) || (await allPoses()).get(d.cid);
  let sc = null;
  if (id) try { sc = await loadScene(id); } catch { scenes.delete(id); }
  if (!sc) {
    // no annotated pocket: draw an artistic receptor around the drug's own conformer instead of giving up
    let m;
    try { m = await loadMolecule(d.cid); } catch { return false; }
    if (!m) return false;
    sc = artScene(d, m);
  }
  const pose = sc.art ? { ...sc.bound, cid: d.cid, xtal: true } : sc.poses.find(p => p.cid === d.cid) || { ...sc.bound, cid: d.cid, name: d.name, mcs: 0, xtal: true };
  if (!bv.renderer) initViewer();
  disposeGroup(bv.group);
  bv.group = new THREE.Group();
  bv.id = id || `art-${d.cid}`;
  const pk = pocket(sc);
  bv.group.add(pk);
  const lig = ballStick(pose, 1, '#5cb85c');
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
  bv.labels = residueLabels(sc, pk.userData.touch);
  bv.group.add(bv.labels);
  const dir = new THREE.Vector3(...sc.approach).normalize();
  bv.trail = approachTrail(dir, Math.max(9, sc.radius * 0.55));
  bv.group.add(bv.trail);
  // the ligand comes in tumbling and settles into the crystal orientation: a picture of docking, not a computed pathway
  bv.q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.3, -0.9, 0.7));
  bv.scene.add(bv.group);
  caption(sc, pose, d);
  artCard(sc, d);
  // frame the ligand with a little of the pocket around it, the way the conformer viewer frames a conformer
  let R = 1;
  for (let i = 0; i < pose.e.length; i++) R = Math.max(R, Math.hypot(pose.xyz[3 * i], pose.xyz[3 * i + 1], pose.xyz[3 * i + 2]));
  R += sc.art ? 10 : 4;
  const dist = R / Math.sin(THREE.MathUtils.degToRad(bv.camera.fov / 2)) * (bv.camera.aspect < 1 ? 1 / bv.camera.aspect : 1);
  bv.camera.position.set(...(sc.art ? [0.35, 0.8, 0.5] : [0.45, 0.25, 0.86])).normalize().multiplyScalar(dist);
  bv.dist = dist;
  bv.controls.target.set(0, 0, 0);
  bv.controls.update();
  bv.sc = sc;
  return true;                                   // the approach is played once the overlay is on screen, not before
}

const ease = t => 1 - Math.pow(1 - t, 3);
const ramp = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

/** Put the scene at progress t (0 = ligand outside the pocket, 1 = seated with contacts shown). Used by play and by the scrubber. */
function setT(t) {
  const sc = bv.sc;
  if (!sc || !bv.lig) return;
  const dir = new THREE.Vector3(...sc.approach).normalize(), start = Math.max(9, sc.radius * 0.55), e = ease(t);
  bv.lig.position.copy(dir).multiplyScalar(start * (1 - e));
  // rotate about the ligand's own centre (the pose is centred on the origin), then move it out along the path
  bv.lig.quaternion.slerpQuaternions(bv.q0, new THREE.Quaternion(), ease(Math.min(1, t * 1.15)));
  const show = ramp(t, CONTACT_AT, 1);
  const mat = bv.contacts?.userData.material;
  if (mat) mat.opacity = show * 0.95;
  bv.labels?.children.forEach(sp => { sp.material.opacity = show; });
  if (bv.trail) bv.trail.material.opacity = 0.55 * (1 - ramp(t, 0.6, 0.95));
  // the camera eases in with the ligand, keeping whatever direction the reader has orbited to
  if (bv.anim?.playing && bv.dist) bv.camera.position.sub(bv.controls.target).setLength(bv.dist * (1 + 0.45 * (1 - e))).add(bv.controls.target);
  const s = $('#bind-scrub');
  if (s) s.value = String(Math.round(t * 1000));
  const stage = $('#bind-stage');
  if (stage) stage.textContent = t < 0.05 ? 'Outside the pocket' : t < CONTACT_AT ? 'Approaching' : t < 1 ? 'Settling' : bv.sc?.art ? 'Seated (illustration)' : 'Bound: crystal pose';
}

/** Advance the animation by one frame; called from the render loop while playing. */
function step() {
  const a = bv.anim, now = performance.now();
  a.t = Math.min(1, a.t + (now - a.last) / FLY_MS);
  a.last = now;
  setT(a.t);
  if (a.t >= 1) pause();
}

function syncButton() {
  const b = $('#bind-replay');
  if (b) b.textContent = bv.anim?.playing ? 'Pause' : (bv.anim?.t ?? 1) >= 1 ? 'Replay' : 'Play';
}

/** Play from progress t (default: from the start). With reduced motion, jump straight to the bound pose. */
function play(sc, t = 0) {
  if (!sc) return;
  bv.anim = { t, last: performance.now(), playing: !reduceMotion.matches };
  if (!bv.anim.playing) bv.anim.t = 1;
  setT(bv.anim.t);
  syncButton();
  wake();
}

function pause() {
  if (bv.anim) bv.anim.playing = false;
  syncButton();
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
  if (!ok) { note(`There is no 3D conformer for ${cap(d.name)} to show binding.`); return; }
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
  if (bv.anim) bv.anim.playing = false;
  $('#bind').hidden = true;
  bv.loop?.pause();
  $('#d-bind')?.setAttribute('aria-expanded', 'false');
  $('#d-bind')?.focus();
}

const note = text => { const el = $('#d-bind-note'); if (el) { el.textContent = text; if (text) announce(text); } };

/** Bind the overlay's own controls. Called once, by js/table.js, on the first press of the button or the B key. */
export function initBinding() {
  if (started) return;
  started = true;
  $('#bind-close').addEventListener('click', close);
  $('#bind-replay').addEventListener('click', () => {
    if (!bv.sc) return;
    if (bv.anim?.playing) pause();
    else play(bv.sc, (bv.anim?.t ?? 1) >= 1 ? 0 : bv.anim.t);
  });
  $('#bind-scrub')?.addEventListener('input', e => { const t = +e.target.value / 1000; bv.anim = { t, last: 0, playing: false }; setT(t); syncButton(); wake(); });
  $('#bind').addEventListener('click', e => { if (e.target === $('#bind')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && bv.open && !e.defaultPrevented) { e.preventDefault(); close(); } });
  // a new drug closes the overlay rather than showing the old pocket under a new name
  bus.on('selection', () => { if (bv.open) close(); note(''); });
}
