import type { CodexProgress, Snapshot } from '@autopets/contracts/types';
import './turn-progress.css';

// "Codex 작업 중 · 12분째 · 2/3단계": how long a connected chat's current request has been running.
// Only what the hooks observed — when the user's message arrived, which kind of tool ran last, and
// the plan when Codex published one. No estimate of what is left.
const TOOL_TEXT: Record<NonNullable<CodexProgress['lastTool']>, string> = {
  command: '명령 실행 중', edit: '파일 수정 중', read: '자료 보는 중', search: '검색 중',
  agent: '도우미와 작업 중', wait: '기다리는 중', plan: '계획 세우는 중', other: '도구 쓰는 중',
};
/** No word from the chat for this long: say so instead of looking busy. */
const QUIET_MS = 5 * 60_000;
/** Longer than this without a word: the turn end was probably missed (app restarted, hook failed). */
const GONE_MS = 60 * 60_000;

export interface TurnView {
  minutes: number; partial: boolean; startedAt: number;
  done: number; total: number; current: string | null;
  tool: string | null; quietMinutes: number | null;
  /** The line under the pet. */
  text: string;
}

/** The progress of the chat this pet shows: its linked chat, or (first pet) the `$autopets` chat without a pet. */
export function progressForSlot(snapshot: Snapshot, index: number): CodexProgress | undefined {
  const links = snapshot.petLinks ?? [];
  return (snapshot.codexProgress ?? []).find(item => {
    const link = links.find(candidate => candidate.target.threadId === item.target.threadId);
    return link ? link.slot === index : index === 0;
  });
}

export const duration = (minutes: number) => minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`;

export function turnView(progress: CodexProgress | undefined, now: number, afterMinutes: number): TurnView | null {
  if (!progress || progress.endedAt !== null) return null;
  const elapsed = now - progress.startedAt;
  const quiet = now - progress.lastActivityAt;
  if (elapsed < afterMinutes * 60_000 || quiet > GONE_MS) return null;
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  const done = progress.plan.filter(step => step.status === 'completed').length;
  const total = progress.plan.length;
  const current = progress.plan.find(step => step.status === 'in_progress')?.step ?? null;
  const tool = progress.lastTool ? TOOL_TEXT[progress.lastTool] : null;
  const quietMinutes = quiet >= QUIET_MS ? Math.floor(quiet / 60_000) : null;
  const clock = `${duration(minutes)}째${progress.partial ? '+' : ''}`;
  const detail = quietMinutes !== null ? `${duration(quietMinutes)}째 소식 없음` : total ? `${done}/${total}단계` : tool;
  return { minutes, partial: progress.partial, startedAt: progress.startedAt, done, total, current, tool, quietMinutes,
    text: `Codex 작업 중 · ${clock}${detail ? ` · ${detail}` : ''}` };
}

const clockTime = (at: number) => new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

/** The block at the top of the pet's card while the chat works: a bar for the plan, its steps, and the clock. */
export function TurnProgressCard({ view }: { view: TurnView }) {
  return <section className="turn-progress-card" aria-label="Codex 진행 상황" data-agent-id="pet-progress.card">
    <div className="turn-progress-head"><strong>Codex 작업 중</strong><span>{duration(view.minutes)}째{view.partial ? '+' : ''}</span></div>
    {view.total > 0 && <div className="turn-progress-bar" role="progressbar" aria-label="계획 진행" aria-valuemin={0} aria-valuemax={view.total} aria-valuenow={view.done}><i style={{ width: `${Math.round(view.done / view.total * 100)}%` }} /></div>}
    {view.total > 0 && <p className="turn-progress-step">{view.done}/{view.total}단계{view.current ? ` · ${view.current}` : ''}</p>}
    <p className="turn-progress-meta">{view.quietMinutes !== null ? `${duration(view.quietMinutes)} 전부터 소식이 없어요` : view.tool ?? '진행 중'} · 시작 {view.partial ? '약 ' : ''}{clockTime(view.startedAt)}</p>
  </section>;
}
