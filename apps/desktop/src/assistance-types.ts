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
export const DEFAULT_PREFERENCES: UserPreferences = { enabled: false, workStyle: 'auto', answerLength: 'concise', outputFormat: 'adaptive', routingMode: 'auto', fixedModel: null, allowedModels: [], allowEscalation: false, revision: 0 };
const unsupported: ProviderCapabilities = { inputAssistance: false, modelSwitch: false, reasoningSwitch: false, contextSync: false, tokenUsage: false, additionalRepair: false, verification: 'unverified' };
export const EMPTY_ASSISTANCE: AssistanceSnapshot = { preferences: DEFAULT_PREFERENCES, tasks: [], capabilities: { codex: { ...unsupported }, chatgpt: { ...unsupported } } };
export const identityKey = (identity: ChatIdentity) => JSON.stringify([identity.provider, identity.accountId, identity.chatId]);
export function taskForSession(tasks: AssistanceTask[], sessionId?: string | null) {
  const matches = tasks.filter(task => task.identity.provider === 'codex' && task.identity.chatId === sessionId);
  return matches.length === 1 ? matches[0] : undefined;
}
