// A lazy, native dialog on the existing explorer. Reads the notebook's frozen export; never fits a model in the browser.
import { app, bus, $, esc, fin, fx } from './kernel.js';
import { announce } from './announce.js';
import { selectDrug } from './view.js';
import { ADMETSAR_MAP, agreement, fitRange, populationRange, rangeProfile } from './qsar-range.js';

const DATA_URL = 'data/qsar_drd2.json';
let data = null, pending = null, wired = false, rangeRef = null;
const RANGE_WORDS = { in: 'In domain', warn: 'Warning', out: 'Out of domain' };
// Built here, not in index.html: this module loads only when the dialog opens, so the markup stays off the first load.
const RANGE_HTML = `<style>
.qsar-range{margin-block:20px;padding:12px;border:1px solid var(--line);border-radius:8px}.qsar-range>h3{font-size:1.05rem}
.qsar-range-verdict{font-weight:600}.qsar-range-track{fill:var(--grid)}.qsar-range-band{fill:var(--ok);fill-opacity:.22}
.qsar-range-iqr{fill:var(--ok);fill-opacity:.45}.qsar-range-median{stroke:var(--ink);stroke-width:2}
.qsar-range-edge{stroke:var(--ink-2);stroke-width:1;stroke-dasharray:3 3}
.qsar-range-in,.qsar-range-warn,.qsar-range-out{stroke:var(--panel);stroke-width:1.5}
.qsar-range-in,.qsar-range-seg-in{fill:var(--ok)}.qsar-range-warn,.qsar-range-seg-warn{fill:var(--warn)}.qsar-range-out,.qsar-range-seg-out{fill:var(--mark)}
.qsar-grid svg text.qsar-range-seg-label{fill:var(--bg);font-weight:700}
</style><h3 id="qsar-range-h">Property-range domain · percentile rails (admetSAR 3.0 rule)</h3>
<p class="small">Each model descriptor is min–max standardized against the <strong>scaffold-training set only</strong>: 0 = training minimum, 1 = training maximum. Test compounds use the same parameters, so they can fall below 0 or above 1. The pale track is the training range, the tinted band is the 5th–95th percentile, the darker band is the interquartile range and the tick is the median. A compound is <em>in domain</em> if every descriptor lies within the 5th–95th percentiles. It gets a <em>warning</em> if any value falls past a percentile but stays inside the training range, and it is <em>out of domain</em> if any value falls outside the training range. This follows the property-range rule of <a href="https://lmmd.ecust.edu.cn/admetsar3/about/endpoint.php" target="_blank" rel="noopener noreferrer">admetSAR 3.0</a> (Gu et al., <i>Nucleic Acids Res.</i> 2024, 52(W1):W432–W438), applied here to this model's nine descriptors. It complements the leverage-based Williams plot and does not establish that a prediction is reliable.</p>
<div class="field"><label for="qsar-range-compound">Compound</label><select id="qsar-range-compound"></select></div>
<p id="qsar-range-verdict" class="qsar-range-verdict" aria-live="polite"></p>
<div class="qsar-grid">
<figure><h3>Percentile rails · selected compound</h3><svg id="qsar-range" role="img" aria-labelledby="qsar-range-cap"></svg><figcaption id="qsar-range-cap"></figcaption></figure>
<figure><h3>Range verdict by split</h3><svg id="qsar-range-pop" role="img" aria-labelledby="qsar-range-pop-cap"></svg><figcaption id="qsar-range-pop-cap"></figcaption></figure>
</div>
<details><summary>Training reference ranges (min–max scaler parameters)</summary><div class="table-wrap" tabindex="0" role="region" aria-label="Training reference ranges"><table class="stats"><thead><tr><th scope="col">Descriptor</th><th scope="col">Min</th><th scope="col">P5</th><th scope="col">Median</th><th scope="col">P95</th><th scope="col">Max</th><th scope="col">admetSAR 3.0 property</th></tr></thead><tbody id="qsar-range-ref"></tbody></table></div></details>`;
const rangeWorst = p =>rangeRef ? rangeProfile(rangeRef, p).worst : null;
const joins = new Map();                         // standardized compound InChIKey -> existing explorer drug

