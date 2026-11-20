import { useEffect, useState } from 'react';

// The AI the user mainly works in. Chosen once and remembered on this PC; the start button opens
// that AI. UI preference only: nothing about chats or accounts is stored.
export type PrimaryAi = 'codex' | 'claude-code';
export const AI_NAMES: Record<PrimaryAi, string> = { codex: 'Codex', 'claude-code': 'Claude Code' };
const KEY = 'autopets.primary-ai.v1';
const CHANGED = 'autopets:primary-ai-changed';

const read = (): PrimaryAi => { try { return localStorage.getItem(KEY) === 'claude-code' ? 'claude-code' : 'codex'; } catch { return 'codex'; } };

export function usePrimaryAi(): [PrimaryAi, (next: PrimaryAi) => void] {
  const [value, setValue] = useState<PrimaryAi>(read);
  useEffect(() => {
    const refresh = () => setValue(read());
    const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) refresh(); };
    // `storage` reaches the other windows (the floating pet); the custom event reaches this one.
    window.addEventListener('storage', onStorage); window.addEventListener(CHANGED, refresh);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(CHANGED, refresh); };
  }, []);
  const choose = (next: PrimaryAi) => {
    try { localStorage.setItem(KEY, next); } catch { /* the choice then lasts for this window only */ }
    setValue(next); window.dispatchEvent(new Event(CHANGED));
  };
  return [value, choose];
}
