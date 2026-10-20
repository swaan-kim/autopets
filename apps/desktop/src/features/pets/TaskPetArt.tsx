import { useEffect, useId, useRef, useState } from 'react';
import { Pet, type PetMotion } from './Pet';
import type { PetCatalogEntry } from './petCatalog';
import { SourceLogo, skillSourceFor } from './PetSkillSource';
import { CompanionPet } from './CompanionPet';
import type { CompanionState } from './companionMotion';
import './visual-cards.css';
import './result-preview.css';

// Presentation only: a prop describes the role, never a connected or running tool.
export function TaskPetArt({ entry, motion = 'idle', paused = true, small = false, state, runKey, interactive = true, example = false }: { entry?: PetCatalogEntry; motion?: PetMotion; paused?: boolean; small?: boolean; state?: CompanionState; runKey?: string; interactive?: boolean; example?: boolean }) {
  const id = useId().replace(/:/g, '');
  const role = entry?.id ?? 'ui-webpage';
  const root = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [interaction, setInteraction] = useState(0);
  const companion = entry?.id === 'ui-webpage';
  const companionView: CompanionState = state ?? ({ idle: 'idle', research: 'planning', thinking: 'planning', writing: 'working', tool: 'working', dizzy: 'waiting', celebrate: 'complete', angry: 'error' } as const)[motion];
  useEffect(() => {
    if (!companion || !interactive) return;
    // Listen on the existing button/card: keep its click and keyboard semantics.
    const target = root.current?.closest('button, .workspace-role-card, .workspace-saved-card') ?? root.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const enter = () => { clearTimeout(timer); timer = setTimeout(() => { setHovered(true); setInteraction(value => value + 1); }, 350); };
    const leave = () => { clearTimeout(timer); setHovered(false); };
    const touch = () => setInteraction(value => value + 1);
    target?.addEventListener('pointerenter', enter); target?.addEventListener('pointerleave', leave);
    target?.addEventListener('focusin', enter); target?.addEventListener('focusout', leave); target?.addEventListener('pointerdown', touch);
    return () => { clearTimeout(timer); target?.removeEventListener('pointerenter', enter); target?.removeEventListener('pointerleave', leave); target?.removeEventListener('focusin', enter); target?.removeEventListener('focusout', leave); target?.removeEventListener('pointerdown', touch); };
  }, [companion, interactive]);
  return <span ref={root} className={`task-pet-art ${small ? 'compact' : ''}`} data-role={role} data-companion={companion} data-companion-state={companionView}>
    {companion ? <CompanionPet state={companionView} paused={paused && !hovered} runKey={runKey} interaction={interaction} example={example} /> : <Pet motion={motion} paused={paused} />}
    <svg className="task-pet-prop" viewBox="0 0 96 88" aria-hidden="true">
      <defs><linearGradient id={`${id}-paper`} x2=".8" y2="1"><stop stopColor="#fffef9" /><stop offset="1" stopColor="#e1e7d7" /></linearGradient><linearGradient id={`${id}-body`} x2=".8" y2="1"><stop stopColor="#679482" /><stop offset="1" stopColor="#274f43" /></linearGradient></defs>
      <ellipse cx="49" cy="79" rx="35" ry="5" fill="#173a2c" opacity=".12" />
      {role === 'daily-plan' ? <g transform="rotate(-8 48 45)"><rect x="24" y="10" width="49" height="65" rx="8" fill={`url(#${id}-body)`} /><rect x="29" y="16" width="39" height="53" rx="4" fill={`url(#${id}-paper)`} /><rect x="38" y="6" width="20" height="13" rx="5" fill="#caaa68" /><path d="m35 31 3 3 5-6m-8 20 3 3 5-6m-8 20 3 3 5-6M49 31h12M49 48h12M49 65h9" fill="none" stroke="#5e806e" strokeWidth="3" strokeLinecap="round" /></g>
      : role === 'travel-plan' ? <g><path d="m11 26 23-9 26 8 25-9v54l-25 8-26-8-23 9z" fill={`url(#${id}-paper)`} stroke="#b5c5b8" strokeWidth="2" /><path d="M34 18v51m26-43v50M19 54l18-12 15 13 20-20" fill="none" stroke="#90ad98" strokeWidth="3" strokeDasharray="4 4" /><path d="M77 26c0 9-13 23-13 23S51 35 51 26a13 13 0 0 1 26 0" fill="#db986e" /><circle cx="64" cy="25" r="5" fill="#fff9e8" /></g>
      : role === 'study-helper' ? <g><path d="M11 19q22-8 37 2 15-10 37-2v54q-21-6-37 2-16-8-37-2z" fill={`url(#${id}-body)`} /><path d="M17 13q17-4 31 5 14-9 31-5v52q-16-4-31 5-15-9-31-5z" fill={`url(#${id}-paper)`} /><path d="M48 20v48M25 28l14 3m-14 10 14 3m-14 10 14 3m18-26 14-3m-14 16 14-3m-14 16 14-3" stroke="#aabca7" strokeWidth="2" strokeLinecap="round" /></g>
      : role === 'marketing-copy' ? <g transform="rotate(5 48 45)"><rect x="16" y="17" width="51" height="58" rx="7" fill={`url(#${id}-paper)`} stroke="#c3cebb" /><path d="M26 31h30M26 42h25M26 53h29M26 64h17" stroke="#a8bda7" strokeWidth="3" strokeLinecap="round" /><g transform="rotate(24 68 40)"><rect x="63" y="8" width="12" height="54" rx="3" fill="#d2ad60" /><path d="m63 61 6 14 6-14" fill="#e6c9a0" /><path d="m66 69 3 6 3-6" fill="#466156" /><path d="M69 14v44" stroke="#f5dca5" strokeWidth="3" /></g></g>
      : role === 'presentation' ? <g><path d="M46 56 26 80m22-24 22 24" stroke="#a5b2a0" strokeWidth="5" strokeLinecap="round" /><rect x="10" y="13" width="76" height="51" rx="6" fill={`url(#${id}-body)`} /><rect x="15" y="18" width="66" height="40" rx="3" fill={`url(#${id}-paper)`} /><path d="M23 28h39" stroke="#789482" strokeWidth="4" strokeLinecap="round" /><rect x="23" y="40" width="11" height="10" rx="2" fill="#ccaa68" /><rect x="39" y="35" width="11" height="15" rx="2" fill="#a7bba1" /><rect x="55" y="31" width="11" height="19" rx="2" fill="#618a75" /></g>
      : <g><rect x="15" y="13" width="68" height="48" rx="6" fill={`url(#${id}-body)`} /><rect x="20" y="18" width="58" height="37" rx="3" fill="#e8efe0" /><rect x="27" y="25" width="26" height="5" rx="2" fill="#799b87" /><rect x="27" y="35" width="22" height="12" rx="3" fill="#b1c6ae" /><rect x="55" y="25" width="16" height="22" rx="3" fill="#d3b47b" /><path d="M15 61h68l10 11q0 5-8 5H13q-8 0-8-5z" fill="#b5c2b2" /><path d="M39 63h20l4 5H35z" fill="#839a87" /></g>}
    </svg>
    {entry && <span className="pet-origin-badge" title={skillSourceFor(entry).source ? 'GitHub에 공개된 스킬 기반' : 'AutoPets 자체 제작'}><SourceLogo external={!!skillSourceFor(entry).source} /></span>}
  </span>;
}
const resultKinds: Record<string, string> = {
  'daily-plan': '체크리스트', 'travel-plan': '여행 일정표', 'study-helper': '개념 정리',
  'ui-webpage': '행사 웹페이지', 'marketing-copy': '홍보 문구', presentation: '브라우저 슬라이드',
};

