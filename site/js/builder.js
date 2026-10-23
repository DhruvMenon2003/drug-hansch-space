// The all-target QSAR builder: a lazy dialog on the existing explorer that walks the OECD workflow on a cleaned
// ChEMBL dataset (tools/build_qsar_targets.py). Data, outliers, split, MLR model, applicability domain, recipe export.
import { $, esc, fin, fx, getSide } from './kernel.js';
import { BANDS, band, distribution } from './domain.js';
import { MARKS, baseline, chainSummary, classify, gateChain, verdict } from './gates.js';

export { verdict };

const INDEX_URL = 'data/qsar/index.json';
const COLS = { y: 'pActivity', logp: 'log P (Crippen)', mr: 'Molar refractivity', tpsa: 'TPSA (Å²)', mw: 'Molecular weight',
  hbd: 'H-bond donors', hba: 'H-bond acceptors', rotb: 'Rotatable bonds', arom: 'Aromatic rings', fsp3: 'Fsp3',
  heavy: 'Heavy atoms', logp2: 'log P²' };
const DEFAULT_X = ['logp', 'logp2', 'mr'];
const TABS = ['data', 'out', 'split', 'model', 'ad'];
let index = null, set = null, wired = false, last = null;
const ui = { x: new Set(DEFAULT_X) };

// ---------------------------------------------------------------- pure numerics (unit-tested)
/** Seeded PRNG (mulberry32): the same seed gives the same split and the same shuffles. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(list, rand) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
const mean = v => v.reduce((s, x) => s + x, 0) / v.length;
const ss = (v, m = mean(v)) => v.reduce((s, x) => s + (x - m) ** 2, 0);

/** Solve A x = b by Gaussian elimination with partial pivoting; null when singular. */
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-10) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
function invert(A) {
  const n = A.length, cols = [];
  for (let j = 0; j < n; j++) { const e = Array(n).fill(0); e[j] = 1; const c = solve(A, e); if (!c) return null; cols.push(c); }
  return A.map((_, i) => cols.map(c => c[i]));
}

/**
 * Ordinary least squares with an intercept. X is rows of descriptor values. Returns coefficients (intercept first),
 * fitted values, leverages, LOO predictions (closed form e/(1-h)), and the (XᵀX)⁻¹ needed to score new compounds.
 */
export function ols(X, y) {
  const n = y.length, p = X[0].length + 1, D = X.map(r => [1, ...r]);
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => D.reduce((s, r) => s + r[i] * r[j], 0)));
  const inv = invert(XtX);
  if (!inv || n <= p) return null;
  const beta = inv.map(row => row.reduce((s, v, j) => s + v * D.reduce((t, r, k) => t + r[j] * y[k], 0), 0));
  const fit = D.map(r => r.reduce((s, v, j) => s + v * beta[j], 0));
  const lev = D.map(r => r.reduce((s, v, i) => s + v * r.reduce((t, w, j) => t + inv[i][j] * w, 0), 0));
  const loo = y.map((v, i) => v - (v - fit[i]) / (1 - lev[i]));
  const s = Math.sqrt(y.reduce((t, v, i) => t + (v - fit[i]) ** 2, 0) / (n - p));
  return { beta, fit, lev, loo, inv, s, p: p - 1 };
}
export function predict(beta, row) { return beta[0] + row.reduce((s, v, j) => s + v * beta[j + 1], 0); }
export function leverage(inv, row) { const r = [1, ...row]; return r.reduce((s, v, i) => s + v * r.reduce((t, w, j) => t + inv[i][j] * w, 0), 0); }

/** r² of observed against predicted (1 − SSres/SStot). With `ref` the mean is the training mean (R²pred / Q²ext). */
export function r2(obs, pred, ref = mean(obs)) { return 1 - obs.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0) / ss(obs, ref); }

/** Roy's r²m pair: average and Δ of r²m computed with observed and predicted on each axis. */
export function rm2(obs, pred) {
  const corr2 = (a, b) => { const ma = mean(a), mb = mean(b); const c = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0); return c * c / (ss(a, ma) * ss(b, mb)); };
  const r0 = (a, b) => { const k = a.reduce((s, v, i) => s + v * b[i], 0) / b.reduce((s, v) => s + v * v, 0); return 1 - a.reduce((s, v, i) => s + (v - k * b[i]) ** 2, 0) / ss(a); };
  const R = corr2(obs, pred), m1 = R * (1 - Math.sqrt(Math.abs(R - r0(obs, pred)))), m2 = R * (1 - Math.sqrt(Math.abs(R - r0(pred, obs))));
  return { avg: (m1 + m2) / 2, delta: Math.abs(m1 - m2) };
}

