import type { Session } from '@autopets/contracts/types';
import { STATE_LABEL } from './constants';

export function dueAttention(session: Session, now: number) {
  return session.attention && (!session.attention.snoozedUntil || session.attention.snoozedUntil <= now) ? session.attention : null;
}

export function status(session: Session, now: number, disconnected = false) {
  if (disconnected) return { kind: 'unknown', text: '브리지 연결 확인 필요' };
  if (session.connection === 'unknown') return { kind: 'unknown', text: '최근 상태 확인 필요' };
  if (session.connection === 'ended') return { kind: 'unknown', text: '작업 연결 종료' };
  const attention = dueAttention(session, now);
  if (attention?.kind === 'elapsed') return { kind: 'time', text: '설정한 시간이 지났어요' };
  if (attention?.kind === 'permission') return { kind: 'waiting', text: 'Codex 확인 필요' };
  if (attention?.kind === 'tool-error') return { kind: 'tool-error', text: '도구 오류 확인' };
  if (attention?.kind === 'milestone') return { kind: 'milestone', text: '계획 단계 업데이트' };
  return { kind: session.state, text: STATE_LABEL[session.state] };
}

export function currentAction(session: Session, disconnected = false) {
  if (disconnected || session.connection !== 'observed') return '마지막 관측 이후 상태를 확인할 수 없어요.';
  if (session.state !== 'working') return STATE_LABEL[session.state];
  if (session.activity === 'research') return '자료를 조사하고 있어요';
  if (session.activity === 'writing') return '문서를 작성하고 있어요';
  if (session.activity === 'tool' && session.lastTool) return `${session.lastTool} 사용 중`;
  return '작업을 진행하고 있어요';
}

export function observedActivity(session: Session | undefined, disconnected: boolean) {
  return !disconnected && session?.connection === 'observed' && session.state === 'working' ? session.activity : 'idle';
}
