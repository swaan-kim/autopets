import { useEffect, useRef, useState } from 'react';
import type { AssistanceSnapshot } from '@autopets/contracts/types';
import { command } from './command';
import { EMPTY_ASSISTANCE } from './defaults';

export function useAssistance() {
  const [snapshot, setSnapshot] = useState<AssistanceSnapshot>(EMPTY_ASSISTANCE);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const active = useRef(false);
  const alive = useRef(true);
  const refresh = async () => {
    if (active.current) return;
    active.current = true;
    try { const next = await command<AssistanceSnapshot>('get_assistance'); if (alive.current) { setSnapshot(next); setError(''); setLoaded(true); } }
    catch (cause) { if (alive.current) setError(String(cause)); }
    finally { active.current = false; }
  };
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => { alive.current = false; clearInterval(timer); };
  }, []);
  return { snapshot, error, loaded, refresh };
}
