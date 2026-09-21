export function checkQuality({ recipe, requirements = {}, output, selfReport = null }) {
  const text = typeof output === 'string' ? output : '';
  const findings = [], checked = [], checks = [];
  const check = (id, label, passed, finding) => {
    checks.push({ id, label, method: 'code', status: passed ? 'passed' : 'needs-review' });
    if (!checked.includes(label)) checked.push(label);
    if (!passed) findings.push(finding);
  };
  const unsupported = (id, label) => checks.push({ id, label, method: 'unsupported', status: 'unchecked' });
  if (Array.isArray(requirements.requiredTerms) && requirements.requiredTerms.length) {
    requirements.requiredTerms.forEach((term, index) => {
      if (typeof term === 'string' && term.trim()) check(`requiredTerms:${index}`, '필수 항목', text.includes(term), `필수 항목 누락: ${term}`);
      else unsupported(`requiredTerms:${index}`, '필수 항목 정의 확인');
    });
  } else if (requirements.requiredTerms !== undefined && !Array.isArray(requirements.requiredTerms)) unsupported('requiredTerms', '필수 항목 정의 확인');
  if (Array.isArray(requirements.requiredContent)) {
    requirements.requiredContent.forEach((item, index) => {
      const value = typeof item === 'string' ? item : item?.text;
      if (typeof value === 'string' && value.trim()) check(`requiredContent:${index}`, '필수 내용의 문자 포함', text.includes(value), `필수 내용 누락: ${value}`);
      else unsupported(`requiredContent:${index}`, '필수 내용 의미 확인');
    });
  } else if (requirements.requiredContent !== undefined) unsupported('requiredContent', '필수 내용 의미 확인');
  if (Number.isSafeInteger(requirements.maxChars) && requirements.maxChars > 0) check('maxChars', '최대 길이', [...text].length <= requirements.maxChars, '요청한 최대 길이를 넘었어요');
  else if (requirements.maxChars !== undefined) unsupported('maxChars', '최대 길이 정의 확인');
  if (requirements.requiresTable === true) check('requiresTable', '표 형식', /^\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}/mu.test(text), '요청한 비교표 형식을 확인해주세요');
  if (requirements.requiresSources === true) check('requiresSources', '출처 표시', /https?:\/\/[^\s<>\])]+/u.test(text), '출처 링크가 없어요');
  if (requirements.factualAccuracy === true) unsupported('factualAccuracy', '사실 정확성');
  if (requirements.sourceAccuracy === true) unsupported('sourceAccuracy', '출처가 주장을 뒷받침하는지');
  if (selfReport !== null && selfReport !== undefined) {
    checks.push({ id: 'selfReport', label: '모델 자체 보고', method: 'self-report', status: 'unchecked',
      reportedStatus: ['passed', 'needs-review', 'unchecked'].includes(selfReport?.status) ? selfReport.status : 'unchecked' });
  }
  return { status: findings.length ? 'needs-review' : checked.length && checks.every(item => item.status === 'passed') ? 'passed' : 'unchecked', findings: findings.slice(0, 12), checked, checks,
    scope: '형식·명시 내용의 문자 포함 점검이며 사실 정확성 검증이 아닙니다', recipeId: recipe?.id ?? 'general', repairCount: 0 };
}

export function repairDecision({ quality, repairCount = 0, capabilities, optedIn, inFlight = false, identityVerified = false }) {
  if (!optedIn || !identityVerified || inFlight || capabilities?.additionalRepair !== true || capabilities?.verification !== 'verified'
    || quality?.status !== 'needs-review' || !quality.findings?.length || repairCount !== 0) return { action: 'none', reason: '자동 보완 조건을 충족하지 않았어요' };
  return { action: 'repair-once', reason: '확인된 누락만 한 번 보완해요', prompt: `원래 요청의 조건을 유지하고 다음 누락만 보완하세요. 이미 완료한 작업은 반복하지 마세요.\n${quality.findings.slice(0, 12).map(item => `- ${item}`).join('\n')}` };
}
