// Property-range applicability domain for the frozen DRD2 QSAR model, after admetSAR 3.0 (Gu et al., Nucleic Acids
// Res. 2024, 52(W1):W432–W438; https://lmmd.ecust.edu.cn/admetsar3/about/endpoint.php). For each descriptor the
// training set defines a minimum, a maximum and the 5th/95th percentiles. A compound whose descriptors all lie within
// the 5th–95th percentiles is "in domain". If any value falls past a percentile but stays inside the training range,
// it gets a "warning". If any value falls outside the training minimum/maximum, it is "out of domain".
//
// Min–max standardization x' = (x − min_train) / (max_train − min_train) puts every descriptor on one 0–1 axis, so the
// rails can be compared at a glance. The scaler is fitted on the scaffold-TRAINING split only. Held-out test compounds
// are transformed with those same parameters, so they can land below 0 or above 1; that is exactly how the "out"
// band shows up visually. Fitting the scaler on all compounds would leak the test range into the reference and hide
// extrapolation. This check is complementary to the leverage/Williams domain; it is not a reliability guarantee.
import { fin } from './kernel.js';
import { band, distribution, percentileRank, profile } from './domain.js';

/** admetSAR 3.0's six AD properties and the RDKit descriptor in this export that stands for each, where one exists. */
export const ADMETSAR_MAP = { MW: 'MolWt', logP: 'MolLogP', HBA: 'HBA', HBD: 'HBD', nRing: null, nAtom: null };

/** Fit the reference on training rows only: per descriptor, the distribution plus the min–max scaling parameters. */
export function fitRange(compounds, descriptors) {
  const train = compounds.filter(p => p.split === 'train');
  const ref = {};
  for (const name of descriptors) {
    const dist = distribution(train.map(p => p.descriptors?.[name]));
    if (!dist.n) continue;
    const span = dist.max - dist.min;
    ref[name] = { ...dist, span, scale: x => (span > 0 ? (x - dist.min) / span : 0.5) };
  }
  return ref;
}

/** Min–max standardized value against the training range; NaN for a missing value. Not clipped. */
export function minMax(ref, name, x) {
  const r = ref[name];
  return r && fin(x) ? r.scale(x) : NaN;
}

/** One compound's rails: raw value, scaled value, scaled reference marks, percentile rank and band per descriptor. */
export function rangeProfile(ref, compound) {
  const rows = Object.entries(ref).map(([name, r]) => {
    const value = compound?.descriptors?.[name];
    return {
      name, value, scaled: minMax(ref, name, value), pct: percentileRank(r, value), band: band(r, value),
      marks: { p5: r.scale(r.p5), p25: r.scale(r.p25), p50: r.scale(r.p50), p75: r.scale(r.p75), p95: r.scale(r.p95) },
      min: r.min, max: r.max, p5: r.p5, p95: r.p95,
    };
  });
  return { rows, ...profile(rows.map(r => r.band)) };
}

/** Verdict counts by split for the whole frozen population (the panel's summary line and stacked bars). */
export function populationRange(ref, compounds) {
  const out = { train: { in: 0, warn: 0, out: 0, n: 0 }, test: { in: 0, warn: 0, out: 0, n: 0 } };
  for (const p of compounds) {
    const w = rangeProfile(ref, p).worst, s = out[p.split];
    if (!s || !w) continue;
    s[w]++; s.n++;
  }
  return out;
}

/** Cross-tabulate the property-range verdict against the stored leverage/residual flag: where the two disagree. */
export function agreement(ref, compounds) {
  const t = {};
  for (const p of compounds) {
    const k = `${rangeProfile(ref, p).worst}|${p.outside_domain ? 'outside' : 'within'}`;
    t[k] = (t[k] || 0) + 1;
  }
  return t;
}
