import { useEffect, useRef, useState } from 'react';
import type { PetLink } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';
import { FILLED_TEXT, LOST_TEXT, isReviewPet } from './ReviewMenu';
import './review.css';

// 복습 도우미 "문제 묶음" pages in the app: the batches (one per 문제 내기) and one batch's questions.
// Quizzes, grading and reviews stay in the Codex chat: these pages only fill a 복습 도우미 chat's
// composer ("Codex에서 복습 N", "전체 다시 풀기"); the user presses send. A batch is shown as a whole
// (what it is about, how many, the last score); its questions are not listed.
export interface ReviewBatchView { id: string; name: string; threadId: string; createdAt: number; topics: string[]; count: number; correct: number; due: number; nextReviewDays: number }

const when = (days: number) => days <= 0 ? '오늘' : days === 1 ? '내일' : `${days}일 뒤`;

const reviewWhen = (batch: ReviewBatchView) => batch.due > 0 ? `오늘 ${batch.due}` : when(batch.nextReviewDays);
const madeOn = (ms: number) => { const at = new Date(ms); return `${at.getMonth() + 1}월 ${at.getDate()}일`; };
const score = (batch: ReviewBatchView) => `지난번 ${batch.correct}/${batch.count}`;

/** The 복습 도우미 whose chat a batch page fills: the one in the batch's chat first, then the lowest
 *  slot (the app checks again and fills only a connected one). */
const reviewLinkFor = (links: PetLink[], threadId: string) => links.filter(isReviewPet)
  .sort((a, b) => Number(b.connected) - Number(a.connected) || Number(b.target.threadId === threadId) - Number(a.target.threadId === threadId) || a.slot - b.slot)[0];

function useHeading(key: string) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { window.scrollTo(0, 0); heading.current?.focus({ preventScroll: true }); }, [key]);
  return heading;
}

/** `batchId` null: the 문제 묶음 list. Otherwise that batch's page. `revision` changes when the
 *  app's review counts change, so both pages reload. */
export function ReviewBatches({ batchId, revision, links, onOpen, onBack }: { batchId: string | null; revision: string; links: PetLink[]; onOpen: (batchId: string | null) => void; onBack: () => void }) {
  return batchId
    ? <ReviewBatchDetail key={batchId} id={batchId} revision={revision} links={links} onBack={() => onOpen(null)} />
    : <ReviewBatchList revision={revision} onOpen={onOpen} onBack={onBack} />;
}

function ReviewBatchList({ revision, onOpen, onBack }: { revision: string; onOpen: (batchId: string) => void; onBack: () => void }) {
  const heading = useHeading('list');
  const [batches, setBatches] = useState<ReviewBatchView[] | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    let current = true;
    void (isDesktop ? command<ReviewBatchView[]>('review_batches') : Promise.resolve([]))
      .then(list => { if (current) { setBatches(list); setError(''); } })
      .catch(() => { if (current) setError('문제 묶음을 불러오지 못했어요.'); });
    return () => { current = false; };
  }, [revision]);
  const remove = async (id: string) => {
    if (busy) return;
    setBusy(id); setError('');
    try { await command('delete_review_batch', { id }); setBatches(list => list?.filter(batch => batch.id !== id) ?? null); setConfirm(''); }
    catch { setError('지우지 못했어요. 다시 시도해 주세요.'); }
    finally { setBusy(''); }
  };
  return <section className="review-page" data-agent-scope="task-card" data-agent-id="task-card.review-batches" aria-label="문제 묶음">
    <button type="button" className="text-button workspace-detail-back" data-agent-id="task-card.review-batches.back" onClick={onBack}>← 복습 도우미</button>
    <h1 ref={heading} tabIndex={-1}>문제 묶음{batches ? ` ${batches.length}` : ''}</h1>
    {error && <p className="error" role="alert">{error}</p>}
    {!batches ? !error && <p className="review-cards-empty">불러오는 중…</p>
      : batches.length === 0 ? <p className="review-cards-empty">문제 묶음이 없어요. Codex 채팅에서 복습 도우미로 문제를 풀면 여기에 모여요.</p>
      : <ul className="review-cards review-batch-list">
        {batches.map(batch => <li key={batch.id} className="review-card review-batch" data-agent-item={batch.id}>
          {confirm === batch.id
            ? <div className="review-batch-confirm" role="alert">
              <p>“{batch.name}”과 문제 {batch.count}개를 지울까요?</p>
              <div><button type="button" className="text-button danger-text" disabled={busy === batch.id} onClick={() => void remove(batch.id)}>지우기</button>
                <button type="button" className="text-button" disabled={busy === batch.id} onClick={() => setConfirm('')}>취소</button></div>
            </div>
            : <>
              <button type="button" className="review-card-text review-batch-open" aria-label={`${batch.name} 열기`} onClick={() => onOpen(batch.id)}>
                <span className="review-card-question">{batch.name}</span>
                <span className="review-card-answer">{batch.count}문제 · {madeOn(batch.createdAt)} · {score(batch)}</span>
              </button>
              <div className="review-card-side">
                <span className={`review-card-when${batch.due > 0 ? ' today' : ''}`}>{reviewWhen(batch)}</span>
                <button type="button" className="text-button" aria-label={`묶음 삭제: ${batch.name}`} onClick={() => setConfirm(batch.id)}>삭제</button>
              </div>
            </>}
        </li>)}
      </ul>}
  </section>;
}

