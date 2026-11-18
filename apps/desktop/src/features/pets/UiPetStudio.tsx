import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PetJob, PetLink, PetRecommendation, PetRoleSnapshot, PetRoleTemplate, SavedPet, SetupState, Snapshot, WorkflowModel, WorkflowReasoning } from '@autopets/contracts/types';
import template from '../../../../../packages/contracts/data/ui-pet.json';
import routing from '../../../../../packages/contracts/data/routing-profiles.json';
import { petCatalog, catalogFor, type PetCatalogEntry } from './petCatalog';
import { command, isDesktop } from '../../bridge/command';
import { useRoles } from '../../bridge/useRoles';
import { TaskPetArt, ResultPreview } from './TaskPetArt';
import { PetWorkspace, type PetWorkspaceView } from './PetWorkspace';
import { PetTaskReturn, canStartNewPetTask } from './PetTaskReturn';
import { unresolvedPetRun } from './ExplicitPet';
import { FavoriteButton } from './PetIntroduction';
import { PetSkillSource } from './PetSkillSource';
import { PetPreferencesConnector, runClaudeAction } from '../onboarding/PetPreferencesConnector';
import { PetRecommendationCard } from './PetRecommendation';

import { usePetFavorites } from './usePetFavorites';
import './ui-pet-studio.css';
import './first-success.css';
import './pet-composer-simple.css';

export const FIGMA_GUIDE = 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/#codex';
const EXAMPLE_TASK = '가상 학과 행사 소개 웹페이지 한 장. 행사 소개, 일정, 신청 안내와 모바일 화면을 포함해줘.';
const codexRouting = routing.hosts['codex-windows-local'].profiles;
const matchesProfile = (value: WorkflowModel, key: keyof typeof codexRouting) => value.model === codexRouting[key].model && value.reasoning === codexRouting[key].effort;
const planOptions = routing.hosts['codex-windows-local'].planOptions;
const supportedRouting = (draft: PetRoleTemplate) => (!draft.planning || planOptions.some(option => draft.planning!.model === option.model && draft.planning!.reasoning === option.effort)) && (!draft.execution || executionProfiles.some(profile => matchesProfile(draft.execution!, profile.id)));
const targetKey = (link: PetLink) => JSON.stringify([link.target.sourceId, link.target.threadId, link.target.cwd]);
const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)])) : value;
const sameTemplate = (left: PetRoleTemplate, right: PetRoleTemplate) => JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
const explicitSetupReady = (setup?: SetupState | null) => setup?.connectionMode === 'explicit-pet' && setup.connections?.some(connection => connection.hostId === 'codex-windows-local' && connection.configured) === true;
// Single source shared with delegation.mjs and Rust: packages/contracts/data/routing-profiles.json.
const executionProfiles = (['light', 'standard', 'careful'] as const).map(id => ({ id, label: routing.profiles[id].label, description: routing.profiles[id].description,
  model: codexRouting[id].model, reasoning: codexRouting[id].effort as WorkflowReasoning }));

// Preserve order across quick navigation and React effect cleanup/remount.
let onboardingCommands = Promise.resolve();
function setOnboardingActive(active: boolean) {
  const request = onboardingCommands.then(() => command('set_onboarding_active', { active }));
  onboardingCommands = request.catch(() => undefined);
  return request;
}

type TaskContext = { audience?: string; message?: string; newTask?: boolean };
type Handoff = { petId: string; petRevision: number; previousRuns: string[] };
type ComposerDraft = { task: string; audience: string; message: string; draft: PetRoleTemplate; saved: SavedPet | null; dirty: boolean;
  prompt: string; copied: boolean; manualCopy: boolean; notice: string; handoff: Handoff | null; reuseTarget: PetLink['target'] | null; newTask: boolean };

const CODEX_OPENED = 'Codex 새 대화에 요청을 넣었어요. 보내기만 누르세요.';
// "현재 채팅에서 계속하기": the chat that ran `$autopets` opens with the request typed in; the user sends it.
const CHAT_FILLED = 'Codex 채팅 입력창에 요청을 넣었어요. 보내기만 누르세요.';
const shortChat = (chat: { threadId: string; cwd: string }) => `${chat.cwd.split(/[\\/]/).filter(Boolean).pop()} · ${chat.threadId.slice(-8)}`;
// Start choices the viewer made last time. UI-only: never chat contents or requests.
type StartHost = 'codex' | 'claude';
type StartPrefs = { version: 1; host?: StartHost; profile?: 'light' | 'standard' | 'careful'; codexConnectOk?: boolean; claudeInstallOpened?: boolean };
const START_PREFS = 'autopets.start-preferences.v1';
function readStartPrefs(): StartPrefs {
  try {
    const value = JSON.parse(localStorage.getItem(START_PREFS) ?? 'null');
    if (value?.version !== 1) return { version: 1 };
    return { version: 1, host: value.host === 'codex' || value.host === 'claude' ? value.host : undefined,
      profile: ['light', 'standard', 'careful'].includes(value.profile) ? value.profile : undefined,
      codexConnectOk: value.codexConnectOk === true, claudeInstallOpened: value.claudeInstallOpened === true };
  } catch { return { version: 1 }; }
}
function writeStartPrefs(value: StartPrefs) {
  try { localStorage.setItem(START_PREFS, JSON.stringify(value)); } catch { /* A per-viewer convenience only. */ }
}
// An empty task is allowed only where the chat already holds the request (the chat that ran `$autopets`).
export const uiPetStartPrompt = (pet: SavedPet, task = EXAMPLE_TASK, context: TaskContext = {}) => [
  `AutoPets 스킬로 현재 채팅에 ${pet.template.name}을 연결해줘. 저장한 펫: petId=${pet.id}, petRevision=${pet.revision}.`,
  task.trim() ? `이 펫으로 아래 작업${pet.template.planFirst ? '의 계획만 세워줘' : '을 수행하고 결과를 채팅에 보여줘'}.\n\n${task.trim()}\n`
    : `이 채팅에서 앞서 요청한 일을 이 펫으로 ${pet.template.planFirst ? '이어받아 계획만 세워줘' : '이어서 진행하고 결과를 채팅에 보여줘'}.`,
  ...(catalogFor(pet.template)?.id === 'ui-webpage' ? [context.audience?.trim() && `이 페이지를 볼 사람: ${context.audience.trim()}`, context.message?.trim() && `꼭 알릴 내용: ${context.message.trim()}`].filter(Boolean) : []),
  ...(context.newTask ? ['새로운 작업이야. 이전 작업의 내용이나 계획 승인을 이 요청에 재사용하지 마.'] : []),
  pet.template.features?.figmaDesign ? 'Figma 시안 활용 특성을 선택했어. 사용할 프레임 링크를 나에게 먼저 확인하고, 실제 시안을 읽은 뒤 계획해줘. 연결이나 접근이 안 되면 필요한 조치를 알려줘.' : '별도 서비스 연결 없이 가능한 범위부터 도와주고, 외부 서비스가 필요하면 먼저 알려줘.',
  pet.template.planFirst ? '지금은 파일을 바꾸지 말고 계획을 보여준 뒤 내 구현 요청을 기다려줘. 구현 위치와 기존 파일을 먼저 확인하고 기존 내용을 덮어쓰지 마.' : '파일을 수정하거나 외부 서비스에 등록하지 말고, 제공한 내용을 바탕으로 결과를 보여줘. 확인할 수 없는 사실은 미확인으로 구분해줘.',
  ...(task.trim() === EXAMPLE_TASK ? ['이 예시에는 실제 개인정보 대신 가상 내용을 사용하고, 구현할 때는 새 autopets-demo 폴더를 사용하되 기존 파일이 있으면 먼저 알려줘.'] : []),
].join('\n');

