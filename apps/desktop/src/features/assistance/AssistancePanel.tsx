import { useEffect, useRef, useState } from 'react';
import type { AssistanceSnapshot, ChatIdentity, UserPreferences } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';
import { splitLines } from '../../app/shared/text';
import { identityKey } from './identity';
import { CurrentTaskPanel } from './CurrentTaskPanel';
import { PreferencesPanel } from '../settings/PreferencesPanel';
import { ConnectionDataPanel } from '../settings/ConnectionDataPanel';
import type { useWorkflow } from '../../bridge/useWorkflow';
import { uniqueIdentities } from './identity';

export function AssistancePanel({ snapshot, sessions, initialSessionId, initialIdentity, error, loaded, refresh, workflow }: { snapshot: AssistanceSnapshot; sessions: { id: string; label: string }[]; initialSessionId?: string | null; initialIdentity?: ChatIdentity | null; error: string; loaded: boolean; refresh: () => Promise<void>; workflow: ReturnType<typeof useWorkflow> }) {
  const [draft, setDraft] = useState<UserPreferences>(snapshot.preferences);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState<'current' | 'defaults' | 'connection'>(initialSessionId || initialIdentity ? 'current' : 'defaults');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const working = useRef(false);
  const initialSelection = useRef<{ sessionId: string | null | undefined; applied: boolean }>({ sessionId: undefined, applied: false });
  useEffect(() => { if (!dirty) setDraft(snapshot.preferences); }, [snapshot.preferences, dirty]);
  useEffect(() => {
    if (initialIdentity && loaded && (workflow.loaded || workflow.error)) {
      const key = identityKey(initialIdentity);
      if (uniqueIdentities(snapshot.tasks, workflow.snapshot.tasks).some(identity => identityKey(identity) === key) && !initialSelection.current.applied) { setSelected(key); setTab('current'); initialSelection.current.applied = true; }
      return;
    }
    if (initialSelection.current.sessionId !== initialSessionId) {
      initialSelection.current = { sessionId: initialSessionId, applied: false };
      setSelected('');
      if (initialSessionId) setTab('current');
    }
    if (initialSelection.current.applied || !initialSessionId || !loaded || (!workflow.loaded && !workflow.error)) return;
    const matches = uniqueIdentities(snapshot.tasks, workflow.snapshot.tasks).filter(identity => identity.provider === 'codex' && identity.chatId === initialSessionId);
    setSelected(matches.length === 1 ? identityKey(matches[0]) : '');
    initialSelection.current.applied = true;
  }, [initialSessionId, initialIdentity, loaded, snapshot.tasks, workflow.loaded, workflow.error, workflow.snapshot.tasks]);
  const selectedTask = snapshot.tasks.find(task => identityKey(task.identity) === selected);
  const panelOrder = ['current', 'defaults', 'connection'] as const;
  const disabled = !isDesktop || !loaded || !!error || busy;
  const update = (next: UserPreferences) => { setDraft(next); setDirty(true); setNotice(''); };
  const run = async (name: string, args: Record<string, unknown>, message: string) => {
    if (working.current || disabled) return false;
    working.current = true; setBusy(true); setActionError(''); setNotice('');
    try { await command(name, args); await Promise.all([refresh(), workflow.refresh()]); setNotice(message); return true; }
    catch (cause) { setActionError(String(cause)); return false; }
    finally { working.current = false; setBusy(false); }
  };
  const savePreferences = async (preferences: UserPreferences) => {
    if (await run('save_preferences', { preferences: { ...preferences, fixedModel: preferences.fixedModel?.trim() || null, allowedModels: splitLines(preferences.allowedModels.join('\n')) } }, '설정을 저장했어요. 다음 메시지부터 전달을 시도해요.')) setDirty(false);
  };
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

    <CurrentTaskPanel snapshot={snapshot} sessions={sessions} selected={selected} selectedTask={selectedTask} disabled={disabled} hidden={tab !== 'current'} setSelected={setSelected} setNotice={setNotice} run={run} workflow={{ ...workflow, refresh: async () => { await Promise.all([refresh(), workflow.refresh()]); } }} />
    <PreferencesPanel snapshot={snapshot} draft={draft} dirty={dirty} disabled={disabled} hidden={tab !== 'defaults'} onUpdate={update} onSave={savePreferences} onReset={() => { setDraft(snapshot.preferences); setDirty(false); }} workflow={workflow} />
    <ConnectionDataPanel snapshot={snapshot} disabled={disabled} hidden={tab !== 'connection'} run={run} />
  </section>;
}
