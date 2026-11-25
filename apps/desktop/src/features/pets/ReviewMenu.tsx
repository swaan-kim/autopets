import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { PetLink, ReviewSummary } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';
import { sendFailure, type Delivery } from './codexDelivery';
import { RESTING_HINT } from './ExplicitPet';
import './review.css';

// 복습 도우미 (review-helper). A press sends a fixed request into the pet's own linked Codex chat
// (`send_review_request`; typed into its input box instead when it cannot be sent). Quizzes,
// explanations, grading and reviews all happen in that chat, never on the pet. Showing a menu or
// a bubble never sends anything.
export type ReviewKind = 'quiz' | 'explain' | 'review';
export const isReviewPet = (link: PetLink | undefined) => link?.template.id === 'review-helper';
export const NO_REVIEW: ReviewSummary = { due: 0, total: 0, batches: 0, notifiedToday: true };
export const LOST_TEXT = '연결이 끊겼어요. “다시 연결”을 눌러 주세요.';

function failure(cause: unknown) {
  const text = String(cause);
  if (text.includes('pet-not-connected')) return LOST_TEXT;
  if (text.includes('pet-run-active-or-unresolved')) return '지금 작업을 먼저 확인해 주세요.';
  if (text.includes('no-review-due')) return '오늘 복습할 문제가 없어요.';
  if (text.includes('pet-revision-changed')) return '설정이 바뀌었어요. 다시 눌러 주세요.';
  return sendFailure(cause) ?? '보내지 못했어요.';
}

/** Sends into the pet's own chat (`send_review_request`), once per press. A disconnected pet never sends. */
export function useReviewSend(link: PetLink, lost: boolean, onSent: (delivery: Delivery) => void, resting = false) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const fill = async (kind: ReviewKind) => {
    if (pending.current) return;
    if (resting) { setError(RESTING_HINT); return; }
    if (lost) { setError(LOST_TEXT); return; }
    pending.current = true; setBusy(true); setError('');
    try {
      if (isDesktop) onSent(await command<Delivery>('send_review_request', { kind, expectedRevision: link.revision }));
    } catch (cause) { setError(failure(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  return { busy, error, fill };
}

const icons: Record<ReviewKind | 'saved', ReactNode> = {
  review: <><path d="M4 12a8 8 0 0 1 13.7-5.6L20 9" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15" /><path d="M4 20v-5h5" /></>,
  quiz: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4" /><path d="M12 16.8v.2" /></>,
  explain: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3Z" /></>,
  saved: <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M9 8.5h6M9 12h6M9 15.5h3.5" /></>,
};
const Icon = ({ name }: { name: keyof typeof icons }) => <svg className="pet-review-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{icons[name]}</svg>;

/** The menu at the top of the 복습 도우미 popup: 복습하기 N first when cards are due, then 문제 내기,
 *  쉽게 설명 and 문제 묶음 N (opens the app's 문제 묶음 page). */
export function ReviewMenu({ link, review, lost, resting = false, onSent }: { link: PetLink; review: ReviewSummary; lost: boolean; resting?: boolean; onSent: (delivery: Delivery) => void }) {
  const { busy, error, fill } = useReviewSend(link, lost, onSent, resting);
  const item = (kind: ReviewKind | 'saved', label: string, onClick: () => void, primary = false, disabled = false) =>
    <button key={kind} type="button" className={`pet-review-item${primary ? ' primary' : ''}`} data-agent-id={`task-card.review-${kind}`}
      aria-label={label} disabled={busy || disabled} onClick={onClick}><Icon name={kind} /><span>{label}</span></button>;
  return <div className="pet-review-menu" role="group" aria-label="복습 도우미" data-agent-id="task-card.review-menu">
    <div className="pet-review-items">
      {review.due > 0 && item('review', `복습하기 ${review.due}`, () => void fill('review'), true)}
      {item('quiz', '문제 내기', () => void fill('quiz'), review.due === 0)}
      {item('explain', '쉽게 설명', () => void fill('explain'))}
      {item('saved', `문제 묶음 ${review.batches ?? 0}`, () => void command('show_manager', { section: 'review' }).catch(() => undefined), false, !review.batches)}
    </div>
    {error && <p className="pet-review-error" role="alert">{error}</p>}
  </div>;
}

/** Closes on Esc, a press outside the panel (the empty part of the pet window counts), or when the
 *  pet window loses focus; an untouched panel also closes by itself after a while. */
function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void, idleMs: number) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close.current(); };
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) close.current(); };
    const blur = () => close.current();
    const timer = setTimeout(() => close.current(), idleMs);
    document.addEventListener('keydown', key); document.addEventListener('pointerdown', outside); window.addEventListener('blur', blur);
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    return () => { clearTimeout(timer); document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur); };
  }, [ref, idleMs]);
}

