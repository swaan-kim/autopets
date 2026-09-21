import React, { useEffect, useRef, useState } from 'react';
import { command, isDesktop } from './api';
import { EMPTY_ASSISTANCE, identityKey, type AssistanceSnapshot, type AssistanceTask, type TaskContext, type UserPreferences } from './assistance-types';
import { ContextChanges } from './features/context/ContextChanges';

export function useAssistance() {
  const [snapshot, setSnapshot] = useState<AssistanceSnapshot>(EMPTY_ASSISTANCE);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const active = useRef(false);
  const alive = useRef(true);
  const refresh = async () => {
    if (active.current) return;
    active.current = true;
    try { const next = await command<AssistanceSnapshot>('get_assistance'); if (alive.current) { setSnapshot(next); setError(''); setLoaded(true); } }
    catch (cause) { if (alive.current) setError(String(cause)); }
    finally { active.current = false; }
  };
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => { alive.current = false; clearInterval(timer); };
  }, []);
  return { snapshot, error, loaded, refresh };
}

const stateLabels = {
  off: '자동 도움 꺼짐', pending: '다음 메시지 전달 대기', prepared: '전달할 지침 준비됨',
  sent: '지침 전송됨 · 적용 확인 대기', confirmed: '지침 적용 확인됨', unavailable: '자동 연결 확인 필요',
};
export function assistanceLabel(task: AssistanceTask, enabled = true) {
  return !enabled || !task.enabled ? stateLabels.off : stateLabels[task.assistance.status];
}
const splitLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
const cleanContext = (context: TaskContext): TaskContext => ({ ...context, constraints: splitLines(context.constraints.join('\n')), decisions: splitLines(context.decisions.join('\n')), remaining: splitLines(context.remaining.join('\n')) });
function contextError(context: TaskContext) {
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  if (bytes(context.goal) > 1024) return '목표가 너무 길어요. 핵심만 남겨주세요.';
  if (bytes(context.outputFormat) > 512) return '결과 형식을 조금 더 짧게 적어주세요.';
  for (const [field, label] of [['constraints', '중요한 조건'], ['decisions', '확정한 결정'], ['remaining', '남은 일']] as const) {
    if (context[field].length > 12) return `${label}은 12개까지 저장할 수 있어요.`;
    if (context[field].some(item => bytes(item) > 512)) return `${label}의 한 항목이 너무 길어요. 짧게 나눠주세요.`;
  }
  if (bytes(JSON.stringify(context)) > 3072) return '저장할 기록이 너무 많아요. 현재 작업에 필요한 내용만 남겨주세요.';
  return '';
}

