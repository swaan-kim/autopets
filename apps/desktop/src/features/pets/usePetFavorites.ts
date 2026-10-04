import { useEffect, useState } from 'react';

// UI-only preference: IDs, never chat contents, instructions or execution settings.
const KEY = 'autopets.pet-favorites.v1';
const CHANGED = 'autopets:pet-favorites-changed';
function readFavorites(): string[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !Array.isArray(value.ids) || value.ids.length > 200 || value.ids.some((id: unknown) => typeof id !== 'string' || !/^(template|saved):[\w-]{1,100}$/.test(id))) throw Error('invalid favorites');
  return [...new Set<string>(value.ids)];
}

export function usePetFavorites() {
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = () => {
      try { setIds(readFavorites()); setError(''); }
      catch { setError('즐겨찾기를 불러오지 못했어요. 펫 준비는 계속할 수 있어요.'); }
    };
    const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) refresh(); };
    refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGED, refresh);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(CHANGED, refresh); };
  }, []);
  const toggle = (id: string) => {
    try {
      // Read again so another window's latest choice is preserved.
      const current = readFavorites();
      const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
      if (next.length > 200) throw Error('favorites full');
      localStorage.setItem(KEY, JSON.stringify({ version: 1, ids: next }));
      setIds(next); setError('');
      window.dispatchEvent(new Event(CHANGED));
    } catch { setError('즐겨찾기를 저장하지 못했어요. 기존 목록은 그대로 두었어요.'); }
  };
  return { ids, error, toggle };
}
