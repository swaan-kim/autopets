import { PROVIDERS, isRecord } from './constants.mjs';
import { bounded, controlCharacters } from './validation.mjs';

export function validateIdentity(value) {
  if (!isRecord(value) || !PROVIDERS.includes(value.provider) || Object.keys(value).some(key => !['provider', 'accountId', 'chatId'].includes(key))) throw new Error('identity-shape');
  for (const [key, bytes] of [['accountId', 200], ['chatId', 512]]) if (!bounded(value[key], bytes) || controlCharacters.test(value[key])) throw new Error('identity-shape');
  return { provider: value.provider, accountId: value.accountId, chatId: value.chatId };
}