/** Fail visibly rather than render a partially loaded or incompatible scientific result as a valid model. */
export function validateQsar(value) {
  if (value?.schema_version !== 1 || value.target?.id !== 'CHEMBL217' || value.target?.organism !== 'Homo sapiens'
    || value.assay_type !== 'B' || value.standard_type !== 'Ki')
    throw new Error('Expected schema 1, human DRD2 (CHEMBL217), binding assays and Ki.');
  if (!Array.isArray(value.compounds) || value.n !== value.compounds.length || value.n < 40 || value.seed !== 42)
    throw new Error('The compound count or seed is missing or inconsistent.');
  const keys = new Set();
  for (const p of value.compounds) {
    if (!/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/.test(p.inchikey || '') || keys.has(p.inchikey)
      || !['observed', 'predicted', 'leverage', 'standardized_residual'].every(k => fin(p[k]))
      || typeof p.outside_domain !== 'boolean' || !['train', 'test'].includes(p.split))
      throw new Error('A compound has duplicate identity, missing diagnostics or an unknown split.');
    keys.add(p.inchikey);
  }
  const ad = value.applicability_domain;
  if (!(ad?.threshold > 0) || !(ad.standardized_residual_limit > 0) || !Number.isInteger(ad.p) || !Number.isInteger(ad.n))
    throw new Error('Applicability-domain thresholds are missing.');
  if (!Array.isArray(value.scrambling?.r2) || value.scrambling.r2.length !== 100
    || !value.scrambling.r2.every(fin) || !fin(value.scrambling.real_r2))
    throw new Error('Expected 100 completed y-scrambles and the real r².');
  if (!value.metrics || !Array.isArray(value.coefficients) || !value.coefficients.length || typeof value.verdict !== 'string')
    throw new Error('The metrics, coefficient table or verdict are missing.');
  for (const [group, required] of Object.entries({ final_fit: ['n', 'r2', 'adjusted_r2', 'rmse', 'f_statistic', 'f_p_value', 'descriptor_count'], train: ['n', 'r2', 'rmse'], test: ['n', 'r2', 'rmse'], cv: ['n', 'r2', 'rmse', 'q2'], loo: ['n', 'r2', 'rmse', 'q2'] }))
    if (!required.every(key => fin(value.metrics[group]?.[key]))) throw new Error(`Missing ${group} validation metrics.`);
  if (value.metrics.cv.folds?.length !== 5 || value.metrics.split?.shared_scaffolds !== 0)
    throw new Error('Expected five CV folds and disjoint train/test scaffolds.');
  if (!value.coefficients.every(row => typeof row.descriptor === 'string' && ['coefficient', 'standard_error', 'p_value'].every(key => fin(row[key])))
    || value.metrics.final_fit.descriptor_count > Math.floor(value.n / 5))
    throw new Error('The coefficient table or descriptor-count limit is invalid.');
  return value;
}

/** Exact whole-InChIKey first; CID/parent CID only if it identifies one explorer record. No fuzzy structure matches. */
function matches(p, drugs) {
  const exact = drugs.filter(d => d.ik === p.inchikey).sort((a, b) => a.cid - b.cid);
  if (exact.length) return exact;
  const cid = Number(p.pubchem_cid);
  if (!Number.isSafeInteger(cid) || cid <= 0) return [];
  const direct = drugs.filter(d => d.cid === cid);
  if (direct.length === 1) return direct;
  const candidates = drugs.filter(d => d.pcid === cid);
  return candidates.length === 1 ? candidates : [];
}
export function joinCompounds(compounds, drugs) {
  const result = new Map();
  for (const p of compounds) {
    const candidates = matches(p, drugs);
    if (candidates.length) result.set(p.inchikey, candidates[0]);
  }
  return result;
}

/** Table-only search: every filter narrows the same frozen records; the model and plotted population stay fixed. */
export function filterCompounds(compounds, matched, { query = '', split = '', domain = '' } = {}) {
  const needle = String(query).trim().toLowerCase().replace(/^cid[\s:]+/, '');
  return compounds.filter(p => {
    if (split && p.split !== split) return false;
    if (domain && p.outside_domain !== (domain === 'outside')) return false;
    if (!needle) return true;
    const d = matched.get(p.inchikey);
    const fields = [p.inchikey, d?.name, d?.cid, d?.pcid, p.pubchem_cid, ...(p.pubchem_cids || [])];
    return fields.some(value => value != null && String(value).toLowerCase().includes(needle));
  });
}

const DESCRIPTOR_UNITS = {
  QED: 'dimensionless (0–1)', MolLogP: 'dimensionless log₁₀ ratio', MolLogP_squared: '(log₁₀ ratio)²',
  MolMR: 'cm³/mol', TPSA: 'Å²', MolWt: 'Da', HBD: 'donor count', HBA: 'acceptor count',
  RotatableBonds: 'bond count', AromaticRings: 'ring count', FractionCSP3: 'fraction (0–1)',
};
const isIntercept = descriptor => /^(intercept|const)$/i.test(descriptor);

/** Reconstruct only a stored dataset record. No structure entry, new descriptors or new-compound predictions. */
export function equationBreakdown(coefficients, compound) {
  if (!Array.isArray(coefficients) || !coefficients.length || !compound) return null;
  const terms = coefficients.map(c => {
    const intercept = isIntercept(c.descriptor), input = intercept ? 1 : compound.descriptors?.[c.descriptor];
    return { descriptor: c.descriptor, coefficient: c.coefficient, input, contribution: input * c.coefficient, units: intercept ? 'constant 1' : DESCRIPTOR_UNITS[c.descriptor] || 'descriptor units' };
  });
  if (terms.some(t => !fin(t.input) || !fin(t.coefficient) || !fin(t.contribution))) return null;
  return { terms, total: terms.reduce((sum, t) => sum + t.contribution, 0) };
}

