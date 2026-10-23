// js/gates.js: the pass marks, the training-mean baseline, the active/inactive classes, and the gate chain the builder
// draws. The chain is what a reader acts on, so what is tested here is the verdicts: a good run answers every gate, and
// each kind of failure stops the chain at its own gate with a remedy attached.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { MARKS, baseline, chainSummary, classify, gateChain, verdict } from '../../site/js/gates.js';

const GOOD = { r2: 0.82, q2: 0.71, rm2loo: 0.66, drm2loo: 0.08, crp2: 0.63, r2pred: 0.69, rm2test: 0.61, drm2test: 0.11, rmse: 0.41, rmsep: 0.52 };

/** A run with `nTrain` training and `nTest` test points, observed values on a ramp and predictions `err` away from them. */
function run(metrics = GOOD, { nTrain = 30, nTest = 10, err = 0.3, outTest = 0 } = {}) {
  const points = [];
  for (let i = 0; i < nTrain; i++) points.push({ i, set: 'train', obs: 5 + i / 10, pred: 5 + i / 10 + err, h: 0.05, r: 0.5, out: false });
  // the test compounds span the same range as the training set, so the training-mean baseline is a baseline worth beating
  for (let i = 0; i < nTest; i++) points.push({ i: nTrain + i, set: 'test', obs: 5 + i * 0.35, pred: 5 + i * 0.35 + err, h: 0.06, r: 0.6, out: i < outTest });
  return { kept: nTrain + nTest, dropped: 3, train: points.filter(p => p.set === 'train').map(p => p.i),
    test: points.filter(p => p.set === 'test').map(p => p.i), xs: ['logp', 'logp2', 'mr'],
    beta: [4, 0.8, -0.1, 0.02], s: 0.4, hstar: 0.4, points, rnd: [0.1, 0.12, 0.08], metrics };
}
const STATE = (res, over = {}) => ({
  set: { target: { id: 'CHEMBL1', name: 'Test target' }, standard_type: 'IC50', n: 40, n_clean: 52, explorer_drugs: ['aspirin'],
    ledger: { rows: 140, unparseable: 1, 'inorganic or metal': 0, 'validity comment': 2, 'duplicates merged': 7, 'spread > 1 log unit': 3 } },
  o: { xs: ['logp', 'logp2', 'mr'], method: 'scaffold', seed: 1, share: 0.25 },
  res, box: { counts: { in: 8, warn: 2, out: 0 }, worst: 'warn' },
  cls: { n: 10, cut: 6.5, tp: 3, fp: 1, tn: 5, fn: 1, actives: 4, acc: 0.8, sens: 0.75, spec: 0.83 },
  ...over,
});
const by = (gates, id) => gates.find(g => g.id === id);

test('the pass marks are the ten rows the model table shows, eight of them judged', () => {
  assert.equal(MARKS.length, 10);
  assert.equal(MARKS.filter(([, , , ok]) => ok).length, 8);
  assert.deepEqual(verdict(GOOD), { pass: true, failed: [] });
  assert.deepEqual(verdict({ ...GOOD, q2: 0.2 }).failed, ['Q² (LOO)']);
  assert.equal(verdict({ ...GOOD, r2pred: NaN }).pass, false);          // a missing number is a miss, not a pass
});

test('the baseline is the training mean, and a model only counts when it beats it', () => {
  const r = run();
  const b = baseline(r);
  assert.equal(b.n, 10);
  assert.ok(Math.abs(b.mean - 6.45) < 1e-9);                           // mean of 5.0 … 7.9
  assert.ok(b.rmse > 0);
  assert.equal(b.beats, true);                                          // RMSEP 0.52 against a spread-out mean
  const flat = baseline({ ...r, metrics: { ...GOOD, rmsep: 99 } });
  assert.equal(flat.beats, false);
  assert.equal(baseline({ points: [] }).n, 0);
});

test('the class split counts the four cells of the confusion matrix at the cut-off', () => {
  const pts = [{ set: 'test', obs: 7, pred: 7.2 }, { set: 'test', obs: 5, pred: 5.1 }, { set: 'test', obs: 7, pred: 5.5 },
    { set: 'test', obs: 5, pred: 6.8 }, { set: 'train', obs: 9, pred: 9 }];
  const c = classify(pts, 6.5);
  assert.deepEqual([c.n, c.tp, c.fp, c.tn, c.fn], [4, 1, 1, 1, 1]);
  assert.equal(c.actives, 2);
  assert.equal(c.acc, 0.5);
  assert.equal(classify(pts, 6.5, 'all').n, 5);
  assert.ok(Number.isNaN(classify([], 6).acc));
});

test('a run that meets every mark answers every gate, with the two judgement calls left to the reader', () => {
  const gates = gateChain(STATE(run()));
  assert.deepEqual(gates.map(g => g.id), ['A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3']);
  assert.equal(gates.filter(g => g.status === 'no').length, 0);
  assert.equal(by(gates, 'D2').status, 'ask');                          // mechanism is never answered by a statistic
  assert.equal(by(gates, 'C4').status, 'yes');
  assert.ok(by(gates, 'D2').evidence.some(e => e.includes('optimum')));  // the negative log P² term is read out as a parabola
  assert.ok(gates.every(g => g.question && g.remedy && g.tab));
  assert.match(chainSummary(gates).text, /^All 12 gates answered/);
});

test('each kind of failure stops the chain at its own gate', () => {
  const thin = gateChain(STATE(run(GOOD, { nTest: 3 })));
  assert.equal(by(thin, 'B1').status, 'no');
  assert.match(by(thin, 'B1').remedy, /test share/);

  const chance = gateChain(STATE(run({ ...GOOD, crp2: 0.1 })));
  assert.equal(by(chance, 'C2').status, 'no');
  assert.equal(by(chance, 'C4').status, 'no');
  assert.equal(chainSummary(chance).stop.id, 'C2');

  const useless = gateChain(STATE(run({ ...GOOD, r2pred: -0.2, rmsep: 9 })));
  assert.equal(by(useless, 'C3').status, 'no');
  assert.match(by(useless, 'C3').remedy, /no better than their own mean/);

  const outside = gateChain(STATE(run(GOOD, { outTest: 2 })));
  assert.equal(by(outside, 'D1').status, 'no');
  assert.equal(by(outside, 'D3').status, 'ask');                        // usable, but only with the domain stated

  const small = gateChain(STATE(run(), { set: { ...STATE(run()).set, n: 12 } }));
  assert.equal(by(small, 'A1').status, 'no');
});

test('a model that did not fit leaves the later gates waiting rather than failed', () => {
  const broken = { kept: 20, dropped: 0, train: [], test: [], xs: [], error: 'The descriptors are collinear; drop one.', points: [], rnd: [] };
  const gates = gateChain(STATE(broken));
  assert.equal(by(gates, 'A3').status, 'no');
  assert.equal(by(gates, 'A3').remedy, 'The descriptors are collinear; drop one.');
  for (const id of ['B2', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3']) assert.equal(by(gates, id).status, 'wait', id);
});
