import { useEffect, useRef, useState, type CSSProperties } from 'react';
import sheets from '../../../public/assets/companion-v1/manifest.json';
import { Pet, type PetMotion } from './Pet';
import { claimCompletion, type CompanionState } from './companionMotion';
import { usePetVisibility } from './usePetVisibility';
import { usePetPhysics } from './usePetPhysics';
import type { PetMotionInput } from './petMotionInput';
import './companion.css';

type Sheet = keyof typeof sheets.sheets;
type Frame = [number, number];
type Clip = { sheet: Sheet; frames: Frame[] };
const clips: Record<string, Clip> = {
  blink: { sheet: 'social', frames: [[0, 3600], [1, 90], [2, 110], [3, 180], [0, 1400]] },
  greet: { sheet: 'social', frames: [[4, 200], [5, 160], [6, 260], [5, 140], [6, 220], [7, 250]] },
  stretch: { sheet: 'social', frames: [[8, 400], [9, 500], [10, 750], [9, 350], [11, 600]] },
  receive: { sheet: 'arrival', frames: Array.from({ length: 12 }, (_, index) => [index % 4, 90] as Frame) },
  planning: { sheet: 'notes', frames: [[0, 1400], [1, 700], [2, 900], [3, 600], [0, 1800]] },
  working: { sheet: 'paws', frames: [...Array.from({ length: 12 }, (_, i) => [[0, 1, 2, 1][i % 4], [210, 145, 130, 180][i % 4]] as Frame), [1, 1450], [0, 320]] },
  waiting: { sheet: 'notes', frames: [[4, 240], [5, 300], [6, 400], [7, 600]] },
  complete: { sheet: 'paws', frames: [[4, 250], [3, 340], [4, 300], [5, 700]] },
  // Carried: paws up, with an occasional content blink.
  held: { sheet: 'social', frames: [[10, 1400], [9, 180], [10, 1100]] },
};
const stillFor = (state: CompanionState): [Sheet, number] => state === 'working' ? ['paws', 1] : state === 'planning' || state === 'error' ? ['notes', 0] : state === 'waiting' ? ['notes', 7] : ['social', 0];
// Each cell is moved so the paws stay on one baseline (see the manifest's
// registration method); otherwise switching cells makes the whole pet jump.
const registration = sheets.registration.cells as Record<Sheet, number[][]>;
function poseStyle(sheet: Sheet, frame: number) {
  const item = sheets.sheets[sheet];
  const [x, y, scale] = registration[sheet][frame];
  return {
    backgroundImage: `url(${item.url})`, backgroundSize: `${item.columns * 100}% ${item.rows * 100}%`,
    backgroundPosition: `${frame % item.columns / (item.columns - 1) * 100}% ${Math.floor(frame / item.columns) / (item.rows - 1) * 100}%`,
    transform: `translate(${x}%, ${y}%) scale(${scale})`,
  } satisfies CSSProperties;
}
// Cross-blend between cells inside a clip, never longer than the cell's hold.
const blendFor = (hold: number) => Math.min(140, Math.round(hold * 0.6));
const fallbackMotion: Record<CompanionState, PetMotion> = { idle: 'idle', receive: 'idle', planning: 'thinking', working: 'writing', waiting: 'dizzy', complete: 'idle', error: 'angry' };

