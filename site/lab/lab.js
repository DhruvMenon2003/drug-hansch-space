// The drug bench: every (drug, ATC, route) row of the curated table as a sphere,
// with the four PK numbers and two dose numbers editable in place.
import * as B from "../vendor/babylon/babylon.lab.min.js";

const KEY = "hansch-lab-v1";
const EDIT = ["F", "t12", "dose", "tau", "tox", "act"];
const ATC = {
  A: ["Alimentary", "#d9822b"], B: ["Blood", "#c43c3c"], C: ["Cardiovascular", "#d24d7b"], D: ["Skin", "#b9973a"],
  G: ["Urogenital", "#9a6bd0"], H: ["Hormones", "#7c7fd8"], J: ["Anti-infective", "#2f8fb0"], L: ["Cancer & immune", "#2e9a5e"],
  M: ["Muscle & bone", "#8a6f4d"], N: ["Nervous system", "#3c6fd6"], P: ["Antiparasitic", "#5aa04a"], R: ["Respiratory", "#2fb0a0"],
  S: ["Senses", "#c06bb0"], V: ["Various", "#888888"],
};
const $ = (id) => document.getElementById(id);
const num = (v) => (v === "" || v == null || !isFinite(+v) ? null : +v);

// ---------- state ----------
let base = [];           // curated rows, untouched
let rows = [];           // what is drawn: curated rows with your edits on top, plus your additions
let mine = load();       // { edits: {rid: {...}}, added: [row] }
let sel = -1;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { edits: {}, added: [] }; }
  catch { return { edits: {}, added: [] }; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(mine)); } catch {} }

const fcOf = (r) => (r.F > 0 && r.t12 > 0 && r.dose > 0 && r.tau > 0 ? 1.44 * r.F * r.t12 * r.dose / r.tau : null);
const tiOf = (r) => (r.tox > 0 && r.act > 0 ? Math.log10(r.tox) - Math.log10(1 / r.act) : null);

function rebuild() {
  rows = base.map((r) => {
    const e = mine.edits[r.rid];
    return e ? { ...r, ...e, mine: true } : r;
  }).concat(mine.added.map((r) => ({ ...r, mine: true, added: true })));
  for (const r of rows) { r.fcv = fcOf(r); r.tiv = tiOf(r); }
}

// ---------- 3D ----------
const canvas = $("scene");
const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, antialias: true }, true);
const scene = new B.Scene(engine);
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
scene.clearColor = dark ? new B.Color4(0.106, 0.106, 0.122, 1) : new B.Color4(1, 1, 1, 1);
const cam = new B.ArcRotateCamera("cam", -1.15, 1.08, 34, new B.Vector3(0, 2.5, 0), scene);
cam.attachControl(canvas, true);
cam.lowerRadiusLimit = 8; cam.upperRadiusLimit = 60; cam.wheelDeltaPercentage = 0.01; cam.minZ = 0.1;
cam.upperBetaLimit = 1.52;
new B.HemisphericLight("sky", new B.Vector3(0.2, 1, 0.3), scene).intensity = 0.85;
const sun = new B.DirectionalLight("sun", new B.Vector3(-0.5, -1, 0.4), scene); sun.intensity = 0.45;

const X = (lgp) => Math.max(-7, Math.min(9, lgp ?? 0)) * 1.1 - 1;          // logP across
const Z = (q) => ((q ?? 0.5) - 0.5) * 16;                                  // QED in depth
let yLo = -3, yHi = 4;
const FLOOR = -0.6;
const Y = (fc) => (fc == null ? FLOOR : Math.max(0, Math.min(10.5, ((Math.log10(fc) - yLo) / (yHi - yLo)) * 10)));

// floor: a quiet grid, the place unplaced drugs wait
{
  const L = [], c = [];
  const col = dark ? new B.Color4(1, 1, 1, 0.09) : new B.Color4(0, 0, 0, 0.08);
  for (let i = -9; i <= 9; i++) {
    L.push([new B.Vector3(i, FLOOR - 0.35, -8.5), new B.Vector3(i, FLOOR - 0.35, 8.5)]); c.push([col, col]);
  }
  for (let k = -8; k <= 8; k++) { L.push([new B.Vector3(-9, FLOOR - 0.35, k), new B.Vector3(9, FLOOR - 0.35, k)]); c.push([col, col]); }
  const g = B.CreateLineSystem("grid", { lines: L, colors: c, useVertexAlpha: true }, scene);
  g.isPickable = false;
  // a single vertical ruler at the back-left corner, one tick per decade of concentration
  const t = [], tc = [], tcol = dark ? new B.Color4(1, 1, 1, 0.25) : new B.Color4(0, 0, 0, 0.25);
  t.push([new B.Vector3(-9, FLOOR, -8.5), new B.Vector3(-9, 10.5, -8.5)]); tc.push([tcol, tcol]);
  for (let d = 0; d <= 10; d += 10 / 7) { t.push([new B.Vector3(-9, d, -8.5), new B.Vector3(-8.6, d, -8.5)]); tc.push([tcol, tcol]); }
  B.CreateLineSystem("ruler", { lines: t, colors: tc, useVertexAlpha: true }, scene).isPickable = false;
}

