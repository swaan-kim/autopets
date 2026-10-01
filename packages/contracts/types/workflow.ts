import type { ChatIdentity, Provider } from './assistance';

export type WorkflowPreset = 'light' | 'balanced' | 'complex';
export type WorkflowPhase = 'unknown' | 'planning' | 'ready' | 'executing' | 'review';
export type WorkflowReasoning = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export interface WorkflowModel { model: string; reasoning: WorkflowReasoning }
export interface WorkflowPreferences { version: 1; enabled: boolean; preset: WorkflowPreset; planFirst: boolean; planning: WorkflowModel; execution: WorkflowModel; revision: number }
export interface WorkflowPlan { summary: string; steps: string[]; completionCriteria: string[] }
export interface WorkflowObservation {
  model: string | null; reasoning: string | null; mode: string | null;
  source: 'hook' | 'verified-adapter'; observedAt: number; submissionId: string;
}
export interface WorkflowGuard {
  status: 'pending' | 'matched' | 'held' | 'exception' | 'unavailable';
  reason: string; submissionId: string | null; requestFingerprint: string | null; checkedAt: number | null;
}
export interface WorkflowTask {
  identity: ChatIdentity; enabled: boolean; preset: WorkflowPreset; planFirst: boolean;
  planning: WorkflowModel; execution: WorkflowModel; phase: WorkflowPhase;
  settingsRevision: number; planRevision: number; plan: WorkflowPlan | null;
  approval: { planRevision: number; settingsRevision: number; approvedAt: number } | null;
  observation: WorkflowObservation | null; guard: WorkflowGuard;
  onceAvailable: boolean; updatedAt: number;
}
export interface WorkflowCapabilities {
  modelObservation: boolean; reasoningObservation: boolean; modeObservation: boolean;
  submissionHold: boolean; inputPreservation: boolean; singleSubmission: boolean;
  requestIdentity: boolean;
  modelSwitch: boolean; reasoningSwitch: boolean; planModeSwitch: boolean; verification: 'unverified' | 'verified';
  availableModels: { model: string; reasoning: WorkflowReasoning[] }[];
}
export interface WorkflowSnapshot {
  preferences: WorkflowPreferences; tasks: WorkflowTask[];
  capabilities: Record<Provider, WorkflowCapabilities>;
}
export interface WorkflowBinding { sessionId: string; cwd: string; turnId?: string }
export interface WorkflowTaskConfiguration { enabled: boolean; preset: WorkflowPreset; planFirst: boolean; planning: WorkflowModel; execution: WorkflowModel }
export type WorkflowIntent = 'new-work' | 'simple-edit' | 'continue' | 'execute' | 'review';
export type WorkflowRequest =
  | { operation: 'read'; identity: ChatIdentity; binding: WorkflowBinding }
  | { operation: 'preflight'; identity: ChatIdentity; binding: WorkflowBinding; expectedSettingsRevision: number;
      expectedPlanRevision: number; submissionId: string; requestFingerprint: string; intent: WorkflowIntent; observation: WorkflowObservation | null;
      explicitModel?: string | null; planChanged?: boolean }
  | { operation: 'recordPlan'; identity: ChatIdentity; binding: WorkflowBinding; expectedSettingsRevision: number;
      expectedPlanRevision: number; plan: WorkflowPlan };
export interface WorkflowReadResult { preferences: WorkflowPreferences; task: WorkflowTask; capabilities: WorkflowCapabilities }
export interface WorkflowGuidanceBinding {
  settingsRevision: number; planRevision: number; phase: WorkflowPhase;
  approval: WorkflowTask['approval']; submissionId: string;
}
export interface WorkflowPreflightResult {
  ok: true; decision: 'allow' | 'hold' | 'passthrough'; reason: string;
  target: WorkflowModel | null; task: WorkflowTask; duplicate: boolean;
}
// Tauri commands:
// workflow_snapshot() -> WorkflowSnapshot
// save_workflow_preferences({preferences: WorkflowPreferences}) -> WorkflowPreferences
// configure_workflow_task({identity, configuration: WorkflowTaskConfiguration, expectedRevision: settingsRevision}) -> WorkflowTask
// approve_workflow_plan({identity, expectedPlanRevision, expectedSettingsRevision}) -> WorkflowTask
// allow_workflow_once({identity, submissionId, expectedPlanRevision, expectedSettingsRevision}) -> WorkflowTask
