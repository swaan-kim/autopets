import type { AssistanceSnapshot, AssistanceTask } from '@autopets/contracts/types';
import type { AssistanceAction } from '../../bridge/actionTypes';
import { identityKey } from './identity';
import { assistanceLabel } from './presentation';
import { ContextEditor } from '../context/ContextEditor';
import { WORK_STYLES as styles } from '../settings/workStyles';

export function CurrentTaskPanel({ snapshot, sessions, selected, selectedTask, disabled, hidden, setSelected, setNotice, run }: {
  snapshot: AssistanceSnapshot; sessions: { id: string; label: string }[]; selected: string; selectedTask: AssistanceTask | undefined;
  disabled: boolean; hidden: boolean; setSelected: (value: string) => void; setNotice: (value: string) => void; run: AssistanceAction;
}) {
  const label = (task: AssistanceTask) => {
    const uniqueNativeMatch = task.identity.provider === 'codex' && snapshot.tasks.filter(other => other.identity.provider === 'codex' && other.identity.chatId === task.identity.chatId).length === 1;
    return (uniqueNativeMatch && sessions.find(session => session.id === task.identity.chatId)?.label) || task.context.goal || task.identity.chatId;
  };
  return <section id="assistance-panel-current" role="tabpanel" aria-labelledby="assistance-tab-current" className="assistance-card" hidden={hidden}>
      <h2>현재 채팅의 도움</h2>
      {snapshot.tasks.length ? <><label className="field-label" htmlFor="assistance-task">채팅 선택</label><select id="assistance-task" className="text-input" value={selected} onChange={event => { setSelected(event.target.value); setNotice(''); }}><option value="">채팅을 선택하세요</option>{snapshot.tasks.map(task => <option key={identityKey(task.identity)} value={identityKey(task.identity)}>{task.identity.provider === 'codex' ? 'Codex' : 'ChatGPT'} · {label(task)} · {task.identity.accountId}</option>)}</select>
        {selectedTask && <div className="chat-assistance" key={identityKey(selectedTask.identity)}>
          <div className="chat-assistance-status"><span className={`status-badge ${selectedTask.assistance.status}`} data-testid="assistance-state">{assistanceLabel(selectedTask, snapshot.preferences.enabled)}</span><button className="text-button" disabled={disabled} onClick={() => void run('set_chat_assistance', { identity: selectedTask.identity, enabled: !selectedTask.enabled }, selectedTask.enabled ? '이번 채팅의 자동 도움을 껐어요. 기록은 남아 있어요.' : '이번 채팅의 자동 도움을 켰어요. 전달 상태를 확인해주세요.')}>{selectedTask.enabled ? '이번 채팅 도움 끄기' : '이번 채팅 도움 켜기'}</button></div>
          <p className="current-help-copy">{selectedTask.assistance.reason || '아직 적용된 도움 내역이 없어요.'}</p>
          {selectedTask.context.goal && <p className="task-goal-summary"><span>목표</span>{selectedTask.context.goal}</p>}
          <label className="field-label" htmlFor="task-work-style">이번 채팅 작업 방식</label>
          <select id="task-work-style" className="text-input" value={selectedTask.workStyleOverride ?? ''} disabled={disabled || !snapshot.preferences.enabled || !selectedTask.enabled} onChange={event => void run('set_task_work_style', { identity: selectedTask.identity, workStyle: event.target.value || null, expectedRevision: selectedTask.settingsRevision }, '이번 채팅의 방식을 저장했어요. 다음 메시지부터 전달을 시도해요.')}><option value="">기본 설정 사용 · {styles.find(([value]) => value === snapshot.preferences.workStyle)?.[1]}</option>{styles.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
          <p className="small-note">이 채팅에만 적용해요. 다른 채팅의 방식은 그대로예요.</p>
          <details className="assistance-details applied-details"><summary>적용 내역</summary><dl className="return-details"><dt>요청한 모델</dt><dd>{selectedTask.assistance.requestedModel || '기존 설정 유지'}</dd><dt>실제 적용 모델</dt><dd data-testid="applied-model">{selectedTask.assistance.appliedModel || '확인되지 않음'}</dd><dt>결과 점검</dt><dd>{selectedTask.quality.status === 'unchecked' ? '아직 점검하지 않음' : selectedTask.quality.status === 'needs-review' ? '확인할 항목 있음' : '등록된 점검 기준 통과'}</dd></dl>{selectedTask.quality.findings.length > 0 && <ul className="quality-findings">{selectedTask.quality.findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul>}</details>
          <ContextEditor task={selectedTask} disabled={disabled}
            onSave={(context, expectedRevision) => run('save_task_context', { identity: selectedTask.identity, context, expectedRevision }, '이 채팅의 기록을 저장했어요. AI 전달은 아직 확인되지 않았어요.')}
            onDelete={() => run('delete_task_context', { identity: selectedTask.identity }, '이 채팅의 저장 기록을 삭제했어요.')}
            onUndo={() => run('undo_task_context', { identity: selectedTask.identity, expectedRevision: selectedTask.revision }, '바로 이전 기록으로 되돌렸어요. 다음 메시지부터 전달을 시도해요.')} />
        </div>}
      </> : <p className="unavailable-copy">연결된 채팅을 기다리고 있어요.<br /><span>연결되면 도움과 전달 상태를 확인할 수 있어요.</span></p>}
    </section>;
}