/** Kennard–Stone: pick `k` training rows that span descriptor space (on z-scores); the rest are test. */
export function kennardStone(Z, k) {
  const n = Z.length, d = (a, b) => Z[a].reduce((s, v, j) => s + (v - Z[b][j]) ** 2, 0);
  let best = [0, 1, -1];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const v = d(i, j); if (v > best[2]) best = [i, j, v]; }
  const chosen = [best[0], best[1]], min = Array.from({ length: n }, (_, i) => Math.min(d(i, best[0]), d(i, best[1])));
  while (chosen.length < k) {
    let pick = -1;
    for (let i = 0; i < n; i++) if (!chosen.includes(i) && (pick < 0 || min[i] > min[pick])) pick = i;
    chosen.push(pick);
    for (let i = 0; i < n; i++) min[i] = Math.min(min[i], d(i, pick));
  }
  return new Set(chosen);
}

/**
 * Spread of each prediction over `B` ordinary-least-squares refits on bootstrap resamples of the training rows: the
 * uncertainty an ensemble reports, which a single fit's R² hides. Returns one SD per row of `newX` (NaN when the
 * resamples were too degenerate to fit).
 */
export function bootstrapSd(X, y, newX, seed, B = 40) {
  if (!newX.length || y.length < 6) return newX.map(() => NaN);
  const rand = rng(seed), draws = newX.map(() => []);
  for (let b = 0; b < B; b++) {
    const pick = y.map(() => Math.floor(rand() * y.length));
    const f = ols(pick.map(i => X[i]), pick.map(i => y[i]));
    if (!f) continue;
    newX.forEach((r, j) => draws[j].push(predict(f.beta, r)));
  }
  return draws.map(v => {
    if (v.length < 5) return NaN;
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
  });
}

/**
 * The percentile bounding box of this run (admetSAR 3.0's basic-property view, used here as an applicability-domain
 * rule): the training distribution of each descriptor, and which band every held-out compound falls in — inside the
 * 5th–95th percentile, past a percentile, or outside the observed range altogether.
 */
export function boxOf(data, res, keys = res.xs) {
  if (!keys?.length || !res.train?.length) return null;
  const dists = keys.map(k => distribution(res.train.map(i => value(data.compounds[i], k))));
  const per = new Map(res.test.map(i => [i, keys.map((k, j) => band(dists[j], value(data.compounds[i], k)))]));
  const counts = { in: 0, warn: 0, out: 0 };
  for (const bands of per.values()) for (const b of bands) if (b) counts[b]++;
  const rows = keys.map((k, j) => {
    const bands = [...per.values()].map(b => b[j]);
    return { key: k, dist: dists[j], warn: bands.filter(b => b === 'warn').length, out: bands.filter(b => b === 'out').length };
  });
  return { keys, rows, per, counts, worst: counts.out ? 'out' : counts.warn ? 'warn' : counts.in ? 'in' : null };
}

/** Lipinski violations of one compound, counted from the descriptors the file carries. */
export function ro5Count(c) { return (c.mw > 500) + (c.logp > 5) + (c.hbd > 5) + (c.hba > 10); }

export const value = (c, key) => (key === 'logp2' ? c.logp * c.logp : c[key]);

/** Checkpoint 3 filter: which compounds the chosen rules remove (rule violators, then members of activity cliffs). */
export function removed(data, opts) {
  const out = new Set();
  data.compounds.forEach((c, i) => { if (c.rules.some(r => opts[r])) out.add(i); });
  if (opts.cliff) for (const [a, b] of data.cliffs) { out.add(a); out.add(b); }
  return out;
}

/** Train/test assignment for the kept compounds `idx` (indices into data.compounds). */
export function split(data, idx, method, share, seed, xs) {
  const nTest = Math.max(1, Math.round(idx.length * share));
  if (method === 'ks') {
    const cols = xs.map(k => { const v = idx.map(i => value(data.compounds[i], k)), m = mean(v), sd = Math.sqrt(ss(v, m) / v.length) || 1; return x => (x - m) / sd; });
    const Z = idx.map(i => xs.map((k, j) => cols[j](value(data.compounds[i], k))));
    const train = kennardStone(Z, idx.length - nTest);
    return { train: idx.filter((_, j) => train.has(j)), test: idx.filter((_, j) => !train.has(j)) };
  }
  const rand = rng(seed);
  // A series split is the harder test: whole scaffolds (or whole fingerprint clusters) are held out, so the model has to
  // extrapolate to a skeleton it has never seen. 'scaffold' falls back to the cluster split for a file without scaffolds.
  if (method === 'cluster' || method === 'scaffold') {
    const key = method === 'scaffold' && idx.some(i => data.compounds[i].sc != null) ? 'sc' : 'cl';
    const byCl = new Map();
    for (const i of idx) { const k = data.compounds[i][key]; if (!byCl.has(k)) byCl.set(k, []); byCl.get(k).push(i); }
    const test = [];
    for (const k of shuffle([...byCl.keys()].sort((a, b) => a - b), rand)) { if (test.length >= nTest) break; test.push(...byCl.get(k)); }
    const t = new Set(test);
    return { train: idx.filter(i => !t.has(i)), test };
  }
  const order = shuffle(idx, rand), t = new Set(order.slice(0, nTest));
  return { train: idx.filter(i => !t.has(i)), test: idx.filter(i => t.has(i)) };
}

