import type { Session } from '@autopets/contracts/types';
import { useAction } from '../../bridge/useAction';
import { Clock } from '../../app/shared/Clock';
import { currentAction, dueAttention } from './presentation';
import { Badge } from './StatusBadge';
import { AttentionCard } from './AttentionCard';
import { TaskReturn } from './TaskReturn';

export function TaskDetails({ session, now, disconnected }: { session: Session; now: number; disconnected: boolean }) {
  const action = useAction();
  const attention = dueAttention(session, now);
  const observationEnd = session.turnEndedAt ?? (disconnected || session.connection !== 'observed' ? session.lastSeen : now);
  const elapsed = session.turnStartedAt ? Math.max(0, Math.floor((observationEnd - session.turnStartedAt) / 60000)) : null;
  const isNotion = session.lastTool?.toLowerCase().includes('notion');
  return <div className="task-details">
    <div className="detail-status"><Badge session={session} now={now} disconnected={disconnected} /><span className="muted">마지막 관측 <Clock stamp={session.lastSeen} /></span></div>
    {attention && <AttentionCard key={`${attention.id}-${attention.snoozedUntil ?? 0}`} session={session} attention={attention} />}
    {!attention && session.attention?.snoozedUntil && <p className="snooze-note">알림을 <Clock stamp={session.attention.snoozedUntil} />까지 미뤘어요.</p>}
    <section className="detail-block"><h3>완료 기준</h3><p className={!session.completionCriterion ? 'unavailable-copy' : ''}>{session.completionCriterion || '아직 완료 기준을 정하지 않았어요.'}</p></section>
    <section className="detail-block"><h3>현재 활동</h3><p>{currentAction(session, disconnected)}</p>{session.lastTool && <span className={`tool-chip ${isNotion ? 'notion-chip' : ''}`}>{isNotion ? 'N · ' : '⌘ · '}최근 도구 · {session.lastTool}</span>}</section>
    <section className="detail-block plan-block"><div className="block-heading"><h3>전달된 작업 계획</h3>{session.planUpdatedAt && <span className="muted">갱신 <Clock stamp={session.planUpdatedAt} /></span>}</div>
      {session.planSteps?.length ? <ol className="plan-list">{session.planSteps.map((item, index) => <li className={`plan-${item.status}`} key={`${index}-${item.step}`}><span className="plan-marker" aria-label={item.status === 'completed' ? '완료' : item.status === 'in_progress' ? '진행 중' : '대기'}>{item.status === 'completed' ? '✓' : index + 1}</span><span>{item.step}</span>{item.status === 'in_progress' && <span className="plan-current">진행</span>}</li>)}</ol> : <p className="unavailable-copy">계획이 아직 전달되지 않았어요.<br /><span>전달된 계획이 있을 때만 여기에 표시돼요.</span></p>}
    </section>
    <div className="observation-stats"><div><span>이번 작업 관측 시간</span><strong>{elapsed === null ? '—' : elapsed < 1 ? '1분 미만' : `${elapsed}분`}</strong></div><div><span>시간 알림</span><strong>{session.elapsedAlertMinutes === null ? '끔' : `${session.elapsedAlertMinutes ?? 10}분`}</strong></div><div><span>토큰 사용량</span><strong>측정 불가</strong></div></div>
    {session.unread && <button className="text-button" disabled={action.busy} onClick={() => void action.run('acknowledge', { sessionId: session.id })}>응답 확인했어요</button>}
    {action.error && <p className="error" role="alert">{action.error}</p>}
    <TaskReturn session={session} />
  </div>;
}
