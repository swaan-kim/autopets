import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { CompanionPet } from '../features/pets/CompanionPet';
import type { CompanionState } from '../features/pets/companionMotion';
import registry from '../../../../integrations/codex/skills/skill-sources.json';
import './campaign-study.css';

type Scene = 'start' | 'resume' | 'reuse' | 'result';
type TaskId = 'A' | 'B';
const scenes: { id: Scene; name: string }[] = [
  { id: 'start', name: '처음 맡기기' }, { id: 'resume', name: '작업 이어가기' },
  { id: 'reuse', name: '지난 방식' }, { id: 'result', name: '결과 확인' },
];
const skill = registry.skills.find(item => item.id === 'frontend-design')!;
const example = '봄 오픈캠퍼스 소개 페이지를 만들어줘. 행사 소개, 일정, 방문 안내와 모바일 화면이 필요해.';
const initialNames = { A: '봄 오픈캠퍼스', B: '지난 오픈캠퍼스' };

function Method({ reused = false }: { reused?: boolean }) {
  return <details className="cs-method">
    <summary><img src="/assets/sources/github.svg" alt="" />frontend-design <span>{reused ? '지난 설정' : '일하는 방식'}</span></summary>
    <div className="cs-method-body">
      <p>화면 구성과 제작 방법을 미리 준비해요.</p>
      <dl><div><dt>계획</dt><dd>Luna · low</dd></div><div><dt>제작</dt><dd>표준 · Sol / low</dd></div><div><dt>출처</dt><dd>Anthropic · GitHub</dd></div></dl>
      <p className="cs-note">시제품의 설정 예시예요. 실제 모델 적용·스킬 사용은 실행 기록으로 확인해야 해요.</p>
      <a href={skill.source} target="_blank" rel="noreferrer">GitHub 원본 ↗</a>
      <details><summary>버전·라이선스</summary><p className="cs-version">{skill.version}</p><p>{skill.license?.spdx} · 원본 수정 없음</p></details>
    </div>
  </details>;
}

