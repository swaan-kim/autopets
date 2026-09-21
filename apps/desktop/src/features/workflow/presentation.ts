import type { WorkflowCapabilities, WorkflowPreset, WorkflowTask } from '@autopets/contracts/types';

export const WORKFLOW_PRESETS = [
  { id: 'light', title: '가볍게 끝내기', description: '짧은 정리·반복 작업', planning: { model: 'gpt-5.6-sol', reasoning: 'medium' }, execution: { model: 'gpt-5.6-luna', reasoning: 'low' } },
  { id: 'balanced', title: '균형 있게', description: '조사·문서·일반 업무', planning: { model: 'gpt-5.6-sol', reasoning: 'medium' }, execution: { model: 'gpt-5.6-terra', reasoning: 'medium' } },
  { id: 'complex', title: '어려운 일 풀기', description: '기획·어려운 판단', planning: { model: 'gpt-6-astra', reasoning: 'high' }, execution: { model: 'gpt-6-astra', reasoning: 'medium' } },
] as const;

export const presetFor = (preset: WorkflowPreset) => WORKFLOW_PRESETS.find(item => item.id === preset)!;
export function modelLabel(model: string) {
  const names: Record<string, string> = { 'gpt-5.6-sol': 'Sol', 'gpt-5.6-luna': 'Luna', 'gpt-5.6-terra': 'Terra', 'gpt-6-astra': 'Astra' };
  return names[model] || model;
}
export const approvalCurrent = (task: WorkflowTask) => Boolean(task.approval && task.approval.planRevision === task.planRevision && task.approval.settingsRevision === task.settingsRevision);
export const canHold = (caps: WorkflowCapabilities) => caps.verification === 'verified' && caps.modelObservation && caps.submissionHold && caps.inputPreservation && caps.singleSubmission && caps.availableModels.length > 0;
export const canAllowOnce = (task: WorkflowTask, caps: WorkflowCapabilities) => task.enabled && canHold(caps) && caps.requestIdentity && task.observation?.source === 'verified-adapter' && task.guard.status === 'held' && !task.onceAvailable && Boolean(task.guard.submissionId) && Boolean(task.guard.requestFingerprint) && Boolean(task.observation?.model) && task.observation.submissionId === task.guard.submissionId && (!task.planFirst || task.phase !== 'ready' || approvalCurrent(task));

export function workflowHelp(task: WorkflowTask | undefined, caps: WorkflowCapabilities | undefined) {
  if (!task || !task.enabled) return null;
  if (caps && canHold(caps) && task.guard.status === 'held') return '전송 전 설정 확인이 필요해요';
  const observed = caps?.verification === 'verified' && task.observation;
  if (observed && caps.modeObservation && observed.mode === 'plan') return `최근 확인 ${new Date(observed.observedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} · 계획 모드`;
  if (observed && caps.modelObservation && caps.reasoningObservation && observed.model && observed.reasoning) return `최근 확인 ${new Date(observed.observedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} · ${modelLabel(observed.model)} · ${observed.reasoning}`;
  if (task.guard.status === 'unavailable' || task.guard.status === 'pending') return '설정 확인 필요';
  return '계획 지침 준비됨';
}

export function manualPlanPrompt(task: WorkflowTask) {
  if (approvalCurrent(task)) return `확인한 계획의 조건과 완료 기준을 유지해서 진행해주세요. 실행 후보는 ${modelLabel(task.execution.model)} · ${task.execution.reasoning}입니다. 모델과 추론 설정은 제가 채팅에서 직접 확인하겠습니다.`;
  return '이 요청의 목표, 필요한 단계, 완료 기준을 짧게 정리해주세요. 중요한 불명확함만 질문하고, 제가 계획을 확인하기 전에는 실행하지 마세요.';
}
