import { petCatalog, type PetCatalogEntry } from './petCatalog';

// Local discovery only. A recommendation never saves settings or starts work.
const keywords: Record<string, string[]> = {
  'daily-plan': ['할 일', '할일', '오늘', '하루', '우선순위', '시간표', '체크리스트', '장보기', 'to do', 'todo'],
  'travel-plan': ['여행', '여행 일정', '동선', '숙소', '부산', '제주', '관광', '박 2일', '박2일', 'trip', 'travel'],
  'study-helper': ['공부', '학습', '시험', '복습', '개념', '퀴즈', '문제', '요약', '정답', '설명해', 'study'],
  'ui-webpage': ['웹페이지', '웹 페이지', '웹사이트', '사이트', '랜딩', '홈페이지', '화면 제작', '페이지', 'website', 'webpage', 'landing'],
  'marketing-copy': ['홍보', '홍보글', '광고', '카피', '소개문', '제품 소개', '마케팅', '문구', 'copywriting', 'marketing'],
  presentation: ['발표', '발표자료', '피피티', '슬라이드', '프레젠테이션', 'ppt', 'presentation', 'slides'],
};
const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const broadTerms = new Set(['문제', '정답', '설명해']);

export function findPetCandidates(request: string): { entries: PetCatalogEntry[]; suggestedId: string | null } {
  const query = normalize(request);
  if (!query) return { entries: [], suggestedId: null };
  const scored = petCatalog.map(entry => {
    const explicit = normalize(entry.name);
    const matches = (keywords[entry.id] ?? []).filter(word => query.includes(normalize(word)));
    // Names and task-specific terms are stronger than generic description words.
    const nameScore = query.includes(explicit) ? 5 : 0;
    const preciseMatches = matches.filter(word => !broadTerms.has(word));
    const termScore = preciseMatches.length ? 2 + Math.min(preciseMatches.length, 3) : matches.length ? 1 : 0;
    const descriptionWords = `${entry.summary} ${entry.output}`.split(/[\s·]+/).map(normalize).filter(word => word.length >= 3);
    const descriptionScore = Math.min(1, descriptionWords.filter(word => query.includes(word)).length);
    return { entry, score: nameScore + termScore + descriptionScore };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  // Multiple meaningful matches stay unselected, even if one has more keywords.
  const strong = scored.filter(item => item.score >= 3);
  return { entries: scored.map(item => item.entry), suggestedId: strong.length === 1 ? strong[0].entry.id : null };
}
