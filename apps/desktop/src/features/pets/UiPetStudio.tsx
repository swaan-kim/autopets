import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PetJob, PetLink, PetRecommendation, PetRoleSnapshot, PetRoleTemplate, SavedPet, SetupState, Snapshot, WorkflowModel, WorkflowReasoning } from '@autopets/contracts/types';
import template from '../../../../../packages/contracts/data/ui-pet.json';
import routing from '../../../../../packages/contracts/data/routing-profiles.json';
import recipeData from '../../../../../packages/contracts/data/recipes.json';
import { petStartRequest, fitsCodexLink } from '../../../../../packages/guidance/start-request.mjs';
import { petCatalog, catalogFor, type PetCatalogEntry } from './petCatalog';
import { command, isDesktop } from '../../bridge/command';
import { useRoles } from '../../bridge/useRoles';
import { TaskPetArt } from './TaskPetArt';
import { PetWorkspace, type PetWorkspaceView } from './PetWorkspace';
import { PetTaskReturn, canStartNewPetTask } from './PetTaskReturn';
import { unresolvedPetRun } from './ExplicitPet';
import { FavoriteButton } from './PetIntroduction';
import { PetSkillSource } from './PetSkillSource';
import { PetPreferencesConnector } from '../onboarding/PetPreferencesConnector';
import { PetRecommendationCard } from './PetRecommendation';

import { usePetFavorites } from './usePetFavorites';
import './ui-pet-studio.css';
import './first-success.css';
import './pet-composer-simple.css';
import { AI_NAMES, usePrimaryAi, type PrimaryAi } from './primaryAi';

export const FIGMA_GUIDE = 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/#codex';
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

type TaskContext = { audience?: string; message?: string; newTask?: boolean; via?: 'skill' | 'tool' };
type Handoff = { petId: string; petRevision: number; previousRuns: string[] };
type ComposerDraft = { task: string; audience: string; message: string; draft: PetRoleTemplate; saved: SavedPet | null; dirty: boolean;
  prompt: string; copied: boolean; manualCopy: boolean; notice: string; handoff: Handoff | null; reuseTarget: PetLink['target'] | null; newTask: boolean };

const CODEX_OPENED = 'Codex 새 대화에 요청을 넣었어요. 보내기만 누르세요.';
const CLAUDE_CODE_OPENED = 'Claude Code 새 세션에 요청을 넣었어요. 보내기만 누르세요.';
const recipes = new Map(recipeData.recipes.map(recipe => [recipe.id, recipe]));
// Short on purpose: it has to fit a Codex link. The questions and working rules are in the AutoPets
// skill (references/explicit-pet.md) and recipes.json, and the AI asks them in the chat.
export const uiPetStartPrompt = (pet: SavedPet, task = '', context: TaskContext = {}) => {
  const id = catalogFor(pet.template)?.id;
  const web = id === 'ui-webpage';
  // The chat shows the name the user picked on screen, not the stored template name.
  return petStartRequest({ name: (id && recipes.get(id)?.name) || pet.template.name, petId: pet.id, petRevision: pet.revision, recipe: id && recipes.has(id) ? id : null, task,
    audience: web ? context.audience : '', message: web ? context.message : '', newTask: context.newTask === true, figma: pet.template.features?.figmaDesign === true, via: context.via });
};

