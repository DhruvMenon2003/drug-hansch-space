import test from 'node:test';
import assert from 'node:assert/strict';
import { drawPairTags } from '../../site/js/explorable-tags.js';

const context = () => new Proxy({ measureText: text => ({ width: text.length * 6 }) }, {
  get: (target, key) => key in target ? target[key] : () => {},
});
const colors = { ink: '#123', panel: '#fff', muted: '#678' };
const pair = [
  { x: 160, y: 220, text: 'Pinned: Caffeine', tail: 'TPSA 61.82 Å²' },
  { x: 210, y: 225, text: 'Compare: Aminophylline', tail: 'TPSA 72.68 Å²' },
];
const overlaps = (a, b) => a.bx < b.x+b.width && a.bx+a.w > b.x && a.by < b.y+b.height && a.by+a.h > b.y;

test('pair labels keep clear of the mobile population beacon', () => {
  const beacon = { x: 8, y: 215, width: 374, height: 26 };
  const boxes = drawPairTags(context(), pair, 390, 247, colors, [beacon]);
  assert.equal(boxes.length, 2);
  for (const box of boxes) assert.equal(overlaps(box, beacon), false);
  assert.equal(overlaps(boxes[0], { x: boxes[1].bx, y: boxes[1].by, width: boxes[1].w, height: boxes[1].h }), false);
});

test('an open detail sheet reserves the covered plot area without changing anchors', () => {
  const sheet = { x: 0, y: 120, width: 390, height: 127 };
  const boxes = drawPairTags(context(), pair, 390, 247, colors, [sheet]);
  assert.equal(boxes.length, 2);
  for (const [i, box] of boxes.entries()) {
    assert.equal(overlaps(box, sheet), false);
    assert.deepEqual([box.x, box.y], [pair[i].x, pair[i].y]);
    assert.ok(box.bx >= 0 && box.by >= 0 && box.bx+box.w <= 390 && box.by+box.h <= 247);
  }
});

test('no labels are painted over a fully covered scene', () => {
  assert.deepEqual(drawPairTags(context(), pair, 390, 247, colors, [{ x: 0, y: 0, width: 390, height: 247 }]), []);
});
