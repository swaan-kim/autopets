import { useState } from 'react';
import type { Attention, Session } from '@autopets/contracts/types';
import { useAction } from '../../bridge/useAction';
import { Clock } from '../../app/shared/Clock';

export function AttentionCard({ session, attention }: { session: Session; attention: Attention }) {
  const action = useAction();
  const [handled, setHandled] = useState(false);
  const title = attention.kind === 'elapsed' ? '설정한 시간이 지났어요' : attention.kind === 'milestone' ? '계획 단계가 업데이트됐어요' : attention.kind === 'tool-error' ? '도구 오류 확인' : 'Codex에서 확인해주세요';
  const resolve = async (snooze: boolean) => {
    const args = { sessionId: session.id, attentionId: attention.id, ...(snooze ? { minutes: 10 } : {}) };
    if (await action.run(snooze ? 'snooze_attention' : 'acknowledge_attention', args)) setHandled(true);
  };
  return <section className={`attention-card attention-${attention.kind}`} aria-label={title}>
    <div className="attention-heading"><span aria-hidden="true">{attention.kind === 'elapsed' ? '◷' : attention.kind === 'milestone' ? '✓' : '!'}</span><strong>{title}</strong><Clock stamp={attention.createdAt} /></div>
    <p>{attention.summary || title}</p>
    <p className="small-note">{attention.kind === 'elapsed' ? '알림을 확인하거나 미뤄도 Codex 작업은 계속돼요.' : attention.kind === 'permission' ? '이 알림의 확인은 권한 승인이 아니에요. 요청에는 Codex에서 응답해주세요.' : attention.kind === 'tool-error' ? '실제 도구 응답에서 오류가 감지됐어요. 전체 작업이 실패한 것은 아니며, Codex에서 상태를 확인해주세요.' : '실제로 전달된 계획의 변경을 알려드려요.'}</p>
    {action.error && <p className="error" role="alert">{action.error}</p>}
    <div className="action-row"><button className="button secondary" disabled={action.busy || handled} onClick={() => void resolve(true)}>10분 뒤 다시 알림</button><button className="button primary" disabled={action.busy || handled} onClick={() => void resolve(false)}>{handled ? '반영했어요' : '알림 확인'}</button></div>
  </section>;
}
