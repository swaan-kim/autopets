import { useRef, useState } from 'react';
import type { WorkflowCapabilities, WorkflowTask, WorkflowTaskConfiguration } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';
import { WORKFLOW_PRESETS, approvalCurrent, canAllowOnce, canHold, manualPlanPrompt, modelLabel, presetFor } from './presentation';
import { WorkflowStageSettings } from './WorkflowStageSettings';
import { ManualWorkflowGuide } from './ManualWorkflowGuide';

const noticeKey = (task: WorkflowTask) => `${task.settingsRevision}:${task.planRevision}:${task.onceAvailable}:${task.guard.submissionId}:${task.guard.status}`;
export function WorkflowTaskPanel({ task, capabilities, error, loaded, refresh }: { task: WorkflowTask; capabilities: WorkflowCapabilities; error: string; loaded: boolean; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; key: string } | null>(null);
  const [actionError, setActionError] = useState('');
  const working = useRef(false);
  const disabled = !isDesktop || !loaded || !!error || busy;
  const approved = approvalCurrent(task);
  const verified = capabilities.verification === 'verified';
  const observation = verified ? task.observation : null;
  const actualModel = capabilities.modelObservation && observation?.model;
  const actualReasoning = capabilities.reasoningObservation && observation?.reasoning;
  const actualMode = capabilities.modeObservation && observation?.mode;
  const held = task.enabled && canHold(capabilities) && task.guard.status === 'held';
  const run = async (name: string, args: Record<string, unknown>, message: string) => {
    if (disabled || working.current) return;
    working.current = true; setBusy(true); setActionError(''); setNotice(null);
    try { const updated = await command<WorkflowTask>(name, args); await refresh(); setNotice({ message, key: noticeKey(updated) }); }
    catch { setActionError('상태가 바뀌었거나 연결을 확인하지 못했어요. 최신 내용을 확인하고 다시 시도해주세요.'); }
    finally { setBusy(false); working.current = false; }
  };
  const configure = (updates: Partial<WorkflowTaskConfiguration>) => run('configure_workflow_task', { identity: task.identity, configuration: { enabled: task.enabled, preset: task.preset, planFirst: task.planFirst, planning: task.planning, execution: task.execution, ...updates }, expectedRevision: task.settingsRevision }, '이 작업의 설정을 저장했어요. 실제 적용은 별도로 확인해요.');
  return <section className="workflow-task" aria-label="현재 작업 계획과 실행">
    <div className="workflow-intro"><h3>계획 → 실행</h3><span className="workflow-badge" data-testid="workflow-task-status">{!task.enabled ? '이 작업은 꺼짐' : approved ? '계획 확인 저장됨' : '설정 확인 필요'}</span></div>
    <div className="workflow-stage-path" aria-label="이 작업의 후보 조합"><div data-active={task.phase === 'planning'}><span>계획 후보</span><strong>{modelLabel(task.planning.model)} · {task.planning.reasoning}</strong></div><i aria-hidden="true">→</i><div data-active={task.phase === 'executing'}><span>실행 후보</span><strong>{modelLabel(task.execution.model)} · {task.execution.reasoning}</strong></div></div>
    <ul className="workflow-verification" aria-label="독립 적용 확인"><li data-confirmed={Boolean(actualModel)} data-testid="workflow-model">모델 · {actualModel ? modelLabel(actualModel) : '미확인'}</li><li data-confirmed={Boolean(actualReasoning)} data-testid="workflow-reasoning">추론 · {actualReasoning || '미확인'}</li><li data-confirmed={Boolean(actualMode)} data-testid="workflow-mode">Plan 모드 · {actualMode === 'plan' ? '확인됨' : actualMode ? `현재 ${actualMode}` : '미확인'}</li></ul>
    {observation && <p className="small-note" data-testid="workflow-observed-at">최근 제출 확인 · {new Date(observation.observedAt).toLocaleString('ko-KR')}</p>}
    {task.plan ? <div className="workflow-plan"><h4>전달된 계획</h4><p data-testid="workflow-plan-summary">{task.plan.summary}</p>{(task.plan.steps.length > 0 || task.plan.completionCriteria.length > 0) && <details className="assistance-details"><summary>단계·완료 기준</summary>{task.plan.steps.length > 0 && <ol className="quality-findings">{task.plan.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}{task.plan.completionCriteria.length > 0 && <ul className="quality-findings">{task.plan.completionCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>}</details>}</div> : <p className="small-note">채팅에서 계획을 확인하세요. 아직 전달된 계획이 없어요.</p>}
    {task.approval && !approved && <p className="small-note" role="status">계획이나 설정이 바뀌었어요. 다시 확인해주세요.</p>}
    <button className="button primary" disabled={disabled || !task.enabled || !['planning', 'ready'].includes(task.phase) || approved} onClick={() => void run('approve_workflow_plan', { identity: task.identity, expectedPlanRevision: task.planRevision, expectedSettingsRevision: task.settingsRevision }, '계획 확인을 저장했어요. 채팅의 실제 설정을 확인한 뒤 진행해주세요.')}>{approved ? '계획 확인 저장됨' : task.plan ? '이대로 진행' : '채팅의 계획대로 진행'}</button>
    <p className="small-note">계획 확인만 저장해요. 채팅 전송·실제 설정 변경은 별도예요.</p>
    <div className="workflow-guard" data-testid="workflow-guard"><strong>{!task.enabled ? '이 작업의 계획 도움 꺼짐' : held && task.onceAvailable ? '이 전송의 예외를 저장했어요' : held ? '이 전송은 설정 확인 대기 중이에요' : !canHold(capabilities) ? '전송 전 확인 미지원' : task.guard.status === 'exception' ? '이번 요청에만 현재 설정을 허용했어요' : task.guard.status === 'unavailable' ? '전송 전 설정 확인 불가' : task.guard.status === 'matched' ? '전송 전 설정 일치 확인됨' : '전송 전 확인 대기'}</strong><p>{!task.enabled ? '원래 채팅에서 직접 진행할 수 있어요.' : !canHold(capabilities) ? '자동 보류되지 않아요. 채팅에서 설정을 직접 확인해주세요.' : task.guard.reason || '관측한 설정을 확인한 뒤 진행해요.'}</p>{canAllowOnce(task, capabilities) && <><button className="button secondary" disabled={disabled} onClick={() => void run('allow_workflow_once', { identity: task.identity, submissionId: task.guard.submissionId, expectedPlanRevision: task.planRevision, expectedSettingsRevision: task.settingsRevision }, '이 전송에만 예외를 저장했어요. 같은 요청을 다시 보내주세요.')}>이번 전송만 예외 허용</button><p>설정 차이를 유지한 채 이 전송만 허용해요.</p></>}</div>
    <ManualWorkflowGuide prompt={manualPlanPrompt(task)} provider={task.identity.provider} />
    <details className="assistance-details"><summary>이번 작업 조합 변경</summary><label>이번 작업 조합<select className="text-input" aria-label="이번 작업 조합" value={task.preset} disabled={disabled} onChange={event => void configure({ preset: event.target.value as WorkflowTask['preset'], planning: presetFor(event.target.value as WorkflowTask['preset']).planning, execution: presetFor(event.target.value as WorkflowTask['preset']).execution })}>{WORKFLOW_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.title}</option>)}</select></label><label className="assistance-toggle"><span><strong>이 작업은 계획 먼저 확인</strong></span><input type="checkbox" aria-label="이 작업은 계획 먼저 확인" checked={task.planFirst} disabled={disabled} onChange={event => void configure({ planFirst: event.target.checked })} /></label><div className="workflow-detail-grid">{([['planning', '이 작업 계획'], ['execution', '이 작업 실행']] as const).map(([key, label]) => <WorkflowStageSettings key={key} label={label} value={task[key]} disabled={disabled} onChange={value => void configure({ [key]: value })} />)}</div><p className="small-note">희망 설정 · 사용 가능 여부 미확인. 조합이 바뀌면 계획 확인을 다시 받아요.</p><button className="text-button" disabled={disabled} onClick={() => void configure({ enabled: !task.enabled })}>{task.enabled ? '이 작업의 계획 도움 끄기' : '이 작업의 계획 도움 켜기'}</button></details>
    {(error || actionError) && <p className="error" role="alert">{error || actionError}</p>}{notice?.key === noticeKey(task) && <p className="assistance-notice" role="status">{notice.message}</p>}
  </section>;
}