// Designed samples demonstrate output formats. They are never execution evidence.
function ResultArtwork({ entry, mobile = false }: { entry: PetCatalogEntry; mobile?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [entry.id, mobile]);
  if (entry.id === 'ui-webpage') return <span className={`result-thumbnail result-thumbnail-web ${mobile ? 'mobile' : ''}`} role="img" aria-label={failed ? '웹페이지 미리보기를 불러오지 못했어요' : `가상 학과 행사 웹페이지 · ${mobile ? '모바일' : '데스크톱'} 디자인 예시`}>
    {failed ? <span className="result-thumbnail-fallback">미리보기 없음</span> : <img src={`/assets/design-example-v1/${mobile ? 'mobile' : 'desktop'}.webp`} alt="" loading="lazy" onError={() => setFailed(true)} />}
  </span>;
  return <span className={`result-thumbnail sample-output sample-${entry.id}`} aria-label={`${resultKinds[entry.id] ?? entry.name} 디자인 예시`}>
    {entry.id === 'daily-plan' ? <span className="sample-sheet">
      <strong className="sample-title">오늘은 이 세 가지.</strong>
      <span className="sample-check done"><span aria-hidden="true">✓</span>초안 마무리</span>
      <span className="sample-check"><span aria-hidden="true">○</span>장보기</span>
      <span className="sample-check"><span aria-hidden="true">○</span>20분 산책</span>
    </span> : entry.id === 'travel-plan' ? <span className="sample-sheet">
      <strong className="sample-title">부산, 느긋한 하루.</strong>
      <span className="sample-stop"><span>10:00</span>바다 산책</span>
      <span className="sample-route" aria-hidden="true">↓</span>
      <span className="sample-stop"><span>12:00</span>해변 카페</span>
    </span> : entry.id === 'study-helper' ? <span className="sample-sheet">
      <span className="sample-kicker">한 개념, 쉽게.</span><strong className="sample-title">기회비용</strong>
      <span className="sample-definition">선택하면서 포기한<br />가장 좋은 대안의 가치.</span>
    </span> : entry.id === 'marketing-copy' ? <span className="sample-sheet sample-ad">
      <span className="sample-kicker">새 노트의 첫 페이지</span><strong className="sample-title">완벽한 계획보다,<br />당신의 첫 줄.</strong><span className="sample-ad-cta">기록을 시작하세요 ↗</span>
    </span> : <span className="sample-sheet sample-slide">
      <span className="sample-kicker">작은 습관에 관한 이야기</span><strong className="sample-title">작은 시작.<br />더 나은 하루.</strong><span className="sample-slide-mark" aria-hidden="true">↗</span>
    </span>}
  </span>;
}

