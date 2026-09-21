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

