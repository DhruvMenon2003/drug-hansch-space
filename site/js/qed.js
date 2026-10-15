// Layer 3. The QED distributions panel: the composite QED and its eight terms over the drugs in view, each as a small
// histogram with the term's own desirability read off the same drugs. Loaded on first open (js/extras.js), so neither this
// module nor data/props.json is in the first load. Clicking a bar narrows the view through the ordinary filter path
// (app.view.qbin -> passes() -> setView), so the 3D scatter, the HUD and the table all follow it as they do any filter.
import { app, bus, ORDER, $, cap, esc, fx, fin, niceStep, quant } from './kernel.js';
import { announce } from './announce.js';
import { AX, passes } from './model.js';
import { setView } from './view.js';
import { getSide } from './extras.js';

const BINS = 12;
/** The composite and the eight QED terms. `col` reads a column of data/props.json, `raw` a descriptor the app already has. */
const TERMS = [
  { key: 'qed', col: 'qed', label: 'QED', unit: '', dec: 2 },
  { key: 'MW', raw: d => d.d.mw, des: 'dMW', label: AX.mw.label, unit: AX.mw.unit, dec: 0 },
  { key: 'ALOGP', raw: d => d.d.logp, des: 'dALOGP', label: AX.logp.label, unit: '', dec: 1 },
  { key: 'HBA', col: 'hbaq', des: 'dHBA', dec: 0 },
  { key: 'HBD', raw: d => d.d.hbd, des: 'dHBD', label: AX.hbd.label, unit: '', dec: 0 },
  { key: 'PSA', raw: d => d.d.tpsa, des: 'dPSA', label: AX.tpsa.label, unit: AX.tpsa.unit, dec: 0 },
  { key: 'ROTB', col: 'rotbs', des: 'dROTB', dec: 0 },
  { key: 'AROM', col: 'aromq', des: 'dAROM', dec: 0 },
  { key: 'ALERTS', col: 'alerts', des: 'dALERTS', dec: 0 },
];

let props = null, defs = new Map(), cols = new Map(), active = null, started = false;

const colOf = (name, cid) => cols.get(name)?.get(cid);
const valueOf = (t, d) => (t.col ? colOf(t.col, d.cid) : t.raw(d));
const labelOf = t => t.label ?? defs.get(t.col)?.label ?? t.key;
const longOf = t => defs.get(t.des)?.long || defs.get(t.col)?.long || labelOf(t);

/** The drugs the histograms are drawn from: the current view, less this panel's own bar highlight and plus its ATC narrowing. */
function base() {
  const keep = app.view.qbin;
  app.view.qbin = null;
  try {
    const code = $('#qed-atc')?.value || '';
    return app.drugs.filter(d => passes(d) && (!code || d.atc.some(a => a.code.startsWith(code))));
  } finally { app.view.qbin = keep; }
}

/**
 * Bin edges over the values present: round steps, so a bar covers a range a reader can name. A handful of peptides are
 * hundreds of daltons past everything else, and drawing to the true maximum would squash every distribution into one bar,
 * so the axis runs between the 1st and the 95th percentile and the two end bars carry everything outside it.
 */
function binsOf(vals, dec) {
  const min = Math.min(...vals), max = Math.max(...vals);
  if (!fin(min) || !fin(max)) return null;
  let lo = vals.length >= 40 ? quant(vals, 0.01) : min, hi = vals.length >= 40 ? quant(vals, 0.95) : max;
  if (!(hi > lo)) { lo = min; hi = max; }
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const step = niceStep(hi - lo, BINS);
  lo = Math.floor(lo / step + 1e-9) * step;
  hi = Math.ceil(hi / step - 1e-9) * step;
  const edges = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) edges.push(+v.toFixed(10));
  return { edges, step, dec, clipped: lo > min || hi < max };
}

