import { useEffect, useState } from 'react';
import type { PetLink } from '@autopets/contracts/types';

const PREFIX = 'autopets.task-label.v1.';
// Presentation only: hashed exact identity, no request content or execution authority.
export function useTaskLabel(target: PetLink['target']) {
  const scope = JSON.stringify([target.sourceId, target.threadId, target.cwd.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase()]);
  const [record, setRecord] = useState({ scope: '', key: '', label: '' });
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setError('');
    const read = (key: string) => {
      try {
        const label = localStorage.getItem(key) ?? '';
        if (live) setRecord({ scope, key, label: label.slice(0, 72).replace(/[\p{Cc}]/gu, '') });
      } catch { if (live) setError('작업 이름을 저장할 수 없어요.'); }
    };
    let key = '';
    void Promise.resolve().then(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope))).then(hash => {
      key = PREFIX + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      read(key);
    }).catch(() => { if (live) setError('작업 이름을 저장할 수 없어요.'); });
    const changed = (event: StorageEvent) => { if (key && (event.key === key || event.key === null)) read(key); };
    window.addEventListener('storage', changed);
    return () => { live = false; window.removeEventListener('storage', changed); };
  }, [scope]);
  return {
    label: record.scope === scope ? record.label : '', ready: record.scope === scope && Boolean(record.key), error,
    setLabel: (value: string) => {
      if (record.scope !== scope || !record.key) return;
      const label = value.slice(0, 72).replace(/[\p{Cc}]/gu, '');
      try {
        if (label.trim()) localStorage.setItem(record.key, label.trim()); else localStorage.removeItem(record.key);
        setRecord({ ...record, label }); setError('');
      } catch { setError('작업 이름을 저장할 수 없어요.'); }
    },
  };
}
