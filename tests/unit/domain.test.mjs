// js/domain.js: the percentile bounding box. The reference set here is 0, 1, 2, … 100, so a percentile is its own
// value and the bands are easy to read off: inside 5–95, warning past them, outside below 0 or above 100.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { BANDS, band, distribution, percentileRank, profile, quantile } from '../../site/js/domain.js';

const ramp = Array.from({ length: 101 }, (_, i) => i);

test('quantile interpolates the way NumPy does', () => {
  assert.equal(quantile([1, 2, 3, 4], 0), 1);
  assert.equal(quantile([1, 2, 3, 4], 1), 4);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([10, 20, 30], 0.25), 15);
  assert.ok(Number.isNaN(quantile([], 0.5)));
});

test('distribution ignores missing values and reports the five summary points', () => {
  const d = distribution([...ramp, null, undefined, NaN, 'x']);
  assert.equal(d.n, 101);
  assert.equal(d.min, 0);
  assert.equal(d.max, 100);
  assert.equal(d.p5, 5);
  assert.equal(d.p50, 50);
  assert.equal(d.p95, 95);
  assert.equal(d.mean, 50);
  assert.equal(distribution([]).n, 0);
});

test('percentile rank counts ties as half', () => {
  const d = distribution(ramp);
  assert.equal(Math.round(percentileRank(d, 50)), 50);
  assert.ok(percentileRank(d, 0) < 1);
  assert.ok(percentileRank(d, 100) > 99);
  assert.equal(percentileRank(distribution([5, 5, 5, 5]), 5), 50);
  assert.ok(Number.isNaN(percentileRank(d, null)));
  assert.ok(Number.isNaN(percentileRank(distribution([]), 1)));
});

test('the band is green inside 5–95, amber past a percentile, red outside the range', () => {
  const d = distribution(ramp);
  assert.equal(band(d, 50), 'in');
  assert.equal(band(d, 5), 'in');            // the percentile itself is still inside
  assert.equal(band(d, 95), 'in');
  assert.equal(band(d, 4.9), 'warn');
  assert.equal(band(d, 95.1), 'warn');
  assert.equal(band(d, 0), 'warn');          // the minimum is below p5: a warning, not outside the range
  assert.equal(band(d, -0.001), 'out');
  assert.equal(band(d, 100.001), 'out');
  assert.equal(band(d, NaN), null);
  assert.equal(band(distribution([]), 1), null);
  assert.ok(BANDS.in && BANDS.warn && BANDS.out);
});

test('a flat reference set puts anything off the value outside the range', () => {
  const d = distribution([7, 7, 7]);
  assert.equal(band(d, 7), 'in');
  assert.equal(band(d, 7.5), 'out');
});

test('the profile takes the worst band and counts the rest', () => {
  assert.deepEqual(profile(['in', 'in', 'warn']), { worst: 'warn', counts: { in: 2, warn: 1, out: 0 } });
  assert.deepEqual(profile(['in', 'out', 'warn']), { worst: 'out', counts: { in: 1, warn: 1, out: 1 } });
  assert.deepEqual(profile(['in', null]), { worst: 'in', counts: { in: 1, warn: 0, out: 0 } });
  assert.equal(profile([null]).worst, null);
});
