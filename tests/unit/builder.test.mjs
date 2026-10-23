import test from 'node:test';
import assert from 'node:assert/strict';
import { ols, r2, rm2, kennardStone, split, runModel, rng, fingerprint } from '../../site/js/builder.js';

// Synthetic data with a known equation; never shipped as a scientific result.
const synth = n => {
  const rand = rng(7), compounds = [];
  for (let i = 0; i < n; i++) {
    const logp = rand() * 5, mr = 50 + rand() * 60;
    compounds.push({ id: `C${i}`, ik: `K${i}`, logp, mr, tpsa: 40, mw: 300, hbd: 1, hba: 3, rotb: 3, arom: 1, fsp3: 0.3, heavy: 22,
      y: 4 + 0.8 * logp + 0.01 * mr + (rand() - 0.5) * 0.1, rules: i % 10 === 0 ? ['Ro5'] : [], cl: i % 7 });
  }
  return { compounds, cliffs: [[1, 2, 0.9, 1.6]] };
};

test('ols recovers a known equation and LOO matches refitting', () => {
  const X = [[1], [2], [3], [4], [5], [6]], y = [3.1, 4.9, 7.2, 8.8, 11.1, 13];
  const m = ols(X, y);
  assert.ok(Math.abs(m.beta[1] - 1.98) < 0.05);
  const loo0 = ols(X.slice(1), y.slice(1));
  assert.ok(Math.abs(m.loo[0] - (loo0.beta[0] + loo0.beta[1] * 1)) < 1e-9);
});

test('r2 and rm2 are 1 and 0 for a perfect prediction', () => {
  const v = [1, 2, 3, 4];
  assert.equal(r2(v, v), 1);
  const m = rm2(v, v);
  assert.ok(Math.abs(m.avg - 1) < 1e-12 && m.delta < 1e-12);
});

test('Kennard–Stone keeps the two extremes in training', () => {
  const Z = [[0], [10], [5], [4], [6]], keep = kennardStone(Z, 3);
  assert.ok(keep.has(0) && keep.has(1) && keep.size === 3);
});

test('splits are deterministic and disjoint; cluster split keeps clusters whole', () => {
  const d = synth(60), idx = d.compounds.map((_, i) => i);
  for (const method of ['random', 'ks', 'cluster']) {
    const a = split(d, idx, method, 0.2, 42, ['logp', 'mr']), b = split(d, idx, method, 0.2, 42, ['logp', 'mr']);
    assert.deepEqual(a, b);
    assert.equal(a.train.length + a.test.length, 60);
    assert.ok(!a.test.some(i => a.train.includes(i)));
  }
  const c = split(d, idx, 'cluster', 0.2, 42, ['logp']), testCl = new Set(c.test.map(i => d.compounds[i].cl));
  assert.ok(!c.train.some(i => testCl.has(d.compounds[i].cl)));
});

test('the full model passes on clean synthetic data and refuses too many descriptors', () => {
  const d = synth(80);
  const res = runModel(d, { Ro5: true, Pfizer: false, Ro3: false, cliff: true, method: 'random', share: 0.2, seed: 42, xs: ['logp', 'mr'] });
  assert.equal(res.dropped, 10);
  assert.ok(res.metrics.q2 > 0.9 && res.metrics.r2pred > 0.9 && res.metrics.crp2 > 0.5);
  const bad = runModel(synth(20), { method: 'random', share: 0.2, seed: 1, xs: ['logp', 'mr', 'tpsa', 'mw'] });
  assert.match(bad.error, /Too many descriptors/);
  assert.equal(fingerprint(d.compounds), fingerprint(synth(80).compounds));
});