/** Run the whole model step: fit, LOO, y-randomisation, external validation and the applicability domain. */
export function runModel(data, opts) {
  const drop = removed(data, opts), kept = data.compounds.map((_, i) => i).filter(i => !drop.has(i));
  const xs = opts.xs.filter(k => k in COLS && k !== 'y');
  const { train, test } = split(data, kept, opts.method, opts.share, opts.seed, xs.length ? xs : ['logp']);
  const row = i => xs.map(k => value(data.compounds[i], k)), yOf = i => data.compounds[i].y;
  const base = { kept: kept.length, dropped: drop.size, train, test, xs };
  if (!xs.length) return { ...base, error: 'Pick at least one descriptor.' };
  if (xs.length > Math.floor(train.length / 5)) return { ...base, error: `Too many descriptors: ${train.length} training compounds allow at most ${Math.floor(train.length / 5)}.` };
  const y = train.map(yOf), m = ols(train.map(row), y);
  if (!m) return { ...base, error: 'The descriptors are collinear; drop one.' };
  const rand = rng(opts.seed + 1), rnd = [];
  for (let k = 0; k < 100; k++) { const ys = shuffle(y, rand), f = ols(train.map(row), ys); if (f) rnd.push(r2(ys, f.fit)); }
  const R2 = r2(y, m.fit), rr = mean(rnd), yt = test.map(yOf), pt = test.map(i => predict(m.beta, row(i)));
  const yMean = mean(y), sres = i => (yOf(i) - predict(m.beta, row(i))) / m.s, hstar = 3 * (xs.length + 1) / train.length;
  const points = [...train.map((i, k) => ({ i, set: 'train', obs: y[k], pred: m.fit[k], h: m.lev[k] })),
    ...test.map((i, k) => ({ i, set: 'test', obs: yt[k], pred: pt[k], h: leverage(m.inv, row(i)) }))]
    .map(p => ({ ...p, r: sres(p.i), out: p.h > hstar || Math.abs(sres(p.i)) > 3 }));
  const looRm = rm2(y, m.loo), extRm = test.length > 2 ? rm2(yt, pt) : { avg: NaN, delta: NaN };
  const sd = bootstrapSd(train.map(row), y, test.map(row), opts.seed + 7);
  test.forEach((i, k) => { const p = points.find(q => q.i === i && q.set === 'test'); if (p) p.sd = sd[k]; });
  return { ...base, beta: m.beta, s: m.s, hstar, points, rnd, trainMean: yMean,
    metrics: { r2: R2, q2: r2(y, m.loo), rm2loo: looRm.avg, drm2loo: looRm.delta, crp2: Math.sqrt(R2) * Math.sqrt(Math.max(0, R2 - rr)),
      r2pred: test.length > 1 ? r2(yt, pt, yMean) : NaN, rm2test: extRm.avg, drm2test: extRm.delta,
      rmse: Math.sqrt(y.reduce((s, v, i) => s + (v - m.fit[i]) ** 2, 0) / y.length),
      rmsep: test.length ? Math.sqrt(yt.reduce((s, v, i) => s + (v - pt[i]) ** 2, 0) / yt.length) : NaN } };
}

/** The files are column-wise (tools/build_qsar_targets.py columns()); rebuild one object per compound, once. */
const RULES = ['Ro5', 'Ro3', 'Pfizer'];
export function withRows(data) {
  if (data.compounds) return data;
  const c = data.cols;
  data.compounds = c.id.map((id, i) => {
    const row = { id: `CHEMBL${id}`, rules: RULES.filter((_, b) => c.rules[i] & (1 << b)) };
    for (const k of ['y', 'nm', ...data.descriptors, 'cl']) row[k] = c[k][i];
    if (c.sc) row.sc = c.sc[i];                 // Bemis–Murcko family index (tools/add_scaffolds.py); absent in older files
    return row;
  });
  return data;
}

