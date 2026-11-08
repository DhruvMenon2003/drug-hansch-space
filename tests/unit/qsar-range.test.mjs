import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitRange, minMax, rangeProfile, populationRange } from '../../site/js/qsar-range.js';

// Synthetic: x = 0..100 for 101 training compounds, so min 0, max 100, P5 = 5, P95 = 95 exactly.
const train = Array.from({ length: 101 }, (_, i) => ({ split: 'train', descriptors: { x: i } }));
const ref = fitRange([...train, { split: 'test', descriptors: { x: 1e6 } }], ['x']);

test('min–max scaler is fitted on the training split only (no test leakage)', () => {
  assert.equal(ref.x.min, 0); assert.equal(ref.x.max, 100);
  assert.equal(minMax(ref, 'x', 50), 0.5);
  assert.equal(minMax(ref, 'x', 150), 1.5, 'not clipped: extrapolation must stay visible');
  assert.ok(Number.isNaN(minMax(ref, 'x', null)));
});

test('admetSAR 3.0 bands: in within P5–P95, warning past a percentile, out past min/max', () => {
  const v = x => rangeProfile(ref, { descriptors: { x } }).worst;
  assert.equal(v(50), 'in'); assert.equal(v(5), 'in'); assert.equal(v(95), 'in');
  assert.equal(v(2), 'warn'); assert.equal(v(99), 'warn');
  assert.equal(v(-1), 'out'); assert.equal(v(101), 'out');
  const r = rangeProfile(ref, { descriptors: { x: 50 } }).rows[0];
  assert.equal(r.marks.p5, 0.05); assert.equal(r.marks.p95, 0.95); assert.equal(r.pct, 50);
});

test('worst descriptor decides the compound verdict', () => {
  const two = fitRange(train.map(p => ({ ...p, descriptors: { a: p.descriptors.x, b: p.descriptors.x } })), ['a', 'b']);
  assert.equal(rangeProfile(two, { descriptors: { a: 50, b: 99 } }).worst, 'warn');
  assert.equal(rangeProfile(two, { descriptors: { a: 2, b: 120 } }).worst, 'out');
});

test('frozen DRD2 export: training compounds are never out of domain, every compound gets a verdict', () => {
  const d = JSON.parse(readFileSync(new URL('../../site/data/qsar_drd2.json', import.meta.url)));
  const names = d.training_coefficients.map(c => c.descriptor).filter(n => n !== 'Intercept');
  const r = fitRange(d.compounds, names);
  assert.deepEqual(Object.keys(r).sort(), [...names].sort());
  const pop = populationRange(r, d.compounds);
  assert.equal(pop.train.out, 0);
  assert.equal(pop.train.n, d.metrics.train.n);
  assert.equal(pop.test.n, d.metrics.test.n);
});
