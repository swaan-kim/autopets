// Detects "petting": the pointer rubbing back and forth over the pet without a
// press. Pure and time-injected so it replays identically in tests.
export interface StrokeState { lastX: number | null; direction: 0 | 1 | -1; travel: number; turns: number[]; cooldownUntil: number }
export const STROKE = { minTravel: 0.22, window: 1100, turns: 3, cooldown: 2500 } as const;

export const restingStroke = (): StrokeState => ({ lastX: null, direction: 0, travel: 0, turns: [], cooldownUntil: 0 });

/** Feeds one pointer position (-1..1 across the pet). Returns the next state and whether a stroke completed. */
export function feedStroke(state: StrokeState, x: number, time: number): { state: StrokeState; stroked: boolean } {
  if (!Number.isFinite(x) || !Number.isFinite(time)) return { state, stroked: false };
  if (state.lastX === null) return { state: { ...state, lastX: x }, stroked: false };
  const delta = x - state.lastX;
  const next: StrokeState = { ...state, lastX: x, turns: state.turns.filter(turn => time - turn <= STROKE.window) };
  if (delta === 0) return { state: next, stroked: false };
  const direction = delta > 0 ? 1 : -1;
  if (direction === state.direction || state.direction === 0) {
    next.direction = direction;
    next.travel = (state.direction === 0 ? 0 : state.travel) + Math.abs(delta);
    return { state: next, stroked: false };
  }
  // A reversal counts only after a real sweep, so a jittery hover never pets.
  if (state.travel >= STROKE.minTravel) next.turns = [...next.turns, time];
  next.direction = direction;
  next.travel = Math.abs(delta);
  if (next.turns.length >= STROKE.turns && time >= state.cooldownUntil) {
    return { state: { ...next, turns: [], cooldownUntil: time + STROKE.cooldown }, stroked: true };
  }
  return { state: next, stroked: false };
}