// ---------------------------------------------------------------- dialog
export async function openBuilder() {
  wire();
  const dialog = $('#qsb-dialog');
  if (!dialog.open) dialog.showModal();
  if (index) return;
  try {
    index = await getSide(INDEX_URL);
    const usable = index.targets.filter(t => t.file);
    $('#qsb-target').innerHTML = usable.map(t => `<option value="${esc(t.id)}">${esc(t.name)} · ${esc(t.id)} · ${t.n} compounds, ${esc(t.type)}</option>`).join('');
    $('#qsb-status').textContent = `${usable.length} of ${index.targets.length} explorer targets have at least ${index.min_n} clean compounds.`;
    $('#qsb-body').hidden = false;
    await loadTarget(usable[0]?.id);
  } catch (err) {
    index = null;
    $('#qsb-status').textContent = `The target list could not load (${err.message}). Close and try again.`;
  }
}
async function loadTarget(id) {
  const meta = index.targets.find(t => t.id === id);
  if (!meta) return;
  $('#qsb-status').textContent = `Loading ${meta.name}…`;
  set = withRows(await getSide(meta.file));
  $('#qsb-status').textContent = '';
  const L = set.ledger;
  $('#qsb-summary').textContent = `${set.target.name} (${set.target.id}): ${set.n} compounds, p${set.standard_type}${set.capped ? `, a seeded draw of ${set.n} from ${set.n_clean} clean compounds` : ''}. Explorer drugs acting here: ${set.explorer_drugs.length}.`;
  $('#qsb-ledger').innerHTML = [['ChEMBL activity rows (binding, exact, pChEMBL)', L.rows], ['Dropped: ChEMBL validity comment', L['validity comment']],
    ['Dropped: unparseable structure', L.unparseable], ['Dropped: metal or inorganic', L['inorganic or metal']],
    ['Merged duplicate measurements', L['duplicates merged']], ['Dropped: replicates spread > 1 log unit', L['spread > 1 log unit']],
    ['Clean compounds', set.n_clean], ['Used here', set.n]].map(([a, b]) => `<tr><td>${esc(a)}</td><td>${b}</td></tr>`).join('');
  const count = r => set.compounds.filter(c => c.rules.includes(r)).length;
  $('#qsb-n-ro5').textContent = `Ro5 violators (${count('Ro5')})`;
  $('#qsb-n-pfizer').textContent = `Pfizer 3/75 risk (${count('Pfizer')})`;
  $('#qsb-n-ro3').textContent = `Ro3 violators (${count('Ro3')})`;
  $('#qsb-n-cliff').textContent = `Activity-cliff members (${new Set(set.cliffs.flatMap(c => c.slice(0, 2))).size}, ${set.cliffs.length} pairs)`;
  $('#qsb-cliffs').innerHTML = set.cliffs.slice(0, 50).map(([a, b, s, g]) => `<tr><td>${esc(set.compounds[a].id)} / ${esc(set.compounds[b].id)}</td><td>${fx(s)}</td><td>${fx(g)}</td></tr>`).join('')
    || '<tr><td colspan="3">No activity cliffs in this set.</td></tr>';
  drawColumn();
  drawRo5();
  drawScaffolds();
  refresh();
}
function opts() {
  return { Ro5: $('#qsb-r-ro5').checked, Pfizer: $('#qsb-r-pfizer').checked, Ro3: $('#qsb-r-ro3').checked, cliff: $('#qsb-r-cliff').checked,
    method: $('#qsb-split').value, share: +$('#qsb-test').value, seed: Math.max(0, Math.floor(+$('#qsb-seed').value || 0)),
    cut: +$('#qsb-cut').value, xs: [...ui.x] };
}
function refresh() {
  if (!set) return;
  const o = opts(), res = runModel(set, o);
  last = { o, res };
  $('#qsb-kept').textContent = `${res.kept} compounds kept, ${res.dropped} removed.`;
  $('#qsb-split-note').textContent = `${res.train.length} training and ${res.test.length} test compounds.`;
  if (res.error) {
    $('#qsb-eq').textContent = res.error;
    $('#qsb-metrics').innerHTML = '';
    for (const id of ['#qsb-pred', '#qsb-yrand', '#qsb-will', '#qsb-box', '#qsb-classes', '#qsb-test-rows']) $(id).innerHTML = '';
    for (const id of ['#qsb-will-cap', '#qsb-box-cap', '#qsb-test-cap', '#qsb-class-note', '#qsb-baseline']) $(id).textContent = '';
    drawGates(res, null, null);
    return;
  }
  const label = k => (k === 'logp2' ? 'logP²' : k);
  $('#qsb-eq').textContent = `p${set.standard_type} = ${fx(res.beta[0], 3)} ` + res.xs.map((k, j) => `${res.beta[j + 1] < 0 ? '−' : '+'} ${fx(Math.abs(res.beta[j + 1]), 3)}·${label(k)}`).join(' ') + `   (n = ${res.train.length}, s = ${fx(res.s, 3)})`;
  $('#qsb-metrics').innerHTML = MARKS.map(([k, name, mark, ok]) => {
    const v = res.metrics[k], good = ok && fin(v) ? ok(v) : null;
    return `<tr><td>${esc(name)}</td><td>${fin(v) ? fx(v, 3) : '—'}</td><td>${esc(mark)}</td><td class="${good == null ? '' : good ? 'qsb-pass' : 'qsb-fail'}">${good == null ? '' : good ? 'Pass' : 'Fail'}</td></tr>`;
  }).join('');
  const v = verdict(res.metrics);
  $('#qsb-yrand-cap').textContent = `${res.rnd.length} refits on shuffled activity. Real R² ${fx(res.metrics.r2, 3)}. ${v.pass ? 'Every OECD pass mark is met.' : `Not acceptable yet: ${v.failed.join(', ')}. Go back and change the data, split or descriptors.`}`;
  const outside = res.points.filter(p => p.out).length;
  $('#qsb-will-cap').textContent = `h* = ${fx(res.hstar, 3)}. ${outside} of ${res.points.length} compounds fall outside the domain (crosses); predictions for them are unreliable.`;
  const b = baseline(res);
  $('#qsb-baseline').textContent = fin(b.rmse)
    ? `Against the baseline: predicting the training mean (${fx(b.mean)}) for every held-out compound gives RMSE ${fx(b.rmse)}; this model gives ${fx(b.model)}. ${b.beats ? `That is ${fx((1 - b.ratio) * 100, 0)}% better than the baseline.` : 'The model is no better than the mean, so it predicts nothing.'}`
    : 'No held-out compounds, so there is no baseline to beat.';
  const box = boxOf(set, res), cls = drawClasses(res, o.cut);
  drawPred(res); drawYrand(res); drawWilliams(res); drawDomain(res, box); drawGates(res, box, cls);
}

