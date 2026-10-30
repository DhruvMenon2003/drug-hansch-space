import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replayFull, replayHalving, replayMedian, rungs, selfCheck, summarise } from '../../site/js/ti-search.js';

// Five candidates, five folds, in hundredths of R-squared as the recorded file stores them. Candidate 0 is the
// real winner and starts slowly; candidate 4 looks best on its first fold and collapses. That is the whole
// argument about pruning in one fixture.
const CURVES = [
  [10, 20, 30, 40, 50],
  [-5, -5, -5, -5, -5],
  [40, 42, 44, 46, 48],
  [1, 2, 3, 4, 5],
  [60, 10, 10, 10, 10],
];

test('the full search spends every fold and finds the best final score', () => {
  const r = replayFull(CURVES);
  assert.equal(r.pick, 0);
  assert.equal(r.folds, 25);
  assert.equal(r.pruned, 0);
  assert.deepEqual(r.paid, [5, 5, 5, 5, 5]);
});

test('the fold count is the per-candidate spend summed, for every policy', () => {
  for (const r of [replayFull(CURVES), replayMedian(CURVES, 5), replayHalving(CURVES, 5)]) {
    assert.equal(r.paid.reduce((a, b) => a + b, 0), r.folds);
    assert.equal(r.pruned, r.paid.filter((n) => n < 5).length);
  }
});

test('median pruning keeps the winner here, and bills less for it', () => {
  const r = replayMedian(CURVES, 5);
  assert.equal(r.pick, 0, 'the slow starter still finishes, because the first two candidates are never pruned');
  assert.ok(r.folds < 25 && r.pruned > 0);
});

test('median pruning prunes nothing while it is still warming up', () => {
  assert.equal(replayMedian(CURVES, 5, { startup: 9, warmup: 0 }).folds, 25);   // nothing has finished to compare against
  assert.equal(replayMedian(CURVES, 5, { startup: 0, warmup: 5 }).folds, 25);   // the warm-up outlasts the folds
  assert.ok(replayMedian(CURVES, 5, { startup: 0, warmup: 0 }).folds < replayMedian(CURVES, 5).folds);
});

test('successive halving is cheap and here it is wrong', () => {
  const r = replayHalving(CURVES, 5, { min: 1, factor: 3 });
  assert.deepEqual(rungs(5, 1, 3), [1, 3, 5]);
  assert.equal(r.pick, 4, 'one fold is enough to promote the candidate that collapses on the next four');
  assert.equal(r.folds, 9);            // 5 candidates x 1 fold, then 1 x 2 more, then 1 x 2 more
  assert.notEqual(r.pick, replayFull(CURVES).pick);
});

test('a gentler halving ladder buys back the right answer', () => {
  assert.equal(replayHalving(CURVES, 5, { min: 3, factor: 2 }).pick, 0);
  assert.ok(replayHalving(CURVES, 5, { min: 3, factor: 2 }).folds > replayHalving(CURVES, 5).folds);
});

test('a candidate with no score never wins, and never counts as zero', () => {
  const holes = [[null, null, null, null, null], [-80, -80, -80, -80, -80]];
  assert.equal(replayFull(holes).pick, 1);
  assert.equal(replayMedian(holes, 5).pick, 1);
});

// The recorded run is the reference: this page replays the same rules, so at the parameters the run used it must
// land on the same candidate and the same bill at every target. A drift here means the page is telling a story
// the recorded numbers do not support.
test('the replay reproduces every policy the recorded run wrote down', () => {
  const blob = JSON.parse(readFileSync(new URL('../../site/data/ti/search.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(blob.targets).length > 50);
  assert.deepEqual(selfCheck(blob), []);
});

test('the summary counts usable targets separately from all of them', () => {
  const blob = JSON.parse(readFileSync(new URL('../../site/data/ti/search.json', import.meta.url), 'utf8'));
  const knobs = { startup: 2, warmup: 1, min: 1, factor: 3 };
  const full = summarise(blob, 'scaffold', 'full', knobs);
  const halving = summarise(blob, 'scaffold', 'halving', knobs);
  assert.equal(full.same, full.n, 'the full search always agrees with itself');
  assert.ok(full.usable < full.n, 'most targets carry no model that clears the gate');
  assert.ok(halving.share < 0.6, 'halving pays for well under half the folds');
  assert.ok(halving.same < full.n, 'and it does not always land where the full search does');
  assert.equal(halving.moved.length, full.usable - halving.usableSame);
});
