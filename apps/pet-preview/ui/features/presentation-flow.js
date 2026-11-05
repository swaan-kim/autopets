// Setup flow for the catalog feature `presentation` (발표자료 만들기).
// Option `value`s are stable machine values for the future task request;
// `label`s are what the user sees and what the summary shows.
export const presentationFlow = {
  featureId: 'presentation', // id in packages/contracts/data/pet-catalog.json
  theme: {
    id: 'presentation',
    light: '#f3eaff',
    mid: '#a67bf2',
    dark: '#6a3fd1',
    shade: 'rgba(60, 25, 130, 0.38)',
    accent: '#7446d6',
    accentSoft: '#f1e9ff',
  },
  summaryTitle: '발표자료 Pet 설정 완료',
  readyTitle: '발표자료 Pet 준비됨',
  steps: [
    {
      key: 'purpose',
      label: '목적',
      question: '어떤 발표자료를 만들까요?',
      options: [
        { value: 'school', label: '학교 발표' },
        { value: 'contest', label: '공모전 발표' },
        { value: 'work-report', label: '업무 보고' },
        { value: 'other', label: '기타' },
      ],
    },
    {
      key: 'length',
      label: '분량',
      question: '발표자료는 어느 정도 분량이 필요한가요?',
      options: [
        { value: 'up-to-5', label: '5장 이내' },
        { value: '6-10', label: '6~10장' },
        { value: '11-20', label: '11~20장' },
        { value: 'custom', label: '직접 입력', custom: true, placeholder: '예: 15장 내외' },
      ],
    },
    {
      key: 'style',
      label: '디자인',
      question: '어떤 디자인을 원하시나요?',
      options: [
        { value: 'simple', label: '심플하고 깔끔하게' },
        { value: 'business', label: '전문적인 비즈니스 스타일' },
        { value: 'creative', label: '감각적이고 창의적으로' },
        { value: 'custom', label: '직접 입력', custom: true, placeholder: '예: 파스텔 톤, 큰 글씨' },
      ],
    },
    {
      key: 'priority',
      label: '우선순위',
      question: '어떤 부분을 가장 중요하게 생각하시나요?',
      options: [
        { value: 'time', label: '시간 우선' },
        { value: 'balanced', label: '균형' },
        { value: 'quality', label: '퀄리티 우선' },
      ],
    },
    {
      // Free text: the request needs an actual topic before anything is made.
      key: 'topic',
      label: '주제',
      type: 'text',
      question: '발표 주제와 내용을 간단히 알려주세요.',
      placeholder: '예: 생성형 AI 활용 사례 — 신입생 대상, 사례 3가지와 주의할 점',
      maxLength: 300,
    },
  ],
};
