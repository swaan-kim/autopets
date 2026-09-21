export type Provider = 'codex' | 'chatgpt';
export interface ChatIdentity { provider: Provider; accountId: string; chatId: string }
export interface UserPreferences {
  enabled: boolean;
  workStyle: 'auto' | 'fast' | 'thorough';
  answerLength: 'concise' | 'normal' | 'detailed';
  outputFormat: 'adaptive' | 'table' | 'list' | 'document';
  routingMode: 'auto' | 'fixed';
  fixedModel: string | null;
  allowedModels: string[];
  allowEscalation: boolean;
  revision: number;
}
export interface TaskContext {
  goal: string;
  outputFormat: string;
  constraints: string[];
  decisions: string[];
  remaining: string[];
}
export interface AssistanceState {
  status: 'off' | 'pending' | 'prepared' | 'sent' | 'confirmed' | 'unavailable';
  requestedModel: string | null;
  appliedModel: string | null;
  reason: string;
  injectionBytes: number;
  updatedAt: number | null;
  contextPartial?: boolean;
  includedContextKeys?: (keyof TaskContext)[];
}
export interface AssistanceTask {
  identity: ChatIdentity;
  enabled: boolean;
  context: TaskContext;
  revision: number;
  updatedAt: number | null;
  assistance: AssistanceState;
  recipeId: string | null;
  quality: { status: 'unchecked' | 'passed' | 'needs-review'; findings: string[]; repairCount: number };
  workStyleOverride: UserPreferences['workStyle'] | null;
  settingsRevision: number;
  previousContext: TaskContext | null;
  changeSummary: string;
}
export interface ProviderCapabilities {
  inputAssistance: boolean;
  modelSwitch: boolean;
  reasoningSwitch: boolean;
  contextSync: boolean;
  tokenUsage: boolean;
  additionalRepair: boolean;
  verification: string;
}
export interface AssistanceSnapshot {
  preferences: UserPreferences;
  tasks: AssistanceTask[];
  capabilities: Record<Provider, ProviderCapabilities>;
}