/** One histogram as inline SVG: bars of count, the term's mean desirability over the same bars, and the bar that is active. */
function chart(t, list) {
  const pairs = list.map(d => [valueOf(t, d), t.des ? colOf(t.des, d.cid) : null]).filter(p => fin(p[0]));
  const b = binsOf(pairs.map(p => p[0]), t.dec);
  const unit = t.unit ? ` (${t.unit})` : '';
  if (!b || !pairs.length) return `<figure class="qed-cell"><figcaption>${esc(labelOf(t))}${esc(unit)}</figcaption><p class="small">No values here.</p></figure>`;
  const n = b.edges.length - 1, count = new Array(n).fill(0), dsum = new Array(n).fill(0), dn = new Array(n).fill(0);
  const slot = v => Math.min(n - 1, Math.max(0, Math.floor((v - b.edges[0]) / b.step)));
  for (const [v, des] of pairs) { const k = slot(v); count[k]++; if (fin(des)) { dsum[k] += des; dn[k]++; } }
  const top = Math.max(...count) || 1;
  const W = 170, H = 112, L = 3, R = 3, T = 16, B = 20, pw = (W - L - R) / n, ph = H - T - B;
  const bars = count.map((c, k) => {
    const h = (c / top) * ph, lo = b.edges[k], hi = b.edges[k + 1];
    const on = active && active.key === t.key && active.k === k;
    const range = k === 0 && b.clipped ? `up to ${fx(hi, b.dec)}` : k === n - 1 && b.clipped ? `${fx(lo, b.dec)} and above` : `${fx(lo, b.dec)} to ${fx(hi, b.dec)}`;
    return `<rect class="qed-bar" data-k="${k}" data-lo="${lo}" data-hi="${hi}" data-n="${c}" data-range="${esc(range)}" data-open="${k === 0 && b.clipped ? 'lo' : k === n - 1 ? 'hi' : ''}" aria-current="${!!on}" x="${(L + k * pw).toFixed(2)}" y="${(T + ph - h).toFixed(2)}" width="${(pw - 0.8).toFixed(2)}" height="${Math.max(h, c ? 0.8 : 0).toFixed(2)}"><title>${esc(range)}${esc(unit)}: ${c} drug${c === 1 ? '' : 's'}</title></rect>`;
  }).join('');
  const pts = dn.map((m, k) => (m ? `${(L + (k + 0.5) * pw).toFixed(2)},${(T + ph - (dsum[k] / m) * ph).toFixed(2)}` : null)).filter(Boolean);
  const curve = t.des && pts.length > 1 ? `<polyline class="qed-des" points="${pts.join(' ')}"></polyline>` : '';
  return `<figure class="qed-cell" data-key="${t.key}">
      <figcaption title="${esc(longOf(t))}">${esc(labelOf(t))}${esc(unit)}</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(labelOf(t))}${esc(unit)}: ${pairs.length} drugs, ${fx(b.edges[0], b.dec)} to ${fx(b.edges[n], b.dec)}${b.clipped ? ', the end bars carrying everything outside that range' : ''}">
        <g class="qed-bars">${bars}</g>${curve}
        <text x="${L}" y="${H - 6}">${fx(b.edges[0], b.dec)}</text>
        <text x="${W - R}" y="${H - 6}" text-anchor="end">${fx(b.edges[n], b.dec)}</text>
        <text x="${W / 2}" y="${T - 5}" text-anchor="middle">n = ${pairs.length}</text>
      </svg>
    </figure>`;
}

/** Redraw the nine charts, the note and the Clear button from the current view. */
export function renderQed() {
  if (!props) return;
  const list = base();
  $('#qed-grid').innerHTML = TERMS.map(t => chart(t, list)).join('');
  $('#qed-clear').disabled = !active;
  note(list.length);
}

