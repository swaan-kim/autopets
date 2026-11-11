import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { advancePhysics, applyImpulse, idleInput, MAX_SWING, physicsAtRest, physicsTarget, physicsTransforms, restingPhysics } from '../../apps/desktop/src/features/pets/petPhysics.ts';

const run = (state, input, seconds, frame = 1 / 60) => {
  let next = state;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += frame) next = advancePhysics(next, input, Math.min(frame, seconds - elapsed));
  return next;
};

test('a resting pet with no input stays at rest and renders the identity transform', () => {
  const state = run(restingPhysics(), idleInput(), 2);
  assert.ok(physicsAtRest(state, idleInput()));
  assert.deepEqual(physicsTransforms(state), { carry: 'translate(0px, 0px) rotate(0deg)', stance: 'rotate(0deg) scale(1, 1)' });
});

test('the path does not depend on the frame rate', () => {
  const input = { ...idleInput(), held: true, drag: { x: -300, y: 0 } };
  const at60 = run(restingPhysics(), input, 0.5, 1 / 60);
  const at144 = run(restingPhysics(), input, 0.5, 1 / 144);
  for (const key of ['x', 'y', 'r', 'p', 's']) assert.ok(Math.abs(at60[key] - at144[key]) < 1e-6, `${key}: ${at60[key]} vs ${at144[key]}`);
});

test('a carried body hangs, trails the drag, and swings back when the drag starts and stops', () => {
  const held = speed => ({ ...idleInput(), held: true, drag: { x: speed, y: 0 } });
  let state = run(applyImpulse(restingPhysics(), 'nudge', -0.6), held(0), 0.3);
  assert.ok(state.y < -5, 'lifted');
  // Starting to drag right swings the body back (negative) beyond its steady trailing angle.
  const steady = physicsTarget(held(300)).p;
  let deepest = 0;
  for (let t = 0; t < 0.6; t += 1 / 60) { state = advancePhysics(state, held(300), 1 / 60); deepest = Math.min(deepest, state.p); }
  assert.ok(deepest < steady - 1, `overshoots the trailing angle: ${deepest} vs ${steady}`);
  // While the speed holds it dangles around the trailing angle instead of freezing.
  let low = Infinity, high = -Infinity, sum = 0, count = 0;
  state = run(state, held(300), 2);
  for (let t = 0; t < 2.4; t += 1 / 60) { state = advancePhysics(state, held(300), 1 / 60); low = Math.min(low, state.p); high = Math.max(high, state.p); sum += state.p; count += 1; }
  assert.ok(Math.abs(sum / count - steady) < 0.5, `dangles around the trailing angle: ${sum / count} vs ${steady}`);
  assert.ok(high - low > 1.5 && high - low < 8, `a visible but gentle dangle: ${high - low}`);
  assert.equal(physicsAtRest(state, held(300)), false, 'a held body keeps animating');
  // Stopping swings it forward past vertical.
  let forward = -Infinity;
  for (let t = 0; t < 0.6; t += 1 / 60) { state = advancePhysics(state, held(0), 1 / 60); forward = Math.max(forward, state.p); }
  assert.ok(forward > 1, `swings forward on stop: ${forward}`);
  const released = run(applyImpulse(state, 'land'), idleInput(), 3);
  assert.ok(physicsAtRest(released, idleInput()), JSON.stringify(released));
  assert.equal(released.hang, 0, 'the dangle restarts from rest on the next grab');
});

test('targets and outputs stay bounded for extreme input', () => {
  assert.equal(physicsTarget({ ...idleInput(), held: true, drag: { x: 1e6, y: 0 } }).p, -10);
  const wild = run(applyImpulse(applyImpulse(restingPhysics(), 'hop', 20), 'land', 20), { ...idleInput(), held: true, drag: { x: -1e6, y: 1e6 } }, 0.3);
  assert.ok(wild.y >= -18 && wild.y <= 6 && Math.abs(wild.r) <= 16 && Math.abs(wild.p) <= MAX_SWING && Math.abs(wild.s) <= 0.12);
  assert.ok(Object.values(wild).every(Number.isFinite));
});

test('looking at the pointer is a small lean toward it', () => {
  const target = physicsTarget({ ...idleInput(), look: { x: 1, y: 0 } });
  assert.ok(target.r > 0 && target.r <= 3);
  assert.ok(target.x > 0 && target.x <= 2.5);
});

test('each sprite cell has a registration offset that keeps the paws on one baseline', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../apps/desktop/public/assets/companion-v1/manifest.json', import.meta.url), 'utf8'));
  for (const [name, sheet] of Object.entries(manifest.sheets)) {
    const cells = manifest.registration.cells[name];
    assert.equal(cells.length, sheet.columns * sheet.rows, name);
    for (const [x, y, scale] of cells) assert.ok(Math.abs(x) < 10 && Math.abs(y) < 25 && scale >= 1 && scale <= 1.3, `${name}: ${x},${y},${scale}`);
  }
});
