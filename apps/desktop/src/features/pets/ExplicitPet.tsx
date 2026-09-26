import type { PetLink } from '@autopets/contracts/types';
import { command } from '../../bridge/command';
import { useAction } from '../../bridge/useAction';
import { Pet } from './Pet';
export function explicitPetStatus(link: PetLink, disconnected = false): string {
  if (disconnected || !link.connected) return '저장됨 · 채팅에서 연결을 다시 확인해 주세요';
  if (!link.enabled) return '이번 채팅의 펫 도움 꺼짐';
  const labels = { requested: '실행 요청됨 · 시작 확인 대기', working: '펫 작업 중', returned: '결과 반환 · 실행 기록 확인 필요', waiting: '계획 확인 필요', complete: '펫 작업 완료', failed: '작업 또는 설정 확인 실패', unknown: '실행 상태 확인 필요' };
  return link.run ? labels[link.run.state] : '채팅 연결됨 · 작업을 기다려요';
}
export function ExplicitPet({ link, disconnected = false, onHide, showPet = true }: { link: PetLink; disconnected?: boolean; onHide?: () => void; showPet?: boolean }) {
  const action = useAction();
  const active = link.connected && link.enabled && !disconnected;
  const state = active ? link.run?.state : undefined;
  return <div className="explicit-pet" aria-label="연결된 제작 펫">
    {showPet && <Pet index={link.slot} activity={state === 'working' ? 'working' : 'idle'} paused={!active}
      motion={state === 'complete' ? 'celebrate' : state === 'failed' ? 'angry' : state === 'waiting' ? 'dizzy' : undefined} />}
    <strong>제작 펫 · Codex</strong><p role="status">{explicitPetStatus(link, disconnected)}</p>
    <p className="card-path" title={link.target.cwd}>{link.target.cwd.split(/[\\/]/).pop()}</p>
    <small>자동 진행 알림 연결 전</small>
    <div className="card-options"><button className="text-button" disabled={action.busy || disconnected} onClick={() => void action.run('set_pet_link_enabled', { target: link.target, expectedRevision: link.revision, enabled: !link.enabled })}>{link.enabled ? '도움 끄기' : '도움 켜기'}</button>
      <button className="text-button" disabled={action.busy} onClick={() => void action.run('unassign_session', { slot: link.slot })}>연결 해제</button>
      {onHide && <button className="text-button" onClick={onHide}>숨기기</button>}
      <button className="text-button" onClick={() => void command('show_manager')}>앱 열기</button>
    </div>{action.error && <p role="alert">{action.error}</p>}
  </div>;
}
