import { useEffect, useRef, useState, type ReactElement } from 'react';
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
import { usePetDock, type DockBadge } from './usePetDock';
import { PetDockHandle } from './PetDockHandle';
import { AttentionBubble, AttentionMark, attentionForSlot, attentionStatus, isAsk, markedAttention } from './PetAttention';

const moveHint = '클릭하면 작업 카드, 끌면 이동';

function UnassignedPetButton({ index, expanded, onToggle, gesture, recommended = false, mark, markLabel = '' }: { index: number; expanded: boolean; onToggle: () => void; gesture: ReturnType<typeof usePetGesture>; recommended?: boolean; mark?: ReactElement | false; markLabel?: string }) {
  const [interaction, setInteraction] = useState(0);
  const react = () => setInteraction(value => value + 1);
  return <button className="pet-hit" aria-expanded={expanded} aria-label={`${PET_NAMES[index]} · 작업 카드 열기${recommended ? ' · 펫 추천 있음' : ''}${markLabel}`} title={moveHint} onClick={onToggle} {...gesture.handlers}
    onPointerDown={event => { gesture.handlers.onPointerDown(event); if (event.button === 0) react(); }}
    onKeyDown={event => { if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) react(); }}>
    <span className="overlay-idle-pet"><CompanionPet state="idle" interaction={interaction} motionInput={gesture.motion} /></span>
    {recommended && <span className="pet-recommendation-dot below-menu" aria-hidden="true">추천</span>}
    {mark}
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
  // Codex attention bubble: which notice it shows (null = closed).
  const [bubbleId, setBubbleId] = useState<string | null>(null);
  const bubbled = useRef(new Set<string>());
  // Dragging the pet body moves its window; the open card and the bubble close first.
  const gesture = usePetGesture({ onDragStart: () => { setExpanded(false); setBubbleId(null); } });
  // Dropped at the left or right screen edge, the pet tucks into a small handle there.
  const dock = usePetDock(index);
  const dockHandle = (name: string, badge: DockBadge, peek: ReactElement) => dock.edge &&
    <PetDockHandle edge={dock.edge} name={name} badge={badge} restoring={dock.phase === 'restoring'} error={dock.error} onRestore={dock.restore}>{peek}</PetDockHandle>;
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
  // A connected Codex chat needs the user, or its requested work finished. The bubble opens by
  // itself once per new notice, only while the pet is out and its card is closed. It never takes
  // focus or moves the pet; a docked pet shows it on its handle instead.
  const notices = attentionForSlot(snapshot, index);
  const marked = markedAttention(notices);
  const unread = notices.find(item => !item.read);
  const bubble = notices.find(item => item.id === bubbleId);
  const noticeOpen = Boolean(bubble) && !expanded && dock.phase === 'shown';
  useEffect(() => {
    if (!unread || bubbled.current.has(unread.id) || expanded || dock.phase !== 'shown') return;
    bubbled.current.add(unread.id); setBubbleId(unread.id);
  }, [unread?.id, expanded, dock.phase]);
  // Clicking the handle brings the pet back with the waiting notice open.
  useEffect(() => { if (dock.phase === 'entering' && marked) { bubbled.current.add(marked.id); setBubbleId(marked.id); } }, [dock.phase]);
  const markLabel = marked ? ` · ${attentionStatus(marked)}` : '';
  const codexBadge: DockBadge = marked ? (isAsk(marked) ? 'codex-ask' : 'codex-done') : null;
  // Codex called AutoPets in a chat: this pet is out already and the chat connection follows.
  // "Codex 연결 중" until the app has that chat as its setup chat, then the usual status again.
  const [summon, setSummon] = useState<{ chatId: string | null; at: number; phase: 'connecting' | 'connected' | 'failed' } | null>(null);
  const links = useRef(snapshot.petLinks ?? []);
  links.current = snapshot.petLinks ?? [];
  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false; let remove: (() => void) | undefined;
    void listen<{ chatId: string | null; at: number }>('autopets://pet-summoned', ({ payload }) => {
      const slot = links.current.find(link => link.target.threadId === payload.chatId)?.slot ?? 0;
      if (slot === index) setSummon({ chatId: payload.chatId, at: payload.at, phase: 'connecting' });
    }).then(unlisten => { if (disposed) unlisten(); else remove = unlisten; }).catch(() => undefined);
    return () => { disposed = true; remove?.(); };
  }, [index]);
  const setupChatId = snapshot.setup?.setupChat?.threadId ?? null;
  useEffect(() => {
    if (summon?.phase !== 'connecting' || snapshot.now < summon.at) return;
    if (summon.chatId ? setupChatId === summon.chatId : Boolean(setupChatId)) setSummon({ ...summon, phase: 'connected' });
  }, [summon, snapshot.now, setupChatId]);
  useEffect(() => {
    if (!summon) return;
    const timer = setTimeout(() => setSummon(current => current && current.at === summon.at
      ? current.phase === 'connecting' ? { ...current, phase: 'failed' } : null : current), summon.phase === 'connecting' ? 30000 : summon.phase === 'connected' ? 3000 : 8000);
    return () => clearTimeout(timer);
  }, [summon]);
  const summonText = summon?.phase === 'connecting' ? 'Codex 연결 중…' : summon?.phase === 'connected' ? 'Codex 채팅과 연결됨' : summon ? 'Codex 연결 확인 필요' : '';
  const summonStatus = summon && <span className={`floating-status summon ${summon.phase}`} role="status" title={summonText}>{summonText}</span>;
  const codexStatus = marked && <span className={`floating-status codex-${isAsk(marked) ? 'ask' : 'done'}`} title={marked.summary}>{attentionStatus(marked)}</span>;
  const noticeBubble = noticeOpen && bubble && <AttentionBubble item={bubble} more={notices.length - 1} onDone={() => setBubbleId(null)} />;
  const noticeCard = marked && <AttentionBubble item={marked} card more={notices.length - 1} />;
  // Development diagnostics: tell the app where this pet drew the notice (ids only).
  const drawnOn = !marked ? null : dock.handle ? 'handle' : expanded ? 'card' : noticeOpen && bubble?.id === marked.id ? 'bubble' : 'mark';
  useEffect(() => {
    if (isDesktop && marked && drawnOn) void command('mark_codex_attention_displayed', { id: marked.id, surface: drawnOn }).catch(() => undefined);
  }, [marked?.id, drawnOn]);
  useEffect(() => { setExpanded(false); setNotice(''); }, [session?.id]);
  useEffect(() => {
    if (isDesktop) resizeQueue.current = resizeQueue.current.catch(() => undefined).then(() => command('set_pet_expanded', { expanded, notice: noticeOpen })).catch(cause => setWindowError(String(cause)));
  }, [expanded, noticeOpen]);
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
    if (dock.handle) {
      const badge: DockBadge = codexBadge ?? (offered?.state === 'shown' || state === 'waiting' || state === 'returned' || state === 'failed' || state === 'unknown' ? 'ask' : state === 'complete' ? 'done' : null);
      return dockHandle(explicit.template.name, badge, <TaskPetArt entry={catalogFor(explicit.template)} state={companionState(explicit, disconnected)} interactive={false} />);
    }
    return <div ref={overlay} className={`pet-overlay ${expanded ? 'expanded' : ''}${noticeOpen ? ' codex-notice' : ''}${dock.overlayClass}`}>
      {noticeBubble}
      {expanded && <div className="quick-card-stack">{noticeCard}{offered && <PetRecommendationCard item={offered} compact />}<div className="pet-quick-card"><ExplicitPet link={explicit} disconnected={disconnected} showPet={false} onHide={() => { setExpanded(false); void action.run('set_pet_visible', { slot: index, visible: false }); }} /><button onClick={() => setExpanded(false)}>닫기</button></div></div>}
      <div className="floating-pet">
        <button className="pet-hit" aria-label={`${explicit.template.name} 메뉴${offered?.state === 'shown' ? ' · 펫 추천 있음' : ''}${markLabel}`} aria-expanded={expanded} title={moveHint} onClick={() => setExpanded(!expanded)} {...gesture.handlers}><TaskPetArt entry={catalogFor(explicit.template)} paused={!active} motion={explicitPetMotion(explicit, disconnected)} state={companionState(explicit, disconnected)} runKey={companionRunKey(explicit)} interactive={active} motionInput={gesture.motion} />{offered?.state === 'shown' && <span className="pet-recommendation-dot" aria-hidden="true">추천</span>}{marked && <AttentionMark item={marked} />}</button>
        <span className="floating-label" title={`${explicit.template.name} · Codex`}>{explicit.template.name}</span>{summonStatus || codexStatus || <span className={`floating-status ${offered ? 'recommend' : ''}`} title={floatingStatus}>{floatingStatus}</span>}
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
  if (dock.handle) {
    const badge: DockBadge = codexBadge ?? (waitingRecommendation?.state === 'shown' || (attention && attention.kind !== 'milestone') || session?.state === 'waiting' ? 'ask'
      : attention?.kind === 'milestone' || (session?.state === 'done' && session.unread) ? 'done' : null);
    return dockHandle(session?.label ?? PET_NAMES[index], badge, session
      ? <PetAppearance template={appearance}><Pet index={index} paused /></PetAppearance>
      : <CompanionPet state="idle" paused />);
  }
  return <div ref={overlay} className={`pet-overlay ${expanded ? 'expanded' : ''}${noticeOpen ? ' codex-notice' : ''}${dock.overlayClass}`}>
    {noticeBubble}
    {expanded && <div className="quick-card-stack">{noticeCard}{waitingRecommendation && <PetRecommendationCard item={waitingRecommendation} compact linked={false} />}<PetQuickCard aiName={session ? 'Codex' : undefined} title={session?.label || '작업 연결 전'} help={help}
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
      {session ? <button className="pet-hit" aria-expanded={expanded} aria-label={`${session.label} · 작업 카드 열기${markLabel}`} title={moveHint} onClick={() => setExpanded(!expanded)} {...gesture.handlers}><PetAppearance template={appearance}><Pet index={index} activity={observedActivity(session, disconnected)} motion={motion} paused={disconnected || session.connection !== 'observed'} /></PetAppearance>{attention && <span className={`pet-attention-dot ${attention.kind}`} aria-label={view.text}>{attention.kind === 'elapsed' ? '◷' : attention.kind === 'milestone' ? '✓' : '!'}</span>}{marked && <AttentionMark item={marked} />}</button>
        : <UnassignedPetButton index={index} expanded={expanded} onToggle={() => setExpanded(!expanded)} gesture={gesture} recommended={waitingRecommendation?.state === 'shown'} mark={marked && <AttentionMark item={marked} />} markLabel={markLabel} />}
      {session && <McpProp session={session} disconnected={disconnected} />}
      <span className="floating-label" title={session?.label}>{session?.unread && <i className="unread-dot" />}{session?.label ?? PET_NAMES[index]}</span>
      {summonStatus || codexStatus || (waitingRecommendation ? <span className="floating-status recommend" title={recommendationStatus(waitingRecommendation)}>{recommendationStatus(waitingRecommendation)}</span>
        : <span className={`floating-status ${view.kind}`} title={help}>{help}</span>)}
    </div>
  </div>;
}
