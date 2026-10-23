// Layer 1. Percentile bounding box: where one value sits in a reference distribution, and the three-way verdict
// (inside, warning, outside) that the detail panel and the QSAR builder both show.
//
// The rule follows admetSAR 3.0's basic property display: a value between the 5th and 95th percentile of the
// reference set is inside the box, a value past either percentile but still within the observed range is a warning,
// and a value below the minimum or above the maximum is outside it. It is one of the applicability-domain rules
// in the OECD sense: it says the query looks like the compounds the numbers came from, not that a prediction is right.
import { fin } from './kernel.js';

/** The three bands, worst last; `band()` returns one of these keys. */
export const BANDS = { in: 'inside the 5th–95th percentile', warn: 'outside the 5th–95th percentile', out: 'outside the observed range' };

/** Quantile of a sorted array by linear interpolation (the definition NumPy and Excel use). */
export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * Reference distribution of `values`: n, min, max, the 5th/25th/50th/75th/95th percentiles, mean and SD.
 * Non-finite values are ignored, so a descriptor that is missing for some compounds still has a reference.
 */
export function distribution(values) {
  const v = values.filter(fin).sort((a, b) => a - b), n = v.length;
  if (!n) return { n: 0 };
  const mean = v.reduce((s, x) => s + x, 0) / n;
  return { n, min: v[0], max: v[n - 1], p5: quantile(v, 0.05), p25: quantile(v, 0.25), p50: quantile(v, 0.5),
    p75: quantile(v, 0.75), p95: quantile(v, 0.95), mean,
    sd: Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / n), sorted: v };
}

/**
 * Percentile rank of `value` in the distribution, 0–100: the share of reference values at or below it, counting a tie
 * as half (the mid-rank definition), so the median of a symmetric set is 50 and not 50 plus the weight of its ties.
 */
export function percentileRank(dist, value) {
  if (!dist.n || !fin(value)) return NaN;
  const v = dist.sorted;
  let below = 0, equal = 0;
  for (const x of v) { if (x < value) below++; else if (x === value) equal++; }
  return ((below + equal / 2) / dist.n) * 100;
}

/** Which band `value` falls in: 'in' inside p5–p95, 'warn' past a percentile, 'out' past the minimum or maximum. */
export function band(dist, value) {
  if (!dist.n || !fin(value)) return null;
  if (value < dist.min || value > dist.max) return 'out';
  if (value < dist.p5 || value > dist.p95) return 'warn';
  return 'in';
}

/** The worst band over several descriptors, and how many fall in each: one verdict for a whole compound. */
export function profile(bands) {
  const counts = { in: 0, warn: 0, out: 0 };
  for (const b of bands) if (b) counts[b]++;
  return { worst: counts.out ? 'out' : counts.warn ? 'warn' : counts.in ? 'in' : null, counts };
}
