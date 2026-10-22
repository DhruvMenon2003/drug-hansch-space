// A lazy, native dialog on the existing explorer. Reads the notebook's frozen export; never fits a model in the browser.
import { app, bus, $, esc, fin, fx } from './kernel.js';
import { selectDrug } from './view.js';

const DATA_URL = 'data/qsar_drd2.json';
let data = null, pending = null, wired = false;
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
  $('#qsar-compounds').addEventListener('click', e => {
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
  $('#qsar-compounds').innerHTML = data.compounds.map(p => {
    const d = joins.get(p.inchikey), identity = d ? `<button type="button" class="ghost" data-cid="${d.cid}">${esc(d.name)}</button><br>` : '';
    return `<tr${p.outside_domain ? ' class="qsar-outside"' : ''}><th scope="row">${identity}<span class="mono">${esc(p.inchikey)}</span></th><td>${esc(p.split)}</td><td>${number(p.observed)}</td><td>${number(p.predicted)}</td><td>${number(p.leverage)}</td><td>${number(p.standardized_residual)}</td><td>${p.outside_domain ? 'Outside' : 'Within'}</td></tr>`;
  }).join('');
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
function drawCharts() { if (!data) return; drawSurface(); drawPrediction(); drawScrambling(); drawWilliams(); }
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
