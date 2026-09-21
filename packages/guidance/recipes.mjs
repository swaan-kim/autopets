const definitions = {
  simple: { label: '요약·문장 수정', steps: ['바로 처리', '길이·형식 확인'], checks: ['명시한 길이와 형식'], guidance: '요약·문장 수정은 바로 처리하세요. 불필요한 계획·추가 질문·검색 없이 요청한 길이와 형식만 확인하세요.' },
  research: { label: '조사·비교', steps: ['비교 기준 정리', '자료 조사', '출처·누락 확인'], checks: ['비교 대상과 기준', '출처와 사실 확인'], guidance: '요청에서 비교 대상과 기준을 정리하고 필요한 자료만 조사하세요. 최신성이 필요한 사실은 확인하고, 주장에 맞는 출처와 빠진 비교 항목을 점검하세요.' },
  document: { label: '문서·보고서', steps: ['목적·독자·형식 정리', '작성', '요구사항 점검'], checks: ['독자와 목적', '필수 항목과 형식'], guidance: '요청에서 목적·독자·결과 형식을 정리하고 작성하세요. 명확한 내용은 재질문하지 말고, 필수 항목과 파일·문서 형식이 갖춰졌는지 확인하세요.' },
  planning: { label: '복잡한 기획', steps: ['중요한 불명확함 확인', '짧은 계획', '실행', '결과 점검'], checks: ['핵심 조건', '결정이 필요한 내용', '완료 기준'], guidance: '결과를 바꾸는 불명확함만 확인하고 짧은 작업 순서를 세우세요. 현재 모드에서 허용된 작업을 수행하고 완료 기준을 점검하세요. 실제 Plan 모드를 자동 전환하지 마세요.' },
  general: { label: '요청에 맞게', steps: ['요청 수행'], checks: ['명시한 요구사항'], guidance: '현재 요청을 그대로 수행하세요. 분류가 불확실하므로 별도 계획·검색·검토 단계를 강제로 추가하지 마세요.' },
};
export const RECIPES = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([id, value]) => [id, Object.freeze({ id, ...value })])));

// Classification is a conservative local hint, never a semantic correctness claim.
export function classifyTask(prompt, { nativePlan = false, nativeMemory = false, nativeReview = false, attachments = false } = {}) {
  const text = typeof prompt === 'string' ? prompt.normalize('NFKC').trim() : '';
  let id = 'general', confidence = 'uncertain';
  if (text.length && text.length <= 16000) {
    if (/(기획|로드맵|아키텍처|요구사항\s*설계|단계별\s*계획|사업\s*계획|실행\s*계획|제품\s*설계)/u.test(text)) { id = 'planning'; confidence = 'high'; }
    else if (/(조사|리서치|비교|출처|최신|경쟁사|시장\s*분석)/u.test(text)) { id = 'research'; confidence = 'high'; }
    else if (/(보고서|제안서|회의록|문서|발표\s*자료|보도자료|기안|메일.*작성)/u.test(text)) { id = 'document'; confidence = 'high'; }
    else if (!attachments && text.length <= 1200 && /(요약|다듬|맞춤법|번역|문장.*수정|짧게.*바꿔)/u.test(text)
      && !/(법률|의학|의료|진단|계약|투자|검증|계산|추론|코드|보안|첨부|파일)/u.test(text)) { id = 'simple'; confidence = 'high'; }
  }
  return { ...RECIPES[id], steps: [...RECIPES[id].steps], checks: [...RECIPES[id].checks], confidence,
    nativeSupport: { plan: nativePlan === true, memory: nativeMemory === true, review: nativeReview === true } };
}
