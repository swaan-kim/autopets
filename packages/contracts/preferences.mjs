import { WORK_STYLES, ANSWER_LENGTHS, OUTPUT_FORMATS, isRecord } from './constants.mjs';
import { bounded } from './validation.mjs';

export function validatePreferences(value) {
  const keys = ['enabled', 'workStyle', 'answerLength', 'outputFormat', 'routingMode', 'fixedModel', 'allowedModels', 'allowEscalation', 'revision'];
  const answerLength = value?.answerLength === undefined ? 'concise' : value.answerLength;
  const outputFormat = value?.outputFormat === undefined ? 'adaptive' : value.outputFormat;
  if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key))
    || typeof value.enabled !== 'boolean' || !WORK_STYLES.includes(value.workStyle)
    || !ANSWER_LENGTHS.includes(answerLength) || !OUTPUT_FORMATS.includes(outputFormat)
    || !['auto', 'fixed'].includes(value.routingMode) || typeof value.allowEscalation !== 'boolean'
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !(value.fixedModel === null || bounded(value.fixedModel, 128))
    || value.routingMode === 'fixed' && value.fixedModel === null
    || !Array.isArray(value.allowedModels) || value.allowedModels.length > 32
    || value.allowedModels.some(item => !bounded(item, 128))) throw new Error('preferences-shape');
  return { enabled: value.enabled, workStyle: value.workStyle, answerLength, outputFormat, routingMode: value.routingMode, fixedModel: value.fixedModel,
    allowedModels: [...value.allowedModels], allowEscalation: value.allowEscalation, revision: value.revision };
}

// Explicit values must come from a verified caller decision, never arbitrary
// keyword extraction from quoted prompt/task content. They are not persisted.
export function resolvePreferences({ preferences, task = {}, explicit = {} }) {
  const result = validatePreferences(preferences);
  if (!isRecord(task) || !isRecord(explicit) || Object.keys(explicit).some(key => !['workStyle', 'answerLength', 'outputFormat'].includes(key))) throw new Error('preferences-override');
  const override = task.workStyleOverride ?? null;
  if (override !== null && !WORK_STYLES.includes(override)) throw new Error('preferences-override');
  if (task.settingsRevision !== undefined && (!Number.isSafeInteger(task.settingsRevision) || task.settingsRevision < 0)) throw new Error('settings-revision');
  if (override !== null) result.workStyle = override;
  for (const [key, allowed] of [['workStyle', WORK_STYLES], ['answerLength', ANSWER_LENGTHS], ['outputFormat', OUTPUT_FORMATS]]) {
    if (Object.hasOwn(explicit, key)) {
      if (!allowed.includes(explicit[key])) throw new Error('preferences-override');
      result[key] = explicit[key];
    }
  }
  return result;
}
