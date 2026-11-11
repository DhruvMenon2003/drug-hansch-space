(() => {
'use strict';
// ---------- helpers (from the explorable template; they handle the fiddly parts) ----------
const C = window.Core, Fig = window.Fig;
const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const calm = window.matchMedia('(prefers-reduced-motion: reduce)');

// A canvas drawn in logical units: `width` units across, height = width × data-aspect.
// Stays sharp on any screen, redraws itself (s.draw) when resized, and maps pointer positions.
// A figure is drawn on a 680-unit canvas and scaled to its box. On a phone that scaling would shrink 12 px labels
// to 6, so a figure may pass narrow(w): below NARROW css pixels it is then laid out again at true size, with the
// height that function returns, and s.narrow tells its draw() to use the compact arrangement.
const NARROW = 560;
function surface(canvas, opt = {}) {
  const ctx = canvas.getContext('2d');
  const aspect = +canvas.dataset.aspect || 0.5, width = 680;
  const s = { canvas, ctx, w: width, h: width * aspect, k: 1, narrow: false, draw: null };
  const fit = () => {
    const dpr = window.devicePixelRatio || 1, cssW = canvas.clientWidth;
    if (!cssW) return;
    s.narrow = !!opt.narrow && cssW < NARROW;
    if (s.narrow) { s.w = Math.max(cssW, 300); s.h = opt.narrow(s.w); } else { s.w = width; s.h = width * aspect; }
    s.k = cssW / s.w;
    const cssH = Math.round(s.h * s.k);
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr * s.k, 0, 0, dpr * s.k, 0, 0);
  };
  fit();
  new ResizeObserver(() => { fit(); s.draw && s.draw(); }).observe(canvas);
  s.at = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / s.k, (e.clientY - r.top) / s.k]; };
  return s;
}

// Run step(timeSeconds, dtSeconds) every frame, but only while `el` is on screen.
const animated = new Set();
function animate(el, step) {
  const entry = { step, visible: false };
  new IntersectionObserver(([e]) => { entry.visible = e.isIntersecting; }).observe(el);
  animated.add(entry);
  return entry;
}
let lastT = performance.now();
requestAnimationFrame(function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  for (const e of animated) if (e.visible) e.step(now / 1000, dt);
  requestAnimationFrame(frame);
});

// Pointer dragging in logical units. down(x, y) may return false to ignore the press.
// Only a canvas that is dragged gives up touch scrolling; the others let a finger scroll the page past them.
function drag(s, { down, move, up }) {
  let id = null;
  s.canvas.style.touchAction = 'none';
  s.canvas.addEventListener('pointerdown', (e) => {
    if (id !== null || down(...s.at(e)) === false) return;
    id = e.pointerId;
    try { s.canvas.setPointerCapture(id); } catch { /* best effort */ }
    e.preventDefault();
  });
  s.canvas.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(...s.at(e)); });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    try { s.canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    up && up();
  };
  s.canvas.addEventListener('pointerup', end);
  s.canvas.addEventListener('pointercancel', end);
}

// Canvas text uses the same sans face as the page, read once from the tokens so the two cannot drift apart.
const SANS_STACK = (getComputedStyle(document.documentElement).getPropertyValue('--sans') || '').trim() || '"Helvetica Neue", Arial, sans-serif';
const face = (size, weight = 500) => `${weight} ${size}px ${SANS_STACK}`;
const textWidth = (ctx, text, size = 12, weight = 500) => { ctx.font = face(size, weight); return ctx.measureText(text).width; };
function label(ctx, text, x, y, color = css('--muted'), align = 'left', size = 12, weight = 500) {
  ctx.font = face(size, weight);
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
function polyline(ctx, pts, color, width = 2) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.stroke();
}
function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
}
function disc(ctx, x, y, r, fill, stroke, lw = 1.5) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
// Spread labels vertically so none overlap: items = [{y, ...}] → adds .ly.
function spreadLabels(items, gap = 18) {
  items.sort((a, b) => a.y - b.y);
  let prev = -Infinity;
  for (const it of items) { it.ly = Math.max(it.y, prev + gap); prev = it.ly; }
  return items;
}
// Format numbers for readouts: real minus sign, sensible precision.
const fmt = (x, digits = 0) => (Number.isFinite(x) ? x.toFixed(digits).replace('-', '−') : '—');
const pc1 = (v) => (100 * v).toFixed(0);
const lc = (s) => { s = String(s || ''); return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s; };
const cap = (s) => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
const listJoin = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const NUMWORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n) => (n >= 0 && n <= 10 ? NUMWORD[n] : String(n));

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) {
    if (k === 'text') e.textContent = attrs[k];
    else if (k === 'class') e.className = attrs[k];
    else if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
  }
  for (const kid of kids) if (kid !== null && kid !== undefined) e.append(kid);
  return e;
}
const clear = (node) => node.replaceChildren();

// Small seeded generator (mulberry32) so the first state of each figure is the same on every load.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Canvases read colours from CSS tokens, so they must redraw when the colour scheme changes.
const redraws = [];
const repaint = () => redraws.forEach((f) => f());
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint);
new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(repaint);

// ---------- fonts for the PDF export ----------
// Four subset styles of Arimo (SIL Open Font License 1.1; the widths match Arial and Helvetica), deflated, with their
// advance widths. Fig.renderPDF embeds them as TrueType programs. Made by build_fonts.py.
// Either the data itself (one-file build) or the name of a JSON file beside the page, fetched the first time a PDF is made.
const PDF_FONTS = "pdf-fonts.json";
let pdfFontsCache = null;
function getPdfFonts() {
  if (!PDF_FONTS) return Promise.resolve(null);
  if (typeof PDF_FONTS !== 'string') return Promise.resolve(PDF_FONTS);
  if (!pdfFontsCache) pdfFontsCache = fetch(PDF_FONTS).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return pdfFontsCache;
}

// ---------- the study ----------
// Everything specific to this table lives in STUDY. To reuse the page for another table, replace this
// block (and the few sentences of prose that describe the drug); every number in the text is computed.
const STUDY = {
  drug: 'Apricitabine',
  formula: 'C8H11N3O3S',
  tableText: [
    'Apricitabine dose groups',
    'Event Placebo (n = 13) 400 mg (n = 11) 800 mg (n = 12) 1200 mg (n = 14) 1600 mg (n = 13) Total (n = 50)',
    'All [n (%)] 9 (69.2) 9 8 11 11 39 (78.0)',
    'Headache 4 (30.8) 3 4 6 8 21 (42.0)',
    'Nasal congestion 1 (7.7) 1 1 3 2 7 (14.0)',
    'Increases in',
    'Alanine aminotransferase 4 (30.8) 1 2 0 3 6 (12.0)',
    'Aspartate aminotransferase 5 (38.5) 0 3 1 3 7 (14.0)',
    'Blood amylase 0 (0.0) 1 1 1 3 6 (12.0)',
    'Blood creatinine 5 (38.5) 3 2 2 3 10 (20.0)',
    'Blood sodium 3 (23.1) 2 1 1 2 6 (12.0)',
    'Lipase 3 (23.1) 2 3 1 4 10 (20.0)'
  ].join('\n'),
  tableCaption: 'Adverse events judged possibly or probably related to treatment, by dose group (source 1). Counts are patients, with percentages in parentheses.',
  focus: /^headache$/i,                 // the row the essay is about
  spanner: 'Apricitabine dose groups',  // heading over the dose columns
  xTitle: 'Apricitabine dose (mg per day)',
  unit: 'mg',                           // unit of the dose scores, for readouts
  population: 'Antiretroviral-naive adults with HIV-1 infection',
  design: 'Randomized, double-blind',
  duration: '10 days of oral dosing',
  outcome: 'Adverse events recorded',
  // Teaching tables for Figure 5, found by search so that the caption's claims hold for these group sizes.
  presets: { stair: [3, 3, 5, 7, 8], spike: [2, 9, 3, 3, 3], flat: [5, 4, 5, 6, 5] },
  // Ball-and-stick coordinates in ångström: [element, x, y, z] and [atom, atom, bond order].
  molecule: {"atoms":[["O",1.837,2.653,0.46],["C",1.956,1.435,0.341],["N",3.192,0.871,0.14],["C",3.291,-0.399,-0.094],["N",4.548,-0.901,-0.286],["C",2.127,-1.301,-0.158],["C",0.944,-0.745,0.096],["N",0.832,0.595,0.407],["C",-0.458,1.266,0.603],["S",-1.735,0.275,1.425],["C",-2.731,0.16,-0.093],["O",-1.927,0.594,-1.193],["C",-1.115,1.684,-0.72],["C",-3.22,-1.273,-0.331],["O",-4.057,-1.742,0.724],["H",5.265,-0.238,-0.006],["H",4.724,-1.837,0.056],["H",2.256,-2.341,-0.416],["H",0.042,-1.343,0.051],["H",-0.295,2.157,1.218],["H",-3.589,0.834,0.015],["H",-1.765,2.558,-0.58],["H",-0.382,1.936,-1.493],["H",-3.795,-1.316,-1.262],["H",-2.382,-1.968,-0.455],["H",-3.56,-1.614,1.554]],"bonds":[[0,1,2],[1,2,1],[2,3,2],[3,4,1],[3,5,1],[5,6,2],[6,7,1],[7,8,1],[8,9,1],[9,10,1],[10,11,1],[11,12,1],[10,13,1],[13,14,1],[7,1,1],[12,8,1],[4,15,1],[4,16,1],[5,17,1],[6,18,1],[8,19,1],[10,20,1],[12,21,1],[12,22,1],[13,23,1],[13,24,1],[14,25,1]]},
  // Trial-design illustration for panel a of the exported figure.
  panelA: { href: 'panel-a.jpg', width: 1600, height: 742, credit: 'Created in BioRender. Journals require a BioRender publication licence.' }
};
// The illustration is embedded as a data URL in the one-file build and sits beside the page otherwise; the figure JSON
// needs the data URL (so an exported SVG is self-contained), so a file is read into one when first wanted.
STUDY.panelAReady = (() => {
  const p = STUDY.panelA;
  if (!p || !p.href) return Promise.resolve(null);
  if (p.href.startsWith('data:')) return Promise.resolve(p);
  return fetch(p.href).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status)))).then((b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(Object.assign({}, p, { href: String(fr.result) })); fr.readAsDataURL(b); })).catch(() => null);
})();

// ---------- numbers derived from the study, used by the prose and the figures ----------
const S = (() => {
  const parsed = C.parseTable(STUDY.tableText);
  const fi = Math.max(0, parsed.rows.findIndex((r) => STUDY.focus.test(r.label)));
  const A = C.analyze({ groups: parsed.groups, counts: parsed.rows[fi].counts, event: parsed.rows[fi].label, scoreType: 'dose', includeRef: true });
  const g = A.groups; // reference first, then doses in ascending order
  const s = { parsed, focusIndex: fi, A, ev: lc(parsed.rows[fi].label), k: g.length,
    x: g.map((q) => q.used), n: g.map((q) => q.n), r: g.map((q) => q.r), labels: g.map((q) => q.label),
    groups: g.map((q) => ({ label: q.label, n: q.n, role: q.role, score: q.used })) };
  s.N = s.n.reduce((a, b) => a + b, 0); s.R = s.r.reduce((a, b) => a + b, 0);
  s.top = s.k - 1; s.gap = s.r[s.top] - s.r[0];
  s.analyze = (r) => C.analyze({ groups: s.groups, counts: r, event: parsed.rows[fi].label, scoreType: 'dose', includeRef: true });
  return s;
})();

// Exact chance that a random deal puts the last group at least `gap` cases ahead of the first.
function gapProbability(n, R, gap) {
  const N = n.reduce((a, b) => a + b, 0), a0 = n[0], b0 = n[n.length - 1], rest = N - a0 - b0, den = C.logChoose(N, R);
  let p = 0;
  for (let a = 0; a <= a0; a++) for (let b = 0; b <= b0; b++) {
    const c = R - a - b;
    if (c < 0 || c > rest || b - a < gap) continue;
    p += Math.exp(C.logChoose(a0, a) + C.logChoose(b0, b) + C.logChoose(rest, c) - den);
  }
  return p;
}

// Fill every [data-b] span in the prose from the model, so the text cannot drift from the figures.
(() => {
  const A = S.A, tr = A.trend, L = C.lean(S.x, S.r, S.n), topPair = A.pairs[A.pairs.length - 1];
  const vary = (i, d) => { const r = S.r.slice(); r[i] += d; return S.analyze(r).trend; };
  const stair = S.analyze(STUDY.presets.stair), spike = S.analyze(STUDY.presets.spike);
  const pairN = A.pairs.map((p) => p.n + A.ref.n);
  const B = {
    ev: S.ev, evCap: cap(S.ev), drug: STUDY.drug, drugL: lc(STUDY.drug), refL: lc(S.labels[0]),
    refPct: pc1(S.r[0] / S.n[0]), topPct: pc1(S.r[S.top] / S.n[S.top]), nTop: S.n[S.top], onePt: (100 / S.n[S.top]).toFixed(1),
    gap: S.gap, gapShare: (100 * gapProbability(S.n, S.R, S.gap)).toFixed(1), R: S.R, N: S.N, k: word(S.k),
    meanEv: fmt(L.meanEvents), meanAll: fmt(L.meanAll), lean: fmt(L.lean),
    pExact: C.fmtP(tr.exact.pTwo), pAsym: C.fmtP(tr.pTwo), z: fmt(tr.z, 2), oneIn: Math.round(1 / tr.exact.pTwo),
    nRange: Math.min(...S.n) + ' to ' + Math.max(...S.n), nPairs: word(A.pairs.length), pairN: Math.min(...pairN) + ' to ' + Math.max(...pairN),
    stairTrend: C.fmtP(stair.trend.pTwo), stairRaw: C.fmtP(Math.min(...stair.pairs.map((p) => p.p))),
    spikeHolm: C.fmtP(Math.min(...spike.pairs.map((p) => p.pHolm))), spikeTrend: C.fmtP(spike.trend.pTwo),
    pRefMinus: C.fmtP(vary(0, -1).pTwo), pTopPlus: C.fmtP(vary(S.top, 1).pTwo),
    pRefMinusX: C.fmtP(vary(0, -1).exact.pTwo), pTopPlusX: C.fmtP(vary(S.top, 1).exact.pTwo),
    topRD: C.fmtSigned(100 * topPair.rd, 1), topCI: C.fmtNum(100 * topPair.lo, 1) + ' to ' + C.fmtNum(100 * topPair.hi, 1),
    nRows: word(S.parsed.rows.length), fwer: (100 * (1 - Math.pow(0.95, S.parsed.rows.length))).toFixed(0)
  };
  // Some tables print a total that leaves the reference group out. The note about it only makes sense for those.
  const skip = S.parsed.groups.findIndex((g) => g.role === 'skip');
  const skipCount = skip >= 0 ? S.parsed.rows[S.focusIndex].counts[skip] : null;
  const totalIsDoseOnly = skip >= 0 && S.r[0] > 0 && skipCount === S.R - S.r[0];
  if (totalIsDoseOnly) Object.assign(B, { skipR: skipCount, skipL: S.parsed.groups[skip].label, nDose: word(S.k - 1) });
  document.querySelectorAll('[data-if="totalIsDoseOnly"]').forEach((node) => { if (!totalIsDoseOnly) node.remove(); });
  window.__bindings = B; // read by the page test
  document.querySelectorAll('[data-b]').forEach((node) => {
    const key = node.dataset.b;
    if (key === 'formula') { // chemical formula with real subscripts
      node.replaceChildren(...STUDY.formula.split(/(\d+)/).filter(Boolean).map((t) => (/\d/.test(t) ? el('sub', { text: t }) : t)));
    } else if (B[key] !== undefined) node.textContent = B[key];
  });
})();

