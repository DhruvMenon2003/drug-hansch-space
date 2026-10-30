// Layer 2. The drug detail panel (identifiers, descriptors, activity, ATC) and the 2D depiction. The 3D conformer is
// drawn by the GL layer, which listens to the same `selection` event.
//
// The 2D depiction is the one expensive thing here. SmilesDrawer (61 KB gzip) is not loaded with the page: the first drug that
// is opened loads it with a script element, and every depiction is drawn from an idle callback, after the 3D conformer has been
// built when there is one. A median molecule takes 2 ms; the 19 largest (peptides) take 100 ms to 1.3 s of one uninterruptible
// task, so molecules above MAX_AUTO_ATOMS heavy atoms are drawn on request ("Draw anyway") instead of freezing the page.
import { app, bus, ORDER, $, cap, esc, fin, fx, fmtConc, isDark } from './kernel.js';
import { announce } from './announce.js';
import { BANDS, band, distribution, percentileRank, profile } from './domain.js';
import { whenIdle } from './idle.js';

const SD_SRC = 'vendor/smiles-drawer/smiles-drawer.min.js';
const SD_RETRY_MS = 15_000;       // after a failed load, the next attempt waits this long (no request storm, no console flood)
/** Above this many heavy atoms a depiction is drawn on request, not automatically (measured: <= 110 atoms draws in <= 100 ms). */
export const MAX_AUTO_ATOMS = 110;
/** The longest the depiction waits for the 3D conformer before it is drawn anyway (ms). */
const CONFORMER_WAIT_MS = 1200;
const NOT_AVAILABLE = 'Structure drawing not available.';

let sdPromise = null, sdFailedAt = -Infinity;
/**
 * Load the vendored SmilesDrawer once (shared promise). A failed load is not cached as a rejection for ever: it is retried after
 * SD_RETRY_MS, and calls inside that window reject at once without another request.
 * @returns {Promise<any>} the SmilesDrawer namespace
 */
export function loadSmilesDrawer() {
  if (window.SmilesDrawer) return Promise.resolve(window.SmilesDrawer);
  if (sdPromise) return sdPromise;
  if (performance.now() - sdFailedAt < SD_RETRY_MS) return Promise.reject(new Error('SmilesDrawer did not load'));
  const p = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SD_SRC;
    el.async = true;
    el.onload = () => (window.SmilesDrawer ? resolve(window.SmilesDrawer) : reject(new Error('SmilesDrawer is missing from its script')));
    el.onerror = () => { el.remove(); reject(new Error(`${SD_SRC} did not load`)); };
    document.head.appendChild(el);
  });
  sdPromise = p;
  p.catch(() => { sdFailedAt = performance.now(); if (sdPromise === p) sdPromise = null; });
  return p;
}

// Whether the GL layer will build a conformer for each selection (it says so in initMolEvents), and the drawn depictions.
let conformerExpected = false;
/** Called by the GL layer: while true, a depiction waits for the `conformer:shown` event of its drug (or CONFORMER_WAIT_MS). */
export function expectConformer(on) { conformerExpected = !!on; }
const drawn = new Map();          // `${cid}|${dark}` -> finished <svg>, 16 most recent
const forced = new Set();         // CIDs of large molecules the user asked to draw
let drawToken = 0, cancelDraw = () => {};

const heavyAtoms = d => (fin(d.d?.heavy) ? d.d.heavy : (String(d.smiles).match(/Cl|Br|[BCNOPSFI]|\[[^\]]+\]|[cnops]/g) || []).length);
const unavailable = (host, text) => { host.textContent = text; host.dataset.state = 'unavailable'; host.removeAttribute('aria-busy'); };

/**
 * SmilesDrawer depiction of `d` into #d-2d, after the conformer's `conformer:shown` event unless `wait` is false. Returns at
 * once: the SVG arrives later (host.dataset.state is "pending" until then, then "done", "unavailable", "large" or "none").
 * A newer call, or a new selection, abandons the one in flight.
 */