export function CompanionPet({ state = 'idle', paused = false, runKey, interaction = 0, example = false, motionInput }: { state?: CompanionState; paused?: boolean; runKey?: string; interaction?: number; example?: boolean; motionInput?: PetMotionInput }) {
  const { ref, playing, reduced } = usePetVisibility(!paused);
  const motionElement = useRef<HTMLSpanElement>(null);
  const stanceElement = useRef<HTMLSpanElement>(null);
  const cellBlend = useRef<HTMLSpanElement>(null);
  const physics = usePetPhysics(motionElement, stanceElement, playing, motionInput);
  const held = physics.held;
  const kick = useRef(physics.kick);
  const lastClip = useRef<string | undefined>(undefined);
  kick.current = physics.kick;
  const sprite = useRef<HTMLSpanElement>(null);
  const reactionElement = useRef<HTMLSpanElement>(null);
  const lastReactionTransform = useRef<string | undefined>(undefined);
  const previousPose = useRef<HTMLSpanElement>(null);
  const currentSheet = useRef<Sheet | undefined>(undefined);
  const lastRenderedPose = useRef<{ backgroundImage: string; backgroundPosition: string; backgroundSize: string; transform: string } | null>(null);
  const [assets, setAssets] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [celebration, setCelebration] = useState(0);
  const previous = useRef<{ state: CompanionState; runKey?: string } | undefined>(undefined);
  const consumed = useRef(0);
  const greeted = useRef(false);
  const reaction = useRef(0);
  // Petting reacts like a touch: a wave when idle, a small wiggle while working.
  const [strokes, setStrokes] = useState(0);
  useEffect(() => motionInput?.subscribe(event => { if (event.type === 'pet') setStrokes(value => value + 1); }), [motionInput]);
  const touches = interaction + strokes;
  const idleInteraction = state === 'idle' ? touches : 0;
  const canReact = state !== 'idle' && state !== 'error';

  useEffect(() => {
    let disposed = false;
    const images = Object.values(sheets.sheets).map(item => new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => image.naturalWidth === item.width && image.naturalHeight === item.height ? resolve() : reject();
      image.onerror = reject;
      image.src = item.url;
    }));
    void Promise.all(images).then(() => { if (!disposed) setAssets('ready'); }, () => { if (!disposed) setAssets('failed'); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    const last = previous.current;
    previous.current = { state, runKey };
    let disposed = false;
    // Mounting/restoring an old result is never a new completion event.
    if (state === 'complete' && last && last.state !== 'complete' && last.state !== 'error' && last.runKey === runKey && runKey && playing) {
      if (example) setCelebration(value => value + 1);
      else void claimCompletion(runKey).then(allowed => { if (allowed && !disposed) setCelebration(value => value + 1); });
    }
    return () => { disposed = true; };
  }, [state, runKey, playing, example]);

  useEffect(() => {
    const element = reactionElement.current;
    if (!canReact || !playing || assets !== 'ready' || !element) {
      lastReactionTransform.current = undefined;
      if (canReact) reaction.current = touches;
      return;
    }
    if (touches === reaction.current) return;
    reaction.current = touches;
    // A touch acknowledges the user without replacing the current task clip.
    const from = lastReactionTransform.current ?? getComputedStyle(element).transform;
    const animation = element.animate([
      { transform: from },
      { transform: 'rotate(-2deg) translateY(-1px)', offset: .4 },
      { transform: 'none' },
    ], { duration: 380, easing: 'ease-in-out' });
    lastReactionTransform.current = undefined;
    return () => {
      lastReactionTransform.current = getComputedStyle(element).transform;
      animation.cancel();
    };
  }, [touches, canReact, playing, assets]);

  useEffect(() => {
    const element = sprite.current;
    const between = cellBlend.current;
    if (!element || assets !== 'ready') return;
    const still = stillFor(state);
    let cancelled = false;
    let animation: Animation | undefined;
    let cells: Animation[] = [];
    let blend: Animation | undefined;
    const stopCells = () => { cells.forEach(item => item.cancel()); cells = []; };
    const paint = (sheet: Sheet, frame: number) => {
      const previous = previousPose.current;
      const next = poseStyle(sheet, frame);
      // Fade the last rendered pose, including a frame interrupted mid-clip.
      // The task state updates immediately; only its artwork settles in.
      // This also covers one clip ending and the next starting on the same sheet.
      const rendered = lastRenderedPose.current ?? getComputedStyle(element);
      if (playing && currentSheet.current && previous && (currentSheet.current !== sheet || rendered.backgroundPosition !== next.backgroundPosition)) {
        Object.assign(previous.style, {
          backgroundImage: rendered.backgroundImage,
          backgroundPosition: rendered.backgroundPosition,
          backgroundSize: rendered.backgroundSize,
          transform: rendered.transform,
        });
        blend?.cancel();
        // Different artwork overlaps badly (a double exposure), so a sheet change
        // fades fast and relies on the body settle; a same-sheet change blends longer.
        const sheetChanged = currentSheet.current !== sheet;
        blend = previous.animate([{ opacity: 1 }, { opacity: 0 }], { duration: sheetChanged ? 90 : 140, easing: 'cubic-bezier(0.2, 0, 0.1, 1)', fill: 'forwards' });
      }
      Object.assign(element.style, next);
      currentSheet.current = sheet;
      lastRenderedPose.current = null;
    };
    if (!playing) {
      paint(...still);
      element.dataset.clip = 'still';
      return;
    }
    const play = async (name: string) => {
      if (cancelled) return;
      const clip = clips[name];
      animation?.cancel();
      stopCells();
      element.dataset.clip = name;
      paint(clip.sheet, clip.frames[0][0]);
      // A new clip gets a small body settle so the pose change reads as movement;
      // a repeated blink/work loop does not, so a settled pet schedules no frames.
      if (name !== lastClip.current && name !== 'blink' && name !== 'held') kick.current(name === 'receive' || name === 'complete' ? 'hop' : 'nudge', name === 'receive' ? 0.7 : name === 'complete' ? 1 : name === 'greet' ? 0.5 : 0.25);
      lastClip.current = name;
      const duration = clip.frames.reduce((sum, frame) => sum + frame[1], 0);
      let offset = 0;
      const frames: Keyframe[] = [];
      const lagged: Keyframe[] = [];
      const fades: Keyframe[] = [{ opacity: 0, offset: 0 }];
      clip.frames.forEach(([frame, ms], index) => {
        const pose = poseStyle(clip.sheet, frame);
        frames.push({ backgroundPosition: pose.backgroundPosition, transform: pose.transform, offset: offset / duration, easing: 'steps(1, end)' });
        const before = clip.frames[index - 1]?.[0];
        if (before !== undefined && before !== frame) {
          // The outgoing cell sits on top and fades, so a cell never pops in.
          const out = poseStyle(clip.sheet, before);
          lagged.push({ backgroundPosition: out.backgroundPosition, transform: out.transform, offset: offset / duration, easing: 'steps(1, end)' });
          fades.push({ opacity: 0, offset: offset / duration }, { opacity: 1, offset: offset / duration, easing: 'ease-out' }, { opacity: 0, offset: Math.min(1, (offset + blendFor(ms)) / duration) });
        }
        offset += ms;
      });
      const last = poseStyle(clip.sheet, clip.frames.at(-1)![0]);
      frames.push({ backgroundPosition: last.backgroundPosition, transform: last.transform, offset: 1 });
      animation = element.animate(frames, { duration, fill: 'forwards' });
      if (between && lagged.length) {
        between.style.backgroundImage = last.backgroundImage;
        between.style.backgroundSize = last.backgroundSize;
        lagged.unshift({ ...lagged[0], offset: 0 });
        lagged.push({ ...lagged.at(-1)!, offset: 1 });
        fades.push({ opacity: 0, offset: 1 });
        cells = [between.animate(lagged, { duration }), between.animate(fades, { duration })];
      }
      try { await animation.finished; } catch { /* Visibility/state change cancels playback. */ }
      if (!cancelled) { Object.assign(element.style, poseStyle(clip.sheet, clip.frames.at(-1)![0])); animation.cancel(); stopCells(); }
    };
    void (async () => {
      if (held) {
        // Being carried temporarily replaces any task pose; it resumes on release.
        while (!cancelled) await play('held');
        return;
      }
      if (state === 'idle' && idleInteraction !== reaction.current) {
        reaction.current = idleInteraction;
        await play('greet');
      }
      if (cancelled) return;
      if (state === 'complete' && celebration > consumed.current) {
        consumed.current = celebration;
        await play('complete');
      } else if (state === 'receive') await play('receive');
      else if (state === 'waiting') { await play('waiting'); return; }
      else if (state === 'error') { paint(...still); element.dataset.clip = 'still'; return; }
      else if (state === 'idle' && !greeted.current) { greeted.current = true; await play('greet'); }
      let cycle = 0;
      while (!cancelled) {
        await play(state === 'working' ? 'working' : state === 'planning' ? 'planning' : ++cycle % 6 === 0 ? 'stretch' : 'blink');
      }
    })();
    return () => {
      cancelled = true;
      const rendered = getComputedStyle(element);
      lastRenderedPose.current = { backgroundImage: rendered.backgroundImage, backgroundPosition: rendered.backgroundPosition, backgroundSize: rendered.backgroundSize, transform: rendered.transform };
      animation?.cancel(); stopCells(); blend?.cancel();
    };
  }, [assets, state, runKey, playing, idleInteraction, celebration, held]);

  return <span ref={ref} className={`companion-pet ${!playing ? 'companion-paused' : ''}`} data-state={state} data-playing={playing && assets === 'ready'} data-assets={assets} data-reduced={reduced}>
    {assets === 'ready' ? <span ref={motionElement} className="companion-motion"><span ref={stanceElement} className="companion-stance"><span ref={reactionElement} className="companion-reaction"><span className="companion-body"><span ref={sprite} className="companion-sprite" role="img" aria-label="함께 일하는 펫" /><span ref={cellBlend} className="companion-cell-blend" aria-hidden="true" /><span ref={previousPose} className="companion-sprite companion-previous-pose" aria-hidden="true" /></span></span></span></span> : <Pet paused={paused || !playing} motion={fallbackMotion[state]} />}
  </span>;
}
