export const MAX_INJECTION_BYTES = 3072;
export const MAX_CONTEXT_BYTES = 3072;
export const PROVIDERS = Object.freeze(['codex', 'chatgpt']);
export const WORK_STYLES = Object.freeze(['auto', 'fast', 'thorough']);
export const ANSWER_LENGTHS = Object.freeze(['concise', 'normal', 'detailed']);
export const OUTPUT_FORMATS = Object.freeze(['adaptive', 'table', 'list', 'document']);
export const utf8Bytes = value => new TextEncoder().encode(value).length;
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const emptyContext = () => ({ goal: '', outputFormat: '', constraints: [], decisions: [], remaining: [] });
export const defaultPreferences = () => ({ enabled: false, workStyle: 'auto', answerLength: 'concise', outputFormat: 'adaptive', routingMode: 'auto', fixedModel: null, allowedModels: [], allowEscalation: false, revision: 0 });
export const unverifiedCapabilities = () => ({ inputAssistance: false, modelSwitch: false, reasoningSwitch: false, contextSync: false, tokenUsage: false, additionalRepair: false, verification: 'unverified' });

// Match Rust String::len (UTF-8 bytes) and char::is_control, not JS UTF-16 length.
const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/u;
const unsupportedContentControls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;
const unpairedSurrogate = /[\ud800-\udfff]/u;
const bounded = (value, bytes, allowEmpty = false) => typeof value === 'string'
  && (allowEmpty || !!value.trim()) && utf8Bytes(value) <= bytes
  && !unsupportedContentControls.test(value) && !unpairedSurrogate.test(value);

export function validateIdentity(value) {
  if (!isRecord(value) || !PROVIDERS.includes(value.provider) || Object.keys(value).some(key => !['provider', 'accountId', 'chatId'].includes(key))) throw new Error('identity-shape');
  for (const [key, bytes] of [['accountId', 200], ['chatId', 512]]) if (!bounded(value[key], bytes) || controlCharacters.test(value[key])) throw new Error('identity-shape');
  return { provider: value.provider, accountId: value.accountId, chatId: value.chatId };
}

export function validateContext(value) {
  const keys = ['goal', 'outputFormat', 'constraints', 'decisions', 'remaining'];
  if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('context-shape');
  const result = {};
  for (const key of keys) {
    if (['goal', 'outputFormat'].includes(key)) {
      if (!bounded(value[key], key === 'goal' ? 1024 : 512, true)) throw new Error('context-shape');
      result[key] = value[key];
    } else {
      if (!Array.isArray(value[key]) || value[key].length > 12 || value[key].some(item => !bounded(item, 512))) throw new Error('context-shape');
      result[key] = [...value[key]];
    }
  }
  if (utf8Bytes(JSON.stringify(result)) > MAX_CONTEXT_BYTES) throw new Error('context-limit');
  return result;
}

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
