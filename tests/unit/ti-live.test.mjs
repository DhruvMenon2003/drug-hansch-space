import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../../site/js/kernel.js';
import { TI_EDGES, colorOf, tiBand } from '../../site/js/model.js';
import { histogram, loadTiLive, posOf, sourceWord, summarise } from '../../site/js/ti-live.js';

const drug = (cid, name, ti) => ({ cid, name, d: {}, atc: [], routes: [], act: null, ti: ti == null ? undefined : { ti } });

test('tiBand puts the fixed breaks where the file says they are', () => {
  assert.deepEqual(TI_EDGES, [0, 1, 2, 3]);
  assert.equal(tiBand(-0.5), 1);
  assert.equal(tiBand(0), 2);            // at zero the hERG number is level with the activity: the second band starts here
  assert.equal(tiBand(1.9), 3);
  assert.equal(tiBand(2), 4);
  assert.equal(tiBand(6.1), 5);
  assert.equal(tiBand(undefined), 0);    // no index at all
  assert.equal(tiBand(NaN), 0);
});

test('summarise counts only the drugs that carry an index and names the widest margin', () => {
  const list = [drug(1, 'a', 1), drug(2, 'b', 3.5), drug(3, 'c'), drug(4, 'd', 2)];
  const s = summarise(list);
  assert.equal(s.n, 3);
  assert.equal(s.of, 4);
  assert.equal(s.median, 2);
  assert.equal(s.top.name, 'b');
  assert.equal(s.top.ti, 3.5);
});

test('summarise reports an empty view without inventing a median', () => {
  const s = summarise([drug(1, 'a'), drug(2, 'b')]);
  assert.equal(s.n, 0);
  assert.equal(s.median, null);
  assert.equal(s.top, null);
});

test('histogram bins over the fixed range and keeps the last value inside', () => {
  const list = [drug(1, 'a', -2), drug(2, 'b', 0), drug(3, 'c', 6), drug(4, 'd')];
  const h = histogram(list, -2, 6, 4);
  assert.deepEqual(h.bins, [1, 1, 0, 1]);     // buckets are two wide: -2 opens the first, 0 the second, 6 is clamped into the last
  assert.equal(h.peak, 1);
});

test('posOf clamps to the ends of the strip', () => {
  assert.equal(posOf(-2, -2, 6), '0.00%');
  assert.equal(posOf(2, -2, 6), '50.00%');
  assert.equal(posOf(99, -2, 6), '100.00%');
});

test('sourceWord says where a number came from, and passes an unknown key through', () => {
  assert.equal(sourceWord('measured'), 'measured');
  assert.equal(sourceWord('series_hansch'), 'Hansch series');
  assert.equal(sourceWord('fallback_nonlinear'), 'model');
  assert.equal(sourceWord('something_new'), 'something_new');
});

test('the index colour mode uses the band tokens and greys a drug with no index', () => {
  app.tokens = { q1: '#1', q2: '#2', q3: '#3', q4: '#4', q5: '#5', point: '#grey' };
  app.view = { ...app.view, color: 'ti' };
  app.qsarHighlight = false;
  app.scafFocus = null;
  assert.equal(colorOf(drug(1, 'a', -0.2)), '#1');
  assert.equal(colorOf(drug(2, 'b', 2.5)), '#4');
  assert.equal(colorOf(drug(3, 'c')), '#grey');
});

test('loadTiLive hangs each record on its own drug and leaves the rest alone', async () => {
  app.drugs = [drug(100, 'has one'), drug(200, 'has none')];
  app.tiReady = false;
  app.tiMeta = null;
  const file = {
    meta: { batch: { n: 1, min: -1, median: 1, max: 5 }, counts: { 'drugs on this page': 2 } },
    drugs: { 100: { ti: 2.5, rank: 1, n: 3 } },
  };
  assert.equal(await loadTiLive(async () => file), true);
  assert.equal(app.tiReady, true);
  assert.equal(app.drugs[0].ti.ti, 2.5);
  assert.equal(app.drugs[1].ti, undefined);
  assert.equal(app.tiMeta.batch.max, 5);
});
