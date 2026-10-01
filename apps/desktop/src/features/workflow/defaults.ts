import type { WorkflowCapabilities, WorkflowSnapshot } from '@autopets/contracts/types';

const unsupported: WorkflowCapabilities = { modelObservation: false, reasoningObservation: false, modeObservation: false, submissionHold: false, inputPreservation: false, singleSubmission: false, modelSwitch: false, reasoningSwitch: false, planModeSwitch: false, verification: 'unverified', availableModels: [], requestIdentity: false };
export const EMPTY_WORKFLOW: WorkflowSnapshot = {
  preferences: { version: 1, enabled: false, preset: 'balanced', planFirst: true, planning: { model: 'gpt-5.6-sol', reasoning: 'medium' }, execution: { model: 'gpt-5.6-terra', reasoning: 'medium' }, revision: 0 },
  tasks: [], capabilities: { codex: { ...unsupported }, chatgpt: { ...unsupported } },
};
