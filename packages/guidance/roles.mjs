const bytes = value => new TextEncoder().encode(value).length;
const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const skills = { 'research-document': 'autopets-research-document', 'build-implementation': 'autopets-build-implementation' };
export function rolePrompt(template) {
  const model = value => value === null || value && typeof value.model === 'string' && value.model.trim().length > 0
    && bytes(value.model) <= 128 && /^[a-zA-Z0-9_.-]+$/u.test(value.model) && efforts.includes(value.reasoning);
  if (!template || template.version !== 1 || !Object.hasOwn(skills, template.id)
    || Object.keys(template).some(key => !['id', 'version', 'name', 'instruction', 'planFirst', 'planning', 'execution', 'skills', 'prop', 'background'].includes(key))
    || typeof template.instruction !== 'string' || !template.instruction.trim() || bytes(template.instruction) > 1536
    || typeof template.name !== 'string' || !template.name.trim() || bytes(template.name) > 120 || /[\x00-\x1f\x7f]/u.test(template.name)
    || typeof template.planFirst !== 'boolean' || !model(template.planning) || !model(template.execution)
    || !['none', 'notebook'].includes(template.prop) || !['none', 'meadow'].includes(template.background)
    || template.skills?.length !== 1 || template.skills[0].id !== skills[template.id] || template.skills[0].version !== '1.0.0') throw new Error('Invalid role template');
  const settings = stage => template[stage] ? `${template[stage].model} / ${template[stage].reasoning}` : '현재 채팅 설정 유지';
  const text = [
    '선택한 AutoPets 역할 선호입니다. 최신 사용자 요청·현재 호스트 모드·권한을 우선하세요.',
    `역할: ${template.name}`, template.instruction,
    template.planFirst ? '복잡한 새 작업은 실행 전 계획을 확인하세요. 이 지침 자체는 native Plan 모드가 아닙니다.' : '필요한 만큼만 계획하고 요청한 작업을 수행하세요.',
    `희망 설정: 계획 ${settings('planning')}, 실행 ${settings('execution')}. 모델·추론 변경 권한이나 적용 확인을 뜻하지 않습니다.`,
    `역할 스킬 참조: ${template.skills[0].id}@${template.skills[0].version}. 사용 가능 여부를 확인하기 전에는 스킬 실행을 주장하지 마세요.`,
  ].join('\n');
  if (bytes(text) > 3072) throw new Error('Role instruction exceeds 3KB');
  return text;
}

// The server supplies the immutable assignment from the exact task. Never accept
// a profile from a different task or from hook input as first-turn instructions.
export function roleGuidance(binding, identity, workflowEnabled = false) {
  if (binding == null) return '';
  if (!binding.identity || !identity || ['provider', 'accountId', 'chatId'].some(key => binding.identity[key] !== identity[key])
    || typeof binding.enabled !== 'boolean' || !Number.isSafeInteger(binding.revision) || binding.revision < 1
    || !Number.isSafeInteger(binding.petRevision) || binding.petRevision < 1) throw new Error('Invalid role binding');
  if (!binding.enabled) return '';
  rolePrompt(binding.template); // Shared strict template/version validation.
  const template = binding.template;
  return ['\n선택한 역할 지침(최신 요청·현재 권한 우선):', template.instruction,
    ...(!workflowEnabled && template.planFirst ? ['복잡한 새 작업은 실행 전 계획을 확인하세요. native Plan 모드 전환은 아닙니다.'] : []),
    `역할 스킬: ${template.skills[0].id}@${template.skills[0].version}. 가용성 확인 후 사용하고 실행 여부는 확인된 결과만 알리세요.`].join('\n');
}
