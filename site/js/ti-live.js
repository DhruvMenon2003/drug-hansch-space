// Layer 3. The live therapeutic index: the readout on the stage, and the index as an axis and a colour mode.
//
// The ranked batch itself (ti/rank.py) is a Python run; nothing here refits anything. What is live is the reading: the
// drug under the pointer, where it sits in the whole batch, and the distribution of the drugs the current filters leave
// in view. Data: data/ti/live.json, keyed by this page's own CIDs by tools/build_ti_live.py, fetched after the first
// paint so it costs the first load nothing.
//
// The readout is aria-hidden on purpose. It repeats, for a hovered sphere, what the drug panel says in full and what the
// count line says about the view; a region that rewrites itself on every pointer move would be noise in a screen reader.
// The accessible path is the drug panel's own index row (js/detail.js), which carries the same numbers and their sources.
import { app, bus, $, esc, fin, fx, median } from './kernel.js';
import { whenIdle } from './idle.js';
import { tiBand } from './model.js';
import { setTiRow } from './detail.js';

const URL = 'data/ti/live.json';
/** Buckets in the little distribution strip. 40 spans are cheap to rebuild on every filter change. */
const BUCKETS = 40;
const SRC_WORD = { measured: 'measured', series_hansch: 'Hansch series', fallback_nonlinear: 'model', unavailable: 'none' };
const AD_WORD = {
  measured: 'both sides measured',
  inside: 'inside the applicability domain',
  outside: 'outside the applicability domain',
};
let loaded = null, viewDirty = true;

/** The word for a provenance key, for a reader who has not opened the ranked batch. */
export const sourceWord = src => SRC_WORD[src] || src || '—';

/** Indexed drugs among `list`: how many, their median, and the widest margin in the set. */
export function summarise(list) {
  const vals = [], top = { ti: -Infinity, name: '' };
  for (const d of list) {
    const ti = d.ti?.ti;
    if (!fin(ti) || (app.tiKeep && !app.tiKeep.has(d.cid))) continue;   // the workbench's rules threw this one out
    vals.push(ti);
    if (ti > top.ti) { top.ti = ti; top.name = d.name; }
  }
  return { n: vals.length, of: list.length, median: vals.length ? median(vals) : null, top: vals.length ? top : null };
}

/** Counts per bucket over [lo, hi], and the largest of them. For the distribution strip. */
export function histogram(list, lo, hi, buckets = BUCKETS) {
  const bins = new Array(buckets).fill(0);
  const span = hi - lo || 1;
  for (const d of list) {
    const ti = d.ti?.ti;
    if (!fin(ti)) continue;
    bins[Math.max(0, Math.min(buckets - 1, Math.floor(((ti - lo) / span) * buckets)))] += 1;
  }
  return { bins, peak: Math.max(1, ...bins) };
}

/** Fraction of the way along [lo, hi], clamped, as a percentage string. */
export const posOf = (ti, lo, hi) => `${Math.max(0, Math.min(100, ((ti - lo) / ((hi - lo) || 1)) * 100)).toFixed(2)}%`;

/** The readout element, or null where there is no document at all (the unit tests import this module). */
const host = () => (typeof document === 'undefined' ? null : $('#ti-live'));
const batch = () => app.tiMeta?.batch || { min: -2, max: 6, median: null, n: 0 };
/** The drug the readout is about: the hovered sphere, else the selected one. */
const current = () => {
  const i = app.hover >= 0 ? app.hover : app.selected;
  return i >= 0 ? app.drugs[i] : null;
};

/** The strip: the distribution of the drugs in view, with the batch median marked, and the pick's own marker. */
function strip(pick) {
  const { min, max } = batch();
  const { bins, peak } = histogram(app.visible, min, max);
  const med = batch().median;
  // every bucket wears the colour its own band has on the plot, so the strip and the spheres agree when the
  // colour mode is the index; height carries the count, so an empty bucket is a flat line rather than a gap
  const T = app.tokens;
  const bars = bins.map((n, i) => {
    const mid = min + ((i + 0.5) / bins.length) * (max - min);
    const h = n ? 18 + 82 * (n / peak) : 6;
    return `<i style="height:${h.toFixed(0)}%;background:${T['q' + (tiBand(mid) || 1)] || 'currentColor'};opacity:${n ? 1 : 0.25}"></i>`;
  }).join('');
  const marks = (fin(med) ? `<u class="til-med" style="left:${posOf(med, min, max)}"></u>` : '')
    + (pick && fin(pick.ti?.ti) ? `<b class="til-dot" style="left:${posOf(pick.ti.ti, min, max)}"></b>` : '');
  return `<div class="til-strip">${bars}${marks}</div>`
    + `<div class="til-ends"><span>${fx(min, 1)}</span><span>${fx(max, 1)}</span></div>`;
}