/** The line under the charts: what is highlighted, or how to use the panel. */
function note(n) {
  $('#qed-note').textContent = active
    ? `Highlighting ${app.visible.length} drug${app.visible.length === 1 ? '' : 's'} with ${labelOf(active.term)} ${active.range}. Click the bar again to clear.`
    : `${n} drug${n === 1 ? '' : 's'} in view. Click a bar to highlight those drugs in 3D. The red line is the mean desirability of the drugs in each bar; where a few peptides run far past the rest, the axis stops at the 95th percentile and the last bar carries everything above it.`;
}

/** Apply or clear the bar highlight through the ordinary filter path. Bins are half open, the last one closed. */
function pick(t, k, lo, hi, open, range, list) {
  if (active && active.key === t.key && active.k === k) { clearBin(); return; }
  const inside = v => (open === 'lo' ? v < hi : open === 'hi' ? v >= lo : v >= lo && v < hi);
  const cids = new Set();
  for (const d of list) { const v = valueOf(t, d); if (fin(v) && inside(v)) cids.add(d.cid); }
  active = { key: t.key, term: t, k, range };
  setView({ qbin: cids });
  announce(`${cids.size} drugs with ${labelOf(t)} ${range} are highlighted.`);
}

/** Drop the bar highlight and let every other filter stand. */
export function clearBin() {
  if (!active) return;
  active = null;
  setView({ qbin: null });
}

/** Build the panel on its first open: load data/props.json, fill the ATC select, bind the bars. */
export function initQed() {
  if (started) return;
  started = true;
  app.view.qbin = null;                     // runtime only: the default view never carries this key
  const grid = $('#qed-grid');
  grid.innerHTML = '<p class="small" aria-busy="true">Loading QED…</p>';
  getSide('data/props.json').then(p => {
    props = p;
    for (const d of p.defs) defs.set(d.key, d);
    for (const name of Object.keys(p.cols)) {
      const m = new Map();
      p.cids.forEach((cid, i) => m.set(cid, p.cols[name][i]));
      cols.set(name, m);
    }
    $('#qed-cite').textContent = p.meta.citation || '';
    renderQed();
  }).catch(() => { grid.innerHTML = '<p class="small">The QED file (data/props.json) could not be loaded, so this panel is empty.</p>'; });

  const names = app.meta.atc_names, codes = new Set();
  for (const d of app.drugs) for (const a of d.atc) { codes.add(a.code[0]); codes.add(a.code.slice(0, 3)); }
  const sel = $('#qed-atc');
  sel.innerHTML = '<option value="">All groups</option>' + [...codes].sort()
    .map(c => `<option value="${c}">${c === c[0] ? '' : '— '}${c} ${esc(cap(names[c] || ''))}</option>`).join('');
  sel.addEventListener('change', () => { clearBin(); renderQed(); });
  $('#qed-clear').addEventListener('click', () => clearBin());
  grid.addEventListener('click', e => {
    const r = e.target.closest('.qed-bar');
    if (!r || !props) return;
    const t = TERMS.find(x => x.key === r.closest('.qed-cell').dataset.key);
    if (t && +r.dataset.n) pick(t, +r.dataset.k, +r.dataset.lo, +r.dataset.hi, r.dataset.open, r.dataset.range, base());
  });
  grid.addEventListener('pointerover', e => {
    const r = e.target.closest('.qed-bar');
    if (!r) return;
    const t = TERMS.find(x => x.key === r.closest('.qed-cell').dataset.key);
    $('#qed-note').textContent = `${labelOf(t)}${t.unit ? ` (${t.unit})` : ''} ${r.dataset.range}: ${r.dataset.n} drug${+r.dataset.n === 1 ? '' : 's'}.`;
  });
  grid.addEventListener('pointerleave', () => note(base().length));
  // any other filter change drops the bar highlight, so the panel and the scene never disagree
  bus.on('view:patched', ({ patch }) => { if (patch && !('qbin' in patch)) active = null; });
  bus.on('layout', () => { if ($('#qed-details')?.open) renderQed(); }, ORDER.LATE);
  bus.on('theme', () => { if ($('#qed-details')?.open) renderQed(); });
}