// ---------------------------------------------------------------- charts (plain SVG, same classes as js/qsar.js)
function frame(sel, xd, yd, xl, yl) {
  const svg = $(sel), W = 420, H = 260, L = 48, R = W - 12, T = 12, B = H - 36;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const X = v => L + (v - xd[0]) / (xd[1] - xd[0] || 1) * (R - L), Y = v => B - (v - yd[0]) / (yd[1] - yd[0] || 1) * (B - T);
  let html = `<line class="qsar-gridline" x1="${L}" y1="${B}" x2="${R}" y2="${B}"/><line class="qsar-gridline" x1="${L}" y1="${T}" x2="${L}" y2="${B}"/>`;
  for (const t of [0, 0.5, 1]) {
    const xv = xd[0] + t * (xd[1] - xd[0]), yv = yd[0] + t * (yd[1] - yd[0]);
    html += `<text x="${X(xv)}" y="${B + 14}" text-anchor="middle">${fx(xv, 1)}</text><text x="${L - 4}" y="${Y(yv) + 4}" text-anchor="end">${fx(yv, 1)}</text>`;
  }
  html += `<text x="${(L + R) / 2}" y="${H - 4}" text-anchor="middle">${esc(xl)}</text><text transform="translate(12 ${(T + B) / 2}) rotate(-90)" text-anchor="middle">${esc(yl)}</text>`;
  return { svg, X, Y, html, L, R, T, B };
}
const ext = (v, pad = 0.05) => { const lo = Math.min(...v), hi = Math.max(...v), d = (hi - lo) || 1; return [lo - d * pad, hi + d * pad]; };
const dash = (x1, y1, x2, y2) => `<line class="qsar-limit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
function drawColumn() {
  const key = $('#qsb-col').value || 'y', vals = set.compounds.map(c => value(c, key)).filter(fin), bins = 14;
  const [lo, hi] = ext(vals, 0), step = (hi - lo) / bins || 1, counts = Array(bins).fill(0);
  for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - lo) / step))]++;
  const f = frame('#qsb-hist', [lo, hi], [0, Math.max(...counts)], COLS[key], 'Compounds');
  f.svg.innerHTML = f.html + counts.map((n, i) => `<rect class="qsar-bar" x="${f.X(lo + i * step)}" y="${f.Y(n)}" width="${Math.max(1, (f.R - f.L) / bins - 1)}" height="${f.B - f.Y(n)}"><title>${n} compounds, ${fx(lo + i * step)}–${fx(lo + (i + 1) * step)}</title></rect>`).join('');
  const m = mean(vals), sd = Math.sqrt(ss(vals, m) / vals.length), sorted = vals.slice().sort((a, b) => a - b);
  $('#qsb-hist-cap').textContent = `${COLS[key]}: n ${vals.length}, mean ${fx(m)}, SD ${fx(sd)}, median ${fx(sorted[sorted.length >> 1])}, range ${fx(sorted[0])}–${fx(sorted.at(-1))}.`;
  const g = frame('#qsb-scatter', ext(set.compounds.map(c => value(c, key))), ext(set.compounds.map(c => c.y)), COLS[key], `p${set.standard_type}`);
  g.svg.innerHTML = g.html + set.compounds.map(c => `<circle class="qsar-point qsar-train" cx="${g.X(value(c, key))}" cy="${g.Y(c.y)}" r="2.6"><title>${esc(c.id)}: ${fx(value(c, key))}, p${set.standard_type} ${fx(c.y)}</title></circle>`).join('');
  $('#qsb-scatter-cap').textContent = `Each point is one compound. Rule flags and clusters are on the Outliers step.`;
}
const dot = (p, x, y) => p.out
  ? `<g class="qsar-point qsar-flag"><title>${esc(set.compounds[p.i].id)} · ${p.set} · outside domain</title><line x1="${x - 4}" y1="${y - 4}" x2="${x + 4}" y2="${y + 4}"/><line x1="${x - 4}" y1="${y + 4}" x2="${x + 4}" y2="${y - 4}"/></g>`
  : `<circle class="qsar-point ${p.set === 'test' ? 'qsar-test' : 'qsar-train'}" cx="${x}" cy="${y}" r="3"><title>${esc(set.compounds[p.i].id)} · ${p.set}: observed ${fx(p.obs)}, predicted ${fx(p.pred)}</title></circle>`;
function drawPred(res) {
  const d = ext(res.points.flatMap(p => [p.obs, p.pred])), f = frame('#qsb-pred', d, d, 'Observed', 'Predicted');
  f.svg.innerHTML = f.html + dash(f.X(d[0]), f.Y(d[0]), f.X(d[1]), f.Y(d[1])) + res.points.map(p => dot({ ...p, out: false }, f.X(p.obs), f.Y(p.pred))).join('');
}
function drawYrand(res) {
  const d = ext([...res.rnd, res.metrics.r2]), bins = 15, step = (d[1] - d[0]) / bins, counts = Array(bins).fill(0);
  for (const v of res.rnd) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - d[0]) / step)))]++;
  const f = frame('#qsb-yrand', d, [0, Math.max(...counts) + 1], 'R²', 'Shuffles');
  f.svg.innerHTML = f.html + counts.map((n, i) => `<rect class="qsar-bar" x="${f.X(d[0] + i * step)}" y="${f.Y(n)}" width="${Math.max(1, (f.R - f.L) / bins - 1)}" height="${f.B - f.Y(n)}"/>`).join('')
    + `<line class="qsar-real" x1="${f.X(res.metrics.r2)}" y1="${f.T}" x2="${f.X(res.metrics.r2)}" y2="${f.B}"/>`;
}
function drawWilliams(res) {
  const xd = [0, Math.max(res.hstar * 1.2, ...res.points.map(p => p.h)) * 1.05], yd = ext([-3.5, 3.5, ...res.points.map(p => p.r)]);
  const f = frame('#qsb-will', xd, yd, 'Leverage h', 'Standardized residual');
  f.svg.innerHTML = f.html + dash(f.X(res.hstar), f.T, f.X(res.hstar), f.B) + dash(f.L, f.Y(3), f.R, f.Y(3)) + dash(f.L, f.Y(-3), f.R, f.Y(-3))
    + res.points.map(p => dot(p, f.X(p.h), f.Y(p.r))).join('');
}

// ---------------------------------------------------------------- the gate chain (the workflow flowchart)
const VERDICT = { yes: 'Yes', no: 'No', ask: 'Your call', wait: 'Waiting' };
function drawGates(res, box, cls) {
  const gates = gateChain({ set, o: last.o, res, box, cls }), sum = chainSummary(gates);
  $('#qsb-flow').innerHTML = gates.map(g =>
    `<button type="button" class="gate-chip gate-${g.status}" data-tab="${g.tab}" aria-describedby="qsb-gates-sum">
       <span class="gate-id">${g.id}</span><span class="gate-name">${esc(g.title)}</span><span class="gate-verdict">${VERDICT[g.status]}</span>
     </button>`).join('<span class="gate-arrow" aria-hidden="true">›</span>');
  $('#qsb-gates').innerHTML = gates.map(g => `<article class="gate gate-${g.status}">
      <h3>${g.id} ${esc(g.title)} <span class="gate-verdict">${VERDICT[g.status]}</span></h3>
      <p class="gate-q">${esc(g.question)}</p>
      <ul class="gate-ev">${g.evidence.filter(Boolean).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
      ${g.status === 'yes' ? '' : `<p class="gate-fix">${g.status === 'ask' ? 'Your judgement: ' : 'To get to Yes: '}${esc(g.remedy)}</p>`}
    </article>`).join('');
  $('#qsb-gates-sum').textContent = sum.text;
}
function showTab(name) {
  for (const other of TABS) {
    $(`#qsb-t-${other}`).setAttribute('aria-selected', String(other === name));
    $(`#qsb-p-${other}`).hidden = other !== name;
  }
}

