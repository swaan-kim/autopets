import { useEffect, useState } from 'react';
import type { Activity } from '@autopets/contracts/types';
import { PET_NAMES } from './constants';
import manifest from '../../../public/assets/motions/manifest.json';

export const PET_SPRITE_URL = '/assets/motions/sprite.png';
export type PetMotion = keyof typeof manifest.animations;

// 256 × 320 atlas: eighteen 64px frames across eight reusable motions.
// Sprite frame changes carry the motion; the character is never stretched or rotated.
export function Pet({ index = 0, activity = 'idle', motion, small = false, paused = false }: {
  index?: number; activity?: Activity; motion?: PetMotion; small?: boolean; paused?: boolean;
}) {
  const [assetState, setAssetState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [tick, setTick] = useState(0);
  const selected = motion ?? (activity === 'working' ? 'writing' : activity === 'research' || activity === 'writing' || activity === 'tool' ? activity : 'idle');
  const animation = manifest.animations[selected];
  useEffect(() => {
    const source = new Image();
    source.onload = () => setAssetState(source.naturalWidth === 256 && source.naturalHeight === 320 ? 'ready' : 'missing');
    source.onerror = () => setAssetState('missing');
    source.src = PET_SPRITE_URL;
    return () => { source.onload = null; source.onerror = null; };
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    setTick(0);
    if (paused || reduced || animation.frames.length < 2 || assetState !== 'ready') return;
    const timer = setInterval(() => setTick(value => (value + 1) % animation.frames.length), 1000 / animation.fps);
    return () => clearInterval(timer);
  }, [selected, paused, reduced, assetState]);
  const frame = paused || reduced ? animation.stillFrame : animation.frames[tick % animation.frames.length];
  const size = small ? 64 : 128;
  return <span className={`pet-art ${small ? 'small' : ''}`} data-pet={index} data-motion={selected} data-frame={frame}>
    {assetState === 'ready'
      ? <span role="img" aria-label={`${PET_NAMES[index % 3]} 펫`} className={`pet-sprite sprite-${selected} ${paused || reduced ? 'sprite-paused' : ''}`} style={{ backgroundImage: `url(${PET_SPRITE_URL})`, backgroundSize: `${size * 4}px ${size * 5}px`, backgroundPosition: `${-(frame % 4) * size}px ${-Math.floor(frame / 4) * size}px`, animation: 'none' }} />
      : <span className="pet-placeholder" role="img" aria-label={assetState === 'missing' ? '펫 이미지 없음' : '펫 이미지 불러오는 중'}>
        <span aria-hidden="true">◇</span><small>{assetState === 'missing' ? '펫 이미지 없음' : '이미지 불러오는 중'}</small>
      </span>}
  </span>;
}
