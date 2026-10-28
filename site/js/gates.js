// Layer 2. The OECD pass marks, and the gate chain the QSAR builder draws above its steps: one card per checkpoint of the
// workflow, each with the question it asks, the evidence this run gives, a Yes or No verdict, and — when the answer is No —
// the one thing that gets it to Yes. Pure functions over the builder's own state: no DOM, so the whole chain is unit-tested.
//
// The chain follows the OECD validation principles (a defined endpoint, an unambiguous algorithm, a defined domain,
// internal and external validation, and a mechanistic interpretation where one can be had), in the order a reader
// actually works through them.
import { fin, fx } from './kernel.js';

/** The pass marks of the model table: [key, label, mark as text, test]. A null test is a number that is reported, not judged. */
export const MARKS = [['r2', 'R² (training)', '> 0.6', v => v > 0.6], ['q2', 'Q² (LOO)', '> 0.5', v => v > 0.5],
  ['rm2loo', 'r²m (LOO), average', '> 0.5', v => v > 0.5], ['drm2loo', 'Δr²m (LOO)', '< 0.2', v => v < 0.2],
  ['crp2', 'cR²p (y-randomisation)', '> 0.5', v => v > 0.5], ['r2pred', 'R²pred (test)', '> 0.5', v => v > 0.5],
  ['rm2test', 'r²m (test), average', '> 0.5', v => v > 0.5], ['drm2test', 'Δr²m (test)', '< 0.2', v => v < 0.2],
  ['rmse', 'RMSE training (log units)', '', null], ['rmsep', 'RMSE test (log units)', '', null]];

/** Which pass marks the metrics miss. `pass` is true only when every judged mark is met. */
export function verdict(metrics) {
  const failed = MARKS.filter(([k, , , ok]) => ok && !(fin(metrics[k]) && ok(metrics[k]))).map(([, label]) => label);
  return { pass: !failed.length, failed };
}

/** Is one mark met? (by key, over a metrics object) */
const met = (metrics, key) => {
  const m = MARKS.find(([k]) => k === key);
  return !!(m && m[3] && fin(metrics[key]) && m[3](metrics[key]));
};

/**
 * The baseline every QSAR model has to beat: predicting the training mean for every test compound. A model that does not
 * beat it has learned nothing from the structures, however good its R² looks.
 */
export function baseline(res) {
  const pts = (res.points || []).filter(p => p.set === 'test'), tr = (res.points || []).filter(p => p.set === 'train');
  if (!pts.length || !tr.length) return { n: pts.length, rmse: NaN, beats: false, ratio: NaN };
  const mean = fin(res.trainMean) ? res.trainMean : tr.reduce((s, p) => s + p.obs, 0) / tr.length;
  const rmse = Math.sqrt(pts.reduce((s, p) => s + (p.obs - mean) ** 2, 0) / pts.length);
  const model = res.metrics?.rmsep;
  return { n: pts.length, mean, rmse, model, beats: fin(model) && model < rmse, ratio: fin(model) && rmse ? model / rmse : NaN };
}

/**
 * Active/inactive classes at a cut-off on the activity scale (the KNIME tutorial's view of the same data): how well the
 * regression's predictions sort the held-out compounds into the two classes. `which` picks 'test', 'train' or 'all'.
 */
export function classify(points, cut, which = 'test') {
  const pts = (points || []).filter(p => which === 'all' || p.set === which);
  const c = { n: pts.length, cut, tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const p of pts) {
    const obs = p.obs >= cut, pred = p.pred >= cut;
    if (obs && pred) c.tp++; else if (!obs && pred) c.fp++; else if (!obs && !pred) c.tn++; else c.fn++;
  }
  c.actives = c.tp + c.fn;
  c.acc = c.n ? (c.tp + c.tn) / c.n : NaN;
  c.sens = c.actives ? c.tp / c.actives : NaN;
  c.spec = c.tn + c.fp ? c.tn / (c.tn + c.fp) : NaN;
  return c;
}

const S = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/**
 * The whole chain for one run. Each gate carries `status`: 'yes' when the run answers it, 'no' when it fails and `remedy`
 * says what to change, 'ask' when only the reader can answer, and 'wait' when an earlier gate has to be settled first.
 * `tab` names the builder step that acts on the gate.
 * @param {{set: any, o: any, res: any, box: any, cls: any}} state
 */