// ---------------------------------------------------------------- the three added views (rules, scaffolds, classes, domain)
/** Rule-of-five compliance as a bar per violation count, with the mean donor and acceptor counts under it. */
function drawRo5() {
  const counts = [0, 0, 0, 0, 0];
  for (const c of set.compounds) counts[ro5Count(c)]++;
  const f = frame('#qsb-ro5', [-0.5, 4.5], [0, Math.max(...counts)], 'Lipinski violations', 'Compounds');
  const w = (f.R - f.L) / 5;
  $('#qsb-ro5').innerHTML = f.html + counts.map((n, i) => `<rect class="qsar-bar" x="${f.X(i - 0.4)}" y="${f.Y(n)}" width="${Math.max(1, w * 0.8)}" height="${f.B - f.Y(n)}"><title>${n} compounds with ${i} violation${i === 1 ? '' : 's'}</title></rect>`).join('');
  const avg = k => mean(set.compounds.map(c => c[k]).filter(fin));
  $('#qsb-ro5-cap').textContent = `${counts[0]} of ${set.compounds.length} compounds break no rule of five; mean donors ${fx(avg('hbd'), 1)}, mean acceptors ${fx(avg('hba'), 1)}, mean MW ${fx(avg('mw'), 0)}.`;
}

/** The scaffold families of this set, largest first, each with the compound that represents it (median activity). */
function drawScaffolds() {
  const fams = set.scaffolds || [], body = $('#qsb-scaf');
  if (!fams.length) {
    body.innerHTML = '<tr><td colspan="3">This target file carries no scaffolds; rebuild it with tools/add_scaffolds.py.</td></tr>';
    $('#qsb-scaf-cap').textContent = '';
    return;
  }
  const mem = new Map();
  set.compounds.forEach((c, i) => { if (c.sc != null) { if (!mem.has(c.sc)) mem.set(c.sc, []); mem.get(c.sc).push(i); } });
  const shared = fams.filter(f => (mem.get(f.i) || []).length > 1);
  body.innerHTML = (shared.length ? shared : fams).slice(0, 8).map(f => {
    const list = (mem.get(f.i) || []).slice().sort((a, b) => set.compounds[a].y - set.compounds[b].y);
    const rep = list[list.length >> 1];
    return `<tr><td class="mono">${esc(f.smiles || '—')}</td><td>${list.length}</td><td>${rep == null ? '—' : `${esc(set.compounds[rep].id)} (p${esc(set.standard_type)} ${fx(set.compounds[rep].y)})`}</td></tr>`;
  }).join('');
  const singles = fams.length - shared.length;
  $('#qsb-scaf-cap').textContent = `${fams.length} Bemis–Murcko framework${fams.length === 1 ? '' : 's'} over ${set.compounds.length} compounds: ${shared.length} shared by two or more, ${singles} carried by one compound. A scaffold split holds whole families out.`;
}

