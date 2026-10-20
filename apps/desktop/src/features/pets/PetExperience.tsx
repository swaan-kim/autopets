import { useEffect, useRef, useState } from 'react';
import { TaskPetArt } from './TaskPetArt';
import { SourceLogo, skillSourceFor } from './PetSkillSource';
import { petCatalog, type PetCatalogEntry } from './petCatalog';
import type { CompanionState } from './companionMotion';
import { usePetVisibility } from './usePetVisibility';
import './pet-experience.css';

const entry = petCatalog.find(item => item.id === 'ui-webpage')!;
const source = skillSourceFor(entry);
const resultImage = '/assets/companion-v1/verified-web-result.webp';
const stages: { state: CompanionState; title: string; caption: string; duration?: number }[] = [
  { state: 'idle', title: '“학과 행사 소개 페이지 만들어줘.”', caption: '요청 예시' },
  { state: 'receive', title: '준비해볼게요.', caption: '작업 방법과 설정 준비', duration: 1500 },
  { state: 'planning', title: '이렇게 만들어볼까요?', caption: '행사 소개 → 일정 → 신청 안내', duration: 3800 },
  { state: 'waiting', title: '계획을 확인해 주세요.', caption: '실제 작업은 Codex 채팅에서 확인해요.' },
  { state: 'working', title: '만드는 중이에요.', caption: '진행은 펫에서, 결과는 기존 채팅에서.', duration: 4800 },
  { state: 'complete', title: '결과를 확인해요.', caption: '위의 실제 제작 예시처럼.' },
];

export function PetExperience({ active, onSelect }: { active: boolean; onSelect: (entry: PetCatalogEntry) => void }) {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(true);
  const [take, setTake] = useState(0);
  const [demoOpen, setDemoOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [resultFailed, setResultFailed] = useState(false);
  const resultTrigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const { ref, playing, reduced } = usePetVisibility(active && demoOpen);
  const stage = stages[step];
  useEffect(() => {
    if (!playing || !running || !stage.duration) return;
    const timer = setTimeout(() => setStep(value => Math.min(value + 1, stages.length - 1)), stage.duration);
    return () => clearTimeout(timer);
  }, [playing, running, stage]);
  useEffect(() => {
    if (!active) { setExpanded(false); setDemoOpen(false); }
  }, [active]);
  useEffect(() => {
    const element = dialog.current;
    if (!expanded || !element) return;
    element.showModal();
    closeButton.current?.focus();
    return () => { element.close(); resultTrigger.current?.focus(); };
  }, [expanded]);
  const next = () => { setRunning(true); if (step === 5) { setTake(value => value + 1); setStep(1); } else setStep(value => value + 1); };
  return <section className="pet-experience" aria-label="펫과 함께하는 첫 작업">
    <div className="experience-intro">
      <h1>웹페이지,<br />펫에게 맡겨요.</h1>
      <div className="experience-request"><span>요청 요약</span><p>“학과 행사 소개 페이지 만들어줘.”</p></div>
      <div className="experience-pet"><TaskPetArt entry={entry} paused interactive={false} example /><span className="experience-arrow" aria-hidden="true">→</span></div>
      <button className="button primary experience-start" aria-label="웹페이지 펫으로 시작" onClick={() => onSelect(entry)}>웹페이지 펫으로 시작 <span aria-hidden="true">↗</span></button>
      {source.source && <a className="experience-source" href={source.source} target="_blank" rel="noreferrer" aria-label={`${source.name} GitHub 원본 보기`}><SourceLogo external />{source.name} 기반 <span aria-hidden="true">↗</span></a>}
    </div>
    <figure className="experience-output">
      <button ref={resultTrigger} className="experience-result" aria-label="실제 제작 웹페이지 크게 보기" aria-haspopup="dialog" disabled={resultFailed} onClick={() => setExpanded(true)}>
        {resultFailed ? <span className="experience-result-fallback">미리보기를 불러오지 못했어요.</span> : <img src={resultImage} alt="실제 제작한 가상 행사 웹페이지: 별을 보는 밤, 함께." onError={() => setResultFailed(true)} />}
        <span className="experience-enlarge" aria-hidden="true">↗</span>
      </button>
      <figcaption><span>실제 제작 예시</span><span>2026.10.12</span></figcaption>
    </figure>
    <details className="experience-process" open={demoOpen} onToggle={event => setDemoOpen(event.currentTarget.open)}>
      <summary>과정 보기</summary>
      <span ref={ref} className="experience-demo" data-step={step}>
        <span className="experience-demo-label">예시 체험 <span>실제 작업을 실행하지 않아요</span></span>
        <span className="experience-story" aria-live="polite"><strong>{stage.title}</strong><span>{stage.caption}</span></span>
        <span className="experience-stage"><TaskPetArt entry={entry} paused={!active || !demoOpen || !running} interactive={false} state={stage.state} runKey={`example:webpage:${take}`} example /></span>
        <span className="experience-controls"><span className="experience-steps" aria-label="예시 순서"><span className={step < 2 ? 'current' : ''}>부탁</span><i>→</i><span className={step === 2 || step === 3 ? 'current' : ''}>계획 확인</span><i>→</i><span className={step >= 4 ? 'current' : ''}>제작·결과</span></span>
          {step === 0 || step === 3 || step === 5 || reduced ? <button className="experience-play" onClick={next}>{step === 0 ? '예시 재생 ▷' : step === 3 ? '계획 확인하고 예시 계속 →' : step === 5 ? '다시 보기 ↻' : '다음 장면 →'}</button> : <button className="experience-play" aria-pressed={!running} onClick={() => setRunning(value => !value)}>{running ? '잠시 멈춤 Ⅱ' : '이어서 보기 ▷'}</button>}
        </span>
      </span>
    </details>
    <dialog ref={dialog} className="experience-expanded" aria-label="실제 제작 웹페이지 예시" onCancel={() => setExpanded(false)} onClose={() => setExpanded(false)}>
      <header><span>실제 제작 예시 · 2026.10.12</span><button ref={closeButton} className="text-button" onClick={() => setExpanded(false)}>닫기 <span aria-hidden="true">×</span></button></header>
      {expanded && <img src={resultImage} alt="2026년 10월 12일 검증한 가상 행사 웹페이지 결과 전체 화면" />}
      <p>이전 검증 결과예요. 현재 요청의 실시간 생성 화면은 아니에요.</p>
    </dialog>
  </section>;
}
