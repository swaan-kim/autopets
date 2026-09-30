import type { PetLink } from '@autopets/contracts/types';
import { command } from '../../bridge/command';
import { useAction } from '../../bridge/useAction';
import { useEffect, useState } from 'react';
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
  const [copyNotice, setCopyNotice] = useState('');
  const [copyText, setCopyText] = useState('');
  useEffect(() => { setCopyNotice(''); setCopyText(''); setClosing(false); }, [link.target.sourceId, link.target.threadId, link.target.cwd, link.revision, link.run?.id, link.run?.state]);
  const active = link.connected && !disconnected && !link.run?.trackingClosed && (link.enabled || Boolean(link.run));
  const state = active ? link.run?.state : undefined;
  const unresolved = unresolvedPetRun(link);
  const uiPet = link.template.skills.some(skill => skill.id === 'frontend-design');
  const figma = link.template.features?.figmaDesign === true;
  const currentStep = state === 'waiting' ? '계획 확인' : state === 'complete' ? '완료' : state === 'returned' ? '결과 확인' : state === 'working' || state === 'requested' ? '작업 중' : null;
  const nextPrompt = !link.connected || disconnected || unresolved ? '펫 상태 확인' : state === 'waiting' ? '그대로 구현해줘' : '제작 펫으로 다음 작업의 계획만 세워줘. 원하는 결과와 필요한 조건을 먼저 물어보고, 파일 변경 없이 내 구현 요청을 기다려줘.';
  const copyNext = async () => {
    setCopyText(nextPrompt);
    try { await navigator.clipboard.writeText(nextPrompt); setCopyNotice('복사했어요. 이 펫이 연결된 Codex 채팅에 직접 보내주세요.'); }
    catch { setCopyNotice('자동 복사가 되지 않았어요. 아래 문장을 직접 선택해 복사해 주세요.'); }
  };
  const actionError = action.error.includes('pet-revision-changed') ? '설정이 바뀌었어요. 현재 상태를 확인한 뒤 다시 선택해 주세요.' : action.error.includes('pet-run-active-or-unresolved') ? '현재 작업을 먼저 확인해 주세요.' : action.error ? '변경하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.' : '';
  return <div className="explicit-pet" aria-label="연결된 제작 펫">
    {showPet && <Pet index={link.slot} activity={state === 'working' ? 'working' : 'idle'} paused={!active}
      motion={state === 'complete' ? 'celebrate' : state === 'failed' ? 'angry' : state === 'waiting' ? 'dizzy' : undefined} />}
    <strong>{uiPet ? link.template.name : '제작 펫'} · Codex</strong><p role="status">{explicitPetStatus(link, disconnected)}</p>
    <p className="card-path" title={link.target.cwd}>{link.target.cwd.split(/[\\/]/).pop()}</p>
    <small className="explicit-target" title={link.target.threadId}>채팅 {link.target.threadId.slice(0, 8)}</small>
    {currentStep && <ol className="explicit-progress" aria-label="현재 펫 작업 단계">{['작업 중', '계획 확인', '결과 확인', '완료'].map(step => <li key={step} aria-current={step === currentStep ? 'step' : undefined}>{step}</li>)}</ol>}
    {uiPet && <p className="explicit-skill">frontend-design 기반 · {figma ? 'Figma 시안 활용' : '기본 UI 제작'}</p>}
    <label>다음 펫 작업 설정 <select aria-label="다음 펫 작업 설정" value={link.profile} disabled={action.busy || disconnected || unresolved}
      onChange={event => void action.run('set_pet_link_profile', { target: link.target, expectedRevision: link.revision, profile: event.target.value })}>
      {Object.entries(profiles).filter(([value]) => value !== 'plan' || link.profile === 'plan').map(([value, label]) => <option key={value} value={value} disabled={value === 'plan'}>{label}</option>)}
    </select></label>
    <small>가용 모델은 실행 전에 확인해요. 원래 채팅의 모델은 유지돼요.</small>
    {uiPet && <small>이 선택은 이번 채팅의 다음 제작·검토 작업에 적용돼요. 저장한 펫 구성은 바꾸지 않아요.</small>}
    {link.run && <details className="explicit-evidence"><summary>실행 설정·스킬 확인</summary>{link.run.model && <p>이번 요청: {link.run.model} · {link.run.effort}</p>}{link.run.observedModel ? <p>실행 기록: {link.run.observedModel} · {link.run.observedEffort}</p> : <small>실행 설정 확인 전</small>}{uiPet && <><p>스킬 읽기: {link.run.skillEvidence?.some(skill => skill.id === 'frontend-design') ? 'frontend-design 확인' : '미확인'}</p>{figma && <p>이번 작업의 Figma 사용: {link.run.figmaUsed ? '확인됨' : '미확인'}</p>}<small>스킬·도구를 사용한 기록과 결과 품질은 따로 확인해요.</small></>}</details>}
    {!link.enabled && <p>새 펫 작업은 꺼져 있어요. 이미 시작한 작업은 계속 확인해요.</p>}
    <small>명시적으로 맡긴 펫 작업 · 훅 자동화 미사용</small>
    {(unresolved || !link.connected) && <p>이 채팅에서 “펫 상태 확인”을 요청하면 실행 기록을 다시 확인해요.</p>}
    {state === 'waiting' && <p>계획 내용은 Codex에서 확인해요. 구현 요청을 보내기 전까지 기다려요.</p>}
    {state === 'complete' && <p>결과는 Codex가 반환한 파일 링크에서 확인하세요.</p>}
    <button className="button secondary explicit-next" disabled={!link.enabled && !unresolved && link.connected} onClick={() => void copyNext()}>{!link.connected || disconnected || unresolved ? '상태 확인 요청 복사' : state === 'waiting' ? '구현 요청 복사' : '다음 계획 요청 복사'}</button>
    {copyNotice && <p className="explicit-copy" role="status">{copyNotice}</p>}{copyText && <label className="explicit-copy-input">Codex에 보낼 문장<textarea readOnly rows={3} value={copyText} onFocus={event => event.currentTarget.select()} /></label>}
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
