import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { PetCatalogEntry } from './petCatalog';
import { ResultPreview } from './TaskPetArt';
import './pet-card-thumb.css';

// Pet-selection cards: "그냥 시켰을 때 ↔ 펫". The plain answer (grey, .pct-bf) sits under the pet's
// answer (.pct-pn), which covers 60% and slides over all of it while the card is pointed at or
// focused. Only the cards change: the detail screen and its enlarged view keep the shared drawing
// (ResultPreview). Cards live inside a <button>, so only span and svg are used.

/** A length from the 216px-wide design, at the same ratio of the thumbnail's width. */
const cq = (px: number) => `${(px * 100 / 216).toFixed(3)}cqw`;
const Check = () => <svg viewBox="0 0 8 8"><path d="m1.6 4.2 1.6 1.6 3.2-3.6" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Lock = () => <svg viewBox="0 0 12 12"><rect x="2" y="5.2" width="8" height="5.6" rx="1.4" fill="#24543d" /><path d="M4 5.2V3.8a2 2 0 0 1 4 0v1.4" fill="none" stroke="#24543d" strokeWidth="1.4" /></svg>;
const Device = ({ kind }: { kind: string }) => <span className={kind}><b /><s /><s /><u /></span>;
const Options = ({ hit }: { hit?: number }) => <>{[80, 95, 70, 85].map((width, index) => <span key={index} className={`pct-op${index === hit ? ' pct-hit' : ''}`}><u /><s style={{ maxWidth: `${width}%` }} /></span>)}</>;

const thumbs: Record<string, { label: string; layer: string; plain: ReactNode; pet: ReactNode }> = {
  'daily-plan': {
    label: '하루 정리: 그냥 시키면 할 일 12개가 빽빽하고, 펫은 3개와 여유 25분으로 정리해요', layer: '#fffdf6',
    plain: <><span className="pct-h">오늘 할 일 12</span>{[90, 70, 100, 60, 85, 75, 95, 65, 80, 70, 90].map((width, index) => <span key={index} className="pct-todo"><u /><s style={{ maxWidth: `${width}%` }} /></span>)}</>,
    pet: <><span className="pct-h">오늘 3시간</span><span className="pct-big">보고서부터,<br />여유 있게.</span>
      <span className="pct-blk"><span>보고서</span><span className="pct-g" /><span>장보기</span><span className="pct-g" /><span>산책</span></span>
      <span className="pct-pill" style={{ marginTop: cq(5) }}>여유 25분</span></>,
  },
  'travel-plan': {
    label: '여행 일정: 그냥 시키면 전부 확정처럼 적고, 펫은 확인 못 한 곳에 확인 필요를 붙여요', layer: '#fffdf6',
    plain: <><span className="pct-h">전부 확정처럼</span>{[60, 48, 66, 40, 56].map((width, index) => <span key={index} className="pct-rw"><i><Check /></i><s style={{ width: cq(width) }} /></span>)}</>,
    pet: <><span className="pct-h">부산 1박 2일</span>
      <span className="pct-rw"><i><Check /></i>해운대 10:00</span><span className="pct-rw"><i><Check /></i>미술관 14:00</span>
      <span className="pct-rw"><span className="pct-need">확인 필요</span>야시장</span><span className="pct-rw"><span className="pct-need">확인 필요</span>막차 시간</span></>,
  },
  'study-helper': {
    label: '공부 도우미: 그냥 시키면 정답이 바로 보이고, 펫은 풀고 나서 정답을 보여줘요', layer: '#fffdf6',
    plain: <><span className="pct-qz">Q. 기회비용이란?</span><Options hit={1} /><span className="pct-tagb">정답 ② 바로 보임</span></>,
    pet: <><span className="pct-qz">Q. 기회비용이란?</span><Options /><span className="pct-lock"><Lock />정답은 풀고 나서</span></>,
  },
  'review-helper': {
    label: '복습 도우미: 그냥 시키면 한 번 풀고 끝이고, 펫은 3일, 7일, 16일 뒤에 다시 물어봐요', layer: '#fffdf6',
    plain: <><span className="pct-h">한 번 풀고 끝</span><span className="pct-tl pct-fade"><span>오늘</span><span>잊음</span><span>잊음</span><span>잊음</span></span></>,
    pet: <><span className="pct-h">잊을 때쯤 다시</span><span className="pct-tl"><span>오늘</span><span>3일 뒤</span><span>7일 뒤</span><span>16일 뒤</span></span>
      <span className="pct-pill" style={{ marginTop: cq(12) }}>틀린 문제 먼저</span></>,
  },
  'ui-webpage': {
    label: '웹페이지 만들기: 그냥 시키면 PC 화면만 확인하고, 펫은 모바일 화면까지 확인해요', layer: '#f6f8fb',
    plain: <><span className="pct-h">PC만 확인</span><span className="pct-dev"><Device kind="pct-ph pct-bad" /><Device kind="pct-pc" /></span></>,
    pet: <><span className="pct-h">모바일까지 확인</span><span className="pct-dev"><Device kind="pct-pc" /><Device kind="pct-ph" /></span></>,
  },
  'marketing-copy': {
    label: '홍보글 쓰기: 그냥 시키면 근거 없는 말을 지어내고, 펫은 있는 사실만 써요', layer: '#f6efe3',
    plain: <><span className="pct-h">지어낸 말</span><span className="pct-wv"><span>국내 최대!</span><br /><span>1,000명 참가</span></span><span className="pct-tagb">근거 없음</span></>,
    pet: <><span className="pct-h">있는 사실만</span><span className="pct-big" style={{ marginBottom: cq(5) }}>학과 행사,<br />일정과 참가 방법</span><span className="pct-cta">행사 일정 보기</span></>,
  },
  presentation: {
    label: '발표자료 만들기: 그냥 시키면 한 장에 전부 넣고, 펫은 한 장에 한 메시지만 담아요', layer: '#f4f1e8',
    plain: <><span className="pct-h">한 장에 전부</span><span className="pct-sl"><b />{Array.from({ length: 11 }, (_, index) => <s key={index} />)}</span></>,
    pet: <><span className="pct-h">한 장, 한 메시지</span><span className="pct-dk"><small>01</small><b>작은 팀도<br />꾸준히.</b></span></>,
  },
};

