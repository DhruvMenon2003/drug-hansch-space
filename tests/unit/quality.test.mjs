// Unit tests for the adaptive resolution governor (js/gl/quality.js): rungs, hysteresis, floor/cap, crisp-at-idle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGovernor, ladder } from '../../site/js/gl/quality.js';

const feed = (g, ms, n) => { let changed = 0; for (let i = 0; i < n; i++) if (g.sample(ms)) changed++; return changed; };
const mk = dpr => { const applied = []; const g = createGovernor({ dpr, apply: r => applied.push(r) }); return { g, applied }; };

test('ladder: cap = min(dpr, 2), then 1.5 / 1 / 0.75, never below 0.75', () => {
  assert.deepEqual(ladder(3), [2, 1.5, 1, 0.75]);
  assert.deepEqual(ladder(2), [2, 1.5, 1, 0.75]);
  assert.deepEqual(ladder(1.25), [1.25, 1, 0.75]);
  assert.deepEqual(ladder(1), [1, 0.75]);
  assert.deepEqual(ladder(0.5), [0.5], 'a ratio below the floor is the only rung: the cap wins');
});

test('drops one rung after 20 frames above 24 ms, not before', () => {
  const { g, applied } = mk(2);
  feed(g, 40, 22);                                // the EMA needs 4 frames to climb past 24 ms, then 20 frames must pass
  assert.equal(g.level, 0);
  feed(g, 40, 1);
  assert.equal(g.level, 1);
  assert.deepEqual(applied, [1.5]);
  assert.equal(g.ratio, 1.5);
});

test('keeps stepping down to the floor and never past it', () => {
  const { g } = mk(2);
  for (let i = 0; i < 20; i++) feed(g, 80, 60);
  assert.equal(g.ratio, 0.75);
  assert.equal(g.level, 3);
});

test('recovers one rung after 90 frames below 12 ms', () => {
  const { g, applied } = mk(2);
  feed(g, 80, 100);                               // down
  const level = g.level;
  assert.ok(level >= 1);
  feed(g, 4, 60);
  assert.equal(g.level, level, '60 fast frames are not enough');
  feed(g, 4, 100);
  assert.ok(g.level < level, 'recovered');
  assert.ok(applied.at(-1) > applied.at(0) - 1e-9 || g.level === 0 || applied.length > 1);
});

test('hysteresis: frames between 12 and 24 ms change nothing and reset both counters', () => {
  const { g } = mk(2);
  feed(g, 80, 3);                                 // a short stutter lifts the EMA over 24 ms for a few frames
  feed(g, 18, 200);                               // and it settles back between the thresholds, which resets the counters
  assert.equal(g.level, 0);
  feed(g, 80, 3);
  assert.equal(g.level, 0, 'the earlier slow frames no longer count');
});

test('never above the cap', () => {
  const { g } = mk(1.5);
  feed(g, 3, 500);
  assert.equal(g.ratio, 1.5);
  assert.equal(g.level, 0);
});

test('idle() shows the full cap once and active() returns to the learned rung', () => {
  const { g, applied } = mk(2);
  assert.equal(g.idle(), false, 'nothing to restore at level 0');
  feed(g, 80, 60);
  const learned = g.ratio;
  assert.ok(learned < 2);
  applied.length = 0;
  assert.equal(g.idle(), true);
  assert.equal(g.ratio, 2);
  assert.equal(g.idle(), false, 'only once');
  assert.deepEqual(applied, [2]);
  assert.equal(g.active(), true);
  assert.equal(g.ratio, learned);
  assert.deepEqual(applied, [2, learned]);
  assert.equal(g.active(), false);
});

test('samples while crisp change the level but do not apply a ratio until active()', () => {
  const { g, applied } = mk(2);
  feed(g, 80, 60);
  g.idle();
  applied.length = 0;
  feed(g, 80, 60);
  assert.deepEqual(applied, [], 'the crisp frame stays crisp');
  g.active();
  assert.equal(applied.length, 1);
});

test('setDpr() rebuilds the rungs and clamps the level', () => {
  const { g, applied } = mk(3);
  feed(g, 80, 200);
  assert.equal(g.ratio, 0.75);
  applied.length = 0;
  g.setDpr(1);
  assert.deepEqual(g.rungs, [1, 0.75]);
  assert.equal(g.ratio, 0.75, 'still on the lowest rung, nothing to apply');
  g.setDpr(2);
  assert.deepEqual(g.rungs, [2, 1.5, 1, 0.75]);
});

test('injectOnly(true) ignores scheduler samples but accepts injected ones', () => {
  const { g } = mk(2);
  g.injectOnly(true);
  for (let i = 0; i < 100; i++) g.sample(80, true);
  assert.equal(g.level, 0);
  feed(g, 80, 60);
  assert.ok(g.level >= 1);
});

test('non-positive and absurd frame times are ignored', () => {
  const { g } = mk(2);
  feed(g, 0, 100); feed(g, -5, 100); feed(g, 99999, 100); feed(g, NaN, 100);
  assert.equal(g.level, 0);
});
