import type { PetLink } from '@autopets/contracts/types';

export type CompanionState = 'idle' | 'receive' | 'planning' | 'working' | 'waiting' | 'complete' | 'error';
export function companionState(link: PetLink, disconnected: boolean): CompanionState {
  if (disconnected || !link.connected || link.run?.trackingClosed) return 'error';
  const run = link.run;
  if (!run) return 'idle';
  if (run.state === 'complete') return 'complete';
  if (run.state === 'requested') return 'receive';
  if (run.state === 'working') return run.profile === 'plan' ? 'planning' : 'working';
  if (run.state === 'returned' || run.state === 'waiting') return 'waiting';
  return 'error';
}
export const companionRunKey = (link: PetLink) => link.run ? JSON.stringify([link.target.sourceId, link.target.threadId, link.target.cwd, link.run.id]) : undefined;

// Presentation receipt only. Never changes a task or claims that it completed.
// Hashes keep thread IDs and paths out of browser presentation preferences.
const KEY = 'autopets.companion-completions.v1';
export async function claimCompletion(runKey: string): Promise<boolean> {
  try {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(runKey)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const claim = () => {
      const raw = localStorage.getItem(KEY);
      const entries: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(entries) || !entries.every(item => typeof item === 'string')) return false;
      if (entries.includes(hash)) return false;
      localStorage.setItem(KEY, JSON.stringify([...entries.slice(-127), hash]));
      return true;
    };
    // Serialize manager/overlay views. Without a shared lock, omit celebration.
    return navigator.locks ? await navigator.locks.request(KEY, claim) : false;
  } catch { return false; }
}