function Preview({ onOpen, small = false }: { onOpen: () => void; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <figure className={`cs-preview ${small ? 'small' : ''}`}>
    <button type="button" onClick={onOpen} aria-label="행사 웹페이지 디자인 예시 크게 보기">
      {failed ? <span className="cs-image-fallback">디자인 예시를 불러오지 못했어요.</span> : <img src="/assets/design-example-v1/desktop.webp" onError={() => setFailed(true)} alt="큰 행사 이미지와 방문 안내가 있는 가상 학과 행사 웹페이지" />}
      <span className="cs-expand" aria-hidden="true">↗</span>
    </button>
    <figcaption>디자인 예시 <span>행사 소개 · 일정 · 방문 안내</span></figcaption>
  </figure>;
}

export function CampaignStudy() {
  const [scene, setScene] = useState<Scene>('start');
  const [draft, setDraft] = useState('');
  const [newDraft, setNewDraft] = useState('');
  const [prepared, setPrepared] = useState(false);
  const [newPrepared, setNewPrepared] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [names, setNames] = useState(initialNames);
  const [modal, setModal] = useState<'preview' | 'reset' | TaskId | null>(null);
  const [previewParent, setPreviewParent] = useState<TaskId | null>(null);
  const [mobile, setMobile] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [hidePet, setHidePet] = useState(false);
  const [reduce, setReduce] = useState(false);
  const [interaction, setInteraction] = useState(0);
  const [resultState, setResultState] = useState<CompanionState>('complete');
  const [played, setPlayed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogClose = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const requestInput = useRef<HTMLTextAreaElement>(null);
  const copyInput = useRef<HTMLTextAreaElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const animationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);

  useEffect(() => () => clearTimeout(animationTimer.current), []);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    heading.current?.focus();
  }, [scene]);
  useEffect(() => {
    if (modal && dialog.current) { dialog.current.showModal(); dialogClose.current?.focus(); }
  }, [modal]);
  useEffect(() => setPreviewFailed(false), [modal, mobile]);
  useEffect(() => {
    if (copyStatus === 'failed') { copyInput.current?.focus(); copyInput.current?.select(); }
  }, [copyStatus]);

  const navigate = (next: Scene) => { setScene(next); setCopyStatus('idle'); };
  const open = (next: 'preview' | 'reset' | TaskId) => {
    if (modal === 'A' || modal === 'B') setPreviewParent(modal);
    else { previousFocus.current = document.activeElement as HTMLElement; setPreviewParent(null); }
    setMobile(false); setModal(next);
  };
  const close = () => {
    if (modal === 'preview' && previewParent) { setModal(previewParent); setPreviewParent(null); return; }
    dialog.current?.close(); setModal(null); previousFocus.current?.focus();
  };
  const reset = () => {
    clearTimeout(animationTimer.current);
    dialog.current?.close(); setModal(null); setPreviewParent(null);
    setDraft(''); setNewDraft(''); setPrepared(false); setNewPrepared(false); setCopyStatus('idle');
    setNames(initialNames); setHidePet(false); setReduce(false); setPlayed(false); setResultState('complete'); setInteraction(0);
    setScene('start'); requestAnimationFrame(() => heading.current?.focus());
  };
  const isReuse = scene === 'reuse';
  const activeDraft = isReuse ? newDraft : draft;
  const isPrepared = isReuse ? newPrepared : prepared;
  const requestText = `[사용성 시제품 — 실제 실행용 요청이 아닙니다]\n\n새 요청: ${activeDraft}\n\n일하는 방법: frontend-design\n계획 예시: Luna / low\n제작 예시: Sol / low\n계획을 먼저 보고 사용자의 구현 요청을 기다리는 흐름입니다.\n\n이 텍스트는 화면 이해도 확인용입니다. 실제 채팅에 전송하지 마세요.`;
  const prepare = (event: FormEvent) => {
    event.preventDefault();
    if (!activeDraft.trim()) return;
    isReuse ? setNewPrepared(true) : setPrepared(true);
    setCopyStatus('idle');
    requestAnimationFrame(() => copyButton.current?.focus());
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(requestText); setCopyStatus('copied'); }
    catch { setCopyStatus('failed'); }
  };
  const celebrate = () => {
    if (played) return;
    setPlayed(true); setResultState('working');
    animationTimer.current = setTimeout(() => setResultState('complete'), 1200);
  };
  const state: CompanionState = scene === 'resume' ? 'waiting' : scene === 'result' ? resultState : isPrepared ? 'planning' : 'idle';
  const title = scene === 'start' ? <>반복 준비는 줄이고,<br />하던 일은 펫과 이어서.</> : scene === 'resume' ? <>어디까지 했더라?<br />여기서 이어가요.</> : scene === 'reuse' ? <>잘 맞았던 방식으로,<br />새 일을 시작해요.</> : <>끝난 일도,<br />다음 일도 한곳에서.</>;

  return <div className="campaign-study" data-scene={scene}>
    <header className="cs-header">
      <a className="cs-brand" href="#" onClick={event => { event.preventDefault(); navigate('start'); }} aria-label="AutoPets 처음 맡기기로"><img src="/assets/brand/autopets-mark.svg" alt="" />AutoPets</a>
      <span className="cs-fixture-label">시제품 · 가상 작업 · AI 실행 없음</span>
      <details className="cs-display"><summary aria-label="펫 표시 설정">표시 설정</summary><div><label><input type="checkbox" checked={hidePet} onChange={event => setHidePet(event.target.checked)} />펫 숨기기</label><label><input type="checkbox" checked={reduce} onChange={event => setReduce(event.target.checked)} />동작 줄이기</label><p>기본 무음</p><button type="button" className="cs-reset" onClick={() => open('reset')}>처음부터 체험</button></div></details>
    </header>
    <nav className="cs-scenes" aria-label="체험 장면">{scenes.map((item, index) => <button key={item.id} type="button" aria-current={scene === item.id ? 'step' : undefined} onClick={() => navigate(item.id)}><span>{index + 1}</span>{item.name}</button>)}</nav>
    <main>
      <section className="cs-companion" aria-label="함께 일하는 펫">
        <p className="cs-eyebrow">행사 · 캠페인 제작</p>
        <h1 ref={heading} tabIndex={-1}>{title}</h1>
        {!hidePet ? <button className="cs-pet" type="button" onClick={() => { setInteraction(value => value + 1); if (scene === 'start' || scene === 'reuse') requestInput.current?.focus(); }} aria-label="펫에게 인사하기">
          <CompanionPet key={scene} state={state} paused={reduce} example runKey="campaign-study-fixture-result" interaction={interaction} />
        </button> : <div className="cs-pet-hidden">펫을 숨겼어요.<button type="button" onClick={() => setHidePet(false)}>다시 보기</button></div>}
        <p className="cs-companion-note">{scene === 'start' ? '무엇을 만들지만 알려주세요.' : scene === 'resume' ? '확인할 일부터 보여드릴게요.' : scene === 'reuse' ? '일하는 방법은 그대로. 요청은 새롭게.' : '결과를 확인하고, 다음 일을 준비해요.'}</p>
        {scene === 'result' && <details className="cs-motion-demo"><summary>완료 반응 체험</summary><button type="button" onClick={celebrate} disabled={played}>{played ? '이 가상 작업의 반응을 보여드렸어요' : '작업 중 → 완료 반응 보기'}</button><p>실제 작업이 아닌 모션 예시예요.</p></details>}
      </section>
      <section className="cs-workspace" aria-label={scenes.find(item => item.id === scene)?.name}>
        {(scene === 'start' || scene === 'reuse') && <>
          <div className="cs-section-top"><span className="cs-stage">{isReuse ? '지난 방식으로 새 일' : '웹페이지 펫'}</span><span className="cs-mini-preset">표준</span></div>
          {isReuse && <div className="cs-reuse-summary"><span aria-hidden="true">↻</span><div><strong>{names.B}에서 쓴 방식</strong><p>스킬·설정만 가져왔어요. 새 요청을 적어주세요.</p></div></div>}
          <form onSubmit={prepare}>
            <label className="cs-field-label" htmlFor="campaign-request">{isReuse ? '이번에는 어떤 일을 맡길까요?' : '어떤 페이지가 필요한가요?'}</label>
            <textarea ref={requestInput} id="campaign-request" key={scene} value={activeDraft} maxLength={1200} placeholder="예: 오픈캠퍼스 소개 페이지. 일정과 방문 안내를 넣어줘." onChange={event => { isReuse ? setNewDraft(event.target.value) : setDraft(event.target.value); isReuse ? setNewPrepared(false) : setPrepared(false); setCopyStatus('idle'); }} />
            {!isReuse && !isPrepared && <button className="cs-example-button" type="button" onClick={() => { setDraft(example); requestInput.current?.focus(); }}>예시로 시작 ↗</button>}
            <Method reused={isReuse} />
            {!isPrepared ? <button className="cs-primary" type="submit" disabled={!activeDraft.trim()}>요청 준비하기 <span>→</span></button> : <div className="cs-prepared" role="status"><strong>요청 준비 화면이에요.</strong><p>실제 제품에서는 쓸 Codex 채팅에 붙여넣고 보내요.</p><button ref={copyButton} className="cs-primary" type="button" onClick={copy}>체험 문구 복사 <span>⧉</span></button><p className="cs-note">시제품 문구는 실제 채팅에 보내지 마세요.</p></div>}
          </form>
          {isPrepared && <details className="cs-copy-preview" open={copyStatus === 'failed'}><summary>체험 문구 확인</summary><textarea ref={copyInput} readOnly value={requestText} aria-label="실행용이 아닌 체험 문구" /></details>}
          {copyStatus !== 'idle' && <p className={`cs-copy-status ${copyStatus === 'failed' ? 'error' : ''}`} role="status">{copyStatus === 'copied' ? '체험 문구를 복사했어요. 채팅 연결·실행은 하지 않았어요.' : '복사하지 못했어요. 아래 체험 문구를 선택해 직접 복사할 수 있어요.'}</p>}
          <Preview small onOpen={() => open('preview')} />
        </>}
        {scene === 'resume' && <>
          <div className="cs-section-top"><span className="cs-stage">이어서 할 일</span><span className="cs-task-count">가상 작업 2개</span></div>
          <article className="cs-task attention" data-task-id="A"><div className="cs-task-heading"><span className="cs-state">계획 확인 필요</span><span className="cs-task-letter">A</span></div><h2>{names.A}</h2><p>소개 → 일정 → 방문 안내 순서로 준비했어요.</p><button className="cs-primary" type="button" onClick={() => open('A')}>계획 보러 가기 <span>↗</span></button></article>
          <article className="cs-task" data-task-id="B"><div className="cs-task-heading"><span className="cs-state">결과 있음</span><span className="cs-task-letter">B</span></div><h2>{names.B}</h2><p>다시 열어 결과를 확인할 수 있어요.</p><button className="cs-secondary" type="button" onClick={() => open('B')}>결과 보러 가기 <span>↗</span></button></article>
          <details className="cs-name-editor"><summary>작업명 바꿔보기</summary><p>사용자 지정 · 이 시제품에서만 적용돼요. 새로고침하면 초기화돼요.</p>{(['A', 'B'] as const).map(id => <label key={id}>가상 작업 {id}<input maxLength={48} value={names[id]} onChange={event => setNames(value => ({ ...value, [id]: event.target.value }))} onBlur={() => { if (!names[id].trim()) setNames(value => ({ ...value, [id]: initialNames[id] })); }} /></label>)}</details>
        </>}
        {scene === 'result' && <>
          <div className="cs-section-top"><span className="cs-stage">{names.B}</span><span className="cs-mini-preset">결과 확인 장면</span></div>
          <Preview onOpen={() => open('preview')} />
          <button className="cs-primary" type="button" onClick={() => open('B')}>결과 보러 가기 <span>↗</span></button>
          <div className="cs-next-work"><div><strong>다음 행사도 있나요?</strong><p>잘 맞았던 방법을 다시 써보세요.</p></div><button className="cs-secondary" type="button" onClick={() => navigate('reuse')}>지난 방식으로 새 일 →</button></div>
          <Method reused />
        </>}
      </section>
    </main>
    <footer className="cs-footer"><span>일하는 방법은 준비하고, 확인할 일은 놓치지 않게.</span><span>화면 체험용 · 실제 작업·연결·저장 없음</span></footer>
    {modal && <dialog ref={dialog} className={`cs-dialog ${modal === 'preview' ? 'preview' : ''}`} onCancel={event => { event.preventDefault(); close(); }} aria-labelledby="cs-dialog-title"><header><div><p className="cs-eyebrow">{modal === 'preview' ? '디자인 예시' : modal === 'reset' ? '시제품 초기화' : `가상 채팅 ${modal} · 시제품 안에서만 열림`}</p><h2 id="cs-dialog-title">{modal === 'preview' ? '행사 소개 웹페이지' : modal === 'reset' ? '처음부터 체험할까요?' : names[modal]}</h2></div><button ref={dialogClose} type="button" className="cs-close" onClick={close} aria-label="닫기">×</button></header>
      {modal === 'reset' ? <div className="cs-reset-confirm"><p>이 시제품에 작성한 요청과 바꾼 작업명이 지워져요. 실제 앱의 데이터는 바뀌지 않아요.</p><button type="button" className="cs-primary" onClick={reset}>초기화하고 시작</button><button type="button" className="cs-secondary" onClick={close}>계속 체험하기</button></div>
      : modal === 'preview' ? <><div className="cs-preview-controls"><button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)}>데스크톱</button><button type="button" aria-pressed={mobile} onClick={() => setMobile(true)}>모바일</button></div>{previewFailed ? <div className="cs-image-fallback" role="status">큰 미리보기를 불러오지 못했어요. 닫고 체험을 이어갈 수 있어요.</div> : <img className={`cs-full-preview ${mobile ? 'mobile' : ''}`} src={`/assets/design-example-v1/${mobile ? 'mobile' : 'desktop'}.webp`} onError={() => setPreviewFailed(true)} alt={`가상 학과 행사 페이지 ${mobile ? '모바일' : '데스크톱'} 디자인 예시`} />}<p className="cs-note">새로 디자인한 예시이며, 이 체험에서 펫이 만든 결과가 아니에요.</p></> : <><p className="cs-dialog-task-id">대상 확인: 가상 작업 {modal} · {names[modal]}</p>{modal === 'A' ? <div className="cs-plan"><span className="cs-state">계획 확인 필요 · 가상 상태</span><ol><li>행사 소개와 큰 이미지</li><li>일정과 방문 안내</li><li>모바일 화면 확인</li></ol><p>실제 제품에서는 같은 Codex 채팅에 구현을 요청해요.</p><div className="cs-chat-composer">“그대로 구현해줘”<span>안내 예시 · 전송되지 않음</span></div></div> : <><Preview onOpen={() => open('preview')} /><p className="cs-note">작업 B로 돌아오는 경로의 시제품이에요. 실제 Codex 채팅을 열거나 결과를 조회하지 않았어요.</p><button type="button" className="cs-secondary" onClick={() => { close(); navigate('reuse'); }}>지난 방식으로 새 일 →</button></>}</>}
    </dialog>}
  </div>;
}

const root = document.getElementById('campaign-study-root');
if (root) createRoot(root).render(<CampaignStudy />);