const ball = B.CreateSphere("ball", { diameter: 0.34, segments: 10 }, scene);
const mat = new B.StandardMaterial("m", scene);
mat.specularColor = new B.Color3(0.25, 0.25, 0.25); mat.specularPower = 48;
ball.material = mat;
ball.thinInstanceEnablePicking = true;

const ring = B.CreateTorus("ring", { diameter: 0.85, thickness: 0.05, tessellation: 40 }, scene);
const rmat = new B.StandardMaterial("rm", scene);
rmat.emissiveColor = B.Color3.FromHexString(dark ? "#f08a55" : "#e0662f"); rmat.disableLighting = true;
ring.material = rmat; ring.isPickable = false; ring.setEnabled(false);

let mats, cols, cur, tgt;          // per-instance matrix, colour, current and target positions
const M = B.Matrix.Identity();

function colorOf(r) {
  const h = (ATC[r.a1] || ATC.V)[1];
  const c = B.Color3.FromHexString(h);
  const placed = r.fcv != null;
  const a = placed ? 1 : 0.32;
  // unplaced drugs are washed toward the background so the placed ones carry the picture
  const bg = dark ? 0.11 : 1;
  const k = placed ? 1 : 0.62;
  return [c.r * k + bg * (1 - k), c.g * k + bg * (1 - k), c.b * k + bg * (1 - k), a];
}
function scaleOf(r) { return (r.tiv == null ? 0.8 : 0.8 + Math.min(1.2, Math.max(0, r.tiv) * 0.14)) * (r.mine ? 1.25 : 1); }

