import { createHash } from 'node:crypto';
import path from 'node:path';
import { isChildHook } from '../hooks/scope.mjs';

const text = (v, max = 256) => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v) <= max && !/[\p{Cc}]/u.test(v);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const PROFILES = Object.freeze({
  light: { name: 'autopets-build-light', model: 'gpt-6-luna', effort: 'low' },
  standard: { name: 'autopets-build-standard', model: 'gpt-6-sol', effort: 'low' },
  careful: { name: 'autopets-build-careful', model: 'gpt-6-sol', effort: 'medium' },
  plan: { name: 'autopets-build-plan', model: 'gpt-6-luna', effort: 'low', readOnly: true },
});

export function availableProfile(key, models) {
  const profile = PROFILES[key];
  if (!profile || !Array.isArray(models)) throw Error('unsupported-delegation-profile');
  const matches = models.filter(m => m.model === profile.model);
  if (matches.length !== 1 || !matches[0].supportedReasoningEfforts?.includes(profile.effort)) throw Error('unavailable-delegation-profile');
  return { ...profile };
}

// Explicit leading controls only: quoted task material cannot change routing.
// No request text is returned, stored, or sent to a classification model.
export function selectProfile(prompt, defaultKey, models) {
  if (typeof prompt !== 'string' || Buffer.byteLength(prompt) > 128 * 1024) throw Error('invalid-delegation-input');
  let key = defaultKey;
  const line = prompt.split(/\r?\n/u, 1)[0].trim();
  const rules = [['이번만 가볍게', 'light'], ['이번만 꼼꼼하게', 'careful'], ['이번만 표준으로', 'standard'], ['계획만', 'plan']];
  for (const [prefix, candidate] of rules) if (line === prefix || line.startsWith(`${prefix}:`) || line.startsWith(`${prefix} `)) key = candidate;
  return { key, profile: availableProfile(key, models), oneRequestOnly: key !== defaultKey };
}

export function renderAgentProfiles({ models, skillPath, roleInstruction }) {
  if (!path.isAbsolute(skillPath) || path.basename(skillPath) !== 'SKILL.md' || !text(skillPath, 32768)
    || typeof roleInstruction !== 'string' || !roleInstruction.trim() || Buffer.byteLength(roleInstruction) > 2048) throw Error('invalid-delegation-skill');
  const files = [];
  for (const key of Object.keys(PROFILES)) {
    const profile = availableProfile(key, models);
    const instruction = `${roleInstruction}\n선택된 제작 스킬: ${skillPath}\n작업 시작 시 이 스킬을 읽고 적용하세요. 사용자 요청과 호스트 권한을 우선하세요. 추가 하위 에이전트를 만들거나 AutoPets를 다시 호출하지 마세요. 필요한 결과와 실제 검증만 부모 작업에 반환하세요.${profile.readOnly ? '\n계획만 제시하고 사용자 확인을 기다리세요. 파일을 변경하지 마세요.' : ''}`;
    if (Buffer.byteLength(instruction) > 3072) throw Error('delegation-instruction-limit');
    const toml = `# AutoPets generated profile v1\nname = ${JSON.stringify(profile.name)}\ndescription = ${JSON.stringify(`AutoPets 제작 펫 · ${key}; explicitly selected delegated work only`)}\nmodel = ${JSON.stringify(profile.model)}\nmodel_reasoning_effort = ${JSON.stringify(profile.effort)}\ndeveloper_instructions = ${JSON.stringify(instruction)}\n${profile.readOnly ? 'sandbox_mode = "read-only"\n' : ''}\n[agents]\nenabled = false\n\n[[skills.config]]\npath = ${JSON.stringify(skillPath)}\nenabled = true\n`;
    files.push({ name: `${profile.name}.toml`, content: toml, sha256: createHash('sha256').update(toml).digest('hex') });
  }
  return files;
}

const eventKinds = Object.freeze({ SubagentStart: 'child-started', SubagentStop: 'child-stopped', UserPromptSubmit: 'child-turn-started',
  PreToolUse: 'child-tool-started', PostToolUse: 'child-tool-finished', Stop: 'child-turn-stopped', PermissionRequest: 'child-attention' });
export function delegationEvent(input) {
  if (!isChildHook(input) || !text(input.session_id) || !text(input.agent_id) || input.session_id === input.agent_id
    || !text(input.cwd, 32768) || !path.isAbsolute(input.cwd) || !text(input.turn_id)
    || !text(input.agent_type) || !Object.values(PROFILES).some(p => p.name === input.agent_type)) return null;
  const kind = eventKinds[input.hook_event_name];
  if (!kind) return null;
  const tool = ['PreToolUse', 'PostToolUse'].includes(input.hook_event_name);
  if (tool && (!text(input.tool_use_id) || !text(input.tool_name))) return null;
  // reportedTurnId is deliberately not assumed to be a parent/child request ID.
  // No approval, model application or whole-task completion is inferred here.
  return { version: 1, eventId: hash([input.session_id, input.agent_id, input.turn_id, kind, input.tool_use_id ?? '']),
    parentSessionId: input.session_id, agentId: input.agent_id, reportedTurnId: input.turn_id,
    agentType: input.agent_type, cwd: input.cwd, kind,
    ...(tool ? { toolCallId: input.tool_use_id, toolName: input.tool_name, toolError: input.tool_response?.isError === true } : {}),
    observedModel: text(input.model, 128) ? input.model : null,
    evidence: 'hook-observation', executionSettingsVerified: false };
}
