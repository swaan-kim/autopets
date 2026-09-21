import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { command, isDesktop } from './api';
import { Pet } from './Pet';
import { PetQuickCard } from './features/pets/PetQuickCard';
import { AssistancePanel, useAssistance } from './Assistance';
import { taskForSession } from './assistance-types';
import { DEFAULT_CONFIGURATION, PET_NAMES, STATE_LABEL, type Attention, type Session, type Snapshot, type TaskConfiguration } from './types';
import './style.css';
import './TaskList.css';

const slotParam = new URLSearchParams(location.search).get('pet');
const petIndex = slotParam !== null && /^[0-2]$/.test(slotParam) ? Number(slotParam) : null;
if (petIndex !== null) document.documentElement.classList.add('overlay');

function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    let bridgeFailure = '';
    let refreshing = false;
    const disposers: (() => void)[] = [];
    const accept = (next: Snapshot) => {
      if (alive) setSnapshot(previous => !previous || next.now >= previous.now ? next : previous);
    };
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try { accept(await command<Snapshot>('get_snapshot')); if (alive) setError(bridgeFailure); }
      catch (cause) { if (alive) setError(String(cause)); }
      finally { refreshing = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    if (isDesktop) {
      const register = <T,>(event: string, callback: (payload: T) => void) => {
        void listen<T>(event, event => callback(event.payload)).then(dispose => { if (alive) disposers.push(dispose); else dispose(); }).catch(cause => { if (alive) setError(String(cause)); });
      };
      register<Snapshot>('autopets://snapshot', accept);
      register<string>('autopets://error', message => { bridgeFailure = message; if (alive) setError(message); });
    }
    return () => { alive = false; clearInterval(timer); disposers.forEach(dispose => dispose()); };
  }, []);
  return { snapshot, error };
}

function shortPath(path: string) { return path.split(/[\\/]/).filter(Boolean).slice(-2).join(' / ') || '프로젝트 경로 없음'; }
function formatTime(stamp: number) { return new Date(stamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }); }
function Clock({ stamp }: { stamp: number }) { return <time dateTime={new Date(stamp).toISOString()} title={new Date(stamp).toLocaleString('ko-KR')}>{formatTime(stamp)}</time>; }
function dueAttention(session: Session, now: number) {
  return session.attention && (!session.attention.snoozedUntil || session.attention.snoozedUntil <= now) ? session.attention : null;
}
function status(session: Session, now: number, disconnected = false) {
  if (disconnected) return { kind: 'unknown', text: '브리지 연결 확인 필요' };
  if (session.connection === 'unknown') return { kind: 'unknown', text: '최근 상태 확인 필요' };
  if (session.connection === 'ended') return { kind: 'unknown', text: '작업 연결 종료' };
  const attention = dueAttention(session, now);
  if (attention?.kind === 'elapsed') return { kind: 'time', text: '설정한 시간이 지났어요' };
  if (attention?.kind === 'permission') return { kind: 'waiting', text: 'Codex 확인 필요' };
  if (attention?.kind === 'tool-error') return { kind: 'tool-error', text: '도구 오류 확인' };
  if (attention?.kind === 'milestone') return { kind: 'milestone', text: '계획 단계 업데이트' };
  return { kind: session.state, text: STATE_LABEL[session.state] };
}
function currentAction(session: Session, disconnected = false) {
  if (disconnected || session.connection !== 'observed') return '마지막 관측 이후 상태를 확인할 수 없어요.';
  if (session.state !== 'working') return STATE_LABEL[session.state];
  if (session.activity === 'research') return '자료를 조사하고 있어요';
  if (session.activity === 'writing') return '문서를 작성하고 있어요';
  if (session.activity === 'tool' && session.lastTool) return `${session.lastTool} 사용 중`;
  return '작업을 진행하고 있어요';
}
function observedActivity(session: Session | undefined, disconnected: boolean) {
  return !disconnected && session?.connection === 'observed' && session.state === 'working' ? session.activity : 'idle';
}
function Badge({ session, now, disconnected = false }: { session: Session; now: number; disconnected?: boolean }) {
  const view = status(session, now, disconnected);
  return <span className={`status-badge ${view.kind}`}><i aria-hidden="true" />{view.text}</span>;
}
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const run = async (name: string, args?: Record<string, unknown>) => {
    if (active.current) return false;
    active.current = true; setBusy(true); setError('');
    try { await command(name, args); return true; }
    catch (cause) { setError(String(cause)); return false; }
    finally { active.current = false; setBusy(false); }
  };
  return { busy, error, run };
}

