import type { Session } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';

export function canAttemptReturn(session: Session) {
  return isDesktop && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(session.id)
    && session.id !== '00000000-0000-0000-0000-000000000000'
    && /^[a-z]:[/\\]/i.test(session.cwd) && !/[\x00-\x1f\x7f]/.test(session.cwd);
}

export async function returnToTask(session: Session) {
  const result = await command<{ status: string; sessionId: string; targetVerified: boolean }>('open_local_task', {
    sessionId: session.id, expectedCwd: session.cwd,
  });
  if (result.status !== 'dispatched' || result.sessionId !== session.id || result.targetVerified !== false) {
    throw new Error('열기 요청 결과를 확인하지 못했어요. 작업 ID로 직접 찾아주세요.');
  }
  return '작업 앱에 열기를 요청했어요. 열린 작업명과 ID가 같은지 확인해주세요.';
}
