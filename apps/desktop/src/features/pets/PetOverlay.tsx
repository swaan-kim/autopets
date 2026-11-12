import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
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
import { canAttemptReturn, returnToTask } from '../tasks/returnToTask';
import { McpProp } from '../tasks/ToolActivity';
import { PET_NAMES } from './constants';
import { Pet } from './Pet';
import { TaskPetArt } from './TaskPetArt';
import { catalogFor } from './petCatalog';
import { PetAppearance } from './PetAppearance';
import { PetQuickCard } from './PetQuickCard';
import { ExplicitPet, explicitPetStatus, explicitPetMotion } from './ExplicitPet';
import { companionState, companionRunKey } from './companionMotion';
import { CompanionPet } from './CompanionPet';
import { PetRecommendationCard, recommendationStatus, visibleRecommendation } from './PetRecommendation';
import { usePetGesture } from './usePetGesture';
import { PetBubble, jobBubble, linkBubble, noticeSeen, sessionBubble } from './PetBubble';
import { HOST_NAMES, JOB_ACTIVE_MS, PetJobList, activeJob, openJobResult } from './PetJobs';
import type { CompanionState } from './companionMotion';
import { canReturnToPetTask } from './PetTaskReturn';

const moveHint = '클릭하면 작업 카드, 끌면 이동';

function UnassignedPetButton({ index, expanded, onToggle, gesture, recommended = false, state = 'idle', runKey }: { index: number; expanded: boolean; onToggle: () => void; gesture: ReturnType<typeof usePetGesture>; recommended?: boolean; state?: CompanionState; runKey?: string }) {
  const [interaction, setInteraction] = useState(0);
  const react = () => setInteraction(value => value + 1);
  return <button className="pet-hit" aria-expanded={expanded} aria-label={`${PET_NAMES[index]} · 작업 카드 열기${recommended ? ' · 펫 추천 있음' : ''}`} title={moveHint} onClick={onToggle} {...gesture.handlers}
    onPointerDown={event => { gesture.handlers.onPointerDown(event); if (event.button === 0) react(); }}
    onKeyDown={event => { if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) react(); }}>
    <span className="overlay-idle-pet"><CompanionPet state={state} runKey={runKey} interaction={interaction} motionInput={gesture.motion} /></span>
    {recommended && <span className="pet-recommendation-dot below-menu" aria-hidden="true">추천</span>}
  </button>;
}