function layout(first) {
  const n = rows.length;
  if (!mats || mats.length !== n * 16) {
    const oldCur = cur;
    mats = new Float32Array(n * 16); cols = new Float32Array(n * 4); cur = new Float32Array(n * 3); tgt = new Float32Array(n * 3);
    if (oldCur) cur.set(oldCur.subarray(0, Math.min(oldCur.length, cur.length)));
    first = first || !oldCur;
  }
  rows.forEach((r, i) => {
    // a little deterministic jitter on the floor, so unplaced drugs don't stack into one pile
    const j = r.fcv == null ? ((hash(r.rid) % 1000) / 1000 - 0.5) * 0.5 : 0;
    tgt[i * 3] = X(r.lgp); tgt[i * 3 + 1] = Y(r.fcv) + j * 0.3; tgt[i * 3 + 2] = Z(r.qed) + j;
    if (first || (r.added && cur[i * 3 + 1] === 0 && cur[i * 3] === 0)) {
      cur[i * 3] = tgt[i * 3]; cur[i * 3 + 1] = first ? tgt[i * 3 + 1] : FLOOR - 3; cur[i * 3 + 2] = tgt[i * 3 + 2];
    }
    cols.set(colorOf(r), i * 4);
  });
  write();
  ball.thinInstanceSetBuffer("color", cols, 4);
}
function write() {
  for (let i = 0; i < rows.length; i++) {
    const s = scaleOf(rows[i]);
    B.Matrix.ComposeToRef(new B.Vector3(s, s, s), B.Quaternion.Identity(), new B.Vector3(cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]), M);
    M.copyToArray(mats, i * 16);
  }
  ball.thinInstanceSetBuffer("matrix", mats, 16, false);
}
function hash(s) { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

// motion: each sphere eases toward its target with a soft spring, so a lift reads as a lift
let moving = true, idle = 0;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
scene.onBeforeRenderObservable.add(() => {
  if (!cur) return;
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  if (moving) {
    let d = 0;
    const k = reduce ? 1 : 1 - Math.exp(-dt * 5.5);
    for (let i = 0; i < cur.length; i++) { const e = tgt[i] - cur[i]; cur[i] += e * k; d = Math.max(d, Math.abs(e)); }
    write();
    if (d < 0.002) moving = false;
  }
  if (sel >= 0) {
    ring.position.set(cur[sel * 3], cur[sel * 3 + 1], cur[sel * 3 + 2]);
    ring.rotation.x += dt * 0.9; ring.rotation.y += dt * 0.6;
  }
  if (!reduce && (idle += dt) > 6 && sel < 0) cam.alpha += dt * 0.035;   // drifts only when left alone
});
["pointerdown", "wheel", "keydown"].forEach((e) => canvas.addEventListener(e, () => (idle = 0), { passive: true }));
engine.runRenderLoop(() => scene.render());
addEventListener("resize", () => engine.resize());

// hover and click
const tip = $("tip");
let lastHover = 0;
scene.onPointerObservable.add((pi) => {
  if (pi.type === B.PointerEventTypes.POINTERMOVE) {
    const now = performance.now(); if (now - lastHover < 40) return; lastHover = now;
    const p = scene.pick(scene.pointerX, scene.pointerY, (m) => m === ball);
    if (p.hit && p.thinInstanceIndex >= 0) {
      const r = rows[p.thinInstanceIndex];
      tip.hidden = false;
      tip.style.left = scene.pointerX + "px"; tip.style.top = scene.pointerY + "px";
      tip.textContent = `${r.nm} · ${r.md.toLowerCase()}` + (r.fcv == null ? " · not yet placed" : ` · ${fmt(r.fcv)}`);
      canvas.style.cursor = "pointer";
    } else { tip.hidden = true; canvas.style.cursor = ""; }
  } else if (pi.type === B.PointerEventTypes.POINTERTAP) {
    const p = scene.pick(scene.pointerX, scene.pointerY, (m) => m === ball);
    if (p.hit && p.thinInstanceIndex >= 0) open(p.thinInstanceIndex, false);
  }
});

function fly(i) {
  const to = new B.Vector3(cur[i * 3], Math.max(1, cur[i * 3 + 1]), cur[i * 3 + 2]);
  const from = cam.target.clone(), r0 = cam.radius, r1 = Math.min(r0, 24);
  let t = 0;
  const ob = scene.onBeforeRenderObservable.add(() => {
    t = Math.min(1, t + engine.getDeltaTime() / 900);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    cam.target = B.Vector3.Lerp(from, to, e); cam.radius = r0 + (r1 - r0) * e;
    if (t >= 1) scene.onBeforeRenderObservable.remove(ob);
  });
}

// ---------- panel ----------
const fmt = (v) => (v == null ? "–" : v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toPrecision(2));
const card = $("card");

function open(i, move = true) {
  sel = i;
  const r = rows[i];
  ring.setEnabled(true);
  card.hidden = false;
  $("cardName").textContent = r.nm;
  $("cardSub").textContent = [r.atc, r.md.toLowerCase(), r.added ? "added by you" : r.mine ? "edited by you" : "curated"].filter(Boolean).join(" · ");
  const b = base.find((x) => x.rid === r.rid) || {};
  for (const k of EDIT) {
    const inp = card.elements[k];
    inp.value = r[k] ?? "";
    inp.placeholder = b[k] == null ? "missing" : "";
    inp.classList.toggle("changed", !!(mine.edits[r.rid] && k in mine.edits[r.rid]) || !!r.added);
    inp.classList.remove("bad");
  }
  card.elements.src.value = r.src || "";
  $("revert").hidden = !mine.edits[r.rid];
  readout(r, false);
  routes(r.nm, r.rid);
  $("q").value = r.nm;
  if (move) fly(i);
}

function readout(r, flash) {
  for (const [id, v, f] of [["oFc", r.fcv, fmt], ["oTi", r.tiv, (x) => (x == null ? "–" : x.toFixed(2))]]) {
    const el = $(id), txt = f(v);
    if (flash && el.textContent !== txt) { el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 600); }
    el.textContent = txt;
  }
  const miss = ["F", "t12", "dose", "tau"].filter((k) => !(r[k] > 0));
  const w = $("warn");
  w.hidden = !miss.length && !(r.F > 1);
  w.textContent = r.F > 1 ? "F is a fraction: 0.6 means 60 % reaches the blood."
    : miss.length ? `Still needs ${miss.map((k) => ({ F: "F", t12: "t½", dose: "dose", tau: "dosing interval" })[k]).join(", ")} to leave the floor.` : "";
}

card.addEventListener("input", (ev) => {
  if (sel < 0) return;
  const r = rows[sel], k = ev.target.name;
  if (k === "src") { edit(r, { src: ev.target.value }); return; }
  const v = num(ev.target.value);
  const bad = ev.target.value !== "" && (v == null || v < 0 || (k === "F" && v > 1));
  ev.target.classList.toggle("bad", bad);
  if (bad) return;
  ev.target.classList.add("changed");
  edit(r, { [k]: v });
});

