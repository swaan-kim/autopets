// The start request the app places in a new AI chat (or copies). Pure and browser-safe.
// It carries only what the user chose and typed: the pet, its recipe and the job in their words.
// The questions to ask and the working rules live in the AutoPets skill, the MCP tools and
// recipes.json, so the request fits a protocol link and the user can simply press send.
// The same request works in every AI; only the first words name how that AI reaches AutoPets.

/** Windows protocol launches are only reliable below the classic URL limit (same value as the app's Rust check). */
export const MAX_LAUNCH_URI = 2000;
const CODEX_NEW_THREAD = 'codex://threads/new?prompt=';

const line = value => (typeof value === 'string' ? value.trim() : '');

// Presentation pet options (Issue #104, prototype before the team decision). Each is one short line
// the AI reads; the steps live in the AutoPets skill (references/explicit-pet.md), not in the request.
// Kept short on purpose: a Korean character costs 9 characters in the Codex link (2000 at most), and
// longer lines pushed the request over the limit, so the app copied it instead of opening the chat.
export const PPTX_REQUEST = 'PPTX도 만들어줘.';
export const DESIGN_REFERENCE_REQUEST = '디자인 참고 사진 있어.';
const DESIGN_REF = /^[0-9a-f]{12}$/u;
/**
 * The design line. With a `ref` (photos pasted in the app and saved under its data folder as
 * design-references/<ref>/) the AI opens those files; without one it asks for photos in the chat.
 */
export const designReferenceLine = ref => (typeof ref === 'string' && DESIGN_REF.test(ref) ? `디자인 참고 사진 있어: ref=${ref}.` : DESIGN_REFERENCE_REQUEST);

/**
 * @param {{ name: string, petId: string, petRevision: number, recipe?: string | null, task?: string,
 *   audience?: string, message?: string, newTask?: boolean, figma?: boolean, pptx?: boolean,
 *   designReference?: boolean | string, via?: 'skill' | 'tool' }} input
 *   `designReference` is `true` (photos follow in the chat) or the 12-character ref of photos saved by the app.
 *   `via: 'skill'` (Codex) calls the AutoPets skill; `via: 'tool'` (Claude) names the AutoPets read tool.
 */
export function petStartRequest({ name, petId, petRevision, recipe = null, task = '', audience = '', message = '', newTask = false, figma = false, pptx = false, designReference = false, via = 'skill' }) {
  const identity = `petId=${petId}, petRevision=${petRevision}${recipe ? `, recipe=${recipe}` : ''}.`;
  return [
    via === 'tool' ? `AutoPets 도구(autopets_read_pet)로 "${name}" 펫을 불러와 시작해줘. ${identity}` : `AutoPets 스킬로 "${name}" 시작해줘. ${identity}`,
    line(task) && `할 일: ${line(task)}`,
    line(audience) && `이 페이지를 볼 사람: ${line(audience)}`,
    line(message) && `꼭 알릴 내용: ${line(message)}`,
    newTask && '새 작업이야. 이전 작업의 계획이나 승인을 재사용하지 마.',
    figma && 'Figma 시안을 쓸 거야. 프레임 링크부터 나에게 확인해줘.',
    pptx && PPTX_REQUEST,
    designReference && designReferenceLine(designReference),
  ].filter(Boolean).join('\n');
}

/** Length of the Codex new-thread link for a request, using the app's percent-encoding (unreserved characters stay). */
export function codexLinkLength(prompt) {
  let length = CODEX_NEW_THREAD.length;
  for (const byte of new TextEncoder().encode(prompt)) length += /[A-Za-z0-9\-._~]/u.test(String.fromCharCode(byte)) ? 1 : 3;
  return length;
}

export const fitsCodexLink = prompt => codexLinkLength(prompt) <= MAX_LAUNCH_URI;
