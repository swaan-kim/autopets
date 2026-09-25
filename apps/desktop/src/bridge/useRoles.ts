import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { PetRoleSnapshot } from '@autopets/contracts/types';
import { command, isDesktop } from './command';
import templates from '../../../../packages/contracts/data/roles.json';

export const EMPTY_ROLES: PetRoleSnapshot = { templates: templates as PetRoleSnapshot['templates'], pets: [], bindings: [] };
export function useRoles() {
  const [snapshot, setSnapshot] = useState<PetRoleSnapshot>(EMPTY_ROLES);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(!isDesktop);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await command<PetRoleSnapshot>('roles_snapshot');
      if (!next || !Array.isArray(next.pets) || !Array.isArray(next.bindings) || !Array.isArray(next.templates)) throw new Error('roles unavailable');
      if (request === generation.current) { setSnapshot(next); setLoaded(true); setError(''); }
    } catch { if (request === generation.current) setError('저장한 펫을 불러오지 못했어요.'); }
  }, []);
  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | undefined;
    if (isDesktop) void listen('autopets://roles-changed', () => { void refresh(); }).then(fn => { if (disposed) fn(); else remove = fn; }).catch(() => {});
    void refresh();
    return () => { disposed = true; generation.current++; remove?.(); };
  }, [refresh]);
  return { snapshot, error, loaded, refresh };
}
