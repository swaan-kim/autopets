import { useState } from 'react';
import type { SetupState } from '@autopets/contracts/types';
import { petCatalog, type PetCatalogEntry } from './petCatalog';
import { findPetCandidates } from './petCandidates';
import { usePetFavorites } from './usePetFavorites';
import { startCatalogPet } from './startInCodex';
import { AI_NAMES, usePrimaryAi } from './primaryAi';
import './pet-start-card.css';

// "새 일 맡기기" in the floating pet's card: type one line, or pick a job, and Codex opens with the
// request filled in. The words are matched to a pet on this PC only; no AI is called for it.
const DEFAULTS = ['presentation', 'study-helper', 'marketing-copy'];
const notices = (ai: string) => ({
  opened: `${ai}에 넣었어요. 보내기만 누르세요.`,
  copied: `요청이 길어 복사했어요. ${ai}에 붙여넣고 보내 주세요.`,
  'not-ready': 'Codex 연결을 준비하지 못했어요. 앱의 ‘AI 연결’에서 확인해 주세요.',
});

export function PetStartCard({ setup, disabled = false }: { setup?: SetupState | null; disabled?: boolean }) {
  const favorites = usePetFavorites();
  const [primaryAi] = usePrimaryAi();
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [choices, setChoices] = useState<PetCatalogEntry[] | null>(null);
  const favored = favorites.ids.filter(id => id.startsWith('template:')).map(id => id.slice('template:'.length));
  const quick = [...new Set([...favored, ...DEFAULTS])].map(id => petCatalog.find(entry => entry.id === id)).filter((entry): entry is PetCatalogEntry => Boolean(entry)).slice(0, 3);
  const start = async (entry: PetCatalogEntry) => {
    if (busy) return;
    setBusy(true); setNotice(''); setChoices(null);
    try {
      const result = await startCatalogPet(entry, task.trim(), setup, primaryAi);
      setNotice(notices(AI_NAMES[primaryAi])[result]);
      if (result === 'opened') setTask('');
    } catch { setNotice('시작하지 못했어요. 앱을 열어 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };
  const submit = () => {
    const found = findPetCandidates(task);
    const entry = found.suggestedId ? petCatalog.find(item => item.id === found.suggestedId) : undefined;
    if (entry) { void start(entry); return; }
    // Unclear words are never guessed: the user picks, with the closest matches first.
    setChoices(found.entries.length ? found.entries.slice(0, 3) : quick);
    setNotice('어떤 방법으로 할까요?');
  };
  return <section className="pet-start-card" aria-label="새 일 맡기기" data-agent-id="task-card.start">
    <form onSubmit={event => { event.preventDefault(); if (task.trim() && !busy && !disabled) submit(); }}>
      <input aria-label="맡길 일 한 줄" value={task} maxLength={200} disabled={busy || disabled} placeholder={`무엇을 맡길까요? (${AI_NAMES[primaryAi]})`} onChange={event => { setTask(event.target.value); setChoices(null); setNotice(''); }} />
      <button type="submit" disabled={busy || disabled || !task.trim()}>{busy ? '여는 중…' : '시작'}</button>
    </form>
    <div className="pet-start-quick" role="group" aria-label={choices ? '이 중에서 고르기' : '바로 시작'}>
      {(choices ?? quick).map(entry => <button key={entry.id} disabled={busy || disabled} onClick={() => void start(entry)}>{entry.name}</button>)}
    </div>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
