import assert from 'node:assert/strict';
import test from 'node:test';
import { feedStroke, restingStroke, STROKE } from '../../apps/desktop/src/features/pets/petStroke.ts';

const sweep = (state, points, start = 0, gap = 40) => {
  let strokes = 0;
  points.forEach((x, index) => { const fed = feedStroke(state, x, start + index * gap); state = fed.state; if (fed.stroked) strokes += 1; });
  return { state, strokes };
};
const rub = (times, width = 0.6) => Array.from({ length: times * 6 + 1 }, (_, index) => {
  const phase = (index % 12) / 6; return (phase <= 1 ? phase : 2 - phase) * width - width / 2;
});

test('rubbing back and forth pets once, then cools down', () => {
  const first = sweep(restingStroke(), rub(4));
  assert.equal(first.strokes, 1);
  const again = sweep(first.state, rub(4), 1000);
  assert.equal(again.strokes, 0, 'still cooling down');
  const later = sweep(again.state, rub(4), 1000 + STROKE.cooldown + 500);
  assert.equal(later.strokes, 1);
});

test('hover jitter, a single pass and slow wandering never pet', () => {
  const jitter = Array.from({ length: 60 }, (_, index) => (index % 2 ? 0.05 : -0.05));
  assert.equal(sweep(restingStroke(), jitter).strokes, 0);
  assert.equal(sweep(restingStroke(), Array.from({ length: 20 }, (_, index) => -1 + index * 0.1)).strokes, 0);
  assert.equal(sweep(restingStroke(), rub(4), 0, 600).strokes, 0, 'reversals spread beyond the window');
  assert.equal(feedStroke(restingStroke(), Number.NaN, 0).stroked, false);
});
