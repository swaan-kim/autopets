import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { CompanionPet } from '../features/pets/CompanionPet';
import type { CompanionState } from '../features/pets/companionMotion';
import './ux-flow-preview.css';
import { PromptArtwork as Artwork } from '../features/pets/PromptArtwork';

type Category = 'all' | 'image' | 'video' | 'work';
type Example = { id: string; title: string; subtitle: string; category: Exclude<Category, 'all'>; art: string; prompt: string; settings: string[] };
const examples: Example[] = [
  { id: 'product', title: '작은 브랜드의 제품 사진', subtitle: '부드러운 빛 · 차분한 색', category: 'image', art: 'product', prompt: '[제품명]의 스튜디오 제품 사진. 크림색 배경 위에 제품 하나를 배치하고, 왼쪽 창으로 들어오는 부드러운 자연광과 짧은 그림자를 사용해줘. 라벨은 읽기 쉽게, 여백은 넉넉하게.', settings: ['정사각형', '자연광', '제품 사진'] },
  { id: 'coast', title: '느긋한 해변의 한 장면', subtitle: '천천히 다가가는 카메라', category: 'video', art: 'coast', prompt: '해 질 무렵 고요한 해변. 잔잔한 파도가 모래 위로 밀려오고 카메라가 천천히 앞으로 이동한다. 따뜻한 빛과 일정한 속도를 유지하는 짧은 영상.', settings: ['가로 화면', '느린 전진', '한 장면'] },
  { id: 'poster', title: '시선이 머무는 포스터', subtitle: '큰 글자 · 종이의 질감', category: 'image', art: 'poster', prompt: '[행사명]을 위한 미니멀 포스터를 만들어줘. 따뜻한 아이보리 종이에 짙은 녹색의 큰 제목과 작은 일정 정보를 배치해줘. 제목, 날짜, 장소를 정확히 확인하고 여백을 충분히 남겨줘.', settings: ['세로 화면', '타이포그래피', '행사 홍보'] },
  { id: 'orbit', title: '제품을 천천히 둘러보기', subtitle: '부드러운 회전 · 고정된 주인공', category: 'video', art: 'orbit', prompt: '[제품명]이 밝은 스튜디오 받침대 위에 놓여 있다. 카메라가 제품을 중심으로 천천히 작은 각도로 이동한다. 제품의 형태와 라벨을 유지하고 조명은 일정하게.', settings: ['정사각형', '작은 회전', '제품 영상'] },
  { id: 'web', title: '행사 소개 페이지', subtitle: '소개부터 신청 안내까지', category: 'work', art: 'web', prompt: '[행사명] 소개 웹페이지를 계획해줘. 행사 소개, 일정, 신청 안내와 모바일 화면이 필요해. 기존 파일과 구현 위치를 먼저 확인하고, 계획을 보여준 뒤 구현 요청을 기다려줘.', settings: ['웹페이지', '모바일 대응', '계획 먼저'] },
  { id: 'landscape', title: '이야기가 있는 풍경', subtitle: '초록 언덕 · 작은 집 한 채', category: 'image', art: 'landscape', prompt: '완만한 초록 언덕 위 작은 크림색 집 한 채. 맑고 옅은 하늘, 따뜻한 오후 햇살. 단순한 형태와 종이 질감이 느껴지는 편안한 일러스트로 표현해줘.', settings: ['가로 화면', '일러스트', '따뜻한 색'] },
];
const categories: [Category, string][] = [['all', '전체'], ['image', '이미지'], ['video', '영상'], ['work', '업무']];
const stages: { state: CompanionState; label: string; message: string; detail: string }[] = [
  { state: 'idle', label: '작업 전', message: '하던 일, 함께 이어가요.', detail: '선택한 작업과 다음 할 일을 확인해요.' },
  { state: 'receive', label: '작업 중', message: '부탁한 내용을 살펴봐요.', detail: '요청을 받은 모습의 디자인 예시예요.' },
  { state: 'planning', label: '작업 중', message: '어떻게 할지 정리해요.', detail: '계획이 필요한 일은 같은 채팅에서 확인해요.' },
  { state: 'working', label: '작업 중', message: '차근차근 만들고 있어요.', detail: '실제 앱에서는 확인된 실행 상태를 따라가요.' },
  { state: 'complete', label: '완료', message: '결과를 살펴볼까요?', detail: '연결된 대화로 돌아가 결과와 다음 일을 확인해요.' },
];

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const element = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    element.current?.showModal();
    return () => { element.current?.close(); trigger?.focus(); };
  }, []);
  return <dialog ref={element} className="ux-dialog" aria-labelledby={heading} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={heading}>{title}</h2><button className="ux-icon-button" aria-label="닫기" onClick={onClose}>×</button></header>{children}
  </dialog>;
}