// The table as the paper prints it, with the row under study marked.
(() => {
  const P = S.parsed, wrap = $('specimen-wrap');
  const head = (g) => el('th', { scope: 'col' }, g.label + ' ', el('span', { class: 'dim', text: g.n === null ? '' : '(n = ' + g.n + ')' }));
  const refs = P.groups.filter((g) => g.role === 'ref'), rest = P.groups.filter((g) => g.role !== 'ref');
  const thead = el('thead');
  if (STUDY.spanner && rest.length > 1) {
    const r1 = el('tr', null, el('th', { rowspan: 2, scope: 'col', text: 'Event' }));
    refs.forEach((g) => { const th = head(g); th.setAttribute('rowspan', 2); r1.append(th); });
    r1.append(el('th', { class: 'span', colspan: rest.length, scope: 'colgroup', text: STUDY.spanner }));
    thead.append(r1, el('tr', null, ...rest.map(head)));
  } else thead.append(el('tr', null, el('th', { scope: 'col', text: 'Event' }), ...refs.map(head), ...rest.map(head)));
  const order = refs.concat(rest).map((g) => P.groups.indexOf(g));
  const tbody = el('tbody');
  // Lines of the pasted text without counts are sub-headings; rows after one are indented.
  let sub = false, ri = 0;
  STUDY.tableText.split('\n').forEach((line) => {
    if (/\(\s*n\s*=/.test(line) || line.trim() === STUDY.spanner) return;
    const row = P.rows[ri];
    if (!row || !line.trim().startsWith(row.label)) { tbody.append(el('tr', null, el('td', { colspan: order.length + 1, text: line.trim() }))); sub = true; return; }
    const tr = el('tr', { class: (sub ? 'sub ' : '') + (ri === S.focusIndex ? 'focus' : '') }, el('td', { text: row.label }));
    order.forEach((j) => {
      const c = row.counts[j], n = P.groups[j].n;
      tr.append(el('td', null, c === null ? '' : String(c), c !== null && n ? el('span', { class: 'dim', text: ' (' + (100 * c / n).toFixed(1) + ')' }) : null));
    });
    tbody.append(tr); ri++;
  });
  wrap.append(el('table', { class: 'booktabs' }, el('caption', { text: STUDY.tableCaption }), thead, tbody));
})();

// ---------- frontispiece: the molecule ----------
// Drawn at once as a flat ball-and-stick projection; a lit 3D version replaces it when an engine has loaded.
// Both read the same orientation, so the swap does not jump. No engine, no problem: the flat drawing stays,
// and it turns too. The build names the engine: PlayCanvas fetched from a CDN for the one-file page, or the
// host site's own copy of three.js where nothing may be loaded from another origin.
(() => {
  const M = STUDY.molecule, fig = $('fig-molecule');
  if (!M || !fig) return;
  const stage = fig.querySelector('.stage'), flat = fig.querySelector('canvas.flat'), ctx = flat.getContext('2d');
  const HERO = {"kind": "three", "src": "../vendor/three/three.module.min.js"}; // { kind: 'playcanvas' | 'three', src }
  const FOV = 24, DIST = 21.5; // degrees, ångström
  const RADIUS = { C: 0.43, N: 0.41, O: 0.40, S: 0.52, H: 0.25 }, BOND = 0.105;
  const dark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  const palette = () => ({ C: dark() ? '#a3a9b1' : '#50555c', H: dark() ? '#eef0f2' : '#e3e6e9', N: css('--c2'), O: css('--c1'), S: dark() ? '#e0bf55' : '#c9a227', bond: dark() ? '#7b828b' : '#9aa0a7' });
  const view = { yaw: -0.55, pitch: 0.3, vy: 0, vp: 0, held: false, idle: 3, dirty: true };

  // ----- flat projection -----
  let W = 0, H = 0;
  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = stage.clientWidth; H = stage.clientHeight;
    flat.width = Math.round(W * dpr); flat.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.dirty = true;
  };
  function turn(p) { // yaw about the vertical axis, then pitch about the horizontal one
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const x = p[0] * cy + p[2] * sy, z0 = -p[0] * sy + p[2] * cy;
    return [x, p[1] * cp - z0 * sp, p[1] * sp + z0 * cp];
  }
  function shade(hex, t) { // t > 0 lightens, t < 0 darkens
    const n = parseInt(hex.slice(1), 16), ch = [n >> 16 & 255, n >> 8 & 255, n & 255];
    return 'rgb(' + ch.map((v) => Math.round(t > 0 ? v + (255 - v) * t : v * (1 + t))).join(',') + ')';
  }
  function drawFlat() {
    const pal = palette(), f = (H / 2) / Math.tan(FOV * Math.PI / 360);
    const P = M.atoms.map((a) => { const q = turn(a.slice(1)), s = f / (DIST - q[2]); return { el: a[0], q, s, x: W / 2 + q[0] * s, y: H / 2 - q[1] * s }; });
    const items = P.map((p) => ({ z: p.q[2], atom: p }));
    M.bonds.forEach(([i, j, order]) => {
      const a = P[i], b = P[j], d = [b.q[0] - a.q[0], b.q[1] - a.q[1], b.q[2] - a.q[2]], len = Math.hypot(...d);
      const ta = RADIUS[a.el] * 0.85 / len, tb = 1 - RADIUS[b.el] * 0.85 / len;
      const pt = (t) => { const z = a.q[2] + d[2] * t, s = f / (DIST - z); return [W / 2 + (a.q[0] + d[0] * t) * s, H / 2 - (a.q[1] + d[1] * t) * s, s]; };
      items.push({ z: (a.q[2] + b.q[2]) / 2 - 0.01, bond: [pt(ta), pt(tb)], order });
    });
    items.sort((u, v) => u.z - v.z);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    for (const it of items) {
      if (it.bond) {
        const [p, q] = it.bond, s = (p[2] + q[2]) / 2, nx = -(q[1] - p[1]), ny = q[0] - p[0], nl = Math.hypot(nx, ny) || 1;
        const offs = it.order === 2 ? [-1, 1] : [0];
        ctx.strokeStyle = pal.bond; ctx.lineWidth = BOND * 2 * s * (it.order === 2 ? 0.72 : 1);
        for (const o of offs) {
          const ox = nx / nl * o * BOND * 1.5 * s, oy = ny / nl * o * BOND * 1.5 * s;
          ctx.beginPath(); ctx.moveTo(p[0] + ox, p[1] + oy); ctx.lineTo(q[0] + ox, q[1] + oy); ctx.stroke();
        }
      } else {
        const a = it.atom, r = RADIUS[a.el] * a.s, col = pal[a.el] || pal.C;
        const g = ctx.createRadialGradient(a.x - r * 0.35, a.y - r * 0.4, r * 0.1, a.x, a.y, r);
        g.addColorStop(0, shade(col, 0.5)); g.addColorStop(0.55, col); g.addColorStop(1, shade(col, -0.28));
        ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, TAU); ctx.fillStyle = g; ctx.fill();
      }
    }
  }

  // ----- the lit version -----
  let live = null;
  const hex01 = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const strands = (order) => (order === 2 ? [-1, 1] : [0]);
  function startThree(THREE) {
    const gl = el('canvas', { class: 'gl', 'aria-hidden': 'true' });
    stage.append(gl);
    const renderer = new THREE.WebGLRenderer({ canvas: gl, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(FOV, 1, 1, 60);
    cam.position.set(0, 0, DIST);
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const lamp = (euler, intensity) => { const l = new THREE.DirectionalLight(0xffffff, intensity); const e = new THREE.Euler(...euler.map((d) => d * Math.PI / 180)); l.position.set(0, 0, 1).applyEuler(e).multiplyScalar(10); scene.add(l); };
    lamp([-48, 32, 0], 2.6); lamp([30, -140, 0], 0.9);
    const mats = {};
    const paint = () => {
      const pal = palette();
      for (const k of Object.keys(pal)) {
        const m = mats[k] || (mats[k] = new THREE.MeshStandardMaterial({ metalness: 0 }));
        m.color.setRGB(...hex01(pal[k]), THREE.SRGBColorSpace); m.roughness = k === 'bond' ? 0.75 : 0.5; m.needsUpdate = true;
      }
    };
    paint();
    const mol = new THREE.Group();
    scene.add(mol);
    const sphere = new THREE.SphereGeometry(1, 36, 24), tube = new THREE.CylinderGeometry(1, 1, 1, 20, 1);
    M.atoms.forEach(([sym, x, y, z]) => {
      const m = new THREE.Mesh(sphere, mats[sym] || mats.C), r = RADIUS[sym] || 0.4;
      m.position.set(x, y, z); m.scale.setScalar(r); mol.add(m);
    });
    const up = new THREE.Vector3(0, 1, 0);
    M.bonds.forEach(([i, j, order]) => {
      const a = new THREE.Vector3(...M.atoms[i].slice(1)), b = new THREE.Vector3(...M.atoms[j].slice(1));
      const dir = b.clone().sub(a), len = dir.length(); dir.normalize();
      const mid = a.clone().add(b).multiplyScalar(0.5), q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      const side = dir.clone().cross(Math.abs(dir.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
      strands(order).forEach((o) => {
        const m = new THREE.Mesh(tube, mats.bond), t = BOND * (order === 2 ? 0.72 : 1);
        m.position.copy(mid).addScaledVector(side, o * BOND * 1.5); m.quaternion.copy(q); m.scale.set(t, len, t); mol.add(m);
      });
    });
    const pose = () => { mol.rotation.set(view.pitch, view.yaw, 0, 'XYZ'); renderer.render(scene, cam); };
    const size = () => { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); pose(); };
    new ResizeObserver(size).observe(stage);
    size(); pose();
    requestAnimationFrame(() => fig.classList.add('live'));
    live = { pose, paint: () => { paint(); pose(); } };
    window.__hero = { engine: 'three r' + THREE.REVISION, entities: mol.children.length };
  }
  function startPlayCanvas(pc) {
    const gl = el('canvas', { class: 'gl', 'aria-hidden': 'true' });
    stage.append(gl);
    const app = new pc.Application(gl, { graphicsDeviceOptions: { alpha: true, antialias: true, powerPreference: 'low-power' } });
    app.setCanvasFillMode(pc.FILLMODE_NONE);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    app.autoRender = false;
    app.scene.ambientLight = new pc.Color(0.5, 0.52, 0.56);
    const cam = new pc.Entity('camera');
    cam.addComponent('camera', { clearColor: new pc.Color(0, 0, 0, 0), fov: FOV, nearClip: 1, farClip: 60 });
    cam.setPosition(0, 0, DIST);
    app.root.addChild(cam);
    const lamp = (name, euler, intensity) => { const e = new pc.Entity(name); e.addComponent('light', { type: 'directional', color: new pc.Color(1, 1, 1), intensity, castShadows: false }); e.setEulerAngles(...euler); app.root.addChild(e); };
    lamp('key', [48, 32, 0], 1.25); lamp('rim', [-30, -140, 0], 0.45);
    const mats = {};
    const colour = (hex) => new pc.Color(...hex01(hex));
    const paint = () => {
      const pal = palette();
      for (const k of Object.keys(pal)) {
        const m = mats[k] || (mats[k] = new pc.StandardMaterial());
        m.diffuse = colour(pal[k]); m.useMetalness = false; m.specular = new pc.Color(0.22, 0.22, 0.22); m.gloss = k === 'bond' ? 0.35 : 0.62;
        m.update();
      }
    };
    paint();
    const mol = new pc.Entity('molecule');
    app.root.addChild(mol);
    M.atoms.forEach(([sym, x, y, z]) => {
      const e = new pc.Entity(sym), d = 2 * (RADIUS[sym] || 0.4);
      e.addComponent('render', { type: 'sphere', material: mats[sym] || mats.C });
      e.setLocalPosition(x, y, z); e.setLocalScale(d, d, d); mol.addChild(e);
    });
    const up = new pc.Vec3(0, 1, 0);
    M.bonds.forEach(([i, j, order]) => {
      const a = new pc.Vec3(...M.atoms[i].slice(1)), b = new pc.Vec3(...M.atoms[j].slice(1));
      const dir = new pc.Vec3().sub2(b, a), len = dir.length(); dir.normalize();
      const mid = new pc.Vec3().add2(a, b).mulScalar(0.5);
      const axis = new pc.Vec3().cross(up, dir), q = new pc.Quat();
      if (axis.length() < 1e-6) q.setFromAxisAngle(pc.Vec3.RIGHT, dir.y > 0 ? 0 : 180);
      else q.setFromAxisAngle(axis.normalize(), Math.acos(clamp(dir.y, -1, 1)) * 180 / Math.PI);
      // a second strand for double bonds, offset sideways in the plane the neighbours define
      const side = new pc.Vec3().cross(dir, Math.abs(dir.z) < 0.9 ? pc.Vec3.BACK : pc.Vec3.RIGHT).normalize();
      strands(order).forEach((o) => {
        const e = new pc.Entity('bond'), t = BOND * 2 * (order === 2 ? 0.72 : 1);
        e.addComponent('render', { type: 'cylinder', material: mats.bond });
        e.setLocalPosition(mid.x + side.x * o * BOND * 1.5, mid.y + side.y * o * BOND * 1.5, mid.z + side.z * o * BOND * 1.5);
        e.setLocalRotation(q); e.setLocalScale(t, len, t); mol.addChild(e);
      });
    });
    const qx = new pc.Quat(), qy = new pc.Quat();
    const pose = () => {
      qx.setFromAxisAngle(pc.Vec3.RIGHT, view.pitch * 180 / Math.PI); qy.setFromAxisAngle(pc.Vec3.UP, view.yaw * 180 / Math.PI);
      mol.setLocalRotation(qx.mul(qy));
      app.renderNextFrame = true;
    };
    const size = () => { app.resizeCanvas(stage.clientWidth, stage.clientHeight); app.renderNextFrame = true; };
    new ResizeObserver(size).observe(stage);
    app.start(); size(); pose();
    app.once('frameend', () => fig.classList.add('live'));
    live = { pose, paint: () => { paint(); app.renderNextFrame = true; } };
    window.__hero = { engine: 'playcanvas ' + pc.version, entities: mol.children.length };
  }
  function loadEngine() {
    if (!HERO || !HERO.src) return;
    const net = navigator.connection;
    if (net && net.saveData) return;
    try { if (!document.createElement('canvas').getContext('webgl2')) return; } catch { return; }
    const fail = (err) => console.warn('3D view unavailable, keeping the flat drawing.', err);
    if (HERO.kind === 'three') { import(HERO.src).then((THREE) => { try { startThree(THREE); } catch (err) { fail(err); } }, fail); return; }
    const s = document.createElement('script');
    s.async = true;
    s.onload = () => { try { startPlayCanvas(window.pc); } catch (err) { fail(err); } };
    s.onerror = fail;
    s.src = HERO.src;
    document.head.append(s);
  }
  // Fetch the engine only when the molecule is on screen and the browser is idle.
  const whenIdle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 600));
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting) return;
    obs.disconnect();
    if (document.readyState === 'complete') whenIdle(loadEngine); else window.addEventListener('load', () => whenIdle(loadEngine), { once: true });
  }).observe(fig);

  // ----- turning it -----
  let lx = 0, ly = 0, pid = null;
  stage.addEventListener('pointerdown', (e) => { pid = e.pointerId; lx = e.clientX; ly = e.clientY; view.held = true; view.vy = view.vp = 0; try { stage.setPointerCapture(pid); } catch { /* best effort */ } });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    view.yaw += dx * 0.011; view.pitch = clamp(view.pitch + dy * 0.011, -1.35, 1.35);
    view.vy = dx * 0.011 * 60; view.vp = dy * 0.011 * 60; view.idle = 0; view.dirty = true;
  });
  const release = (e) => { if (e.pointerId === pid) { pid = null; view.held = false; } };
  stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release);
  stage.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [-0.16, 0], ArrowRight: [0.16, 0], ArrowUp: [0, -0.16], ArrowDown: [0, 0.16] }[e.key];
    if (!step) return;
    e.preventDefault();
    view.yaw += step[0]; view.pitch = clamp(view.pitch + step[1], -1.35, 1.35); view.idle = 0; view.dirty = true;
  });
  animate(fig, (time, dt) => {
    if (!view.held) {
      if (Math.abs(view.vy) + Math.abs(view.vp) > 0.01) { // coast after a flick
        view.yaw += view.vy * dt; view.pitch = clamp(view.pitch + view.vp * dt, -1.35, 1.35);
        const k = Math.exp(-4.5 * dt); view.vy *= k; view.vp *= k; view.dirty = true;
      } else if (!calm.matches) {
        view.idle += dt;
        if (view.idle > 2.5) { view.yaw += 0.14 * dt; view.dirty = true; } // slow turn when left alone
      }
    }
    if (!view.dirty) return;
    view.dirty = false;
    if (live) live.pose(); else drawFlat();
  });
  new ResizeObserver(fit).observe(stage);
  fit(); drawFlat();
  redraws.push(() => { view.dirty = true; if (live) live.paint(); });
})();

