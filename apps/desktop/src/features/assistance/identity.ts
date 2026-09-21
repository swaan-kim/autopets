import type { AssistanceTask, ChatIdentity } from '@autopets/contracts/types';

export const identityKey = (identity: ChatIdentity) => JSON.stringify([identity.provider, identity.accountId, identity.chatId]);
export function uniqueIdentities(...groups: { identity: ChatIdentity }[][]) {
  return [...new Map(groups.flat().map(task => [identityKey(task.identity), task.identity])).values()];
}
export function taskForSession(tasks: AssistanceTask[], sessionId?: string | null) {
  const matches = tasks.filter(task => task.identity.provider === 'codex' && task.identity.chatId === sessionId);
  return matches.length === 1 ? matches[0] : undefined;
}