export function UxFlowPreview() {
  const [page, setPage] = useState<'tasks' | 'explore' | 'connect'>('tasks');
  const [category, setCategory] = useState<Category>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Example | null>(null);
  const [chosen, setChosen] = useState<Example | null>(null);
  const [stage, setStage] = useState(0);
  const [auto, setAuto] = useState(false);
  const [take, setTake] = useState(0);
  const [host, setHost] = useState('Codex');
  const [notice, setNotice] = useState('');
  const [hidden, setHidden] = useState(document.hidden);
  const [reduced, setReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const current = stages[stage];
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('.ux-heading h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [page]);
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media.matches);
    document.addEventListener('visibilitychange', visibility); media.addEventListener('change', motion);
    return () => { document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', motion); };
  }, []);
  useEffect(() => {
    if (!auto || hidden || reduced || page !== 'tasks') return;
    const timer = setTimeout(() => {
      if (stage === stages.length - 1) setAuto(false);
      else setStage(value => value + 1);
    }, stage === 3 ? 5000 : stage === 2 ? 3200 : 1600);
    return () => clearTimeout(timer);
  }, [auto, stage, hidden, reduced, page]);
  const navigate = (next: typeof page) => { setPage(next); setNotice(''); };
  const choose = () => { setChosen(selected); setSelected(null); setStage(0); setAuto(false); navigate('tasks'); setNotice('선택한 예시를 이 작업에 담았어요. 실제 전달과 실행은 하지 않아요.'); };
  const visible = examples.filter(item => (category === 'all' || item.category === category) && `${item.title} ${item.subtitle} ${item.settings.join(' ')}`.includes(query.trim()));
  return <div className="ux-preview">
    <div className="ux-review-banner"><span>디자인 시제품</span> 가상 작업으로 흐름을 살펴보세요. 실제 AI 연결·전송·생성은 하지 않아요.</div>
    <div className="ux-layout">
      <aside className="ux-sidebar"><a className="ux-brand" href="#main" aria-label="AutoPets 본문"><img src="/assets/brand/autopets-logo.svg" alt="AutoPets" /></a><span className="ux-side-label">YOUR LITTLE WORKMATE</span>
        <nav aria-label="시제품 메뉴">{([['tasks', '◷', '이어서 하기'], ['explore', '▦', '둘러보기'], ['connect', '⌁', '연결']] as const).map(([value, icon, label]) => <button key={value} aria-current={page === value ? 'page' : undefined} onClick={() => navigate(value)}><span aria-hidden="true">{icon}</span>{label}{value === 'tasks' && <small>1</small>}</button>)}</nav>
        <div className="ux-side-bottom"><span className="ux-dot" />내 PC의 작업과 함께<p>펫은 상태를 알려주고,<br />작업은 쓰던 대화에서.</p><a href="/">현재 제품 화면 ↗</a></div>
      </aside>
      <main id="main" className="ux-main" data-agent-scope={page === 'explore' ? 'pet-selection' : page === 'tasks' ? 'task-card' : 'home'} data-agent-id={`ux25.${page}`}>
        <div className="ux-topline"><span>{page === 'tasks' ? 'MY WORKSPACE' : page === 'explore' ? 'A LITTLE INSPIRATION' : 'MAKE YOURSELF AT HOME'}</span><span className="ux-preview-account">로컬 작업 예시 <i>SW</i></span></div>
        {page === 'tasks' ? <>
          <header className="ux-heading"><div><h1>하던 일, 이어서.</h1><p>설명은 한 번이면 충분하도록.</p></div><button className="ux-button ux-secondary" onClick={() => navigate('explore')}>새로운 일 찾기 <span>↗</span></button></header>
          <section className="ux-current-task" aria-label="이어서 할 작업 예시">
            <div className="ux-task-content"><div className="ux-task-kicker"><span className="ux-host-mark">⌘</span> Codex의 기존 대화 <span className="ux-example-tag">예시</span></div><h2>{chosen?.title ?? '가을 캠페인, 작은 시작.'}</h2><p className="ux-task-description">{chosen ? chosen.subtitle : '행사 소개 페이지의 구성과 신청 흐름을 정리하고 있어요.'}</p><div className="ux-task-meta"><span className="ux-task-state" data-state={current.state}><i />{current.label}</span><span>제작 펫 · 같은 작업</span></div><div className="ux-task-actions"><button className="ux-button" onClick={() => setNotice('실제 앱에서는 대상 채팅을 재확인하고 기존 대화를 엽니다. 이 시제품은 외부 앱을 열지 않아요.')}>{stage === 4 ? '결과 보러 가기' : '기존 대화에서 이어가기'} <span>↗</span></button><button className="ux-text-button" onClick={() => setSelected(chosen ?? examples[4])}>작업 내용 보기</button></div></div>
            <div className="ux-companion-stage"><span className="ux-pet-speech" role="status">{current.message}</span><CompanionPet state={current.state} paused={page !== 'tasks'} runKey={`ux25-example-${take}`} example /><span className="ux-pet-ground" /><small>작업 상태의 디자인 예시</small></div>
          </section>
          <section className="ux-context" aria-label="이어서 가져갈 맥락 예시"><header><h2>이 작업이 기억할 것</h2><span>공유 범위 설계안</span></header><div><article><small>목표</small><p>{chosen?.title ?? '처음 보는 사람도 쉽게 신청하기'}</p></article><article><small>정한 내용</small><p>{chosen ? chosen.settings.join(' · ') : '행사 소개 → 일정 → 신청 안내'}</p></article><article><small>다음 할 일</small><p>{stage === 4 ? '같은 대화에서 결과 검토하기' : '계획 확인 후 구현 이어가기'}</p></article></div></section>
          <section className="ux-motion-review" aria-label="펫 동작 체험"><div><h2>일의 흐름이, 펫의 모습으로.</h2><p>{current.detail}</p></div><div className="ux-stage-controls" role="group" aria-label="작업 상태 예시">{[[0, '작업 전'], [3, '작업 중'], [4, '완료']].map(([value, label]) => <button key={value} aria-pressed={stage === value} onClick={() => { setAuto(false); setStage(Number(value)); }}>{label}</button>)}</div><button className="ux-text-button" disabled={reduced} onClick={() => { if (auto) setAuto(false); else { setStage(0); setTake(value => value + 1); setAuto(true); } }}>{reduced ? '동작 줄이기 적용 중' : auto ? '재생 멈추기 Ⅱ' : '흐름 재생 ▷'}</button></section>
          <button className="ux-explore-nudge" onClick={() => navigate('explore')}><span><small>다음에는 어떤 일을 해볼까요?</small><strong>원하는 결과를 보고 시작해요.</strong></span><span aria-hidden="true">→</span></button>
        </> : page === 'explore' ? <>
          <header className="ux-heading"><div><h1>이런 건 어때요?</h1><p>마음에 드는 결과의 방향을 고르고, 나의 일로 이어가요.</p></div></header>
          <div className="ux-library-tools"><div className="ux-filters" role="group" aria-label="결과 분류">{categories.map(([value, label]) => <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{label}</button>)}</div><label className="ux-search"><span aria-hidden="true">⌕</span><input aria-label="예시 검색" placeholder="어떤 결과를 찾나요?" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
          <div className="ux-example-grid">{visible.map(item => <button className="ux-example-card" key={item.id} onClick={() => setSelected(item)} aria-label={`${item.title} 살펴보기`} data-agent-id={`ux25.example.${item.id}`}><Artwork kind={item.art} /><span className="ux-card-kind">{item.category === 'image' ? 'IMAGE' : item.category === 'video' ? 'VIDEO' : 'WORK'} <span>↗</span></span><strong>{item.title}</strong><span className="ux-card-subtitle">{item.subtitle}</span></button>)}</div>
          {!visible.length && <div className="ux-empty"><h2>아직 맞는 예시가 없어요.</h2><p>다른 단어로 찾아보거나 전체 예시를 살펴보세요.</p><button className="ux-button ux-secondary" onClick={() => { setQuery(''); setCategory('all'); }}>전체 예시 보기</button></div>}
          <p className="ux-gallery-note">직접 그린 구도·움직임 예시예요. 실제 생성 결과나 품질 보장이 아니며, 생성 도구와 입력 조건에 따라 결과가 달라져요.</p>
        </> : <>
          <header className="ux-heading"><div><h1>쓰던 AI와, 함께.</h1><p>한 번 준비하고 기존 대화에서 이어가는 흐름을 살펴보세요.</p></div></header>
          <div className="ux-connection-hosts" role="group" aria-label="연결 흐름 선택">{['Codex', 'ChatGPT · Work', 'Claude'].map(value => <button key={value} aria-pressed={host === value} onClick={() => setHost(value)}><span className="ux-host-mark">{value === 'Claude' ? '✳' : '⌘'}</span><strong>{value}</strong><small>{value === 'Codex' ? '현재 제품의 명시적 호출 경로' : '연결 설계 · 제품 지원 전'}</small></button>)}</div>
          <section className="ux-connect-flow"><h2>{host}에서 이어가는 흐름</h2><ol><li><span>01</span><div><h3>앱과 연결 도구 준비</h3><p>Windows 앱을 설치하고 쓸 AI의 연결 수단을 준비해요.</p></div></li><li><span>02</span><div><h3>쓰던 대화에서 펫 부르기</h3><p>{host === 'Codex' ? 'AutoPets 스킬을 선택해 현재 대화를 연결해요.' : '이 호스트의 공식 연결 수단과 현재 대화 식별은 별도 확인이 필요해요.'}</p></div></li><li><span>03</span><div><h3>펫을 적용하고, 같은 대화에서 계속</h3><p>선택한 스킬과 설정을 재사용하고 결과가 오면 정확한 작업으로 돌아가요.</p></div></li></ol><div className="ux-connect-footer"><span>{host === 'Codex' ? '설정 적용·작업 실행·결과 확인을 각각 구분해요.' : '연결되지 않은 환경을 준비 완료로 표시하지 않아요.'}</span><button className="ux-button ux-secondary" onClick={() => navigate('tasks')}>작업 화면 살펴보기 →</button></div></section>
        </>}
        {notice && <div className="ux-notice" role="status"><span>{notice}</span><button className="ux-icon-button" aria-label="안내 닫기" onClick={() => setNotice('')}>×</button></div>}
        <footer className="ux-footer">AutoPets <span>작업은 이어지고, 펫은 곁에.</span><small>UX 검토용 · 실제 실행 없음</small></footer>
      </main>
    </div>
    {selected && <Dialog title={selected.title} onClose={() => setSelected(null)}><div className="ux-detail-layout"><Artwork kind={selected.art} large /><div className="ux-detail-content"><span className="ux-detail-label">이런 방향으로 만들어봐요</span><p>{selected.subtitle}</p><div className="ux-settings">{selected.settings.map(setting => <span key={setting}>{setting}</span>)}</div><h3>시작할 때 쓸 요청</h3><pre>{selected.prompt}</pre><p className="ux-detail-note">대괄호 안의 내용을 내 작업에 맞춰 바꾸세요. 이 예시는 생성 결과를 보장하지 않아요.</p><button className="ux-button" onClick={choose}>이 예시로 작업 준비 <span>→</span></button><small className="ux-detail-boundary">시제품에서는 선택만 저장해요. 실제 채팅 전송·생성은 하지 않아요.</small></div></div></Dialog>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<UxFlowPreview />);
