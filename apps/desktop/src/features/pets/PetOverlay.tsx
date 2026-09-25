import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Snapshot } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';
import { useAction } from '../../bridge/useAction';
import { useAssistance } from '../../bridge/useAssistance';
import { useRoles } from '../../bridge/useRoles';
import type { useWorkflow } from '../../bridge/useWorkflow';
import { identityKey, uniqueIdentities } from '../assistance/identity';
import { workflowHelp } from '../workflow/presentation';
import { currentAction, dueAttention, observedActivity, status } from '../tasks/presentation';
import { AttentionCard } from '../tasks/AttentionCard';
import { PET_NAMES } from './constants';
import { Pet } from './Pet';
import { PetAppearance } from './PetAppearance';
import { PetQuickCard } from './PetQuickCard';

export function PetOverlay({ snapshot, index, error, assistance, workflow }: { snapshot: Snapshot; index: number; error: string; assistance: ReturnType<typeof useAssistance>; workflow: ReturnType<typeof useWorkflow> }) {
  const [expanded, setExpanded] = useState(false);
  const [windowError, setWindowError] = useState('');
  const [notice, setNotice] = useState('');
  const overlay = useRef<HTMLDivElement>(null);
  const resizeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const action = useAction();
  const roles = useRoles();
  const sessionId = snapshot.slots.find(slot => slot.index === index)?.sessionId;
  const session = snapshot.sessions.find(session => session.id === sessionId);
  const matches = uniqueIdentities(assistance.snapshot.tasks, workflow.snapshot.tasks).filter(identity => identity.provider === 'codex' && identity.chatId === sessionId);
  const taskKey = matches.length === 1 ? identityKey(matches[0]) : null;
  const roleMatches = roles.error ? [] : roles.snapshot.bindings.filter(binding => identityKey(binding.identity) === taskKey);
  const appearance = roleMatches.length === 1 ? roleMatches[0].template : undefined;
  const helpTask = assistance.snapshot.tasks.find(task => identityKey(task.identity) === taskKey);
  const workflowTask = workflow.snapshot.tasks.find(task => identityKey(task.identity) === taskKey);
  const disconnected = Boolean(error) || (isDesktop && !snapshot.connectionPath);
  const view = session ? status(session, snapshot.now, disconnected) : { kind: 'idle', text: disconnected ? '연결 확인 필요' : snapshot.setup?.phase === 'connecting' ? '채팅 연결 대기' : '작업 연결 전' };
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
    : workflowTask?.enabled ? workflow.error ? '설정 확인 필요' : workflowHelp(workflowTask, workflow.snapshot.capabilities[workflowTask.identity.provider]) || '계획 지침 준비됨'
    : workflowTask && !workflowTask.enabled ? '이번 채팅의 자동 도움은 꺼져 있어요'
    : helpTask && (!assistance.snapshot.preferences.enabled || !helpTask.enabled) ? '이번 채팅의 자동 도움은 꺼져 있어요'
    : session ? currentAction(session) : '함께할 작업을 기다려요';
  return <div ref={overlay} className={`pet-overlay ${expanded ? 'expanded' : ''}`}>
    {expanded && <div className="quick-card-stack"><PetQuickCard aiName={session ? 'Codex' : undefined} title={session?.label || '작업 연결 전'} help={help}
      goal={helpTask?.context.goal} constraints={helpTask?.context.constraints}
      currentStep={session?.planSteps?.find(step => step.status === 'in_progress')?.step}
      task={helpTask} workflowTask={workflowTask} defaultWorkStyle={assistance.snapshot.preferences.workStyle} assistanceEnabled={assistance.snapshot.preferences.enabled}
      disabled={!isDesktop || !!assistance.error} busy={action.busy} error={error || action.error || windowError} notice={notice}
      returnLabel="작업명·ID 복사" onReturn={session ? async () => {
        try { await navigator.clipboard.writeText(`${session.label}\n${session.id}`); setNotice('복사했어요. Codex에서 같은 작업을 찾아주세요.'); }
        catch { setNotice(`복사하지 못했어요. 작업 ID: ${session.id}`); }
      } : undefined}
      onWorkStyle={async workStyle => { if (helpTask && await action.run('set_task_work_style', { identity: helpTask.identity, workStyle, expectedRevision: helpTask.settingsRevision ?? 0 })) { await assistance.refresh(); setNotice('이 작업만 변경했어요. 다음 메시지 전달 대기 중이에요.'); } }}
      onDetails={async () => { await action.run('show_manager', { section: 'assistance', sessionId: session?.id }); }}
      onToggleAssistance={helpTask ? async () => { if (await action.run('set_chat_assistance', { identity: helpTask.identity, enabled: !(helpTask.enabled || workflowTask?.enabled) })) await Promise.all([assistance.refresh(), workflow.refresh()]); } : workflowTask ? async () => { if (await action.run('configure_workflow_task', { identity: workflowTask.identity, configuration: { enabled: !workflowTask.enabled, preset: workflowTask.preset, planFirst: workflowTask.planFirst, planning: workflowTask.planning, execution: workflowTask.execution }, expectedRevision: workflowTask.settingsRevision })) await workflow.refresh(); } : undefined}
      onHide={async () => { setExpanded(false); await action.run('set_pet_visible', { slot: index, visible: false }); }}
      onQuit={async () => { await action.run('quit_app'); }} onClose={() => setExpanded(false)} />
      {session && attention && <AttentionCard session={session} attention={attention} />}
    </div>}
    <div className="floating-pet"><button className="drag-handle" aria-label="펫 이동" title="드래그해서 이동" onPointerDown={event => { if (event.button === 0 && isDesktop) { setExpanded(false); void getCurrentWindow().startDragging().catch(() => void 0); } }}>⠿</button>
      <button className="pet-menu-button" aria-expanded={expanded} aria-label="펫 메뉴" onClick={() => setExpanded(!expanded)}>⋯</button>
      <button className="pet-hit" aria-expanded={expanded} aria-label={`${session?.label || PET_NAMES[index]} · 작업 카드 열기`} onClick={() => setExpanded(!expanded)}><PetAppearance template={appearance}><Pet index={index} activity={observedActivity(session, disconnected)} motion={motion} paused={disconnected || session?.connection !== 'observed'} /></PetAppearance>{attention && <span className={`pet-attention-dot ${attention.kind}`} aria-label={view.text}>{attention.kind === 'elapsed' ? '◷' : attention.kind === 'milestone' ? '✓' : '!'}</span>}</button>
      <span className="floating-label" title={session?.label}>{session?.unread && <i className="unread-dot" />}{session?.label ?? PET_NAMES[index]}</span><span className={`floating-status ${view.kind}`} title={help}>{help}</span>
    </div>
  </div>;
}
