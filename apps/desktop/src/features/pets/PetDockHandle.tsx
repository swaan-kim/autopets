import type { ReactNode } from 'react';
import type { DockBadge, DockEdge } from './usePetDock';
import './pet-dock.css';

// The small tab a pet leaves on the screen edge. Hovering lets the pet peek out a little;
// only a click brings it back. A badge says a choice is waiting or a task finished.
export function PetDockHandle({ edge, name, badge, restoring, error, onRestore, children }: {
  edge: DockEdge; name: string; badge: DockBadge; restoring: boolean; error?: string; onRestore: () => void; children?: ReactNode;
}) {
  const badgeText = badge === 'ask' ? '선택 필요' : badge === 'done' ? '완료' : badge === 'codex-ask' ? 'Codex 확인 필요' : badge === 'codex-done' ? 'Codex 작업 완료' : '';
  return <div className={`pet-dock dock-${edge}`}>
    <button type="button" className="pet-dock-tab" aria-label={`${name} 다시 보기${badgeText ? ` · ${badgeText}` : ''}`} aria-busy={restoring || undefined}
      title={error || `${name}${badgeText ? ` · ${badgeText}` : ''} · 클릭하면 다시 나타나요`} onClick={() => { if (!restoring) onRestore(); }}>
      <span className="pet-dock-peek" aria-hidden="true">{children}</span>
      <span className="pet-dock-arrow" aria-hidden="true">{edge === 'right' ? '‹' : '›'}</span>
      {badge && <span className={`pet-dock-badge ${badge}`} aria-hidden="true">{badge === 'ask' ? '!' : badge === 'codex-ask' ? '?' : '✓'}</span>}
    </button>
  </div>;
}