// ---------- figures 1–6 ----------
// Pattern: model first (Core), then a draw() that reads state and renders, wired to input or animate().
const U = STUDY.unit || '';
const withUnit = (v) => fmt(v) + (U ? ' ' + U : '');
// Write a readout from parts: strings are plain text, [x] is emphasised. No HTML strings.
function say(node, ...parts) {
  node.replaceChildren(...parts.filter((p) => p !== null && p !== '').map((p) => (Array.isArray(p) ? el('b', { text: String(p[0]) }) : String(p))));
}
function pressed(buttons, on) { buttons.forEach((b) => b.setAttribute('aria-pressed', String(on(b)))); }

// Columns of patient dots. Cases fill from the bottom, so a column also reads as a bar.
function dotColumns(s, n) {
  const k = n.length, pad = s.narrow ? 6 : 26, colW = (s.w - 2 * pad) / k, base = s.h - (s.narrow ? 76 : 60), top = 22, maxN = Math.max(...n);
  let per = 2;
  while (per < 14 && Math.ceil(maxN / per) * Math.min(22, (colW - 28) / per) > base - top) per++;
  const pitch = Math.min(22, (colW - 28) / per, (base - top) / Math.ceil(maxN / per)), rad = pitch * 0.39;
  return { k, base, per, pitch, rad, colW, pad,
    cx: (i) => pad + colW * (i + 0.5),
    pos: (i, j) => [pad + colW * (i + 0.5) + ((j % per) - (per - 1) / 2) * pitch, base - pitch * (Math.floor(j / per) + 0.5)],
    level: (i, r) => base - pitch * r / per,
    countAt: (i, y) => clamp(Math.round((base - y) / pitch * per), 0, n[i]),
    groupAt: (x) => clamp(Math.floor((x - pad) / colW), 0, k - 1) };
}
function drawColumns(s, L, r, opt = {}) {
  const { ctx, w } = s, c1 = css('--c1'), muted = css('--muted'), fg = css('--fg');
  ctx.strokeStyle = css('--rule'); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L.pad / 2, L.base + 0.5); ctx.lineTo(w - L.pad / 2, L.base + 0.5); ctx.stroke();
  for (let i = 0; i < L.k; i++) {
    for (let j = 0; j < S.n[i]; j++) {
      const [x, y] = L.pos(i, j), on = j < r[i];
      const grow = on && opt.fresh && j >= opt.fresh.was[i] ? 0.55 + 0.45 * opt.fresh.t : 1; // new cases pop in
      if (on) disc(ctx, x, y, L.rad * grow, c1); else disc(ctx, x, y, L.rad - 0.6, null, muted, 1.1);
    }
    label(ctx, S.labels[i], L.cx(i), L.base + 17, fg, 'center', s.narrow ? 12 : 12.5, 600);
    if (s.narrow) { // too tight for one line under each column
      label(ctx, r[i] + ' of ' + S.n[i], L.cx(i), L.base + 34, muted, 'center', 11.5);
      label(ctx, pc1(r[i] / S.n[i]) + '%', L.cx(i), L.base + 50, muted, 'center', 11.5);
    } else label(ctx, r[i] + ' of ' + S.n[i] + ' · ' + pc1(r[i] / S.n[i]) + '%', L.cx(i), L.base + 35, muted, 'center', 12);
    if (opt.sel === i) roundRect(ctx, L.cx(i) - 26, L.base + (s.narrow ? 62 : 46), 52, 2.5, 1, fg);
  }
}

// On a phone the dot figures are as tall as their tallest column needs, two patients to a row.
const dotsNarrow = () => 104 + clamp(Math.ceil(Math.max(...S.n) / 2) * 19, 110, 220);

// Figure 1: the row as patients. Direct manipulation of the counts.
{
  const fig = $('fig-dots'), s = surface(fig.querySelector('canvas'), { narrow: dotsNarrow }), readout = fig.querySelector('.readout');
  const st = { r: S.r.slice(), sel: S.top, focus: false };
  function draw() {
    const L = dotColumns(s, S.n), i = st.sel;
    s.ctx.clearRect(0, 0, s.w, s.h);
    drawColumns(s, L, st.r, { sel: st.focus ? i : -1 });
    const same = st.r[i] === S.r[i];
    say(readout, S.labels[i] + ': ', [st.r[i] + ' of ' + S.n[i]], ' with ' + S.ev + ', which is ', [pc1(st.r[i] / S.n[i]) + '%'],
      '. One patient more or fewer moves that by ' + (100 / S.n[i]).toFixed(1) + ' points.', same ? '' : ' The trial had ' + S.r[i] + '.');
    s.canvas.setAttribute('aria-label', 'Patients with ' + S.ev + ' by group: ' + S.labels.map((l, j) => l + ' ' + st.r[j] + ' of ' + S.n[j]).join(', '));
  }
  const set = (x, y) => { const L = dotColumns(s, S.n); st.sel = L.groupAt(x); st.r[st.sel] = L.countAt(st.sel, y); draw(); };
  drag(s, { down: set, move: set });
  s.canvas.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d) return;
    e.preventDefault();
    st.sel = clamp(st.sel + d[0], 0, S.k - 1); st.r[st.sel] = clamp(st.r[st.sel] + d[1], 0, S.n[st.sel]); draw();
  });
  s.canvas.addEventListener('focus', () => { st.focus = true; draw(); });
  s.canvas.addEventListener('blur', () => { st.focus = false; draw(); });
  fig.querySelector('[data-role=reset]').onclick = () => { st.r = S.r.slice(); st.sel = S.top; draw(); };
  s.draw = draw; redraws.push(draw); draw();
}

// Figure 2: deal the same cases at random. What does chance alone produce?
{
  const fig = $('fig-shuffle'), s = surface(fig.querySelector('canvas'), { narrow: dotsNarrow }), readout = fig.querySelector('.readout');
  const autoBtn = fig.querySelector('[data-role=auto]');
  const st = { r: null, was: null, count: 0, hits: 0, auto: false, acc: 0, pop: 0, rand: rng(29) };
  function deal() {
    st.was = st.r || S.n.map(() => 0);
    st.r = C.shuffleCounts(S.n, S.R, st.rand); // MODEL: each patient equally likely to be a case, total fixed
    st.count++; if (st.r[S.top] - st.r[0] >= S.gap) st.hits++;
    st.pop = calm.matches ? 1 : 0;
  }
  function draw() {
    const L = dotColumns(s, S.n), { ctx } = s, fg = css('--fg');
    ctx.clearRect(0, 0, s.w, s.h);
    drawColumns(s, L, st.r, { fresh: { was: st.was, t: 1 - Math.pow(1 - st.pop, 3) } });
    // What the trial observed: a tick on each side of the column at that height, clear of the dots.
    ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < L.k; i++) {
      const y = Math.round(L.level(i, S.r[i])), inner = L.per * L.pitch / 2 + 2;
      for (const side of [-1, 1]) { ctx.moveTo(L.cx(i) + side * inner, y); ctx.lineTo(L.cx(i) + side * (inner + 9), y); }
    }
    ctx.stroke();
    if (!s.narrow) label(ctx, 'trial', L.cx(0) - L.per * L.pitch / 2 - 16, L.level(0, S.r[0]), fg, 'right', 11.5);
    const gap = st.r[S.top] - st.r[0];
    say(readout, 'Shuffle ' + st.count.toLocaleString('en-US') + ': ' + S.labels[0] + ' ' + st.r[0] + ', ' + S.labels[S.top] + ' ' + st.r[S.top] + ', a gap of ', [(gap > 0 ? '+' : gap < 0 ? '−' : '') + Math.abs(gap)],
      '. The top dose has finished ' + S.gap + ' or more ahead in ', [st.hits.toLocaleString('en-US') + ' of ' + st.count.toLocaleString('en-US')], ' shuffles (' + (100 * st.hits / st.count).toFixed(st.count < 200 ? 0 : 1) + '%). The trial’s gap was ' + S.gap + '.');
  }
  animate(fig, (time, dt) => {
    let dirty = false;
    if (st.auto) {
      st.acc += dt;
      const period = st.count > 120 ? 0.05 : st.count > 30 ? 0.14 : 0.4; // settle into a faster rhythm
      while (st.acc >= period) { st.acc -= period; deal(); dirty = true; }
    }
    if (st.pop < 1) { st.pop = Math.min(1, st.pop + dt / 0.16); dirty = true; }
    if (dirty) draw();
  });
  fig.querySelector('[data-role=once]').onclick = () => { deal(); draw(); };
  autoBtn.onclick = () => { st.auto = !st.auto; st.acc = 0; autoBtn.setAttribute('aria-pressed', String(st.auto)); autoBtn.textContent = st.auto ? 'Pause' : 'Keep shuffling'; };
  fig.querySelector('[data-role=reset]').onclick = () => { st.count = 0; st.hits = 0; deal(); draw(); };
  deal(); st.pop = 1;
  s.draw = draw; redraws.push(draw); draw();
}

