import { useRef, useState, type ReactNode } from 'react';
import { CompanionPet } from './CompanionPet';
import './pet-home.css';

export function PetHome({ active, connectedCount, onBrowse, children }: {
  active: boolean; connectedCount: number; onBrowse: () => void; children?: ReactNode;
}) {
  const choose = useRef<HTMLButtonElement>(null);
  const [interaction, setInteraction] = useState(0);
  const react = () => { setInteraction(value => value + 1); choose.current?.focus(); };
  return <section className="pet-home" aria-label="펫과 시작하기" data-agent-scope="home" data-agent-id="home.root">
    <div className="pet-home-start">
      <button type="button" className="pet-home-greeting" aria-label="펫에게 인사하고 펫 고르기" data-agent-id="home.greeting" onClick={react}>
        <CompanionPet state="idle" paused={!active} interaction={interaction} />
      </button>
      <h1 data-agent-id="home.title">어떤 펫과 일할까요?</h1>
      <p className="pet-home-intro" id="home-codex-hint" data-agent-id="home.intro">펫을 고르고 시작을 누르면, AI 채팅에 요청을 넣어 드려요.</p>
      <button type="button" ref={choose} className="button pet-home-find" aria-describedby="home-codex-hint" data-agent-id="home.choose-pet" onClick={onBrowse}>펫 고르기 <span aria-hidden="true">→</span></button>
      <p className="pet-home-connection" data-agent-id="home.connection" role="status" aria-live="polite" aria-atomic="true">{connectedCount ? `연결된 Codex 채팅 ${connectedCount}개` : 'Codex나 Claude 앱이 있으면 바로 시작할 수 있어요.'}</p>
    </div>
    {children}
  </section>;
}
