import { useState } from 'react';
import type { PetJob } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';
import './pet-jobs.css';

// Jobs an AI reported through the AutoPets MCP tool (`autopets_report`). The app only shows them:
// it knows which AI and what state, not which chat, so there is no "open the chat" here.
export const HOST_NAMES: Record<PetJob['host'], string> = { codex: 'Codex', claude: 'Claude', 'claude-code': 'Claude Code', other: 'AI 채팅' };
const STATE_LABELS: Record<PetJob['state'], string> = { asking: '질문에 답해 주세요', working: '작업 중', done: '완료', failed: '확인 필요' };
/** A job that only said "working" long ago is no longer shown as active. */
export const JOB_ACTIVE_MS = 30 * 60 * 1000;
export const activeJob = (jobs: PetJob[], now: number) => jobs.find(job => job.state === 'working' && now - job.updatedAt < JOB_ACTIVE_MS);

/** Shows the folder the AI reported. The path itself is never opened or run. */
export async function openJobResult(job: PetJob): Promise<boolean> {
  if (!isDesktop || job.state !== 'done' || !job.resultPath) return false;
  try { await command('open_pet_job_result', { id: job.id }); return true; } catch { return false; }
}

export function PetJobList({ jobs, compact = false }: { jobs: PetJob[]; compact?: boolean }) {
  const [failed, setFailed] = useState('');
  if (!jobs.length) return null;
  return <section className={`pet-jobs ${compact ? 'compact' : ''}`} aria-label="AI가 알려준 일" data-agent-id="task-card.reported-jobs">
    <h2>AI가 알려준 일</h2>
    <ul>{jobs.slice(0, compact ? 3 : 12).map(job => <li key={job.id} data-state={job.state}>
      <strong title={job.title}>{job.title}</strong>
      <span>{HOST_NAMES[job.host]} · {STATE_LABELS[job.state]}</span>
      {job.state === 'done' && job.resultPath && <button className="text-button" disabled={!isDesktop} onClick={() => { setFailed(''); void openJobResult(job).then(opened => { if (!opened) setFailed(job.id); }); }}>결과 열기 →</button>}
      {failed === job.id && <small role="alert">결과 폴더를 열지 못했어요. {HOST_NAMES[job.host]}에서 확인해 주세요.</small>}
    </li>)}</ul>
  </section>;
}
