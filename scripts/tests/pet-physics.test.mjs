import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { advancePhysics, applyImpulse, idleInput, physicsAtRest, physicsTarget, physicsTransform, restingPhysics } from '../../apps/desktop/src/features/pets/petPhysics.ts';

const run = (state, input, seconds, frame = 1 / 60) => {
  let next = state;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += frame) next = advancePhysics(next, input, Math.min(frame, seconds - elapsed));
  return next;
};

test('a resting pet with no input stays at rest and renders the identity transform', () => {
  const state = run(restingPhysics(), idleInput(), 2);
  assert.ok(physicsAtRest(state, idleInput()));
  assert.equal(physicsTransform(state), 'translate(0px, 0px) rotate(0deg) scale(1, 1)');
});

test('the path does not depend on the frame rate', () => {
  const input = { ...idleInput(), held: true, drag: { x: -300, y: 0 } };
  const at60 = run(restingPhysics(), input, 0.5, 1 / 60);
  const at144 = run(restingPhysics(), input, 0.5, 1 / 144);
  for (const key of ['x', 'y', 'r', 's']) assert.ok(Math.abs(at60[key] - at144[key]) < 1e-6, `${key}: ${at60[key]} vs ${at144[key]}`);
});

test('dragging lifts the body and leans it against the drag, then it settles after release', () => {
  const held = { ...idleInput(), held: true, drag: { x: 300, y: 0 } };
  const dragging = run(applyImpulse(restingPhysics(), 'nudge', -0.6), held, 0.8);
  assert.ok(dragging.y < -4, 'lifted');
  assert.ok(dragging.r < -4, 'leans against a rightward drag');
  const released = run(applyImpulse(dragging, 'land'), idleInput(), 2.5);
  assert.ok(physicsAtRest(released, idleInput()), JSON.stringify(released));
});

test('targets and outputs stay bounded for extreme input', () => {
  assert.equal(physicsTarget({ ...idleInput(), held: true, drag: { x: 1e6, y: 0 } }).r, -14);
  const wild = run(applyImpulse(applyImpulse(restingPhysics(), 'hop', 20), 'land', 20), { ...idleInput(), held: true, drag: { x: -1e6, y: 1e6 } }, 0.3);
  assert.ok(wild.y >= -18 && wild.y <= 6 && Math.abs(wild.r) <= 16 && Math.abs(wild.s) <= 0.12);
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
