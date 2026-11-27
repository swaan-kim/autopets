import type { ReactNode } from 'react';

export const resultSections: Record<string, { format: string; first: string; second: string; takeaway: string }> = {
  'daily-plan': {
    format: '시간표 · 여유 시간', first: '하루 계획', second: '시간 배분',
    takeaway: '보고서 초안부터 시작하고, 할 일 사이에 여유 35분을 나눠 뒀어요.',
  },
  'travel-plan': {
    format: '여행 동선', first: '첫째 날', second: '둘째 날',
    takeaway: '첫날은 바다와 전시를 보고, 다음 날은 전포를 들렀다가 부산역으로 돌아와요.',
  },
  'study-helper': {
    format: '개념 노트 · 복습', first: '개념 정리', second: '복습 문제',
    takeaway: '일상에서 마주치는 선택으로 개념을 이해하고, 문제를 푼 뒤 해설을 확인해요.',
  },
  'review-helper': {
    format: '문제 묶음 · 복습 일정', first: '다음 복습', second: '저장한 묶음',
    takeaway: '문제를 풀었던 채팅에서 다시 열고, 복습할 때가 된 문제부터 풀어요.',
  },
  'ui-webpage': {
    format: '행사 웹페이지', first: '데스크톱', second: '프로그램',
    takeaway: '행사 소개, 프로그램과 방문 안내를 한 페이지에 담았어요. 모바일에서도 같은 내용을 볼 수 있어요.',
  },
  'marketing-copy': {
    format: '홍보 카피', first: '소개글', second: '제목 후보',
    takeaway: '학생이 행사 일정과 참가 방법을 바로 찾을 수 있도록 제목, 소개글과 버튼 문구를 만들었어요.',
  },
  presentation: {
    format: '발표 슬라이드', first: '첫 장', second: '발표 순서',
    takeaway: '신입생에게 행사를 소개한 뒤 프로그램, 일정, 참가 방법까지 다섯 장으로 이어져요.',
  },
};

const day = [
  { time: '09:00', task: '보고서 초안', minutes: 90 },
  { time: '10:40', task: '장보기', minutes: 35 },
  { time: '11:30', task: '산책', minutes: 20 },
];
const bufferMinutes = 35;
const timeBudget = [...day, { task: '여유', minutes: bufferMinutes }];

const trip = {
  first: [
    { time: '10:00', title: '부산역', note: '짐 맡기고 출발' },
    { time: '11:20', title: '광안리', note: '바다 산책과 점심' },
    { time: '14:30', title: '전시 관람', note: '운영 시간·예매 확인' },
  ],
  second: [
    { time: '10:00', title: '전포 골목', note: '카페와 작은 가게' },
    { time: '12:00', title: '서면', note: '점심 후 이동' },
    { time: '13:30', title: '부산역', note: '열차 전 여유 30분' },
  ],
};

const questions = [
  { title: '책을 읽고 영화를 포기했다면?', answer: '영화에서 얻었을 즐거움이 기회비용이에요.' },
  { title: '친구를 만나려고 한 시간 일하는 걸 포기했다면?', answer: '시급이 1만 원이었다면, 일을 해서 받을 수 있던 1만 원이 기회비용이에요.' },
  { title: '포기한 선택지가 여러 개라면?', answer: '포기한 대안 중 가장 가치 있는 하나를 골라요.' },
];

const headlines = [
  { title: '학과 행사, 어디부터 볼까요?', note: '처음 보는 학생에게 질문으로 시작' },
  { title: '이번 주 학과 행사를 한눈에', note: '어떤 정보를 얻을지 바로 안내' },
  { title: '행사 일정과 참가 방법을 한곳에서', note: '필요한 정보 두 가지를 제목에 담기' },
];

const slides = [
  { title: '처음 만나는 학과', note: '신입생의 첫 질문으로 시작해요.' },
  { title: '이 행사를 여는 이유', note: '전공과 사람을 하루 동안 만나 봐요.' },
  { title: '함께할 프로그램', note: '전공 체험과 선배에게 묻는 시간을 소개해요.' },
  { title: '하루 일정', note: '도착부터 체험, 마무리까지 순서대로 보여줘요.' },
  { title: '이렇게 참여해요', note: '신청 방법과 방문 준비를 전해요.' },
];

function Sample({ kind, detail, title, meta, children }: { kind: string; detail: boolean; title: string; meta: string; children: ReactNode }) {
  const Surface = detail ? 'div' : 'span';
  return <Surface className="result-sample-art" data-sample-kind={kind} data-sample-view={detail ? 'detail' : 'full'}>
    <span className="sample-heading">
      <span className="sample-meta">{meta}</span>
      <strong className="sample-title">{title}</strong>
    </span>
    {children}
  </Surface>;
}

function Items({ items }: { items: { title: string; note: string }[] }) {
  return <span className="sample-items" role="list">
    {items.map(({ title, note }, index) => <span key={title} role="listitem">
      <span className="sample-item-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <span><strong>{title}</strong><small>{note}</small></span>
    </span>)}
  </span>;
}