export function PetOverlay({ snapshot, index, error, assistance, workflow }: { snapshot: Snapshot; index: number; error: string; assistance: ReturnType<typeof useAssistance>; workflow: ReturnType<typeof useWorkflow> }) {
  const [expanded, setExpanded] = useState(false);
  const [windowError, setWindowError] = useState('');
  const [notice, setNotice] = useState('');
  const overlay = useRef<HTMLDivElement>(null);
  const resizeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const returning = useRef(false);
  const action = useAction();
  const roles = useRoles();
  // Dragging the pet body moves its window; the open card closes first.
  const gesture = usePetGesture({ onDragStart: () => setExpanded(false) });
  const sessionId = snapshot.slots.find(slot => slot.index === index)?.sessionId;
  const session = snapshot.sessions.find(session => session.id === sessionId);
  const returnTarget = useRef('');
  returnTarget.current = `${session?.id}\n${session?.cwd}`;
  const matches = uniqueIdentities(assistance.snapshot.tasks, workflow.snapshot.tasks).filter(identity => identity.provider === 'codex' && identity.chatId === sessionId);
  const taskKey = matches.length === 1 ? identityKey(matches[0]) : null;
  const roleMatches = roles.error ? [] : roles.snapshot.bindings.filter(binding => identityKey(binding.identity) === taskKey);
  const appearance = roleMatches.length === 1 ? roleMatches[0].template : undefined;
  const helpTask = assistance.snapshot.tasks.find(task => identityKey(task.identity) === taskKey);
  const workflowTask = workflow.snapshot.tasks.find(task => identityKey(task.identity) === taskKey);
  const disconnected = Boolean(error) || (isDesktop && !snapshot.connectionPath);
  const view = session ? status(session, snapshot.now, disconnected) : { kind: 'idle', text: disconnected ? '연결 확인 필요' : snapshot.setup?.phase === 'connecting' ? '채팅 연결 대기' : '작업 연결 전' };
  const attention = session ? dueAttention(session, snapshot.now) : null;
  // Jobs an AI reported through MCP appear on the first pet. The app knows which AI, not which chat.
  const jobs = index === 0 && !disconnected ? snapshot.petJobs ?? [] : [];
  const reported = jobs.map(job => ({ job, notice: jobBubble(job) })).find(item => item.notice && !noticeSeen(item.notice.key));
  const openReported = async () => { if (!reported || !await openJobResult(reported.job)) setExpanded(true); };
  const working = activeJob(jobs, snapshot.now);
  const latest = jobs[0] && snapshot.now - jobs[0].updatedAt < JOB_ACTIVE_MS ? jobs[0] : undefined;
  const jobState: CompanionState = !latest ? 'idle' : latest.state === 'working' ? 'working' : latest.state === 'asking' ? 'waiting' : latest.state === 'failed' ? 'error' : 'complete';
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
    // Native resizing finishes after this effect; focusing must not scroll the compact window.
    overlay.current?.querySelector<HTMLButtonElement>('.pet-quick-card button')?.focus({ preventScroll: true });
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur); };
  }, [expanded]);
  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false; const disposers: (() => void)[] = [];
    const add = <T,>(name: string, fn: (payload: T) => void) => { void listen<T>(name, event => fn(event.payload)).then(remove => { if (disposed) remove(); else disposers.push(remove); }).catch(cause => { if (!disposed) setWindowError(String(cause)); }); };
    add<{ exceptSlot: number | null }>('autopets://collapse-pets', payload => { if (payload.exceptSlot !== index) setExpanded(false); });
    return () => { disposed = true; disposers.forEach(remove => remove()); };
  }, [index]);
  const explicit = snapshot.petLinks?.find(link => link.slot === index);
  if (explicit) {
    const active = explicit.connected && !disconnected && !explicit.run?.trackingClosed && (explicit.enabled || Boolean(explicit.run));
    const state = active ? explicit.run?.state : undefined;
    // A recommendation for this chat only changes the pet's badge and text; it never takes focus.
    const recommendation = visibleRecommendation(snapshot, explicit.target.threadId);
    const offered = recommendation && recommendation.state !== 'running' ? recommendation : undefined;
    const floatingStatus = offered ? recommendationStatus(offered) : explicitPetStatus(explicit, disconnected);
    // One click on the notice goes to the chat; if that cannot be done, the card opens instead.
    const openChat = async () => {
      if (!canReturnToPetTask(explicit)) { setExpanded(true); return; }
      try { const result = await command<{ status: string }>('open_pet_task', { target: explicit.target, expectedRevision: explicit.revision }); if (result?.status !== 'dispatched') setExpanded(true); }
      catch { setExpanded(true); }
    };
    return <div ref={overlay} className={`pet-overlay ${expanded ? 'expanded' : ''}`}>
      {expanded && <div className="quick-card-stack">{offered && <PetRecommendationCard item={offered} compact />}<PetJobList jobs={jobs} compact /><div className="pet-quick-card"><ExplicitPet link={explicit} disconnected={disconnected} showPet={false} onHide={() => { setExpanded(false); void action.run('set_pet_visible', { slot: index, visible: false }); }} /><button onClick={() => setExpanded(false)}>닫기</button></div></div>}
      <div className="floating-pet">
        <button className="pet-hit" aria-label={`${explicit.template.name} 메뉴${offered?.state === 'shown' ? ' · 펫 추천 있음' : ''}`} aria-expanded={expanded} title={moveHint} onClick={() => setExpanded(!expanded)} {...gesture.handlers}><TaskPetArt entry={catalogFor(explicit.template)} paused={!active} motion={explicitPetMotion(explicit, disconnected)} state={companionState(explicit, disconnected)} runKey={companionRunKey(explicit)} interactive={active} motionInput={gesture.motion} />{offered?.state === 'shown' && <span className="pet-recommendation-dot" aria-hidden="true">추천</span>}</button>
        <span className="floating-label" title={`${explicit.template.name} · Codex`}>{explicit.template.name}</span><PetBubble notice={reported?.notice ?? (offered ? null : linkBubble(explicit, disconnected))} onOpen={reported ? openReported : openChat}><span className={`floating-status ${offered ? 'recommend' : ''}`} title={floatingStatus}>{floatingStatus}</span></PetBubble>
      </div></div>;
  }
  const motion = disconnected || session?.connection !== 'observed' ? 'idle'
    : session.state === 'failed' || attention?.kind === 'tool-error' ? 'angry'
    : attention && attention.kind !== 'milestone' || session.state === 'waiting' ? 'dizzy'
    : session.state === 'done' && session.unread ? 'celebrate' : undefined;
  const help = disconnected || session?.connection !== 'observed' || attention ? view.text
    : workflowTask?.enabled ? workflow.error ? '설정 확인 필요' : workflowHelp(workflowTask, workflow.snapshot.capabilities[workflowTask.identity.provider]) || '계획 지침 준비됨'
    : workflowTask && !workflowTask.enabled ? '이번 채팅의 자동 도움은 꺼져 있어요'
    : helpTask && (!assistance.snapshot.preferences.enabled || !helpTask.enabled) ? '이번 채팅의 자동 도움은 꺼져 있어요'
    : session ? currentAction(session) : '함께할 작업을 기다려요';
  // The chat that started the app with `$autopets` and has no pet yet ("채팅 연결 대기"): its
  // recommendation is the only one without a link, and it is shown on the first, unassigned pet.
  const waitingRecommendation = !session && index === 0 && !disconnected ? snapshot.petRecommendations?.find(item =>
    !snapshot.petLinks?.some(link => link.target.threadId === item.target.threadId) && ['preparing', 'shown', 'accepted'].includes(item.state)) : undefined;
  return <div ref={overlay} className={`pet-overlay ${expanded ? 'expanded' : ''}`}>
    {expanded && <div className="quick-card-stack">{waitingRecommendation && <PetRecommendationCard item={waitingRecommendation} compact linked={false} />}<PetJobList jobs={jobs} compact /><PetQuickCard aiName={session ? 'Codex' : undefined} title={session?.label || '작업 연결 전'} help={help}
      goal={helpTask?.context.goal} constraints={helpTask?.context.constraints}
      currentStep={session?.planSteps?.find(step => step.status === 'in_progress')?.step}
      task={helpTask} workflowTask={workflowTask} defaultWorkStyle={assistance.snapshot.preferences.workStyle} assistanceEnabled={assistance.snapshot.preferences.enabled}
      disabled={!isDesktop || !!assistance.error} busy={action.busy} error={error || action.error || windowError} notice={notice}
      returnLabel={session && canAttemptReturn(session) ? '앱에서 열기 시도' : '작업명·ID 복사'} onReturn={session ? async () => {
        if (returning.current) return;
        if (canAttemptReturn(session)) {
          const target = returnTarget.current;
          returning.current = true;
          try { const message = await returnToTask(session); if (returnTarget.current === target) setNotice(message); }
          catch (cause) { if (returnTarget.current === target) setNotice(`${String(cause)} 작업 ID: ${session.id}`); }
          finally { returning.current = false; }
          return;
        }
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
    <div className="floating-pet">
      <button className="pet-menu-button" aria-expanded={expanded} aria-label="펫 메뉴" onClick={() => setExpanded(!expanded)}>⋯</button>
      {session ? <button className="pet-hit" aria-expanded={expanded} aria-label={`${session.label} · 작업 카드 열기`} title={moveHint} onClick={() => setExpanded(!expanded)} {...gesture.handlers}><PetAppearance template={appearance}><Pet index={index} activity={observedActivity(session, disconnected)} motion={motion} paused={disconnected || session.connection !== 'observed'} /></PetAppearance>{attention && <span className={`pet-attention-dot ${attention.kind}`} aria-label={view.text}>{attention.kind === 'elapsed' ? '◷' : attention.kind === 'milestone' ? '✓' : '!'}</span>}</button>
        : <UnassignedPetButton index={index} expanded={expanded} onToggle={() => setExpanded(!expanded)} gesture={gesture} recommended={waitingRecommendation?.state === 'shown'} state={jobState} runKey={latest?.state === 'done' ? latest.id : undefined} />}
      {session && <McpProp session={session} disconnected={disconnected} />}
      <span className="floating-label" title={session?.label}>{session?.unread && <i className="unread-dot" />}{session?.label ?? PET_NAMES[index]}</span>
      {waitingRecommendation ? <span className="floating-status recommend" title={recommendationStatus(waitingRecommendation)}>{recommendationStatus(waitingRecommendation)}</span>
        : <PetBubble notice={reported?.notice ?? (session ? sessionBubble(session, attention, disconnected) : null)} onOpen={async () => {
            if (reported) { await openReported(); return; }
            if (!session || !canAttemptReturn(session)) { setExpanded(true); return; }
            try { await returnToTask(session); } catch { setExpanded(true); }
          }}><span className={`floating-status ${view.kind}`} title={help}>{!session && working ? `${HOST_NAMES[working.host]}에서 작업 중` : help}</span></PetBubble>}
    </div>
  </div>;
}
