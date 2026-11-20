import { useState, type ReactNode } from 'react';
import type { PetJob, Session } from '@autopets/contracts/types';
import { HOST_NAMES, reviewAttention } from './PetJobs';
import './pet-bubble.css';

// What the floating pet says when the chat needs the user: a question or a plan to confirm,
// a finished job, or a problem. One short line that opens the chat with one click.
// It never takes focus and shows only what the app already knows; no AI call is made for it.
export type PetBubbleNotice = { key: string; tone: 'ask' | 'done' | 'error'; text: string; action: string };
const DETAILS = '자세히';

/** Notice for a chat observed through hooks: permission needed, finished and unread, or a tool error. */
export function sessionBubble(session: Session, attention: Session['attention'], disconnected: boolean, canOpen = true): PetBubbleNotice | null {
  if (disconnected || session.connection !== 'observed') return null;
  const key = JSON.stringify(['session', session.id, session.turnStartedAt ?? 0, attention ? [attention.kind, attention.createdAt] : session.state]);
  // The button names Codex only when the click can ask Codex to show the chat; otherwise it opens the card.
  const action = canOpen ? 'Codex에서 보기 ↗' : DETAILS;
  if (attention?.kind === 'permission') return { key, tone: 'ask', text: 'Codex에서 답을 기다려요', action };
  if (attention?.kind === 'tool-error' || session.state === 'failed') return { key, tone: 'error', text: '문제가 생겼어요', action };
  if (session.state === 'done' && session.unread) return { key, tone: 'done', text: '다 됐어요', action };
  return null;
}

/** Notice for a job an AI reported through MCP. The app knows which AI, not which chat, so it names the AI. */
export function jobBubble(job: PetJob): PetBubbleNotice | null {
  const key = JSON.stringify(['job', job.id, job.state, job.updatedAt]);
  const where = HOST_NAMES[job.host];
  // The app cannot open that chat, so the button only opens the pet's card ("자세히").
  if (job.state === 'asking') return { key, tone: 'ask', text: `${where}에서 답을 기다려요`, action: DETAILS };
  // The pet looked at the result itself: say how many places still need the user before it is used.
  const look = reviewAttention(job);
  if (job.state === 'done') return { key, tone: 'done', text: look ? `다 됐어요 · 확인할 곳 ${look}곳` : '다 됐어요', action: job.resultPath ? '결과 폴더 열기 ↗' : DETAILS };
  if (job.state === 'failed') return { key, tone: 'error', text: `${where}에서 문제가 생겼어요`, action: DETAILS };
  return null;
}

const STORE = 'autopets.pet-bubbles-seen.v1';
const seen = (): string[] => { try { const value = JSON.parse(localStorage.getItem(STORE) ?? '[]'); return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []; } catch { return []; } };
const remember = (key: string) => { try { localStorage.setItem(STORE, JSON.stringify([...seen().filter(item => item !== key), key].slice(-64))); } catch { /* a full or blocked store only means the notice may show again */ } };

export const noticeSeen = (key: string) => seen().includes(key);

/**
 * The same notice is shown until the user opens or closes it once; a new state has a new key.
 * Without a notice to show, the usual small status (children) stays in its place.
 */
export function PetBubble({ notice, onOpen, children }: { notice: PetBubbleNotice | null; onOpen: () => void | Promise<void>; children: ReactNode }) {
  const [closed, setClosed] = useState('');
  if (!notice || closed === notice.key || seen().includes(notice.key)) return <>{children}</>;
  const done = () => { remember(notice.key); setClosed(notice.key); };
  return <span className="pet-bubble" data-tone={notice.tone} role="status">
    <button className="pet-bubble-open" onClick={() => { done(); void onOpen(); }}><strong>{notice.text}</strong><span>{notice.action}</span></button>
    <button className="pet-bubble-close" aria-label="알림 닫기" onClick={done}>×</button>
  </span>;
}
