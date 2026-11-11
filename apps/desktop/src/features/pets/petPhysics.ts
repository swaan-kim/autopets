// Pure, time-injected spring model for the pet's whole-body motion. It has no
// DOM, timer or clock access, so the same input replays identically in tests.
//
// Two rotations with different pivots:
// - `p` swings the body from the scruff while it is carried (a pendulum),
// - `r` leans the standing body from its paws (looking at the pointer).
export interface PetPhysicsState {
  x: number; vx: number; y: number; vy: number;
  r: number; vr: number; p: number; vp: number; s: number; vs: number;
  /** Last carried drag velocity, so a change in speed (acceleration) kicks the swing. */
  drag: number;
  /** Unsimulated time, carried to the next frame. */
  carry: number;
  /** Seconds held so far; drives the gentle dangle so a carried pet never freezes. */
  hang: number;
  /** Smoothed pointer x, so rubbing back and forth never twitches the lean. */
  lx: number;
}
export interface PetPhysicsInput {
  held: boolean;
  /** Window drag velocity in CSS px per second while held. */
  drag: { x: number; y: number };
  /** Pointer position relative to the pet centre, -1..1, or null when away. */
  look: { x: number; y: number } | null;
}
export type PetImpulse = 'hop' | 'land' | 'nudge';

export const restingPhysics = (): PetPhysicsState => ({ x: 0, vx: 0, y: 0, vy: 0, r: 0, vr: 0, p: 0, vp: 0, s: 0, vs: 0, drag: 0, carry: 0, hang: 0, lx: 0 });
export const idleInput = (): PetPhysicsInput => ({ held: false, drag: { x: 0, y: 0 }, look: null });

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
// Stiffness / damping per channel. A carried body swings loosely; a standing one settles quickly.
const springs = { x: [150, 16], y: [180, 12], r: [90, 7.5], s: [260, 13], carried: [55, 3.8], swing: [80, 6] } as const;
const step = 1 / 240;
export const MAX_SWING = 14;
// A held body dangles: a slow pendulum plus a faster, smaller bob.
const DANGLE = { swing: 2.4, swingHz: 0.85, bob: 0.9, bobHz: 1.7 } as const;

export function physicsTarget(input: PetPhysicsInput, hang = 0, lookX = input.look ? clamp(input.look.x, -1, 1) : 0) {
  if (input.held) {
    // Hanging from the scruff: the body trails behind the drag, stretches and dangles.
    const tau = Math.PI * 2;
    const swing = DANGLE.swing * Math.sin(tau * DANGLE.swingHz * hang);
    const bob = DANGLE.bob * Math.sin(tau * DANGLE.bobHz * hang);
    return { x: clamp(-input.drag.x * 0.01, -5, 5), y: -8 + bob + clamp(input.drag.y * 0.004, -3, 3), r: 0, p: clamp(-input.drag.x * 0.018, -10, 10) + swing, s: -0.04 };
  }
  if (input.look) return { x: lookX * 2.5, y: input.look.y < -0.2 ? -1 : 0, r: lookX * 3, p: 0, s: 0 };
  return { x: 0, y: 0, r: 0, p: 0, s: 0 };
}

export function applyImpulse(state: PetPhysicsState, kind: PetImpulse, strength = 1): PetPhysicsState {
  const next = { ...state };
  if (kind === 'hop') { next.vy -= 150 * strength; next.vs -= 1.4 * strength; }
  if (kind === 'land') { next.vs += 2.2 * strength; next.vy += 25 * strength; }
  if (kind === 'nudge') next.vs += 0.8 * strength;
  return next;
}

/** Advances in whole fixed sub-steps and carries the remainder, so frame timing never changes the path. */
export function advancePhysics(state: PetPhysicsState, input: PetPhysicsInput, seconds: number): PetPhysicsState {
  let next = { ...state };
  if (input.held) {
    // Starting, stopping or reversing a drag swings the carried body the other way.
    next.vp = clamp(next.vp - (input.drag.x - next.drag) * 0.28, -180, 180);
    next.drag = input.drag.x;
  } else { next.drag = 0; next.hang = 0; }
  let pending = state.carry + clamp(seconds, 0, 0.1);
  while (pending >= step - 1e-9) {
    pending -= step;
    if (input.held) next.hang += step;
    // The lean follows the pointer through a ~0.2 s low-pass filter.
    const goal = input.look ? clamp(input.look.x, -1, 1) : 0;
    next.lx += (goal - next.lx) * (1 - Math.exp(-step * 5));
    const target = physicsTarget(input, next.hang, next.lx);
    const [x, vx] = spring(next.x, next.vx, target.x, springs.x, step);
    const [y, vy] = spring(next.y, next.vy, target.y, springs.y, step);
    const [r, vr] = spring(next.r, next.vr, target.r, springs.r, step);
    const [p, vp] = spring(next.p, next.vp, target.p, input.held ? springs.carried : springs.swing, step);
    const [s, vs] = spring(next.s, next.vs, target.s, springs.s, step);
    next = { x, vx, y, vy, r, vr, p, vp, s, vs, drag: next.drag, carry: 0, hang: next.hang, lx: next.lx };
  }
  next.carry = Math.max(0, pending);
  next.y = clamp(next.y, -18, 6);
  next.r = clamp(next.r, -16, 16);
  next.p = clamp(next.p, -MAX_SWING, MAX_SWING);
  next.s = clamp(next.s, -0.12, 0.12);
  return next;
}

function spring(position: number, velocity: number, target: number, [stiffness, damping]: readonly [number, number], dt: number): [number, number] {
  // Semi-implicit Euler: stable for these stiffness values at 240 Hz.
  const nextVelocity = velocity + (-stiffness * (position - target) - damping * velocity) * dt;
  return [position + nextVelocity * dt, nextVelocity];
}

export function physicsAtRest(state: PetPhysicsState, input: PetPhysicsInput) {
  // A dangling body is never at rest; frames run only while it is held.
  if (input.held) return false;
  const goal = input.look ? clamp(input.look.x, -1, 1) : 0;
  if (Math.abs(state.lx - goal) > 0.01) return false;
  const target = physicsTarget(input, 0, state.lx);
  const near = (value: number, goal: number, tolerance: number) => Math.abs(value - goal) < tolerance;
  return near(state.x, target.x, 0.02) && near(state.y, target.y, 0.02) && near(state.r, target.r, 0.02) && near(state.p, target.p, 0.02) && near(state.s, target.s, 0.0005)
    && Math.abs(state.vx) < 0.05 && Math.abs(state.vy) < 0.05 && Math.abs(state.vr) < 0.05 && Math.abs(state.vp) < 0.05 && Math.abs(state.vs) < 0.005;
}

const n = (value: number) => Math.round(value * 1000) / 1000;
/** Carry layer (pivot at the scruff) and stance layer (pivot at the paws). */
export function physicsTransforms(state: PetPhysicsState) {
  return {
    carry: `translate(${n(state.x)}px, ${n(state.y)}px) rotate(${n(state.p)}deg)`,
    stance: `rotate(${n(state.r)}deg) scale(${n(1 + state.s)}, ${n(1 - state.s)})`,
  };
}