/** Active and inactive at the cut-off: the confusion matrix of the regression's held-out predictions. */
function drawClasses(res, cut) {
  const c = classify(res.points, cut, 'test');
  $('#qsb-classes').innerHTML = `<tr><th scope="row">Observed active</th><td>${c.tp}</td><td>${c.fn}</td></tr>
    <tr><th scope="row">Observed inactive</th><td>${c.fp}</td><td>${c.tn}</td></tr>`;
  $('#qsb-class-note').textContent = c.n
    ? `At p${set.standard_type} ≥ ${fx(cut, 1)}: ${c.actives} of the ${c.n} held-out compounds are active. Accuracy ${fx(c.acc * 100, 0)}%, sensitivity ${fin(c.sens) ? fx(c.sens * 100, 0) + '%' : '—'}, specificity ${fin(c.spec) ? fx(c.spec * 100, 0) + '%' : '—'}. The regression is the model; this is only another way of reading it.`
    : 'No held-out compounds to classify.';
  return c;
}

/** The percentile box table, and the held-out compounds with their bootstrap spread and their band. */
function drawDomain(res, box) {
  const body = $('#qsb-box');
  if (!box) { body.innerHTML = ''; $('#qsb-box-cap').textContent = ''; $('#qsb-test-rows').innerHTML = ''; return; }
  body.innerHTML = box.rows.map(r => `<tr><td>${esc(COLS[r.key] || r.key)}</td><td>${fx(r.dist.p5)}</td><td>${fx(r.dist.p95)}</td><td class="${r.out ? 'qsb-fail' : ''}">${r.warn + r.out ? `${r.warn} past a percentile${r.out ? `, ${r.out} out of range` : ''}` : 'none'}</td></tr>`).join('');
  $('#qsb-box-cap').textContent = `Over the ${res.train.length} training compounds. ${box.counts.in} descriptor values of the held-out compounds are inside the 5th–95th percentile, ${box.counts.warn} past a percentile, ${box.counts.out} outside the training range. Green, amber and red follow admetSAR 3.0's bands.`;
  const worstOf = i => { const b = box.per.get(i) || []; return b.includes('out') ? 'out' : b.includes('warn') ? 'warn' : 'in'; };
  $('#qsb-test-rows').innerHTML = res.points.filter(p => p.set === 'test').map(p => {
    const w = worstOf(p.i);
    return `<tr><td>${esc(set.compounds[p.i].id)}</td><td>${fx(p.obs)}</td><td>${fx(p.pred)}${fin(p.sd) ? ` ± ${fx(p.sd)}` : ''}</td><td class="${p.h > res.hstar ? 'qsb-fail' : ''}">${fx(p.h, 3)}</td><td><span class="pct pct-${w}" title="${esc(BANDS[w])}">${w === 'in' ? 'inside' : w === 'warn' ? 'warning' : 'outside'}</span></td></tr>`;
  }).join('') || '<tr><td colspan="5">No held-out compounds.</td></tr>';
  $('#qsb-test-cap').textContent = `Predicted ± the spread over 40 refits on bootstrap resamples of the training set. A wide spread, a leverage above h* or a red band all mean the same thing: that prediction is not supported.`;
}