export function gateChain({ set, o, res, box, cls }) {
  const m = res.metrics || {}, v = res.metrics ? verdict(res.metrics) : { pass: false, failed: ['the model did not fit'] };
  const L = set.ledger || {}, base = baseline(res);
  const outside = (res.points || []).filter(p => p.out), outTest = outside.filter(p => p.set === 'test');
  const fitted = !res.error && !!res.beta;
  const wait = { status: 'wait', remedy: 'Settle the earlier gates first.' };
  const gates = [];
  const add = (g) => { gates.push(g); return g; };

  add({ id: 'A1', title: 'Dataset', tab: 'data',
    question: 'Is there one measured endpoint, on one target, from one kind of assay?',
    evidence: [`${set.target.name} (${set.target.id}), p${set.standard_type} from binding assays with an exact relation.`,
      `${S(set.n, 'compound')} used of ${set.n_clean} clean; ${L.rows ?? '—'} activity rows read.`],
    status: set.n >= 20 ? 'yes' : 'no',
    remedy: 'Choose a target with more measured compounds: a fit on fewer than 20 cannot be validated.' });

  add({ id: 'A2', title: 'Structures', tab: 'data',
    question: 'Is every structure usable, and is every duplicate measurement resolved?',
    evidence: [`Dropped: ${L.unparseable ?? 0} unparseable, ${L['inorganic or metal'] ?? 0} inorganic or metal, ${L['validity comment'] ?? 0} flagged by ChEMBL.`,
      `${L['duplicates merged'] ?? 0} duplicate measurements merged; ${L['spread > 1 log unit'] ?? 0} dropped for disagreeing by more than a log unit.`],
    status: 'yes',
    remedy: 'Rebuild the target file with tools/build_qsar_targets.py.' });

  add({ id: 'A3', title: 'Descriptors', tab: 'out',
    question: 'Are the descriptors computed for every compound, few enough, and not collinear?',
    evidence: [o.xs.length ? `${S(o.xs.length, 'descriptor')}: ${o.xs.join(', ')}.` : 'No descriptor chosen.',
      `${S(res.kept, 'compound')} kept, ${res.dropped} removed by the rule and cliff filters.`],
    status: res.error ? 'no' : 'yes',
    remedy: res.error || 'Pick at least one descriptor, and no more than one per five training compounds.' });

  add({ id: 'B1', title: 'Split', tab: 'split',
    question: 'Is there a test set the model never sees while it is fitted?',
    evidence: [`${o.method === 'ks' ? 'Kennard–Stone' : o.method === 'cluster' ? 'By fingerprint cluster' : o.method === 'scaffold' ? 'By Bemis–Murcko scaffold' : 'Random'} split, seed ${o.seed}: ${res.train.length} training, ${res.test.length} test.`,
      o.method === 'random' ? 'A random split can leave near-duplicates on both sides; a scaffold or cluster split is the harder test.' : 'Whole series are held out, so the test is a test of extrapolation.'],
    status: res.test.length >= 5 ? 'yes' : 'no',
    remedy: 'Raise the test share, or pick a target with more compounds: fewer than five test compounds cannot support R²pred.' });

  add({ id: 'B2', title: 'Fit', tab: 'model',
    question: 'Does the model describe the training compounds?',
    evidence: fitted ? [`R² ${fx(m.r2, 3)} over ${res.train.length} compounds, s ${fx(res.s, 3)} log units.`] : ['The model did not fit.'],
    ...(fitted ? { status: met(m, 'r2') ? 'yes' : 'no' } : wait),
    remedy: 'A poor fit is a descriptor problem: add a term the activity should depend on, or remove the compounds the rules flag.' });

  add({ id: 'C1', title: 'Internal validation', tab: 'model',
    question: 'Does the fit survive leaving compounds out, one at a time?',
    evidence: fitted ? [`Q² (LOO) ${fx(m.q2, 3)}, r²m ${fx(m.rm2loo, 3)}, Δr²m ${fx(m.drm2loo, 3)}.`,
      `R² − Q² = ${fx(m.r2 - m.q2, 3)}; a wide gap is a model held up by single compounds.`] : [],
    ...(fitted ? { status: met(m, 'q2') && met(m, 'rm2loo') && met(m, 'drm2loo') ? 'yes' : 'no' } : wait),
    remedy: 'Drop a descriptor, or remove the high-leverage compounds the Williams plot shows: the fit is carried by too few points.' });

  add({ id: 'C2', title: 'Y-randomisation', tab: 'model',
    question: 'Is the fit better than one on shuffled activity?',
    evidence: fitted ? [`cR²p ${fx(m.crp2, 3)} over ${res.rnd.length} refits on shuffled activity.`,
      `Mean R² of the shuffles ${fx(res.rnd.reduce((s, x) => s + x, 0) / (res.rnd.length || 1), 3)} against ${fx(m.r2, 3)} real.`] : [],
    ...(fitted ? { status: met(m, 'crp2') ? 'yes' : 'no' } : wait),
    remedy: 'A fit the shuffles match is chance correlation: use fewer descriptors on more compounds.' });

  add({ id: 'C3', title: 'External test', tab: 'model',
    question: 'Does the model predict the held-out compounds, and beat predicting the training mean?',
    evidence: fitted ? [`R²pred ${fx(m.r2pred, 3)}, r²m (test) ${fx(m.rm2test, 3)}, RMSEP ${fx(m.rmsep, 3)} log units.`,
      base.n ? `Training-mean baseline on the same ${S(base.n, 'compound')}: RMSE ${fx(base.rmse, 3)}. The model is ${base.beats ? `${fx((1 - base.ratio) * 100, 0)}% better` : 'no better'}.` : 'No test compounds.'] : [],
    ...(fitted ? { status: met(m, 'r2pred') && base.beats ? 'yes' : 'no' } : wait),
    remedy: base.n && !base.beats ? 'The model predicts the held-out compounds no better than their own mean: it has learned nothing transferable. Change the descriptors.' : 'Improve the fit or the split: the test set is where a QSAR model earns its keep.' });

  add({ id: 'C4', title: 'Acceptable?', tab: 'model',
    question: 'Is every pass mark met at once?',
    evidence: fitted ? [v.pass ? 'Every OECD pass mark is met.' : `Missed: ${v.failed.join(', ')}.`] : [],
    ...(fitted ? { status: v.pass ? 'yes' : 'no' } : wait),
    remedy: 'Go back to the step the failing mark belongs to; do not report a model that misses one.' });

  add({ id: 'D1', title: 'Domain', tab: 'ad',
    question: 'Is the applicability domain defined, and do the test compounds fall inside it?',
    evidence: fitted ? [`Leverage h* ${fx(res.hstar, 3)}: ${outside.length} of ${res.points.length} compounds outside, ${outTest.length} of them in the test set.`,
      box ? `Percentile box over the training compounds: of the test compounds' descriptor values, ${box.counts.in} sit inside the 5th–95th percentile, ${box.counts.warn} past a percentile and ${box.counts.out} outside the observed range.` : 'Percentile box not computed.'] : [],
    ...(fitted ? { status: outTest.length ? 'no' : 'yes' } : wait),
    remedy: 'Predictions for compounds outside the domain are not supported by this model: report them as out of domain, or widen the training set.' });

  add({ id: 'D2', title: 'Mechanism', tab: 'model',
    question: 'Do the coefficients mean something a chemist would recognise?',
    evidence: fitted ? [...o.xs.map((k, j) => `${k}: ${res.beta[j + 1] >= 0 ? '+' : '−'}${fx(Math.abs(res.beta[j + 1]), 3)} per unit.`),
      o.xs.includes('logp') && o.xs.includes('logp2') && res.beta[o.xs.indexOf('logp2') + 1] < 0
        ? `log P² is negative, so activity has an optimum at log P ${fx(-res.beta[o.xs.indexOf('logp') + 1] / (2 * res.beta[o.xs.indexOf('logp2') + 1]), 2)} — the parabola Hansch described.`
        : 'No parabolic log P term: the model is linear in lipophilicity.'] : [],
    ...(fitted ? { status: 'ask' } : wait),
    remedy: 'Only a reader can answer this one. A sign that contradicts the pharmacology is a reason to distrust the model, however good its statistics.' });

  add({ id: 'D3', title: 'Candidates', tab: 'ad',
    question: 'Can the model be used — on compounds inside its domain?',
    evidence: fitted ? [`${S((set.explorer_drugs || []).length, 'explorer drug')} act at this target.`,
      cls && cls.n ? `At p${set.standard_type} ≥ ${fx(cls.cut, 1)} the model sorts the ${S(cls.n, 'test compound')} into active and inactive with ${fx(cls.acc * 100, 0)}% accuracy (${cls.tp} of ${cls.actives} actives found).` : 'No class split computed.'] : [],
    ...(fitted ? { status: v.pass && !outTest.length ? 'yes' : 'ask' } : wait),
    remedy: 'Use it only inside the domain, and say so with every number it produces.' });

  return gates;
}

/** One line for the whole chain: how many gates are answered, and the first that is not. */
export function chainSummary(gates) {
  const yes = gates.filter(g => g.status === 'yes').length;
  const stop = gates.find(g => g.status === 'no');
  return { yes, total: gates.length, stop: stop || null,
    text: stop ? `${yes} of ${gates.length} gates answered; stopped at ${stop.id} ${stop.title}.`
      : `All ${gates.length} gates answered${gates.some(g => g.status === 'ask') ? ', two of them left to the reader' : ''}.` };
}