// Figure 3: the trend statistic as a balance. Cases stand at their dose; where do they balance?
{
  const fig = $('fig-beam'), s = surface(fig.querySelector('canvas'), { narrow: () => 282 }), readout = fig.querySelector('.readout');
  const xmin = Math.min(...S.x), xmax = Math.max(...S.x);
  const st = { r: S.r.slice(), sel: S.top, focus: false, hold: null, ang: 0 };
  const X = (d) => lerp(s.w * (s.narrow ? 0.125 : 0.141), s.w * (s.narrow ? 0.875 : 0.859), (d - xmin) / (xmax - xmin || 1));
  const over = () => (s.narrow ? s.w * 0.09 : 46); // how far the beam and the ruler run past the end doses
  const beamY = () => s.h * 0.53, ruleY = () => s.h * 0.79;
  const current = () => { // counts including a case that is being carried
    if (!st.hold || st.hold.to === st.hold.from) return st.r;
    const r = st.r.slice(); r[st.hold.from]--; r[st.hold.to]++; return r;
  };
  const target = (L) => clamp(L.lean / (xmax - xmin || 1) * 1.5, -0.2, 0.2); // radians; exaggerated on purpose
  function draw() {
    const { ctx, w, h } = s, r = current(), L = C.lean(S.x, r, S.n); // MODEL: mean dose of the cases minus mean dose of everyone
    const c1 = css('--c1'), c4 = css('--c4'), fg = css('--fg'), muted = css('--muted'), by = beamY(), ry = ruleY(), fx = X(L.meanAll);
    ctx.clearRect(0, 0, w, h);
    // the beam and its load turn about the fulcrum
    ctx.save(); ctx.translate(fx, by); ctx.rotate(st.ang); ctx.translate(-fx, -by);
    ctx.strokeStyle = fg; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(X(xmin) - over(), by); ctx.lineTo(X(xmax) + over(), by); ctx.stroke();
    for (let i = 0; i < S.k; i++) {
      ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(S.x[i]), by + 2); ctx.lineTo(X(S.x[i]), by + 8); ctx.stroke();
      const show = st.hold && st.hold.from === i && st.hold.to !== i ? r[i] : (st.hold && st.hold.from === i ? r[i] - 1 : r[i]);
      for (let j = 0; j < show; j++) disc(ctx, X(S.x[i]) + ((j % 2) - 0.5) * 17, by - 12 - Math.floor(j / 2) * 17, 7.4, c1);
      if (st.focus && st.sel === i) roundRect(ctx, X(S.x[i]) - 22, by + 11, 44, 2.5, 1, fg);
    }
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(fx, by + 3); ctx.lineTo(fx - 13, by + 27); ctx.lineTo(fx + 13, by + 27); ctx.closePath(); ctx.fillStyle = muted; ctx.fill(); // fulcrum
    // ruler with the two balance points
    ctx.strokeStyle = css('--rule'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(xmin) - over(), ry); ctx.lineTo(X(xmax) + over(), ry); ctx.stroke();
    for (let i = 0; i < S.k; i++) {
      ctx.strokeStyle = muted; ctx.beginPath(); ctx.moveTo(X(S.x[i]), ry - 4); ctx.lineTo(X(S.x[i]), ry + 4); ctx.stroke();
      label(ctx, S.labels[i], X(S.x[i]), ry + 17, fg, 'center', 12, 600);
      label(ctx, r[i] + ' of ' + S.n[i], X(S.x[i]), ry + 33, muted, 'center', 11.5);
    }
    const ex = Number.isFinite(L.meanEvents) ? X(L.meanEvents) : fx, ay = ry - 13;
    ctx.fillStyle = muted; ctx.beginPath(); ctx.moveTo(fx, ry - 5); ctx.lineTo(fx - 5, ry - 13); ctx.lineTo(fx + 5, ry - 13); ctx.closePath(); ctx.fill();
    if (L.R > 0) {
      ctx.fillStyle = c4; ctx.beginPath(); ctx.moveTo(ex, ry - 5); ctx.lineTo(ex - 5, ry - 13); ctx.lineTo(ex + 5, ry - 13); ctx.closePath(); ctx.fill();
      if (Math.abs(ex - fx) > 3) { ctx.strokeStyle = c4; ctx.lineWidth = 3; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(fx, ay - 6); ctx.lineTo(ex, ay - 6); ctx.stroke(); }
      const right = ex >= fx;
      label(ctx, 'everyone ' + withUnit(L.meanAll), fx + (right ? -9 : 9), ay - 6, muted, right ? 'right' : 'left', 11.5);
      label(ctx, 'cases ' + withUnit(L.meanEvents), ex + (right ? 9 : -9), ay - 6, c4, right ? 'left' : 'right', 11.5, 600);
    }
    if (st.hold) disc(ctx, st.hold.x, st.hold.y, 8.4, c1, css('--panel'), 2);
    if (L.R === 0) say(readout, 'No cases on the beam. Reset to put them back.');
    else say(readout, 'The cases average ', [withUnit(L.meanEvents)], '; all ' + S.N + ' patients average ', [withUnit(L.meanAll)], '. Lean: ', [(L.lean > 0.5 ? '+' : L.lean < -0.5 ? '−' : '') + withUnit(Math.abs(L.lean))],
      L.lean > 0.5 ? ' toward the high doses.' : L.lean < -0.5 ? ' toward the low doses.' : ': balanced.', r.every((v, i) => v === S.r[i]) ? '' : ' The trial’s lean was +' + withUnit(C.lean(S.x, S.r, S.n).lean) + '.');
  }
  const nearest = (x) => S.x.reduce((best, d, i) => (Math.abs(X(d) - x) < Math.abs(X(S.x[best]) - x) ? i : best), 0);
  drag(s, {
    down: (x, y) => { const i = nearest(x); st.sel = i; if (y > ruleY() - 20 || st.r[i] === 0) { draw(); return false; } st.hold = { from: i, to: i, x, y }; draw(); },
    move: (x, y) => { const j = nearest(x); st.hold.to = j === st.hold.from || st.r[j] < S.n[j] ? j : st.hold.to; st.hold.x = x; st.hold.y = y; draw(); },
    up: () => { st.r = current().slice(); st.sel = st.hold.to; st.hold = null; draw(); }
  });
  s.canvas.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const j = clamp(st.sel + d, 0, S.k - 1);
    if (e.shiftKey && j !== st.sel && st.r[st.sel] > 0 && st.r[j] < S.n[j]) { st.r[st.sel]--; st.r[j]++; }
    st.sel = j; draw();
  });
  s.canvas.addEventListener('focus', () => { st.focus = true; draw(); });
  s.canvas.addEventListener('blur', () => { st.focus = false; draw(); });
  animate(fig, (time, dt) => { // the beam settles toward its new tilt
    const goal = target(C.lean(S.x, current(), S.n)), gap = (Number.isFinite(goal) ? goal : 0) - st.ang;
    if (Math.abs(gap) < 1e-4) return;
    st.ang += calm.matches ? gap : gap * (1 - Math.exp(-11 * dt)); draw();
  });
  fig.querySelector('[data-role=reset]').onclick = () => { st.r = S.r.slice(); st.sel = S.top; draw(); };
  st.ang = target(C.lean(S.x, S.r, S.n));
  s.draw = draw; redraws.push(draw); draw();
}

// Figure 4: the lean of many shuffles, piled up. The tail share is the P value.
{
  const fig = $('fig-pile'), s = surface(fig.querySelector('canvas'), { narrow: () => 258 }), readout = fig.querySelector('.readout');
  const runBtn = fig.querySelector('[data-role=run]'), sides = [...fig.querySelectorAll('[data-side]')];
  const tr = S.A.trend, ex = tr.exact, base = C.lean(S.x, S.r, S.n);
  const pts = (ex.points || []).map(([t, p]) => ({ lean: t / S.R - base.meanAll, p })); // MODEL: exact conditional distribution
  const step = pts.length > 1 ? Math.min(...pts.slice(1).map((q, i) => q.lean - pts[i].lean)) : 1;
  const sd = Math.sqrt(tr.varT) / S.R, obs = base.lean;
  let span = step; { let tail = 0; for (let i = 0; i < pts.length / 2; i++) { tail += pts[i].p + pts[pts.length - 1 - i].p; if (tail > 0.002) { span = Math.abs(pts[i].lean); break; } } }
  span = Math.max(Math.ceil(Math.max(span, Math.abs(obs) * 1.5) / 50) * 50, 50);
  const index = new Map(pts.map((q, i) => [Math.round(q.lean / step), i]));
  const st = { n: new Uint32Array(pts.length), total: 0, side: 'two', running: false, rand: rng(4) };
  const one = () => {
    const c = C.shuffleCounts(S.n, S.R, st.rand); let T = 0;
    for (let i = 0; i < S.k; i++) T += S.x[i] * c[i];
    const i = index.get(Math.round((T / S.R - base.meanAll) / step));
    if (i !== undefined) st.n[i]++;
    st.total++;
  };
  const inTail = (lean) => (st.side === 'two' ? Math.abs(lean) >= Math.abs(obs) - 1e-9 : (obs >= 0 ? lean >= obs - 1e-9 : lean <= obs + 1e-9));
  function draw() {
    const { ctx, w, h } = s, c1 = css('--c1'), c3 = css('--c3'), c4 = css('--c4'), fg = css('--fg'), muted = css('--muted');
    const x0 = s.narrow ? 20 : 34, x1 = w - 20, yb = h - 46, yt = 34, X = (v) => lerp(x0, x1, (v + span) / (2 * span));
    const pMax = Math.max(...pts.map((q) => q.p)) * 1.22, Y = (p) => yb - (yb - yt) * p / pMax, bw = Math.max(1.5, X(step) - X(0) - 1.2);
    ctx.clearRect(0, 0, w, h);
    let tail = 0;
    pts.forEach((q, i) => {
      const t = inTail(q.lean); if (t) tail += st.n[i];
      if (Math.abs(q.lean) > span || !st.n[i]) return;
      const y = Y(st.n[i] / st.total);
      ctx.fillStyle = t ? c1 : c3; ctx.globalAlpha = t ? 1 : 0.8; ctx.fillRect(X(q.lean) - bw / 2, y, bw, yb - y); ctx.globalAlpha = 1;
    });
    ctx.beginPath(); // exact outline, as steps
    pts.forEach((q, i) => { if (Math.abs(q.lean) > span + step) return; const xa = X(q.lean - step / 2), xb = X(q.lean + step / 2), y = Y(q.p); if (i === 0 || Math.abs(pts[i - 1].lean) > span + step) ctx.moveTo(xa, yb); ctx.lineTo(xa, y); ctx.lineTo(xb, y); });
    ctx.strokeStyle = fg; ctx.lineWidth = 1.2; ctx.lineJoin = 'miter'; ctx.stroke();
    const bell = []; for (let v = -span; v <= span; v += span / 90) bell.push([X(v), Y(Math.exp(-0.5 * (v / sd) ** 2) / (sd * Math.sqrt(TAU)) * step)]);
    polyline(ctx, bell, c4, 2);
    ctx.strokeStyle = css('--rule'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, yb + 0.5); ctx.lineTo(x1, yb + 0.5); ctx.stroke();
    const tick = span / 2;
    for (let v = -span; v <= span + 1e-9; v += tick) { ctx.beginPath(); ctx.moveTo(X(v), yb); ctx.lineTo(X(v), yb + 5); ctx.strokeStyle = muted; ctx.stroke(); label(ctx, (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v), X(v), yb + 16, muted, 'center', 11.5); }
    label(ctx, 'lean of the cases' + (U ? ', ' + U : ''), x0, yb + 34, muted, 'left', 11.5);
    label(ctx, 'toward high doses →', x1, yb + 34, muted, 'right', 11.5);
    const mark = (v, text, strong) => {
      ctx.strokeStyle = strong ? c1 : muted; ctx.lineWidth = strong ? 2 : 1; ctx.beginPath(); ctx.moveTo(X(v), yt - 8); ctx.lineTo(X(v), yb); ctx.stroke();
      const tw = textWidth(ctx, text, 11.5, strong ? 600 : 500); // keep the words on the canvas when the line is near an edge
      const left = clamp(v >= 0 ? X(v) + 6 : X(v) - 6 - tw, 2, w - 2 - tw);
      label(ctx, text, left, yt - 14, strong ? c1 : muted, 'left', 11.5, strong ? 600 : 500);
    };
    if (Math.abs(obs) <= span) { mark(obs, 'the trial, ' + (obs >= 0 ? '+' : '−') + withUnit(Math.abs(obs)), true); if (st.side === 'two') mark(-obs, 'as far the other way', false); }
    const share = st.total ? tail / st.total : 0;
    say(readout, [st.total.toLocaleString('en-US')], ' shuffles; ', [tail.toLocaleString('en-US')], ' lean at least ' + withUnit(Math.abs(obs)) + (st.side === 'two' ? ' either way' : ' toward the high doses') + ', a share of ', [(100 * share).toFixed(1) + '%'],
      '. Every possible shuffle counted: ', ['P ' + C.fmtPeq(st.side === 'two' ? ex.pTwo : (obs >= 0 ? ex.pInc : ex.pDec))], '. Bell-curve shortcut: ', ['P ' + C.fmtPeq(st.side === 'two' ? tr.pTwo : (obs >= 0 ? tr.pInc : tr.pDec))], '.');
  }
  const stop = () => { st.running = false; runBtn.setAttribute('aria-pressed', 'false'); runBtn.textContent = st.total >= 200000 ? 'That is plenty' : 'Run the shuffles'; };
  animate(fig, () => {
    if (!st.running) return;
    const batch = clamp(Math.round(st.total / 45), 6, 900); // slow enough to watch at first, then it gathers pace
    for (let i = 0; i < batch; i++) one();
    if (st.total >= 200000) stop();
    draw();
  });
  runBtn.onclick = () => {
    if (st.total >= 200000) return;
    if (calm.matches) { for (let i = 0; i < 20000; i++) one(); draw(); return; } // no animation: add a batch at once
    st.running = !st.running; runBtn.setAttribute('aria-pressed', String(st.running)); runBtn.textContent = st.running ? 'Pause' : 'Run the shuffles';
  };
  sides.forEach((b) => (b.onclick = () => { st.side = b.dataset.side; pressed(sides, (q) => q.dataset.side === st.side); draw(); }));
  const reset = () => { st.n.fill(0); st.total = 0; st.rand = rng(4); for (let i = 0; i < 400; i++) one(); };
  fig.querySelector('[data-role=reset]').onclick = () => { stop(); reset(); draw(); };
  reset();
  s.draw = draw; redraws.push(draw); draw();
}

