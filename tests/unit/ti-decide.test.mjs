import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../../site/js/kernel.js';
import { MIN_N, RULES, applyRules, defaults, describe, loadBatch, rerank, summarise } from '../../site/js/ti-decide.js';

// Six molecules at three targets. t 0 holds three, t 1 holds two, t 2 holds one, so the minimum-at-a-target rule
// has something to bite on; the provenance fields cover every option the rules offer.
const mol = (name, t, ti, o = {}) => ({
  name, m: 'CHEMBL' + name, t, ti,
  a: 7, as: 'measured', h: 5, hs: 'fallback_nonlinear', ad: 'inside', ts: 'chembl_mechanism', rd: 'mechanism', ...o,
});
const BATCH = [
  mol('a', 0, 3.0),
  mol('b', 0, 2.0, { as: 'fallback_nonlinear', ad: 'outside' }),
  mol('c', 0, 1.0, { as: 'series_hansch', hs: 'measured', ad: 'measured', cids: [11] }),
  mol('d', 1, 2.5, { ts: 'structure_router', rd: 'routed', cids: [12] }),
  mol('e', 1, 0.5, { ts: 'structure_router', rd: 'ambiguous' }),
  mol('f', 2, 4.0, { cids: [13, 14] }),
];

test('the published defaults keep the whole batch', () => {
  const { kept, steps } = applyRules(BATCH, { ...defaults(), minN: 1 });
  assert.equal(kept.length, 6);
  assert.deepEqual(steps.map(s => s.removed), [0, 0, 0, 0, 0]);
  assert.equal(describe({ ...defaults(), minN: 1 }), 'the batch as published, with nothing excluded');
});

test('each rule reports only what it removed from what was left to it', () => {
  const { kept, steps } = applyRules(BATCH, { act: 'measured', herg: 'any', ad: 'inside', tgt: 'any', minN: 1 });
  // activity measured drops b (fallback) and c (series); the domain rule then has nothing left to drop, because b is gone
  assert.deepEqual(steps.map(s => [s.key, s.removed]), [['act', 2], ['herg', 0], ['ad', 0], ['tgt', 0], ['minN', 0]]);
  assert.deepEqual(kept.map(m => m.name), ['a', 'd', 'e', 'f']);
});

test('the minimum at a target drops whole targets, not the molecules it is short of', () => {
  const { kept, steps } = applyRules(BATCH, { ...defaults(), minN: 3 });
  assert.deepEqual(kept.map(m => m.name), ['a', 'b', 'c']);          // only target 0 holds three
  assert.equal(steps.at(-1).removed, 3);
  assert.equal(steps.at(-1).left, 3);
});

test('a rule can empty the batch, and that is reported rather than hidden', () => {
  const { kept } = applyRules(BATCH, { act: 'measured', herg: 'measured', ad: 'any', tgt: 'any', minN: 1 });
  assert.equal(kept.length, 0);                                    // c is the only measured hERG, and it is not measured activity
});

test('ranks are worked out again inside each surviving target', () => {
  const { kept } = applyRules(BATCH, { ...defaults(), minN: 1 });
  const all = rerank(kept);
  assert.deepEqual(all.map(m => m.name), ['f', 'a', 'd', 'b', 'c', 'e']);       // flat list, widest margin first
  const byName = Object.fromEntries(all.map(m => [m.name, m]));
  assert.deepEqual([byName.a.rank, byName.a.nt], [1, 3]);
  assert.deepEqual([byName.c.rank, byName.c.nt], [3, 3]);
  // drop the fallback activity and target 0 holds two: c moves from third of three to second of two
  const tight = rerank(applyRules(BATCH, { ...defaults(), act: 'model_ok', minN: 1 }).kept);
  const c = tight.find(m => m.name === 'c');
  assert.deepEqual([c.rank, c.nt], [2, 2]);
});

test('the summary counts targets, firsts and the drugs that are on the page', () => {
  const s = summarise(rerank(applyRules(BATCH, { ...defaults(), minN: 1 }).kept));
  assert.equal(s.n, 6);
  assert.equal(s.targets, 3);
  assert.equal(s.median, 2.25);
  assert.equal(s.firsts, 2);          // a at target 0 and d at target 1; f is alone at target 2 and does not count
  assert.equal(s.onPage, 4);   // f's structure is two rows on the page
});

test('the rules read back as a sentence, in the order they are applied', () => {
  assert.equal(describe({ act: 'measured', herg: 'any', ad: 'inside', tgt: 'mechanism', minN: 4 }),
    'activity number: measured only; applicability domain: inside the domain only; '
    + 'target assignment: recorded in ChEMBL only; at least 4 molecules at a target');
});

test('every rule option either keeps everything or carries a predicate', () => {
  for (const rule of RULES) {
    assert.equal(rule.options[0].keep, undefined, `${rule.key}: the first option must be the one that keeps all`);
    assert.ok(rule.options.slice(1).every(o => typeof o.keep === 'function'), `${rule.key}: every other option filters`);
    assert.ok(rule.options.some(o => o.v === rule.dflt));
  }
  assert.equal(defaults()[MIN_N.key], MIN_N.dflt);
});

test('loadBatch reports a failure instead of leaving the panel waiting', async () => {
  app.tiKeep = null;
  assert.equal(await loadBatch(async () => { throw new Error('offline'); }), false);
  assert.equal(await loadBatch(async () => ({ meta: {}, targets: [{ id: 'CHEMBL240', name: 'hERG', n: 1 }], molecules: [mol('a', 0, 1)] })), true);
});
