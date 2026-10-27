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
      <p className="pet-home-intro" id="home-codex-hint" data-agent-id="home.intro">펫을 고르고, 할 일은 쓰던 Codex에서 말해요.</p>
      <button type="button" ref={choose} className="button pet-home-find" aria-describedby="home-codex-hint" data-agent-id="home.choose-pet" onClick={onBrowse}>펫 고르기 <span aria-hidden="true">→</span></button>
      <p className="pet-home-connection" data-agent-id="home.connection" role="status" aria-live="polite" aria-atomic="true">{connectedCount ? `연결된 Codex 채팅 ${connectedCount}개` : '처음이라면 Codex에서 “AutoPets 켜줘”라고 말해보세요.'}</p>
    </div>
    {children}
  </section>;
}
