import type { ReactNode } from 'react';

export const resultSections: Record<string, { format: string; first: string; second: string; takeaway: string }> = {
  'daily-plan': {
    format: '시간표 · 체크리스트', first: '하루 계획', second: '시간 배치',
    takeaway: '보고서 초안을 먼저 끝내고, 장보기와 산책 사이에 쉴 시간을 남겼어요.',
  },
  'travel-plan': {
    format: '여행 일정표', first: '첫째 날', second: '둘째 날',
    takeaway: '첫날은 바다와 전시를 보고, 다음 날은 전포에서 쉬었다가 부산역으로 돌아와요.',
  },
  'study-helper': {
    format: '학습 노트', first: '개념 정리', second: '복습 문제',
    takeaway: '포기한 대안 중 가장 아쉬운 하나의 가치를 생각해 보세요. 복습 문제로 직접 확인할 수 있어요.',
  },
  'ui-webpage': {
    format: '행사 웹페이지', first: '데스크톱', second: '프로그램',
    takeaway: '행사 소개, 프로그램과 방문 안내를 한 페이지에 담았어요. 모바일에서도 같은 내용을 볼 수 있어요.',
  },
  'marketing-copy': {
    format: '홍보 문구', first: '소개글', second: '제목 후보',
    takeaway: '학생이 일정과 참가 방법을 바로 찾을 수 있도록 소개글과 버튼 문구를 만들었어요.',
  },
  presentation: {
    format: '발표 슬라이드', first: '첫 장', second: '발표 순서',
    takeaway: '신입생에게 행사를 소개한 뒤 프로그램, 일정, 참가 방법까지 다섯 장으로 이어져요.',
  },
};

const daily = [
  { time: '09:00', title: '보고서 초안', note: '90분 · 목차와 핵심 근거 쓰기' },
  { time: '10:40', title: '장보기', note: '35분 · 필요한 것만 사기' },
  { time: '11:30', title: '산책', note: '20분 · 집 근처 한 바퀴' },
];
const trip = {
  first: [
    { time: '10:00', title: '부산역 도착', note: '짐 보관 후 지하철로 이동' },
    { time: '11:20', title: '광안리 해변', note: '바닷가 산책과 점심' },
    { time: '14:30', title: '전시 관람', note: '운영 시간과 예매 확인' },
  ],
  second: [
    { time: '10:00', title: '전포 골목', note: '동네 카페와 작은 가게 둘러보기' },
    { time: '12:00', title: '서면에서 점심', note: '짐을 찾고 부산역으로 이동' },
    { time: '13:30', title: '부산역 도착', note: '열차 탑승 전 여유 30분' },
  ],
};
const headlines = [
  '학과 행사, 어디부터 볼까요?',
  '이번 주 학과 행사를 한눈에',
  '행사 일정과 참가 방법을 한곳에서',
];
const slides = [
  '처음 만나는 학과',
  '이 행사를 여는 이유',
  '함께할 프로그램',
  '하루 일정',
  '이렇게 참여해요',
];

function Sample({ kind, detail, title, meta, children }: { kind: string; detail: boolean; title: string; meta?: string; children: ReactNode }) {
  return <span className="result-sample-art" data-sample-kind={kind} data-sample-view={detail ? 'detail' : 'full'}>
    <span className="sample-heading">
      <strong className="sample-title">{title}</strong>
      {meta && <span className="sample-meta">{meta}</span>}
    </span>
    {children}
  </span>;
}

function Schedule({ items, checklist = false }: { items: typeof daily; checklist?: boolean }) {
  return <span className="sample-schedule" role="list">
    {items.map(({ time, title, note }) => <span className="sample-schedule-row" key={time} role="listitem">
      <span className="sample-time">{time}</span>
      <span className="sample-row-text"><strong>{title}</strong><small>{note}</small></span>
      {checklist && <span className="sample-check" aria-hidden="true" />}
    </span>)}
  </span>;
}

