import { useEffect, useRef, useState } from 'react';
import type { CodexAttention, Snapshot } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';
import './pet-attention.css';

/**
 * Codex attention notices on the dog pet: a small bubble and mark, never a window of its own.
 * A notice belongs to the pet linked to its chat; the `$autopets` chat that has no pet yet uses
 * the first pet (like recommendations).
 */
export function attentionForSlot(snapshot: Snapshot, index: number): CodexAttention[] {
  const links = snapshot.petLinks ?? [];
  return (snapshot.codexAttention ?? []).filter(item => {
    const link = links.find(candidate => candidate.target.threadId === item.target.threadId);
    return link ? link.slot === index : index === 0;
  });
}

export const isAsk = (item: CodexAttention) => item.kind === 'action_required';
export function attentionHeadline(item: CodexAttention): string {
  if (isAsk(item)) return 'Codex에서 확인이 필요해!';
  return item.evidence?.verified === false ? 'Codex 답변이 끝났어' : 'Codex 작업이 완료됐어!';
}
/** The short line under the pet. A read ask is still waiting in Codex. */
export function attentionStatus(item: CodexAttention): string {
  if (isAsk(item)) return item.read ? 'Codex가 답을 기다리는 중' : 'Codex 확인 필요';
  return item.evidence?.verified === false ? 'Codex 답변 끝남' : 'Codex 작업 완료';
}
/** A notice the pet still marks: every unanswered ask, and finished work the user has not seen. */
export const markedAttention = (items: CodexAttention[]) => items.find(item => isAsk(item) || !item.read);
const chatLabel = (item: CodexAttention) => item.chatTitle ?? `채팅 · ${item.target.threadId.slice(-8)}`;

export function AttentionMark({ item }: { item: CodexAttention }) {
  return <span className={`pet-codex-mark ${isAsk(item) ? 'ask' : 'done'}${item.read ? ' read' : ''}`} aria-hidden="true">{isAsk(item) ? '?' : '✓'}</span>;
}

/**
 * The bubble: what Codex needs (or finished), in one or two sentences, and a way back to that chat.
 * "Codex에서 확인하기" only asks Windows to show the chat; the notice stays until Codex reports
 * that the question was answered (a new message, the approved tool, the answered choice).
 */
export function AttentionBubble({ item, more = 0, card = false, onDone }: { item: CodexAttention; more?: number; card?: boolean; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { setNote(''); clearTimeout(timer.current); }, [item.id]);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isDesktop) await command('open_codex_attention', { id: item.id });
      // The deep link reached Windows; whether Codex showed this exact chat cannot be checked from here.
      setNote(`Codex에 이 채팅을 열어 달라고 요청했어. 다른 채팅이 보이면 ‘${chatLabel(item)}’을 찾아 줘.`);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => onDone?.(), 6000);
    } catch (cause) {
      setNote(String(cause).includes('attention-not-found') ? '이미 해결된 알림이야.' : `Codex를 열지 못했어. Codex에서 ‘${chatLabel(item)}’ 채팅을 직접 열어 줘.`);
    } finally { setBusy(false); }
  };
  const close = async () => {
    try { if (isDesktop && !item.read) await command('dismiss_codex_attention', { id: item.id }); } catch { /* the notice may be resolved already */ }
    onDone?.();
  };
  const files = item.evidence?.fileChanges ?? 0;
  return <section className={`pet-codex-bubble ${isAsk(item) ? 'ask' : 'done'}${card ? ' card' : ''}`} data-agent-id="pet-codex-attention.bubble"
    role="status" aria-live="polite" aria-label={`${attentionHeadline(item)} ${chatLabel(item)}`}>
    <header><span>AutoPets</span><small title={item.chatTitle ?? item.target.threadId}>{chatLabel(item)}</small></header>
    <strong className="pet-codex-headline"><AttentionMark item={item} />{attentionHeadline(item)}</strong>
    <p className="pet-codex-summary" title={item.summary}>{item.summary}</p>
    {item.kind === 'completed' && (item.evidence?.verified === false
      ? <p className="pet-codex-note">작업 결과는 확인하지 못했어. Codex에서 직접 봐 줘.</p>
      : <p className="pet-codex-note">요청한 작업이 끝났어. 결과를 확인해 봐!{files > 0 ? ` · 파일 ${files}개 변경` : ''}</p>)}
    {item.read && isAsk(item) && !note && <p className="pet-codex-note">아직 Codex에서 답을 기다리고 있어.</p>}
    {note && <p className="pet-codex-note" role="status">{note}</p>}
    <div className="pet-codex-actions">
      <button type="button" className="button primary" disabled={busy} onClick={() => void open()}>{isAsk(item) ? 'Codex에서 확인하기' : 'Codex에서 결과 확인'}</button>
      <button type="button" className="text-button" onClick={() => void close()}>{card ? '알림 닫기' : '닫기'}</button>
    </div>
    {more > 0 && <p className="pet-codex-more">다른 알림 {more}개</p>}
  </section>;
}
