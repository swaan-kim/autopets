// Pure, time-injected spring model for the pet's whole-body motion. It has no
// DOM, timer or clock access, so the same input replays identically in tests.
export interface PetPhysicsState { x: number; vx: number; y: number; vy: number; r: number; vr: number; s: number; vs: number; /** Unsimulated time, carried to the next frame. */ carry: number }
export interface PetPhysicsInput {
  held: boolean;
  /** Window drag velocity in CSS px per second while held. */
  drag: { x: number; y: number };
  /** Pointer position relative to the pet centre, -1..1, or null when away. */
  look: { x: number; y: number } | null;
}
export type PetImpulse = 'hop' | 'land' | 'nudge';

export const restingPhysics = (): PetPhysicsState => ({ x: 0, vx: 0, y: 0, vy: 0, r: 0, vr: 0, s: 0, vs: 0, carry: 0 });
export const idleInput = (): PetPhysicsInput => ({ held: false, drag: { x: 0, y: 0 }, look: null });

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
// Stiffness / damping per channel: lateral, lift, lean (deg), squash.
const springs = { x: [150, 16], y: [180, 12], r: [90, 7.5], s: [260, 13] } as const;
const step = 1 / 240;

export function physicsTarget(input: PetPhysicsInput) {
  if (input.held) {
    // Hanging from the grab point: the body lags behind the drag direction.
    return { x: clamp(-input.drag.x * 0.012, -6, 6), y: -6 + clamp(input.drag.y * 0.004, -3, 3), r: clamp(-input.drag.x * 0.026, -14, 14), s: -0.035 };
  }
  if (input.look) return { x: clamp(input.look.x, -1, 1) * 2.5, y: input.look.y < -0.2 ? -1 : 0, r: clamp(input.look.x, -1, 1) * 3, s: 0 };
  return { x: 0, y: 0, r: 0, s: 0 };
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
  const target = physicsTarget(input);
  let next = { ...state };
  let pending = state.carry + clamp(seconds, 0, 0.1);
  while (pending >= step - 1e-9) {
    pending -= step;
    const [x, vx] = spring(next.x, next.vx, target.x, springs.x, step);
    const [y, vy] = spring(next.y, next.vy, target.y, springs.y, step);
    const [r, vr] = spring(next.r, next.vr, target.r, springs.r, step);
    const [s, vs] = spring(next.s, next.vs, target.s, springs.s, step);
    next = { x, vx, y, vy, r, vr, s, vs, carry: 0 };
  }
  next.carry = Math.max(0, pending);
  next.y = clamp(next.y, -18, 6);
  next.r = clamp(next.r, -16, 16);
  next.s = clamp(next.s, -0.12, 0.12);
  return next;
}

function spring(position: number, velocity: number, target: number, [stiffness, damping]: readonly [number, number], dt: number): [number, number] {
  // Semi-implicit Euler: stable for these stiffness values at 240 Hz.
  const nextVelocity = velocity + (-stiffness * (position - target) - damping * velocity) * dt;
  return [position + nextVelocity * dt, nextVelocity];
}

export function physicsAtRest(state: PetPhysicsState, input: PetPhysicsInput) {
  const target = physicsTarget(input);
  return Math.abs(state.x - target.x) < 0.02 && Math.abs(state.y - target.y) < 0.02 && Math.abs(state.r - target.r) < 0.02 && Math.abs(state.s - target.s) < 0.0005
    && Math.abs(state.vx) < 0.05 && Math.abs(state.vy) < 0.05 && Math.abs(state.vr) < 0.05 && Math.abs(state.vs) < 0.005;
}

export function physicsTransform(state: PetPhysicsState) {
  const n = (value: number) => Math.round(value * 1000) / 1000;
  return `translate(${n(state.x)}px, ${n(state.y)}px) rotate(${n(state.r)}deg) scale(${n(1 + state.s)}, ${n(1 - state.s)})`;
}
