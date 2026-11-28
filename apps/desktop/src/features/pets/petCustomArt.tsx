import type { CSSProperties, ReactNode } from 'react';
import sheets from '../../../public/assets/companion-v1/manifest.json';

/**
 * Where each slot's item sits on the still pet, in % of the pet box: the item's centre (x, y)
 * and its width. Background fills the box behind the pet. Tune positions here only.
 */
export const slotPlacement: Record<string, { x: number; y: number; width: number }> = {
  head: { x: 50, y: 12, width: 30 },
  face: { x: 50, y: 42, width: 42 },
  neck: { x: 50, y: 64, width: 40 },
  background: { x: 50, y: 50, width: 100 },
};
/** Per-item nudges on top of the slot placement (same units). */
const itemPlacement: Record<string, Partial<{ x: number; y: number; width: number }>> = {
  ribbon: { x: 66, y: 13, width: 26 },
  'yellow-ribbon': { x: 66, y: 13, width: 26 },
  sprout: { y: 8, width: 22 },
  hat: { y: 15, width: 42 },
  crown: { y: 11, width: 30 },
};

const ribbon = (wing: string, knot: string) => <><path d="M16 16C9 8 3 10 3 16s6 8 13 0Z" fill={wing} /><path d="M16 16c7-8 13-6 13 0s-6 8-13 0Z" fill={wing} /><circle cx="16" cy="16" r="3.4" fill={knot} /></>;
const icons: Record<string, ReactNode> = {
  ribbon: ribbon('#ef6f8f', '#d9486d'),
  'yellow-ribbon': ribbon('#f4b740', '#d99a1f'),
  sprout: <><path d="M16 28V16" stroke="#5fae5f" strokeWidth="3" strokeLinecap="round" /><path d="M16 17C9 17 5 12 5 6c7 0 11 5 11 11Z" fill="#7cc673" /><path d="M16 17c7 0 11-5 11-11-7 0-11 5-11 11Z" fill="#96d58a" /></>,
  glasses: <><circle cx="9.5" cy="17" r="5.5" fill="#fff" stroke="#3b4046" strokeWidth="2.4" /><circle cx="22.5" cy="17" r="5.5" fill="#fff" stroke="#3b4046" strokeWidth="2.4" /><path d="M15 16.5q1-1.4 2 0" fill="none" stroke="#3b4046" strokeWidth="2.2" strokeLinecap="round" /></>,
  scarf: <><path d="M5 11q11 6 22 0v6q-11 6-22 0Z" fill="#e2574c" /><path d="M19 18.6l6-1.2v10l-6 1Z" fill="#c9443a" /></>,
  hat: <><path d="M6 20a10 10 0 0 1 20 0Z" fill="#4c7fd6" /><path d="M4 20h20q5 0 5 3H4Z" fill="#3966b8" /><circle cx="16" cy="9.6" r="1.8" fill="#3966b8" /></>,
  crown: <><path d="M5 24l-1.5-13 7 6L16 7l5.5 10 7-6L27 24Z" fill="#f4b740" /><rect x="5" y="23" width="22" height="3.6" rx="1.4" fill="#d99a1f" /></>,
  'night-sky': <><rect x="3" y="5" width="26" height="22" rx="6" fill="#2b3157" /><circle cx="21" cy="12" r="3.6" fill="#ffd866" /><circle cx="10" cy="11" r="1" fill="#fff" /><circle cx="13" cy="19" r="1.2" fill="#fff" /><circle cx="23" cy="21" r=".9" fill="#fff" /></>,
};

export function ItemIcon({ id, className }: { id: string; className?: string }) {
  return <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">{icons[id]}</svg>;
}

// The pet's resting pose: the first cell of the social sheet, as the floating pet uses.
const still = sheets.sheets.social;
const [shiftX, shiftY, scale] = sheets.registration.cells.social[0];
const stillStyle: CSSProperties = {
  backgroundImage: `url(${still.url})`, backgroundSize: `${still.columns * 100}% ${still.rows * 100}%`, backgroundPosition: '0% 0%',
  transform: `translate(${shiftX}%, ${shiftY}%) scale(${scale})`,
};

/** The still pet with worn items drawn over it. `silhouette` draws the shape only (undiscovered stages). */
export function PetDressed({ worn = {}, slots, size, silhouette = false, className = '' }: { worn?: Record<string, string>; slots: { id: string; slot: string }[]; size: number; silhouette?: boolean; className?: string }) {
  const items = silhouette ? [] : Object.values(worn).map(id => slots.find(item => item.id === id)).filter((item): item is { id: string; slot: string } => !!item);
  const place = (item: { id: string; slot: string }): CSSProperties => {
    const spot = { ...slotPlacement[item.slot], ...itemPlacement[item.id] };
    return { left: `${spot.x}%`, top: `${spot.y}%`, width: `${spot.width}%` };
  };
  const background = items.find(item => item.slot === 'background');
  return <span className={`pet-dressed${silhouette ? ' is-silhouette' : ''} ${className}`.trim()} style={{ '--pet-dressed-size': `${size}px` } as CSSProperties} aria-hidden="true">
    {background && <ItemIcon id={background.id} className="pet-dressed-background" />}
    <span className="pet-dressed-body" style={stillStyle} />
    {items.filter(item => item.slot !== 'background').map(item => <span key={item.id} className="pet-dressed-item" data-item={item.id} style={place(item)}><ItemIcon id={item.id} /></span>)}
  </span>;
}
