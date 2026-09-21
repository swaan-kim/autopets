import type { TaskContext } from '../../assistance-types';

const fields = [['goal', '목표'], ['outputFormat', '결과 형식'], ['constraints', '중요한 조건'], ['decisions', '확정한 결정'], ['remaining', '남은 일']] as const;
function content(value: string | string[]) { return Array.isArray(value) ? value.join('\n') : value; }
export function ContextChanges({ previous, current, summary }: { previous: TaskContext | null; current: TaskContext; summary: string }) {
  if (!previous) return null;
  const changes = fields.filter(([field]) => content(previous[field]) !== content(current[field]));
  if (!changes.length) return null;
  return <details className="context-changes"><summary>최근 바뀐 내용</summary>{summary && <p className="small-note">{summary}</p>}<div className="context-change-list">{changes.map(([field, label]) => <section key={field}><h4>{label}</h4><dl><dt>이전</dt><dd className="context-before">{content(previous[field]) || '없음'}</dd><dt>현재</dt><dd className="context-after">{content(current[field]) || '없음'}</dd></dl></section>)}</div></details>;
}
