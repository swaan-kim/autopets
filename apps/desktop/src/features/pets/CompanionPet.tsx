import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { CompanionFigure } from './CompanionFigure';
import { claimCompletion, type CompanionState } from './companionMotion';
import { usePetVisibility } from './usePetVisibility';
import './companion.css';

export function CompanionPet({ state = 'idle', paused = false, runKey, interaction = 0, example = false }: { state?: CompanionState; paused?: boolean; runKey?: string; interaction?: number; example?: boolean }) {
  const { ref, playing, reduced } = usePetVisibility(!paused);
  const sprite = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ state: CompanionState; runKey?: string } | undefined>(undefined);
  const consumed = useRef(0);
  const greeted = useRef(false);
  const reaction = useRef(interaction);
  const [celebration, setCelebration] = useState(0);
  const [gesture, setGesture] = useState<'greet' | 'complete' | null>(null);
  const id = useId();
  const phase = [...id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 29 / 7;

  useEffect(() => {
    const last = previous.current;
    previous.current = { state, runKey };
    let disposed = false;
    // A restored result or visibility change must never become a new result.
    if (state === 'complete' && last && last.state !== 'complete' && last.state !== 'error' && last.runKey === runKey && runKey && playing) {
      if (example) setCelebration(value => value + 1);
      else void claimCompletion(runKey).then(allowed => { if (allowed && !disposed) setCelebration(value => value + 1); });
    }
    return () => { disposed = true; };
  }, [state, runKey, playing, example]);

  useEffect(() => {
    if (!playing) { setGesture(null); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let jump: Animation | undefined;
    const interacted = interaction !== reaction.current;
    reaction.current = interaction;
    if (state === 'complete' && celebration > consumed.current) {
      consumed.current = celebration;
      setGesture('complete');
      jump = sprite.current?.querySelector('.rig-jump')?.animate([
        { transform: 'translateY(0) scale(1)' },
        { transform: 'translateY(3px) scale(1.025, .965)', offset: .18 },
        { transform: 'translateY(-13px) scale(.985, 1.025)', offset: .44 },
        { transform: 'translateY(2px) scale(1.02, .98)', offset: .76 },
        { transform: 'translateY(0) scale(1)' },
      ], { duration: 1250, easing: 'cubic-bezier(.4, 0, .2, 1)' });
      timer = setTimeout(() => setGesture(null), 1500);
    } else if ((interacted && (state === 'idle' || state === 'complete')) || (!greeted.current && state === 'idle')) {
      greeted.current = true;
      setGesture('greet');
      timer = setTimeout(() => setGesture(null), 1700);
    } else {
      setGesture(null);
      if (interacted && state !== 'error') {
        jump = sprite.current?.querySelector('.rig-jump')?.animate([
          { transform: 'translateY(0)' }, { transform: 'translateY(-2px)' }, { transform: 'translateY(0)' },
        ], { duration: 500, easing: 'ease-in-out' });
      }
    }
    return () => { clearTimeout(timer); jump?.cancel(); };
  }, [state, runKey, playing, interaction, celebration]);

  const clip = !playing || state === 'error' ? 'still' : gesture ?? (state === 'idle' || state === 'complete' ? 'blink' : state);
  return <span ref={ref} className={'companion-pet ' + (!playing ? 'companion-paused' : '')} data-state={state} data-playing={playing} data-assets="ready" data-renderer="articulated" data-reduced={reduced} data-gesture={gesture ?? 'none'} style={{ '--pet-phase': '-' + phase + 's' } as CSSProperties}>
    <span className="companion-body"><span ref={sprite} className="companion-sprite" data-clip={clip} role="img" aria-label="함께 일하는 펫"><CompanionFigure /></span></span>
  </span>;
}
