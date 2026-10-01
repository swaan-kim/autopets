import { useEffect, useRef, useState } from 'react';
import type { PetLink } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';

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

const targetKey = (link: PetLink) => JSON.stringify([link.target.sourceId, link.target.threadId, link.target.cwd, link.revision]);

export function PetTaskReturn({ link }: { link: PetLink }) {
  // A different registered target or revision owns a different pending request.
  return <PetTaskReturnAction key={targetKey(link)} link={link} />;
}

function PetTaskReturnAction({ link }: { link: PetLink }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const supported = canReturnToPetTask(link);
  const open = async () => {
    if (!supported || pending.current) return;
    pending.current = true; setBusy(true); setNotice(''); setFailed(false); setCopyNotice('');
    try {
      const result = await command<{ status: string; sessionId: string; targetVerified: boolean }>('open_pet_task', {
        target: link.target, expectedRevision: link.revision,
      });
      if (!result || result.status !== 'dispatched' || result.sessionId !== link.target.threadId || result.targetVerified !== false) {
        throw new Error('pet-task-return-unconfirmed');
      }
      if (mounted.current) setNotice('Codex에 열기를 요청했어요. 열린 채팅이 맞는지 확인해 주세요.');
    } catch (cause) {
      if (mounted.current) {
        const changed = String(cause).includes('pet-revision-changed') || String(cause).includes('pet-target-mismatch');
        setNotice(changed ? '연결 정보가 바뀌었어요. 현재 펫을 다시 확인하거나 작업 ID로 찾아주세요.' : 'Codex 작업을 열지 못했어요. 작업 ID로 직접 찾아주세요.');
        setFailed(true);
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link.target.threadId); if (mounted.current) setCopyNotice('작업 ID를 복사했어요. Codex에서 같은 작업을 찾아주세요.'); }
    catch { if (mounted.current) setCopyNotice('복사하지 못했어요. 아래 작업 ID를 직접 선택해 주세요.'); }
  };
  return <div className="pet-task-return" data-testid="pet-task-return">
    <button className="button explicit-return" disabled={busy || !supported} onClick={() => void open()}>{busy ? 'Codex에 요청 중…' : 'Codex 작업 열기'}</button>
    {notice && <p className="explicit-return-notice" role={failed ? 'alert' : 'status'}>{notice}</p>}
    {(!supported || failed) && <div className="explicit-return-fallback">
      {!supported && <p>지금은 앱에서 바로 열 수 없어요. Codex에서 같은 작업을 찾아주세요.</p>}
      <button className="text-button" onClick={() => void copy()}>작업 ID 복사</button>
      <code tabIndex={0} aria-label="Codex 작업 ID">{link.target.threadId}</code>
      {copyNotice && <p role="status">{copyNotice}</p>}
    </div>}
  </div>;
}