export async function openQsar() {
  wire();
  const dialog = $('#qsar-dialog');
  if (!dialog.open) dialog.showModal();
  if (data) { drawCharts(); return; }
  if (pending) return pending;
  $('#qsar-status').textContent = 'Loading the reproducible DRD2 results…';
  $('#qsar-status').hidden = false;
  $('#qsar-retry').hidden = true;
  $('#qsar-body').hidden = true;
  pending = (async () => {
    try {
      const response = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Results file returned HTTP ${response.status}.`);
      data = validateQsar(await response.json());
      joins.clear();
      for (const [key, drug] of joinCompounds(data.compounds, app.drugs)) joins.set(key, drug);
      app.qsarByCid.clear();
      for (const p of data.compounds) for (const d of matches(p, app.drugs)) app.qsarByCid.set(d.cid, p);
      // Scaler and percentile reference: the training model's own descriptors, training split only.
      rangeRef = fitRange(data.compounds, (data.training_coefficients || []).map(c => c.descriptor).filter(d => !isIntercept(d)));
      render();
      updateDetail();
      $('#qsar-status').hidden = true;
      $('#qsar-body').hidden = false;
      drawCharts();
    } catch (err) {
      data = null;
      $('#qsar-status').textContent = `QSAR results are unavailable. ${err.message} No model values have been substituted.`;
      $('#qsar-retry').hidden = false;
    } finally { pending = null; }
  })();
  return pending;
}

function wire() {
  if (wired) return;
  wired = true;
  $('#qsar-retry').addEventListener('click', openQsar);
  $('#qsar-highlight').addEventListener('change', e => highlight(e.target.checked));
  $('#qsar-clear').addEventListener('click', () => highlight(false));
  $('#qsar-search').addEventListener('input', renderCompounds);
  $('#qsar-split-filter').addEventListener('change', renderCompounds);
  $('#qsar-domain-filter').addEventListener('change', renderCompounds);
  $('#qsar-reset-filters').addEventListener('click', () => {
    for (const id of ['#qsar-search', '#qsar-split-filter', '#qsar-domain-filter']) $(id).value = '';
    renderCompounds();
    $('#qsar-search').focus();
  });
  $('#qsar-inspect-compound').addEventListener('change', renderEquationRecord);
  $('#qsar-range-section').innerHTML = RANGE_HTML;
  $('#qsar-range-compound').addEventListener('change', () => { renderRangeVerdict(); drawRange(); });
  $('#qsar-compounds').addEventListener('click', e => {
    const inspect = e.target.closest('button[data-inspect]');
    if (inspect) {
      $('#qsar-inspect-compound').value = inspect.dataset.inspect;
      $('#qsar-range-compound').value = inspect.dataset.inspect;
      renderEquationRecord(); renderRangeVerdict(); drawRange();
      $('#qsar-equation-inspector').open = true;
      $('#qsar-equation-title').focus({ preventScroll: true });
      $('#qsar-equation-title').scrollIntoView({ block: 'start' });
      return;
    }
    const button = e.target.closest('button[data-cid]');
    if (!button) return;
    $('#qsar-dialog').close();
    selectDrug(Number(button.dataset.cid));
    $('#d-qsar').scrollIntoView({ block: 'nearest' });
  });
  bus.on('selection', updateDetail);
  bus.on('theme', () => { if (data && $('#qsar-dialog').open) drawCharts(); });
  if (typeof ResizeObserver === 'function') {
    let width = 0;
    new ResizeObserver(entries => {
      const next = Math.round(entries[0].contentRect.width);
      if (next > 0 && next !== width) { width = next; if (data && $('#qsar-dialog').open) drawCharts(); }
    }).observe($('#qsar-body'));
  }
}

function highlight(on) {
  app.qsarHighlight = !!on && !!data;
  $('#qsar-highlight').checked = app.qsarHighlight;
  $('#qsar-clear').hidden = !app.qsarHighlight;
  bus.emit('recolor');
}

function updateDetail() {
  const node = $('#d-qsar'), drug = app.drugs[app.selected], p = drug && app.qsarByCid.get(drug.cid);
  node.hidden = !p;
  if (p) node.textContent = `DRD2 Ki QSAR · ${p.split === 'test' ? 'held-out test' : 'training'} compound. ${p.outside_domain ? 'Outside' : 'Within'} applicability domain; leverage ${fx(p.leverage, 3)}, standardized residual ${fx(p.standardized_residual)}. Observed ${fx(p.observed)}, predicted ${fx(p.predicted)} pChEMBL (training-only model).`;
}

const number = value => fin(value) ? (value !== 0 && Math.abs(value) < 0.001 ? value.toExponential(3) : Number(value.toPrecision(6)).toString()) : '—';
const niceLabel = value => String(value).replaceAll('_', ' ');
function metricRows(value, prefix = '') {
  return Object.entries(value).flatMap(([key, v]) => {
    const label = prefix ? `${prefix} / ${niceLabel(key)}` : niceLabel(key);
    if (v && typeof v === 'object') return metricRows(v, label);
    return `<tr><th scope="row">${esc(label)}</th><td>${esc(typeof v === 'number' ? number(v) : v ?? '—')}</td></tr>`;
  }).join('');
}

function renderCompounds() {
  if (!data) return;
  const query = $('#qsar-search').value, split = $('#qsar-split-filter').value, domain = $('#qsar-domain-filter').value;
  const visible = filterCompounds(data.compounds, joins, { query, split, domain });
  $('#qsar-record-count').textContent = `Showing ${visible.length} of ${data.n} compounds · ${visible.filter(p => p.outside_domain).length} outside the applicability domain.`;
  announce($('#qsar-record-count').textContent);
  $('#qsar-reset-filters').disabled = !query && !split && !domain;
  $('#qsar-no-matches').hidden = !!visible.length;
  $('#qsar-compounds').innerHTML = visible.map(p => {
    const d = joins.get(p.inchikey), name = d?.name || p.inchikey;
    const identity = d ? `<button type="button" class="ghost" data-cid="${d.cid}">${esc(d.name)}</button><br>` : '';
    const cid = p.pubchem_cid == null ? '' : `<br><span class="small">CID ${esc(p.pubchem_cid)}</span>`;
    return `<tr${p.outside_domain ? ' class="qsar-outside"' : ''}><th scope="row">${identity}<span class="mono">${esc(p.inchikey)}</span>${cid}<br><button type="button" class="ghost" data-inspect="${esc(p.inchikey)}" aria-label="Inspect equation for ${esc(name)}">Inspect equation</button></th><td>${esc(p.split)}</td><td>${number(p.observed)}</td><td>${number(p.predicted)}</td><td>${number(p.leverage)}</td><td>${number(p.standardized_residual)}</td><td class="qsar-domain">${p.outside_domain ? 'Outside' : 'Within'}</td><td>${esc(RANGE_WORDS[rangeWorst(p)] || '—')}</td></tr>`;
  }).join('');
}

function renderEquationRecord() {
  const p = data?.compounds.find(p => p.inchikey === $('#qsar-inspect-compound').value);
  const ad = data?.applicability_domain;
  $('#qsar-equation-context').textContent = p
    ? `${p.split === 'test' ? 'Held-out test' : 'Training'} record · stored domain flag: ${p.outside_domain ? 'Outside' : 'Within'} applicability domain. Leverage ${number(p.leverage)}; warning threshold h* = ${number(ad.threshold)}. Standardized residual ${number(p.standardized_residual)}; limit ±${number(ad.standardized_residual_limit)}. This frozen model is not predictive. A within-domain flag and an arithmetic match do not establish prediction reliability.`
    : 'No valid dataset record is selected. Applicability-domain diagnostics are unavailable.';
  const breakdown = equationBreakdown(data?.training_coefficients, p);
  if (!breakdown) {
    $('#qsar-equation-result').textContent = 'The training coefficients or descriptor values needed for this record are unavailable.';
    $('#qsar-equation-terms').replaceChildren();
    return;
  }
  const agrees = Math.abs(breakdown.total - p.predicted) <= 1e-8;
  $('#qsar-equation-result').textContent = `${p.split === 'test' ? 'Held-out test' : 'Training'} record · observed ${number(p.observed)} pChEMBL · stored prediction ${number(p.predicted)} pChEMBL · term sum ${number(breakdown.total)} pChEMBL. ${agrees ? 'The full-precision sum matches the stored prediction.' : 'The sum differs from the stored prediction; check the frozen export.'}`;
  $('#qsar-equation-terms').innerHTML = breakdown.terms.map(t => `<tr><th scope="row">${esc(t.descriptor)}</th><td>${number(t.input)}</td><td>${esc(t.units)}</td><td>${number(t.coefficient)}</td><td>${number(t.contribution)}</td></tr>`).join('');
}

function renderEquation() {
  const coefficients = data.training_coefficients || [];
  $('#qsar-equation-inspector').hidden = !coefficients.length;
  $('#qsar-equation').textContent = 'Predicted pChEMBL = ' + coefficients.map((c, i) => {
    const sign = c.coefficient < 0 ? (i ? ' − ' : '−') : (i ? ' + ' : '');
    return `${sign}${number(Math.abs(c.coefficient))}${isIntercept(c.descriptor) ? '' : ` × ${c.descriptor}`}`;
  }).join('');
  $('#qsar-inspect-compound').innerHTML = data.compounds.map(p => `<option value="${esc(p.inchikey)}">${esc(joins.get(p.inchikey)?.name ? `${joins.get(p.inchikey).name} · ${p.inchikey}` : p.inchikey)}</option>`).join('');
  $('#qsar-inspect-compound').value = (data.compounds.find(p => joins.has(p.inchikey)) || data.compounds[0]).inchikey;
  renderEquationRecord();
  $('#qsar-range-compound').innerHTML = $('#qsar-inspect-compound').innerHTML;
  $('#qsar-range-compound').value = $('#qsar-inspect-compound').value;
}

function renderRange() {
  const names = Object.keys(rangeRef || {});
  $('#qsar-range-section').hidden = !names.length;
  if (!names.length) return;
  const proxy = Object.fromEntries(Object.entries(ADMETSAR_MAP).filter(([, v]) => v).map(([k, v]) => [v, k]));
  $('#qsar-range-ref').innerHTML = names.map(n => { const r = rangeRef[n]; return `<tr><th scope="row">${esc(n)}</th>${[r.min, r.p5, r.p50, r.p95, r.max].map(v => `<td>${number(v)}</td>`).join('')}<td>${esc(proxy[n] || '—')}</td></tr>`; }).join('');
  const pop = populationRange(rangeRef, data.compounds), agree = agreement(rangeRef, data.compounds);
  const both = (agree['out|outside'] || 0) + (agree['warn|outside'] || 0);
  const flagged = data.compounds.filter(p => p.outside_domain).length;
  $('#qsar-range-pop-cap').textContent = `Training (n = ${pop.train.n}): ${pop.train.in} in, ${pop.train.warn} warning, ${pop.train.out} out. Held-out test (n = ${pop.test.n}): ${pop.test.in} in, ${pop.test.warn} warning, ${pop.test.out} out. Training compounds cannot be out of domain by construction, because they define the range. Of the ${flagged} leverage/residual-flagged compounds, ${both} also receive a range warning or out-of-domain verdict. The two checks measure different things. Unmapped admetSAR properties (nAtom, nRing) are not in this export.`;
  renderRangeVerdict();
}

function renderRangeVerdict() {
  const p = data?.compounds.find(c => c.inchikey === $('#qsar-range-compound').value);
  if (!p || !rangeRef) { $('#qsar-range-verdict').textContent = ''; return; }
  const prof = rangeProfile(rangeRef, p), name = joins.get(p.inchikey)?.name || p.inchikey;
  const off = prof.rows.filter(r => r.band !== 'in').map(r => `${r.name} ${number(r.value)} (P${fx(r.pct, 0)})`);
  $('#qsar-range-verdict').textContent = `${name} · ${p.split === 'test' ? 'held-out test' : 'training'} · ${RANGE_WORDS[prof.worst] || 'unavailable'} (${prof.counts.in} in, ${prof.counts.warn} warning, ${prof.counts.out} out)${off.length ? ` · past the 5th–95th percentile: ${off.join('; ')}` : ''}. Stored leverage flag: ${p.outside_domain ? 'outside' : 'within'}.`;
}

function drawRange() {
  if (!rangeRef || !Object.keys(rangeRef).length) return;
  const p = data.compounds.find(c => c.inchikey === $('#qsar-range-compound').value);
  const prof = rangeProfile(rangeRef, p), rowH = 30, svg = $('#qsar-range');
  const W = Math.max(280, Math.round(svg.clientWidth || 440)), H = 30 + prof.rows.length * rowH;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const left = Math.min(118, W * 0.3), right = W - 78, lo = -0.25, hi = 1.25, X = v => left + (Math.min(hi, Math.max(lo, v)) - lo) * (right - left) / (hi - lo);
  let html = [0, 0.5, 1].map(v => line(X(v), 8, X(v), H - 18, 'qsar-range-edge') + textAt(X(v), H - 4, v === 0 ? '0 · min' : v === 1 ? '1 · max' : '0.5')).join('');
  prof.rows.forEach((r, i) => {
    const y = 14 + i * rowH, m = r.marks, cy = y + 8;
    html += `<text x="${left - 8}" y="${cy + 4}" text-anchor="end">${esc(r.name)}</text>`;
    html += `<rect class="qsar-range-track" x="${X(0)}" y="${y + 2}" width="${X(1) - X(0)}" height="12" rx="3"/>`;
    html += `<rect class="qsar-range-band" x="${X(m.p5)}" y="${y + 2}" width="${X(m.p95) - X(m.p5)}" height="12"><title>${esc(r.name)} 5th–95th percentile: ${number(r.p5)} to ${number(r.p95)} (training)</title></rect>`;
    html += `<rect class="qsar-range-iqr" x="${X(m.p25)}" y="${y + 2}" width="${X(m.p75) - X(m.p25)}" height="12"/>`;
    html += line(X(m.p50), y, X(m.p50), y + 16, 'qsar-range-median');
    if (fin(r.scaled)) {
      const clipped = r.scaled < lo || r.scaled > hi, x = X(r.scaled);
      html += clipped
        ? `<path class="qsar-range-${r.band}" d="M${x} ${cy} l${r.scaled < lo ? 8 : -8} -6 v12 z"><title>${esc(r.name)} ${number(r.value)}: scaled ${fx(r.scaled, 2)}, beyond the plotted axis</title></path>`
        : `<circle class="qsar-range-${r.band}" cx="${x}" cy="${cy}" r="6"><title>${esc(r.name)} ${number(r.value)} · min–max scaled ${fx(r.scaled, 3)} · percentile ${fx(r.pct, 1)} · ${RANGE_WORDS[r.band]}</title></circle>`;
    }
    html += `<text x="${right + 6}" y="${cy + 4}" text-anchor="start">${fin(r.pct) ? `P${fx(r.pct, 0)}` : '—'} · ${r.band === 'in' ? 'in' : r.band === 'warn' ? 'warn' : 'out'}</text>`;
  });
  svg.innerHTML = html;
  $('#qsar-range-cap').textContent = `Markers show the selected compound's min–max scaled value; the right column gives its percentile rank in the training set (mid-rank) and its band. Green: within the 5th–95th percentile. Amber: past a percentile. Red: outside the training range. A triangle means the value lies beyond the plotted axis (−0.25 to 1.25).`;
}

function drawRangePopulation() {
  if (!rangeRef || !Object.keys(rangeRef).length) return;
  const svg = $('#qsar-range-pop'), W = Math.max(280, Math.round(svg.clientWidth || 440)), H = 140;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const pop = populationRange(rangeRef, data.compounds), left = 96, right = W - 16;
  let html = '';
  [['train', 'Training'], ['test', 'Held-out test']].forEach(([k, label], i) => {
    const s = pop[k], y = 18 + i * 52; let x = left;
    html += `<text x="${left - 8}" y="${y + 20}" text-anchor="end">${label}</text>`;
    for (const b of ['in', 'warn', 'out']) {
      if (!s[b]) continue;
      const w = (right - left) * s[b] / s.n;
      html += `<rect class="qsar-range-seg-${b}" x="${x}" y="${y}" width="${w}" height="30"><title>${label}: ${s[b]} of ${s.n} ${RANGE_WORDS[b].toLowerCase()} (${fx(100 * s[b] / s.n, 1)}%)</title></rect>`;
      if (w > 34) html += `<text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" class="qsar-range-seg-label">${s[b]}</text>`;
      x += w;
    }
  });
  html += textAt((left + right) / 2, H - 6, 'Share of compounds · green in · amber warning · red out');
  svg.innerHTML = html;
}

function render() {
  const t = data.target, ad = data.applicability_domain, flagged = data.compounds.filter(p => p.outside_domain).length;
  $('#qsar-title').textContent = `${t.gene || 'DRD2'} · ${t.name}`;
  $('#qsar-summary').textContent = `${t.id} · ${t.organism || 'Homo sapiens'} · UniProt ${t.uniprot} · assay ${data.assay_type} (binding) · ${data.standard_type} · ${data.n} compounds · seed ${data.seed}. All responses are median pChEMBL (−log₁₀ M).`;
  $('#qsar-verdict').textContent = data.verdict;
  $('#qsar-join').textContent = `${joins.size} of ${data.n} compounds match the existing explorer by whole InChIKey or an unambiguous PubChem CID. Unmatched compounds remain in every QSAR plot and the table. Domain colours apply to the current explorer view; grey means no matched QSAR record.`;
  $('#qsar-highlight').disabled = !joins.size;
  $('#qsar-metrics').innerHTML = metricRows({ n: data.n, seed: data.seed, ...data.metrics, applicability_domain: ad, scrambling: { real_r2: data.scrambling.real_r2, p_value: data.scrambling.p_value, shuffles: data.scrambling.r2.length } });
  const coefficients = rows => rows.map(c => `<tr><th scope="row">${esc(c.descriptor)}</th>${['coefficient', 'standard_error', 'p_value', 'vif'].map(k => `<td>${number(c[k])}</td>`).join('')}</tr>`).join('');
  $('#qsar-coefficients').innerHTML = coefficients(data.coefficients);
  $('#qsar-training-table').hidden = !data.training_coefficients?.length;
  $('#qsar-training-coefficients').innerHTML = coefficients(data.training_coefficients || []);
  $('#qsar-compound-summary').textContent = `Compounds and domain flags · ${flagged} outside of ${data.n}`;
  renderEquation();
  renderRange();
  renderCompounds();
  $('#qsar-workflow-outcome').textContent = `The frozen dataset contains ${data.n} compounds: ${data.metrics.train.n} training and ${data.metrics.test.n} held-out test compounds. The model is labelled ${data.verdict_label || 'not predictive'}; scaffold-test r² = ${fx(data.metrics.test.r2, 3)}, five-fold q² = ${fx(data.metrics.cv.q2, 3)}, and LOO q² = ${fx(data.metrics.loo.q2, 3)}. Passing the scrambling check alone does not establish predictive performance.`;
  $('#qsar-workflow-snapshot').textContent = `Frozen source: ${data.sources?.chembl_release || 'ChEMBL'} · seed ${data.seed}. The linked executed notebook records the filters, pinned software versions, assumptions and cache replay checks.`;
  $('#qsar-surface-caption').textContent = data.fit_surface?.note || 'Conditional slice of the training-only model. Other descriptors are held at training medians.';
  const exceeds = data.scrambling.r2.filter(r => r >= data.scrambling.real_r2).length;
  $('#qsar-scrambling-caption').textContent = `100 shuffled-activity refits; ${exceeds} reach or exceed the real r² (${fx(data.scrambling.real_r2, 3)}), shown by the orange line. The real r² must lie above the entire shuffled distribution for this check to pass. This is a chance-correlation check, not a held-out prediction score.`;
  $('#qsar-williams-caption').textContent = `Williams plot against the training fit: h* = 3p/n = ${fx(ad.threshold, 4)} (p = ${ad.p}, including intercept; training n = ${ad.n}). Dashed limits: h* and ±${ad.standardized_residual_limit} standardized residuals. ${flagged} compounds are outside. Filled circles: training; hollow circles: test; crosses: outside domain.`;
}

function setup(id, ratio = 0.72) {
  const svg = $(id), W = Math.max(260, Math.round(svg.clientWidth || 440)), H = Math.round(W * ratio);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  return { svg, W, H, left: 64, right: W - 16, top: 18, bottom: H - 47 };
}
function extent(values, padding = 0.06) {
  let lo = Math.min(...values), hi = Math.max(...values);
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * padding;
  return [lo - pad, hi + pad];
}
const scale = (domain, a, b) => value => a + (value - domain[0]) * (b - a) / (domain[1] - domain[0]);
const line = (x1, y1, x2, y2, kind = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${kind}"/>`;
const textAt = (x, y, text, anchor = 'middle') => `<text x="${x}" y="${y}" text-anchor="${anchor}">${esc(text)}</text>`;
function axes(box, xd, yd, xLabel, yLabel) {
  const { W, H, left, right, top, bottom } = box, X = scale(xd, left, right), Y = scale(yd, bottom, top);
  let html = '';
  for (let i = 0; i <= 4; i++) {
    const x = xd[0] + (xd[1] - xd[0]) * i / 4, y = yd[0] + (yd[1] - yd[0]) * i / 4;
    html += line(X(x), top, X(x), bottom, 'qsar-gridline') + line(left, Y(y), right, Y(y), 'qsar-gridline');
    html += textAt(X(x), bottom + 18, fx(x, 2)) + textAt(left - 7, Y(y) + 4, fx(y, 2), 'end');
  }
  html += textAt((left + right) / 2, H - 7, xLabel);
  html += `<text transform="translate(13 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
  return { X, Y, html };
}
function point(p, x, y) {
  const name = joins.get(p.inchikey)?.name || p.inchikey;
  const title = `<title>${esc(name)} · ${p.split} · ${p.outside_domain ? 'outside' : 'within'} domain; observed ${fx(p.observed)}, predicted ${fx(p.predicted)}, leverage ${fx(p.leverage, 3)}, standardized residual ${fx(p.standardized_residual)}</title>`;
  if (p.outside_domain) return `<g class="qsar-point qsar-flag">${title}${line(x - 4, y - 4, x + 4, y + 4)}${line(x - 4, y + 4, x + 4, y - 4)}</g>`;
  return `<circle class="qsar-point ${p.split === 'test' ? 'qsar-test' : 'qsar-train'}" cx="${x}" cy="${y}" r="3.3">${title}</circle>`;
}
function drawCharts() { if (!data) return; drawRange(); drawRangePopulation(); drawSurface(); drawPrediction(); drawScrambling(); drawWilliams(); }
function drawPrediction() {
  const box = setup('#qsar-prediction'), domain = extent(data.compounds.flatMap(p => [p.observed, p.predicted]));
  const { X, Y, html } = axes(box, domain, domain, 'Observed pChEMBL', 'Predicted pChEMBL');
  box.svg.innerHTML = html + line(X(domain[0]), Y(domain[0]), X(domain[1]), Y(domain[1]), 'qsar-limit') + data.compounds.map(p => point(p, X(p.observed), Y(p.predicted))).join('');
}
function drawWilliams() {
  const box = setup('#qsar-williams'), ad = data.applicability_domain;
  const xd = [0, Math.max(ad.threshold * 1.15, ...data.compounds.map(p => p.leverage)) * 1.05];
  const yd = extent([-ad.standardized_residual_limit, ad.standardized_residual_limit, ...data.compounds.map(p => p.standardized_residual)]);
  const { X, Y, html } = axes(box, xd, yd, 'Leverage', 'Standardized residual');
  box.svg.innerHTML = html + line(X(ad.threshold), box.top, X(ad.threshold), box.bottom, 'qsar-limit')
    + [-ad.standardized_residual_limit, ad.standardized_residual_limit].map(v => line(box.left, Y(v), box.right, Y(v), 'qsar-limit')).join('')
    + data.compounds.map(p => point(p, X(p.leverage), Y(p.standardized_residual))).join('');
}
function drawScrambling() {
  const box = setup('#qsar-scrambling'), real = data.scrambling.real_r2, values = data.scrambling.r2;
  const domain = extent([...values, real]), counts = Array(15).fill(0), step = (domain[1] - domain[0]) / counts.length;
  for (const v of values) counts[Math.min(counts.length - 1, Math.max(0, Math.floor((v - domain[0]) / step)))]++;
  const { X, Y, html } = axes(box, domain, [0, Math.max(...counts) + 1], 'Refitted r²', 'Shuffle count');
  box.svg.innerHTML = html + counts.map((n, i) => `<rect class="qsar-bar" x="${X(domain[0] + i * step)}" y="${Y(n)}" width="${Math.max(1, (box.right - box.left) / counts.length - 1)}" height="${box.bottom - Y(n)}"><title>${n} shuffles: r² ${fx(domain[0] + i * step, 3)} to ${fx(domain[0] + (i + 1) * step, 3)}</title></rect>`).join('')
    + line(X(real), box.top, X(real), box.bottom, 'qsar-real') + textAt(Math.min(box.right - 20, Math.max(box.left + 20, X(real))), box.top - 5, 'Real');
}
function drawSurface() {
  const box = setup('#qsar-surface'), { svg, W, H } = box, s = data.fit_surface;
  if (!s || !Array.isArray(s.x) || !Array.isArray(s.y) || !Array.isArray(s.z)
    || s.x.length < 2 || s.y.length < 2 || s.z.length !== s.y.length
    || !s.x.every(fin) || !s.y.every(fin) || !s.z.every(row => row.length === s.x.length && row.every(fin))) {
    svg.innerHTML = textAt(W / 2, H / 2, 'Fit surface is not available in this export.');
    return;
  }
  const zd = extent(s.z.flat(), 0), Z = scale(zd, 0, 1);
  // Oblique projection with a generous depth component: the DRD2 slice must not collapse to an edge-on line.
  const project = (x, y, z) => [W * (0.18 + 0.56 * x + 0.18 * y), H * (0.83 - 0.32 * Z(z) - 0.38 * y + 0.04 * x)];
  let html = '';
  for (let j = s.y.length - 2; j >= 0; j--) for (let i = 0; i < s.x.length - 1; i++) {
    const coords = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    const polygon = coords.map(([a, b]) => project(a / (s.x.length - 1), b / (s.y.length - 1), s.z[b][a]).join(',')).join(' ');
    html += `<polygon points="${polygon}" class="qsar-surface-cell"><title>${esc(s.x_descriptor)} ${fx(s.x[i])}; ${esc(s.y_descriptor)} ${fx(s.y[j])}; predicted pChEMBL ${fx(s.z[j][i])}</title></polygon>`;
  }
  const origin = project(0, 0, zd[0]), xEnd = project(1, 0, zd[0]), yEnd = project(0, 1, zd[0]), zEnd = project(0, 0, zd[1]);
  for (const end of [xEnd, yEnd, zEnd]) html += line(...origin, ...end, 'qsar-axis');
  html += textAt(W * 0.46, H * 0.91, `${s.x_descriptor} (${fx(s.x[0], 1)}–${fx(s.x.at(-1), 1)})`);
  html += textAt(W * 0.50, H - 5, `${s.y_descriptor} (${fx(s.y[0], 1)}–${fx(s.y.at(-1), 1)}) ↗`);
  html += `<text transform="translate(13 ${H * 0.48}) rotate(-90)" text-anchor="middle">Predicted pChEMBL</text>`;
  html += textAt(origin[0] - 5, origin[1] + 4, fx(zd[0], 1), 'end') + textAt(zEnd[0] - 5, zEnd[1] + 4, fx(zd[1], 1), 'end');
  svg.innerHTML = html;
  const fixed = Object.entries(s.fixed || {}).map(([key, value]) => `${key} = ${number(value)}`).join('; ');
  $('#qsar-surface-caption').textContent = `${s.note || 'Conditional slice of the training-only model.'}${fixed ? ` Fixed training medians: ${fixed}.` : ''}`;
}