// Figure 5: one ordered question (trend) beside one question per dose (pairwise).
{
  const fig = $('fig-verdicts'), s = surface(fig.querySelector('canvas'), { narrow: () => 236 + 38 * S.k + 48 }), readout = fig.querySelector('.readout');
  const presets = [...fig.querySelectorAll('[data-preset]')];
  const tables = { trial: S.r, stair: STUDY.presets.stair, spike: STUDY.presets.spike, flat: STUDY.presets.flat };
  const st = { r: S.r.slice(), sel: 0, focus: false, preset: 'trial' };
  // Bars on the left and the P values on the right; on a phone the P values go underneath. pt and pb bound the P rows.
  const geo = () => {
    if (s.narrow) { const L = 8, R = s.w - 8, yt = 40, yb = 150, pt = 236; return { L, R, yt, yb, band: (R - L) / S.k, px0: 12, px1: s.w - 12, pt, pb: pt + 38 * S.k }; }
    const L = 22, R = Math.min(300, s.w * 0.44), yb = s.h - 62, yt = 46;
    return { L, R, yb, yt, band: (R - L) / S.k, px0: R + 44, px1: s.w - 18, pt: yt, pb: yb };
  };
  function draw() {
    const { ctx, w, h } = s, g = geo(), A = S.analyze(st.r); // MODEL: Cochran–Armitage on all groups; Fisher per dose, Holm-adjusted
    const c2 = css('--c2'), c4 = css('--c4'), fg = css('--fg'), muted = css('--muted'), rule = css('--rule'), grid = css('--grid');
    ctx.clearRect(0, 0, w, h);
    // left: the table as bars
    label(ctx, '% with ' + S.ev, g.L, g.yt - 22, muted, 'left', 11.5);
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(g.L, g.yb + 0.5); ctx.lineTo(g.R, g.yb + 0.5); ctx.stroke();
    for (let i = 0; i < S.k; i++) {
      const cx = g.L + g.band * (i + 0.5), p = st.r[i] / S.n[i], y = lerp(g.yb, g.yt, p), bw = Math.min(30, g.band * 0.56);
      roundRect(ctx, cx - bw / 2, g.yt, bw, g.yb - g.yt, 2, grid);
      if (st.r[i] > 0) roundRect(ctx, cx - bw / 2, y, bw, g.yb - y, 2, i === 0 ? muted : c2);
      label(ctx, pc1(p) + '%', cx, y - 10, fg, 'center', 11.5, 600);
      const fits = textWidth(ctx, S.labels[i], 11.5, 600) <= g.band - 3; // a long name keeps only its first word here
      label(ctx, fits ? S.labels[i] : S.labels[i].split(' ')[0], cx, g.yb + 15, fg, 'center', 11.5, 600);
      label(ctx, st.r[i] + '/' + S.n[i], cx, g.yb + 31, muted, 'center', 11);
      if (st.focus && st.sel === i) roundRect(ctx, cx - 20, g.yb + 42, 40, 2.5, 1, fg);
    }
    // right: P values on a scale where further right is stronger evidence
    const tr = A.trend, rows = [{ name: 'Trend, all ' + S.k + ' groups', p: tr.computable ? tr.pTwo : NaN, col: c4, strong: true }]
      .concat(A.pairs.map((d) => ({ name: d.label + ' vs ' + lc(S.labels[0]), p: d.pHolm, col: c2 })));
    const PX = (p) => lerp(g.px0, g.px1, clamp(-Math.log10(Math.max(p, 1e-4)) / 3.3, 0, 1));
    [[1, '1'], [0.1, '0.1'], [0.05, '0.05'], [0.01, '0.01'], [0.001, '0.001']].forEach(([p, t]) => {
      ctx.strokeStyle = p === 0.05 ? fg : rule; ctx.lineWidth = p === 0.05 ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(PX(p), g.pt - 6); ctx.lineTo(PX(p), g.pb + 6); ctx.stroke();
      label(ctx, t, PX(p), g.pb + 18, p === 0.05 ? fg : muted, 'center', 11, p === 0.05 ? 600 : 500);
    });
    label(ctx, 'P value', g.px0, g.pt - 22, muted, 'left', 11.5);
    label(ctx, 'smaller →', g.px1, g.pt - 22, muted, 'right', 11.5);
    const pitch = (g.pb - g.pt) / rows.length;
    rows.forEach((row, i) => {
      const y = g.pt + pitch * (i + 0.5), ok = Number.isFinite(row.p), sig = ok && row.p < 0.05;
      label(ctx, row.name, g.px0, y - 9, fg, 'left', 12, row.strong ? 600 : 500);
      roundRect(ctx, g.px0, y + 3, g.px1 - g.px0, 6, 3, grid);
      if (ok) { roundRect(ctx, g.px0, y + 3, Math.max(4, PX(row.p) - g.px0), 6, 3, row.col); disc(ctx, PX(row.p), y + 6, sig ? 6 : 4.5, sig ? row.col : css('--panel'), row.col, 2); }
      label(ctx, ok ? 'P ' + C.fmtPeq(row.p) : 'not testable', g.px1, y - 9, sig ? fg : muted, 'right', 12, sig ? 600 : 500);
    });
    label(ctx, 'pairwise P values are Holm-adjusted', g.px0, g.pb + 36, muted, 'left', 11);
    const best = A.pairs.reduce((a, b) => (b.pHolm < a.pHolm ? b : a), A.pairs[0]);
    const tSig = tr.computable && tr.pTwo < 0.05, pSig = best && best.pHolm < 0.05;
    say(readout, 'Trend test on all ' + S.N + ' patients: ', [tr.computable ? 'P ' + C.fmtPeq(tr.pTwo) : 'not testable'], '. Best single comparison, ' + best.label + ' against ' + lc(S.labels[0]) + ': ', ['P ' + C.fmtPeq(best.pHolm)], ' after adjustment (' + C.fmtP(best.p) + ' before). ',
      tSig && pSig ? 'Both get under 0.05.' : tSig ? 'A climb the trend test can see, though no single dose stands out.' : pSig ? 'One dose stands out, but there is no climb for the trend test to find.' : 'Neither gets under 0.05.');
    s.canvas.setAttribute('aria-label', 'Cases by group: ' + st.r.map((v, i) => S.labels[i] + ' ' + v + ' of ' + S.n[i]).join(', ') + '. ' + readout.textContent);
  }
  const custom = () => { st.preset = 'custom'; pressed(presets, () => false); };
  const set = (x, y) => { const g = geo(); if (x > g.R + 12 || y > g.yb + 50) return false; st.sel = clamp(Math.floor((x - g.L) / g.band), 0, S.k - 1); st.r[st.sel] = clamp(Math.round(S.n[st.sel] * (g.yb - y) / (g.yb - g.yt)), 0, S.n[st.sel]); custom(); draw(); };
  drag(s, { down: set, move: set });
  s.canvas.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d) return;
    e.preventDefault();
    st.sel = clamp(st.sel + d[0], 0, S.k - 1);
    if (d[1]) { st.r[st.sel] = clamp(st.r[st.sel] + d[1], 0, S.n[st.sel]); custom(); }
    draw();
  });
  s.canvas.addEventListener('focus', () => { st.focus = true; draw(); });
  s.canvas.addEventListener('blur', () => { st.focus = false; draw(); });
  presets.forEach((b) => (b.onclick = () => { st.preset = b.dataset.preset; st.r = tables[st.preset].slice(); pressed(presets, (q) => q === b); draw(); }));
  s.draw = draw; redraws.push(draw); draw();
}

// Figure 6: every trial that differs from this one only at the two ends, shaded by its P value.
{
  const T = S.top, nx = S.n[T] + 1, ny = S.n[0] + 1, narrowCell = (w) => Math.min(26, (w - 54) / nx);
  const fig = $('fig-land'), s = surface(fig.querySelector('canvas'), { narrow: (w) => 26 + narrowCell(w) * ny + 46 + 58 }), readout = fig.querySelector('.readout');
  const modes = [...fig.querySelectorAll('[data-mode]')];
  const st = { a: S.r[0], b: S.r[T], mode: 'asym', focus: false, grids: { asym: C.landscape(S.x, S.r, S.n, 0, T, false), exact: null }, partial: null, building: 0 };
  const gridNow = () => (st.mode === 'exact' ? (st.grids.exact || st.partial || st.grids.asym) : st.grids.asym);
  const geo = () => {
    if (s.narrow) { const cell = narrowCell(s.w); return { cell, x0: 46, y0: 26, gw: cell * nx, gh: cell * ny }; }
    const cell = Math.min((s.w - 190) / nx, (s.h - 96) / ny); return { cell, x0: 92, y0: 26, gw: cell * nx, gh: cell * ny };
  };
  const shadeOf = (p) => (Number.isFinite(p) ? clamp(-Math.log10(Math.max(p, 1e-4)) / 3, 0, 1) : -1);
  const mixHex = (a, b, t) => { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); return 'rgb(' + [16, 8, 0].map((sh) => Math.round(lerp(pa >> sh & 255, pb >> sh & 255, t))).join(',') + ')'; };
  function draw() {
    const { ctx, w, h } = s, g = geo(), G = gridNow(); // MODEL: two-sided trend P for each pair of end counts
    const c1 = css('--c1'), c2 = css('--c2'), fg = css('--fg'), muted = css('--muted'), panel = css('--panel'), grid = css('--grid');
    const cx = (b) => g.x0 + g.cell * b, cy = (a) => g.y0 + g.gh - g.cell * (a + 1); // placebo count rises upward
    ctx.clearRect(0, 0, w, h);
    for (let a = 0; a < ny; a++) for (let b = 0; b < nx; b++) {
      const t = shadeOf(G[a][b].p);
      ctx.fillStyle = t < 0 ? grid : mixHex(panel.length === 7 ? panel : '#ffffff', c2, 0.06 + 0.94 * t);
      ctx.fillRect(cx(b) + 0.5, cy(a) + 0.5, g.cell - 1, g.cell - 1);
    }
    ctx.strokeStyle = fg; ctx.lineWidth = 2.2; ctx.lineCap = 'square'; ctx.beginPath(); // the P = 0.05 frontier, along cell edges
    const sig = (a, b) => a >= 0 && b >= 0 && a < ny && b < nx && G[a][b].p < 0.05;
    for (let a = 0; a < ny; a++) for (let b = 0; b < nx; b++) {
      if (b + 1 < nx && sig(a, b) !== sig(a, b + 1)) { ctx.moveTo(cx(b + 1), cy(a)); ctx.lineTo(cx(b + 1), cy(a) + g.cell); }
      if (a + 1 < ny && sig(a, b) !== sig(a + 1, b)) { ctx.moveTo(cx(b), cy(a)); ctx.lineTo(cx(b) + g.cell, cy(a)); }
    }
    ctx.stroke();
    const every = g.cell >= 20 ? 1 : g.cell >= 11 ? 2 : 5;
    for (let b = 0; b < nx; b += every) label(ctx, String(b), cx(b) + g.cell / 2, g.y0 + g.gh + 13, muted, 'center', 11);
    for (let a = 0; a < ny; a += every) label(ctx, String(a), g.x0 - 9, cy(a) + g.cell / 2, muted, 'right', 11);
    label(ctx, 'cases at ' + S.labels[T] + ' (of ' + S.n[T] + ')', g.x0 + g.gw / 2, g.y0 + g.gh + 33, fg, 'center', 12, 600);
    ctx.save(); ctx.translate(g.x0 - (s.narrow ? 34 : 44), g.y0 + g.gh / 2); ctx.rotate(-Math.PI / 2); label(ctx, 'cases on ' + lc(S.labels[0]) + ' (of ' + S.n[0] + ')', 0, 0, fg, 'center', 12, 600); ctx.restore();
    const note = (text, x, y, align) => { const tw = textWidth(ctx, text, 11) + 12;
      ctx.globalAlpha = 0.88; roundRect(ctx, align === 'left' ? x - 6 : x - tw + 6, y - 9, tw, 18, 3, panel); ctx.globalAlpha = 1; label(ctx, text, x, y, fg, align, 11); };
    note('falls with dose', g.x0 + 10, g.y0 + 14, 'left'); note('climbs with dose', g.x0 + g.gw - 10, g.y0 + g.gh - 14, 'right');
    const ring = (a, b, col, lw) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.strokeRect(cx(b) + 1.5, cy(a) + 1.5, g.cell - 3, g.cell - 3); };
    ring(S.r[0], S.r[T], c1, 3);
    label(ctx, 'the trial', cx(S.r[T]) + g.cell / 2, cy(S.r[0]) - 9, c1, 'center', 11.5, 600);
    if (st.a !== S.r[0] || st.b !== S.r[T]) { ring(st.a, st.b, fg, 3); ctx.strokeStyle = panel; ctx.lineWidth = 1; ctx.strokeRect(cx(st.b) + 3.5, cy(st.a) + 3.5, g.cell - 7, g.cell - 7); }
    else if (st.focus) ring(st.a, st.b, fg, 1.5);
    // key: beside the grid, or under it when there is no room beside
    const shade = (t) => mixHex(panel.length === 7 ? panel : '#ffffff', c2, 0.06 + 0.94 * t);
    const stops = [[1, '1'], [0.1, '0.1'], [0.05, '0.05'], [0.01, '0.01'], [0.001, '0.001']];
    if (s.narrow) {
      const kx = g.x0 + 18, kw = Math.min(210, g.gw - 30), ky = g.y0 + g.gh + 56;
      for (let i = 0; i < kw; i++) { ctx.fillStyle = shade(i / kw); ctx.fillRect(kx + i, ky, 1.2, 11); }
      label(ctx, 'P', kx - 8, ky + 5.5, fg, 'right', 12, 600);
      stops.forEach(([p, t]) => { const x = kx + kw * shadeOf(p); ctx.strokeStyle = fg; ctx.lineWidth = p === 0.05 ? 2 : 1; ctx.beginPath(); ctx.moveTo(x, ky + 11); ctx.lineTo(x, ky + (p === 0.05 ? 18 : 15)); ctx.stroke();
        if (p !== 0.1) label(ctx, t, x, ky + 26, p === 0.05 ? fg : muted, 'center', 11, p === 0.05 ? 600 : 500); }); // 0.1 would sit on top of 0.05
    } else {
      const kx = g.x0 + g.gw + 30, kh = Math.min(170, g.gh * 0.5), ky = g.y0 + 22;
      for (let i = 0; i < kh; i++) { ctx.fillStyle = shade(i / kh); ctx.fillRect(kx, ky + i, 13, 1.2); }
      label(ctx, 'P', kx, ky - 12, fg, 'left', 12, 600);
      stops.forEach(([p, t]) => { const y = ky + kh * shadeOf(p); ctx.strokeStyle = fg; ctx.lineWidth = p === 0.05 ? 2 : 1; ctx.beginPath(); ctx.moveTo(kx + 13, y); ctx.lineTo(kx + (p === 0.05 ? 22 : 18), y); ctx.stroke(); label(ctx, t, kx + 26, y, p === 0.05 ? fg : muted, 'left', 11, p === 0.05 ? 600 : 500); });
    }
    const p = G[st.a][st.b].p, far = Math.abs(st.a - S.r[0]) + Math.abs(st.b - S.r[T]);
    const building = st.mode === 'exact' && !st.grids.exact;
    say(readout, cap(lc(S.labels[0])) + ' ' + st.a + ' of ' + S.n[0] + ', ' + S.labels[T] + ' ' + st.b + ' of ' + S.n[T] + ': ', [Number.isFinite(p) ? 'P ' + C.fmtPeq(p) : 'not testable'], Number.isFinite(p) ? (p < 0.05 ? ', below 0.05.' : ', not below 0.05.') : '.',
      far === 0 ? ' This is the trial.' : ' That is ' + far + (far === 1 ? ' patient' : ' patients') + ' away from the trial.', building ? ' Counting every shuffle for each cell: ' + Math.round(100 * st.building / ny) + '%.' : '');
    s.canvas.setAttribute('aria-label', 'Grid of trend-test P values. ' + readout.textContent);
  }
  const pickCell = (x, y) => { const g = geo(), b = Math.floor((x - g.x0) / g.cell), a = ny - 1 - Math.floor((y - g.y0) / g.cell); if (a < 0 || b < 0 || a >= ny || b >= nx) return false; st.a = a; st.b = b; draw(); };
  drag(s, { down: pickCell, move: (x, y) => { pickCell(x, y); } });
  s.canvas.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, 0], ArrowDown: [-1, 0] }[e.key];
    if (!d) return;
    e.preventDefault(); st.a = clamp(st.a + d[0], 0, ny - 1); st.b = clamp(st.b + d[1], 0, nx - 1); draw();
  });
  s.canvas.addEventListener('focus', () => { st.focus = true; draw(); });
  s.canvas.addEventListener('blur', () => { st.focus = false; draw(); });
  // The exact grid takes a moment, so it is filled a row at a time while the figure stays usable.
  animate(fig, () => {
    if (st.mode !== 'exact' || st.grids.exact) return;
    if (!st.partial) { st.partial = st.grids.asym.map((row) => row.map((c) => ({ p: c.p, z: c.z }))); st.building = 0; }
    const a = st.building;
    for (let b = 0; b < nx; b++) {
      const r = S.r.slice(); r[0] = a; r[T] = b;
      if (!C.cochranArmitage(S.x, r, S.n).computable) continue;
      const e = C.exactTrend(S.x, r, S.n);
      if (e) st.partial[a][b].p = e.pTwo;
    }
    if (++st.building >= ny) { st.grids.exact = st.partial; st.partial = null; }
    draw();
  });
  modes.forEach((b) => (b.onclick = () => { st.mode = b.dataset.mode; pressed(modes, (q) => q === b); draw(); }));
  fig.querySelector('[data-role=reset]').onclick = () => { st.a = S.r[0]; st.b = S.r[T]; draw(); };
  s.draw = draw; redraws.push(draw); draw();
}

