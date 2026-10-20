import { useEffect, useRef, useState, type CSSProperties } from 'react';
import sheets from '../../../public/assets/companion-v1/manifest.json';
import { Pet, type PetMotion } from './Pet';
import { claimCompletion, type CompanionState } from './companionMotion';
import { usePetVisibility } from './usePetVisibility';
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
  working: { sheet: 'paws', frames: [...Array.from({ length: 24 }, (_, i) => [[0, 1, 2, 1][i % 4], 135] as Frame), [1, 1200]] },
  waiting: { sheet: 'notes', frames: [[4, 240], [5, 300], [6, 400], [7, 600]] },
  complete: { sheet: 'paws', frames: [[4, 250], [3, 340], [4, 300], [5, 700]] },
};
const stillFor = (state: CompanionState): [Sheet, number] => state === 'working' ? ['paws', 1] : state === 'planning' || state === 'error' ? ['notes', 0] : state === 'waiting' ? ['notes', 7] : ['social', 0];
function poseStyle(sheet: Sheet, frame: number): CSSProperties {
  const item = sheets.sheets[sheet];
  return { backgroundImage: `url(${item.url})`, backgroundSize: `${item.columns * 100}% ${item.rows * 100}%`, backgroundPosition: `${frame % item.columns / (item.columns - 1) * 100}% ${Math.floor(frame / item.columns) / (item.rows - 1) * 100}%` };
}
const fallbackMotion: Record<CompanionState, PetMotion> = { idle: 'idle', receive: 'idle', planning: 'thinking', working: 'writing', waiting: 'dizzy', complete: 'idle', error: 'angry' };

export function CompanionPet({ state = 'idle', paused = false, runKey, interaction = 0, example = false }: { state?: CompanionState; paused?: boolean; runKey?: string; interaction?: number; example?: boolean }) {
  const { ref, playing, reduced } = usePetVisibility(!paused);
  const sprite = useRef<HTMLSpanElement>(null);
  const [assets, setAssets] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [celebration, setCelebration] = useState(0);
  const previous = useRef<{ state: CompanionState; runKey?: string } | undefined>(undefined);
  const consumed = useRef(0);
  const greeted = useRef(false);
  const reaction = useRef(0);

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
    const element = sprite.current;
    if (!element || assets !== 'ready') return;
    const still = stillFor(state);
    Object.assign(element.style, poseStyle(...still));
    element.dataset.clip = 'still';
    if (!playing) return;
    let cancelled = false;
    let animation: Animation | undefined;
    let hop: Animation | undefined;
    const play = async (name: string) => {
      if (cancelled) return;
      const clip = clips[name];
      animation?.cancel();
      element.dataset.clip = name;
      Object.assign(element.style, poseStyle(clip.sheet, clip.frames[0][0]));
      const duration = clip.frames.reduce((sum, frame) => sum + frame[1], 0);
      let offset = 0;
      const frames: Keyframe[] = clip.frames.map(([frame, ms]) => {
        const keyframe = { backgroundPosition: poseStyle(clip.sheet, frame).backgroundPosition as string, offset: offset / duration, easing: 'steps(1, end)' };
        offset += ms;
        return keyframe;
      });
      frames.push({ backgroundPosition: poseStyle(clip.sheet, clip.frames.at(-1)![0]).backgroundPosition as string, offset: 1 });
      animation = element.animate(frames, { duration, fill: 'forwards' });
      if (name === 'complete') hop = element.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)', offset: .35 }, { transform: 'translateY(0)', offset: .65 }], { duration: 890, easing: 'ease-out' });
      if (name === 'receive') hop = element.animate([{ transform: 'translateX(-12px)' }, { transform: 'translateX(0)' }], { duration, easing: 'ease-out' });
      try { await animation.finished; } catch { /* Visibility/state change cancels playback. */ }
      if (!cancelled) { Object.assign(element.style, poseStyle(clip.sheet, clip.frames.at(-1)![0])); animation.cancel(); }
    };
    void (async () => {
      if (interaction !== reaction.current && state !== 'error') { reaction.current = interaction; await play('greet'); }
      if (cancelled) return;
      if (state === 'complete' && celebration > consumed.current) {
        consumed.current = celebration;
        await play('complete');
      } else if (state === 'receive') await play('receive');
      else if (state === 'waiting') { await play('waiting'); return; }
      else if (state === 'error') return;
      else if (state === 'idle' && !greeted.current) { greeted.current = true; await play('greet'); }
      let cycle = 0;
      while (!cancelled) {
        await play(state === 'working' ? 'working' : state === 'planning' ? 'planning' : ++cycle % 6 === 0 ? 'stretch' : 'blink');
      }
    })();
    return () => { cancelled = true; animation?.cancel(); hop?.cancel(); };
  }, [assets, state, runKey, playing, interaction, celebration]);

  return <span ref={ref} className={`companion-pet ${!playing ? 'companion-paused' : ''}`} data-state={state} data-playing={playing && assets === 'ready'} data-assets={assets} data-reduced={reduced}>
    {assets === 'ready' ? <span ref={sprite} className="companion-sprite" role="img" aria-label="함께 일하는 제작 펫" /> : <Pet paused={paused || !playing} motion={fallbackMotion[state]} />}
  </span>;
}