function ContextEditor({ task, disabled, onSave, onDelete, onUndo }: { task: AssistanceTask; disabled: boolean; onSave: (context: TaskContext, revision: number) => Promise<boolean>; onDelete: () => Promise<boolean>; onUndo: () => Promise<boolean> }) {
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

export function AssistancePanel({ snapshot, sessions, initialSessionId, error, loaded, refresh }: { snapshot: AssistanceSnapshot; sessions: { id: string; label: string }[]; initialSessionId?: string | null; error: string; loaded: boolean; refresh: () => Promise<void> }) {
  const [draft, setDraft] = useState<UserPreferences>(snapshot.preferences);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState<'current' | 'defaults' | 'connection'>(initialSessionId ? 'current' : 'defaults');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const working = useRef(false);
  const initialSelection = useRef<{ sessionId: string | null | undefined; applied: boolean }>({ sessionId: undefined, applied: false });
  useEffect(() => { if (!dirty) setDraft(snapshot.preferences); }, [snapshot.preferences, dirty]);
  useEffect(() => {
    if (initialSelection.current.sessionId !== initialSessionId) {
      initialSelection.current = { sessionId: initialSessionId, applied: false };
      setSelected('');
      if (initialSessionId) setTab('current');
    }
    if (initialSelection.current.applied || !initialSessionId || !loaded) return;
    const matches = snapshot.tasks.filter(task => task.identity.provider === 'codex' && task.identity.chatId === initialSessionId);
    setSelected(matches.length === 1 ? identityKey(matches[0].identity) : '');
    initialSelection.current.applied = true;
  }, [initialSessionId, loaded, snapshot.tasks]);
  const selectedTask = snapshot.tasks.find(task => identityKey(task.identity) === selected);
  const panelOrder = ['current', 'defaults', 'connection'] as const;
  const disabled = !isDesktop || !loaded || !!error || busy;
  const update = (next: UserPreferences) => { setDraft(next); setDirty(true); setNotice(''); };
  const run = async (name: string, args: Record<string, unknown>, message: string) => {
    if (working.current || disabled) return false;
    working.current = true; setBusy(true); setActionError(''); setNotice('');
    try { await command(name, args); await refresh(); setNotice(message); return true; }
    catch (cause) { setActionError(String(cause)); return false; }
    finally { working.current = false; setBusy(false); }
  };
  const savePreferences = async (preferences: UserPreferences) => {
    if (await run('save_preferences', { preferences: { ...preferences, fixedModel: preferences.fixedModel?.trim() || null, allowedModels: splitLines(preferences.allowedModels.join('\n')) } }, '설정을 저장했어요. 다음 메시지부터 전달을 시도해요.')) setDirty(false);
  };
  const label = (task: AssistanceTask) => {
    const uniqueNativeMatch = task.identity.provider === 'codex' && snapshot.tasks.filter(other => other.identity.provider === 'codex' && other.identity.chatId === task.identity.chatId).length === 1;
    return (uniqueNativeMatch && sessions.find(session => session.id === task.identity.chatId)?.label) || task.context.goal || task.identity.chatId;
  };
  const styles: [UserPreferences['workStyle'], string, string][] = [['auto', '자동', '필요한 만큼 준비·확인'], ['fast', '빠르게', '핵심 결과부터'], ['thorough', '꼼꼼하게', '근거와 누락 점검']];
  return <section className="assistance-page" aria-label="자동 도움 설정">
    <div className="page-heading"><span className="eyebrow">YOUR WORK, YOUR WAY</span><h1>내 일에 맞게,<br />가볍게 조절해요.</h1><p>필요한 도움을 확인하고 바꿔보세요.</p></div>
    {!isDesktop && <p className="assistance-notice" role="status">브라우저 미리보기 · 연결 없음. 설정은 저장되지 않아요.</p>}
    {(error || actionError) && <p className="error" role="alert">{error || actionError}</p>}
    {notice && <p className="assistance-notice" role="status">{notice}</p>}
    <div className="assistance-tabs" role="tablist" aria-label="도움 설정 분류" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (panelOrder.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
      const next = panelOrder[nextIndex]; setTab(next); document.getElementById(`assistance-tab-${next}`)?.focus();
    }}>{([['current', '현재 작업'], ['defaults', '기본 설정'], ['connection', '연결·데이터']] as const).map(([value, text]) => <button key={value} id={`assistance-tab-${value}`} role="tab" tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} aria-controls={`assistance-panel-${value}`} onClick={() => setTab(value)}>{text}</button>)}</div>

    <section id="assistance-panel-current" role="tabpanel" aria-labelledby="assistance-tab-current" className="assistance-card" hidden={tab !== 'current'}>
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
    </section>

    <section id="assistance-panel-defaults" role="tabpanel" aria-labelledby="assistance-tab-defaults" className="assistance-card" hidden={tab !== 'defaults'}>
      <div className="block-heading"><div><h2>나를 위한 기본 설정</h2><p className="small-note">선호만 공유하고, 업무 내용은 채팅별로 보관해요.</p></div><span className={`status-badge ${snapshot.preferences.enabled ? 'working' : 'empty'}`}>{snapshot.preferences.enabled ? '자동 도움 켜짐' : '자동 도움 꺼짐'}</span></div>
      {!snapshot.preferences.enabled && <button className="button primary" disabled={disabled} onClick={() => void savePreferences({ ...snapshot.preferences, enabled: true, workStyle: 'auto', answerLength: 'concise', outputFormat: 'adaptive', routingMode: 'auto', fixedModel: null, allowedModels: [], allowEscalation: false })}>추천 설정으로 켜기</button>}
      <form onSubmit={event => { event.preventDefault(); void savePreferences(draft); }}>
        <label className="assistance-toggle"><span><strong>자동 도움</strong><small>검증된 연결에서 다음 메시지부터</small></span><input type="checkbox" aria-label="자동 도움" checked={draft.enabled} disabled={disabled} onChange={event => update({ ...draft, enabled: event.target.checked })} /></label>
        <fieldset className="mode-fieldset"><legend>작업 방식</legend><div className="preference-choices">{styles.map(([value, title, subtitle]) => <label key={value} className={`mode-option ${draft.workStyle === value ? 'selected' : ''}`}><input type="radio" name="work-style" value={value} checked={draft.workStyle === value} disabled={disabled} onChange={() => update({ ...draft, workStyle: value })} /><span><strong>{title}</strong><small>{subtitle}</small></span></label>)}</div></fieldset>
        <label className="field-label" htmlFor="routing-mode">모델 선택</label><select id="routing-mode" className="text-input" value={draft.routingMode} disabled={disabled} onChange={event => update({ ...draft, routingMode: event.target.value as UserPreferences['routingMode'] })}><option value="auto">허용 범위에서 자동</option><option value="fixed">내가 선택한 모델 유지</option></select>
        <p className="small-note">모델 변경은 연결 검증 전까지 추천만 제공해요.</p>
        <details className="assistance-details"><summary>상세 설정</summary>
          <div className="preference-output-grid"><label>답변 길이<select aria-label="답변 길이" className="text-input" value={draft.answerLength ?? 'concise'} disabled={disabled} onChange={event => update({ ...draft, answerLength: event.target.value as UserPreferences['answerLength'] })}><option value="concise">간결하게</option><option value="normal">보통</option><option value="detailed">자세하게</option></select></label><label>결과 형식 선호<select aria-label="결과 형식 선호" className="text-input" value={draft.outputFormat ?? 'adaptive'} disabled={disabled} onChange={event => update({ ...draft, outputFormat: event.target.value as UserPreferences['outputFormat'] })}><option value="adaptive">요청에 맞게</option><option value="table">표</option><option value="list">목록</option><option value="document">문서</option></select></label></div>
          <p className="small-note">현재 요청에서 지정한 길이와 형식을 먼저 따라요.</p>
          <label>고정할 모델 ID<input className="text-input" placeholder="직접 선택한 모델 ID" value={draft.fixedModel || ''} disabled={disabled} onChange={event => update({ ...draft, fixedModel: event.target.value || null })} /></label><label>허용할 모델 ID<textarea aria-label="허용할 모델 ID" className="text-input" rows={2} placeholder="한 줄에 하나 · 비워두면 검증된 기본 범위" value={draft.allowedModels.join('\n')} disabled={disabled} onChange={event => update({ ...draft, allowedModels: event.target.value.split('\n') })} /></label>
          <label className="assistance-toggle"><span><strong>더 높은 사용 수준 허용</strong><small>검증된 연결과 평가된 모델에만 적용</small></span><input type="checkbox" checked={draft.allowEscalation} disabled={disabled} onChange={event => update({ ...draft, allowEscalation: event.target.checked })} /></label><p className="small-note">확인되지 않은 모델로 자동 전환하지 않아요.</p>
        </details>
        {dirty && draft.revision !== snapshot.preferences.revision && <p className="error" role="alert">다른 창에서 설정이 바뀌었어요. 최신 설정을 불러온 뒤 수정해주세요.</p>}
        <div className="action-row"><span className="small-note">저장과 실제 전달은 별도예요.</span>{dirty && draft.revision !== snapshot.preferences.revision && <button className="button secondary" type="button" disabled={disabled} onClick={() => { setDraft(snapshot.preferences); setDirty(false); }}>최신 설정 불러오기</button>}<button className="button primary" disabled={disabled || !dirty || draft.revision !== snapshot.preferences.revision || (draft.routingMode === 'fixed' && !draft.fixedModel?.trim())}>설정 저장</button></div>
      </form>
    </section>

    <section id="assistance-panel-connection" role="tabpanel" aria-labelledby="assistance-tab-connection" hidden={tab !== 'connection'}>
      <details className="assistance-card assistance-details"><summary>연결별 지원 상태</summary><div className="capability-grid">{(['codex', 'chatgpt'] as const).map(provider => { const cap = snapshot.capabilities[provider]; return <section key={provider}><h3>{provider === 'codex' ? 'Codex' : 'ChatGPT 웹'}</h3><p>{cap.inputAssistance ? '입력 보조 연결 확인됨' : '자동 지침 전달 · 검증 필요'}</p><p>{cap.modelSwitch ? '실제 모델 변경 연결 확인됨' : '모델 자동 변경 · 미검증'}</p><p>{cap.contextSync ? '채팅 기록 전달 연결 확인됨' : '채팅 기록 전달 · 검증 필요'}</p><p>{cap.tokenUsage ? '작업별 사용량 연결 확인됨' : '토큰 사용량 · 측정 불가'}</p></section>; })}</div></details>
      <section className="assistance-card assistance-data"><h2>저장한 데이터</h2><p className="small-note">AI 서비스의 대화는 삭제하지 않아요.</p><button className="text-button danger-text" disabled={disabled || !snapshot.tasks.length} onClick={() => setConfirmAll(!confirmAll)}>모든 채팅 기록 삭제</button>{confirmAll && <div className="delete-confirm"><p>AutoPets에 저장한 모든 채팅 기록을 지울까요?</p><button className="button secondary" disabled={disabled} onClick={() => setConfirmAll(false)}>취소</button><button className="button danger-button" disabled={disabled} onClick={async () => { if (await run('delete_all_contexts', {}, '모든 채팅의 저장 기록을 삭제했어요.')) setConfirmAll(false); }}>모든 기록 삭제 확인</button></div>}</section>
    </section>
  </section>;
}
