import { createHash } from 'node:crypto';
import { validWorkflowTask, utf8Bytes } from '../../../packages/contracts/index.mjs';
import { explicitPlanChange, workflowIntent } from '../../../packages/guidance/index.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export const identityFor = sessionId => ({ provider: 'codex', accountId: `session:${hash(sessionId)}`, chatId: sessionId });
const modelSlug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(value) ? value : null;
export function explicitRequestModel(prompt) {
  if (typeof prompt !== 'string') return null;
  const line = prompt.split(/\r?\n/u, 1)[0];
  if (line.length > 180) return null;
  const match = /^(?:(?:모델|model)\s*:\s*(gpt-6-astra|gpt-5\.6-(?:sol|terra|luna))|\/model\s+(gpt-6-astra|gpt-5\.6-(?:sol|terra|luna))|이번 요청은 (Astra|Sol|Terra|Luna|gpt-6-astra|gpt-5\.6-(?:sol|terra|luna)) 모델로 진행해(?:줘|주세요))[.!]?$/iu.exec(line.trim());
  if (!match) return null;
  const value = (match[1] ?? match[2] ?? match[3]).toLowerCase();
  return ({ astra: 'gpt-6-astra', sol: 'gpt-5.6-sol', terra: 'gpt-5.6-terra', luna: 'gpt-5.6-luna' })[value] ?? value;
}
export function submissionEvidence(input) {
  if (typeof input?.prompt !== 'string' || utf8Bytes(input.prompt) > 128 * 1024 || !input.session_id || !input.turn_id) return null;
  const requestFingerprint = hash(input.prompt);
  const submissionId = hash(JSON.stringify(['codex', input.session_id, input.turn_id, requestFingerprint]));
  return { requestFingerprint, submissionId, observation: { model: modelSlug(input.model), reasoning: null, mode: null,
    source: 'hook', observedAt: Date.now(), submissionId } };
}
export async function preflightSubmission(input, request) {
  const unavailable = { decision: 'passthrough', reason: '보호 확인 불가', available: false, suppressStart: false };
  const evidence = submissionEvidence(input);
  if (!evidence) return unavailable;
  const identity = identityFor(input.session_id), binding = { sessionId: input.session_id, cwd: input.cwd, turnId: input.turn_id };
  try {
    const data = await request('/v1/workflow', { operation: 'read', identity, binding });
    if (!validWorkflowTask(data?.task)) return { ...unavailable, error: true };
    const intent = workflowIntent(input.prompt, data.task);
    const result = await request('/v1/workflow', { operation: 'preflight', identity, binding,
      expectedSettingsRevision: data.task.settingsRevision, expectedPlanRevision: data.task.planRevision,
      ...evidence, intent, explicitModel: explicitRequestModel(input.prompt), planChanged: explicitPlanChange(input.prompt) });
    if (result?.ok !== true || !['hold', 'allow', 'passthrough'].includes(result.decision) || !validWorkflowTask(result.task)) return { ...unavailable, error: true };
    const cap = data.capabilities;
    // This verified hold capability also attests an installed synchronous prep
    // hook, preservation of text/attachments, and a single resumed submission.
    const canHold = cap?.verification === 'verified' && cap.submissionHold === true && cap.inputPreservation === true
      && cap.singleSubmission === true && cap.modelObservation === true && result.task.enabled
      && ['planning', 'ready', 'executing', 'review'].includes(result.task.phase)
      && evidence.observation.model !== null && modelSlug(result.target?.model) !== null
      && Array.isArray(cap.availableModels) && cap.availableModels.some(item => item?.model === result.target.model && Array.isArray(item.reasoning) && item.reasoning.includes(result.target.reasoning))
      && evidence.observation.model !== result.target.model;
    if (result.decision === 'hold' && !canHold) return { ...unavailable, error: true };
    return { ...result, available: true, intent, submissionId: evidence.submissionId, capabilities: cap, suppressStart: result.decision === 'hold',
      reason: typeof result.reason === 'string' && utf8Bytes(result.reason) <= 1024 ? result.reason : '설정을 확인한 뒤 다시 보내세요.' };
  } catch { return { ...unavailable, error: true }; } // Host submission and original observation stay fail-open.
}