export function ResultPreview({ entry, compact = false }: { entry: PetCatalogEntry; compact?: boolean }) {
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMobile(false); setOpen(false); }, [entry.id]);
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    element.showModal(); close.current?.focus();
    return () => { element.close(); trigger.current?.focus(); };
  }, [open]);
  if (compact) return <span className="role-result-preview visual-result-preview designed-result" data-evidence="design-example"><ResultArtwork entry={entry} /><small className="result-thumbnail-label">디자인 예시</small></span>;
  return <figure className={`result-preview visual-result-preview designed-result result-${entry.id}`} aria-label={`${entry.name} 결과 예시`} data-evidence="design-example">
    {entry.id === 'ui-webpage' && <div className="result-preview-toolbar"><div className="result-device-choice" role="group" aria-label="미리보기 화면"><button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)}>데스크톱</button><button type="button" aria-pressed={mobile} onClick={() => setMobile(true)}>모바일</button></div><button type="button" ref={trigger} className="result-live-open" onClick={() => setOpen(true)}>크게 보기 ↗</button></div>}
    <ResultArtwork entry={entry} mobile={mobile} /><figcaption><span>{resultKinds[entry.id] ?? entry.output}</span><small>디자인 예시</small></figcaption>
    {open && <dialog ref={dialog} className="result-example-dialog" aria-label="가상 학과 행사 디자인 예시" onCancel={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setOpen(false); } }}><div className="result-example-bar"><span>디자인 예시</span><button type="button" ref={close} onClick={() => setOpen(false)}>닫기 ×</button></div><div className="result-example-full"><ResultArtwork entry={entry} mobile={mobile} /></div></dialog>}
  </figure>;
}
