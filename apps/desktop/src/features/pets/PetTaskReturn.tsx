import { useEffect, useRef, useState } from 'react';
import type { PetLink } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';
import { chatTitle, useCodexChatTitles } from './useCodexChatTitles';

export function canReturnToPetTask(link: PetLink): boolean {
  const { target, revision } = link;
  return isDesktop && target.sourceId === 'codex-windows-local'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(target.threadId)
    && target.threadId !== '00000000-0000-0000-0000-000000000000'
    && /^[a-z]:[/\\]/i.test(target.cwd) && !/[\x00-\x1f\x7f]/.test(target.cwd)
    && !target.cwd.slice(2).includes(':')
    && !target.cwd.split(/[/\\]/).some(part => part === '.' || part === '..')
    && Number.isSafeInteger(revision) && revision >= 0;
}

export const targetKey = (link: PetLink) => JSON.stringify([link.target.sourceId, link.target.threadId, link.target.cwd, link.revision]);

const hasCurrentPetResult = (link: PetLink, disconnected: boolean) => link.connected && link.enabled && !disconnected && !link.run?.trackingClosed;

export function petTaskReturnLabel(link: PetLink, disconnected = false): string {
  if (hasCurrentPetResult(link, disconnected) && link.run?.state === 'waiting' && link.run.profile === 'plan') return '계획 보기';
  return 'Codex에서 보기';
}

export function canStartNewPetTask(link: PetLink, disconnected = false): boolean {
  return hasCurrentPetResult(link, disconnected) && link.run?.state === 'complete';
}

export function PetTaskReturn({ link, disconnected = false }: { link: PetLink; disconnected?: boolean }) {
  // A different registered target or revision owns a different pending request.
  return <PetTaskReturnAction key={targetKey(link)} link={link} disconnected={disconnected} />;
}

/** Opens the pet's exact Codex chat (`open_pet_task`). Shared by the app card and the pet popup.
 *  A different target or revision owns a different request: its state resets and a late receipt
 *  for the previous one is dropped, so a stale receipt never shows. */
export function usePetTaskReturn(link: PetLink, chatName?: string | null) {
  // What the user can look for in Codex: the chat's own name, or the folder it works in.
  const findName = chatName || link.target.cwd.split(/[\\/]/).filter(Boolean).pop() || link.target.cwd;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const scope = targetKey(link);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setBusy(false); setNotice(''); setFailed(false); setOpened(false); setCopyNotice('');
  }, [scope]);
  const live = (at: string) => mounted.current && currentScope.current === at;
  const supported = canReturnToPetTask(link);
  const open = async () => {
    if (!supported || pending.current) return;
    const at = scope;
    pending.current = true; setBusy(true); setNotice(''); setFailed(false); setOpened(false); setCopyNotice('');
    try {
      const result = await command<{ status: string; sessionId: string; targetVerified: boolean }>('open_pet_task', {
        target: link.target, expectedRevision: link.revision,
      });
      if (!result || result.status !== 'dispatched' || result.sessionId !== link.target.threadId || result.targetVerified !== false) {
        throw new Error('pet-task-return-unconfirmed');
      }
      if (live(at)) { setNotice('Codex에 열기를 요청했어요. 열린 채팅이 맞는지 확인해 주세요.'); setOpened(true); }
    } catch (cause) {
      if (live(at)) {
        const changed = String(cause).includes('pet-revision-changed') || String(cause).includes('pet-target-mismatch');
        setNotice(changed ? '연결 정보가 바뀌었어요. 펫을 다시 확인하거나 Codex에서 채팅을 직접 찾아 주세요.' : 'Codex를 열지 못했어요. Codex에서 채팅을 직접 찾아 주세요.');
        setFailed(true);
      }
    } finally {
      pending.current = false;
      if (live(at)) setBusy(false);
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(findName); if (mounted.current) setCopyNotice('채팅 이름을 복사했어요. Codex에서 같은 이름의 채팅을 찾아 주세요.'); }
    catch { if (mounted.current) setCopyNotice(`복사하지 못했어요. Codex에서 ‘${findName}’ 채팅을 찾아 주세요.`); }
  };
  return { supported, busy, notice, failed, opened, copyNotice, findName, open, copy };
}

function PetTaskReturnAction({ link, disconnected }: { link: PetLink; disconnected: boolean }) {
  const titles = useCodexChatTitles([link.target.threadId]);
  const { supported, busy, notice, failed, copyNotice, findName, open, copy } = usePetTaskReturn(link, chatTitle(titles, link.target.threadId));
  return <div className="pet-task-return" data-testid="pet-task-return" data-agent-id="task-card.return-panel">
    <button className="button explicit-return" data-agent-id="task-card.return" disabled={busy || !supported} onClick={() => void open()}>{busy ? 'Codex에 요청 중…' : `${petTaskReturnLabel(link, disconnected)} ↗`}</button>
    {notice && <p className="explicit-return-notice" role={failed ? 'alert' : 'status'}>{notice}</p>}
    {(!supported || failed) && <div className="explicit-return-fallback">
      {!supported && <p>지금은 바로 열 수 없어요. Codex에서 ‘{findName}’ 채팅을 찾아 주세요.</p>}
      <button className="text-button" onClick={() => void copy()}>채팅 이름 복사</button>
      {copyNotice && <p role="status">{copyNotice}</p>}
    </div>}
  </div>;
}