export function UiPetStudio({ links, jobs = [], recommendations = [], recommendationOpen = null, setup, onConnection, active = true, view = 'home', navigationRevision = 0, onBrowse, legacy, disconnected = false, onBusyChange }: { links: PetLink[]; jobs?: PetJob[]; recommendations?: PetRecommendation[]; recommendationOpen?: { id: string; petId: string | null; nonce: number } | null; setup?: SetupState | null; onConnection: () => void; active?: boolean; view?: PetWorkspaceView; navigationRevision?: number; onBrowse: () => void; legacy?: ReactNode; disconnected?: boolean; onBusyChange: (busy: boolean) => void }) {
  const library = useRoles();
  const favorites = usePetFavorites();
  const [open, setOpen] = useState(false);
  // "바꾸기": where to start, help style, chat and the less common actions, folded under the start button.
  const [changeOpen, setChangeOpen] = useState(false);
  const [prefs, setPrefs] = useState(readStartPrefs);
  const updatePrefs = (patch: Partial<StartPrefs>) => setPrefs(current => { const next = { ...current, ...patch }; writeStartPrefs(next); return next; });
  // One line in place of the start button: each finished step gets a check mark.
  const [progress, setProgress] = useState<{ steps: string[]; done: number } | null>(null);
  const [pendingChoice, setPendingChoice] = useState<'host' | 'connect' | null>(null);
  const [connectBlocked, setConnectBlocked] = useState(false);

  const [draft, setDraft] = useState<PetRoleTemplate>(() => structuredClone(template) as PetRoleTemplate);
  const [category, setCategory] = useState<'all' | 'daily' | 'work'>('all');
  // User-written drafts remain in this manager session, never in telemetry or the public DB.
  const drafts = useRef<Record<string, ComposerDraft>>({});
  // Home requests have their own drafts, so a new brief cannot overwrite a role or saved pet draft.
  const homeDraftKeys = useRef(new Map<string, string>());
  const draftKey = useRef('role:ui-webpage');
  const [manualCopy, setManualCopy] = useState(false);
  const selectionButton = useRef<HTMLElement | null>(null);
  const selectionChat = useRef<string | null>(null);
  const listScroll = useRef(0);
  const [saved, setSaved] = useState<SavedPet | null>(null);
  const [dirty, setDirty] = useState(true);
  const [staleSaved, setStaleSaved] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [applied, setApplied] = useState<PetLink | null>(null);
  const [localSetup, setLocalSetup] = useState<SetupState | null>(null);
  const [prompt, setPrompt] = useState('');
  const [task, setTask] = useState('');
  const [audience, setAudience] = useState('');
  const [message, setMessage] = useState('');
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [reuseTarget, setReuseTarget] = useState<PetLink['target'] | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [overlayError, setOverlayError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmChat, setConfirmChat] = useState(false);
  const working = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const promptField = useRef<HTMLTextAreaElement>(null);
  const savedSelector = useRef<HTMLSelectElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const connectionKey = JSON.stringify([disconnected, selectedTarget, links.find(link => targetKey(link) === selectedTarget)?.connected ?? null]);
  const currentContext = useRef({ links, disconnected, selectedTarget, open, active, navigationRevision, view, draftKey: draftKey.current, connectionKey, connectionEpoch: 0 });
  currentContext.current = { links, disconnected, selectedTarget, open, active, navigationRevision, view, draftKey: draftKey.current, connectionKey,
    connectionEpoch: currentContext.current.connectionEpoch + (currentContext.current.connectionKey === connectionKey ? 0 : 1) };

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const setupKey = JSON.stringify(setup?.connections);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => { if (open) remember(); setChangeOpen(false); setOpen(false); }, [view, navigationRevision]);
  useEffect(() => { if (open && active) { window.scrollTo(0, 0); heading.current?.focus({ preventScroll: true }); } }, [open, active]);
  const close = () => { if (!working.current) { remember(); setChangeOpen(false); setOpen(false); requestAnimationFrame(() => {
      const label = selectionButton.current?.getAttribute('aria-label');
      const selected = label ? [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label && button.offsetParent !== null) : null;
      const previousCard = selectionChat.current ? [...document.querySelectorAll<HTMLElement>('.workspace-live-card')].find(card => card.querySelector('.explicit-target')?.getAttribute('title') === selectionChat.current) : null;
      window.scrollTo(0, listScroll.current);
      (selected ?? previousCard?.querySelector<HTMLButtonElement>('.explicit-next') ?? document.querySelector<HTMLButtonElement>(`.workspace-role-card[data-role="${entry.id}"] .workspace-role-select`) ?? document.querySelector<HTMLButtonElement>('.nav-item[aria-current="page"]'))?.focus({ preventScroll: true });
    }); } };
  useEffect(() => {
    if (notice.startsWith('자동 복사가 되지 않았어요.')) promptField.current?.focus();
  }, [notice]);
  useEffect(() => { setLocalSetup(null); }, [setupKey]);
  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false;
    void setOnboardingActive(open && active).then(() => { if (!disposed) setOverlayError(''); }).catch(() => { if (!disposed) setOverlayError('바탕화면 펫을 잠시 숨기지 못했어요. 화면을 가리면 펫 메뉴에서 숨겨 주세요.'); });
    return () => { disposed = true; void setOnboardingActive(false).catch(() => undefined); };
  }, [open, active]);
  const currentSetup = localSetup ?? setup;
  const prepared = explicitSetupReady(currentSetup);
  const target = links.find(link => targetKey(link) === selectedTarget);
  const matchingLinks = saved && !dirty && !staleSaved ? links.filter(link => link.connected && link.savedPet?.id === saved.id && link.savedPet.revision === saved.revision) : [];
  const uiPets = library.snapshot.pets.filter(pet => catalogFor(pet.template));
  const entry = catalogFor(draft) ?? petCatalog.find(item => item.id === 'ui-webpage')!;
  const favoriteId = saved ? `saved:${saved.id}` : `template:${entry.id}`;
  const savedChanged = Boolean(saved && !dirty && library.loaded && !library.error && !library.snapshot.pets.some(pet => pet.id === saved.id && pet.revision === saved.revision));
  const stale = staleSaved || savedChanged;
  useEffect(() => {
    if (open && active && (error || savedChanged || library.error || favorites.error)) {
      feedback.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [open, active, error, savedChanged, library.error, favorites.error]);
  const previousChat = reuseTarget ? links.find(link => JSON.stringify(link.target) === JSON.stringify(reuseTarget)) : undefined;
  const destinations = stale || dirty ? [] : previousChat ? [previousChat] : matchingLinks;
  const newRecords = handoff && !stale && !disconnected ? matchingLinks.filter(link => link.run && !link.run.trackingClosed
    && link.run.savedPet?.id === handoff.petId && link.run.savedPet.revision === handoff.petRevision
    && !handoff.previousRuns.includes(JSON.stringify([link.target, link.run.id]))) : [];

  const disabled = busy || stale || !isDesktop || !library.loaded || Boolean(library.error);
  const figma = draft.features?.figmaDesign === true;
  const routingSupported = supportedRouting(draft);
  const executionProfile = executionProfiles.find(profile => profile.model === (draft.execution?.model ?? 'gpt-6-luna') && profile.reasoning === (draft.execution?.reasoning ?? 'low'));
  const confirmedTarget = applied && target && !dirty && !stale && !disconnected
    && target.connected && target.enabled && !unresolvedPetRun(target)
    && targetKey(applied) === targetKey(target) && target.revision === applied.revision
    && target.savedPet?.id === applied.savedPet?.id && target.savedPet?.revision === applied.savedPet?.revision
    && target.profile === applied.profile && sameTemplate(target.template, applied.template) ? target : null;
  useEffect(() => {
    if (applied && (disconnected || !target || !target.connected || !target.enabled || target.revision > applied.revision)) setApplied(null);
  }, [applied, target, disconnected]);
  // The chat that ran `$autopets`. Requests go only there; another chat is never guessed.
  const setupChat = currentSetup?.setupChat ?? null;
  const otherChatSelected = Boolean(target && setupChat && target.target.threadId !== setupChat.threadId);
  useEffect(() => { setConfirmChat(false); }, [prompt, setupChat?.threadId, selectedTarget]);
  const targetBlocker = disconnected ?'앱 연결을 확인해 주세요.' : target && !target.connected ? 'Codex에서 “펫 상태 확인”이라고 말해 주세요.'
    : target && !target.enabled ? '펫 도움이 꺼져 있어요. 내 작업에서 켜 주세요.'
    : target && unresolvedPetRun(target) ? '진행 중인 펫 작업을 먼저 확인해 주세요.' : '';
  const invalidateRequest = () => { setPrompt(''); setNotice(''); setCopied(false); setManualCopy(false); setHandoff(null); };
  const editDraft = (next: PetRoleTemplate) => { setApplied(null); setDraft(next); setDirty(true); invalidateRequest(); };
  // keepRequest: copying keeps the confirmed request on screen, but a failure still clears it.
  const run = async (operation: () => Promise<void>, isCurrent = () => mounted.current, keepRequest = false) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); if (!keepRequest) invalidateRequest();
    try { await operation(); }
    catch (cause) {
      if (!isCurrent()) return;
      if (keepRequest) invalidateRequest();
      const value = String(cause);
      const changed = /revision|stale|conflict/.test(value);
      const savedChanged = /saved[- ]pet.*(?:revision|stale|changed|not-found)/i.test(value);
      if (savedChanged) setStaleSaved(true);
      setError(savedChanged ? '저장한 펫이 다른 곳에서 바뀌었어요. 최신 구성을 다시 선택해 주세요.' : changed ? '채팅 설정이 바뀌었어요. 대상을 다시 확인해 주세요.' : '처리하지 못했어요. 연결 설정을 확인하고 다시 시도해 주세요.');
      await library.refresh();
    } finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const save = async (isCurrent = () => mounted.current) => {
    let result = saved;
    if (!result || dirty) {
      result = await command<SavedPet>('save_pet', { id: saved?.id ?? null, expectedRevision: saved?.revision ?? 0, template: draft });
      if (isCurrent()) { setSaved(result); setDraft(structuredClone(result.template)); setDirty(false); }
    }
    // A previous copy is only reusable while this exact saved revision still exists.
    // Query the host again, including after a save; React's last event may be stale.
    const current = await command<PetRoleSnapshot>('roles_snapshot');
    if (!current || !Array.isArray(current.pets) || !Array.isArray(current.templates) || !Array.isArray(current.bindings)) throw Error('saved-pet-verification-unavailable');
    const latest = current.pets.find(pet => pet.id === result.id);
    if (!latest || latest.revision !== result.revision || !sameTemplate(latest.template, result.template)) throw Error('saved-pet-revision-changed');
    await library.refresh();
    return result;
  };
  const copy = async (value: string, pet: SavedPet) => {
    setPrompt(value); setManualCopy(false);
    setHandoff({ petId: pet.id, petRevision: pet.revision, previousRuns: links.filter(link => link.run).map(link => JSON.stringify([link.target, link.run!.id])) });
    try { await navigator.clipboard.writeText(value); setCopied(true); setNotice('쓸 Codex 채팅에 붙여넣고 보내세요.'); }
    catch { setManualCopy(true); setChangeOpen(true); setNotice('자동 복사가 되지 않았어요. 아래 요청을 직접 선택해 복사해 주세요.'); }
  };
  // The former "Codex에 펫 준비": Codex's own connector runs once, then reports readiness.
  const connectCodex = async () => {
    const result = await command<SetupState>('connect_ai', { hostId: 'codex-windows-local' });
    setLocalSetup(result);
    const ready = explicitSetupReady(result);
    setNotice([ready ? 'Codex 연결 준비됨' : '연결 설정을 확인해 주세요.', ...(result.warnings ?? [])].join(' '));
    return ready;
  };
  // '확인' saves and verifies the pet as copying used to, then only shows the request below.
  // It never copies or sends. Any later edit clears it (invalidateRequest), so it must be confirmed again.
  const confirmRequest = () => run(async () => { if (!task.trim()) throw Error('empty task'); const pet = await save(); setPrompt(uiPetStartPrompt(pet, task, { audience, message, newTask })); });
  // Copy re-checks the saved pet and copies only the request that is on screen.
  const copyRequest = () => run(async () => {
    if (!prompt || !task.trim()) throw Error('request not confirmed');
    const pet = await save(); const value = uiPetStartPrompt(pet, task, { audience, message, newTask });
    if (value !== prompt) { invalidateRequest(); setError('요청 내용이 바뀌었어요. 확인을 다시 눌러 주세요.'); return; }
    await copy(value, pet);
  }, undefined, true);
  // A new Codex thread opens with the start request in its composer; the user
  // still presses send. Requests too long for a link fall back to copying.
  const openInCodex = async (pet: SavedPet, value: string) => {
    try { await command('open_pet_in_codex', { petId: pet.id, expectedRevision: pet.revision, prompt: value }); }
    catch (cause) { if (/prompt-too-long/.test(String(cause))) { await copy(value, pet); return false; } throw cause; }
    setPrompt(value); setManualCopy(false); setCopied(false);
    setHandoff({ petId: pet.id, petRevision: pet.revision, previousRuns: links.filter(link => link.run).map(link => JSON.stringify([link.target, link.run!.id])) });
    setNotice(CODEX_OPENED);
    return true;
  };
  // Connecting happens only from the start button, never on entering a pet.
  const connectIfNeeded = async () => {
    if (prepared || await connectCodex()) return true;
    setConnectBlocked(true); return false;
  };
  const step = (done: number) => setProgress(current => current && { ...current, done });
  // Start in a new Codex chat: save → connect once → open the chat holding the request. Nothing is sent.
  const startInCodex = () => run(async () => {
    if (!task.trim()) throw Error('empty task');
    setProgress({ steps: ['펫 저장', 'Codex 연결', '새 대화 열림'], done: 0 });
    const pet = await save(); step(1);
    if (!await connectIfNeeded()) return;
    step(2);
    if (await openInCodex(pet, uiPetStartPrompt(pet, task, { audience, message, newTask }))) step(3); else setProgress(null);
  });
  // Start in the chat that ran `$autopets` ("현재 채팅에서 계속하기"): that chat opens with the
  // request typed into its composer; the user presses send. No connect step here: the chat's own
  // `$autopets` call already connected it, and reconnecting would forget which chat called.
  const startInChat = (confirmed = false) => run(async () => {
    const chat = setupChat;
    if (!chat) throw Error('setup-chat-unavailable');
    if (otherChatSelected && !confirmed) { setConfirmChat(true); return; }
    setConfirmChat(false);
    setProgress({ steps: ['펫 저장', '채팅에 입력'], done: 0 });
    const pet = await save(); step(1);
    const value = uiPetStartPrompt(pet, task, { audience, message, newTask });
    try { await command('open_pet_in_codex_chat', { petId: pet.id, expectedRevision: pet.revision, prompt: value, threadId: chat.threadId, cwd: chat.cwd }); }
    catch (cause) {
      if (/prompt-too-long/.test(String(cause))) { await copy(value, pet); setProgress(null); return; }
      if (/setup-chat-(?:changed|unavailable)/.test(String(cause))) { setError('펫을 부른 Codex 채팅이 바뀌었어요. 이어서 할 채팅에서 /오토펫을 다시 불러 주세요.'); return; }
      throw cause;
    }
    setPrompt(value); setManualCopy(false); setCopied(false);
    setHandoff({ petId: pet.id, petRevision: pet.revision, previousRuns: links.filter(link => link.run).map(link => JSON.stringify([link.target, link.run!.id])) });
    setNotice(CHAT_FILLED);
    step(2);
  });
  // Start in Claude: the connector's own actions. Until its install window was opened once, install first.
  const startInClaude = () => run(async () => {
    const action = prefs.claudeInstallOpened ? 'use' : 'install';
    setProgress({ steps: ['펫 저장', action === 'install' ? 'Claude 설치 창 열림' : 'Claude 새 대화 열림'], done: 0 });
    const pet = await save(); step(1);
    let text: string;
    try { text = await runClaudeAction(action, pet); }
    catch (cause) { setError((cause as Error).message); return; }
    if (action === 'install') updatePrefs({ claudeInstallOpened: true });
    setNotice(action === 'install' ? `${text} 설치한 뒤 다시 시작을 누르면 새 대화가 열려요.` : text);
    step(2);
  });
  const saveToLibrary = () => {
    const scope = { key: draftKey.current, view, navigationRevision };
    const stillHere = () => mounted.current && currentContext.current.open && currentContext.current.active
      && currentContext.current.draftKey === scope.key && currentContext.current.view === scope.view
      && currentContext.current.navigationRevision === scope.navigationRevision;
    return run(async () => { await save(stillHere); }, stillHere);
  };
  const selectSaved = (item?: SavedPet) => {
    remember();
    const nextEntry = item ? catalogFor(item.template) ?? entry : entry;
    const sameRole = nextEntry.id === entry.id;
    const key = sameRole && !draftKey.current.startsWith('saved:') ? draftKey.current : item ? `saved:${item.id}` : `role:${nextEntry.id}`;
    const previous = drafts.current[key] ?? (sameRole ? drafts.current[draftKey.current] : undefined);
    // Selecting a current configuration refreshes settings, but never moves one role's brief into another.
    enter(key, { ...freshDraft(nextEntry, item ?? null), task: previous?.task ?? '',
      audience: previous?.audience ?? '', message: previous?.message ?? '',
      reuseTarget: sameRole ? reuseTarget : null, newTask: sameRole ? newTask : false });
  };
  function remember() {
    drafts.current[draftKey.current] = { task, audience, message, draft: structuredClone(draft), saved, dirty, prompt, copied, manualCopy, notice, handoff, reuseTarget, newTask };
  }
  const enter = (key: string, value: ComposerDraft, targetOverride?: string) => {
    setChangeOpen(false); setProgress(null); setPendingChoice(null); setConnectBlocked(false);
    draftKey.current = key;
    setDraft(structuredClone(value.draft)); setSaved(value.saved); setDirty(value.dirty); setStaleSaved(false); setError('');
    setTask(value.task); setAudience(value.audience); setMessage(value.message); setPrompt(value.prompt); setCopied(value.copied);
    setManualCopy(value.manualCopy); setNotice(value.notice); setHandoff(value.handoff); setReuseTarget(value.reuseTarget); setNewTask(value.newTask);
    // The only eligible chat is preselected, except when `$autopets` was run from a chat:
    // start then goes to that calling chat, so nothing else is guessed.
    const available = disconnected || setupChat ? [] : links.filter(link => link.connected && link.enabled && !unresolvedPetRun(link));
    setSelectedTarget(targetOverride ?? (value.reuseTarget ? JSON.stringify([value.reuseTarget.sourceId, value.reuseTarget.threadId, value.reuseTarget.cwd])
      : available.length === 1 ? targetKey(available[0]) : ''));
    setApplied(null);
    selectionButton.current = document.activeElement as HTMLElement; setOpen(true);
  };
  // A new pet starts with the help style chosen last time; a saved pet keeps its own.
  const freshTemplate = (next: PetCatalogEntry, item: SavedPet | null) => {
    const value = structuredClone(item?.template ?? next.template);
    const remembered = !item && executionProfiles.find(profile => profile.id === prefs.profile);
    if (remembered) value.execution = { model: remembered.model, reasoning: remembered.reasoning };
    return value;
  };
  const freshDraft = (next: PetCatalogEntry, item: SavedPet | null = null): ComposerDraft => ({ task: '', audience: '', message: '',
    draft: freshTemplate(next, item), saved: item, dirty: !item, prompt: '', copied: false, manualCopy: false, notice: '', handoff: null, reuseTarget: null, newTask: false });
  const selectEntry = (next: PetCatalogEntry, request?: string, targetOverride?: string) => {
    listScroll.current = window.scrollY;
    selectionChat.current = null;
    remember();
    if (request?.trim()) {
      const identity = JSON.stringify([next.id, request]);
      let key = homeDraftKeys.current.get(identity);
      if (!key) {
        key = `home:${homeDraftKeys.current.size}:${next.id}`;
        homeDraftKeys.current.set(identity, key);
      }
      enter(key, drafts.current[key] ?? { ...freshDraft(next), task: request }, targetOverride);
      return key;
    }
    const key = `role:${next.id}`;
    enter(key, drafts.current[key] ?? freshDraft(next), targetOverride);
    return key;
  };
  // Recommendation hand-off: the chat request becomes this pet's draft and its chat is preselected.
  // Nothing is applied or sent; the user continues with the existing composer buttons.
  const [browsing, setBrowsing] = useState<PetRecommendation | null>(null);
  const recommendedDraft = useRef<{ key: string; chat: string } | null>(null);
  const recommendationTarget = (item: PetRecommendation) => {
    const key = JSON.stringify([item.target.sourceId, item.target.threadId, item.target.cwd]);
    return links.some(link => targetKey(link) === key) ? key : undefined;
  };
  const openRecommended = (item: PetRecommendation, next: PetCatalogEntry) => {
    if (!item.request) return;
    setBrowsing(null);
    recommendedDraft.current = { key: selectEntry(next, item.request, recommendationTarget(item)), chat: item.target.threadId };
  };
  const chooseEntry = (next: PetCatalogEntry, request?: string) => {
    if (!browsing || request) { selectEntry(next, request); return; }
    const item = browsing;
    // A catalog pet is recorded as the user's own choice; the app event then opens its composer.
    if (isDesktop && petCatalog.some(entry => entry.id === next.id)) {
      void command('respond_pet_recommendation', { id: item.id, response: { action: 'accept', petId: next.id, other: true } }).catch(() => openRecommended(item, next));
    } else openRecommended(item, next);
  };
  // Runs after the navigation reset above, so the composer opens on the requested pet.
  useEffect(() => {
    if (!recommendationOpen) return;
    const item = recommendations.find(entry => entry.id === recommendationOpen.id);
    if (!item?.request) return;
    if (!recommendationOpen.petId) { setBrowsing(item); return; }
    const next = petCatalog.find(entry => entry.id === recommendationOpen.petId);
    if (next) openRecommended(item, next);
  }, [recommendationOpen?.nonce]);
  useEffect(() => { if (browsing && !recommendations.some(item => item.id === browsing.id)) setBrowsing(null); }, [browsing, recommendations]);
  // The app only keeps recommendations for linked chats and the chat waiting after `$autopets`.
  const shownRecommendations = recommendations.filter(item => item.state === 'shown');
  const openSaved = (item: SavedPet) => {
    const next = catalogFor(item.template); if (!next) return;
    selectionChat.current = null;
    listScroll.current = window.scrollY; remember(); const key = `saved:${item.id}`;
    enter(key, drafts.current[key] ?? freshDraft(next, item));
  };
  const startAnother = (link: PetLink) => {
    const current = links.find(item => targetKey(item) === targetKey(link) && item.revision === link.revision && item.run?.id === link.run?.id);
    const next = current && catalogFor(current.template);
    if (!current || !next || !canStartNewPetTask(current, disconnected)) return;
    selectionChat.current = current.target.threadId;
    listScroll.current = window.scrollY; remember();
    const key = `new:${targetKey(current)}:${current.run!.id}:${current.revision}`;
    const nextTemplate = structuredClone(current.template);
    const profile = executionProfiles.find(item => item.id === current.profile);
    if (profile) nextTemplate.execution = { model: profile.model, reasoning: profile.reasoning };
    const item = library.snapshot.pets.find(pet => pet.id === current.savedPet?.id && pet.revision === current.savedPet.revision && JSON.stringify(pet.template) === JSON.stringify(nextTemplate));
    enter(key, drafts.current[key] ?? { ...freshDraft(next, item ?? null), task: '', draft: nextTemplate, reuseTarget: structuredClone(current.target), newTask: true });
  };
  const apply = () => {
    const scope = { selectedTarget, draftKey: draftKey.current, navigationRevision, view, connectionEpoch: currentContext.current.connectionEpoch };
    const stillHere = () => mounted.current && currentContext.current.open && currentContext.current.active
      && currentContext.current.selectedTarget === scope.selectedTarget && currentContext.current.draftKey === scope.draftKey
      && currentContext.current.navigationRevision === scope.navigationRevision && currentContext.current.view === scope.view
      && currentContext.current.connectionEpoch === scope.connectionEpoch
      && !currentContext.current.disconnected;
    return run(async () => {
    setApplied(null);
    if (!target || disconnected || !target.connected || !target.enabled || unresolvedPetRun(target)) throw Error('target unavailable');
    const original = structuredClone(target);
    setProgress({ steps: ['펫 저장', 'Codex 연결', '채팅에 적용'], done: 0 });
    const result = await save(stillHere);
    if (!stillHere()) return;
    step(1);
    if (!await connectIfNeeded() || !stillHere()) return;
    step(2);
    const before = currentContext.current.links.find(link => targetKey(link) === scope.selectedTarget);
    if (!before || before.revision !== original.revision || !before.connected || !before.enabled || unresolvedPetRun(before)) throw Error('pet-revision-changed');
    await command('apply_pet_link_template', { target: original.target, expectedRevision: original.revision, petId: result.id, petRevision: result.revision });
    if (!stillHere()) return;
    const snapshot = await command<Snapshot>('get_snapshot');
    if (!stillHere()) return;
    const matches = snapshot?.petLinks?.filter(link => targetKey(link) === scope.selectedTarget) ?? [];
    const confirmed = matches.length === 1 ? matches[0] : undefined;
    const expectedRevision = original.savedPet?.id === result.id && original.savedPet.revision === result.revision
      && sameTemplate(original.template, result.template) ? original.revision : original.revision + 1;
    if (!confirmed || !confirmed.connected || !confirmed.enabled || unresolvedPetRun(confirmed)
      || confirmed.revision !== expectedRevision || confirmed.savedPet?.id !== result.id || confirmed.savedPet.revision !== result.revision
      || confirmed.profile !== executionProfile?.id || !sameTemplate(confirmed.template, result.template)) throw Error('pet-revision-unconfirmed');
    const current = currentContext.current.links.find(link => targetKey(link) === scope.selectedTarget);
    if (!current || !current.connected || !current.enabled || unresolvedPetRun(current) || current.revision > confirmed.revision
      || (current.revision === confirmed.revision && (current.profile !== confirmed.profile || !sameTemplate(current.template, confirmed.template)
        || current.savedPet?.id !== confirmed.savedPet?.id || current.savedPet?.revision !== confirmed.savedPet?.revision))) throw Error('pet-revision-changed');
    setApplied(confirmed);
    setNotice('펫 설정을 적용했어요.');
    step(3);
    }, stillHere);
  };
  const focusSavedConfiguration = () => {
    setChangeOpen(true);
    requestAnimationFrame(() => savedSelector.current?.focus({ preventScroll: true }));
  };
  const savedReady = Boolean(saved && !dirty && !stale);
  // Where start goes: the chat that ran `$autopets`, else a chat chosen for this pet, else a new chat.
  const host: StartHost = prefs.host ?? 'codex';
  const startMode = setupChat ? 'chat' : target ? 'apply' : host === 'claude' ? 'claude' : 'codex';
  const recommendedHere = recommendedDraft.current?.key === draftKey.current && links.some(link => link.target.threadId === recommendedDraft.current?.chat);
  const firstTime = !prefs.host && !prepared && links.length === 0 && !setupChat;
  const startDisabled = disabled || !routingSupported || (startMode === 'codex' && !task.trim())
    || (startMode === 'apply' && Boolean(targetBlocker))
    || (startMode === 'chat' && disconnected);
  const startLabel = startMode === 'chat' || startMode === 'apply' ? '이 채팅에서 시작' : startMode === 'claude' ? 'Claude에서 시작' : 'Codex에서 시작';
  const runStart = () => startMode === 'chat' ? startInChat() : startMode === 'apply' ? apply() : startMode === 'claude' ? startInClaude() : startInCodex();
  // Connecting changes Codex's own settings, so it is confirmed once (the first-time question counts).
  const start = () => {
    if (working.current) return;
    setConnectBlocked(false); setProgress(null);
    if (firstTime) { setPendingChoice('host'); return; }
    if (startMode !== 'claude' && startMode !== 'chat' && !prepared && !prefs.codexConnectOk) { setPendingChoice('connect'); return; }
    setPendingChoice(null); void runStart();
  };
  const chooseHost = (next: StartHost) => {
    updatePrefs(next === 'codex' ? { host: next, codexConnectOk: true } : { host: next });
    setPendingChoice(null);
    void (next === 'claude' ? startInClaude() : startInCodex());
  };
  const confirmConnect = () => { updatePrefs({ codexConnectOk: true }); setPendingChoice(null); void runStart(); };
  const where = startMode === 'chat' && setupChat ? `Codex 채팅 ${shortChat(setupChat)}` : startMode === 'apply' && target ? `Codex 채팅 ${shortChat(target.target)}`
    : startMode === 'claude' ? 'Claude' : 'Codex';
  const progressLine = progress?.steps.map((name, index) => index < progress.done ? `${name} ✓` : index === progress.done && busy ? `${name} …` : name).join(' · ');
  const taskField = (label: string, placeholder: string) => <label className="composer-task"><span>{label}</span><textarea aria-label="펫에게 맡길 일" rows={4} maxLength={1200} disabled={busy} value={task} placeholder={placeholder} onChange={event => { setTask(event.target.value); invalidateRequest(); setProgress(null); }} /></label>;
  const exampleChip = <button className="pet-start-example" disabled={busy} onClick={() => { setTask(entry.example); invalidateRequest(); setProgress(null); }}>예시로 채우기</button>;
  const messages = <>
    {notice && !stale && (notice !== '펫 설정을 적용했어요.' || confirmedTarget) && <p className="composer-notice" role="status">{notice}</p>}
    {!routingSupported && <p className="error" role="alert">사용할 수 없는 작업 설정이에요. ‘바꾸기’에서 도움 방식을 바꿔 주세요.</p>}
    {(savedChanged || error || library.error || favorites.error) && <div ref={feedback} className="composer-feedback error" role="alert"><p>{error || library.error || favorites.error || '저장한 펫이 바뀌었어요. 최신 구성을 선택해 주세요.'}</p>{stale && <button className="text-button" onClick={focusSavedConfiguration}>구성 다시 선택</button>}</div>}
  </>;
  return <><div hidden={open}>
    {browsing && (view === 'catalog' || view === 'saved') && <div className="pet-recommendation-banner" role="status" data-agent-id="pet-selection.recommendation-banner"><p>Codex 요청 “{browsing.request && browsing.request.length > 60 ? `${browsing.request.slice(0, 60)}…` : browsing.request}”에 쓸 펫을 골라 주세요.</p><button className="text-button" onClick={() => setBrowsing(null)}>요청 없이 둘러보기</button></div>}
    {(view === 'home' || view === 'pets') && shownRecommendations.map(item => <PetRecommendationCard key={item.id} item={item} linked={links.some(link => link.target.threadId === item.target.threadId)} />)}
    <PetWorkspace view={view} navigationRevision={navigationRevision} active={active && !open} category={category} onCategory={setCategory} links={links} disconnected={disconnected} legacy={legacy} jobs={jobs} pets={uiPets} favorites={favorites.ids} onFavorite={favorites.toggle} onSelect={chooseEntry} onSaved={openSaved} onNewTask={startAnother} onBrowse={onBrowse} error={favorites.error || library.error} /></div>{open && <section className="workspace-role-detail pet-start" data-agent-scope="pet-selection" data-agent-id="pet-selection.detail" data-role={entry.id} aria-label={`${entry.name} 살펴보기`}>
    <button className="text-button workspace-detail-back" data-agent-id="pet-selection.detail.back" disabled={busy} onClick={close}>← 돌아가기</button>
    <div className="workspace-detail-layout">
      <div className="workspace-detail-preview" data-agent-id="pet-selection.detail.preview"><ResultPreview entry={entry} /></div>
      <div className="workspace-detail-content pet-start-panel" data-agent-id="pet-selection.composer" aria-label="펫에게 맡기기">
        <header className="pet-start-identity composer-identity" data-agent-id="pet-selection.composer.identity">
          <TaskPetArt entry={entry} small paused interactive={false} />
          <div><span className="composer-eyebrow">{saved ? '내 펫' : '새 펫'}</span><h1 ref={heading} tabIndex={-1}>{entry.name}</h1></div>
          <FavoriteButton label={`${entry.name} 즐겨찾기`} selected={favorites.ids.includes(favoriteId)} disabled={busy || staleSaved} onClick={() => favorites.toggle(favoriteId)} />
        </header>
        <p className="workspace-detail-summary">{entry.summary}</p>
        <h2 className="pet-start-question">{startMode === 'chat' || startMode === 'apply' ? '이 채팅에서 시작할까요?' : startMode === 'claude' ? 'Claude에서 시작할까요?' : '무엇을 맡길까요?'}</h2>
        {recommendedHere ? <section className="composer-recommended-request" data-agent-id="pet-selection.composer.recommended-request" aria-label="Codex 채팅에서 온 요청">
          <small>Codex 채팅에서 온 요청</small><p>{task}</p>
        </section>
          : startMode === 'chat' ? <>
            <p className="pet-start-hint">시작을 누르면 이 채팅 입력창에 요청이 들어가요. 보내기만 누르면 {entry.name} 펫이 이어받아요.</p>
            {taskField('더 알려 줄 내용 (선택)', `${entry.inputLabel} (선택)`)}
          </>
          : startMode === 'apply' ? <p className="pet-start-hint">이 채팅에 {entry.name} 펫을 적용해요. 적용한 뒤 그 채팅에서 할 일을 말하면 펫이 함께해요.</p>
          : startMode === 'claude' ? <p className="pet-start-hint">Claude에는 펫 설정이 넘어가요. 맡길 일은 Claude 새 대화에서 적어 주세요.</p>
          : <>{taskField(entry.inputLabel, entry.example)}{exampleChip}</>}
        <div className="composer-action pet-start-action" data-agent-id="pet-selection.composer.action" data-next={startMode}>
          {startMode === 'apply' && confirmedTarget ? <section className="composer-applied" data-agent-id="pet-selection.composer.applied" aria-label="펫 적용 확인"><PetTaskReturn link={confirmedTarget} disconnected={disconnected} /></section>
            : busy && progress ? <p className="pet-start-progress" role="status">{progressLine}</p>
            : <button className="button primary pet-start-button" data-agent-id="pet-selection.composer.start" disabled={startDisabled} onClick={start}>{startLabel}<span aria-hidden="true">{startMode === 'chat' ? '→' : '↗'}</span></button>}
        </div>
        {!busy && progress && <p className="pet-start-progress" data-complete={progress.done === progress.steps.length}>{progressLine}</p>}
        {pendingChoice === 'host' && <div className="pet-start-choice" role="group" aria-label="어디서 시작할까요?">
          <p><strong>어디서 시작할까요?</strong> 고르면 기억하고 다음부터는 묻지 않아요.</p>
          <div><button className="button secondary" disabled={busy} onClick={() => chooseHost('codex')}>Codex</button><button className="button secondary" disabled={busy} onClick={() => chooseHost('claude')}>Claude</button></div>
          <small>Codex를 고르면 AutoPets 스킬과 읽기 전용 펫 설정을 Codex에 연결해요.</small>
        </div>}
        {pendingChoice === 'connect' && <div className="pet-start-choice" role="alert">
          <p>Codex와 연결할게요. AutoPets 스킬과 읽기 전용 펫 설정을 Codex에 추가해요.</p>
          <div><button className="button secondary" disabled={busy} onClick={confirmConnect}>연결하고 시작</button><button className="text-button" disabled={busy} onClick={() => setPendingChoice(null)}>취소</button></div>
        </div>}
        {connectBlocked && <div className="composer-feedback" role="alert"><p>Codex 연결이 아직 준비되지 않았어요.</p><button className="text-button" onClick={onConnection}>연결 설정 열기</button></div>}
        {isDesktop && setupChat && confirmChat && target && <section className="composer-chat-continue" data-agent-id="pet-selection.composer.continue-chat.status" aria-label="현재 채팅에서 계속하기">
          <div className="composer-chat-confirm" role="alert"><p>선택한 채팅(…{target.target.threadId.slice(-8)})이 아니라 Pet을 호출한 채팅(…{setupChat.threadId.slice(-8)})에 넣어요. 이 채팅으로 할까요?</p>
            <button className="button secondary" disabled={busy} onClick={() => void startInChat(true)}>이 채팅에 넣기</button><button className="text-button" disabled={busy} onClick={() => setConfirmChat(false)}>취소</button></div>
        </section>}
        {messages}
        {newRecords.length > 0 && <p className="composer-observed" role="status">새 작업 기록을 채팅에서 확인해 주세요.</p>}
        {!isDesktop && <p className="workspace-note">설치 앱에서 사용할 수 있어요.</p>}
        {overlayError && <p role="status">{overlayError}</p>}
        <div className="pet-start-summary"><span><span aria-hidden="true">● </span>{where} · {executionProfile?.label ?? '설정 확인'}</span>
          <button className="text-button" data-agent-id="pet-selection.composer.change" aria-expanded={changeOpen} disabled={busy} onClick={() => setChangeOpen(value => !value)}>바꾸기</button></div>
        {changeOpen && <section className="pet-start-change composer-settings" data-agent-id="pet-selection.composer.details" aria-label="시작 설정 바꾸기">
          {!setupChat && <fieldset className="composer-profile-choice composer-profiles" disabled={busy}><legend>시작할 곳</legend><div>{([['codex', 'Codex'], ['claude', 'Claude']] as const).map(([id, label]) => <label key={id}><input type="radio" name="pet-start-host" aria-label={label} checked={host === id} onChange={() => { updatePrefs({ host: id }); setProgress(null); setPendingChoice(null); }} /><span><strong>{label}</strong></span></label>)}</div></fieldset>}
          {startMode === 'claude' && <PetPreferencesConnector compact pet={savedReady ? saved : null} />}
          <fieldset className="composer-profile-choice composer-profiles" disabled={busy} data-agent-id="pet-selection.composer.profile"><legend>도움 방식</legend><div>{executionProfiles.map(profile => <label key={profile.id}><input type="radio" name="ui-pet-execution-profile" aria-label={profile.label} checked={executionProfile?.id === profile.id} onChange={() => { editDraft({ ...draft, execution: { model: profile.model, reasoning: profile.reasoning } }); updatePrefs({ profile: profile.id }); setProgress(null); }} /><span><strong>{profile.label}</strong></span></label>)}</div></fieldset>
          {links.length > 0 && startMode !== 'claude' && <section className="composer-target" data-agent-id="pet-selection.composer.target" aria-label="펫을 사용할 채팅">
            <label className="ui-pet-select">Codex 채팅<select data-agent-id="pet-selection.composer.target.select" aria-label="UI 펫을 적용할 채팅" value={selectedTarget} disabled={disabled} onChange={event => { setSelectedTarget(event.target.value); setApplied(null); setNotice(''); setError(''); setProgress(null); }}>
              <option value="">{setupChat ? '채팅 선택' : '새 대화로 시작'}</option>{links.map(link => <option key={targetKey(link)} value={targetKey(link)}>{link.target.cwd.split(/[\\/]/).filter(Boolean).pop()} · {link.target.threadId.slice(-8)}{!link.connected ? ' · 연결 확인 필요' : !link.enabled ? ' · 도움 꺼짐' : unresolvedPetRun(link) ? ' · 작업 확인 필요' : ''}</option>)}
            </select></label>
            {targetBlocker && <p className="composer-target-blocker" role="status">{targetBlocker}</p>}
          </section>}
          {/* Where the main screen shows no request field, it is here for "요청만 복사". */}
          {(recommendedHere || startMode === 'apply') && <div className="composer-copy-fallback">{taskField(recommendedHere ? '요청 고치기' : '복사할 요청', entry.example)}</div>}
          {entry.id === 'ui-webpage' && <section className="composer-brief"><label>보는 사람<input aria-label="페이지를 볼 사람" value={audience} maxLength={160} disabled={busy} onChange={event => { setAudience(event.target.value); invalidateRequest(); setProgress(null); }} /></label><label>꼭 알릴 내용<input aria-label="꼭 알릴 내용" value={message} maxLength={160} disabled={busy} onChange={event => { setMessage(event.target.value); invalidateRequest(); setProgress(null); }} /></label></section>}
          {entry.id === 'ui-webpage' && <label className="composer-figma"><span>Figma 시안 활용</span><input type="checkbox" aria-label="Figma 시안 활용" checked={figma} disabled={busy} onChange={event => editDraft({ ...draft, features: { figmaDesign: event.target.checked } })} /></label>}
          {figma && <a href={FIGMA_GUIDE} target="_blank" rel="noreferrer">Figma 연결 안내 ↗</a>}
          {target && <div className="composer-target-details" data-agent-id="pet-selection.composer.target.details"><h2>선택한 채팅</h2><p className="composer-target-id">{target.target.cwd}<br />{target.target.threadId}</p></div>}
          <section className="pet-start-more" data-agent-id="pet-selection.composer.optional-request" aria-label="다른 방법">
            <div className="pet-start-more-actions">
              <button className="text-button" disabled={disabled || !routingSupported || !prepared || !task.trim()} onClick={() => void confirmRequest()}>{busy && !prompt ? '확인하는 중…' : '요청만 복사'}</button>
              <button className="text-button composer-save-only" disabled={disabled || !routingSupported || savedReady} onClick={() => void saveToLibrary()}>{savedReady ? '저장됨' : saved ? '변경 저장' : '펫만 저장'}</button>
            </div>
            {prompt && !stale && <>
              {/* Opens on every new confirmation (key); the user may still fold it. */}
              <details key={`${prompt}:${manualCopy}`} className="composer-detail composer-request-check" open><summary>Codex에 보낼 요청 확인</summary>
                <label className="composer-request-result">시작 요청<textarea ref={promptField} aria-label="Codex에 보낼 시작 요청" readOnly rows={6} value={prompt} onFocus={event => event.currentTarget.select()} /></label>
              </details>
              <div className="composer-action composer-copy-action"><button className="button secondary" disabled={disabled || !routingSupported || !prepared || !task.trim()} onClick={() => void copyRequest()}>{busy ? '복사하는 중…' : copied ? '시작 요청 다시 복사' : '시작 요청 복사'}<span aria-hidden="true">{copied ? '✓' : '↗'}</span></button></div>
            </>}
            <label className="ui-pet-select">저장한 구성<select ref={savedSelector} aria-label="저장한 구성" value={stale ? '__stale__' : saved?.id ?? ''} disabled={busy} onChange={event => selectSaved(uiPets.find(pet => pet.id === event.target.value))}>{stale && <option value="__stale__" disabled>최신 구성을 선택해 주세요</option>}<option value="">새 구성</option>{uiPets.map(pet => <option key={pet.id} value={pet.id}>{pet.template.name} · 수정 {pet.revision}</option>)}</select></label>
            {destinations.length > 0 && <section className="composer-destinations" data-next={copied && !stale} aria-label="등록된 Codex 채팅">{destinations.map(link => <div key={targetKey(link)}><small>{shortChat(link.target)}</small><PetTaskReturn link={link} disconnected={disconnected} /></div>)}</section>}
            <PetSkillSource entry={entry} />
          </section>
        </section>}
        <details className="workspace-detail-more"><summary>일하는 방식 자세히</summary><p>{entry.after}</p><p>{entry.limit}</p></details>
      </div>
    </div>
  </section>}</>;
}
