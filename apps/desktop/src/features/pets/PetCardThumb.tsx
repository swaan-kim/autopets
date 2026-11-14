import type { ReactNode } from 'react';
import type { PetCatalogEntry } from './petCatalog';
import { ResultPreview } from './TaskPetArt';
import './pet-card-thumb.css';

// Designed examples for the pet-selection cards. Cards live inside a <button>, so only span and img are used.
const Paper = ({ eyebrow, big, sub, children }: { eyebrow: string; big: ReactNode; sub?: string; children?: ReactNode }) => <span className="pct-paper"><span className="pct-sheet">
  <span className="pct-eyebrow">{eyebrow}</span><span className="pct-big">{big}</span>{sub && <span className="pct-sub">{sub}</span>}{children}
</span></span>;

const dailyBlocks: { minutes: number; name?: string; walk?: boolean }[] = [
  { minutes: 80, name: '보고서' }, { minutes: 10 }, { minutes: 45, name: '장보기' }, { minutes: 15 }, { minutes: 30, name: '산책', walk: true },
];

const thumbs: Record<string, { label: string; body: ReactNode }> = {
  'daily-plan': { label: '하루 정리 결과 예시: 3시간 계획', body: <Paper eyebrow="오늘 쓸 수 있는 3시간" big="보고서부터, 여유 있게." sub="여유 25분을 남겼어요.">
    <span className="pct-timeline">{dailyBlocks.map((block, index) => <span key={index} className={`pct-block${block.name ? '' : ' pct-slack'}${block.walk ? ' pct-walk' : ''}`} style={{ flexGrow: block.minutes }}>
      {block.name && <><strong>{block.name}</strong><span>{block.minutes}분</span></>}
    </span>)}</span>
  </Paper> },
  'travel-plan': { label: '여행 일정 결과 예시: 부산 1박 2일 동선', body: <span className="pct-travel">
    <span className="pct-travel-photo"><span className="pct-travel-title">부산 1박 2일.</span></span>
    <span className="pct-travel-route"><span><b>1일</b> 해운대 → 동백섬 → 미술관</span><span><b>2일</b> 흰여울 → 해양박물관</span></span>
  </span> },
  'study-helper': { label: '공부 도우미 결과 예시: 기회비용 요약과 확인 문제', body: <Paper eyebrow="한 줄 요약" big="기회비용" sub="포기한 것 전부가 아니라, 그중 가장 아까운 하나.">
    <span className="pct-chips"><span>확인 문제 3개</span><span>정답·해설은 따로</span></span>
  </Paper> },
  'ui-webpage': { label: '웹페이지 만들기 결과 예시: 학과 행사 소개 페이지', body: <img className="pct-image" src="/assets/design-example-v1/desktop.webp" alt="" loading="lazy" /> },
  'marketing-copy': { label: '홍보글 쓰기 결과 예시: 제목 후보와 버튼 문구', body: <span className="pct-copy">
    <span className="pct-eyebrow">제목 후보 1 / 3</span>
    <span className="pct-big">학과 행사, 일정과<br />참가 방법을 한눈에</span>
    <span className="pct-pill">행사 일정 보기</span>
  </span> },
  presentation: { label: '발표자료 만들기 결과 예시: 표지 슬라이드', body: <span className="pct-slide">
    <span className="pct-eyebrow">MARKETING OPERATIONS / 2026</span>
    <span className="pct-big">작은 팀의<br />콘텐츠 운영 제안</span>
    <span className="pct-sub">조사부터 제작, 배포까지.</span>
    <span className="pct-slide-foot"><span>콘텐츠팀</span><span>01</span></span>
  </span> },
};

export function PetCardThumb({ entry }: { entry: PetCatalogEntry }) {
  const thumb = thumbs[entry.id];
  if (!thumb) return <ResultPreview entry={entry} compact />;
  return <span className="role-result-preview visual-result-preview designed-result" data-evidence="design-example">
    <span className="pet-card-thumb" role="img" aria-label={thumb.label}><span className="pct-body" aria-hidden="true">{thumb.body}</span></span>
    <small className="result-thumbnail-label">디자인 예시</small>
  </span>;
}