function failure(cause: unknown) {
  const text = String(cause);
  if (text.includes('pet-not-connected')) return 'lost';
  if (text.includes('no-review-pet')) return '복습 도우미가 연결된 채팅이 없어요. Codex 채팅에서 $autopets로 불러 주세요.';
  if (text.includes('no-review-due')) return '오늘 복습할 문제가 없어요.';
  return '채팅을 열지 못했어요.';
}

function ReviewBatchDetail({ id, revision, links, onBack }: { id: string; revision: string; links: PetLink[]; onBack: () => void }) {
  const heading = useHeading(id);
  const [page, setPage] = useState<ReviewBatchView | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try { setPage(await command<ReviewBatchView>('review_batch', { id })); setError(''); }
    catch (cause) { if (String(cause).includes('review-batch-not-found')) onBack(); else setError('문제를 불러오지 못했어요.'); }
  };
  useEffect(() => { void load(); }, [id, revision]);
  const fill = async (kind: 'due' | 'all') => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await command('fill_review_batch', { batchId: id, kind }); setNotice(`Codex 입력칸에 넣었어요. ${FILLED_TEXT}.`); }
    catch (cause) { setError(failure(cause)); }
    finally { setBusy(false); }
  };
  const reconnect = page ? reviewLinkFor(links, page.threadId) : undefined;
  if (!page) return <section className="review-page" data-agent-id="task-card.review-batch" aria-label="문제 묶음">
    <button type="button" className="text-button workspace-detail-back" data-agent-id="task-card.review-batch.back" onClick={onBack}>← 문제 묶음</button>
    {error ? <p className="error" role="alert">{error}</p> : <p className="review-cards-empty">불러오는 중…</p>}
  </section>;
  return <section className="review-page" data-agent-scope="task-card" data-agent-id="task-card.review-batch" data-batch={page.id} aria-label={page.name}>
    <button type="button" className="text-button workspace-detail-back" data-agent-id="task-card.review-batch.back" onClick={onBack}>← 문제 묶음</button>
    <h1 ref={heading} tabIndex={-1}>{page.name}</h1>
    <p className="review-page-meta">{page.count}문제 · {madeOn(page.createdAt)} · {score(page)} · {reviewWhen(page)}</p>
    {page.topics.length > 0 && <ul className="review-topics" aria-label="다루는 내용">{page.topics.map(topic => <li key={topic}>{topic}</li>)}</ul>}
    <div className="review-batch-actions">
      {page.due > 0 && <button type="button" className="button primary" data-agent-id="task-card.review-batch.due" disabled={busy} onClick={() => void fill('due')}>Codex에서 복습 {page.due}</button>}
      <button type="button" className={`button ${page.due > 0 ? 'secondary' : 'primary'}`} data-agent-id="task-card.review-batch.all" disabled={busy} onClick={() => void fill('all')}>전체 다시 풀기</button>
    </div>
    {notice && <p className="review-page-notice" role="status">{notice}</p>}
    {error === 'lost'
      ? <div className="composer-feedback" role="alert"><p>{LOST_TEXT}</p>
        {reconnect && <button type="button" className="text-button" data-agent-id="task-card.review-batch.reconnect" onClick={() => void command('open_pet_task', { target: reconnect.target, expectedRevision: reconnect.revision }).catch(() => setError('채팅을 열지 못했어요.'))}>다시 연결</button>}</div>
      : error && <p className="error" role="alert">{error}</p>}
  </section>;
}