export function drawDepiction(d, { wait = true } = {}) {
  const host = $('#d-2d'), token = ++drawToken;
  cancelDraw();
  cancelDraw = () => {};
  host.replaceChildren();
  host.removeAttribute('aria-busy');
  if (!d.smiles) { host.dataset.state = 'none'; return; }
  const atoms = heavyAtoms(d);
  if (atoms > MAX_AUTO_ATOMS && !forced.has(d.cid)) { showLarge(host, d, atoms); return; }
  host.dataset.state = 'pending';
  host.setAttribute('aria-busy', 'true');
  const stale = () => token !== drawToken;
  const start = () => {
    if (stale()) return;
    cancelDraw = whenIdle(async () => {
      if (stale()) return;
      let SD;
      try { SD = await loadSmilesDrawer(); } catch { if (!stale()) unavailable(host, NOT_AVAILABLE); return; }
      if (stale()) return;
      cancelDraw = whenIdle(() => { if (!stale()) paint(host, SD, d); }, { timeout: 1500 });   // the script's own task is over: draw in a new one
    }, { timeout: 1500 });
  };
  if (!conformerExpected || !wait) { start(); return; }
  // the conformer first: its geometry is the main picture of the panel, and the two jobs should not share a task
  const timer = setTimeout(() => { off(); start(); }, CONFORMER_WAIT_MS);
  const off = bus.on('conformer:shown', e => { if (e?.cid === d.cid) { clearTimeout(timer); off(); start(); } });
  const prev = cancelDraw;
  cancelDraw = () => { clearTimeout(timer); off(); prev(); };
}

function showLarge(host, d, atoms) {
  host.dataset.state = 'large';
  const box = document.createElement('div');
  box.className = 'depict-note';
  const p = document.createElement('p');
  p.textContent = `This is a large molecule (${atoms} heavy atoms). Its 2D drawing is not made automatically because it can freeze the page for a second or more, and at this size it is too small to read.`;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Draw anyway';
  b.addEventListener('click', () => { forced.add(d.cid); drawDepiction(d); });
  box.append(p, b);
  host.appendChild(box);
}

/** The synchronous part: parse and draw (one task, short for everything below MAX_AUTO_ATOMS). */
function paint(host, SD, d) {
  const key = `${d.cid}|${isDark() ? 1 : 0}`, hit = drawn.get(key);
  if (hit) { host.replaceChildren(hit.cloneNode(true)); host.dataset.state = 'done'; host.removeAttribute('aria-busy'); return; }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `2D structure of ${d.name}`);
  host.replaceChildren(svg);
  const drawer = new SD.SvgDrawer({ width: 360, height: 240, bondThickness: 1.1, padding: 12, compactDrawing: false });
  const fail = () => unavailable(host, '2D depiction not available for this structure.');
  SD.parse(d.smiles, tree => {
    try {
      drawer.draw(tree, svg, isDark() ? 'dark' : 'light');
      svg.removeAttribute('style');
      host.dataset.state = 'done';
      host.removeAttribute('aria-busy');
      drawn.set(key, svg.cloneNode(true));
      if (drawn.size > 16) drawn.delete(drawn.keys().next().value);
    } catch { fail(); }
  }, fail);
}

// Retry button for a failed conformer fetch (the GL layer calls this; it lives next to the conformer's status line).
/** Show a "Retry" button after #d-src that calls `fn`, or hide it when `fn` is null. */
export function setConformerRetry(fn) {
  let b = $('#d-retry');
  if (!fn) { if (b) b.hidden = true; return; }
  if (!b) {
    b = document.createElement('button');
    b.type = 'button';
    b.id = 'd-retry';
    b.className = 'ghost';
    b.textContent = 'Retry';
    b.setAttribute('aria-label', 'Retry loading the 3D conformer');
    b.addEventListener('click', () => b._retry?.());
    $('#d-src').after(b);
  }
  b._retry = fn;
  b.hidden = false;
}

// The selected drug may be filtered out of the current view (the ring then disappears from the plot): say so in the panel
// and to screen readers, once per change of state.
let outAnnounced = null;
function noteEl() {
  let el = $('#d-note');
  if (!el) {
    el = document.createElement('p');
    el.id = 'd-note';
    el.className = 'flags';
    el.setAttribute('role', 'note');
    $('#detail-body .drug-head')?.after(el);
  }
  return el;
}
function updateViewNote() {
  if (app.selected < 0 || $('#detail-body').hidden) return;
  const d = app.drugs[app.selected], out = !app.visible.includes(d);
  noteEl().textContent = out ? `${cap(d.name)} is not in the current view: the filters or the chosen axes leave it out.` : '';
  if (out && outAnnounced !== d) announce(`${cap(d.name)} is not in the current view.`);
  outAnnounced = out ? d : null;
}

