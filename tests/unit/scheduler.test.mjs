// Unit tests for js/scheduler.js (node:test, no browser): coalescing, idle, holds, pause/XR/hidden, dt, error isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../../site/js/scheduler.js';

/** A fake rAF queue and a fake document so frames are stepped by hand. */
function rig(opts = {}) {
  const q = new Map(); let next = 1, now = 1000;
  const listeners = new Set();
  const doc = { hidden: false, addEventListener: (_, f) => listeners.add(f), removeEventListener: (_, f) => listeners.delete(f) };
  const s = createScheduler({ doc, raf: cb => { q.set(next, cb); return next++; }, caf: id => q.delete(id), idleMs: 5, ...opts });
  return {
    s, doc, pending: () => q.size,
    step(ms = 16) { now += ms; const cbs = [...q.values()]; q.clear(); for (const cb of cbs) cb(now); },
    setHidden(h) { doc.hidden = h; for (const f of listeners) f(); },
  };
}
const nap = ms => new Promise(r => setTimeout(r, ms));

test('invalidate() coalesces to one pending rAF and one frame', () => {
  const r = rig(); let calls = 0;
  r.s.setRender(() => { calls++; return false; });
  r.s.invalidate(); r.s.invalidate(); r.s.invalidate();
  assert.equal(r.pending(), 1);
  r.step();
  assert.equal(calls, 1);
  assert.equal(r.pending(), 0, 'idle: nothing scheduled after a frame that wants no more');
  assert.equal(r.s.stats.frames, 1);
});

test('a render that returns true keeps the frames coming; false stops them', () => {
  const r = rig(); let left = 3;
  r.s.setRender(() => --left > 0);
  r.s.invalidate();
  for (let i = 0; i < 3; i++) { assert.equal(r.pending(), 1); r.step(); }
  assert.equal(r.pending(), 0);
  assert.equal(r.s.stats.frames, 3);
});

test('hold() keeps frames coming until release(); release lets the next frame go idle', () => {
  const r = rig();
  r.s.setRender(() => false);
  r.s.hold('spin');
  r.step(); r.step();
  assert.equal(r.pending(), 1, 'held: still scheduling');
  r.s.release('spin');
  r.step();
  assert.equal(r.pending(), 0);
});

test('dt is passed only inside a continuous run', () => {
  const r = rig(); const dts = []; let more = true;
  r.s.setRender((t, dt) => { dts.push(dt); return more; });
  r.s.invalidate(); r.step(16); r.step(20); more = false; r.step(30);
  assert.deepEqual(dts, [0, 20, 30]);
  dts.length = 0;
  r.s.invalidate(); r.step(500);
  assert.deepEqual(dts, [0], 'after an idle gap dt is 0, so a governor never sees the gap');
});

test('hidden tab: nothing is scheduled; becoming visible schedules one frame', () => {
  const r = rig(); let calls = 0;
  r.s.setRender(() => { calls++; return true; });
  r.setHidden(true);
  r.s.invalidate();
  assert.equal(r.pending(), 0);
  r.setHidden(false);
  assert.equal(r.pending(), 1);
  r.step();
  assert.equal(calls, 1);
});

test('a frame that was pending when the tab was hidden still runs but does not reschedule', () => {
  const r = rig();
  r.s.setRender(() => true);
  r.s.invalidate();
  r.setHidden(true);
  r.step();
  assert.equal(r.pending(), 0, 'hidden: the continuing frame is not requested');
});

test('setXR(true) cancels the pending rAF and blocks scheduling until setXR(false)', () => {
  const r = rig(); let calls = 0;
  r.s.setRender(() => { calls++; return false; });
  r.s.invalidate();
  r.s.setXR(true);
  assert.equal(r.pending(), 0);
  r.s.invalidate(); r.s.hold('x'); r.s.renderNow();
  assert.equal(r.pending(), 0);
  assert.equal(calls, 0);
  r.s.release('x');
  r.s.setXR(false);
  assert.equal(r.pending(), 1);
});

test('pause() / resume()', () => {
  const r = rig();
  r.s.setRender(() => true);
  r.s.invalidate(); r.s.pause();
  assert.equal(r.pending(), 0);
  r.s.invalidate();
  assert.equal(r.pending(), 0);
  r.s.resume();
  assert.equal(r.pending(), 1);
});

test('renderNow() renders synchronously; from inside render it schedules instead of recursing', () => {
  const r = rig(); let calls = 0, depth = 0, maxDepth = 0;
  r.s.setRender(() => { calls++; depth++; maxDepth = Math.max(maxDepth, depth); if (calls === 1) r.s.renderNow(); depth--; return false; });
  r.s.renderNow();
  assert.equal(calls, 1);
  assert.equal(maxDepth, 1);
  assert.equal(r.pending(), 1, 'the nested request became a normal frame');
});

test('onIdle fires once after idleMs of no frames, not while frames are pending', async () => {
  const r = rig(); let idles = 0;
  r.s.setOnIdle(() => idles++);
  r.s.setRender(() => false);
  r.s.invalidate(); r.step();
  await nap(30);
  assert.equal(idles, 1);
  r.s.invalidate();                              // new activity cancels a pending idle callback
  r.step();
  r.s.invalidate();
  await nap(30);
  assert.equal(idles, 1, 'a frame was pending, so no idle');
  r.step();
  await nap(30);
  assert.equal(idles, 2);
});

test('a throwing render is logged and the pump stays usable', () => {
  const r = rig(); let n = 0; const err = console.error; let logged = 0; console.error = () => logged++;
  try {
    r.s.setRender(() => { if (n++ === 0) throw new Error('boom'); return false; });
    r.s.invalidate(); r.step();
    r.s.invalidate(); r.step();
  } finally { console.error = err; }
  assert.equal(logged, 1);
  assert.equal(n, 2);
});

test('dispose() cancels and removes the visibility listener', () => {
  const r = rig();
  r.s.setRender(() => true);
  r.s.invalidate(); r.s.dispose();
  assert.equal(r.pending(), 0);
  r.s.invalidate();
  assert.equal(r.pending(), 0);
});