/** Dropped on a Codex window: 문제 내기 / 쉽게 설명 next to the pet, and the chat they go to. The drop
 *  itself sends nothing. A disconnected pet shows the existing reconnect guide instead. */
export function ReviewDropMenu({ link, chat, lost, resting = false, onSent, onReconnect, onClose }: { link: PetLink; chat: string; lost: boolean; resting?: boolean; onSent: (delivery: Delivery) => void; onReconnect: () => void; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const { busy, error, fill } = useReviewSend(link, lost, onSent);
  useDismiss(ref, onClose, 15000);
  return <section ref={ref} className="pet-review-bubble" data-agent-id="task-card.review-drop" aria-label="복습 도우미 메뉴">
    {lost || resting
      ? <><p className="pet-review-guide">{resting ? RESTING_HINT : '“다시 연결”을 누르면 채팅을 열고 다시 이어요.'}</p>
        <button type="button" className="pet-review-pill primary" data-agent-id="task-card.review-reconnect" onClick={() => { onReconnect(); onClose(); }}>{resting ? '채팅 열기' : '다시 연결'}</button></>
      : <><p className="pet-review-to" data-agent-id="task-card.review-drop-chat">→ 「{chat}」</p><div className="pet-review-pills">
        <button type="button" className="pet-review-pill primary" data-agent-id="task-card.review-drop-quiz" disabled={busy} onClick={() => void fill('quiz')}>문제 내기</button>
        <button type="button" className="pet-review-pill" data-agent-id="task-card.review-drop-explain" disabled={busy} onClick={() => void fill('explain')}>쉽게 설명</button>
      </div></>}
    {error && <p className="pet-review-error" role="alert">{error}</p>}
  </section>;
}

/** Once a day: "복습할 때예요" with a start button that sends "복습 문제 내줘" to the chat it names.
 *  The bubble itself sends nothing. */
export function ReviewDueBubble({ link, chat, due, lost, onSent, onClose }: { link: PetLink; chat: string; due: number; lost: boolean; onSent: (delivery: Delivery) => void; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const { busy, error, fill } = useReviewSend(link, lost, onSent);
  useDismiss(ref, onClose, 60000);
  return <section ref={ref} className="pet-review-bubble due" data-agent-id="task-card.review-due" role="status" aria-label={`복습할 때예요 · ${due}개`}>
    <p className="pet-review-headline"><strong>복습할 때예요</strong><span>{due}개</span></p>
    <p className="pet-review-to" data-agent-id="task-card.review-due-chat">→ 「{chat}」</p>
    <div className="pet-review-pills">
      <button type="button" className="pet-review-pill primary" data-agent-id="task-card.review-due-start" disabled={busy} onClick={() => void fill('review')}>시작</button>
      <button type="button" className="pet-review-pill" data-agent-id="task-card.review-due-later" onClick={onClose}>나중에</button>
    </div>
    {error && <p className="pet-review-error" role="alert">{error}</p>}
  </section>;
}