// ---------- figure 7: the analyzer (table in, tests out) ----------
const tool = {
  groups: [], rows: [], sel: 0, scoreType: 'dose', alt: 'two', includeRef: true, result: null,
  isStudy: true, // the grid still holds the study's own table, so its design notes apply
  fig: { journal: 'nature', column: 'double', panelA: 'schematic', style: 'bars', palette: 'soft', pA: 'asym', pB: 'holm', border: true, xTitle: '', yTitle: '', population: '', design: '', duration: '' },
  image: null, built: null, custom: false
};
const inClaude = !!(window.claude && typeof window.claude.use === 'function');
const pickP = (o) => (tool.alt === 'two' ? o.pTwo : tool.alt === 'inc' ? o.pInc : o.pDec);
const sided = () => (tool.alt === 'two' ? 'two-sided' : 'one-sided');
const pct = (v, d = 1) => (100 * v).toFixed(d);
let studio = { render() {} }; // set by the figure studio below

function setMsg(text, bad, list) {
  const m = $('parse-msg');
  clear(m); m.className = 'msg' + (bad ? ' bad' : '');
  if (!text) return;
  m.append(text);
  if (list && list.length) m.append(el('ul', null, ...list.map((t) => el('li', { text: t }))));
}

// ----- loading a table -----
let studyImage = null; // the trial's own panel-a illustration, once read
STUDY.panelAReady.then((img) => { studyImage = img; });
function loadParsed(parsed, message, prefer, fromStudy) {
  tool.groups = parsed.groups.map((g) => ({ label: g.label, n: g.n, role: g.role, score: g.score }));
  tool.rows = parsed.rows.map((r) => ({ label: r.label, counts: r.counts.slice() }));
  let sel = prefer ? tool.rows.findIndex((r) => prefer.test(r.label)) : -1;
  if (sel < 0) sel = tool.rows.findIndex((r) => !/^(all|any|total|overall)\b/i.test(r.label));
  tool.sel = Math.max(0, sel);
  tool.isStudy = !!fromStudy;
  tool.custom = false;
  // Design notes and the illustration describe one particular trial; they do not carry over to another table.
  tool.image = fromStudy && studyImage ? studyImage : null;
  if (fromStudy && !studyImage) STUDY.panelAReady.then((img) => { if (img && tool.isStudy && !tool.image) { tool.image = img; if (tool.fig.panelA === 'image') studio.render(); } });
  Object.assign(tool.fig, fromStudy ? { xTitle: STUDY.xTitle, population: STUDY.population, design: STUDY.design, duration: STUDY.duration } : { xTitle: '', population: '', design: '', duration: '' });
  if (!tool.image && tool.fig.panelA === 'image') tool.fig.panelA = 'schematic';
  ['xt', 'pop', 'design', 'dur'].forEach((k, i) => { $('fig-' + k).value = [tool.fig.xTitle, tool.fig.population, tool.fig.design, tool.fig.duration][i]; });
  $('fig-panel-a').value = tool.fig.panelA;
  renderGrid(); recompute();
  const used = tool.groups.filter((g) => g.role !== 'skip').length;
  setMsg(message + ' ' + tool.rows.length + (tool.rows.length === 1 ? ' event row' : ' event rows') + ' and ' + used + ' groups are in the grid.', false, parsed.notes);
}
function parsePasted() {
  const parsed = C.parseTable($('paste-box').value);
  if (parsed.error) { setMsg(parsed.error, true); return; }
  loadParsed(parsed, 'Table read from the pasted text.', null, $('paste-box').value.trim() === STUDY.tableText.trim());
}
function loadExample() {
  $('paste-box').value = STUDY.tableText;
  loadParsed(C.parseTable(STUDY.tableText), 'Example loaded: the ' + lc(STUDY.drug) + ' table from the top of the page.', STUDY.focus, true);
}

// ----- editable grid -----
const intOrNull = (v) => (/^\d+$/.test(String(v).trim()) ? parseInt(v, 10) : null);
const numOrNull = (v) => { v = String(v).trim().replace(',', '.'); return v !== '' && isFinite(+v) ? +v : null; };
let timer = null;
const soon = () => { clearTimeout(timer); timer = setTimeout(recompute, 140); };

function renderGrid() {
  const t = $('grid'); clear(t);
  const rows = ['Group', 'Use as', 'Dose score', 'Patients (n)'].map((h) => el('tr', null, el('th', { class: 'rowhead', scope: 'row', text: h })));
  tool.groups.forEach((g, j) => {
    const cls = g.role === 'skip' ? 'skip' : '';
    const name = el('input', { type: 'text', class: 'gname', id: 'g-name-' + j, 'aria-label': 'Group ' + (j + 1) + ' name' });
    name.value = g.label; name.oninput = () => { g.label = name.value; soon(); };
    const rm = el('button', { type: 'button', class: 'x', 'aria-label': 'Remove group ' + g.label, title: 'Remove this group' }, '×');
    rm.onclick = () => { tool.groups.splice(j, 1); tool.rows.forEach((r) => r.counts.splice(j, 1)); renderGrid(); recompute(); };
    rows[0].append(el('th', { class: cls }, el('div', { class: 'colhead' }, name, rm)));
    const role = el('select', { id: 'g-role-' + j, 'aria-label': 'How to use ' + g.label }, ...[['ref', 'Reference'], ['dose', 'Dose group'], ['skip', 'Leave out']].map(([v, text]) => el('option', { value: v, text })));
    role.value = g.role;
    role.onchange = () => {
      if (role.value === 'ref') { tool.groups.forEach((h) => { if (h !== g && h.role === 'ref') h.role = 'dose'; }); if (g.score === null) g.score = 0; }
      g.role = role.value; renderGrid(); recompute();
    };
    rows[1].append(el('td', { class: cls }, role));
    const sc = el('input', { type: 'text', inputmode: 'decimal', class: 'n', id: 'g-score-' + j, 'aria-label': 'Dose score for ' + g.label });
    sc.value = g.score === null ? '' : C.fmtScore(g.score); sc.oninput = () => { g.score = numOrNull(sc.value); soon(); };
    rows[2].append(el('td', { class: cls }, sc));
    const n = el('input', { type: 'text', inputmode: 'numeric', class: 'n', id: 'g-n-' + j, 'aria-label': 'Number of patients in ' + g.label });
    n.value = g.n === null ? '' : String(g.n); n.oninput = () => { g.n = intOrNull(n.value); soon(); };
    rows[3].append(el('td', { class: cls }, n));
  });
  const tbody = el('tbody');
  tool.rows.forEach((r, i) => {
    const radio = el('input', { type: 'radio', name: 'ev', id: 'ev-radio-' + i, 'aria-label': 'Analyse ' + r.label });
    radio.checked = i === tool.sel; radio.onchange = () => selectRow(i);
    const name = el('input', { type: 'text', id: 'ev-name-' + i, 'aria-label': 'Event name, row ' + (i + 1) });
    name.value = r.label; name.oninput = () => { r.label = name.value; fillEventSelect(); soon(); };
    const tr = el('tr', { class: i === tool.sel ? 'sel' : '' }, el('th', { scope: 'row' }, el('div', { class: 'ev' }, radio, name)));
    tool.groups.forEach((g, j) => {
      const c = el('input', { type: 'text', inputmode: 'numeric', id: 'c-' + i + '-' + j, 'aria-label': r.label + ', ' + g.label });
      c.value = r.counts[j] === null || r.counts[j] === undefined ? '' : String(r.counts[j]); c.oninput = () => { r.counts[j] = intOrNull(c.value); soon(); };
      tr.append(el('td', { class: g.role === 'skip' ? 'skip' : '' }, c));
    });
    const rm = el('button', { type: 'button', class: 'x', 'aria-label': 'Remove row ' + r.label, title: 'Remove this row' }, '×');
    rm.onclick = () => { tool.rows.splice(i, 1); if (tool.sel >= tool.rows.length) tool.sel = Math.max(0, tool.rows.length - 1); else if (tool.sel > i) tool.sel--; renderGrid(); recompute(); };
    tr.append(el('td', null, rm)); tbody.append(tr);
  });
  t.append(el('thead', null, ...rows), tbody);
  fillEventSelect();
}
function fillEventSelect() {
  const s = $('sel-event');
  s.replaceChildren(...tool.rows.map((r, i) => el('option', { value: String(i), text: r.label || 'Row ' + (i + 1) })));
  s.value = String(tool.sel);
}
function selectRow(i) {
  tool.sel = i;
  [...$('grid').tBodies[0].rows].forEach((tr, k) => { tr.className = k === i ? 'sel' : ''; const rd = $('ev-radio-' + k); if (rd) rd.checked = k === i; });
  $('sel-event').value = String(i);
  recompute();
}
function markCells() {
  tool.groups.forEach((g, j) => {
    const used = g.role !== 'skip', nIn = $('g-n-' + j);
    if (nIn) nIn.classList.toggle('invalid', used && !(Number.isInteger(g.n) && g.n > 0));
    tool.rows.forEach((r, i) => {
      const c = $('c-' + i + '-' + j); if (!c) return;
      const v = r.counts[j];
      c.classList.toggle('invalid', !!(used && ((i === tool.sel && !Number.isInteger(v)) || (Number.isInteger(v) && Number.isInteger(g.n) && v > g.n))));
    });
  });
}

// ----- analysis and its write-up -----
function recompute() {
  const row = tool.rows[tool.sel];
  tool.result = row ? C.analyze({ groups: tool.groups, counts: row.counts, event: row.label || 'the event', scoreType: tool.scoreType, includeRef: tool.includeRef }) : null;
  tool.custom = false;
  markCells(); renderResults(); studio.render();
}
function tile(k, v, s, flag, sig) {
  return el('div', { class: 'tile' }, el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v }), s ? el('span', { class: 's', text: s }) : null, flag ? el('span', { class: 'flag' + (sig ? ' sig' : ''), text: flag }) : null);
}
const exactName = (ex) => (ex.method === 'mc' ? 'Permutation test, ' + ex.B.toLocaleString('en-US') + ' Monte Carlo samples' : 'Exact conditional test');

