// Local, deterministic recommendation of an EXISTING catalog pet for one user request.
// No model call, no network, no storage. The result is a hint the user must accept;
// an unclear request returns no candidate instead of a forced guess.
import defaultCatalog from '../contracts/data/pet-catalog.json' with { type: 'json' };
import defaultIntents from '../contracts/data/pet-intents.json' with { type: 'json' };

export const MAX_RECOMMENDATIONS = 2;
export const MAX_REQUEST_CHARS = 1200;
const MAX_INPUT_CHARS = 8000;

const GREETING = /^(?:안녕(?:하세요|하십니까)?|하이|헬로|hi|hello|hey|고마워(?:요)?|감사(?:합니다|해요)?|ㅎㅇ|좋아(?:요)?|오케이|ok|okay|네|응|넵|굿)[\s!~.?ㅎㅋ^]*$/iu;
// AutoPets' own commands and pet follow-ups are handled by the existing pet flow.
const META = /(?:\$autopets?\b|autopets?\s*스킬|오토펫|펫\s*(?:상태\s*확인|연결|으로|에게|추천|설정)|그대로\s*구현해)/iu;
// A request must ask for work; questions or statements about a topic are not tasks.
const TASK = /(?:해\s*(?:줘|주세요|줄래|주라|봐)|줘|주세요|줄래|부탁|싶어|싶은데|하자|할래|필요해|만들|짜\s*(?:줘|봐|자)|세워|작성|써\s*(?:줘|봐)|정리|도와|알려|추천|계획|준비|설명|구성|please|make|create|write|plan|help)/iu;

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const compile = list => (Array.isArray(list) ? list : []).filter(item => typeof item === 'string' && item.length > 0 && item.length <= 200)
  .map(source => new RegExp(source, 'giu'));
const firstMatches = (patterns, text) => {
  const found = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && match[0].trim()) found.push({ text: match[0].trim(), index: match.index });
  }
  return found;
};

/** Build matchers from catalog + intent data. Pets without intent data are matched by their exact catalog name. */
export function buildRecommender({ catalog = defaultCatalog, intents = defaultIntents } = {}) {
  if (!Array.isArray(catalog)) throw Error('catalog-required');
  const definitions = new Map((intents?.intents ?? []).filter(item => item && typeof item.petId === 'string').map(item => [item.petId, item]));
  const pets = catalog.filter(entry => entry && typeof entry.id === 'string' && typeof entry.name === 'string').map(entry => {
    const intent = definitions.get(entry.id);
    const nameCue = escape(entry.name.trim()).replace(/\s+/gu, '\\s*');
    return {
      id: entry.id, name: entry.name,
      reason: typeof intent?.reason === 'string' && intent.reason.length <= 120 ? intent.reason : `${entry.name}에 맞는 요청 같아요.`,
      strong: compile([...(intent?.strong ?? []), nameCue]),
      topics: compile(intent?.topics), deliverables: compile(intent?.deliverables),
      suppressedBy: Array.isArray(intent?.suppressedBy) ? intent.suppressedBy.filter(id => typeof id === 'string') : [],
    };
  });
  return { pets, known: new Set(pets.map(pet => pet.id)) };
}

const shared = buildRecommender();

/**
 * @returns {{ status: 'match'|'none'|'skipped', reason: string, request: string, requestTruncated: boolean,
 *   candidates: { petId: string, reason: string, cues: string[] }[] }}
 */
export function recommendPets(prompt, { exclude = [], limit = MAX_RECOMMENDATIONS, recommender = shared } = {}) {
  const text = typeof prompt === 'string' ? prompt.normalize('NFKC').replace(/\s+/gu, ' ').trim() : '';
  const base = { request: text.slice(0, MAX_REQUEST_CHARS), requestTruncated: text.length > MAX_REQUEST_CHARS, candidates: [] };
  if (!text) return { ...base, status: 'skipped', reason: 'empty' };
  if (text.length > MAX_INPUT_CHARS) return { ...base, status: 'skipped', reason: 'too-long' };
  if (GREETING.test(text)) return { ...base, status: 'skipped', reason: 'greeting' };
  if (META.test(text)) return { ...base, status: 'skipped', reason: 'autopets-command' };
  if (!TASK.test(text)) return { ...base, status: 'none', reason: 'not-a-task' };
  const excluded = new Set(Array.isArray(exclude) ? exclude : []);
  let matches = recommender.pets.map(pet => {
    const strong = firstMatches(pet.strong, text), topics = firstMatches(pet.topics, text), deliverables = firstMatches(pet.deliverables, text);
    const qualifies = strong.length > 0 || (topics.length > 0 && deliverables.length > 0);
    const all = [...strong, ...topics, ...deliverables];
    const unique = [...new Set(all.sort((a, b) => a.index - b.index).map(item => item.text.slice(0, 32)))];
    // Show the user the words that triggered this pet, without repeating a cue inside a longer one.
    const cues = unique.filter(cue => !unique.some(other => other !== cue && other.includes(cue))).slice(0, 4);
    return { pet, qualifies, strong: strong.length > 0, score: strong.length * 3 + topics.length * 2 + deliverables.length,
      position: all.length ? Math.min(...all.map(item => item.index)) : Infinity, cues };
  }).filter(item => item.qualifies);
  const qualified = new Set(matches.map(item => item.pet.id));
  matches = matches.filter(item => !item.pet.suppressedBy.some(id => qualified.has(id)) && !excluded.has(item.pet.id));
  matches.sort((a, b) => Number(b.strong) - Number(a.strong) || a.position - b.position || b.score - a.score);
  const count = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_RECOMMENDATIONS) : MAX_RECOMMENDATIONS;
  const candidates = matches.slice(0, count).map(item => ({ petId: item.pet.id, reason: item.pet.reason, cues: item.cues }));
  return candidates.length ? { ...base, status: 'match', reason: candidates.length > 1 ? 'multiple' : 'single', candidates }
    : { ...base, status: 'none', reason: excluded.size && qualified.size ? 'already-using' : 'no-match' };
}
