// Layer 0. Shared singletons and helpers: the event bus, the app state, the media-query handles, the tour presets and the
// small pure helpers. Imports nothing, touches no DOM node at import time, so any module (and node tests) can load it.

/** Half-width of the plot cube, scene units. */
export const S = 10;

const mq = q => (typeof matchMedia === 'function' ? matchMedia(q) : { matches: false, addEventListener() {}, removeEventListener() {} });
export const reduceMotion = mq('(prefers-reduced-motion: reduce)');
/** The stacked layout (stage on top, text below): phones in portrait. Chosen by shape, not width alone: a landscape phone and a tablet get two columns. */
export const narrow = mq('(max-width: 700px) and (orientation: portrait)');
export const darkQuery = mq('(prefers-color-scheme: dark)');

// ---------------------------------------------------------------- event bus
// Core code never calls GL code directly: it emits, the GL layer subscribes. Handlers run in `order` (stable within an
// order) so the original sequence of side effects survives the split: GL first, then the HUD, then the table.
export const ORDER = { GL: -10, UI: 0, LATE: 10 };
const handlers = new Map();
/**
 * Tiny pub/sub. `emit` isolates handler exceptions (logged with console.error) so one broken subscriber cannot freeze the UI.
 * Events: view:patched {patch}, layout {instant}, recolor, theme, selection {index, cid}, cmd:camera {preset|pos, instant}.
 */
export const bus = {
  /** @param {string} type @param {(detail?: any) => void} fn @param {number} [order] @returns {() => void} unsubscribe */
  on(type, fn, order = 0) {
    const list = handlers.get(type) || [];
    list.push({ fn, order });
    list.sort((a, b) => a.order - b.order);
    handlers.set(type, list);
    return () => bus.off(type, fn);
  },
  off(type, fn) {
    const list = handlers.get(type);
    if (list) handlers.set(type, list.filter(h => h.fn !== fn));
  },
  emit(type, detail) {
    for (const h of handlers.get(type) || []) {
      try { h.fn(detail); } catch (err) { console.error(`bus handler for "${type}" failed`, err); }
    }
  },
};

// ---------------------------------------------------------------- state
/** The one mutable application state. Mutate it, never reassign it. */
export const app = {
  drugs: [], byCid: new Map(), meta: null, hansch: null, groups: new Map(), mols: null, molsPromise: null,
  view: { x: 'pc1', y: 'pc2', z: 'pc3', color: 'atc', atc: [null, null, null], l1: '', l2: '', l3: '', route: '', small: false, group: null, veber: false },
  scales: null, visible: [], selected: -1, hover: -1, tokens: {}, step: null, seriesId: null,
  qsarByCid: new Map(), qsarHighlight: false,
  scafFocus: null,                        // Set of CIDs: the scaffold family the cluster panel is highlighting (js/clusters.js)
  tiMeta: null, tiReady: false,           // the ranked therapeutic-index file (js/ti-live.js): its meta, and whether d.ti is populated
  tiKeep: null, tiRuleText: null,         // the decision workbench (js/ti-decide.js): the cids its rules keep, and the rules in words
};
/** Float32 buffers [x, y, z, scale] per drug: tween start, tween end, current. Allocated by initView(). */
export const anim = { from: null, to: null, t: 1, tween: null };

// ---------------------------------------------------------------- the guided tour (data only)
export const STEPS = {
  space: { view: { x: 'pc1', y: 'pc2', z: 'pc3', color: 'atc' }, cam: [24, 14, 27] },
  structure: { view: { x: 'ts1', y: 'none', z: 'ts2', color: 'atc' }, cam: [0, 37, 3] },
  logp: { view: { x: 'logp', y: 'none', z: 'jitter', color: 'single', small: true }, cam: [0, 22, 26] },
  mr: { view: { x: 'logp', y: 'none', z: 'mr', color: 'single', small: true }, cam: [0, 37, 3] },
  tpsa: { view: { x: 'logp', y: 'tpsa', z: 'mr', color: 'oral', veber: true, small: true }, cam: [27, 12, 24] },
  activity: { view: { x: 'logp', y: 'act', z: 'mr', color: 'act', small: true }, cam: [27, 11, 24] },
  series: { view: { x: 'logp', y: 'act', z: 'mr', color: 'single', group: 'SERIES', small: true }, cam: [25, 12, 26] },
  all: { view: { x: 'logp', y: 'act', z: 'mr', color: 'single', group: 'ALL', small: true }, cam: [27, 12, 23] },
};

// ---------------------------------------------------------------- helpers
/** querySelector; `document` is resolved at call time, never at import time. */
export const $ = (s, el = document) => el.querySelector(s);
export const fin = Number.isFinite;
export const neg = s => String(s).replace(/^-/, '−');
export const fx = (v, k = 2) => (v == null || !fin(v) ? '–' : neg(Number(v).toFixed(k)));
export const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '');
/** HTML-escape for text that goes through innerHTML. */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const median = a => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
export const quant = (a, q) => { const b = [...a].sort((x, y) => x - y), i = (b.length - 1) * q, lo = Math.floor(i); return b[lo] + (b[Math.ceil(i)] - b[lo]) * (i - lo); };
export const pearson = (xs, ys) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
};
export function niceStep(range, count) {
  const raw = range / Math.max(1, count - 1), mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
}
export const sig = c => (Math.abs(c) >= 10 ? c.toFixed(1) : Math.abs(c) >= 0.1 ? c.toFixed(3) : c.toPrecision(2));
export function fmtConc(p) {
  const nM = 10 ** (9 - p);
  return nM >= 1000 ? `${+(nM / 1000).toPrecision(2)} µM` : nM >= 1 ? `${+nM.toPrecision(2)} nM` : `${+(nM * 1000).toPrecision(2)} pM`;
}
/** Dark theme in effect: the explicit data-theme attribute wins over the OS preference. */
export const isDark = () => {
  const th = document.documentElement.getAttribute('data-theme');
  return th ? th === 'dark' : darkQuery.matches;
};

const json = new Map();                 // url -> Promise of the parsed file, one request per file per page

/** Fetch and parse `url` once; the same promise is handed to every later caller. Rejects like fetch does. */
export function getSide(url) {
  if (!json.has(url)) json.set(url, fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${url}: HTTP ${r.status}`)))));
  return json.get(url);
}
