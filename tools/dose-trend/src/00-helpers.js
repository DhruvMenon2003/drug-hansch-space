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
