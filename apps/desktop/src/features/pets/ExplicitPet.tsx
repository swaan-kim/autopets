import type { PetLink } from '@autopets/contracts/types';
import { command } from '../../bridge/command';
import { useAction } from '../../bridge/useAction';
import { useEffect, useRef, useState } from 'react';
import { Pet } from './Pet';
import { PetTaskReturn } from './PetTaskReturn';
import './explicit-pet.css';
const profiles = { light: '가볍게', standard: '표준', careful: '꼼꼼하게', plan: '계획만' };
export const unresolvedPetRun = (link: PetLink) => Boolean(link.run && !link.run.trackingClosed && ['requested', 'working', 'returned', 'unknown'].includes(link.run.state));
export function explicitPetStatus(link: PetLink, disconnected = false): string {
  if (disconnected || !link.connected) return '연결 확인 필요';
  if (link.run?.trackingClosed) return '추적 종료';
  if (!link.enabled && !link.run) return '펫 도움 꺼짐';
  if (!link.run) return '작업 대기';
  if (link.run.state === 'requested' || link.run.state === 'working') return link.run.profile === 'plan' ? '계획 중' : '제작 중';
  const labels = { returned: '결과 확인', waiting: '계획 확인 필요', complete: '완료', failed: '작업 확인 실패', unknown: '실행 상태 확인 필요' };
  return labels[link.run.state];
}
export function ExplicitPet({ link, disconnected = false, onHide, showPet = true }: { link: PetLink; disconnected?: boolean; onHide?: () => void; showPet?: boolean }) {
  const action = useAction();
  const [closing, setClosing] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const [copyText, setCopyText] = useState('');
  const [copying, setCopying] = useState(false);
  const copyPending = useRef(false);
  const copyScope = JSON.stringify([link.target, link.revision, link.run?.id, link.run?.state]);
  const currentCopyScope = useRef(copyScope);
  currentCopyScope.current = copyScope;
  useEffect(() => { setCopyNotice(''); setCopyText(''); setClosing(false); }, [copyScope]);
  const active = link.connected && !disconnected && !link.run?.trackingClosed && (link.enabled || Boolean(link.run));
  const state = active ? link.run?.state : undefined;
  const unresolved = unresolvedPetRun(link);
  const uiPet = link.template.skills.some(skill => skill.id === 'frontend-design');
  const designSkill = link.template.skills.find(skill => skill.id === 'frontend-design');
  const runTemplate = link.run?.template ?? link.template;
  const runUiPet = runTemplate.skills.some(skill => skill.id === 'frontend-design');
  const runFigma = runTemplate.features?.figmaDesign === true;
  const nextPrompt = !link.connected || disconnected || unresolved ? '펫 상태 확인' : state === 'waiting' ? '그대로 구현해줘' : '제작 펫으로 다음 작업의 계획만 세워줘. 원하는 결과와 필요한 조건을 먼저 물어보고, 파일 변경 없이 내 구현 요청을 기다려줘.';
  const copyNext = async () => {
    if (copyPending.current) return;
    copyPending.current = true; setCopying(true);
    const scope = copyScope;
    setCopyText(nextPrompt);
    try { await navigator.clipboard.writeText(nextPrompt); if (currentCopyScope.current === scope) setCopyNotice('복사했어요. 이 펫이 연결된 Codex 채팅에 직접 보내주세요.'); }
    catch { if (currentCopyScope.current === scope) setCopyNotice('자동 복사가 되지 않았어요. 아래 문장을 직접 선택해 복사해 주세요.'); }
    finally { copyPending.current = false; setCopying(false); }
  };
  const actionError = action.error.includes('pet-revision-changed') ? '설정이 바뀌었어요. 현재 상태를 확인한 뒤 다시 선택해 주세요.' : action.error.includes('pet-run-active-or-unresolved') ? '현재 작업을 먼저 확인해 주세요.' : action.error ? '변경하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.' : '';
  const status = explicitPetStatus(link, disconnected);
  const help = !link.connected || disconnected ? '저장된 채팅을 열고 “펫 상태 확인”을 보내주세요.'
    : link.run?.trackingClosed ? 'Codex에서 기존 작업을 확인한 뒤 다음 작업을 맡겨주세요.'
    : !link.enabled ? '새 펫 작업은 꺼져 있어요. 이미 시작한 작업은 계속 확인해요.'
    : state === 'waiting' ? 'Codex에서 계획을 확인하고 “그대로 구현해줘”라고 보내주세요.'
    : state === 'complete' ? 'Codex 채팅의 결과 파일을 확인해 주세요.'
    : state === 'returned' ? '결과가 돌아왔어요. 실행 기록을 확인하고 있어요.'
    : state === 'requested' ? '실행 요청을 보냈어요. 시작 확인을 기다리고 있어요.'
    : state === 'working' ? link.run?.profile === 'plan' ? '계획을 정리하고 있어요. 파일은 구현 요청 뒤에 바꿔요.' : '맡긴 작업을 진행하고 있어요.'
    : state === 'failed' || state === 'unknown' ? 'Codex에서 “펫 상태 확인”을 보내 현재 작업을 확인해 주세요.'
    : '같은 Codex 채팅에서 펫에게 계획을 맡겨보세요.';
  return <div className="explicit-pet" aria-label="연결된 제작 펫">
    {showPet && <Pet index={link.slot} activity={state === 'working' ? 'working' : 'idle'} paused={!active}
      motion={state === 'complete' ? 'celebrate' : state === 'failed' ? 'angry' : state === 'waiting' ? 'dizzy' : undefined} />}
    <header className="explicit-heading"><strong>{uiPet ? link.template.name : '제작 펫'}</strong><span>Codex</span></header>
    <div className="explicit-location"><p className="card-path" title={link.target.cwd}>{link.target.cwd.split(/[\\/]/).filter(Boolean).pop()}</p><small className="explicit-target" title={link.target.threadId}>채팅 {link.target.threadId.slice(0, 8)}</small></div>
    <div className="explicit-status-panel" data-state={!active ? 'unconfirmed' : state ?? 'idle'}><p className="explicit-status" role="status">{status}</p><p className="explicit-help">{help}</p></div>
    <PetTaskReturn link={link} />
    <button className="text-button explicit-next" disabled={copying || (!link.enabled && !unresolved && link.connected)} onClick={() => void copyNext()}>{!link.connected || disconnected || unresolved ? '상태 확인 요청 복사' : state === 'waiting' ? '구현 요청 복사' : '다음 계획 요청 복사'}</button>
    {copyNotice && <p className="explicit-copy" role="status">{copyNotice}</p>}{copyText && <label className="explicit-copy-input">Codex에 보낼 문장<textarea readOnly rows={3} value={copyText} onFocus={event => event.currentTarget.select()} /></label>}
    <details className="explicit-settings"><summary>펫 설정과 관리</summary><div className="explicit-settings-body">
      <label>다음 펫 작업 설정 <select aria-label="다음 펫 작업 설정" value={link.profile} disabled={action.busy || disconnected || unresolved}
        onChange={event => void action.run('set_pet_link_profile', { target: link.target, expectedRevision: link.revision, profile: event.target.value })}>
        {Object.entries(profiles).filter(([value]) => value !== 'plan' || link.profile === 'plan').map(([value, label]) => <option key={value} value={value} disabled={value === 'plan'}>{label}</option>)}
      </select></label>
      <small>다음 제작·검토 작업에 적용돼요. 가용 모델은 실행 전에 확인하고, 원래 채팅의 모델은 유지해요.</small>
      {uiPet && <small>저장한 펫 구성은 바꾸지 않아요.</small>}
      <p className="explicit-help-toggle">펫 도움 {link.enabled ? '켜짐' : '꺼짐'}</p>
      <div className="card-options"><button className="text-button" disabled={action.busy || disconnected} onClick={() => void action.run('set_pet_link_enabled', { target: link.target, expectedRevision: link.revision, enabled: !link.enabled })}>{link.enabled ? '도움 끄기' : '도움 켜기'}</button>
        <button className="text-button" disabled={action.busy} onClick={() => void action.run('unassign_session', { slot: link.slot })}>연결 해제</button>
        {onHide && <button className="text-button" onClick={onHide}>숨기기</button>}
        <button className="text-button" onClick={() => void command('show_manager')}>앱 열기</button>
        {unresolved && <button className="text-button" disabled={action.busy || disconnected} onClick={() => setClosing(true)}>추적 정리</button>}
      </div>
      {closing && unresolved && <div role="group" aria-label="펫 작업 추적 정리"><p>이 펫의 추적만 종료해요. Codex 작업은 계속 실행 중일 수 있어요. 새 작업을 맡기기 전에 Codex에서 확인해 주세요.</p>
        <button disabled={action.busy} onClick={() => { setClosing(false); void action.run('close_pet_tracking', { target: link.target, expectedRevision: link.revision, requestId: link.run!.id }); }}>이 작업 추적 종료</button>
        <button onClick={() => setClosing(false)}>계속 추적</button></div>}
      <small>채팅에서 직접 맡긴 펫 작업만 표시해요. 훅 자동화는 사용하지 않아요.</small>
    </div></details>
    <details className="explicit-evidence"><summary>실행 설정·스킬 확인</summary><div className="explicit-evidence-body">
      {uiPet && <p>일하는 방법: Anthropic frontend-design 기반{designSkill && /^[0-9a-f]{40}$/.test(designSkill.version) && <> · <a href={`https://github.com/anthropics/skills/blob/${designSkill.version}/skills/frontend-design/SKILL.md`} target="_blank" rel="noreferrer">원본 보기 ↗</a></>}</p>}
      {link.template.skills.map(skill => <p key={skill.id}>저장된 스킬: {skill.id} · {skill.version}</p>)}
      <p>작업 폴더: {link.target.cwd}</p><p>채팅 ID: {link.target.threadId}</p>
      {link.run ? <>{link.run.model && <p>이번 요청: {link.run.model} · {link.run.effort}</p>}{link.run.observedModel ? <p>실행 기록: {link.run.observedModel} · {link.run.observedEffort}</p> : <p>실행 설정 확인 전</p>}
        {runUiPet && <><p>스킬 읽기: {link.run.skillEvidence?.some(skill => skill.id === 'frontend-design') ? 'frontend-design 확인' : '미확인'}</p>{link.run.skillEvidence?.map(skill => <p key={skill.id}>읽은 스킬: {skill.id} · {skill.version}</p>)}{runFigma && <p>이번 작업의 Figma 사용: {link.run.figmaUsed ? '확인됨' : '미확인'}</p>}<small>스킬·도구를 사용한 기록과 결과 품질은 따로 확인해요.</small></>}</> : <p>아직 실행 기록이 없어요.</p>}
    </div></details>
    {actionError && <p role="alert">{actionError}</p>}
  </div>;
}
