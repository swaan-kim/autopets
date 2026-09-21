import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { Snapshot } from '@autopets/contracts/types';
import { command, isDesktop } from './command';

export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    let bridgeFailure = '';
    let refreshing = false;
    const disposers: (() => void)[] = [];
    const accept = (next: Snapshot) => {
      if (alive) setSnapshot(previous => !previous || next.now >= previous.now ? next : previous);
    };
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try { accept(await command<Snapshot>('get_snapshot')); if (alive) setError(bridgeFailure); }
      catch (cause) { if (alive) setError(String(cause)); }
      finally { refreshing = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    if (isDesktop) {
      const register = <T,>(event: string, callback: (payload: T) => void) => {
        void listen<T>(event, event => callback(event.payload)).then(dispose => { if (alive) disposers.push(dispose); else dispose(); }).catch(cause => { if (alive) setError(String(cause)); });
      };
      register<Snapshot>('autopets://snapshot', accept);
      register<string>('autopets://error', message => { bridgeFailure = message; if (alive) setError(message); });
    }
    return () => { alive = false; clearInterval(timer); disposers.forEach(dispose => dispose()); };
  }, []);
  return { snapshot, error };
}