function Modal({ title, children, close, wide = false }: { title: string; children: React.ReactNode; close: () => void; wide?: boolean }) {
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const controls = panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={panel} tabIndex={-1} className={`modal ${wide ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button className="icon-button" aria-label="닫기" onClick={close}>×</button></header>{children}
    </section>
  </div>;
}

function TaskReturn({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return <><button className="button task-return" aria-expanded={open} onClick={() => { setOpen(!open); setCopied(false); setCopyError(false); }}>Codex 작업 찾기 ↗</button>
    {open && <section className="task-return-guide" aria-label="같은 Codex 작업으로 돌아가기">
      <p className="body-copy">Codex에서 아래 작업명과 작업 ID가 같은 작업을 열어주세요. 현재 연결에서는 작업 창을 직접 열 수 없어요.</p>
      <dl className="return-details"><dt>작업명</dt><dd>{session.label}</dd><dt>작업 ID</dt><dd className="selectable">{session.id}</dd><dt>프로젝트</dt><dd className="selectable">{session.cwd || '경로 정보 없음'}</dd></dl>
      <button className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(session.id); setCopied(true); } catch { setCopyError(true); } }}>{copied ? '작업 ID 복사했어요' : '작업 ID 복사'}</button>
      {copyError && <p className="small-note" role="status">복사 기능을 사용할 수 없어요. 위의 작업 ID를 선택해서 복사해주세요.</p>}
    </section>}
  </>;
}

function AttentionCard({ session, attention }: { session: Session; attention: Attention }) {
  const action = useAction();
  const [handled, setHandled] = useState(false);
  const title = attention.kind === 'elapsed' ? '설정한 시간이 지났어요' : attention.kind === 'milestone' ? '계획 단계가 업데이트됐어요' : attention.kind === 'tool-error' ? '도구 오류 확인' : 'Codex에서 확인해주세요';
  const resolve = async (snooze: boolean) => {
    const args = { sessionId: session.id, attentionId: attention.id, ...(snooze ? { minutes: 10 } : {}) };
    if (await action.run(snooze ? 'snooze_attention' : 'acknowledge_attention', args)) setHandled(true);
  };
  return <section className={`attention-card attention-${attention.kind}`} aria-label={title}>
    <div className="attention-heading"><span aria-hidden="true">{attention.kind === 'elapsed' ? '◷' : attention.kind === 'milestone' ? '✓' : '!'}</span><strong>{title}</strong><Clock stamp={attention.createdAt} /></div>
    <p>{attention.summary || title}</p>
    <p className="small-note">{attention.kind === 'elapsed' ? '알림을 확인하거나 미뤄도 Codex 작업은 계속돼요.' : attention.kind === 'permission' ? '이 알림의 확인은 권한 승인이 아니에요. 요청에는 Codex에서 응답해주세요.' : attention.kind === 'tool-error' ? '실제 도구 응답에서 오류가 감지됐어요. 전체 작업이 실패한 것은 아니며, Codex에서 상태를 확인해주세요.' : '실제로 전달된 계획의 변경을 알려드려요.'}</p>
    {action.error && <p className="error" role="alert">{action.error}</p>}
    <div className="action-row"><button className="button secondary" disabled={action.busy || handled} onClick={() => void resolve(true)}>10분 뒤 다시 알림</button><button className="button primary" disabled={action.busy || handled} onClick={() => void resolve(false)}>{handled ? '반영했어요' : '알림 확인'}</button></div>
  </section>;
}

function TaskDetails({ session, now, disconnected }: { session: Session; now: number; disconnected: boolean }) {
  const action = useAction();
  const attention = dueAttention(session, now);
  const observationEnd = session.turnEndedAt ?? (disconnected || session.connection !== 'observed' ? session.lastSeen : now);
  const elapsed = session.turnStartedAt ? Math.max(0, Math.floor((observationEnd - session.turnStartedAt) / 60000)) : null;
  const isNotion = session.lastTool?.toLowerCase().includes('notion');
  return <div className="task-details">
    <div className="detail-status"><Badge session={session} now={now} disconnected={disconnected} /><span className="muted">마지막 관측 <Clock stamp={session.lastSeen} /></span></div>
    {attention && <AttentionCard key={`${attention.id}-${attention.snoozedUntil ?? 0}`} session={session} attention={attention} />}
    {!attention && session.attention?.snoozedUntil && <p className="snooze-note">알림을 <Clock stamp={session.attention.snoozedUntil} />까지 미뤘어요.</p>}
    <section className="detail-block"><h3>완료 기준</h3><p className={!session.completionCriterion ? 'unavailable-copy' : ''}>{session.completionCriterion || '아직 완료 기준을 정하지 않았어요.'}</p></section>
    <section className="detail-block"><h3>현재 활동</h3><p>{currentAction(session, disconnected)}</p>{session.lastTool && <span className={`tool-chip ${isNotion ? 'notion-chip' : ''}`}>{isNotion ? 'N · ' : '⌘ · '}최근 도구 · {session.lastTool}</span>}</section>
    <section className="detail-block plan-block"><div className="block-heading"><h3>전달된 작업 계획</h3>{session.planUpdatedAt && <span className="muted">갱신 <Clock stamp={session.planUpdatedAt} /></span>}</div>
      {session.planSteps?.length ? <ol className="plan-list">{session.planSteps.map((item, index) => <li className={`plan-${item.status}`} key={`${index}-${item.step}`}><span className="plan-marker" aria-label={item.status === 'completed' ? '완료' : item.status === 'in_progress' ? '진행 중' : '대기'}>{item.status === 'completed' ? '✓' : index + 1}</span><span>{item.step}</span>{item.status === 'in_progress' && <span className="plan-current">진행</span>}</li>)}</ol> : <p className="unavailable-copy">계획이 아직 전달되지 않았어요.<br /><span>전달된 계획이 있을 때만 여기에 표시돼요.</span></p>}
    </section>
    <div className="observation-stats"><div><span>이번 작업 관측 시간</span><strong>{elapsed === null ? '—' : elapsed < 1 ? '1분 미만' : `${elapsed}분`}</strong></div><div><span>시간 알림</span><strong>{session.elapsedAlertMinutes === null ? '끔' : `${session.elapsedAlertMinutes ?? 10}분`}</strong></div><div><span>토큰 사용량</span><strong>측정 불가</strong></div></div>
    {session.unread && <button className="text-button" disabled={action.busy} onClick={() => void action.run('acknowledge', { sessionId: session.id })}>응답 확인했어요</button>}
    {action.error && <p className="error" role="alert">{action.error}</p>}
    <TaskReturn session={session} />
  </div>;
}

function ConfigurationForm({ session, submitLabel, busy, onSave }: { session: Session; submitLabel: string; busy: boolean; onSave: (config: TaskConfiguration) => Promise<void> }) {
  const [config, setConfig] = useState<TaskConfiguration>({
    completionCriterion: session.completionCriterion ?? DEFAULT_CONFIGURATION.completionCriterion,
    interventionMode: session.interventionMode ?? DEFAULT_CONFIGURATION.interventionMode,
    elapsedAlertMinutes: session.elapsedAlertMinutes === undefined ? 10 : session.elapsedAlertMinutes,
  });
  return <form className="configuration-form" onSubmit={event => { event.preventDefault(); void onSave({ ...config, completionCriterion: config.completionCriterion.trim() }); }}>
    <div className="chosen-task"><span className="field-label">연결할 작업</span><strong>{session.label}</strong><p title={session.cwd}>{shortPath(session.cwd)} · {session.id}</p></div>
    <label className="field-label" htmlFor="completion-criterion">완료 기준 · 선택사항</label>
    <textarea id="completion-criterion" className="text-input" maxLength={2000} rows={2} placeholder="비워두면 기존 채팅의 요청을 기준으로 진행해요." value={config.completionCriterion} onChange={event => setConfig({ ...config, completionCriterion: event.target.value })} />
    <fieldset className="mode-fieldset"><legend>언제 알려드릴까요?</legend><label className={`mode-option ${config.interventionMode === 'when-needed' ? 'selected' : ''}`}><input type="radio" name="intervention-mode" value="when-needed" checked={config.interventionMode === 'when-needed'} onChange={() => setConfig({ ...config, interventionMode: 'when-needed' })} /><span><strong>확인이 필요할 때</strong><small>요청이나 시간 알림이 있을 때 확인해요.</small></span></label><label className={`mode-option ${config.interventionMode === 'milestones' ? 'selected' : ''}`}><input type="radio" name="intervention-mode" value="milestones" checked={config.interventionMode === 'milestones'} onChange={() => setConfig({ ...config, interventionMode: 'milestones' })} /><span><strong>계획 단계가 바뀔 때도</strong><small>실제로 전달된 단계의 변경도 알려드려요.</small></span></label></fieldset>
    <details className="time-settings"><summary>시간 알림 · {config.elapsedAlertMinutes === null ? '끔' : `${config.elapsedAlertMinutes}분`}</summary><label className="toggle-row"><input type="checkbox" checked={config.elapsedAlertMinutes !== null} onChange={event => setConfig({ ...config, elapsedAlertMinutes: event.target.checked ? 10 : null })} /><span>일정 시간이 지나면 알림 받기</span></label>{config.elapsedAlertMinutes !== null && <label className="minutes-input"><input type="number" aria-label="시간 알림 간격 (분)" min={1} max={1440} required value={config.elapsedAlertMinutes} onChange={event => setConfig({ ...config, elapsedAlertMinutes: event.target.value === '' ? 0 : Number(event.target.value) })} />분</label>}<p className="small-note">시간 알림은 작업을 일시정지하거나 종료하지 않아요.</p></details>
    <button className="button primary form-submit" disabled={busy}>{busy ? '저장 중…' : submitLabel}</button>
  </form>;
}

function PetOverlay({ snapshot, index, error, assistance }: { snapshot: Snapshot; index: number; error: string; assistance: ReturnType<typeof useAssistance> }) {
  const [expanded, setExpanded] = useState(false);
  const [windowError, setWindowError] = useState('');
  const [notice, setNotice] = useState('');
  const overlay = useRef<HTMLDivElement>(null);
  const resizeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const action = useAction();
  const sessionId = snapshot.slots.find(slot => slot.index === index)?.sessionId;
  const session = snapshot.sessions.find(session => session.id === sessionId);
  const helpTask = taskForSession(assistance.snapshot.tasks, sessionId);
  const disconnected = Boolean(error) || (isDesktop && !snapshot.connectionPath);
  const view = session ? status(session, snapshot.now, disconnected) : { kind: 'idle', text: disconnected ? '연결 확인 필요' : '작업 연결 전' };
  const attention = session ? dueAttention(session, snapshot.now) : null;
  useEffect(() => { setExpanded(false); setNotice(''); }, [session?.id]);
  useEffect(() => {
    if (isDesktop) resizeQueue.current = resizeQueue.current.catch(() => undefined).then(() => command('set_pet_expanded', { expanded })).catch(cause => setWindowError(String(cause)));
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setExpanded(false); overlay.current?.querySelector<HTMLButtonElement>('.pet-hit')?.focus(); } };
    const outside = (event: PointerEvent) => { if (event.target === overlay.current || event.target === document.body || event.target === document.documentElement) setExpanded(false); };
    const blur = () => setExpanded(false);
    document.addEventListener('keydown', key); document.addEventListener('pointerdown', outside); window.addEventListener('blur', blur);
    overlay.current?.querySelector<HTMLButtonElement>('.pet-quick-card button')?.focus();
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur); };
  }, [expanded]);
  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false; const disposers: (() => void)[] = [];
    const add = <T,>(name: string, fn: (payload: T) => void) => { void listen<T>(name, event => fn(event.payload)).then(remove => { if (disposed) remove(); else disposers.push(remove); }).catch(cause => { if (!disposed) setWindowError(String(cause)); }); };
    add<{ exceptSlot: number | null }>('autopets://collapse-pets', payload => { if (payload.exceptSlot !== index) setExpanded(false); });
    return () => { disposed = true; disposers.forEach(remove => remove()); };
  }, [index]);
  const motion = disconnected || session?.connection !== 'observed' ? 'idle'
    : session.state === 'failed' || attention?.kind === 'tool-error' ? 'angry'
    : attention && attention.kind !== 'milestone' || session.state === 'waiting' ? 'dizzy'
    : session.state === 'done' && session.unread ? 'celebrate' : undefined;
  const help = disconnected || session?.connection !== 'observed' || attention ? view.text
    : helpTask && (!assistance.snapshot.preferences.enabled || !helpTask.enabled) ? '이번 채팅의 자동 도움은 꺼져 있어요'
    : session ? currentAction(session) : '함께할 작업을 기다려요';
  return <div ref={overlay} className={`pet-overlay ${expanded ? 'expanded' : ''}`}>
    {expanded && <div className="quick-card-stack"><PetQuickCard title={session?.label || '작업 연결 전'} help={help}
      goal={helpTask?.context.goal} constraints={helpTask?.context.constraints}
      currentStep={session?.planSteps?.find(step => step.status === 'in_progress')?.step}
      task={helpTask} defaultWorkStyle={assistance.snapshot.preferences.workStyle} assistanceEnabled={assistance.snapshot.preferences.enabled}
      disabled={!isDesktop || !!assistance.error} busy={action.busy} error={error || action.error || windowError} notice={notice}
      returnLabel="작업명·ID 복사" onReturn={session ? async () => {
        try { await navigator.clipboard.writeText(`${session.label}\n${session.id}`); setNotice('복사했어요. Codex에서 같은 작업을 찾아주세요.'); }
        catch { setNotice(`복사하지 못했어요. 작업 ID: ${session.id}`); }
      } : undefined}
      onWorkStyle={async workStyle => { if (helpTask && await action.run('set_task_work_style', { identity: helpTask.identity, workStyle, expectedRevision: helpTask.settingsRevision ?? 0 })) { await assistance.refresh(); setNotice('이 작업만 변경했어요. 다음 메시지 전달 대기 중이에요.'); } }}
      onDetails={async () => { await action.run('show_manager', { section: 'assistance', sessionId: session?.id }); }}
      onToggleAssistance={helpTask ? async () => { if (await action.run('set_chat_assistance', { identity: helpTask.identity, enabled: !helpTask.enabled })) await assistance.refresh(); } : undefined}
      onHide={async () => { setExpanded(false); await action.run('set_pet_visible', { slot: index, visible: false }); }}
      onQuit={async () => { await action.run('quit_app'); }} onClose={() => setExpanded(false)} />
      {session && attention && <AttentionCard session={session} attention={attention} />}
    </div>}
    <div className="floating-pet"><button className="drag-handle" aria-label="펫 이동" title="드래그해서 이동" onPointerDown={event => { if (event.button === 0 && isDesktop) { setExpanded(false); void getCurrentWindow().startDragging().catch(() => void 0); } }}>⠿</button>
      <button className="pet-menu-button" aria-expanded={expanded} aria-label="펫 메뉴" onClick={() => setExpanded(!expanded)}>⋯</button>
      <button className="pet-hit" aria-expanded={expanded} aria-label={`${session?.label || PET_NAMES[index]} · 작업 카드 열기`} onClick={() => setExpanded(!expanded)}><Pet index={index} activity={observedActivity(session, disconnected)} motion={motion} paused={disconnected || session?.connection !== 'observed'} />{attention && <span className={`pet-attention-dot ${attention.kind}`} aria-label={view.text}>{attention.kind === 'elapsed' ? '◷' : attention.kind === 'milestone' ? '✓' : '!'}</span>}</button>
      <span className="floating-label" title={session?.label}>{session?.unread && <i className="unread-dot" />}{session?.label ?? PET_NAMES[index]}</span><span className={`floating-status ${view.kind}`}>{help}</span>
    </div>
  </div>;
}

function Manager({ snapshot, error, assistance }: { snapshot: Snapshot; error: string; assistance: ReturnType<typeof useAssistance> }) {
  const [settings, setSettings] = useState<'pets' | 'connection' | 'assistance'>('pets');
  const [assistanceSession, setAssistanceSession] = useState<string | null>(null);
  const [assistanceRequest, setAssistanceRequest] = useState(0);
  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ sessionId?: string }>('autopets://open-assistance', event => { setAssistanceSession(event.payload.sessionId || null); setAssistanceRequest(value => value + 1); setSettings('assistance'); }).then(dispose => { if (disposed) dispose(); else unlisten = dispose; }).catch(() => { /* Snapshot controls remain usable if the window event listener is unavailable. */ });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  const [picker, setPicker] = useState<number | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<'all' | 'working' | 'attention' | 'arrived'>('all');
  const action = useAction();
  const assignedIds = snapshot.slots.map(slot => slot.sessionId);
  const bound = assignedIds.filter(Boolean).length;
  const disconnected = Boolean(error) || (isDesktop && !snapshot.connectionPath);
  const orderedTasks = [...snapshot.sessions].sort((a, b) => b.lastSeen - a.lastSeen);
  const availableSlot = snapshot.slots.find(slot => slot.index >= 0 && slot.index < 3 && slot.sessionId === null);
  const matchesFilter = (session: Session, filter: typeof taskFilter) => filter === 'all'
    || filter === 'working' && !disconnected && session.connection === 'observed' && session.state === 'working'
    || filter === 'attention' && (disconnected || session.connection === 'unknown' || Boolean(dueAttention(session, snapshot.now)) || session.state === 'waiting' || session.state === 'failed')
    || filter === 'arrived' && session.state === 'done';
  const filters = [{ id: 'all', label: '전체' }, { id: 'working', label: '진행 중' }, { id: 'attention', label: '확인 필요' }, { id: 'arrived', label: '응답 도착' }] as const;
  const visibleTasks = orderedTasks.filter(session => matchesFilter(session, taskFilter));
  const unassignedCount = snapshot.sessions.filter(session => !assignedIds.includes(session.id)).length;
  const sessions = [...snapshot.sessions].filter(session => `${session.label} ${session.cwd} ${session.id}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.lastSeen - a.lastSeen);
  const pickedSession = snapshot.sessions.find(session => session.id === pickedId);
  const editSession = snapshot.sessions.find(session => session.id === editId);
  const detailSession = snapshot.sessions.find(session => session.id === detailId);
  const configure = async (sessionId: string, config: TaskConfiguration) => action.run('configure_session', { sessionId, ...config });
  const closePicker = () => { if (!action.busy) { setPicker(null); setPickedId(null); } };
  return <div className="app-shell"><aside className="sidebar"><div className="brand brand-logo-lockup"><img className="brand-logo" src="/assets/brand/autopets-logo.svg" alt="AutoPets" width="160" height="37" /><span className="brand-sub">작은 작업 동료</span></div><div className="nav-label">WORKSPACE</div><button className={`nav-item ${settings === 'pets' ? 'active' : ''}`} onClick={() => setSettings('pets')}><span aria-hidden="true">◈</span><span className="nav-text">나의 펫</span><span className="nav-count">{bound}/3</span></button><button className={`nav-item ${settings === 'connection' ? 'active' : ''}`} onClick={() => setSettings('connection')}><span aria-hidden="true">⌘</span><span className="nav-text">연결 설정</span></button><button className={`nav-item ${settings === 'assistance' ? 'active' : ''}`} onClick={() => setSettings('assistance')} aria-label="자동 도움"><span aria-hidden="true">✦</span><span className="nav-text">자동 도움</span></button><div className="sidebar-bottom"><span className="local-indicator" />이 PC에서만 실행<p>작업의 흐름을 가까이,<br />필요한 순간에 확인해요.</p><button className="text-button danger-text" disabled={!isDesktop || action.busy} onClick={() => void action.run('quit_app')}>AutoPets 종료</button><span className="version">LOCAL MVP · 0.1</span></div></aside>
    <main className="main-content"><header className="topbar"><span>YOUR LITTLE WORKSPACE</span><span className={`connection-pill ${disconnected ? 'offline' : ''}`}><i />{!isDesktop ? '브라우저 미리보기 · 연결 없음' : disconnected ? '브리지 연결 확인 필요' : '로컬 앱 실행 중'}</span></header>{(error || action.error) && <div className="error" role="alert">{error || action.error}</div>}
      {settings === 'assistance' ? <AssistancePanel key={assistanceRequest} snapshot={assistance.snapshot} sessions={snapshot.sessions} initialSessionId={assistanceSession} error={assistance.error} loaded={assistance.loaded} refresh={assistance.refresh} /> : settings === 'connection' ? <><div className="page-heading"><span className="eyebrow">CONNECTION</span><h1>Codex와 연결하기</h1><p>이미 진행 중인 작업의 활동을 펫에게 전달해주세요.</p></div><section className="setup-card"><span className="step-number">01</span><div><h3>처음 한 번 연결 확인</h3><p>연결 안내에 따라 Codex 훅을 설정하고 지침 전달 여부를 확인해요. 설정 저장만으로 자동 연결이 완료되지는 않아요. 매번 스킬을 부를 필요가 없는 연결을 검증하고 있어요.</p><span className="field-label">로컬 연결 파일</span><code className="path-code">{snapshot.connectionPath || '데스크톱 앱의 브리지가 연결되면 표시됩니다.'}</code></div></section><section className="setup-card"><span className="step-number">02</span><div><h3>수동으로 작업을 골라도 좋아요</h3><p>훅으로 감지된 작업을 목록에서 직접 선택할 수도 있어요. 작업 하나에 펫 하나, 최대 3개까지 연결해요. 시간 알림은 기본 10분이며 설정에서 바꾸거나 끌 수 있어요.</p><button className="button secondary" onClick={() => setSettings('pets')}>나의 펫으로 돌아가기</button></div></section><section className="setup-card"><span className="step-number">03</span><div><h3>필요할 때 같은 Codex 작업으로</h3><p>펫의 카드를 열어 마지막 활동과 전달된 계획을 확인하세요. 권한 요청과 질문에는 Codex에서 답변해주세요.</p><p className="small-note">현재 연결에서는 토큰 사용량 측정과 Codex 작업 창 직접 열기를 지원하지 않아요.</p></div></section></> : <><div className="page-heading"><span className="eyebrow">A LITTLE COMPANY, A LITTLE CLARITY</span><h1>작업은 맡기고,<br />흐름은 가까이 두세요<span className="heading-spark" aria-hidden="true">✳</span></h1><p>펫 하나에 작업 하나. 실제 활동과 필요한 알림을 한눈에.</p></div><div className="section-title"><h2>나의 펫 <span>{bound} / 3</span></h2><button className="text-button" disabled={!isDesktop} onClick={() => void action.run('set_pets_visible', { visible: true })}>바탕화면에 모두 표시 ↗</button></div>
        <section className="pet-grid">{snapshot.slots.map(slot => { const session = snapshot.sessions.find(session => session.id === slot.sessionId); return <article className={`pet-card pet-card-${slot.index}`} key={slot.index}><div className="card-top"><span className="pet-name">{PET_NAMES[slot.index]}</span><span className="slot-label">0{slot.index + 1}</span></div><div className="pet-stage"><Pet index={slot.index} activity={observedActivity(session, disconnected)} paused={disconnected || session?.connection === 'unknown'} /></div>{session ? <><Badge session={session} now={snapshot.now} disconnected={disconnected} /><h3 title={session.label}>{session.label}</h3><p className="card-action" title={currentAction(session, disconnected)}>{currentAction(session, disconnected)}</p><p className="card-path" title={session.cwd}>{shortPath(session.cwd)}</p><button className="button card-button" onClick={() => setDetailId(session.id)}>작업 카드 열기 →</button><div className="card-options"><button className="text-button" onClick={() => setEditId(session.id)}>작업 설정</button><button className="text-button" disabled={action.busy} onClick={() => void action.run('unassign_session', { slot: slot.index })}>연결 해제</button><button className="text-button" onClick={() => void action.run('open_pet', { slot: slot.index })}>펫 보기 ↗</button></div></> : <><span className="status-badge empty"><i />연결 대기</span><h3>어떤 작업을 맡길까요?</h3><p className="card-action empty-copy">함께할 Codex 작업을 골라주세요.</p><p className="card-path">연결된 환경의 실제 작업만 표시해요.</p><button className="button card-button" disabled={!isDesktop} onClick={() => { setPicker(slot.index); setQuery(''); setPickedId(null); }}>＋ 작업 연결</button></>}</article>; })}</section>
        <section className="activity-section manager-tasks" aria-label="전체 작업 목록">
          <div className="section-title"><h2>모든 작업 <span>{snapshot.sessions.length}</span></h2><span className="muted">마지막으로 관측한 활동 기준</span></div>
          <div className="task-filters" role="group" aria-label="작업 상태 필터">{filters.map(filter => <button key={filter.id} type="button" className={`task-filter ${taskFilter === filter.id ? 'selected' : ''}`} aria-pressed={taskFilter === filter.id} data-testid={`task-filter-${filter.id}`} onClick={() => setTaskFilter(filter.id)}>{filter.label}<span>{orderedTasks.filter(session => matchesFilter(session, filter.id)).length}</span></button>)}</div>
          {unassignedCount > 0 && <p className="task-capacity-note">펫은 최대 3개까지 연결돼요. 펫에 연결되지 않은 {unassignedCount}개 작업도 이 목록에서 확인할 수 있어요.{!availableSlot && ' 다른 작업에 펫을 연결하려면 위에서 기존 연결을 먼저 해제해주세요.'}</p>}
          {!snapshot.sessions.length ? <div className="empty-tasks"><span className="empty-orbit" aria-hidden="true">✧</span><div><h3>첫 번째 작업을 기다리고 있어요</h3><p>훅을 연결한 Codex에서 활동이 전달되면 여기에 나타나요.</p></div><button className="button secondary" onClick={() => setSettings('connection')}>연결 안내 →</button></div>
            : !visibleTasks.length ? <div className="task-filter-empty" role="status">{filters.find(filter => filter.id === taskFilter)?.label} 작업이 없어요.<button type="button" className="text-button" onClick={() => setTaskFilter('all')}>전체 작업 보기</button></div>
            : <div className="task-list manager-task-list">{visibleTasks.map(session => {
              const slot = snapshot.slots.find(slot => slot.sessionId === session.id);
              const view = status(session, snapshot.now, disconnected);
              return <div className="task-list-entry" key={session.id} data-session-id={session.id}>
                <button className="task-row" aria-label={`${session.label} 작업 상세`} onClick={() => setDetailId(session.id)}><span className={`state-dot ${view.kind}`} /><span className="task-row-text"><strong>{session.label}</strong><span>{shortPath(session.cwd)}</span></span><span className="task-state">{view.text}</span><Clock stamp={session.lastSeen} /></button>
                <div className="task-binding">{slot ? <span className="task-pet-label">{PET_NAMES[slot.index]} 연결됨</span> : <><span className="task-pet-label unbound">목록에서 확인</span><button type="button" className="text-button" disabled={!isDesktop || !availableSlot || action.busy} title={!availableSlot ? '기존 펫 연결을 먼저 해제해주세요.' : '빈 펫에 이 작업을 연결해요.'} aria-label={`${session.label} 펫 연결`} onClick={() => { if (availableSlot) { setPicker(availableSlot.index); setQuery(''); setPickedId(session.id); } }}>펫 연결</button></>}</div>
              </div>;
            })}</div>}
        </section><footer><span className="footer-leaf" aria-hidden="true">✳</span><span>펫의 알림을 확인해도 Codex 작업은 계속돼요.</span><span className="footer-mode">활동 관측 · 로컬 저장</span></footer></>}
    </main>
    {picker !== null && <Modal title={pickedSession ? `${PET_NAMES[picker]}에게 작업 맡기기` : '연결할 작업을 골라주세요'} close={closePicker}>{action.error && <p className="error" role="alert">{action.error}</p>}{pickedSession ? <><button className="text-button" disabled={action.busy} onClick={() => setPickedId(null)}>← 다른 작업 선택</button><ConfigurationForm key={pickedSession.id} session={pickedSession} busy={action.busy} submitLabel="이 작업 연결하기" onSave={async config => { if (await configure(pickedSession.id, config) && await action.run('assign_session', { slot: picker, sessionId: pickedSession.id })) { setPicker(null); setPickedId(null); } }} /></> : <><input className="search-input" aria-label="작업 검색" placeholder="작업 이름, 경로 또는 ID 검색" value={query} onChange={event => setQuery(event.target.value)} /><div className="picker-list">{!sessions.length ? <p className="picker-empty">표시할 작업이 없어요.<br />연결한 Codex에서 활동을 시작해주세요.</p> : sessions.map(session => <button className="picker-row" key={session.id} disabled={assignedIds.includes(session.id)} onClick={() => setPickedId(session.id)}><span><strong>{session.label}</strong><small>{session.cwd}</small><small>{session.id} · {formatTime(session.lastSeen)}</small></span><span>{assignedIds.includes(session.id) ? '연결됨' : '＋'}</span></button>)}</div></>}</Modal>}
    {editSession && <Modal title="작업 설정" close={() => { if (!action.busy) setEditId(null); }}>{action.error && <p className="error" role="alert">{action.error}</p>}<ConfigurationForm key={editSession.id} session={editSession} busy={action.busy} submitLabel="설정 저장" onSave={async config => { if (await configure(editSession.id, config)) setEditId(null); }} /></Modal>}
    {detailSession && <Modal title={detailSession.label} close={() => setDetailId(null)} wide><p className="overlay-path">{shortPath(detailSession.cwd)}</p><TaskDetails session={detailSession} now={snapshot.now} disconnected={disconnected} /></Modal>}
  </div>;
}

function App() {
  const { snapshot, error } = useSnapshot();
  const assistance = useAssistance();
  if (!snapshot) return <div className="loading-state" role="status">{error ? `브리지 연결 확인 필요 · ${error}` : '로컬 작업 상태를 불러오는 중…'}{isDesktop && <button className="button secondary" onClick={() => void command('quit_app')}>AutoPets 종료</button>}</div>;
  return petIndex === null ? <Manager snapshot={snapshot} error={error} assistance={assistance} /> : <PetOverlay snapshot={snapshot} index={petIndex} error={error} assistance={assistance} />;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