function renderResults() {
  const errBox = $('errors'), box = $('results'), res = tool.result;
  clear(errBox);
  if (!res || !res.ok) {
    box.style.display = 'none';
    errBox.append('The tests cannot run yet.', el('ul', null, ...(res ? res.errors : ['Add at least one event row to the table.']).slice(0, 6).map((t) => el('li', { text: t }))));
    return;
  }
  box.style.display = 'grid';
  const tr = res.trend, ev = res.event, ref = res.ref, tiles = $('tiles'), warn = $('warnings'), parts = [];
  clear(tiles); clear(warn);
  const first = res.groups[0], last = res.groups[res.groups.length - 1];
  if (tr.computable) {
    const pa = pickP(tr), pe = pickP(tr.exact);
    tiles.append(tile('Trend across dose', 'P ' + C.fmtPeq(pa), 'Cochran–Armitage, ' + sided() + ' · z = ' + C.fmtNum(tr.z, 2), pa < 0.05 ? 'Below 0.05' : 'Not below 0.05', pa < 0.05),
      tile('Same test, exact', 'P ' + C.fmtPeq(pe), exactName(tr.exact) + ', ' + sided(), pe < 0.05 ? 'Below 0.05' : 'Not below 0.05', pe < 0.05));
  } else tiles.append(tile('Trend across dose', 'Not testable', tr.reason));
  tiles.append(tile('Lowest to highest group', pct(first.p) + '% → ' + pct(last.p) + '%', first.label + ' → ' + last.label));
  const top = res.pairs.reduce((a, d) => (!a || Math.abs(d.rd) > Math.abs(a.rd) ? d : a), null);
  if (top) tiles.append(tile('Largest difference from ' + lc(ref.label), C.fmtSigned(100 * top.rd, 1) + ' pp', top.label + ' · Fisher P ' + C.fmtPeq(top.p) + ', Holm ' + C.fmtP(top.pHolm), top.pHolm < 0.05 ? 'Below 0.05 after Holm' : 'Not below 0.05', top.pHolm < 0.05));
  else tiles.append(tile('Pairwise comparisons', 'No reference', 'Set one column to Reference in the grid to compare each dose against it.'));

  if (tr.computable) {
    const pA = pickP(tr), pE = pickP(tr.exact), dirWord = tr.direction === 'up' ? 'rose' : tr.direction === 'down' ? 'fell' : 'did not change';
    const agrees = tool.alt === 'two' || (tool.alt === 'inc' && tr.z > 0) || (tool.alt === 'dec' && tr.z < 0);
    if (pA < 0.05 && agrees) parts.push('There is a dose-related ' + (tr.direction === 'down' ? 'decrease' : 'increase') + ' in ' + lc(ev) + ' (' + sided() + ' P ' + C.fmtPeq(pA) + '; exact P ' + C.fmtPeq(pE) + ').');
    else parts.push(cap(ev) + ' ' + dirWord + ' with dose in this sample, but the ' + sided() + ' trend test does not reach the 0.05 level (P ' + C.fmtPeq(pA) + '; exact P ' + C.fmtPeq(pE) + ').');
    if ((pA < 0.05) !== (pE < 0.05)) parts.push('The asymptotic and exact P values fall on opposite sides of 0.05; with groups this small the exact value is the safer one to report.');
    else if (tr.smallSample) parts.push('The groups are small, so the exact P value is the safer one to report.');
    if (tr.departure && tr.departure.p < 0.05) parts.push('The group percentages depart from a straight line (P ' + C.fmtPeq(tr.departure.p) + '), so a linear trend describes them poorly.');
  } else parts.push(tr.reason);
  if (res.pairs.length) {
    const hits = res.pairs.filter((d) => d.pHolm < 0.05);
    if (hits.length) parts.push(listJoin(hits.map((d) => d.label)) + (hits.length === 1 ? ' differs' : ' differ') + ' from ' + lc(ref.label) + ' after Holm adjustment.');
    else parts.push('No single dose group differs from ' + lc(ref.label) + ' (smallest Holm-adjusted P ' + C.fmtPeq(Math.min(...res.pairs.map((d) => d.pHolm))) + ').');
  }
  $('verdict').textContent = parts.join(' ');
  const notes = res.warnings.slice();
  if (tool.alt !== 'two') notes.push('A one-sided P value is appropriate only if the direction was fixed before the data were seen.');
  if (notes.length) warn.append(el('ul', null, ...notes.map((t) => el('li', { text: t }))));

  const row = (cells, tag = 'td') => el('tr', null, ...cells.map((c) => el(tag, { text: c })));
  $('tbl-groups').replaceChildren(el('thead', null, row(['Group', 'Score', 'Events / n', '%', '95% CI (Wilson)'], 'th')),
    el('tbody', null, ...res.groups.map((g) => row([g.label, g.inTrend ? C.fmtScore(g.used) : 'not in trend', g.r + ' / ' + g.n, pct(g.p), pct(g.lo) + ' to ' + pct(g.hi)]))));
  const tp = $('tbl-pairs'), note = $('pairs-note');
  clear(tp);
  $('pairs-title').textContent = ref ? 'Each dose against ' + lc(ref.label) : 'Each dose against the reference';
  if (res.pairs.length) {
    tp.append(el('thead', null, row(['Comparison', 'Difference, pp', '95% CI (Newcombe)', 'Fisher P', 'Holm P'], 'th')),
      el('tbody', null, ...res.pairs.map((d) => row([d.label + ' vs ' + lc(ref.label), C.fmtSigned(100 * d.rd, 1), C.fmtNum(100 * d.lo, 1) + ' to ' + C.fmtNum(100 * d.hi, 1), C.fmtP(d.p), C.fmtP(d.pHolm)]))));
    note.textContent = 'Fisher’s exact test is used because each group is a different set of patients. McNemar’s test is for paired data, where the same patients are measured twice, and cannot be worked out from a table of separate groups.';
  } else note.textContent = 'Set one column to Reference in the grid to compare each dose group against it.';
  if (tr.computable && tr.departure) note.textContent += ' Departure from a linear trend: χ² = ' + C.fmtNum(tr.departure.chi2, 2) + ', df = ' + tr.departure.df + ', P ' + C.fmtPeq(tr.departure.p) + '.';
  $('txt-methods').textContent = methodsText(res);
  $('txt-results').textContent = resultsText(res);
}
function scoreSentence(res) {
  const tr = res.trend;
  return res.scoreType === 'rank' ? 'equally spaced scores (1 to ' + tr.scores.length + ') for the ' + listJoin(tr.labels.map(lc)) + ' groups' : 'scores of ' + listJoin(tr.scores.map(C.fmtScore)) + ' for the ' + listJoin(tr.labels.map(lc)) + ' groups';
}
function methodsText(res) {
  const tr = res.trend, ev = lc(res.event), s = [];
  if (tr.computable) {
    const side = tool.alt === 'two' ? 'two-sided' : 'one-sided, for ' + (tool.alt === 'inc' ? 'an increase' : 'a decrease') + ' with dose';
    s.push('A dose-related trend in the proportion of patients with ' + ev + ' was tested with the Cochran–Armitage test for trend (' + side + '), using ' + scoreSentence(res) + '.');
    s.push(tr.exact.method === 'mc' ? 'A permutation P value based on ' + tr.exact.B.toLocaleString('en-US') + ' Monte Carlo samples is also given.' : 'Because the groups are small, an exact conditional (permutation) P value is also given.');
  }
  if (res.pairs.length) {
    s.push('Each dose group was compared with ' + lc(res.ref.label) + ' by two-sided Fisher’s exact test' + (res.pairs.length > 1 ? ', and P values were adjusted for the ' + res.pairs.length + ' comparisons by the Holm method.' : '.'));
    s.push('Proportions are reported with Wilson 95% confidence intervals and differences in proportions with Newcombe hybrid-score 95% confidence intervals.');
  } else s.push('Proportions are reported with Wilson 95% confidence intervals.');
  return s.join(' ');
}
function resultsText(res) {
  const tr = res.trend, s = [];
  s.push(cap(res.event) + ' was reported by ' + listJoin(res.groups.map((g) => g.r + '/' + g.n + ' (' + pct(g.p) + '%) in the ' + lc(g.label) + ' group')) + '.');
  if (tr.computable) s.push('The Cochran–Armitage test for trend gave z = ' + C.fmtNum(tr.z, 2) + ', ' + sided() + ' P ' + C.fmtPeq(pickP(tr)) + ' (' + (tr.exact.method === 'mc' ? 'permutation' : 'exact') + ' P ' + C.fmtPeq(pickP(tr.exact)) + ').');
  const top = res.pairs.reduce((a, d) => (!a || Math.abs(d.rd) > Math.abs(a.rd) ? d : a), null);
  if (top) s.push('The difference from ' + lc(res.ref.label) + ' was largest for ' + top.label + ' (' + C.fmtSigned(100 * top.rd, 1) + ' percentage points, 95% CI ' + C.fmtNum(100 * top.lo, 1) + ' to ' + C.fmtNum(100 * top.hi, 1) + '; Fisher’s exact P ' + C.fmtPeq(top.p) + (res.pairs.length > 1 ? ', Holm-adjusted P ' + C.fmtPeq(top.pHolm) : '') + ').');
  return s.join(' ');
}

// ----- screenshot reading (asks Claude, with the viewer's consent) -----
let sampler = null, shotCtl = null, thumbUrl = null;
const PROMPT = 'The image shows a table from a clinical study: adverse events (rows) by treatment or dose group (columns). Transcribe it exactly.\n' +
  'Reply with only JSON in this shape:\n{"groups":[{"label":"Placebo","n":13},{"label":"400 mg","n":11}],"rows":[{"label":"Headache","counts":[4,3]}]}\nRules:\n' +
  '- groups: one entry per data column, left to right, including any Total column. label is the column name without the group size. n is the group size from the header, such as (n = 13), or null if it is not shown.\n' +
  '- rows: one entry per event row. counts has one number per column in the same order as groups: the number of patients, not the percentage. Use null for a cell that is empty or that you cannot read with confidence.\n' +
  '- When rows sit under a sub-heading such as "Increases in", put the sub-heading in front of each of those labels, for example "Increased alanine aminotransferase", and do not add the sub-heading as a row.\n' +
  '- Do not guess or fill in values. If the image has no such table, reply {"error":"no table"}.';
const shotHint = (t) => { $('shot-hint').textContent = t; };
function setShot(on) { $('drop').classList.toggle('off', !on); $('file-in').disabled = !on; if (on) shotHint('Claude reads the numbers from the image. You then check them in the grid.'); }
const busy = (on) => { $('shot-busy').hidden = !on; };
function readImage(file) {
  if (!sampler) { setMsg('Screenshot reading is not available in this view. Paste the table as text instead.', true); return; }
  if (!file || !/^image\//.test(file.type)) { setMsg('That file is not an image. Use a PNG or JPEG screenshot of the table.', true); return; }
  if (shotCtl) shotCtl.abort();
  const ctl = (shotCtl = new AbortController());
  if (thumbUrl) URL.revokeObjectURL(thumbUrl);
  thumbUrl = URL.createObjectURL(file);
  $('shot-thumb').src = thumbUrl; $('shot-thumb').hidden = false;
  busy(true);
  sampler.json(PROMPT, { images: [file], signal: ctl.signal }).then((data) => {
    busy(false);
    const parsed = C.fromExtraction(data);
    if (parsed.error) { setMsg(parsed.error + ' Try a sharper image, or paste the table as text.', true); return; }
    const blanks = parsed.rows.reduce((a, r) => a + r.counts.filter((v) => v === null).length, 0);
    if (blanks) parsed.notes.push(blanks + (blanks === 1 ? ' cell was' : ' cells were') + ' left blank because the image was unclear there.');
    loadParsed(parsed, 'Table read from the screenshot. Check every number against the image before you use the results.', null, false);
  }, (e) => {
    busy(false);
    const code = e && e.code;
    if (code === 'cancelled') return;
    if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'images_unavailable'].includes(code)) {
      sampler = null; setShot(false); shotHint('Screenshot reading is not available in this view. Paste the table as text instead.');
      setMsg('Claude was not allowed to read the image here. Paste the table as text instead.', true);
    } else if (code === 'rate_limited') setMsg('Too many requests just now. Wait a minute, then try the screenshot again.', true);
    else if (code === 'image_rejected') setMsg('That image could not be used (wrong type or too large). Try a PNG or JPEG screenshot.', true);
    else if (code === 'session_expired') setMsg('Your Claude session has expired. Sign in again, then retry the screenshot.', true);
    else setMsg('The image could not be read into a table. Try again, or paste the table as text.', true);
  });
}

// ----- wiring -----
$('btn-parse').onclick = parsePasted;
$('btn-example').onclick = loadExample;
$('btn-add-row').onclick = () => { tool.rows.push({ label: 'New event', counts: tool.groups.map(() => null) }); tool.sel = tool.rows.length - 1; renderGrid(); recompute(); const n = $('ev-name-' + tool.sel); if (n) { n.focus(); n.select(); } };
$('btn-add-col').onclick = () => { tool.groups.push({ label: 'New group', n: null, role: 'dose', score: null }); tool.rows.forEach((r) => r.counts.push(null)); renderGrid(); recompute(); const n = $('g-name-' + (tool.groups.length - 1)); if (n) { n.focus(); n.select(); } };
$('sel-event').onchange = () => selectRow(parseInt($('sel-event').value, 10) || 0);
$('sel-scores').onchange = () => { tool.scoreType = $('sel-scores').value; recompute(); };
$('sel-alt').onchange = () => { tool.alt = $('sel-alt').value; recompute(); };
$('chk-ref').onchange = () => { tool.includeRef = $('chk-ref').checked; recompute(); };
function copyText(text, done) {
  const fail = () => done(false);
  try { navigator.clipboard.writeText(text).then(() => done(true), fail); } catch { fail(); }
}
document.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copyText($(b.dataset.copy).textContent, (ok) => { const old = b.textContent; b.textContent = ok ? 'Copied' : 'Copy blocked'; setTimeout(() => { b.textContent = old; }, 1500); })));
{
  const drop = $('drop');
  $('file-in').onchange = function () { if (this.files && this.files[0]) readImage(this.files[0]); this.value = ''; };
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); if (sampler) drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) readImage(f); });
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData ? [...e.clipboardData.items] : [], img = items.find((it) => it.kind === 'file' && /^image\//.test(it.type));
    const tag = e.target && e.target.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (img && !typing) { e.preventDefault(); readImage(img.getAsFile()); return; }
    if (typing) return;
    const txt = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (txt && txt.trim() && C.parseTable(txt).rows) { e.preventDefault(); $('paste-box').value = txt; parsePasted(); $('analyzer').scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth' }); }
  });
  $('btn-stop').onclick = () => { if (shotCtl) shotCtl.abort(); busy(false); };
  if (inClaude) {
    window.claude.use('sample').then((s) => (s ? s.limits().then((lim) => { if (lim && lim.images) { sampler = s; setShot(true); return true; } return false; }, () => false) : false))
      .then((ok) => { if (!ok) shotHint('Screenshot reading is not available in this view. Paste the table as text instead.'); });
  } else shotHint('Screenshot reading works when this page is open in Claude. Paste the table as text instead.');
}

