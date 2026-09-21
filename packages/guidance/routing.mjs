import { validatePreferences } from '../contracts/index.mjs';

export function selectRoute({ recipe, preferences, capabilities, currentModel, models = [], evaluations = [], explicitModel = null, provider, now = Date.now(), inFlight = false }) {
  const prefs = validatePreferences(preferences);
  const result = (action, targetModel, reason, requiresConfirmation = false) => ({ action, targetModel, requestedModel: targetModel, appliedModel: null, reason, requiresConfirmation });
  const keep = reason => result('preserve', currentModel ?? null, reason);
  if (!prefs.enabled) return keep('자동 도움이 꺼져 있어요');
  if (inFlight) return keep('진행 중인 응답은 유지해요');
  const available = models.filter(model => model && typeof model.id === 'string' && model.available === true);
  const known = id => available.some(model => model.id === id);
  const canSwitch = capabilities?.modelSwitch === true && capabilities?.verification === 'verified';
  const pick = (target, reason, escalation = false) => !canSwitch || escalation && !prefs.allowEscalation
    ? result('recommend', target, !canSwitch ? '실제 모델 변경 연결을 아직 검증하지 못했어요' : reason, escalation && !prefs.allowEscalation)
    : result(target === currentModel ? 'preserve' : 'switch', target, reason);
  // An explicit current-turn choice is user authorization, not an automatic escalation.
  if (explicitModel) return known(explicitModel) ? pick(explicitModel, '이번 요청에서 지정한 모델을 우선해요') : keep('지정한 모델의 사용 가능 여부를 확인해야 해요');
  if (prefs.routingMode === 'fixed') return prefs.fixedModel && known(prefs.fixedModel) ? pick(prefs.fixedModel, '고정한 모델을 사용해요') : keep('고정한 모델의 사용 가능 여부를 확인해야 해요');
  if (recipe?.id !== 'simple' || recipe?.confidence !== 'high') return keep('현재 모델로 필요한 품질을 우선해요');
  if (!known(currentModel)) return keep('현재 모델을 확인할 수 없어 설정을 유지해요');
  const current = available.find(model => model.id === currentModel);
  const versionKnown = value => typeof value === 'string' && value.trim().length > 0;
  if (!versionKnown(current.version)) return keep('현재 모델 버전을 확인할 수 없어 설정을 유지해요');
  const candidates = evaluations.filter(item => item && item.source === 'live' && item.provider === provider && item.recipeId === 'simple' && item.qualityPassed === true
    && item.baselineModel === currentModel && versionKnown(item.modelVersion) && versionKnown(item.baselineVersion) && item.baselineVersion === current.version
    && Number.isFinite(item.expiresAt) && item.expiresAt > now && item.evidenceId && Number.isFinite(item.relativeUsage) && item.relativeUsage > 0 && item.relativeUsage < 1
    && known(item.modelId) && prefs.allowedModels.includes(item.modelId)
    && available.find(model => model.id === item.modelId)?.version === item.modelVersion).sort((a, b) => a.relativeUsage - b.relativeUsage);
  if (!candidates.length) return keep('평가를 통과한 절약 경로가 없어 현재 설정을 유지해요');
  return pick(candidates[0].modelId, '이 유형의 품질 평가를 통과한 가벼운 모델이에요');
}
