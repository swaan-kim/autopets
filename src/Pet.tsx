import { useEffect, useState } from 'react';
import { PET_NAMES, type Activity } from './types';

export const PET_SPRITE_URL = '/assets/pet/sprite.png';

// 256 × 128 PNG: four 64px idle frames, two research frames, two writing frames.
// Sprite frame changes carry the motion; the character is never stretched or rotated.
export function Pet({ index = 0, activity = 'idle', small = false, paused = false }: {
  index?: number; activity?: Activity; small?: boolean; paused?: boolean;
}) {
  const [assetState, setAssetState] = useState<'loading' | 'ready' | 'missing'>('loading');
  useEffect(() => {
    const source = new Image();
    source.onload = () => setAssetState(source.naturalWidth === 256 && source.naturalHeight === 128 ? 'ready' : 'missing');
    source.onerror = () => setAssetState('missing');
    source.src = PET_SPRITE_URL;
    return () => { source.onload = null; source.onerror = null; };
  }, []);
  const motion = activity === 'research' || activity === 'writing' ? activity : 'idle';
  return <span className={`pet-art ${small ? 'small' : ''}`} data-pet={index}>
    {assetState === 'ready'
      ? <span role="img" aria-label={`${PET_NAMES[index % 3]} 펫`} className={`pet-sprite sprite-${motion} ${paused ? 'sprite-paused' : ''}`} />
      : <span className="pet-placeholder" role="img" aria-label={assetState === 'missing' ? '펫 이미지 없음' : '펫 이미지 불러오는 중'}>
        <span aria-hidden="true">◇</span><small>{assetState === 'missing' ? '펫 이미지 없음' : '이미지 불러오는 중'}</small>
      </span>}
  </span>;
}
