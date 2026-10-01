import { isRecord, utf8Bytes } from './constants.mjs';
import { bounded } from './validation.mjs';

export const WORKFLOW_PHASES = Object.freeze(['unknown', 'planning', 'ready', 'executing', 'review']);
export const WORKFLOW_REASONING = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export const unverifiedWorkflowCapabilities = () => ({ modelObservation: false, reasoningObservation: false, modeObservation: false,
  submissionHold: false, inputPreservation: false, singleSubmission: false, requestIdentity: false, modelSwitch: false, reasoningSwitch: false, planModeSwitch: false, availableModels: [], verification: 'unverified' });
export function validateWorkflowPlan(value) {
  if (!isRecord(value) || Object.keys(value).some(key => !['summary', 'steps', 'completionCriteria'].includes(key))
    || !bounded(value.summary, 1024) || !['steps', 'completionCriteria'].every(key => Array.isArray(value[key])
      && value[key].length <= 12 && value[key].every(item => bounded(item, 512)))
    || utf8Bytes(JSON.stringify(value)) > 3072) throw new Error('workflow-plan');
  return { summary: value.summary, steps: [...value.steps], completionCriteria: [...value.completionCriteria] };
}
export function validWorkflowTask(task) {
  return isRecord(task) && typeof task.enabled === 'boolean' && typeof task.planFirst === 'boolean'
    && WORKFLOW_PHASES.includes(task.phase) && ['settingsRevision', 'planRevision'].every(key => Number.isSafeInteger(task[key]) && task[key] >= 0)
    && ['planning', 'execution'].every(key => isRecord(task[key]) && bounded(task[key].model, 128) && WORKFLOW_REASONING.includes(task[key].reasoning));
}
export const workflowApproved = task => validWorkflowTask(task) && isRecord(task.approval)
  && task.approval.settingsRevision === task.settingsRevision && task.approval.planRevision === task.planRevision;
