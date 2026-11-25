import type { ReactNode } from 'react';
import type { DockBadge, DockEdge } from './usePetDock';
import './pet-dock.css';

// The small tab a pet leaves on the screen edge. Hovering lets the pet peek out a little;
// only a click brings it back. A badge says a choice is waiting or a task finished.
// `progress`: the linked Codex chat has been working for a while (see turnProgress.tsx) — the plan's
// share fills the inner edge, or the minutes show when there is no plan.
export function PetDockHandle({ edge, name, badge, restoring, error, onRestore, progress, children }: {
  edge: DockEdge; name: string; badge: DockBadge; restoring: boolean; error?: string; onRestore: () => void;
  progress?: { text: string; minutes: number; ratio: number | null } | null; children?: ReactNode;
}) {
  const badgeText = badge === 'ask' ? '선택 필요' : badge === 'done' ? '완료' : badge === 'codex-ask' ? 'Codex 확인 필요' : badge === 'codex-done' ? 'Codex 작업 완료' : badge === 'review' ? '복습할 문제 있음' : '';
  const status = [badgeText, progress?.text].filter(Boolean).join(' · ');
  return <div className={`pet-dock dock-${edge}`}>
    <button type="button" className="pet-dock-tab" aria-label={`${name} 다시 보기${status ? ` · ${status}` : ''}`} aria-busy={restoring || undefined}
      title={error || `${name}${status ? ` · ${status}` : ''} · 클릭하면 다시 나타나요`} onClick={() => { if (!restoring) onRestore(); }}>
      <span className="pet-dock-peek" aria-hidden="true">{children}</span>
      <span className="pet-dock-arrow" aria-hidden="true">{edge === 'right' ? '‹' : '›'}</span>
      {badge && <span className={`pet-dock-badge ${badge}`} aria-hidden="true">{badge === 'ask' ? '!' : badge === 'codex-ask' ? '?' : badge === 'review' ? '↻' : '✓'}</span>}
      {progress && (progress.ratio !== null
        ? <span className="pet-dock-progress" aria-hidden="true"><i style={{ height: `${Math.round(progress.ratio * 100)}%` }} /></span>
        : <span className="pet-dock-minutes" aria-hidden="true">{progress.minutes < 60 ? `${progress.minutes}′` : `${Math.floor(progress.minutes / 60)}h`}</span>)}
    </button>
  </div>;
}
