// The start request the app places in a new AI chat (or copies). Pure and browser-safe.
// It carries only what the user chose and typed: the pet, its recipe and the job in their words.
// The questions to ask and the working rules live in the AutoPets skill and recipes.json, so
// the request fits a protocol link and the user can simply press send.

/** Windows protocol launches are only reliable below the classic URL limit (same value as the app's Rust check). */
export const MAX_LAUNCH_URI = 2000;
const CODEX_NEW_THREAD = 'codex://threads/new?prompt=';

const line = value => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {{ name: string, petId: string, petRevision: number, recipe?: string | null, task?: string,
 *   audience?: string, message?: string, newTask?: boolean, figma?: boolean }} input
 */
export function petStartRequest({ name, petId, petRevision, recipe = null, task = '', audience = '', message = '', newTask = false, figma = false }) {
  return [
    `AutoPets 스킬로 "${name}" 시작해줘. petId=${petId}, petRevision=${petRevision}${recipe ? `, recipe=${recipe}` : ''}.`,
    line(task) && `할 일: ${line(task)}`,
    line(audience) && `이 페이지를 볼 사람: ${line(audience)}`,
    line(message) && `꼭 알릴 내용: ${line(message)}`,
    newTask && '새 작업이야. 이전 작업의 계획이나 승인을 재사용하지 마.',
    figma && 'Figma 시안을 쓸 거야. 프레임 링크부터 나에게 확인해줘.',
  ].filter(Boolean).join('\n');
}

/** Length of the Codex new-thread link for a request, using the app's percent-encoding (unreserved characters stay). */
export function codexLinkLength(prompt) {
  let length = CODEX_NEW_THREAD.length;
  for (const byte of new TextEncoder().encode(prompt)) length += /[A-Za-z0-9\-._~]/u.test(String.fromCharCode(byte)) ? 1 : 3;
  return length;
}

export const fitsCodexLink = prompt => codexLinkLength(prompt) <= MAX_LAUNCH_URI;
