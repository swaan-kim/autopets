import { useState, type ReactNode } from 'react';
import type { PetLink, Session } from '@autopets/contracts/types';
import './pet-bubble.css';

// What the floating pet says when the chat needs the user: a question or a plan to confirm,
// a finished job, or a problem. One short line that opens the chat with one click.
// It never takes focus and shows only what the app already knows; no AI call is made for it.
export type PetBubbleNotice = { key: string; tone: 'ask' | 'done' | 'error'; text: string; action: string };

/** Notice for a pet job started with the AutoPets skill (the default path). */
export function linkBubble(link: PetLink, disconnected: boolean): PetBubbleNotice | null {
  const run = link.run;
  if (disconnected || !link.connected || !run || run.trackingClosed) return null;
  const key = JSON.stringify(['link', link.target.threadId, run.id, run.state]);
  if (run.state === 'waiting') return { key, tone: 'ask', text: '계획을 확인해 주세요', action: '채팅 열기' };
  if (run.state === 'complete') return { key, tone: 'done', text: '다 됐어요!', action: '결과 보기' };
  if (run.state === 'failed' || run.state === 'unknown') return { key, tone: 'error', text: '문제가 생겼어요', action: '확인하기' };
  return null;
}

/** Notice for a chat observed through hooks: permission needed, finished and unread, or a tool error. */
export function sessionBubble(session: Session, attention: Session['attention'], disconnected: boolean): PetBubbleNotice | null {
  if (disconnected || session.connection !== 'observed') return null;
  const key = JSON.stringify(['session', session.id, session.turnStartedAt ?? 0, attention ? [attention.kind, attention.createdAt] : session.state]);
  if (attention?.kind === 'permission') return { key, tone: 'ask', text: '확인이 필요해요', action: '채팅 열기' };
  if (attention?.kind === 'tool-error' || session.state === 'failed') return { key, tone: 'error', text: '문제가 생겼어요', action: '확인하기' };
  if (session.state === 'done' && session.unread) return { key, tone: 'done', text: '다 됐어요!', action: '결과 보기' };
  return null;
}

const STORE = 'autopets.pet-bubbles-seen.v1';
const seen = (): string[] => { try { const value = JSON.parse(localStorage.getItem(STORE) ?? '[]'); return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []; } catch { return []; } };
const remember = (key: string) => { try { localStorage.setItem(STORE, JSON.stringify([...seen().filter(item => item !== key), key].slice(-64))); } catch { /* a full or blocked store only means the notice may show again */ } };

/**
 * The same notice is shown until the user opens or closes it once; a new state has a new key.
 * Without a notice to show, the usual small status (children) stays in its place.
 */
export function PetBubble({ notice, onOpen, children }: { notice: PetBubbleNotice | null; onOpen: () => void | Promise<void>; children: ReactNode }) {
  const [closed, setClosed] = useState('');
  if (!notice || closed === notice.key || seen().includes(notice.key)) return <>{children}</>;
  const done = () => { remember(notice.key); setClosed(notice.key); };
  return <span className="pet-bubble" data-tone={notice.tone} role="status">
    <button className="pet-bubble-open" onClick={() => { done(); void onOpen(); }}><strong>{notice.text}</strong><span>{notice.action} →</span></button>
    <button className="pet-bubble-close" aria-label="알림 닫기" onClick={done}>×</button>
  </span>;
}
