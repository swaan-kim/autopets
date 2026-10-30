import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PetLink, PetRoleSnapshot, PetRoleTemplate, SavedPet, SetupState, Snapshot, WorkflowModel } from '@autopets/contracts/types';
import template from '../../../../../packages/contracts/data/ui-pet.json';
import { petCatalog, catalogFor, type PetCatalogEntry } from './petCatalog';
import { command, isDesktop } from '../../bridge/command';
import { useRoles } from '../../bridge/useRoles';
import { TaskPetArt } from './TaskPetArt';
import { PetWorkspace, type PetWorkspaceView } from './PetWorkspace';
import { PetTaskReturn, canStartNewPetTask } from './PetTaskReturn';
import { unresolvedPetRun } from './ExplicitPet';
import { FavoriteButton } from './PetIntroduction';
import { PetSkillSource } from './PetSkillSource';

import { usePetFavorites } from './usePetFavorites';
import './ui-pet-studio.css';
import './first-success.css';
import './pet-composer-simple.css';

export const FIGMA_GUIDE = 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/#codex';
const EXAMPLE_TASK = '가상 학과 행사 소개 웹페이지 한 장. 행사 소개, 일정, 신청 안내와 모바일 화면을 포함해줘.';
const settingLabel = (value: WorkflowModel | null) => value ? `${({ 'gpt-6-luna': 'Luna', 'gpt-6-sol': 'Sol', 'gpt-6-astra': 'Astra' } as Record<string, string>)[value.model] ?? value.model} · ${value.reasoning}` : 'Luna · low';
const supportedRouting = (draft: PetRoleTemplate) => (!draft.planning || (draft.planning.model === 'gpt-6-luna' && draft.planning.reasoning === 'low')) && (!draft.execution || (draft.execution.model === 'gpt-6-luna' && draft.execution.reasoning === 'low') || (draft.execution.model === 'gpt-6-sol' && ['low', 'medium'].includes(draft.execution.reasoning)));
const targetKey = (link: PetLink) => JSON.stringify([link.target.sourceId, link.target.threadId, link.target.cwd]);
const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)])) : value;
const sameTemplate = (left: PetRoleTemplate, right: PetRoleTemplate) => JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
const explicitSetupReady = (setup?: SetupState | null) => setup?.connectionMode === 'explicit-pet' && setup.connections?.some(connection => connection.hostId === 'codex-windows-local' && connection.configured) === true;
const executionProfiles = [
  { id: 'light', label: '가볍게', description: '빠른 초안에', model: 'gpt-6-luna', reasoning: 'low' },
  { id: 'standard', label: '표준', description: '일반적인 작업에', model: 'gpt-6-sol', reasoning: 'low' },
  { id: 'careful', label: '꼼꼼하게', description: '더 깊이 검토할 때', model: 'gpt-6-sol', reasoning: 'medium' },
] as const;

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

export const uiPetStartPrompt = (pet: SavedPet, task = EXAMPLE_TASK, context: TaskContext = {}) => [
  `AutoPets 스킬로 현재 채팅에 ${pet.template.name}을 연결해줘. 저장한 펫: petId=${pet.id}, petRevision=${pet.revision}.`,
  `이 펫으로 아래 작업${pet.template.planFirst ? '의 계획만 세워줘' : '을 수행하고 결과를 채팅에 보여줘'}.\n\n${task.trim()}\n`,
  ...(catalogFor(pet.template)?.id === 'ui-webpage' ? [context.audience?.trim() && `이 페이지를 볼 사람: ${context.audience.trim()}`, context.message?.trim() && `꼭 알릴 내용: ${context.message.trim()}`].filter(Boolean) : []),
  ...(context.newTask ? ['새로운 작업이야. 이전 작업의 내용이나 계획 승인을 이 요청에 재사용하지 마.'] : []),
  pet.template.features?.figmaDesign ? 'Figma 시안 활용 특성을 선택했어. 사용할 프레임 링크를 나에게 먼저 확인하고, 실제 시안을 읽은 뒤 계획해줘. 연결이나 접근이 안 되면 필요한 조치를 알려줘.' : '별도 서비스 연결 없이 가능한 범위부터 도와주고, 외부 서비스가 필요하면 먼저 알려줘.',
  pet.template.planFirst ? '지금은 파일을 바꾸지 말고 계획을 보여준 뒤 내 구현 요청을 기다려줘. 구현 위치와 기존 파일을 먼저 확인하고 기존 내용을 덮어쓰지 마.' : '파일을 수정하거나 외부 서비스에 등록하지 말고, 제공한 내용을 바탕으로 결과를 보여줘. 확인할 수 없는 사실은 미확인으로 구분해줘.',
  ...(task.trim() === EXAMPLE_TASK ? ['이 예시에는 실제 개인정보 대신 가상 내용을 사용하고, 구현할 때는 새 autopets-demo 폴더를 사용하되 기존 파일이 있으면 먼저 알려줘.'] : []),
].join('\n');

