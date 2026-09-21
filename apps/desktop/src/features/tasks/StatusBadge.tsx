import type { Session } from '@autopets/contracts/types';
import { status } from './presentation';

export function Badge({ session, now, disconnected = false }: { session: Session; now: number; disconnected?: boolean }) {
  const view = status(session, now, disconnected);
  return <span className={`status-badge ${view.kind}`}><i aria-hidden="true" />{view.text}</span>;
}
