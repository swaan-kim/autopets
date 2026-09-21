import { useEffect, useState } from 'react';
import type { AssistanceTask, TaskContext } from '@autopets/contracts/types';
import { cleanContext, contextError } from './contextValidation';
import { ContextChanges } from './ContextChanges';

export function ContextEditor({ task, disabled, onSave, onDelete, onUndo }: { task: AssistanceTask; disabled: boolean; onSave: (context: TaskContext, revision: number) => Promise<boolean>; onDelete: () => Promise<boolean>; onUndo: () => Promise<boolean> }) {
  const [context, setContext] = useState<TaskContext>(task.context);
  const [revision, setRevision] = useState(task.revision);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) { setContext(task.context); setRevision(task.revision); } }, [task.revision, task.context, dirty]);
  const update = (next: TaskContext) => { setContext(next); setDirty(true); };
  const validation = contextError(cleanContext(context));
  return <details className="assistance-details context-editor"><summary>이 채팅에 저장한 조건</summary>
    <p className="small-note">저장된 기록이에요. AI에 전달됐는지는 위 상태에서 확인해요.</p>
    <ContextChanges previous={task.previousContext ?? null} current={task.context} summary={task.changeSummary || ''} />
    {task.previousContext && <div className="context-undo"><button className="text-button" disabled={disabled || dirty} onClick={async () => { if (await onUndo()) setDirty(false); }}>한 단계 되돌리기</button>{dirty && <span className="small-note">편집 중인 내용을 먼저 저장하거나 다시 불러오세요.</span>}</div>}
    <form onSubmit={async event => { event.preventDefault(); if (!validation && await onSave(cleanContext(context), revision)) setDirty(false); }}>
      <label>목표<input className="text-input" maxLength={1200} value={context.goal} disabled={disabled} onChange={event => update({ ...context, goal: event.target.value })} /></label>
      <label>결과 형식<input className="text-input" maxLength={400} value={context.outputFormat} disabled={disabled} onChange={event => update({ ...context, outputFormat: event.target.value })} /></label>
      {([['constraints', '중요한 조건'], ['decisions', '확정한 결정'], ['remaining', '남은 일']] as const).map(([field, label]) => <label key={field}>{label}<textarea aria-label={label} className="text-input" rows={2} maxLength={4000} disabled={disabled} value={context[field].join('\n')} onChange={event => update({ ...context, [field]: event.target.value.split('\n') })} /></label>)}
      {dirty && revision !== task.revision && <p className="error" role="alert">기록이 갱신됐어요. 아래 버튼으로 최신 기록을 불러온 뒤 다시 수정해주세요.</p>}
      {dirty && validation && <p className="error" role="alert">{validation}</p>}
      <div className="action-row"><button className="button secondary" type="button" disabled={disabled} onClick={() => { setContext(task.context); setRevision(task.revision); setDirty(false); }}>최신 기록 불러오기</button><button className="button primary" disabled={disabled || !dirty || revision !== task.revision || !!validation}>기록 저장</button></div>
    </form>
    <button className="text-button danger-text" disabled={disabled} onClick={() => setConfirmDelete(!confirmDelete)}>이 채팅 기록 삭제</button>
    {confirmDelete && <div className="delete-confirm"><p>이 채팅의 AutoPets 기록을 지울까요?</p><button className="button secondary" disabled={disabled} onClick={() => setConfirmDelete(false)}>취소</button><button className="button danger-button" disabled={disabled} onClick={async () => { if (await onDelete()) { setDirty(false); setConfirmDelete(false); } }}>삭제 확인</button></div>}
  </details>;
}