/** One picked drug: the number, where it sits, its rank at its own target, and where each half came from. */
function pickBlock(d) {
  const t = d.ti;
  if (!t) {
    const c = app.tiMeta?.counts || {};
    return `<p class="til-name">${esc(d.name)}</p>`
      + `<p class="til-none">No index. The ranked batch covers ${c['drugs on this page with an index'] ?? '—'} of the `
      + `${c['drugs on this page'] ?? '—'} drugs here; the rest had no model that validated at their target, no usable `
      + `structure, or the router would not place them.</p>`;
  }
  const ord = t.rank === 1 ? '1st' : t.rank === 2 ? '2nd' : t.rank === 3 ? '3rd' : `${t.rank}th`;
  const routed = t.tsrc === 'chembl_mechanism' ? 'recorded target' : 'target inferred from structure';
  // The rank below is the published one. If the reader's own rules exclude this drug, that rank is not theirs to
  // read, so the row says so rather than letting a number stand under rules that would have removed it.
  const out = app.tiKeep && !app.tiKeep.has(d.cid);
  if (out) {
    return `<p class="til-name">${esc(d.name)}</p>`
      + `<p class="til-big"><span class="til-n til-dim">${fx(t.ti, 2)}</span><span class="til-u">activity − hERG</span></p>`
      + `<p class="til-none">Your own rules exclude this drug, so it has no rank here. The published batch gives it `
      + `${ord} of ${t.n} at ${esc(t.tname)}.</p>`;
  }
  return `<p class="til-name">${esc(d.name)}</p>`
    + `<p class="til-big"><span class="til-n">${fx(t.ti, 2)}</span><span class="til-u">activity − hERG</span></p>`
    + `<p class="til-row">${ord} of ${t.n} at ${esc(t.tname)} <span class="til-dim">${esc(routed)}</span></p>`
    + `<p class="til-row">activity ${fx(t.act, 2)} <span class="til-dim">${esc(sourceWord(t.asrc))}</span>`
    + ` · hERG ${fx(t.herg, 2)} <span class="til-dim">${esc(sourceWord(t.hsrc))}</span></p>`
    + `<p class="til-row til-dim">${esc(AD_WORD[t.ad] || t.ad)}</p>`;
}

/** The view, when nothing is picked: how much of it carries an index at all. */
function viewBlock() {
  const s = summarise(app.visible);
  if (!s.n) return `<p class="til-none">None of the ${s.of} drugs in this view carries an index.</p>`;
  return `<p class="til-row"><strong>${s.n}</strong> of ${s.of} drugs in view carry an index</p>`
    + `<p class="til-row">median ${fx(s.median, 2)} · widest ${esc(s.top.name)} ${fx(s.top.ti, 2)}</p>`;
}

/**
 * The drug panel's therapeutic-index row, as HTML. Registered with js/detail.js once this module is in, because this
 * is where the index data and the words for its provenance already live. It is the accessible copy of the stage
 * readout above, which is aria-hidden: a region that rewrites on every pointer move is noise to a screen reader,
 * so the same facts are stated once, calmly, in the panel.
 * @param {object} d a drug  @returns {string} the row, or the reason there is none
 */
