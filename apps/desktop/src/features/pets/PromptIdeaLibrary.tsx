import { useEffect, useId, useRef, useState } from 'react';
import type { PetCatalogEntry } from './petCatalog';
import { PromptArtwork } from './PromptArtwork';
import { petForPromptIdea, promptIdeas, type PromptIdea } from './promptIdeas';
import examples from '../../../public/assets/prompt-gallery-v1/manifest.json';
import videos from '../../../public/assets/prompt-videos-v1/manifest.json';
import './prompt-ideas.css';

export function PromptIdeaLibrary({ onSelect, active }: { onSelect: (entry: PetCatalogEntry) => void; active: boolean }) {
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const [selected, setSelected] = useState<PromptIdea | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const title = useId();
  const selectedVideo = videos.videos.find(video => video.id === selected?.art);
  useEffect(() => { if (!active) setSelected(null); }, [active]);
  useEffect(() => {
    if (!selected) return;
    dialog.current?.showModal(); close.current?.focus();
    return () => { dialog.current?.close(); trigger.current?.focus(); };
  }, [selected]);
  return <section className="prompt-ideas" aria-label="이미지와 영상 아이디어" data-active={active} data-agent-scope="pet-selection" data-agent-id="pet-selection.prompt-ideas">
    <header className="prompt-ideas-heading"><div><h2>이미지·영상 요청문 만들기</h2><p>예시를 고르면 펫이 생성 앱에 넣을 요청문을 정리해요. 이미지나 영상을 직접 만들지는 않아요.</p></div><div className="prompt-idea-filters" role="group" aria-label="아이디어 분류">
      {([['all', '전체'], ['image', '이미지'], ['video', '영상']] as const).map(([value, label]) => <button key={value} aria-label={`${label} 예시`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
    </div></header>
    <div className="prompt-idea-grid">{promptIdeas.filter(idea => filter === 'all' || idea.kind === filter).map(idea => <button type="button" className="prompt-idea-card" key={idea.id} data-agent-id={`pet-selection.idea.${idea.id}`} aria-label={`${idea.title} 예시 살펴보기`} onClick={event => { trigger.current = event.currentTarget; setSelected(idea); }}>
      <PromptArtwork kind={idea.art} /><span className="prompt-idea-kind">{idea.kind === 'image' ? '이미지' : '영상'}</span><strong>{idea.title}</strong><span className="prompt-idea-caption">{idea.summary}</span>
    </button>)}</div>
    <p className="prompt-ideas-boundary">AI로 만든 예시예요. 결과는 요청과 생성 앱에 따라 달라요.</p>
    {selected && <dialog ref={dialog} className="prompt-idea-dialog" aria-labelledby={title} onCancel={event => { event.preventDefault(); setSelected(null); }}>
      <header><h2 id={title}>{selected.title}</h2><button ref={close} className="text-button" aria-label="아이디어 닫기" onClick={() => setSelected(null)}>닫기 ×</button></header>
      <div className="prompt-idea-detail"><PromptArtwork kind={selected.art} large /><div><span className="prompt-idea-eyebrow">이런 방향으로 만들어 봐요</span><h3>{selected.summary}</h3><div className="prompt-idea-conditions">{selected.conditions.map(condition => <span key={condition}>{condition}</span>)}</div><h4>장면을 설명하는 요청 예시</h4><p className="prompt-idea-request">{selected.prompt}</p><button className="button primary" data-agent-id="pet-selection.idea.use" onClick={() => { const entry = petForPromptIdea(selected); setSelected(null); onSelect(entry); }}>이 예시로 시작 <span aria-hidden="true">→</span></button><small>선택만으로 생성하거나 전송하지 않아요.</small>
        <details className="prompt-idea-source"><summary>{selectedVideo ? '영상 출처' : '이 이미지를 만든 요청문'}</summary>
          {selectedVideo ? <>
            <p>{selectedVideo.model} · {selectedVideo.author} · {selectedVideo.created} · CC0</p>
            <p><a href={selectedVideo.sourceUrl} target="_blank" rel="noreferrer">원본 영상과 요청문 ↗</a> · <a href={selectedVideo.licenseUrl} target="_blank" rel="noreferrer">라이선스 ↗</a></p>
            <p>외부 제작자가 공개한 AI 영상이에요. 위 한국어 요청은 장면을 바꾸기 위한 예시이고, 원본 요청문과는 달라요.</p>
          </> : <><p>2026.11.04 · AI 이미지 제작 · 1536×1024</p><pre>{examples.images.find(image => image.id === selected.art)?.prompt}</pre><p>위 요청 예시는 이 장면을 원하는 내용으로 바꾸기 위한 짧은 안내예요.</p></>}
        </details></div></div>
    </dialog>}
  </section>;
}
