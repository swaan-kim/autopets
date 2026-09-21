import { MAX_CONTEXT_BYTES, isRecord, utf8Bytes } from './constants.mjs';
import { bounded } from './validation.mjs';

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