// ---------------------------------------------------------------- percentile bounding box
// Each descriptor carries where it sits in the whole plotted table, the way admetSAR 3.0 shows a basic property:
// green inside the 5th–95th percentile, amber past one of them, red outside the observed range. It describes this
// drug against the drugs on the page; it is not a prediction and not a safety statement.
/** Descriptors that carry a percentile pill, with the name used in the summary line. */
const BOX = { logp: 'log P', mr: 'MR', tpsa: 'TPSA', mw: 'MW', hbd: 'donor count', hba: 'acceptor count',
  rotb: 'rotatable bonds', arom: 'aromatic rings', fsp3: 'Fsp3', cx: 'complexity' };
const BOX_KEYS = Object.keys(BOX);
let refs = null;
/** Reference distribution of every pilled descriptor over the whole drug table, built once. */
function references() {
  if (!refs) refs = Object.fromEntries(BOX_KEYS.map(k => [k, distribution(app.drugs.map(x => x.d?.[k]))]));
  return refs;
}
function pill(key, value) {
  const dist = references()[key], b = band(dist, value);
  if (!b) return '';
  const pct = percentileRank(dist, value);
  return ` <span class="pct pct-${b}" title="${fx(pct, 0)}th percentile of ${dist.n} drugs: ${BANDS[b]}. 5th ${fx(dist.p5, 2)}, 95th ${fx(dist.p95, 2)}, range ${fx(dist.min, 2)} to ${fx(dist.max, 2)}.">${fx(pct, 0)}%</span>`;
}
function showBox(d) {
  const bands = BOX_KEYS.map(k => band(references()[k], d.d?.[k])), p = profile(bands), n = bands.filter(Boolean).length;
  const flagged = BOX_KEYS.filter((k, i) => bands[i] && bands[i] !== 'in')
    .map(k => `${BOX[k]} ${bands[BOX_KEYS.indexOf(k)] === 'out' ? 'outside the observed range' : 'past a percentile'}`);
  $('#d-domain').textContent = n
    ? `Percentile box: ${p.counts.in} of ${n} descriptors inside the 5th–95th percentile of the ${references().logp.n} drugs here`
      + (flagged.length ? `; ${flagged.join(', ')}.` : '.')
    : '';
}

/**
 * The therapeutic-index row: the number, the two halves it is made of with where each came from, the rank at its own
 * target and the domain word. This is the accessible copy of the stage readout (js/ti-live.js), which is aria-hidden;
 * the data is hung on the drug as `d.ti` by that module, so an empty row only means the file has not landed yet.
 */
function showTi(d) {
  const box = $('#d-ti');
  if (!box) return;
  const t = d.ti, word = s => ({ measured: 'measured', series_hansch: 'from a validated Hansch series model',
    fallback_nonlinear: 'modelled by the target\'s fallback' }[s] || s || 'unknown');
  if (!t) {
    box.innerHTML = app.tiReady
      ? '<div class="act-box">No therapeutic index: this drug is not in the ranked batch, because no model validated at '
        + 'its target, its structure could not be used, or the router would not place it. The Therapeutic index panel '
        + 'lists every reason with its count.</div>'
      : '';
    return;
  }
  const ord = t.rank === 1 ? '1st' : t.rank === 2 ? '2nd' : t.rank === 3 ? '3rd' : `${t.rank}th`;
  const dom = { measured: 'Both sides are laboratory measurements.', inside: 'Inside the applicability domain.',
    outside: 'Outside the applicability domain: the model is answering about a molecule unlike its training set.' }[t.ad] || '';
  box.innerHTML = `<div class="act-box"><span class="big">${fx(t.ti, 2)}</span> therapeutic index`
    + ` <small>(activity − hERG, both pChEMBL)</small><br>`
    + `activity ${fx(t.act, 2)} <small>${esc(word(t.asrc))}${t.aq ? `, ${esc(t.aq)}` : ''}</small>`
    + ` − hERG ${fx(t.herg, 2)} <small>${esc(word(t.hsrc))}${t.hq ? `, ${esc(t.hq)}` : ''}</small><br>`
    + `${ord} of ${t.n} at <a href="https://www.ebi.ac.uk/chembl/target_report_card/${esc(t.tid)}/" target="_blank" rel="noopener noreferrer">${esc(t.tid)}</a> ${esc(t.tname)}`
    + ` <small>${esc(t.tsrc === 'chembl_mechanism' ? 'target recorded in ChEMBL' : 'target inferred from structure')}`
    + `${t.rdec === 'ambiguous' ? ', and the router\'s best matches were tied, so the target is a guess' : ''}</small><br>`
    + `<small>${esc(dom)} A margin over the cardiac channel: not LD50 over ED50, not a clinical therapeutic index, not dose-aware.</small></div>`;
}

