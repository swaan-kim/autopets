import type { PetLink } from '@autopets/contracts/types';
import { command } from '../../bridge/command';
import { useAction } from '../../bridge/useAction';
import { useState } from 'react';
import { Pet } from './Pet';
import './explicit-pet.css';
const profiles = { light: '가볍게', standard: '표준', careful: '꼼꼼하게', plan: '계획만' };
export const unresolvedPetRun = (link: PetLink) => Boolean(link.run && !link.run.trackingClosed && ['requested', 'working', 'returned', 'unknown'].includes(link.run.state));
export function explicitPetStatus(link: PetLink, disconnected = false): string {
  if (disconnected || !link.connected) return '저장됨 · 채팅에서 연결을 다시 확인해 주세요';
  if (link.run?.trackingClosed) return '추적 종료 · Codex 작업은 별도로 확인해 주세요';
  if (!link.enabled && !link.run) return '이번 채팅의 펫 도움 꺼짐';
  const labels = { requested: '실행 요청됨 · 시작 확인 대기', working: '펫 작업 중', returned: '결과 반환 · 실행 기록 확인 필요', waiting: '계획 확인 필요', complete: '펫 작업 완료', failed: '작업 또는 설정 확인 실패', unknown: '실행 상태 확인 필요' };
  return link.run ? labels[link.run.state] : '채팅 연결됨 · 작업을 기다려요';
}
export function ExplicitPet({ link, disconnected = false, onHide, showPet = true }: { link: PetLink; disconnected?: boolean; onHide?: () => void; showPet?: boolean }) {
  const action = useAction();
  const [closing, setClosing] = useState(false);
  const active = link.connected && !disconnected && !link.run?.trackingClosed && (link.enabled || Boolean(link.run));
  const state = active ? link.run?.state : undefined;
  const unresolved = unresolvedPetRun(link);
  const actionError = action.error.includes('pet-revision-changed') ? '설정이 바뀌었어요. 현재 상태를 확인한 뒤 다시 선택해 주세요.' : action.error.includes('pet-run-active-or-unresolved') ? '현재 작업을 먼저 확인해 주세요.' : action.error ? '변경하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.' : '';
  return <div className="explicit-pet" aria-label="연결된 제작 펫">
    {showPet && <Pet index={link.slot} activity={state === 'working' ? 'working' : 'idle'} paused={!active}
      motion={state === 'complete' ? 'celebrate' : state === 'failed' ? 'angry' : state === 'waiting' ? 'dizzy' : undefined} />}
    <strong>제작 펫 · Codex</strong><p role="status">{explicitPetStatus(link, disconnected)}</p>
    <p className="card-path" title={link.target.cwd}>{link.target.cwd.split(/[\\/]/).pop()}</p>
    <label>다음 펫 작업 설정 <select aria-label="다음 펫 작업 설정" value={link.profile} disabled={action.busy || disconnected || unresolved}
      onChange={event => void action.run('set_pet_link_profile', { target: link.target, expectedRevision: link.revision, profile: event.target.value })}>
      {Object.entries(profiles).filter(([value]) => value !== 'plan' || link.profile === 'plan').map(([value, label]) => <option key={value} value={value} disabled={value === 'plan'}>{label}</option>)}
    </select></label>
    <small>가용 모델은 실행 전에 확인해요. 원래 채팅의 모델은 유지돼요.</small>
    {link.run?.model && <p>이번 요청: {link.run.model} · {link.run.effort}</p>}
    {link.run?.observedModel && <p>실행 기록: {link.run.observedModel} · {link.run.observedEffort}</p>}
    {link.run && !link.run.observedModel && <small>실행 설정 확인 전</small>}
    {!link.enabled && <p>새 펫 작업은 꺼져 있어요. 이미 시작한 작업은 계속 확인해요.</p>}
    <small>명시적으로 맡긴 펫 작업 · 훅 자동화 미사용</small>
    {(unresolved || !link.connected) && <p>이 채팅에서 “펫 상태 확인”을 요청하면 실행 기록을 다시 확인해요.</p>}
    <div className="card-options"><button className="text-button" disabled={action.busy || disconnected} onClick={() => void action.run('set_pet_link_enabled', { target: link.target, expectedRevision: link.revision, enabled: !link.enabled })}>{link.enabled ? '도움 끄기' : '도움 켜기'}</button>
      <button className="text-button" disabled={action.busy} onClick={() => void action.run('unassign_session', { slot: link.slot })}>연결 해제</button>
      {onHide && <button className="text-button" onClick={onHide}>숨기기</button>}
      <button className="text-button" onClick={() => void command('show_manager')}>앱 열기</button>
      {unresolved && <button className="text-button" disabled={action.busy || disconnected} onClick={() => setClosing(true)}>추적 정리</button>}
    </div>
    {closing && unresolved && <div role="group" aria-label="펫 작업 추적 정리"><p>이 펫의 추적만 종료해요. Codex 작업은 계속 실행 중일 수 있어요. 새 작업을 맡기기 전에 Codex에서 확인해 주세요.</p>
      <button disabled={action.busy} onClick={() => { setClosing(false); void action.run('close_pet_tracking', { target: link.target, expectedRevision: link.revision, requestId: link.run!.id }); }}>이 작업 추적 종료</button>
      <button onClick={() => setClosing(false)}>계속 추적</button></div>}
    {actionError && <p role="alert">{actionError}</p>}
  </div>;
}
