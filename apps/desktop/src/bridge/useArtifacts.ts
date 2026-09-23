import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { ArtifactRequest, ArtifactSnapshot } from '@autopets/contracts/types';
import { command, isDesktop } from './command';
import { EMPTY_ARTIFACTS } from '../features/intro/defaults';

export function useArtifacts() {
  const [snapshot, setSnapshot] = useState<ArtifactSnapshot>(EMPTY_ARTIFACTS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const refreshing = useRef(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const refresh = async (quiet = false) => {
    if (working.current || refreshing.current) return;
    refreshing.current = true;
    const ticket = generation.current;
    try {
      const next = await command<ArtifactSnapshot>('artifact_snapshot');
      if (alive.current && ticket === generation.current) { setSnapshot(next); setLoaded(true); if (!quiet) setError(''); }
    } catch (cause) { if (alive.current && ticket === generation.current) setError(String(cause)); }
    finally { refreshing.current = false; if (alive.current && ticket !== generation.current && !working.current) void refresh(quiet); }
  };
  useEffect(() => {
    alive.current = true;
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(true), 300); };
    void refresh();
    window.addEventListener('focus', schedule);
    if (isDesktop) void listen('autopets://snapshot', schedule).then(dispose => { if (alive.current) unlisten = dispose; else dispose(); }).catch(() => { /* Visible refresh remains available when window events fail. */ });
    return () => { alive.current = false; generation.current++; clearTimeout(timer); window.removeEventListener('focus', schedule); unlisten?.(); };
  }, []);
  const dispatch = async (request: ArtifactRequest): Promise<ArtifactSnapshot | null> => {
    if (working.current) return null;
    working.current = true; generation.current++; setBusy(true); setError('');
    try {
      const next = await command<ArtifactSnapshot>('artifact_dispatch', { request });
      if (alive.current) setSnapshot(next);
      return next;
    } catch (cause) {
      // Keep the visible error after refreshing; a concurrent edit must not be hidden.
      try { const next = await command<ArtifactSnapshot>('artifact_snapshot'); if (alive.current) setSnapshot(next); } catch { /* Original failure is more useful. */ }
      if (alive.current) setError(`저장하지 못했어요. 최신 상태를 확인한 뒤 다시 시도해주세요. ${String(cause)}`);
      return null;
    } finally { working.current = false; if (alive.current) setBusy(false); }
  };
  return { snapshot, loaded, error, busy, refresh, dispatch };
}
