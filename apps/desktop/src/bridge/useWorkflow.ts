import { useEffect, useRef, useState } from 'react';
import type { WorkflowSnapshot } from '@autopets/contracts/types';
import { command } from './command';
import { EMPTY_WORKFLOW } from '../features/workflow/defaults';

export function useWorkflow() {
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot>(EMPTY_WORKFLOW);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const active = useRef(false);
  const alive = useRef(true);
  const refresh = async () => {
    if (active.current) return;
    active.current = true;
    try {
      const next = await command<WorkflowSnapshot>('workflow_snapshot');
      if (!next?.preferences || !Array.isArray(next.tasks) || !next.capabilities) throw new Error('계획 설정 연결을 확인해주세요.');
      if (alive.current) { setSnapshot(next); setError(''); setLoaded(true); }
    } catch { if (alive.current) setError('계획 설정을 불러오지 못했어요. 기존 채팅은 계속 사용할 수 있어요.'); }
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