function Items({ items }: { items: readonly string[] }) {
  return <span className="sample-items" role="list">
    {items.map((item, index) => <span key={item} role="listitem">
      <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><strong>{item}</strong>
    </span>)}
  </span>;
}

// Authored results for the catalog prompts. Text stays readable at every size.
export function ResultSample({ kind, detail = false }: { kind: string; detail?: boolean }) {
  const mode = { kind, detail };
  switch (kind) {
    case 'daily-plan':
      if (detail) return <Sample {...mode} title="3시간을 이렇게 써요" meta="09:00–12:00">
        <span className="sample-budget" aria-hidden="true"><span /><span /><span /><span /></span>
        <span className="sample-budget-key">
          <span><strong>90분</strong>초안</span><span><strong>35분</strong>장보기</span>
          <span><strong>20분</strong>산책</span><span><strong>35분</strong>여유</span>
        </span>
        <span className="sample-note">일과 일 사이의 이동과 휴식에 여유를 써요.</span>
      </Sample>;
      return <Sample {...mode} title="오늘 할 일" meta="3가지 · 여유 35분"><Schedule items={daily} checklist /></Sample>;
    case 'travel-plan':
      return <Sample {...mode} title={detail ? '부산에서 보내는 둘째 날' : '부산 1박 2일'} meta={detail ? '전포에서 부산역까지' : '첫째 날 · 대중교통'}>
        <Schedule items={detail ? trip.second : trip.first} />
      </Sample>;
    case 'study-helper':
      if (detail) return <Sample {...mode} title="기회비용 복습" meta="문제 3개">
        <span className="sample-quiz" role="list">
          <span role="listitem"><strong>책을 읽고 영화를 포기했다면?</strong><small>어떤 가치를 놓쳤을까요?</small></span>
          <span role="listitem"><strong>친구를 만나느라 시급 1만원 일을 포기했다면?</strong><small>포기한 한 시간의 가치를 금액으로 적어 보세요.</small></span>
          <span role="listitem"><strong>포기한 선택지가 여러 개라면?</strong><small>기회비용을 구할 때 무엇을 비교해야 할까요?</small></span>
        </span>
      </Sample>;
      return <Sample {...mode} title="기회비용" meta="경제 개념 정리">
        <span className="sample-definition">선택 때문에 놓친 가장 좋은 대안의 가치예요.</span>
        <span className="sample-study-pair">
          <span><small>선택</small><strong>한 시간 책 읽기</strong></span>
          <span><small>놓친 가장 좋은 대안</small><strong>보고 싶던 영화</strong></span>
        </span>
        <span className="sample-note">이 경우 영화에서 얻었을 즐거움이 기회비용이에요.</span>
      </Sample>;
    case 'marketing-copy':
      if (detail) return <Sample {...mode} title="어떤 제목이 좋을까요?" meta="제목 후보 3개"><Items items={headlines} /></Sample>;
      return <Sample {...mode} title={headlines[0]} meta="학과 행사 안내 서비스">
        <span className="sample-copy">신입생 환영회부터 전공 프로그램까지, 일정과 참가 방법을 한곳에서 무료로 확인하세요.</span>
        <span className="sample-cta">이번 주 행사 보기 <span aria-hidden="true">↗</span></span>
      </Sample>;
    case 'presentation':
      if (detail) return <Sample {...mode} title="신입생에게 소개하는 순서" meta="브라우저 슬라이드 5장"><Items items={slides} /></Sample>;
      return <Sample {...mode} title={slides[0]} meta="신입생을 위한 오픈캠퍼스 · 1 / 5">
        <span className="sample-slide-content">
          <span className="sample-slide-copy">
            <span className="sample-slide-takeaway">우리 학과에서 무엇을 배우고, 누구를 만나게 될까요?</span>
            <span className="sample-slide-topics"><span>행사 취지</span><span>프로그램</span><span>참가 방법</span></span>
          </span>
          <img className="sample-slide-photo" src="/assets/design-example-v1/campus-day.webp" alt="" loading="lazy" />
        </span>
      </Sample>;
    default:
      return null;
  }
}
