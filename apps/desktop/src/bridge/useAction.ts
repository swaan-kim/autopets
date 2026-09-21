import { useRef, useState } from 'react';
import { command } from './command';

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const run = async (name: string, args?: Record<string, unknown>) => {
    if (active.current) return false;
    active.current = true; setBusy(true); setError('');
    try { await command(name, args); return true; }
    catch (cause) { setError(String(cause)); return false; }
    finally { active.current = false; setBusy(false); }
  };
  return { busy, error, run };
}
