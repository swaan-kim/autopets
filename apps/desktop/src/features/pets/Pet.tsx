import type { Activity } from '@autopets/contracts/types';
import manifest from '../../../public/assets/motions/manifest.json';
import { PET_NAMES } from './constants';
import { CompanionPet } from './CompanionPet';
import type { CompanionState } from './companionMotion';

// Keep existing import contracts while all product surfaces share one renderer.
export const PET_SPRITE_URL = '/assets/motions/sprite.png';
export const SOFT_PET_URL = '/assets/soft-pet/poses.png';
export type PetMotion = keyof typeof manifest.animations;
const states: Record<PetMotion, CompanionState> = { idle: 'idle', research: 'planning', thinking: 'planning', writing: 'working', tool: 'working', dizzy: 'waiting', celebrate: 'complete', angry: 'error' };

export function Pet({ index = 0, activity = 'idle', motion, small = false, paused = false }: {
  index?: number; activity?: Activity; motion?: PetMotion; small?: boolean; paused?: boolean;
}) {
  const selected = motion ?? (activity === 'working' ? 'writing' : activity === 'research' || activity === 'writing' || activity === 'tool' ? activity : 'idle');
  return <span className={'pet-art ' + (small ? 'small' : '')} data-pet={index} data-motion={selected} data-renderer="articulated" role="img" aria-label={PET_NAMES[index % 3] + ' 펫'}>
    <CompanionPet state={states[selected]} paused={paused} />
  </span>;
}