// ---------- figure studio: results → figure JSON → SVG / PDF / PNG ----------
// The JSON is the source of truth (the sci-figure-gen contract). Options rebuild it from the data;
// edits made in the JSON tab are rendered as they stand until an option or the table changes.
{
  const IMG = '@panel-a-image'; // stands in for the image data in the JSON tab, to keep it readable
  const proof = $('proof'), jsonBox = $('json-box'), styleBox = $('style-box');
  const exportMsg = (t) => { $('export-msg').textContent = t || ''; };
  const opts = () => {
    const f = tool.fig, r = tool.result, ref = r && r.ref;
    return { journal: f.journal, column: f.column, panelA: f.panelA, style: f.style, palette: f.palette, pA: f.pA, pB: f.pB, alt: tool.alt, border: f.border,
      xTitle: f.xTitle, yTitle: f.yTitle, image: tool.image, styleId: tool.isStudy ? lc(STUDY.drug) : 'dose_trend',
      study: { population: f.population, design: f.design || (ref ? 'Randomized' : 'Allocated'), duration: f.duration, outcome: tool.isStudy ? STUDY.outcome : 'Events recorded', groupLabel: tool.isStudy ? STUDY.spanner : '' } };
  };
  const forBox = (fig) => JSON.stringify(fig, (k, v) => (k === 'image_href' ? IMG : v), 1);
  function fillColumns() {
    const j = Fig.JOURNALS[tool.fig.journal], names = { double: 'Double column', onehalf: '1.5 column', single: 'Single column' };
    $('fig-column').replaceChildren(...['double', 'onehalf', 'single'].map((c) => el('option', { value: c, text: names[c] + ', ' + j.widths[c] + ' mm' })));
    $('fig-column').value = tool.fig.column;
  }
  function show(built, note) {
    tool.built = built;
    const { figure, style } = built;
    proof.innerHTML = Fig.renderSVG(figure, style, { tooltips: true }); // text inside is escaped by the renderer
    const node = proof.querySelector('svg'), scale = Math.min(1.75, Math.max(1, 1000 / (figure.canvas.width * 96 / 300)));
    node.setAttribute('width', Math.round(figure.canvas.width * 96 / 300 * scale));
    node.setAttribute('height', Math.round(figure.canvas.height * 96 / 300 * scale));
    node.setAttribute('role', 'img'); node.setAttribute('aria-label', figure.figure_meta.title + '. Details are in the figure legend below.');
    styleBox.value = JSON.stringify(style, null, 1);
    const jt = style.journal_template, ty = style.typography, problems = Fig.validate(figure, style);
    const sizes = (figure.annotations || []).filter((a) => !/^panel_label_/.test(a.id)).map((a) => a.font_size / Fig.PT);
    const span = sizes.length ? Math.min(...sizes).toFixed(0) + (Math.max(...sizes) - Math.min(...sizes) > 0.4 ? '–' + Math.max(...sizes).toFixed(0) : '') : '';
    const img = (figure.elements || []).find((e) => e.type === 'illustration');
    if (!PDF_FONTS) $('fig-pdf-fonts').closest('.row').hidden = true;
    const dpi = img && tool.image ? Math.round(tool.image.width / (img.width / 300)) : 0;
    const minDpi = (Fig.JOURNALS[tool.fig.journal] || {}).min_image_dpi || 300;
    const good = [figure.canvas.width_mm + ' × ' + figure.canvas.height_mm + ' mm (' + jt.name + ' allows ' + jt.max_height_mm + ' mm tall)', 'Text ' + span + ' pt, panel letters ' + ty.panel_pt + ' pt bold', 'Lines ' + style.stroke.default_pt + ' pt',
      'Text stays editable in SVG and PDF', 'RGB colour'];
    const warn = problems.slice();
    if (img && dpi < minDpi) warn.push('The panel a image is ' + dpi + ' dpi at this size and ' + jt.name + ' asks for ' + minDpi + '. Export it from BioRender at that resolution or more and add it with the button above before submitting.');
    $('checks').replaceChildren(...good.map((t) => el('li', { text: t })), ...warn.map((t) => el('li', { class: 'warn', text: t })));
    $('txt-caption').textContent = (tool.fig.journal === 'nature' ? 'Fig. 1 | ' : 'Figure 1. ') + figure.figure_meta.caption + (img && tool.image && /BioRender/.test(tool.image.credit || '') ? ' Panel a created in BioRender.' : '');
    $('fig-size').textContent = 'The proof is enlarged; hover a bar or point to read its values. ' + (note || '');
    $('fig-yt').placeholder = 'Patients with ' + lc(tool.result.event) + ' (%)';
    $('image-row').hidden = tool.fig.panelA !== 'image';
    $('image-note').textContent = tool.image ? (tool.image.credit || '') : 'No image yet: panel a falls back to the vector schematic until you add one.';
  }
  function render() {
    exportMsg('');
    if (!tool.result || !tool.result.ok) {
      tool.built = null;
      proof.replaceChildren(el('p', { class: 'empty', text: 'The figure appears here once the table above is complete.' }));
      jsonBox.value = ''; styleBox.value = ''; clear($('checks')); $('txt-caption').textContent = ''; $('fig-size').textContent = '';
      return;
    }
    const built = Fig.buildFigure(tool.result, opts());
    tool.custom = false;
    jsonBox.value = forBox(built.figure); $('json-msg').textContent = '';
    show(built);
  }
  studio = { render };

  // ----- controls -----
  const bind = (id, key, map, after) => { $(id).onchange = () => { tool.fig[key] = map ? map($(id).value) : $(id).value; after && after(); render(); }; };
  bind('fig-journal', 'journal', null, fillColumns); bind('fig-column', 'column'); bind('fig-panel-a', 'panelA'); bind('fig-style', 'style');
  bind('fig-palette', 'palette'); bind('fig-pa', 'pA'); bind('fig-pb', 'pB');
  $('fig-border').onchange = () => { tool.fig.border = $('fig-border').checked; render(); };
  [['fig-xt', 'xTitle', 'Dose group'], ['fig-yt', 'yTitle', ''], ['fig-pop', 'population', 'Patients'], ['fig-design', 'design', 'Randomized'], ['fig-dur', 'duration', 'for example, 10 days of dosing']].forEach(([id, key, ph]) => {
    $(id).placeholder = ph; $(id).oninput = () => { tool.fig[key] = $(id).value.trim(); render(); };
  });
  $('image-in').onchange = function () {
    const file = this.files && this.files[0]; this.value = '';
    if (!file || !/^image\/(png|jpeg)$/.test(file.type)) { exportMsg('Use a PNG or JPEG image for panel a.'); return; }
    const fr = new FileReader();
    fr.onload = () => { const im = new Image(); im.onload = () => { tool.image = { href: fr.result, width: im.naturalWidth, height: im.naturalHeight, credit: 'Your image, ' + im.naturalWidth + ' × ' + im.naturalHeight + ' px.' }; tool.fig.panelA = 'image'; $('fig-panel-a').value = 'image'; render(); }; im.src = fr.result; };
    fr.readAsDataURL(file);
  };
  const tabs = [['tab-proof', 'pane-proof'], ['tab-json', 'pane-json'], ['tab-style', 'pane-style']];
  tabs.forEach(([t, p]) => ($(t).onclick = () => tabs.forEach(([t2, p2]) => { $(t2).setAttribute('aria-selected', String(t2 === t)); $(p2).hidden = p2 !== p; })));
  $('btn-json-apply').onclick = () => {
    let fig;
    try { fig = JSON.parse(jsonBox.value); } catch (e) { $('json-msg').textContent = 'That is not valid JSON: ' + e.message; return; }
    if (!fig || !fig.canvas || !Array.isArray(fig.elements)) { $('json-msg').textContent = 'The JSON needs a canvas and an elements list.'; return; }
    (fig.elements || []).forEach((e) => { if (e.image_href === IMG) e.image_href = tool.image ? tool.image.href : ''; });
    fig.canvas.height_mm = Math.round(fig.canvas.height / Fig.MM * 10) / 10;
    tool.custom = true;
    show({ figure: fig, style: tool.built ? tool.built.style : Fig.makeStyle(opts()) }, 'Showing your edited JSON.');
    $('json-msg').textContent = 'Applied. The proof and every export now come from this JSON.';
    $('tab-proof').click();
  };
  $('btn-json-reset').onclick = render;

  // ----- exports -----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (bytes) => { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function withDpi(buf, dpi) { // write the resolution into the PNG (pHYs chunk) so layout software reads the right size
    const src = new Uint8Array(buf), chunk = new Uint8Array(21), dv = new DataView(chunk.buffer), ppm = Math.round(dpi / 0.0254);
    dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1; dv.setUint32(17, crc32(chunk.subarray(4, 17)));
    const out = new Uint8Array(src.length + 21);
    out.set(src.subarray(0, 33)); out.set(chunk, 33); out.set(src.subarray(33), 54);
    return new Blob([out], { type: 'image/png' });
  }
  const svgText = () => '<?xml version="1.0" encoding="UTF-8"?>\n' + Fig.renderSVG(tool.built.figure, tool.built.style);
  function raster(dpi) {
    return new Promise((resolve, reject) => {
      const cv0 = tool.built.figure.canvas, wPx = Math.round(cv0.width * dpi / 300), hPx = Math.round(cv0.height * dpi / 300);
      const svg = svgText().replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="' + wPx + '" height="' + hPx + '"');
      const img = new Image();
      img.onload = () => {
        try {
          const cv = el('canvas'); cv.width = wPx; cv.height = hPx;
          const g = cv.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, wPx, hPx); g.drawImage(img, 0, 0, wPx, hPx);
          cv.toBlob((b) => (b ? b.arrayBuffer().then((buf) => resolve(withDpi(buf, dpi)), reject) : reject(new Error('size'))), 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('render'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  // PDF embeds JPEG data directly; a PNG panel is redrawn as JPEG first.
  function figureForPdf() {
    const fig = tool.built.figure, pic = (fig.elements || []).find((e) => e.type === 'illustration' && e.image_href && !/^data:image\/jpe?g/.test(e.image_href));
    if (!pic) return Promise.resolve(fig);
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => { const cv = el('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0);
        const copy = JSON.parse(JSON.stringify(fig)); copy.elements.find((e) => e.id === pic.id).image_href = cv.toDataURL('image/jpeg', 0.92); resolve(copy); };
      im.onerror = () => resolve(fig);
      im.src = pic.image_href;
    });
  }
  const stem = () => { const ev = (tool.result && tool.result.event ? tool.result.event : 'figure').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); return 'fig1_' + (ev || 'figure') + '_dose_trend'; };
  function save(filename, data, mime) {
    if (!inClaude) { // opened as a plain file: an ordinary browser download works
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mime }));
      const a = el('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      exportMsg('Saved ' + filename + '.');
      return Promise.resolve();
    }
    return window.claude.use('downloads').then((d) => {
      if (!d) { exportMsg('Downloads are not available in this view. Use Copy SVG code instead.'); return; }
      return d.save({ filename, data }).then(() => exportMsg('Saved ' + filename + '.'), (e) => {
        const code = e && e.code;
        exportMsg(code === 'declined' ? 'Download cancelled.' : code === 'rate_limited' ? 'A download prompt is already open. Answer it, then try again.' : 'The file could not be saved here. Use Copy SVG code instead.');
      });
    });
  }
  const ready = () => { if (!tool.built) { exportMsg('Complete the table first.'); return false; } exportMsg(''); return true; };
  $('btn-svg').onclick = () => { if (ready()) save(stem() + '.svg', svgText(), 'image/svg+xml'); };
  // Preflight at a journal looks for embedded TrueType fonts. The other choice suits anyone who will reopen the PDF
  // in Illustrator on a machine that has Helvetica and would rather not be asked about a missing font.
  const pdfFonts = () => ($('fig-pdf-fonts').value === 'embed' && PDF_FONTS ? getPdfFonts().then((f) => (f ? { fonts: f } : undefined)) : Promise.resolve(undefined));
  const fontsNote = () => { $('pdf-fonts-note').textContent = $('fig-pdf-fonts').value === 'embed' ? 'Passes a journal’s font check. Arimo is an open face drawn to Arial’s measurements.' : 'Smaller file. The reader’s own Helvetica or Arial is used, and a preflight check may flag the fonts as not embedded.'; };
  $('fig-pdf-fonts').onchange = fontsNote; fontsNote();
  $('btn-pdf').onclick = () => { if (ready()) Promise.all([figureForPdf(), pdfFonts()]).then(([fig, fonts]) => save(stem() + '.pdf', new Blob([Fig.renderPDF(fig, tool.built.style, fonts)], { type: 'application/pdf' }), 'application/pdf')); };
  $('btn-png').onclick = () => {
    if (!ready()) return;
    const dpi = Number($('fig-dpi').value);
    exportMsg('Rendering at ' + dpi + ' dpi…');
    const low = dpi < ((Fig.JOURNALS[tool.fig.journal] || {}).min_image_dpi || 300) ? ' ' + Fig.JOURNALS[tool.fig.journal].name + ' asks for at least ' + Fig.JOURNALS[tool.fig.journal].min_image_dpi + ' dpi.' : '';
    raster(dpi).then((blob) => save(stem() + '_' + dpi + 'dpi.png', blob, 'image/png').then(() => { if (low) exportMsg($('export-msg').textContent + low); }), () => exportMsg('This browser could not render the image at ' + dpi + ' dpi. Choose a lower resolution, or use the SVG or PDF.'));
  };
  $('btn-json').onclick = () => { if (ready()) save(stem() + '.json', JSON.stringify(Object.assign({}, tool.built.figure, { style: tool.built.style }), null, 1), 'application/json'); };
  $('btn-copy-svg').onclick = () => { if (ready()) copyText(svgText(), (ok) => exportMsg(ok ? 'SVG code copied.' : 'Copying is blocked in this view. Use the SVG button instead.')); };
  if (inClaude) window.claude.use('downloads').then((d) => { if (!d) { ['btn-svg', 'btn-pdf', 'btn-png', 'btn-json', 'fig-dpi'].forEach((id) => { $(id).hidden = true; }); $('fig-pdf-fonts').closest('.row').hidden = true; exportMsg('Downloads are not available in this view. Use Copy SVG code.'); } });

  fillColumns();
  window.__tool = tool; // read by the page test
}
loadExample();
setMsg('');

})();
