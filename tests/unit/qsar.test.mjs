import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQsar, joinCompounds } from '../../site/js/qsar.js';

// Deliberately synthetic validation cases; never shipped as scientific results.
const key = i => `${'A'.repeat(12)}${String.fromCharCode(65 + Math.floor(i / 26), 65 + i % 26)}-${'B'.repeat(10)}-N`;
const sample = () => ({
  schema_version: 1, target: { id: 'CHEMBL217', organism: 'Homo sapiens' }, assay_type: 'B', standard_type: 'Ki', n: 40, seed: 42,
  compounds: Array.from({ length: 40 }, (_, i) => ({ inchikey: key(i), observed: 7, predicted: 7, leverage: 0.1, standardized_residual: 0, outside_domain: false, split: i < 32 ? 'train' : 'test' })),
  applicability_domain: { threshold: 0.3, p: 3, n: 32, standardized_residual_limit: 3 },
  scrambling: { r2: Array(100).fill(0.01), real_r2: 0.1 },
  metrics: {
    final_fit: { n: 40, r2: 0.1, adjusted_r2: 0.08, rmse: 1, f_statistic: 4, f_p_value: 0.05, descriptor_count: 1 },
    train: { n: 32, r2: 0.1, rmse: 1 }, test: { n: 8, r2: 0.1, rmse: 1 },
    cv: { n: 40, r2: 0.1, rmse: 1, q2: 0.1, folds: Array(5).fill({}) },
    loo: { n: 40, r2: 0.1, rmse: 1, q2: 0.1 }, split: { shared_scaffolds: 0 },
  },
  coefficients: [{ descriptor: 'const', coefficient: 7, standard_error: 1, p_value: 0.1 }], verdict: 'Test fixture only',
});

test('QSAR rejects mixed endpoints, duplicate identity and incomplete scrambling', () => {
  const valid = sample();
  assert.equal(validateQsar(valid), valid);
  for (const mutate of [
    d => { d.standard_type = 'IC50'; },
    d => { d.compounds[1].inchikey = d.compounds[0].inchikey; },
    d => { d.compounds[1].observed = null; },
    d => { d.compounds[1].split = 'unknown'; },
    d => { d.scrambling.r2.pop(); },
    d => { d.n = 39; },
    d => { delete d.metrics.loo; },
    d => { d.metrics.split.shared_scaffolds = 1; },
  ]) { const d = sample(); mutate(d); assert.throws(() => validateQsar(d)); }
});

test('QSAR joins exact structures before CID, and leaves ambiguous parents unjoined', () => {
  const drugs = [{ cid: 1, pcid: 8, ik: key(0) }, { cid: 2, pcid: 8, ik: key(1) }, { cid: 3, pcid: 9, ik: key(2) }];
  const joined = joinCompounds([
    { inchikey: key(0), pubchem_cid: 2 },
    { inchikey: key(3), pubchem_cid: 8 },
    { inchikey: key(4), pubchem_cid: 9 },
    { inchikey: key(5), pubchem_cid: null },
  ], drugs);
  assert.equal(joined.get(key(0)).cid, 1, 'exact standardized identity wins');
  assert.equal(joined.has(key(3)), false, 'shared parent is ambiguous');
  assert.equal(joined.get(key(4)).cid, 3, 'unique parent is usable');
  assert.equal(joined.has(key(5)), false);
});