// These examples illustrate the bundled skills. They are authored, local content.
export function ResultSample({ kind, detail = false }: { kind: string; detail?: boolean }) {
  const mode = { kind, detail };
  switch (kind) {
    case 'daily-plan': {
      if (detail) return <Sample {...mode} title="할 일 145분, 여유 35분" meta="09:00–12:00">
        <span className="sample-budget" aria-hidden="true">{timeBudget.map(item => <span key={item.task} style={{ flexGrow: item.minutes }} />)}</span>
        <span className="sample-budget-key">
          {timeBudget.map(item => <span key={item.task}><strong>{item.minutes}분</strong>{item.task}</span>)}
        </span>
        <span className="sample-note">초안 뒤 10분, 장보기 뒤 15분, 마무리 전에 10분을 남겼어요.</span>
      </Sample>;
      const [first, ...next] = day;
      return <Sample {...mode} title="3시간 하루 계획" meta="09:00–12:00">
        <span className="sample-day-plan">
          <span className="sample-first-task"><small>먼저 할 일</small><strong>{first.task}</strong><small>{first.time} · {first.minutes}분</small></span>
          <span className="sample-next-tasks" role="list">
            {next.map(item => <span role="listitem" key={item.task}><small>{item.time}</small><strong>{item.task}</strong></span>)}
            <span role="listitem"><small>사이사이</small><strong>여유 {bufferMinutes}분</strong></span>
          </span>
        </span>
      </Sample>;
    }
    case 'travel-plan':
      return <Sample {...mode} title={detail ? '전포에서 부산역까지' : '부산에서 보내는 1박 2일'} meta={detail ? '둘째 날 · 대중교통' : '첫째 날 · 대중교통'}>
        <span className="sample-route" role="list">
          {(detail ? trip.second : trip.first).map(stop => <span className="sample-stop" role="listitem" key={stop.time}>
            <span className="sample-stop-time">{stop.time}</span>
            <span className="sample-stop-place"><strong>{stop.title}</strong><small>{stop.note}</small></span>
          </span>)}
        </span>
        <span className="sample-note">{detail ? '열차 시간에 맞춰 마지막 이동을 조정해요.' : '도착 뒤 바다와 전시를 순서대로 둘러봐요.'}</span>
      </Sample>;
    case 'study-helper':
      if (detail) return <Sample {...mode} title="기회비용 복습" meta="문제 3개 · 눌러서 해설 보기">
        <div className="sample-quiz">
          {questions.map(question => <details key={question.title}>
            <summary>{question.title}</summary>
            <p>{question.answer}</p>
          </details>)}
        </div>
      </Sample>;
      return <Sample {...mode} title="기회비용" meta="경제 개념 노트">
        <span className="sample-definition">선택 때문에 놓친 <strong>가장 좋은 대안</strong>의 가치예요.</span>
        <span className="sample-study-pair">
          <span><small>고른 것</small><strong>한 시간 책 읽기</strong></span>
          <span><small>놓친 것</small><strong>보고 싶던 영화</strong></span>
        </span>
        <span className="sample-note">이 경우에 놓친 가치는 영화에서 얻었을 즐거움이에요.</span>
      </Sample>;
    case 'review-helper':
      if (detail) return <Sample {...mode} title="기회비용 문제 묶음" meta="문제 10개">
        <span className="sample-note">지난번 8개를 맞혔어요. 오늘 복습할 2문제를 원래 Codex 채팅에서 풀어요.</span>
      </Sample>;
      return <Sample {...mode} title="다음 복습은 3일 뒤" meta="경제 개념 · 기회비용">
        <span className="sample-note">틀린 문제부터 다시 풀 수 있도록 문제 묶음에 담았어요.</span>
      </Sample>;
    case 'marketing-copy':
      if (detail) return <Sample {...mode} title="같은 행사, 다른 제목" meta="제목 후보 3개"><Items items={headlines} /></Sample>;
      return <Sample {...mode} title={headlines[0].title} meta="학생 팀의 학과 행사 안내">
        <span className="sample-copy">신입생 환영회부터 전공 프로그램까지, 일정과 참가 방법을 한곳에서 무료로 확인하세요.</span>
        <span className="sample-copy-action"><small>버튼 문구</small><strong>이번 주 행사 보기 <span aria-hidden="true">→</span></strong></span>
      </Sample>;
    case 'presentation':
      if (detail) return <Sample {...mode} title="신입생에게 소개하는 순서" meta="발표 흐름 · 5장"><Items items={slides} /></Sample>;
      return <span className="sample-slide-cover" data-sample-kind={kind} data-sample-view="full">
        <span className="sample-slide-content">
          <small>신입생 오픈캠퍼스</small>
          <strong>{slides[0].title}</strong>
          <span>우리 학과에서 무엇을 배우고, 누구를 만나게 될까요?</span>
          <small className="sample-slide-page">1 / 5</small>
        </span>
        <img className="sample-slide-photo" src="/assets/design-example-v1/campus-day.webp" alt="" loading="lazy" />
      </span>;
    default:
      return null;
  }
}
