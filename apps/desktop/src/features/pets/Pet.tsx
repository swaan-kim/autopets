import { useEffect, useState, type CSSProperties } from 'react';
import type { Activity } from '@autopets/contracts/types';
import { PET_NAMES } from './constants';
import manifest from '../../../public/assets/motions/manifest.json';
import softManifest from '../../../public/assets/soft-pet/manifest.json';
import './pet-motion.css';

export const PET_SPRITE_URL = '/assets/motions/sprite.png';
export const SOFT_PET_URL = '/assets/soft-pet/poses.png';
export type PetMotion = keyof typeof manifest.animations;
const poses = { idle: 'idle', research: 'planning', thinking: 'planning', writing: 'working', tool: 'working', dizzy: 'waiting', celebrate: 'complete', angry: 'error' } as const;

// Pre-rendered poses animate in CSS; only the legacy fallback needs a frame timer.
export function Pet({ index = 0, activity = 'idle', motion, small = false, paused = false }: {
  index?: number; activity?: Activity; motion?: PetMotion; small?: boolean; paused?: boolean;
}) {
  const [assetState, setAssetState] = useState<'loading' | 'soft' | 'legacy' | 'missing'>('loading');
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [tick, setTick] = useState(0);
  const selected = motion ?? (activity === 'working' ? 'writing' : activity === 'research' || activity === 'writing' || activity === 'tool' ? activity : 'idle');
  const animation = manifest.animations[selected];
  useEffect(() => {
    const source = new Image();
    const fallback = () => {
      source.onload = () => setAssetState(source.naturalWidth === 256 && source.naturalHeight === 320 ? 'legacy' : 'missing');
      source.onerror = () => setAssetState('missing');
      source.src = PET_SPRITE_URL;
    };
    source.onload = () => source.naturalWidth === softManifest.width && source.naturalHeight === softManifest.height ? setAssetState('soft') : fallback();
    source.onerror = fallback;
    source.src = SOFT_PET_URL;
    return () => { source.onload = null; source.onerror = null; };
  }, []);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    setTick(0);
    if (paused || reduced || hidden || animation.frames.length < 2 || assetState !== 'legacy') return;
    const timer = setInterval(() => setTick(value => (value + 1) % animation.frames.length), 1000 / animation.fps);
    return () => clearInterval(timer);
  }, [selected, paused, reduced, hidden, assetState]);
  const still = paused || reduced || hidden;
  const pose = poses[selected];
  const soft = assetState === 'soft';
  const frame = soft ? softManifest.poses[pose] : still ? animation.stillFrame : animation.frames[tick % animation.frames.length];
  const columns = soft ? softManifest.columns : 4;
  const rows = soft ? softManifest.rows : 5;
  const style = { backgroundImage: `url(${soft ? SOFT_PET_URL : PET_SPRITE_URL})`, backgroundSize: `calc(var(--frame) * ${columns}) calc(var(--frame) * ${rows})`, backgroundPosition: `calc(var(--frame) * ${-(frame % columns)}) calc(var(--frame) * ${-Math.floor(frame / columns)})`, ...(soft ? {} : { animation: 'none' }) } as CSSProperties;
  return <span className={`pet-art ${small ? 'small' : ''}`} data-pet={index} data-motion={selected} data-frame={frame} data-asset={assetState}>
    {assetState === 'soft' || assetState === 'legacy'
      ? <span key={`${assetState}-${selected}`} role="img" aria-label={`${PET_NAMES[index % 3]} 펫`} className={`pet-sprite sprite-${selected} ${soft ? `pet-soft pose-${pose}` : ''} ${still ? 'sprite-paused' : ''}`} style={style} />
      : <span className="pet-placeholder" role="img" aria-label={assetState === 'missing' ? '펫 이미지 없음' : '펫 이미지 불러오는 중'}>
        <span aria-hidden="true">◇</span><small>{assetState === 'missing' ? '펫 이미지 없음' : '이미지 불러오는 중'}</small>
      </span>}
  </span>;
}
