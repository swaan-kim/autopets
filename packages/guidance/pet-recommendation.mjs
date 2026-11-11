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

// Codex chats are mostly code work: a cue inside a development request ("슬라이드 버그 고쳐줘",
// "PPT 파싱 코드", "오늘 커밋 정리") is about the code, not a request for that pet. Precision first.
const DEVELOPMENT = /(?:버그|에러|오류|고쳐|디버그|리팩(?:터|토링)|함수|컴포넌트|모듈|클래스|변수|파싱|파서|테스트|픽스처|커밋|브랜치|스프린트|인덱스|스키마|쿼리|빌드|배포|정규식|README|기능|코드|API|\bDB\b|\.(?:tsx?|jsx?|mjs|cjs|rs|py|json|ya?ml|toml|md|css|html)\b|\b(?:bug|fix|refactor|tests?|function|component|commit|branch|parse|regex|code)\b)/iu;
// "발표 자료 말고", "PPT는 빼고", "슬라이드 없이": the user is excluding that deliverable.
// One short word may sit between the cue and the negation ("발표" + " 자료 말고").
const NEGATED = /^\s*(?:은|는|을|를|이|가|도)?\s*(?:\S{1,4}\s+)?(?:말고|빼고|대신|없이|제외|필요\s*없|안\s*(?:해|만들|돼)|아니)/u;
// Short topic words must start a word: "덱" is not in "인덱스", "사이트" is not in "인사이트".
const WORD_START = '(?<![\\p{L}\\p{N}])';

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const compile = (list, prefix = '') => (Array.isArray(list) ? list : []).filter(item => typeof item === 'string' && item.length > 0 && item.length <= 200)
  .map(source => new RegExp(`${prefix}(?:${source})`, 'giu'));
// First occurrence of each pattern that the user did not negate.
const firstMatches = (patterns, text) => {
  const found = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (!match[0].trim()) continue;
      if (NEGATED.test(text.slice(match.index + match[0].length, match.index + match[0].length + 16))) continue;
      found.push({ text: match[0].trim(), index: match.index });
      break;
    }
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
      topics: compile(intent?.topics, WORD_START), deliverables: compile(intent?.deliverables),
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
  if (DEVELOPMENT.test(text)) return { ...base, status: 'none', reason: 'development' };
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