function edit(r, patch) {
  if (r.added) Object.assign(mine.added.find((a) => a.rid === r.rid), patch);
  else mine.edits[r.rid] = { ...(mine.edits[r.rid] || {}), ...patch };
  save();
  const i = sel;
  rebuild(); layout(); moving = true;
  readout(rows[i], true);
  $("revert").hidden = !mine.edits[r.rid];
  $("cardSub").textContent = [r.atc, r.md.toLowerCase(), r.added ? "added by you" : "edited by you"].filter(Boolean).join(" · ");
  listMine();
}

$("revert").onclick = () => {
  const r = rows[sel]; delete mine.edits[r.rid]; save();
  rebuild(); layout(); moving = true; open(sel, false); listMine();
};

function routes(nm, rid) {
  const box = $("routes"); box.textContent = "";
  rows.forEach((r, i) => {
    if (r.nm !== nm) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "ghost";
    b.textContent = `${r.md.toLowerCase()}${r.atc ? " · " + r.atc : ""}`;
    b.setAttribute("aria-pressed", r.rid === rid);
    b.onclick = () => open(i);
    box.append(b);
  });
}

$("q").addEventListener("change", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const i = rows.findIndex((r) => r.nm.toLowerCase() === q) >= 0 ? rows.findIndex((r) => r.nm.toLowerCase() === q) : rows.findIndex((r) => r.nm.toLowerCase().startsWith(q));
  if (i >= 0) open(i);
});

$("addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target.elements, lgp = num(f.lgp.value);
  if (lgp == null) { f.lgp.classList.add("bad"); return; }
  const atc = f.atc.value.trim().toUpperCase();
  const r = { rid: "you:" + Date.now().toString(36), nm: f.nm.value.trim().toLowerCase(), lgp, qed: num(f.qed.value),
    md: (f.md.value.trim() || "ORAL").toUpperCase(), atc, a1: atc[0] || "V", src: "" };
  mine.added.push(r); save(); rebuild(); layout(); moving = true; names(); listMine();
  e.target.reset(); f.md.value = "ORAL"; e.target.closest("details").open = false;
  open(rows.length - 1);
});

function listMine() {
  const ul = $("mineList"); ul.textContent = "";
  const ids = [...Object.keys(mine.edits), ...mine.added.map((a) => a.rid)];
  $("nMine").textContent = ids.length;
  for (const id of ids) {
    const i = rows.findIndex((r) => r.rid === id); if (i < 0) continue;
    const li = document.createElement("li");
    li.textContent = `${rows[i].nm} · ${rows[i].md.toLowerCase()}`; li.onclick = () => open(i);
    ul.append(li);
  }
}

$("export").onclick = () => {
  const cols = ["rid", "nm", "atc", "md", "lgp", "qed", ...EDIT, "free_conc", "therapeutic_index", "src", "kind"];
  const out = [cols.join(",")];
  for (const r of rows.filter((r) => r.mine)) {
    const v = { ...r, free_conc: r.fcv, therapeutic_index: r.tiv, kind: r.added ? "added" : "edited" };
    out.push(cols.map((c) => { const s = v[c] == null ? "" : String(v[c]); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","));
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([out.join("\n") + "\n"], { type: "text/csv" }));
  a.download = "drug-bench-edits.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("clear").onclick = () => {
  if (!confirm("Forget every edit and added drug in this browser?")) return;
  mine = { edits: {}, added: [] }; save(); sel = -1; card.hidden = true; ring.setEnabled(false);
  rebuild(); layout(); moving = true; names(); listMine();
};

function names() {
  const dl = $("names"); dl.textContent = "";
  for (const n of [...new Set(rows.map((r) => r.nm))].sort()) { const o = document.createElement("option"); o.value = n; dl.append(o); }
}

// ---------- boot ----------
const res = await fetch("../data/clean_drugs.json");
const J = await res.json();
const ix = Object.fromEntries(J.cols.map((c, i) => [c, i]));
base = J.rows.map((a) => {
  const o = {}; for (const c of ["rid", "nm", "atc", "a1", "md", "lgp", "qed", "F", "t12", "dose", "tau", "tox", "act"]) o[c] = a[ix[c]];
  o.rid = String(o.rid); return o;
});
rebuild();
const ys = rows.map((r) => r.fcv).filter((v) => v > 0).map(Math.log10).sort((a, b) => a - b);
yLo = ys[Math.floor(ys.length * 0.01)]; yHi = ys[Math.floor(ys.length * 0.99)];
layout(true); names(); listMine();
$("legend").append(...Object.entries(ATC).map(([k, [n, c]]) => { const s = document.createElement("span"); s.style.setProperty("--c", c); s.textContent = `${k} ${n}`; return s; }));
