// kernel.js is the layer-0 module: it must load in plain node (no DOM at import time) and its bus must keep the
// original side-effect order (GL, then HUD, then table) and isolate handler failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDER, bus, cap, esc, fx, niceStep } from '../../site/js/kernel.js';

test('bus runs handlers by order, stable within an order, whatever the registration order', () => {
  const seen = [];
  bus.on('t1', () => seen.push('table'), ORDER.LATE);
  bus.on('t1', () => seen.push('hud-a'));
  bus.on('t1', () => seen.push('gl'), ORDER.GL);
  bus.on('t1', () => seen.push('hud-b'));
  bus.emit('t1');
  assert.deepEqual(seen, ['gl', 'hud-a', 'hud-b', 'table']);
});

test('a throwing handler is logged and the others still run', () => {
  const seen = [], err = console.error;
  console.error = () => seen.push('logged');
  try {
    bus.on('t2', () => { throw new Error('boom'); });
    bus.on('t2', d => seen.push(d));
    bus.emit('t2', 7);
  } finally { console.error = err; }
  assert.deepEqual(seen, ['logged', 7]);
});

test('off removes a handler; the unsubscribe function from on() does too', () => {
  const seen = [], f = () => seen.push('f'), un = bus.on('t3', () => seen.push('g'));
  bus.on('t3', f);
  bus.off('t3', f);
  un();
  bus.emit('t3');
  assert.deepEqual(seen, []);
});

test('helpers: esc, fx, cap, niceStep', () => {
  assert.equal(esc(`<img onerror="x">&'`), '&lt;img onerror=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(fx(-1.234, 1), '−1.2');
  assert.equal(fx(NaN), '–');
  assert.equal(cap('aSPIRIN'), 'Aspirin');
  assert.equal(niceStep(10, 5), 2);
});
