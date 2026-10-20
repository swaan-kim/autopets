import { useRef, useState, type ReactNode } from 'react';
import { CompanionPet } from './CompanionPet';
import './pet-home.css';

export function PetHome({ active, request, onRequest, onFind, onBrowse, children }: {
  active: boolean; request: string; onRequest: (value: string) => void;
  onFind: () => void; onBrowse: () => void; children?: ReactNode;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [interaction, setInteraction] = useState(0);
  const react = () => { setInteraction(value => value + 1); input.current?.focus(); };
  return <section className="pet-home" aria-label="펫과 시작하기">
    <div className="pet-home-start">
      <button className="pet-home-greeting" aria-label="펫에게 인사하고 할 일 쓰기" onClick={react}>
        <CompanionPet state="idle" paused={!active} interaction={interaction} />
      </button>
      <h1>무엇을 도와줄까요?</h1>
      <form className="pet-home-form" onSubmit={event => { event.preventDefault(); if (request.trim()) onFind(); else input.current?.focus(); }}>
        <label className="pet-home-input"><span className="pet-home-input-label">맡길 일</span><textarea ref={input} aria-label="맡길 일" placeholder="예: 학과 행사 웹페이지를 만들고 싶어요" value={request} onChange={event => onRequest(event.target.value)} rows={3} maxLength={1200} /></label>
        <button className="button pet-home-find" type="submit" disabled={!request.trim()}>펫 찾기 <span aria-hidden="true">→</span></button>
      </form>
      <button className="text-button pet-home-browse" onClick={onBrowse}>펫 둘러보기 <span aria-hidden="true">↗</span></button>
    </div>
    {children}
  </section>;
}
