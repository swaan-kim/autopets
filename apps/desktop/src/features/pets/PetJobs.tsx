import { useState } from 'react';
import type { PetJob } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';
import './pet-jobs.css';

// Jobs an AI reported through the AutoPets MCP tool (`autopets_report`). The app only shows them:
// it knows which AI and what state, not which chat, so there is no "open the chat" here.
export const HOST_NAMES: Record<PetJob['host'], string> = { codex: 'Codex', claude: 'Claude', 'claude-code': 'Claude Code', other: 'AI 채팅' };
const STATE_LABELS: Record<PetJob['state'], string> = { asking: '답을 기다려요', working: '작업 중', done: '다 됐어요', failed: '문제가 생겼어요' };
/** A job that only said "working" long ago is no longer shown as active. */
export const JOB_ACTIVE_MS = 30 * 60 * 1000;
export const activeJob = (jobs: PetJob[], now: number) => jobs.find(job => job.state === 'working' && now - job.updatedAt < JOB_ACTIVE_MS);

/** How many places a person should look at before using the result: unfilled blanks and notes left on the page. */
export const reviewAttention = (job: PetJob) => job.state === 'done' && job.review ? job.review.blanks + job.review.notes : 0;
/** One line of what the pet found in the result file, or '' when it did not look. Counts only. */
export function reviewLine(job: PetJob): string {
  const review = job.state === 'done' ? job.review : null;
  if (!review) return '';
  const parts = [review.slides ? `${review.slides}장` : '', review.blanks ? `빈칸 ${review.blanks}곳` : '', review.notes ? `남은 안내 문구 ${review.notes}곳` : '', review.external ? `인터넷 필요 ${review.external}개` : ''].filter(Boolean);
  return review.blanks + review.notes + review.external ? parts.join(' · ') : [...parts, '빈칸 0곳'].join(' · ');
}

/** The list's word for a job. A job that only said "working" long ago has gone quiet, and a
 *  finished one says how many places still need a look. */
export function jobStateLabel(job: PetJob, now: number): string {
  if (job.state === 'working' && now - job.updatedAt >= JOB_ACTIVE_MS) return '소식이 끊겼어요';
  const look = reviewAttention(job);
  return look ? `다 됐어요 · 확인할 곳 ${look}곳` : STATE_LABELS[job.state];
}

/** Shows the folder the AI reported. The path itself is never opened or run. */
export async function openJobResult(job: PetJob): Promise<boolean> {
  if (!isDesktop || job.state !== 'done' || !job.resultPath) return false;
  try { await command('open_pet_job_result', { id: job.id }); return true; } catch { return false; }
}

export function PetJobList({ jobs, compact = false, now = Date.now() }: { jobs: PetJob[]; compact?: boolean; now?: number }) {
  const [failed, setFailed] = useState('');
  if (!jobs.length) return null;
  return <section className={`pet-jobs ${compact ? 'compact' : ''}`} aria-label="맡긴 일" data-agent-id="task-card.reported-jobs">
    <h2>맡긴 일</h2>
    <ul>{jobs.slice(0, compact ? 3 : 12).map(job => <li key={job.id} data-state={job.state}>
      <strong title={job.title}>{job.title}</strong>
      <span>{HOST_NAMES[job.host]} · {jobStateLabel(job, now)}</span>
      {reviewLine(job) && <small className="pet-job-review" data-attention={reviewAttention(job) > 0} title="펫이 결과 파일을 직접 읽어 확인했어요. 화면 넘침과 사실 여부는 확인하지 않아요.">펫이 센 것 · {reviewLine(job)} · 내용은 직접 봐 주세요</small>}
      {job.state === 'done' && job.resultPath && <button className="text-button" disabled={!isDesktop} onClick={() => { setFailed(''); void openJobResult(job).then(opened => { if (!opened) setFailed(job.id); }); }}>결과 폴더 열기 ↗</button>}
      {failed === job.id && <small role="alert">결과 폴더를 열지 못했어요. {HOST_NAMES[job.host]}에서 확인해 주세요.</small>}
    </li>)}</ul>
  </section>;
}
