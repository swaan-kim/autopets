import { useEffect, useRef, useState } from 'react';

// How the floating pets behave, chosen on 설정 → 펫 설정 and remembered on this PC.
// UI preference only (like primaryAi.ts): nothing about chats, tasks or accounts is stored, and
// every pet window reads the same value through `localStorage` + the `storage` event.
//
// `dockedAlert` — a pet tucked into a screen edge gets a notice (Codex finished / needs you, …):
//   jump  · it jumps back out and opens the bubble, and stays out
//   peek  · it jumps out with the bubble, then tucks back in after `peekSeconds` if left alone
//   badge · it stays tucked in; only the handle's badge changes (the old behaviour)
export type DockedAlert = 'jump' | 'peek' | 'badge';
export type AlertKind = 'done' | 'ask' | 'review';
export type Entrance = 'bounce' | 'slide';
export interface PetSettings {
  dockedAlert: DockedAlert;
  peekSeconds: number;
  alertOn: Record<AlertKind, boolean>;
  entrance: Entrance;
  /** A pet that is already out opens the bubble by itself for a new Codex notice. */
  bubbleWhenOut: boolean;
  /** "Codex 작업 중 · 12분째" under the pet once its chat has worked `progressAfterMinutes`. */
  showProgress: boolean;
  progressAfterMinutes: number;
}
export const PEEK_SECONDS = [5, 10, 30] as const;
export const PROGRESS_AFTER_MINUTES = [1, 2, 5] as const;
export const DEFAULT_PET_SETTINGS: PetSettings = {
  dockedAlert: 'jump', peekSeconds: 10, alertOn: { done: true, ask: true, review: false }, entrance: 'bounce', bubbleWhenOut: true,
  showProgress: true, progressAfterMinutes: 2,
};
const KEY = 'autopets.pet-settings.v1';
const CHANGED = 'autopets:pet-settings-changed';

const pick = <T,>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback;
const flag = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
export function readPetSettings(): PetSettings {
  const base = DEFAULT_PET_SETTINGS;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PetSettings> | null;
    if (!raw || typeof raw !== 'object') return base;
    const on = (raw.alertOn ?? {}) as Partial<Record<AlertKind, unknown>>;
    return {
      dockedAlert: pick(raw.dockedAlert, ['jump', 'peek', 'badge'] as const, base.dockedAlert),
      peekSeconds: pick(raw.peekSeconds, PEEK_SECONDS, base.peekSeconds as 10),
      alertOn: { done: flag(on.done, base.alertOn.done), ask: flag(on.ask, base.alertOn.ask), review: flag(on.review, base.alertOn.review) },
      entrance: pick(raw.entrance, ['bounce', 'slide'] as const, base.entrance),
      bubbleWhenOut: flag(raw.bubbleWhenOut, base.bubbleWhenOut),
      showProgress: flag(raw.showProgress, base.showProgress),
      progressAfterMinutes: pick(raw.progressAfterMinutes, PROGRESS_AFTER_MINUTES, base.progressAfterMinutes as 2),
    };
  } catch { return base; }
}

// "숨은 펫으로 시험해보기" on 펫 설정: the manager window writes a nonce, and each tucked-in pet
// window comes out as if a notice had arrived (`storage` only fires in the other windows).
const TRY_KEY = 'autopets.pet-settings.try';
export function requestPetSettingsTry() {
  try { localStorage.setItem(TRY_KEY, String(Date.now())); } catch { /* nothing to try then */ }
}
export function usePetSettingsTry(onTry: () => void) {
  const handler = useRef(onTry);
  handler.current = onTry;
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === TRY_KEY && event.newValue) handler.current(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}

export function usePetSettings(): [PetSettings, (next: PetSettings) => void] {
  const [value, setValue] = useState<PetSettings>(readPetSettings);
  useEffect(() => {
    const refresh = () => setValue(readPetSettings());
    const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) refresh(); };
    // `storage` reaches the other windows (the floating pets); the custom event reaches this one.
    window.addEventListener('storage', onStorage); window.addEventListener(CHANGED, refresh);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(CHANGED, refresh); };
  }, []);
  const save = (next: PetSettings) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* the choice then lasts for this window only */ }
    setValue(next); window.dispatchEvent(new Event(CHANGED));
  };
  return [value, save];
}