// ---------------------------------------------------------------- recipe export
/** FNV-1a over the compound table: identifies the exact data the recipe was built from. */
export function fingerprint(compounds) {
  let h = 0x811c9dc5;
  for (const ch of compounds.map(c => `${c.id}:${c.y}`).join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
function exportRecipe() {
  if (!last || !set) return;
  const { o, res } = last, ids = list => list.map(i => set.compounds[i].id);
  const recipe = { schema_version: 1, tool: 'drug-hansch-space QSAR builder', target: set.target, file: index.targets.find(t => t.id === set.target.id)?.file,
    data_fingerprint: fingerprint(set.compounds), standard_type: set.standard_type, endpoint: set.activity,
    outlier_rules: { ro5: o.Ro5, pfizer: o.Pfizer, ro3: o.Ro3, activity_cliffs: o.cliff, cliff_rule: set.cliff_rule },
    split: { method: o.method, test_share: o.share, seed: o.seed, train: ids(res.train), test: ids(res.test) },
    model: res.error ? { error: res.error } : { type: 'MLR', descriptors: res.xs, intercept: res.beta[0], coefficients: Object.fromEntries(res.xs.map((k, j) => [k, res.beta[j + 1]])), s: res.s },
    metrics: res.metrics || null, applicability_domain: res.error ? null : { method: 'leverage (Williams)', h_star: res.hstar, residual_limit: 3, outside: res.points.filter(p => p.out).map(p => set.compounds[p.i].id) } };
  if (!res.error) {
    const box = boxOf(set, res), b = baseline(res), cls = classify(res.points, o.cut, 'test');
    recipe.split.scaffolds = o.method === 'scaffold' ? (set.scaffolds || []).length : null;
    recipe.baseline = { rule: 'training mean', mean: b.mean, rmse: b.rmse, model_rmsep: b.model, beats_baseline: b.beats };
    recipe.classes = { cut: o.cut, ...cls };
    recipe.percentile_box = box && { rule: 'admetSAR 3.0 bands (p5–p95 inside, within range warning, outside range out)',
      counts: box.counts, descriptors: Object.fromEntries(box.rows.map(r => [r.key, { p5: r.dist.p5, p95: r.dist.p95, min: r.dist.min, max: r.dist.max, test_warn: r.warn, test_out: r.out }])) };
    recipe.predictions = res.points.filter(p => p.set === 'test').map(p => ({ id: set.compounds[p.i].id, observed: p.obs, predicted: p.pred, bootstrap_sd: fin(p.sd) ? p.sd : null, leverage: p.h }));
    recipe.gates = gateChain({ set, o, res, box, cls }).map(g => ({ id: g.id, title: g.title, status: g.status, remedy: g.status === 'yes' ? null : g.remedy }));
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' }));
  a.download = `qsar_${set.target.id}_${o.method}_seed${o.seed}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('#qsb-hash').textContent = `Data fingerprint ${recipe.data_fingerprint}.`;
}

function wire() {
  if (wired) return;
  wired = true;
  $('#qsb-col').innerHTML = Object.entries(COLS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('#qsb-desc').insertAdjacentHTML('beforeend', Object.entries(COLS).filter(([k]) => k !== 'y')
    .map(([k, v]) => `<label class="check"><input type="checkbox" value="${k}"${ui.x.has(k) ? ' checked' : ''}> ${esc(v)}</label>`).join(''));
  $('#qsb-desc').addEventListener('change', e => { if (e.target.checked) ui.x.add(e.target.value); else ui.x.delete(e.target.value); refresh(); });
  $('#qsb-target').addEventListener('change', e => loadTarget(e.target.value).catch(err => { $('#qsb-status').textContent = `That target could not load (${err.message}).`; }));
  $('#qsb-col').addEventListener('change', () => set && drawColumn());
  for (const id of ['#qsb-r-ro5', '#qsb-r-pfizer', '#qsb-r-ro3', '#qsb-r-cliff', '#qsb-split', '#qsb-test', '#qsb-seed', '#qsb-cut']) $(id).addEventListener('change', refresh);
  $('#qsb-export').addEventListener('click', exportRecipe);
  for (const name of TABS) $(`#qsb-t-${name}`).addEventListener('click', () => showTab(name));
  // a gate names the step it belongs to, so clicking it opens that step's panel
  $('#qsb-flow').addEventListener('click', e => { const b = e.target.closest('.gate-chip'); if (b) showTab(b.dataset.tab); });
}
