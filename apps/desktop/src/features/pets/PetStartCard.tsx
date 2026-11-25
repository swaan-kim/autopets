import { useState } from 'react';
import type { PetLink, SetupState } from '@autopets/contracts/types';
import { petCatalog, type PetCatalogEntry } from './petCatalog';
import { findPetCandidates } from './petCandidates';
import { usePetFavorites } from './usePetFavorites';
import { startCatalogPet, startChat } from './startInCodex';
import { AI_NAMES, usePrimaryAi } from './primaryAi';
import { sendFailure, sendText, useCodexSend, type Delivery } from './codexDelivery';
import { chatName, useCodexChatTitles } from './useCodexChatTitles';
import './pet-start-card.css';

// "새 일 맡기기" in the floating pet's card: type one line, or pick a job. In Codex the request is
// sent straight into the chat named on the card (or, with no chat to send to, a new Codex chat opens
// with it typed in). The words are matched to a pet on this PC only; no AI is called for it.
const DEFAULTS = ['presentation', 'study-helper', 'marketing-copy'];
const notices = (ai: string) => ({
  opened: `${ai}에 넣었어요. 보내기만 누르세요.`,
  copied: `요청이 길어 복사했어요. ${ai}에 붙여넣고 보내 주세요.`,
  'not-ready': 'Codex 연결을 준비하지 못했어요. 앱의 ‘AI 연결’에서 확인해 주세요.',
});

export function PetStartCard({ setup, links = [], disabled = false }: { setup?: SetupState | null; links?: PetLink[]; disabled?: boolean }) {
  const favorites = usePetFavorites();
  const [primaryAi] = usePrimaryAi();
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [choices, setChoices] = useState<PetCatalogEntry[] | null>(null);
  const sent = useCodexSend();
  const codex = primaryAi === 'codex';
  const chat = codex ? startChat(setup, links) : null;
  const titles = useCodexChatTitles([chat?.threadId]);
  const chatLabel = chat ? chatName(titles, chat) : '';
  const favored = favorites.ids.filter(id => id.startsWith('template:')).map(id => id.slice('template:'.length));
  const quick = [...new Set([...favored, ...DEFAULTS])].map(id => petCatalog.find(entry => entry.id === id)).filter((entry): entry is PetCatalogEntry => Boolean(entry)).slice(0, 3);
  const start = async (entry: PetCatalogEntry) => {
    if (busy) return;
    setBusy(true); setNotice(''); setChoices(null); sent.clear();
    try {
      if (codex) {
        await sent.send(async (): Promise<Delivery> => {
          const result = await startCatalogPet(entry, task.trim(), setup, primaryAi, chat);
          if (typeof result === 'string') throw Error(result);
          return result;
        }, chatLabel);
        setTask('');
      } else {
        const result = await startCatalogPet(entry, task.trim(), setup, primaryAi);
        if (typeof result === 'string') setNotice(notices(AI_NAMES[primaryAi])[result]);
        if (result === 'opened') setTask('');
      }
    } catch (cause) {
      setNotice(String(cause).includes('not-ready') ? notices('Codex')['not-ready'] : sendFailure(cause) ?? '시작하지 못했어요. 앱을 열어 다시 시도해 주세요.');
    } finally { setBusy(false); }
  };
  const submit = () => {
    const found = findPetCandidates(task);
    const entry = found.suggestedId ? petCatalog.find(item => item.id === found.suggestedId) : undefined;
    if (entry) { void start(entry); return; }
    // Unclear words are never guessed: the user picks, with the closest matches first.
    setChoices(found.entries.length ? found.entries.slice(0, 3) : quick);
    setNotice('어떤 방법으로 할까요?');
  };
  const status = sent.view && sent.view.phase !== 'sending' ? sendText(sent.view) : notice;
  return <section className="pet-start-card" aria-label="새 일 맡기기" data-agent-id="task-card.start">
    <form onSubmit={event => { event.preventDefault(); if (task.trim() && !busy && !disabled) submit(); }}>
      <input aria-label="맡길 일 한 줄" value={task} maxLength={200} disabled={busy || disabled} placeholder={`무엇을 맡길까요? (${AI_NAMES[primaryAi]})`} onChange={event => { setTask(event.target.value); setChoices(null); setNotice(''); }} />
      <button type="submit" disabled={busy || disabled || !task.trim()}>{busy ? (chat ? '보내는 중…' : '여는 중…') : '시작'}</button>
    </form>
    {codex && <p className="pet-start-to" data-agent-id="task-card.start.chat">{chat ? `보낼 채팅: 「${chatLabel}」` : 'Codex 새 대화에 넣어요'}</p>}
    <div className="pet-start-quick" role="group" aria-label={choices ? '이 중에서 고르기' : '바로 시작'}>
      {(choices ?? quick).map(entry => <button key={entry.id} disabled={busy || disabled} onClick={() => void start(entry)}>{entry.name}</button>)}
    </div>
    {status && <p role="status">{status}</p>}
  </section>;
}