// The nudge plays once after the app starts: only the cards that appear in that first moment get it,
// and each card drops it when done, so coming back to the list never replays it.
let nudgeWindowEnds: number | null = null;
const NUDGE_MS = (order: number) => 400 + order * 140 + 1000;
function useFirstNudge(order: number) {
  const [nudge, setNudge] = useState(() => {
    const now = performance.now();
    if (nudgeWindowEnds === null) nudgeWindowEnds = now + 1000;
    return now <= nudgeWindowEnds;
  });
  // Also ends when the list was hidden before the animation finished (no animationend then).
  useEffect(() => { if (!nudge) return; const timer = setTimeout(() => setNudge(false), NUDGE_MS(order) + 200); return () => clearTimeout(timer); }, [nudge, order]);
  return [nudge, () => setNudge(false)] as const;
}

/** `order` is the card's place in the list shown (the nudge starts 0.14s later per card). */
export function PetCardThumb({ entry, order = 0 }: { entry: PetCatalogEntry; order?: number }) {
  const thumb = thumbs[entry.id];
  const [nudge, nudged] = useFirstNudge(order);
  if (!thumb) return <ResultPreview entry={entry} compact />;
  return <span className="role-result-preview visual-result-preview designed-result pct-wrap" data-evidence="design-example" data-compare={entry.id}>
    <span className={`pct-t${nudge ? ' pct-nudge' : ''}`} style={{ '--i': order } as CSSProperties} role="img" aria-label={thumb.label}>
      <span className="pct-bf" aria-hidden="true">{thumb.plain}<span className="pct-chip pct-b">그냥</span></span>
      <span className="pct-pn" aria-hidden="true" onAnimationEnd={nudged}><span className="pct-af" style={{ background: thumb.layer }}>{thumb.pet}<span className="pct-chip pct-a">펫</span></span></span>
    </span>
    <small className="result-thumbnail-label">그냥 시켰을 때 ↔ 펫</small>
  </span>;
}