export function UiPetStudio({ links, setup, onConnection, active = true, view = 'home', navigationRevision = 0, onBrowse, legacy, disconnected = false, onBusyChange }: { links: PetLink[]; setup?: SetupState | null; onConnection: () => void; active?: boolean; view?: PetWorkspaceView; navigationRevision?: number; onBrowse: () => void; legacy?: ReactNode; disconnected?: boolean; onBusyChange: (busy: boolean) => void }) {
  const library = useRoles();
  const favorites = usePetFavorites();
  const [open, setOpen] = useState(false);

  const [draft, setDraft] = useState<PetRoleTemplate>(() => structuredClone(template) as PetRoleTemplate);
  const [category, setCategory] = useState<'all' | 'daily' | 'work'>('all');
  // User-written drafts remain in this manager session, never in telemetry or the public DB.
  const drafts = useRef<Record<string, ComposerDraft>>({});
  // Home requests have their own drafts, so a new brief cannot overwrite a role or saved pet draft.
  const homeDraftKeys = useRef(new Map<string, string>());
  const draftKey = useRef('role:ui-webpage');
  const [manualCopy, setManualCopy] = useState(false);
  const [copyExpanded, setCopyExpanded] = useState(false);
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
  const [task, setTask] = useState(EXAMPLE_TASK);
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
  const setupKey = JSON.stringify(setup?.connections);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => { if (open) remember(); setOpen(false); }, [view, navigationRevision]);
  useEffect(() => { if (open && active) { window.scrollTo(0, 0); heading.current?.focus({ preventScroll: true }); } }, [open, active]);
  const close = () => { if (!working.current) { remember(); setOpen(false); requestAnimationFrame(() => {
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
  useEffect(() => {
    if (!open || selectedTarget || links.length !== 1 || !links[0].connected) return;
    setSelectedTarget(targetKey(links[0]));
  }, [open, selectedTarget, links]);
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
  const run = async (operation: () => Promise<void>, isCurrent = () => mounted.current) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); invalidateRequest();
    try { await operation(); }
    catch (cause) {
      if (!isCurrent()) return;
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
    catch { setManualCopy(true); setCopyExpanded(true); setNotice('자동 복사가 되지 않았어요. 아래 요청을 직접 선택해 복사해 주세요.'); }
  };
  const prepare = () => {
    if (prepared) return;
    void run(async () => {
      const result = await command<SetupState>('connect_ai', { hostId: 'codex-windows-local' });
      setLocalSetup(result);

      setNotice([explicitSetupReady(result) ? '준비됐어요. 쓸 Codex 채팅에서 “AutoPets 스킬로 제작 펫 연결해줘”라고 말해 주세요.' : '준비가 확인되지 않았어요. 연결 설정에서 필요한 조치를 확인해 주세요.', ...(result.warnings ?? [])].join(' '));
    });
  };
  const saveAndCopy = () => run(async () => { if (!task.trim()) throw Error('empty task'); const pet = await save(); await copy(uiPetStartPrompt(pet, task, { audience, message, newTask }), pet); });
  const selectSaved = (item?: SavedPet) => {
    remember();
    const nextEntry = item ? catalogFor(item.template) ?? entry : entry;
    const sameRole = nextEntry.id === entry.id;
    const key = sameRole && !draftKey.current.startsWith('saved:') ? draftKey.current : item ? `saved:${item.id}` : `role:${nextEntry.id}`;
    const previous = drafts.current[key] ?? (sameRole ? drafts.current[draftKey.current] : undefined);
    // Selecting a current configuration refreshes settings, but never moves one role's brief into another.
    enter(key, { ...freshDraft(nextEntry, item ?? null), task: previous?.task ?? nextEntry.example,
      audience: previous?.audience ?? '', message: previous?.message ?? '',
      reuseTarget: sameRole ? reuseTarget : null, newTask: sameRole ? newTask : false });
  };
  function remember() {
    drafts.current[draftKey.current] = { task, audience, message, draft: structuredClone(draft), saved, dirty, prompt, copied, manualCopy, notice, handoff, reuseTarget, newTask };
  }
  const enter = (key: string, value: ComposerDraft) => {
    draftKey.current = key;
    setDraft(structuredClone(value.draft)); setSaved(value.saved); setDirty(value.dirty); setStaleSaved(false); setError('');
    setTask(value.task); setAudience(value.audience); setMessage(value.message); setPrompt(value.prompt); setCopied(value.copied);
    setManualCopy(value.manualCopy); setNotice(value.notice); setHandoff(value.handoff); setReuseTarget(value.reuseTarget); setNewTask(value.newTask);
    setCopyExpanded(key.startsWith('home:') || value.manualCopy || Boolean(value.prompt));
    setSelectedTarget(value.reuseTarget ? JSON.stringify([value.reuseTarget.sourceId, value.reuseTarget.threadId, value.reuseTarget.cwd]) : '');
    setApplied(null);
    selectionButton.current = document.activeElement as HTMLElement; setOpen(true);
  };
  const freshDraft = (next: PetCatalogEntry, item: SavedPet | null = null): ComposerDraft => ({ task: next.example, audience: '', message: '',
    draft: structuredClone(item?.template ?? next.template), saved: item, dirty: !item, prompt: '', copied: false, manualCopy: false, notice: '', handoff: null, reuseTarget: null, newTask: false });
  const selectEntry = (next: PetCatalogEntry, request?: string) => {
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
      enter(key, drafts.current[key] ?? { ...freshDraft(next), task: request });
    } else {
      const key = `role:${next.id}`;
      enter(key, drafts.current[key] ?? freshDraft(next));
    }
  };
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
  const focusSavedConfiguration = () => {
    const field = savedSelector.current;
    if (!field) return;
    field.closest('details')?.setAttribute('open', '');
    field.closest('.composer-more')?.setAttribute('open', '');
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'center' });
  };
  return <><div hidden={open}><PetWorkspace view={view} navigationRevision={navigationRevision} active={active && !open} category={category} onCategory={setCategory} links={links} disconnected={disconnected} legacy={legacy} pets={uiPets} favorites={favorites.ids} onFavorite={favorites.toggle} onSelect={selectEntry} onSaved={openSaved} onNewTask={startAnother} onBrowse={onBrowse} error={favorites.error || library.error} /></div>{open && <section className="pet-composer" data-agent-scope="pet-selection" data-agent-id="pet-selection.composer" aria-label="펫에게 맡기기">
    <header className="composer-top"><button data-agent-id="pet-selection.composer.back" className="text-button" disabled={busy} onClick={close}>← 돌아가기</button><button className="composer-close" disabled={busy} onClick={close} aria-label="펫 준비 닫기">×</button></header>
    <div className="composer-layout">
      <header className="composer-identity" data-agent-id="pet-selection.composer.identity"><TaskPetArt entry={entry} small paused interactive={false} /><div><h1 ref={heading} tabIndex={-1}>{entry.name}</h1><PetSkillSource entry={entry} compact /></div><FavoriteButton label={`${entry.name} 즐겨찾기`} selected={favorites.ids.includes(favoriteId)} disabled={busy || staleSaved} onClick={() => favorites.toggle(favoriteId)} /></header>
      <div className="composer-main">
        {newTask && <p className="composer-reuse-note">설정만 가져왔어요. 새 할 일은 Codex에서 말해 주세요.</p>}
        {!confirmedTarget && <p className="composer-direct-intro">펫을 적용하고, 할 일은 쓰던 Codex에서 말해요.</p>}
        <details className="composer-profile-choice" data-agent-id="pet-selection.composer.profile"><summary>도움 방식 · {executionProfile?.label ?? '설정 확인 필요'}<span>변경</span></summary><fieldset className="composer-profiles" disabled={busy}><legend>어떻게 도와줄까요?</legend><div>{executionProfiles.map(profile => <label key={profile.id}><input type="radio" name="ui-pet-execution-profile" aria-label={profile.label} checked={executionProfile?.id === profile.id} onChange={() => editDraft({ ...draft, execution: { model: profile.model, reasoning: profile.reasoning } })} /><span><strong>{profile.label}{executionProfile?.id === profile.id && <i aria-hidden="true"> ✓</i>}</strong><small>{profile.description}</small></span></label>)}</div></fieldset></details>
        {links.length > 0 && <section className="composer-target" data-agent-id="pet-selection.composer.target" aria-label="펫을 사용할 채팅">
          <label className="ui-pet-select">쓸 Codex 채팅<select data-agent-id="pet-selection.composer.target.select" aria-label="UI 펫을 적용할 채팅" value={selectedTarget} disabled={disabled} onChange={event => { setSelectedTarget(event.target.value); setApplied(null); setNotice(''); setError(''); }}><option value="">채팅을 선택하세요</option>{links.map(link => <option key={targetKey(link)} value={targetKey(link)}>{link.target.cwd.split(/[\\/]/).filter(Boolean).pop()} · {link.target.threadId.slice(-8)}{!link.connected ? ' · 연결 확인 필요' : !link.enabled ? ' · 도움 꺼짐' : unresolvedPetRun(link) ? ' · 작업 확인 필요' : ''}</option>)}</select></label>
          {target && <details className="composer-target-details" data-agent-id="pet-selection.composer.target.details"><summary>선택한 채팅 정보</summary><p className="composer-target-id">{target.target.cwd}<br />채팅 · {target.target.threadId}</p></details>}
          {targetBlocker && <p className="composer-target-blocker" role="status">{targetBlocker}</p>}
        </section>}
        <div className="composer-action composer-direct-action" data-agent-id="pet-selection.composer.action" data-next={!prepared ? 'prepare' : confirmedTarget ? 'chat' : links.length ? 'apply' : 'connect'}>
          {!prepared ? <><button className="button primary" data-agent-id="pet-selection.composer.prepare" disabled={disabled} onClick={prepare}>{busy ? '준비하는 중…' : 'Codex에 펫 준비'}<span aria-hidden="true">↗</span></button><p>처음 한 번만 준비해요.</p></>
            : confirmedTarget ? <section className="composer-applied" data-agent-id="pet-selection.composer.applied" aria-label="펫 적용 확인"><p>같은 채팅에서 <strong>“이 펫으로 ○○해줘”</strong>라고 말해 주세요.</p><PetTaskReturn link={confirmedTarget} disconnected={disconnected} /></section>
            : links.length > 0 ? <><button className="button primary" data-agent-id="pet-selection.composer.apply" disabled={disabled || !routingSupported || !target || Boolean(targetBlocker)} onClick={() => void apply()}>{busy ? '적용 확인 중…' : '이 채팅에 펫 적용'}<span aria-hidden="true">↗</span></button><p>{target ? '지침과 설정을 저장해요. 작업은 채팅에서 시작해요.' : '어느 채팅에서 쓸지 먼저 골라 주세요.'}</p></>
            : <section className="composer-connect-instruction" aria-label="Codex에서 펫 연결"><p>쓸 Codex 채팅에서 이렇게 말해 주세요.</p><strong>“AutoPets 스킬로 제작 펫 연결해줘”</strong><p>연결되면 여기서 펫을 적용할 수 있어요.</p><button className="text-button" disabled={busy} onClick={onConnection}>연결 도움</button></section>}
        </div>
        {notice && !stale && (notice !== '펫 설정을 적용했어요.' || confirmedTarget) && <p className="composer-notice" role="status">{notice}</p>}
        {!routingSupported && <p className="error" role="alert">이 구성의 모델 조합은 아직 연결할 수 없어요. 작업 설정을 다시 선택해 주세요.</p>}
        {!isDesktop && <p className="workspace-note">브라우저 미리보기 · 실제 저장과 연결은 설치된 앱에서 사용해요.</p>}
        {(savedChanged || error || library.error || favorites.error) && <div ref={feedback} className="composer-feedback error" role="alert"><p>{error || library.error || favorites.error || '저장한 펫이 바뀌었어요. 초안은 유지했으니 최신 구성을 다시 선택해 주세요.'}</p>{stale && <button className="text-button" onClick={focusSavedConfiguration}>구성 다시 선택</button>}</div>}
        {overlayError && <p role="status">{overlayError}</p>}
        <details className="composer-copy-fallback" data-agent-id="pet-selection.composer.optional-request" open={copyExpanded} onToggle={event => setCopyExpanded(event.currentTarget.open)}><summary>앱에서 할 일 적기 · 선택</summary>
        <p>여기에 적은 글은 자동 전송되지 않아요. 복사해서 채팅에 보낼 수 있어요.</p>
        <label className="composer-task">{entry.inputLabel}<textarea aria-label="펫에게 맡길 일" rows={4} maxLength={1200} disabled={busy} value={task} placeholder={entry.example} onChange={event => { setTask(event.target.value); invalidateRequest(); }} /></label>
        <button className="text-button composer-example" disabled={busy} onClick={() => { setTask(entry.example); invalidateRequest(); }}>예시로 시작</button>
        {entry.id === 'ui-webpage' && <details className="composer-brief"><summary>작성 도움</summary><div>
          <label>누가 볼 페이지인가요?<input aria-label="페이지를 볼 사람" value={audience} maxLength={160} disabled={busy} placeholder="예: 처음 행사를 찾는 신입생" onChange={event => { setAudience(event.target.value); invalidateRequest(); }} /></label>
          <label>꼭 알릴 내용은 무엇인가요?<input aria-label="꼭 알릴 내용" value={message} maxLength={160} disabled={busy} placeholder="예: 행사 날짜, 장소와 신청 방법" onChange={event => { setMessage(event.target.value); invalidateRequest(); }} /></label>
        </div><p>비워 두어도 시작할 수 있어요.</p></details>}
        <div className="composer-action composer-copy-action"><button className="button secondary" disabled={disabled || !routingSupported || !prepared || !task.trim()} onClick={() => void saveAndCopy()}>{busy ? '준비하는 중…' : copied && !stale ? '시작 요청 다시 복사' : '시작 요청 복사'}<span aria-hidden="true">{copied && !stale ? '✓' : '↗'}</span></button>{!prepared && <p>먼저 위에서 Codex에 펫을 준비해 주세요.</p>}</div>
        {destinations.length > 0 && <section className="composer-destinations" data-next={copied && !stale} aria-label="등록된 Codex 채팅"><p>{reuseTarget ? '이전 작업의 채팅' : '이 펫을 쓰는 채팅'}</p>{destinations.map(link => <div key={targetKey(link)}><small>{link.target.cwd.split(/[\\/]/).pop()} · {link.target.threadId.slice(-8)}</small><PetTaskReturn link={link} disconnected={disconnected} /></div>)}</section>}
        {newRecords.length > 0 && <p className="composer-observed" role="status">연결된 채팅에 새 작업 기록이 있어요. 방금 보낸 요청인지 채팅에서 확인해 주세요.</p>}
        {prompt && !stale && <details className="composer-detail" open={manualCopy || undefined}><summary>Codex에 보낼 요청 확인</summary><label>시작 요청<textarea ref={promptField} aria-label="Codex에 보낼 시작 요청" readOnly rows={6} value={prompt} onFocus={event => event.currentTarget.select()} /></label><p>복사만으로 연결되지는 않아요. 스킬이 불리지 않으면 Codex에서 AutoPets 스킬을 선택해 보내세요.</p>{saved && <FavoriteButton selected={favorites.ids.includes(`saved:${saved.id}`)} label="이 구성 즐겨찾기" onClick={() => favorites.toggle(`saved:${saved.id}`)} />}</details>}
        </details>
        <details className="composer-more" data-agent-id="pet-selection.composer.details" open={stale || undefined}><summary>자세히 <span>{executionProfile?.label ?? '설정 확인 필요'}</span></summary>
        <PetSkillSource entry={entry} />
        <details className="composer-detail"><summary>일하는 방식</summary><p>{entry.summary}</p><p><strong>한계</strong> · {entry.limit}</p><p>{draft.planFirst && <>계획 {settingLabel(draft.planning)} → </>}작업 {settingLabel(draft.execution)}</p><p>펫의 하위 작업에 적용해요. 가용 모델은 실행 전에 확인하고 원래 채팅 모델은 유지해요.</p></details>
        <details className="composer-detail"><summary>연결 순서</summary><ol className="composer-handoff" aria-label="시작 순서">
          <li data-step="prepare" data-status={prepared ? 'done' : 'next'}><strong>{prepared ? '✓' : '1'} 펫 준비</strong><span>{prepared ? '이 PC에 준비됨' : '처음 한 번'}</span></li>
          <li data-step="connect" data-status={target?.connected ? 'done' : prepared ? 'next' : 'pending'}><strong>{target?.connected ? '✓' : '2'} 채팅 연결</strong><span>Codex에서 펫 호출</span></li>
          <li data-step="apply" data-status={confirmedTarget ? 'done' : target?.connected ? 'next' : 'pending'}><strong>{confirmedTarget ? '✓' : '3'} 펫 적용</strong><span>선택한 채팅에 저장</span></li>
          <li data-step="request" data-status={confirmedTarget ? 'next' : 'pending'}><strong>4 할 일 요청</strong><span>같은 채팅에서 말하기</span></li>
        </ol></details>
        {entry.id === 'ui-webpage' && <details className="composer-detail"><summary>내 Figma 시안 참고하기 <span>{figma ? '사용 요청' : '선택 · 사용 안 함'}</span></summary><p>외부 도구 연결 · MCP<br />내 디자인 파일을 읽어 웹페이지 제작에 참고해요.</p><label className="composer-figma"><span>Figma 시안 활용</span><input type="checkbox" aria-label="Figma 시안 활용" checked={figma} disabled={busy} onChange={event => editDraft({ ...draft, features: { figmaDesign: event.target.checked } })} /></label>{figma && <><p>Codex에서 Figma를 연결하고 프레임 링크를 보내주세요. 실제 시안 사용은 작업 뒤 확인해요.</p><a href={FIGMA_GUIDE} target="_blank" rel="noreferrer">공식 Figma 플러그인 연결 안내 ↗</a></>}</details>}
        <details className="composer-detail" open={stale || undefined}><summary>저장한 구성과 연결 관리</summary><label className="ui-pet-select">저장한 구성<select ref={savedSelector} aria-label="저장한 구성" value={stale ? '__stale__' : saved?.id ?? ''} disabled={busy} onChange={event => selectSaved(uiPets.find(pet => pet.id === event.target.value))}>{stale && <option value="__stale__" disabled>최신 구성을 다시 선택해 주세요</option>}<option value="">새 구성</option>{uiPets.map(pet => <option key={pet.id} value={pet.id}>{pet.template.name} · 수정 {pet.revision}</option>)}</select></label>
          <button className="text-button" disabled={busy} onClick={onConnection}>연결 도움</button>
        </details>
        </details>
      </div>
    </div>
  </section>}</>;
}
