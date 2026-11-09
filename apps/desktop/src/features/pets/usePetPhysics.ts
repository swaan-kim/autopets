import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { advancePhysics, applyImpulse, idleInput, physicsAtRest, physicsTransform, restingPhysics, type PetImpulse } from './petPhysics';
import type { PetMotionInput } from './petMotionInput';

// Drives the whole-body spring layer. Frames are scheduled only while the body
// is moving; a settled, hidden or reduced-motion pet schedules nothing.
export function usePetPhysics(layer: RefObject<HTMLSpanElement | null>, enabled: boolean, source?: PetMotionInput) {
  const state = useRef(restingPhysics());
  const input = useRef(idleInput());
  const frame = useRef<number | undefined>(undefined);
  const last = useRef<number | undefined>(undefined);
  const live = useRef(enabled);
  live.current = enabled;

  const render = useCallback(() => {
    const element = layer.current;
    if (element) element.style.transform = physicsTransform(state.current);
  }, [layer]);
  const stop = useCallback((reset: boolean) => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    last.current = undefined;
    if (reset) {
      state.current = restingPhysics();
      if (layer.current) layer.current.style.transform = '';
    }
  }, [layer]);
  const tick = useCallback((time: number) => {
    frame.current = undefined;
    if (!live.current) return;
    const seconds = last.current === undefined ? 1 / 60 : (time - last.current) / 1000;
    last.current = time;
    state.current = advancePhysics(state.current, input.current, seconds);
    if (physicsAtRest(state.current, input.current)) {
      // Holding a lean or a look needs no frames until the input changes.
      const resting = !input.current.held && !input.current.look;
      if (!resting) render();
      stop(resting);
      return;
    }
    render();
    frame.current = requestAnimationFrame(tick);
  }, [render, stop]);
  const wake = useCallback(() => {
    if (live.current && frame.current === undefined) frame.current = requestAnimationFrame(tick);
  }, [tick]);
  const kick = useCallback((kind: PetImpulse, strength = 1) => {
    if (!live.current) return;
    state.current = applyImpulse(state.current, kind, strength);
    wake();
  }, [wake]);

  useEffect(() => {
    if (!enabled) { input.current = idleInput(); stop(true); }
    return () => stop(true);
  }, [enabled, stop]);

  useEffect(() => {
    if (!source) return;
    return source.subscribe(event => {
      const current = input.current;
      if (event.type === 'look') input.current = { ...current, look: { x: event.x, y: event.y } };
      if (event.type === 'away') input.current = { ...current, look: null };
      if (event.type === 'grab') { input.current = { ...current, held: true, drag: { x: 0, y: 0 } }; kick('nudge', -0.6); }
      if (event.type === 'drag') input.current = { ...current, drag: { x: event.x, y: event.y } };
      if (event.type === 'release') { input.current = { ...current, held: false, drag: { x: 0, y: 0 } }; kick('land', 1); }
      wake();
    });
  }, [source, kick, wake]);

  return { kick };
}