function showDetail({ index }) {
  const d = app.drugs[index];
  $('#detail-empty').hidden = true;
  $('#detail-body').hidden = false;
  $('#d-name').textContent = d.name;
  const pc = `https://pubchem.ncbi.nlm.nih.gov/compound/${d.pcid}`;
  $('#d-ids').innerHTML = `<a href="${pc}" target="_blank" rel="noopener noreferrer">PubChem CID ${d.pcid}</a>` +
    (d.pcid !== d.cid ? ` (dataset CID ${d.cid})` : '') +
    (d.chembl ? ` · <a href="https://www.ebi.ac.uk/chembl/compound_report_card/${esc(d.chembl)}/" target="_blank" rel="noopener noreferrer">${esc(d.chembl)}</a>` : '') +
    `<br>${esc(d.ik || '')}${d.d.formula ? ' · ' + esc(d.d.formula) : ''}`;
  const D = d.d, kv = (k, v, small = '', key = '') => `<div><dt>${k}</dt><dd>${v}${small ? ` <small>${small}</small>` : ''}${key ? pill(key, D[key]) : ''}</dd></div>`;
  $('#d-desc').innerHTML = [
    kv('log P', fx(D.logp, 2), fin(D.xlogp) ? `Crippen; XLogP3 ${fx(D.xlogp, 2)}` : 'Crippen', 'logp'),
    kv('MR', fx(D.mr, 1), 'cm³/mol', 'mr'), kv('TPSA', fx(D.tpsa, 1), 'Å²', 'tpsa'), kv('MW', fx(D.mw, 1), 'Da', 'mw'),
    kv('N/O-bound hydrogens · Lipinski count', D.hbd ?? '–', '', 'hbd'), kv('N + O atoms · Lipinski count', D.hba ?? '–', '', 'hba'),
    kv('Rotatable bonds', D.rotb ?? '–', '', 'rotb'),
    kv('Aromatic rings', D.arom ?? '–', '', 'arom'), kv('Fsp3', fx(D.fsp3, 2), '', 'fsp3'), kv('Complexity', fx(D.cx, 0), 'PubChem', 'cx'),
    kv('Rule-of-five violations', D.ro5 ?? '–'), kv('Formal charge', D.charge ?? '–'),
  ].join('');
  showBox(d);
  const a = d.act;
  $('#d-act').innerHTML = a
    ? `<div class="act-box"><span class="big">${fx(a.p, 2)}</span> pChEMBL <small>(about ${fmtConc(a.p)})</small><br>` +
      `at <a href="https://www.ebi.ac.uk/chembl/target_report_card/${esc(a.target)}/" target="_blank" rel="noopener noreferrer">${esc(a.target)}</a> ${esc(a.tname || '')}` +
      `<br><small>Median of ${esc(a.types || 'IC50/Ki/EC50/Kd')} values from ${a.ndoc ?? '≥2'} ChEMBL documents.</small></div>`
    : `<div class="act-box">No activity value: fewer than two ChEMBL documents agreed on a pChEMBL at the mechanism target.</div>`;
  showTi(d);
  const names = app.meta.atc_names;
  $('#d-atc').innerHTML = d.atc.map(e => {
    const path = [e.code[0], e.code.slice(0, 3), e.code.slice(0, 4), e.code.slice(0, 5)].filter(c => names[c]).map(c => cap(names[c])).join(' › ');
    return `<li><span class="atc-code">${esc(e.code)}</span> <span class="atc-path">${esc(path)}</span><br>${e.routes.length ? e.routes.map(r => `<span class="route">${esc(cap(r))}</span>`).join('') : '<span class="route">No route listed</span>'}</li>`;
  }).join('');
  $('#d-flags').textContent = d.flags.length ? 'Curation notes: ' + d.flags.join('; ') + '.' : '';
  $('#d-src').textContent = d.conf ? d.conf : 'No 3D conformer';
  drawDepiction(d);
  outAnnounced = null;
  updateViewNote();
}

/** Show the panel on `selection`; redraw the depiction when the theme changes. */
export function initDetail() {
  bus.on('selection', showDetail);
  bus.on('ti:ready', () => { if (app.selected >= 0) showTi(app.drugs[app.selected]); });   // the index file lands after the first pick
  bus.on('layout', updateViewNote, ORDER.UI);
  bus.on('theme', () => { if (app.selected >= 0) drawDepiction(app.drugs[app.selected], { wait: false }); });
}