export function UiPetStudio({ links, jobs = [], recommendations = [], recommendationOpen = null, setup, onConnection, active = true, view = 'home', navigationRevision = 0, onBrowse, legacy, disconnected = false, onBusyChange }: { links: PetLink[]; jobs?: PetJob[]; recommendations?: PetRecommendation[]; recommendationOpen?: { id: string; petId: string | null; nonce: number } | null; setup?: SetupState | null; onConnection: () => void; active?: boolean; view?: PetWorkspaceView; navigationRevision?: number; onBrowse: () => void; legacy?: ReactNode; disconnected?: boolean; onBusyChange: (busy: boolean) => void }) {
  const library = useRoles();
  const favorites = usePetFavorites();
  const [primaryAi, setPrimaryAi] = usePrimaryAi();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<'settings' | 'request' | null>(null);
  const panelDialog = useRef<HTMLDialogElement>(null);
  const panelTrigger = useRef<HTMLElement | null>(null);

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
  const panelVisible = Boolean(panel && open && active);
  useEffect(() => {
    if (!panelVisible) return;
    const dialog = panelDialog.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (panelTrigger.current?.isConnected) panelTrigger.current.focus({ preventScroll: true }); };
  }, [panelVisible]);
  const setupKey = JSON.stringify(setup?.connections);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => { if (open) remember(); setPanel(null); setOpen(false); }, [view, navigationRevision]);
  useEffect(() => { if (open && active) { window.scrollTo(0, 0); heading.current?.focus({ preventScroll: true }); } }, [open, active]);
  const close = () => { if (!working.current) { remember(); setPanel(null); setOpen(false); requestAnimationFrame(() => {
      const label = selectionButton.current?.getAttribute('aria-label');
      const selected = label ? [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label && button.offsetParent !== null) : null;
      const previousCard = selectionChat.current ? [...document.querySelectorAll<HTMLElement>('.workspace-live-card')].find(card => card.querySelector('.explicit-target')?.getAttribute('title') === selectionChat.current) : null;
      window.scrollTo(0, listScroll.current);
      (selected ?? previousCard?.querySelector<HTMLButtonElement>('.explicit-next') ?? document.querySelector<HTMLButtonElement>(`.workspace-role-detail[data-role="${entry.id}"] .workspace-use-pet`) ?? document.querySelector<HTMLButtonElement>(`.workspace-role-card[data-role="${entry.id}"] .workspace-role-select`) ?? document.querySelector<HTMLButtonElement>('.nav-item[aria-current="page"]'))?.focus({ preventScroll: true });
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
  const targetBlocker = disconnected ? '앱 연결을 확인해 주세요.' : target && !target.connected ? 'Codex에서 “펫 상태 확인”이라고 말해 주세요.'
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
    if (!result) {
      // Starting again from the catalog reuses an identical saved pet instead of adding a duplicate each time.
      const existing = (await command<PetRoleSnapshot>('roles_snapshot'))?.pets?.find(pet => sameTemplate(pet.template, draft));
      if (existing) { result = existing; if (isCurrent()) { setSaved(existing); setDraft(structuredClone(existing.template)); setDirty(false); } }
    }
    if (!result || (saved && dirty)) {
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
    catch { setManualCopy(true); setPanel('request'); setNotice('자동 복사가 되지 않았어요. 아래 요청을 직접 선택해 복사해 주세요.'); }
  };
  const prepare = () => {
    if (prepared) return;
    void run(async () => {
      const result = await command<SetupState>('connect_ai', { hostId: 'codex-windows-local' });
      setLocalSetup(result);

      setNotice([explicitSetupReady(result) ? 'Codex 연결 준비됨' : '연결 설정을 확인해 주세요.', ...(result.warnings ?? [])].join(' '));
    });
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
  // still presses send. A request too long for a link falls back to copying.
  const openInCodex = async () => {
    const pet = await save();
    const value = uiPetStartPrompt(pet, task, { audience, message, newTask });
    if (!fitsCodexLink(value)) return copy(value, pet);
    try { await command('open_pet_in_codex', { petId: pet.id, expectedRevision: pet.revision, prompt: value }); }
    catch (cause) { if (/prompt-too-long/.test(String(cause))) return copy(value, pet); throw cause; }
    setPrompt(value); setManualCopy(false); setCopied(false);
    setHandoff({ petId: pet.id, petRevision: pet.revision, previousRuns: links.filter(link => link.run).map(link => JSON.stringify([link.target, link.run!.id])) });
    setNotice(CODEX_OPENED);
  };
  const saveAndOpenCodex = () => run(async () => { if (!task.trim()) throw Error('empty task'); await openInCodex(); });
  // The same request for Claude Code: a new session in the Claude desktop app, in Documents/AutoPets.
  // Claude reads the pet with the AutoPets tools installed there, so nothing is prepared in Codex.
  const openInClaudeCode = async () => {
    const pet = await save();
    const value = uiPetStartPrompt(pet, task, { audience, message, newTask, via: 'tool' });
    try { await command('open_pet_in_claude_code', { petId: pet.id, expectedRevision: pet.revision, prompt: value }); }
    catch (cause) { if (/prompt-too-long/.test(String(cause))) return copy(value, pet); throw cause; }
    setPrompt(value); setManualCopy(false); setCopied(false); setHandoff(null);
    setNotice(CLAUDE_CODE_OPENED);
  };
  // The main action: one click prepares Codex on first use, saves this pet and opens the chat.
  // The job line may be empty; the AI then asks what to make together with the recipe's questions.
  const quickStart = () => run(async () => {
    if (primaryAi === 'claude-code') { await openInClaudeCode(); return; }
    if (!prepared) {
      const result = await command<SetupState>('connect_ai', { hostId: 'codex-windows-local' });
      setLocalSetup(result);
      if (!explicitSetupReady(result)) { setNotice(['Codex 연결을 준비하지 못했어요. 아래 ‘AI 연결’에서 확인해 주세요.', ...(result.warnings ?? [])].join(' ')); return; }
    }
    await openInCodex();
  });
  const saveToLibrary = () => {
    const scope = { key: draftKey.current, view, navigationRevision };
    const stillHere = () => mounted.current && currentContext.current.open && currentContext.current.active
      && currentContext.current.draftKey === scope.key && currentContext.current.view === scope.view
      && currentContext.current.navigationRevision === scope.navigationRevision;
    return run(async () => { await save(stillHere); if (stillHere()) setNotice('저장됨'); }, stillHere);
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
    setPanel(null);
    draftKey.current = key;
    setDraft(structuredClone(value.draft)); setSaved(value.saved); setDirty(value.dirty); setStaleSaved(false); setError('');
    setTask(value.task); setAudience(value.audience); setMessage(value.message); setPrompt(value.prompt); setCopied(value.copied);
    setManualCopy(value.manualCopy); setNotice(value.notice); setHandoff(value.handoff); setReuseTarget(value.reuseTarget); setNewTask(value.newTask);
    const available = disconnected ? [] : links.filter(link => link.connected && link.enabled && !unresolvedPetRun(link));
    setSelectedTarget(targetOverride ?? (value.reuseTarget ? JSON.stringify([value.reuseTarget.sourceId, value.reuseTarget.threadId, value.reuseTarget.cwd])
      : available.length === 1 ? targetKey(available[0]) : ''));
    setApplied(null);
    selectionButton.current = document.activeElement as HTMLElement; setOpen(true);
  };
  const freshDraft = (next: PetCatalogEntry, item: SavedPet | null = null): ComposerDraft => ({ task: '', audience: '', message: '',
    draft: structuredClone(item?.template ?? next.template), saved: item, dirty: !item, prompt: '', copied: false, manualCopy: false, notice: '', handoff: null, reuseTarget: null, newTask: false });
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
  // From a pet's detail page: open its composer and start right away, with no job typed.
  // The chat then asks what to make together with the recipe's questions.
  const [startRequest, setStartRequest] = useState(0);
  const startEntry = (next: PetCatalogEntry) => { const direct = isDesktop && !browsing; chooseEntry(next); if (direct) setStartRequest(value => value + 1); };
  useEffect(() => { if (startRequest && open && !disabled && routingSupported) void quickStart(); }, [startRequest]);
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
    const result = await save(stillHere);
    if (!stillHere()) return;
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
    }, stillHere);
  };
  const showPanel = (mode: 'settings' | 'request') => {
    panelTrigger.current = document.activeElement as HTMLElement;
    setPanel(mode);
  };
  const focusSavedConfiguration = () => {
    setPanel('settings');
    requestAnimationFrame(() => savedSelector.current?.focus({ preventScroll: true }));
  };
  const savedReady = Boolean(saved && !dirty && !stale);
  const startLabel = primaryAi === 'claude-code' ? 'Claude Code에서 시작' : prepared ? 'Codex에서 시작' : 'Codex에 준비하고 시작';
  const recipe = recipes.get(entry.id);
  // A request that came from a chat continues in that chat, so the new-chat start is not offered there.
  const quickVisible = recommendedDraft.current?.key !== draftKey.current;
  const otherButton = quickVisible ? 'button secondary' : 'button primary';
  const messages = <>
    {notice && (!panel || copied || manualCopy || notice === CODEX_OPENED || notice === CLAUDE_CODE_OPENED) && !stale && (notice !== '펫 설정을 적용했어요.' || confirmedTarget) && <p className="composer-notice" role="status">{notice}</p>}
    {!routingSupported && <p className="error" role="alert">사용할 수 없는 작업 설정이에요. 펫 설정에서 바꿔주세요.</p>}
    {(savedChanged || error || library.error || favorites.error) && <div ref={feedback} className="composer-feedback error" role="alert"><p>{error || library.error || favorites.error || '저장한 펫이 바뀌었어요. 최신 구성을 선택해 주세요.'}</p>{stale && <button className="text-button" onClick={focusSavedConfiguration}>구성 다시 선택</button>}</div>}
  </>;
  return <><div hidden={open}>
    {browsing && (view === 'catalog' || view === 'saved') && <div className="pet-recommendation-banner" role="status" data-agent-id="pet-selection.recommendation-banner"><p>Codex 요청 “{browsing.request && browsing.request.length > 60 ? `${browsing.request.slice(0, 60)}…` : browsing.request}”에 쓸 펫을 골라 주세요.</p><button className="text-button" onClick={() => setBrowsing(null)}>요청 없이 둘러보기</button></div>}
    {(view === 'home' || view === 'pets') && shownRecommendations.map(item => <PetRecommendationCard key={item.id} item={item} linked={links.some(link => link.target.threadId === item.target.threadId)} />)}
    <PetWorkspace view={view} jobs={jobs} navigationRevision={navigationRevision} active={active && !open} category={category} onCategory={setCategory} links={links} disconnected={disconnected} legacy={legacy} pets={uiPets} favorites={favorites.ids} onFavorite={favorites.toggle} onSelect={chooseEntry} onStart={startEntry} startLabel={startLabel} onSaved={openSaved} onNewTask={startAnother} onBrowse={onBrowse} error={favorites.error || library.error} /></div>{open && <section className="pet-composer" data-agent-scope="pet-selection" data-agent-id="pet-selection.composer" aria-label="펫에게 맡기기">
    <header className="composer-top">
      <button data-agent-id="pet-selection.composer.back" className="text-button" disabled={busy} onClick={close}>← 돌아가기</button>
      <button className="composer-settings-button" data-agent-id="pet-selection.composer.settings" disabled={busy} onClick={() => showPanel('settings')} aria-label="펫 설정">⚙</button>
    </header>
    <div className="composer-layout">
      <header className="composer-identity" data-agent-id="pet-selection.composer.identity">
        <TaskPetArt entry={entry} small paused interactive={false} />
        <div><span className="composer-eyebrow">{saved ? '내 펫' : '새 펫'}</span><h1 ref={heading} tabIndex={-1}>{entry.name}</h1></div>
        <FavoriteButton label={`${entry.name} 즐겨찾기`} selected={favorites.ids.includes(favoriteId)} disabled={busy || staleSaved} onClick={() => favorites.toggle(favoriteId)} />
      </header>
      <div className="composer-main">
        {recommendedDraft.current?.key === draftKey.current && <section className="composer-recommended-request" data-agent-id="pet-selection.composer.recommended-request" aria-label="Codex에서 받은 요청">
          <small>Codex 채팅 · {recommendedDraft.current.chat.slice(-8)}에서 보낸 요청</small><p>{task}</p>
          {links.some(link => link.target.threadId === recommendedDraft.current?.chat)
            ? <small>이 채팅에 펫을 적용한 뒤 같은 채팅에 “{entry.name} 펫으로 방금 요청한 일 진행해줘”라고 보내면 시작해요. 요청을 고쳤다면 ‘직접 요청’에서 확인한 뒤 시작 요청을 복사해 보내 주세요.</small>
            : <small>이 채팅은 아직 펫과 연결되지 않았어요. ‘직접 요청’에서 확인한 뒤 시작 요청을 복사해 같은 채팅에 보내면 {entry.name} 펫이 연결되고 이 요청을 진행해요.</small>}
        </section>}
        {quickVisible && <section className="composer-quick-start" data-agent-id="pet-selection.composer.quick-start" aria-label="바로 시작">
          <label className="composer-quick-task">무엇을 맡길까요?<textarea aria-label="맡길 일 한 줄" rows={2} maxLength={300} disabled={busy} value={task} placeholder={`예: ${entry.example}`} onChange={event => { setTask(event.target.value); invalidateRequest(); }} /></label>
          <div className="composer-action composer-start-action"><button className="button primary composer-start" data-agent-id="pet-selection.composer.start" disabled={disabled || !routingSupported} onClick={() => void quickStart()}>{busy ? '준비하는 중…' : startLabel}<span aria-hidden="true">↗</span></button></div>
          <div className="composer-ai-choice" role="radiogroup" aria-label="여는 AI" data-agent-id="pet-selection.composer.ai">{(Object.keys(AI_NAMES) as PrimaryAi[]).map(id => <button key={id} role="radio" aria-checked={primaryAi === id} disabled={busy} onClick={() => { setPrimaryAi(id); invalidateRequest(); }}>{AI_NAMES[id]}</button>)}</div>
          <p className="composer-start-note">비워 두어도 돼요. {AI_NAMES[primaryAi]}{primaryAi === 'codex' ? ' 새 대화가' : ' 새 세션이'} 열리면 보내기만 누르세요. 필요한 것은 채팅에서 물어봐요.{recipe && <><br />결과: {recipe.format}</>}{primaryAi === 'claude-code' && <><br />처음이면 아래 ‘Claude에 설치’를 한 번 해 주세요. 결과는 문서의 AutoPets 폴더에 만들어져요.</>}</p>
        </section>}
        {quickVisible && <p className="composer-other-ways">다른 방법</p>}
        {links.length > 0 ?<section className="composer-target" data-agent-id="pet-selection.composer.target" aria-label="펫을 사용할 채팅">
          <label className="ui-pet-select">Codex 채팅<select data-agent-id="pet-selection.composer.target.select" aria-label="UI 펫을 적용할 채팅" value={selectedTarget} disabled={disabled} onChange={event => { setSelectedTarget(event.target.value); setApplied(null); setNotice(''); setError(''); }}>
            <option value="">채팅 선택</option>{links.map(link => <option key={targetKey(link)} value={targetKey(link)}>{link.target.cwd.split(/[\\/]/).filter(Boolean).pop()} · {link.target.threadId.slice(-8)}{!link.connected ? ' · 연결 확인 필요' : !link.enabled ? ' · 도움 꺼짐' : unresolvedPetRun(link) ? ' · 작업 확인 필요' : ''}</option>)}
          </select></label>
          {targetBlocker && <p className="composer-target-blocker" role="status">{targetBlocker}</p>}
          <div className="composer-action composer-direct-action" data-agent-id="pet-selection.composer.action" data-next={!prepared ? 'prepare' : confirmedTarget ? 'chat' : 'apply'}>
            {!prepared ? <button className={otherButton} data-agent-id="pet-selection.composer.prepare" disabled={disabled} onClick={prepare}>{busy ? '연결 중…' : 'Codex에 펫 준비'}<span aria-hidden="true">↗</span></button>
              : confirmedTarget ? <section className="composer-applied" data-agent-id="pet-selection.composer.applied" aria-label="펫 적용 확인"><PetTaskReturn link={confirmedTarget} disconnected={disconnected} /></section>
              : <button className={otherButton} data-agent-id="pet-selection.composer.apply" disabled={disabled || !routingSupported || !target || Boolean(targetBlocker)} onClick={() => void apply()}>{busy ? '적용 확인 중…' : '이 채팅에 펫 적용'}<span aria-hidden="true">↗</span></button>}
          </div>
          {!savedReady && <button className="text-button composer-save-only" disabled={disabled || !routingSupported} onClick={() => void saveToLibrary()}>{saved ? '변경 저장' : '펫만 저장'}</button>}
        </section> : <section className="composer-launch" aria-label="펫 만들고 사용하기">
          {!savedReady ? <button className={`${otherButton} composer-create`} data-agent-id="pet-selection.composer.save" disabled={disabled || !routingSupported} onClick={() => void saveToLibrary()}>{busy ? '저장 중…' : saved ? '변경 저장' : '펫 만들기'}<span aria-hidden="true">{saved ? '✓' : '＋'}</span></button>
            : <div className="composer-hosts" aria-label="AI에서 사용하기">
              {prepared && saved ? <button className={`${otherButton} composer-codex-link`} disabled={disabled} onClick={onConnection}>Codex 연결 설정<span aria-hidden="true">↗</span></button>
                : <button className={otherButton} data-agent-id="pet-selection.composer.prepare" disabled={disabled} onClick={prepare}>{busy ? '연결 중…' : 'Codex에 펫 준비'}<span aria-hidden="true">↗</span></button>}
              <PetPreferencesConnector compact pet={saved} />
            </div>}
        </section>}
        {!panel && messages}
        {!isDesktop && <p className="workspace-note">설치 앱에서 사용할 수 있어요.</p>}
        {overlayError && <p role="status">{overlayError}</p>}
        <footer className="composer-tools"><button className="text-button" disabled={busy} onClick={() => showPanel('request')}>직접 요청</button><button className="text-button" disabled={busy} onClick={onConnection}>AI 연결</button></footer>
      </div>
    </div>
    <dialog ref={panelDialog} className="composer-more composer-panel" aria-label={panel === 'request' ? '직접 요청' : '펫 설정'} onClose={() => setPanel(null)} onCancel={event => { if (busy) event.preventDefault(); }}>
      <header className="composer-panel-header"><div role="group" aria-label="펫 편집"><button aria-pressed={panel === 'settings'} disabled={busy} onClick={() => setPanel('settings')}>설정</button><button aria-pressed={panel === 'request'} disabled={busy} onClick={() => setPanel('request')}>직접 요청</button></div><button className="composer-close" disabled={busy} onClick={() => setPanel(null)} aria-label="펫 편집 닫기">×</button></header>
      {panel && messages}
      <section className="composer-settings" hidden={panel !== 'settings'} data-agent-id="pet-selection.composer.details">
        <fieldset className="composer-profile-choice composer-profiles" disabled={busy} data-agent-id="pet-selection.composer.profile"><legend>도움 방식</legend><div>{executionProfiles.map(profile => <label key={profile.id}><input type="radio" name="ui-pet-execution-profile" aria-label={profile.label} checked={executionProfile?.id === profile.id} onChange={() => editDraft({ ...draft, execution: { model: profile.model, reasoning: profile.reasoning } })} /><span><strong>{profile.label}</strong></span></label>)}</div></fieldset>
        <label className="ui-pet-select">저장한 구성<select ref={savedSelector} aria-label="저장한 구성" value={stale ? '__stale__' : saved?.id ?? ''} disabled={busy} onChange={event => selectSaved(uiPets.find(pet => pet.id === event.target.value))}>{stale && <option value="__stale__" disabled>최신 구성을 선택해 주세요</option>}<option value="">새 구성</option>{uiPets.map(pet => <option key={pet.id} value={pet.id}>{pet.template.name} · 수정 {pet.revision}</option>)}</select></label>
        {entry.id === 'ui-webpage' && <label className="composer-figma"><span>Figma 시안 활용</span><input type="checkbox" aria-label="Figma 시안 활용" checked={figma} disabled={busy} onChange={event => editDraft({ ...draft, features: { figmaDesign: event.target.checked } })} /></label>}
        {figma && <a href={FIGMA_GUIDE} target="_blank" rel="noreferrer">Figma 연결 안내 ↗</a>}
        {target && <div className="composer-target-details" data-agent-id="pet-selection.composer.target.details"><h2>선택한 채팅</h2><p className="composer-target-id">{target.target.cwd}<br />{target.target.threadId}</p></div>}
        <PetSkillSource entry={entry} />
      </section>
      <section className="composer-copy-fallback" hidden={panel !== 'request'} data-agent-id="pet-selection.composer.optional-request">
        <label className="composer-task">{entry.inputLabel}<textarea aria-label="펫에게 맡길 일" rows={4} maxLength={1200} disabled={busy} value={task} placeholder={entry.example} onChange={event => { setTask(event.target.value); invalidateRequest(); }} /></label>
        <button className="text-button composer-example" disabled={busy} onClick={() => { setTask(entry.example); invalidateRequest(); }}>예시로 시작</button>
        {entry.id === 'ui-webpage' && <section className="composer-brief"><label>보는 사람<input aria-label="페이지를 볼 사람" value={audience} maxLength={160} disabled={busy} onChange={event => { setAudience(event.target.value); invalidateRequest(); }} /></label><label>꼭 알릴 내용<input aria-label="꼭 알릴 내용" value={message} maxLength={160} disabled={busy} onChange={event => { setMessage(event.target.value); invalidateRequest(); }} /></label></section>}
        <div className="composer-action composer-confirm-action">{isDesktop && <button className="button primary" disabled={disabled || !routingSupported || !prepared || !task.trim()} onClick={() => void saveAndOpenCodex()}>{busy ? '준비하는 중…' : 'Codex 새 대화로 시작'}<span aria-hidden="true">↗</span></button>}<button className="button secondary" disabled={disabled || !routingSupported || !prepared || !task.trim()} onClick={() => void confirmRequest()}>{busy && !prompt ? '확인하는 중…' : '확인'}<span aria-hidden="true">↓</span></button></div>
        {prompt && !stale && <>
          {/* Opens on every new confirmation (key); the user may still fold it. */}
          <details key={`${prompt}:${manualCopy}`} className="composer-detail composer-request-check" open><summary>Codex에 보낼 요청 확인</summary>
            <label className="composer-request-result">시작 요청<textarea ref={promptField} aria-label="Codex에 보낼 시작 요청" readOnly rows={6} value={prompt} onFocus={event => event.currentTarget.select()} /></label>
          </details>
          <div className="composer-action composer-copy-action"><button className="button secondary" disabled={disabled || !routingSupported || !prepared || !task.trim()} onClick={() => void copyRequest()}>{busy ? '복사하는 중…' : copied ? '시작 요청 다시 복사' : '시작 요청 복사'}<span aria-hidden="true">{copied ? '✓' : '↗'}</span></button></div>
        </>}
        {destinations.length > 0 && <section className="composer-destinations" data-next={copied && !stale} aria-label="등록된 Codex 채팅">{destinations.map(link => <div key={targetKey(link)}><small>{link.target.cwd.split(/[\\/]/).pop()} · {link.target.threadId.slice(-8)}</small><PetTaskReturn link={link} disconnected={disconnected} /></div>)}</section>}
        {newRecords.length > 0 && <p className="composer-observed" role="status">새 작업 기록을 채팅에서 확인해 주세요.</p>}
      </section>
    </dialog>
  </section>}</>;
}
