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

// ---------------------------------------------------------------------------------------------------------------------
// Recovery is relative to the display's refresh interval (Wave 2 note N6: the old absolute 12 ms could never be met at 60 Hz).
// Feeds are rAF gaps with a little deterministic jitter, as a real display delivers them.
const jitter = i => ((i * 7919) % 13 - 6) / 6 * 0.4;                 // +-0.4 ms, repeatable
const feedHz = (g, ms, n, start = 0) => { for (let i = 0; i < n; i++) g.sample(ms + jitter(start + i)); };
const HZ = { 30: 1000 / 30, 60: 1000 / 60, 120: 1000 / 120, 144: 1000 / 144 };

for (const hz of [60, 120]) {
  test(`${hz} Hz: a transient slowdown drops the resolution and the page recovers to the top rung`, () => {
    const { g, applied } = mk(2);
    feedHz(g, HZ[hz], 200);                                            // healthy
    assert.equal(g.level, 0);
    assert.ok(Math.abs(g.interval - HZ[hz]) < 0.6, `interval measured: ${g.interval}`);
    feedHz(g, 45, 150);                                                // GPU hiccup (heavy view, background work)
    assert.ok(g.level >= 2, `dropped (${g.level})`);
    feedHz(g, HZ[hz], 700);                                            // and back to the display's own pace
    assert.equal(g.level, 0, 'recovered');
    assert.equal(g.ratio, 2);
    assert.equal(applied.at(-1), 2);
  });
}

test('fast is relative: 12 ms frames are fast on a 60 Hz display but not on a 120 Hz display that only sometimes makes its vsync', () => {
  const a = mk(2), b = mk(2);
  // a 120 Hz page that mostly misses its vsync still shows the display's 8.3 ms in every tenth gap
  const pace = (hz, ms, i) => (hz === 120 && i % 10 === 9 ? HZ[120] : ms + jitter(i));
  feedHz(a.g, HZ[60], 100); feedHz(b.g, HZ[120], 100);                 // learn the two intervals
  for (let i = 0; i < 120; i++) { a.g.sample(pace(60, 50, i)); b.g.sample(pace(120, 50, i)); }
  assert.ok(a.g.level >= 1 && b.g.level >= 1);
  const lb = b.g.level;
  for (let i = 0; i < 3000; i++) { a.g.sample(pace(60, 12, i)); b.g.sample(pace(120, 12, i)); }
  assert.equal(a.g.level, 0, '12 ms is below 1.25 x 16.7 ms: fast on a 60 Hz display');
  assert.ok(Math.abs(b.g.interval - HZ[120]) < 0.6, `interval ${b.g.interval}`);
  assert.equal(b.g.level, lb, '12 ms is above 1.25 x 8.3 ms = 10.4 ms: not fast on a 120 Hz display');
});

test('30 Hz: the governor goes to the floor, holds it without flapping, and recovers when the display returns to 60 Hz', () => {
  const { g, applied } = mk(2);
  feedHz(g, HZ[60], 100);
  feedHz(g, HZ[30], 3000);
  assert.equal(g.ratio, 0.75, 'a sustained 33 ms frame time is a slow page: lowest rung');
  const moves = applied.length;
  feedHz(g, HZ[30], 3000);
  assert.equal(applied.length, moves, 'no further changes while it stays at 30 Hz (no thrash)');
  assert.ok(applied.every((r, i) => i === 0 || r < applied[i - 1]), `only downward: ${applied}`);
  feedHz(g, HZ[60], 1500);                                             // back to 60 Hz: the interval estimate follows within 120 frames
  assert.equal(g.level, 0);
  assert.equal(g.ratio, 2);
});

test('the refresh interval estimate: clamped to 6.9..17 ms, immune to one odd gap, and 16.7 ms until 16 gaps are seen', () => {
  const { g } = mk(2);
  assert.equal(g.interval, 16.7);
  feedHz(g, HZ[144], 40);
  assert.equal(g.interval, 6.9, 'a 144.9 Hz feed is clamped at 6.9');
  const h = mk(2).g;
  feedHz(h, 40, 60);
  assert.equal(h.interval, 17, 'slow frames clamp at 17 ms, they do not make "fast" ever laxer');
  const k = mk(2).g;
  feedHz(k, HZ[60], 100);
  k.sample(7.5);                                                       // one catch-up gap after a stall
  feedHz(k, HZ[60], 30);
  assert.ok(k.interval > 15, `one short gap does not set the interval: ${k.interval}`);
  assert.ok(k.fastMs > 19 && k.fastMs < 22, `fast threshold around 20.8 ms: ${k.fastMs}`);
  const j = mk(2).g;
  for (let i = 0; i < 100; i++) j.sample(2);                           // gaps under 5 ms are not display refreshes
  assert.equal(j.interval, 16.7);
});

test('flap guard: a device that is fast at one rung and slow at the next settles instead of toggling', () => {
  // frame time by rung: 40 ms at the cap, display pace below it
  const applied = [];
  let g;
  g = createGovernor({ dpr: 2, apply: r => applied.push(r) });
  for (let i = 0; i < 6000; i++) g.sample(g.learned >= 2 ? 40 : HZ[60] + jitter(i));
  assert.ok(applied.length <= 14, `${applied.length} resolution changes in 6000 frames (about 50 without the guard)`);
  assert.ok(g.riseNeed > 90, `the rise threshold backed off (${g.riseNeed})`);
  // once the cap is cheap again the page still gets back to it
  for (let i = 0; i < 4000; i++) g.sample(HZ[60] + jitter(i));
  assert.equal(g.learned, 2);
});