export function tiRow(d) {
  const t = d.ti;
  if (!t) {
    return app.tiReady
      ? '<div class="act-box">No therapeutic index: this drug is not in the ranked batch, because no model validated '
        + 'at its target, its structure could not be used, or the router would not place it. The Therapeutic index '
        + 'panel lists every reason with its count.</div>'
      : '';
  }
  const ord = t.rank === 1 ? '1st' : t.rank === 2 ? '2nd' : t.rank === 3 ? '3rd' : `${t.rank}th`;
  const dom = { measured: 'Both sides are laboratory measurements.', inside: 'Inside the applicability domain.',
    outside: 'Outside the applicability domain: the model is answering about a molecule unlike its training set.' }[t.ad] || '';
  const out = app.tiKeep && !app.tiKeep.has(d.cid);
  return `<div class="act-box"><span class="big">${fx(t.ti, 2)}</span> therapeutic index`
    + ` <small>(activity − hERG, both pChEMBL)</small><br>`
    + `activity ${fx(t.act, 2)} <small>${esc(sourceWord(t.asrc))}${t.aq ? `, ${esc(t.aq)}` : ''}</small>`
    + ` − hERG ${fx(t.herg, 2)} <small>${esc(sourceWord(t.hsrc))}${t.hq ? `, ${esc(t.hq)}` : ''}</small><br>`
    + `${ord} of ${t.n} at <a href="https://www.ebi.ac.uk/chembl/target_report_card/${esc(t.tid)}/" target="_blank" rel="noopener noreferrer">${esc(t.tid)}</a> ${esc(t.tname)}`
    + ` <small>${esc(t.tsrc === 'chembl_mechanism' ? 'target recorded in ChEMBL' : 'target inferred from structure')}`
    + `${t.rdec === 'ambiguous' ? ', and the router\'s best matches were tied, so the target is a guess' : ''}</small><br>`
    + (out ? `<small><strong>Your own rules in the Decisions panel exclude this drug</strong>, so that rank is the published one, not yours.</small><br>` : '')
    + `<small>${esc(dom)} A margin over the cardiac channel: not LD50 over ED50, not a clinical therapeutic index, not dose-aware.</small></div>`;
}

/** Redraw the readout. Cheap enough for a pointer move: one innerHTML of about forty small nodes. */
export function renderTiLive() {
  const el = host();
  if (!el) return;
  if (!app.tiReady) { el.hidden = true; return; }
  el.hidden = false;
  const pick = current();
  el.innerHTML = '<p class="til-head">Therapeutic index</p>'
    + (pick ? pickBlock(pick) : viewBlock())
    + strip(pick)
    + (app.tiRuleText ? `<p class="til-foot">Your rules are on — ${esc(app.tiRuleText)}. Drugs they exclude are grey.</p>` : '')
    + '<p class="til-foot">A margin over the cardiac channel, not a clinical therapeutic index and not dose-aware.</p>';
  viewDirty = false;
}

/**
 * Fetch data/ti/live.json once and hang each record on its drug as `d.ti`. Sets app.tiReady and emits `ti:ready` so the
 * pickers (js/controls.js) and the drug panel (js/detail.js) can offer the index; a failure leaves the page as it was.
 * @returns {Promise<boolean>} whether the data is in
 */
export function loadTiLive(fetcher) {
  loaded ||= (fetcher ? fetcher(URL) : fetch(URL, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))))
    .then(data => {
      app.tiMeta = data.meta || null;
      for (const d of app.drugs) {
        const rec = data.drugs?.[String(d.cid)];
        if (rec) d.ti = rec;
      }
      app.tiReady = true;
      setTiRow(tiRow);                                                 // repaint the open panel now the data is in
      bus.emit('ti:ready');
      renderTiLive();
      return true;
    })
    .catch(err => { console.error('the therapeutic-index file did not load', err); loaded = null; return false; });
  return loaded;
}

/** Wire the readout and start the fetch when the main thread is next idle. Safe without WebGL (there is then no hover). */
export function initTiLive() {
  bus.on('layout', () => { viewDirty = true; renderTiLive(); });
  bus.on('selection', renderTiLive);
  bus.on('hover', renderTiLive);
  bus.on('theme', () => { if (app.tiReady) renderTiLive(); });
  bus.on('recolor', () => { if (viewDirty) renderTiLive(); });
  bus.on('ti:rules', () => { viewDirty = true; renderTiLive(); setTiRow(tiRow); });   // the workbench changed what counts as ranked
  setTiRow(tiRow);                                                   // the drug panel's index row is written here too
  whenIdle(() => loadTiLive(), { timeout: 4000, fallbackMs: 800 });
}
