import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PetLink, PetRoleSnapshot, PetRoleTemplate, SavedPet, SetupState, WorkflowModel } from '@autopets/contracts/types';
import template from '../../../../../packages/contracts/data/ui-pet.json';
import { petCatalog, catalogFor, type PetCatalogEntry } from './petCatalog';
import { command, isDesktop } from '../../bridge/command';
import { useRoles } from '../../bridge/useRoles';
import { TaskPetArt, ResultPreview } from './TaskPetArt';
import { PetWorkspace, type PetWorkspaceView } from './PetWorkspace';
import { PetTaskReturn } from './PetTaskReturn';
import { unresolvedPetRun } from './ExplicitPet';
import { FavoriteButton, PetIntroduction } from './PetIntroduction';
import { PetSkillSource } from './PetSkillSource';

import { usePetFavorites } from './usePetFavorites';
import './ui-pet-studio.css';

export const FIGMA_GUIDE = 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/#codex';
const EXAMPLE_TASK = '가상 학과 행사 소개 웹페이지 한 장. 행사 소개, 일정, 신청 안내와 모바일 화면을 포함해줘.';
const settingLabel = (value: WorkflowModel | null) => value ? `${({ 'gpt-6-luna': 'Luna', 'gpt-6-sol': 'Sol', 'gpt-6-astra': 'Astra' } as Record<string, string>)[value.model] ?? value.model} · ${value.reasoning}` : 'Luna · low';
const supportedRouting = (draft: PetRoleTemplate) => (!draft.planning || (draft.planning.model === 'gpt-6-luna' && draft.planning.reasoning === 'low')) && (!draft.execution || (draft.execution.model === 'gpt-6-luna' && draft.execution.reasoning === 'low') || (draft.execution.model === 'gpt-6-sol' && ['low', 'medium'].includes(draft.execution.reasoning)));
const targetKey = (link: PetLink) => JSON.stringify([link.target.sourceId, link.target.threadId, link.target.cwd]);
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

export const uiPetStartPrompt = (pet: SavedPet, task = EXAMPLE_TASK) => [
  `AutoPets 스킬로 현재 채팅에 ${pet.template.name}을 연결해줘. 저장한 펫: petId=${pet.id}, petRevision=${pet.revision}.`,
  `이 펫으로 아래 작업${pet.template.planFirst ? '의 계획만 세워줘' : '을 수행하고 결과를 채팅에 보여줘'}.\n\n${task.trim()}\n`,
  pet.template.features?.figmaDesign ? 'Figma 시안 활용 특성을 선택했어. 사용할 프레임 링크를 나에게 먼저 확인하고, 실제 시안을 읽은 뒤 계획해줘. 연결이나 접근이 안 되면 필요한 조치를 알려줘.' : '별도 서비스 연결 없이 가능한 범위부터 도와주고, 외부 서비스가 필요하면 먼저 알려줘.',
  pet.template.planFirst ? '지금은 파일을 바꾸지 말고 계획을 보여준 뒤 내 구현 요청을 기다려줘. 구현 위치와 기존 파일을 먼저 확인하고 기존 내용을 덮어쓰지 마.' : '파일을 수정하거나 외부 서비스에 등록하지 말고, 제공한 내용을 바탕으로 결과를 보여줘. 확인할 수 없는 사실은 미확인으로 구분해줘.',
  ...(task.trim() === EXAMPLE_TASK ? ['이 예시에는 실제 개인정보 대신 가상 내용을 사용하고, 구현할 때는 새 autopets-demo 폴더를 사용하되 기존 파일이 있으면 먼저 알려줘.'] : []),
].join('\n');

export function UiPetStudio({ links, setup, onConnection, active = true, view = 'pets', onBrowse, legacy, disconnected = false, onBusyChange }: { links: PetLink[]; setup?: SetupState | null; onConnection: () => void; active?: boolean; view?: PetWorkspaceView; onBrowse: () => void; legacy?: ReactNode; disconnected?: boolean; onBusyChange: (busy: boolean) => void }) {
  const library = useRoles();
  const favorites = usePetFavorites();
  const [open, setOpen] = useState(false);

  const [draft, setDraft] = useState<PetRoleTemplate>(() => structuredClone(template) as PetRoleTemplate);
  const [category, setCategory] = useState<'all' | 'daily' | 'work'>('all');
  const taskDrafts = useRef<Record<string, string>>({});
  const roleDrafts = useRef<Record<string, { draft: PetRoleTemplate; saved: SavedPet | null; dirty: boolean }>>({});
  const [manualCopy, setManualCopy] = useState(false);
  const selectionButton = useRef<HTMLElement | null>(null);
  const listScroll = useRef(0);
  const [saved, setSaved] = useState<SavedPet | null>(null);
  const [dirty, setDirty] = useState(true);
  const [staleSaved, setStaleSaved] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [localSetup, setLocalSetup] = useState<SetupState | null>(null);
  const [prompt, setPrompt] = useState('');
  const [task, setTask] = useState(EXAMPLE_TASK);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [overlayError, setOverlayError] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const promptField = useRef<HTMLTextAreaElement>(null);


  const setupKey = JSON.stringify(setup?.connections);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => { setOpen(false); }, [view]);
  useEffect(() => { if (open && active) { window.scrollTo(0, 0); heading.current?.focus({ preventScroll: true }); } }, [open, active]);
  const close = () => { if (!working.current) { setOpen(false); requestAnimationFrame(() => {
      const label = selectionButton.current?.getAttribute('aria-label');
      const selected = label ? [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label && button.offsetParent !== null) : null;
      window.scrollTo(0, listScroll.current);
      (selected ?? document.querySelector<HTMLButtonElement>(`.workspace-role-card[data-role="${entry.id}"] .workspace-role-select`) ?? document.querySelector<HTMLButtonElement>('.nav-item[aria-current="page"]'))?.focus({ preventScroll: true });
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

  const disabled = busy || staleSaved || !isDesktop || !library.loaded || Boolean(library.error);
  const figma = draft.features?.figmaDesign === true;
  const routingSupported = supportedRouting(draft);
  const executionProfile = executionProfiles.find(profile => profile.model === (draft.execution?.model ?? 'gpt-6-luna') && profile.reasoning === (draft.execution?.reasoning ?? 'low'));
  const editDraft = (next: PetRoleTemplate) => { setDraft(next); setDirty(true); setPrompt(''); setNotice(''); setCopied(false); };
  const run = async (operation: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setNotice(''); setPrompt(''); setCopied(false);
    try { await operation(); }
    catch (cause) {
      const value = String(cause);
      const changed = /revision|stale|conflict/.test(value);
      const savedChanged = /saved[- ]pet.*(?:revision|stale|changed|not-found)/i.test(value);
      if (savedChanged) setStaleSaved(true);
      setError(savedChanged ? '저장한 펫이 다른 곳에서 바뀌었어요. 최신 구성을 다시 선택해 주세요.' : changed ? '채팅 설정이 바뀌었어요. 대상을 다시 확인해 주세요.' : '처리하지 못했어요. 연결 설정을 확인하고 다시 시도해 주세요.');
      await library.refresh();
    } finally { working.current = false; setBusy(false); }
  };
  const save = async () => {
    let result = saved;
    if (!result || dirty) {
      result = await command<SavedPet>('save_pet', { id: saved?.id ?? null, expectedRevision: saved?.revision ?? 0, template: draft });
      setSaved(result); setDraft(structuredClone(result.template)); setDirty(false);
    }
    // A previous copy is only reusable while this exact saved revision still exists.
    // Query the host again, including after a save; React's last event may be stale.
    const current = await command<PetRoleSnapshot>('roles_snapshot');
    if (!current || !Array.isArray(current.pets) || !Array.isArray(current.templates) || !Array.isArray(current.bindings)) throw Error('saved-pet-verification-unavailable');
    const latest = current.pets.find(pet => pet.id === result.id);
    if (!latest || latest.revision !== result.revision) throw Error('saved-pet-revision-changed');
    await library.refresh();
    return result;
  };
  const copy = async (value: string) => {
    setPrompt(value); setManualCopy(false);
    try { await navigator.clipboard.writeText(value); setCopied(true); setNotice('복사했어요. 사용할 Codex 채팅에 붙여넣고 보내주세요.'); }
    catch { setManualCopy(true); setNotice('자동 복사가 되지 않았어요. 아래 요청을 직접 선택해 복사해 주세요.'); }
  };
  const prepare = () => {
    if (prepared) return;
    void run(async () => {
      const result = await command<SetupState>('connect_ai', { hostId: 'codex-windows-local' });
      setLocalSetup(result);

      setNotice([explicitSetupReady(result) ? '펫을 부르는 스킬을 준비했어요.' : '준비가 확인되지 않았어요. 연결 설정에서 필요한 조치를 확인해 주세요.', ...(result.warnings ?? [])].join(' '));
    });
  };
  const saveAndCopy = () => run(async () => { if (!task.trim()) throw Error('empty task'); await copy(uiPetStartPrompt(await save(), task)); });
  const selectSaved = (item?: SavedPet) => {
    taskDrafts.current[entry.id] = task;
    const nextEntry = item ? catalogFor(item.template) ?? entry : entry;
    setCategory(nextEntry.category); setTask(taskDrafts.current[nextEntry.id] ?? nextEntry.example);
    setSaved(item ?? null); setDraft(structuredClone(item?.template ?? entry.template) as PetRoleTemplate);
    setDirty(!item); setStaleSaved(false); setError(''); setPrompt(''); setNotice(''); setCopied(false);
  };
  const remember = () => {
    taskDrafts.current[entry.id] = task;
    roleDrafts.current[entry.id] = { draft: structuredClone(draft), saved, dirty };
  };
  const selectEntry = (next: PetCatalogEntry) => {
    listScroll.current = window.scrollY;
    remember();
    const previous = roleDrafts.current[next.id];
    setDraft(structuredClone(previous?.draft ?? next.template));
    setSaved(previous?.saved ?? null); setDirty(previous?.dirty ?? true); setStaleSaved(false);
    setTask(taskDrafts.current[next.id] ?? next.example); setPrompt(''); setNotice(''); setError(''); setCopied(false);
    selectionButton.current = document.activeElement as HTMLElement; setOpen(true);
  };
  const openSaved = (item: SavedPet) => { listScroll.current = window.scrollY; remember(); selectSaved(item); selectionButton.current = document.activeElement as HTMLElement; setOpen(true); };
  const apply = () => run(async () => {
    if (!target || !target.connected || unresolvedPetRun(target)) throw Error('target unavailable');
    const result = await save();
    await command('apply_pet_link_template', { target: target.target, expectedRevision: target.revision, petId: result.id, petRevision: result.revision });
    setNotice('선택한 채팅의 다음 펫 작업에 저장했어요. 새 계획부터 요청해 주세요.');
  });
  if (!open) return <PetWorkspace view={view} active={active} category={category} onCategory={setCategory} links={links} disconnected={disconnected} legacy={legacy} pets={uiPets} favorites={favorites.ids} onFavorite={favorites.toggle} onSelect={selectEntry} onSaved={openSaved} onBrowse={onBrowse} error={favorites.error || library.error} />;
  return <section className="pet-composer" aria-label="펫에게 맡기기">
    <header className="composer-top"><button className="text-button" disabled={busy} onClick={close}>← 펫 목록</button><span>내 일에 맞게 준비해요</span><button className="composer-close" disabled={busy} onClick={close} aria-label="펫 준비 닫기">×</button></header>
    <div className="composer-layout">
      <aside className="composer-preview"><div className="composer-pet-stage"><TaskPetArt entry={entry} paused={!active} /></div><h1 ref={heading} tabIndex={-1}>{entry.name}</h1><p>{entry.summary}</p><FavoriteButton label={`${entry.name} 즐겨찾기`} selected={favorites.ids.includes(favoriteId)} disabled={busy || staleSaved} onClick={() => favorites.toggle(favoriteId)} /><ResultPreview entry={entry} /><PetSkillSource entry={entry} /></aside>
      <div className="composer-main">
        <label className="composer-task">{entry.inputLabel}<textarea aria-label="펫에게 맡길 일" rows={3} maxLength={1200} disabled={busy} value={task} placeholder={entry.example} onChange={event => { setTask(event.target.value); setPrompt(''); setCopied(false); setNotice(''); }} /><span>{entry.optionalLabel}도 적어주면 좋아요.</span></label>
        <button className="text-button composer-example" disabled={busy} onClick={() => { setTask(entry.example); setPrompt(''); setCopied(false); setNotice(''); }}>예시로 시작</button>
        <details className="composer-profile-choice"><summary>도움 방식 · {executionProfile?.label ?? '설정 확인 필요'}<span>변경</span></summary><fieldset className="composer-profiles" disabled={busy}><legend>어떻게 도와줄까요?</legend><div>{executionProfiles.map(profile => <label key={profile.id}><input type="radio" name="ui-pet-execution-profile" aria-label={profile.label} checked={executionProfile?.id === profile.id} onChange={() => editDraft({ ...draft, execution: { model: profile.model, reasoning: profile.reasoning } })} /><span><strong>{profile.label}{executionProfile?.id === profile.id && <i aria-hidden="true"> ✓</i>}</strong><small>{profile.description}</small></span></label>)}</div></fieldset></details>
        <div className="composer-path"><span>1  {draft.planFirst ? '계획 보기' : '일 맡기기'}</span><i aria-hidden="true">→</i><span>2  {draft.planFirst ? '채팅에서 구현 요청' : '결과 받기'}</span><i aria-hidden="true">→</i><span>3  결과 확인</span></div>
        {!prepared && <div className="composer-connection"><strong>먼저 Codex에 펫을 준비해요.</strong><p>이 PC에서 펫을 부르는 방법을 추가해요.</p></div>}
        <div className="composer-action"><button className="button primary" disabled={disabled || !routingSupported || (prepared && !task.trim())} onClick={() => prepared ? void saveAndCopy() : prepare()}>{busy ? '준비하는 중…' : !prepared ? 'Codex에 펫 준비' : copied ? '시작 요청 다시 복사' : '시작 요청 복사'}<span aria-hidden="true">{copied ? '✓' : '↗'}</span></button><p>{matchingLinks.length ? '이 구성으로 연결된 채팅이 있어요.' : copied ? '쓸 Codex 채팅에 붙여넣고 보내세요.' : prepared ? '쓰던 Codex 채팅에서 시작해요.' : '한 번 준비하면 다음부터 바로 시작해요.'}</p></div>
        {notice && <p className="composer-notice" role="status">{notice}</p>}
        {matchingLinks.map(link => <PetTaskReturn key={targetKey(link)} link={link} />)}
        {prompt && <details className="composer-detail" open={manualCopy || undefined}><summary>Codex에 보낼 요청 확인</summary><label>시작 요청<textarea ref={promptField} aria-label="Codex에 보낼 시작 요청" readOnly rows={6} value={prompt} onFocus={event => event.currentTarget.select()} /></label><p>복사만으로 연결되지는 않아요. 스킬이 불리지 않으면 Codex에서 AutoPets 스킬을 선택해 보내세요.</p>{saved && <FavoriteButton selected={favorites.ids.includes(`saved:${saved.id}`)} label="이 구성 즐겨찾기" onClick={() => favorites.toggle(`saved:${saved.id}`)} />}</details>}
        <details className="composer-detail"><summary>일하는 방식 자세히</summary><p><strong>잘하는 일</strong> · {entry.summary}</p><p><strong>한계</strong> · {entry.limit}</p><p>{draft.planFirst && <>계획 {settingLabel(draft.planning)} → </>}작업 {settingLabel(draft.execution)}</p><p>펫의 하위 작업에 적용해요. 가용 모델은 실행 전에 확인하고 원래 채팅 모델은 유지해요.</p><PetIntroduction entry={entry} /></details>
        {entry.id === 'ui-webpage' && <details className="composer-detail"><summary>내 Figma 시안 참고하기 <span>{figma ? '사용 요청' : '선택 · 사용 안 함'}</span></summary><p>외부 도구 연결 · MCP<br />내 디자인 파일을 읽어 웹페이지 제작에 참고해요.</p><label className="composer-figma"><span>Figma 시안 활용</span><input type="checkbox" aria-label="Figma 시안 활용" checked={figma} disabled={busy} onChange={event => editDraft({ ...draft, features: { figmaDesign: event.target.checked } })} /></label>{figma && <><p>Codex에서 Figma를 연결하고 프레임 링크를 보내주세요. 실제 시안 사용은 작업 뒤 확인해요.</p><a href={FIGMA_GUIDE} target="_blank" rel="noreferrer">공식 Figma 플러그인 연결 안내 ↗</a></>}</details>}
        <details className="composer-detail" open={staleSaved || undefined}><summary>저장한 구성과 연결 관리</summary><label className="ui-pet-select">저장한 구성<select aria-label="저장한 구성" value={staleSaved ? '__stale__' : saved?.id ?? ''} disabled={busy} onChange={event => selectSaved(uiPets.find(pet => pet.id === event.target.value))}>{staleSaved && <option value="__stale__" disabled>최신 구성을 다시 선택해 주세요</option>}<option value="">새 구성</option>{uiPets.map(pet => <option key={pet.id} value={pet.id}>{pet.template.name} · 수정 {pet.revision}</option>)}</select></label>
          {links.length > 0 && <><p>다른 연결의 다음 작업에 적용할 수 있어요.</p><label className="ui-pet-select">대상 채팅<select aria-label="UI 펫을 적용할 채팅" value={selectedTarget} disabled={disabled} onChange={event => { setSelectedTarget(event.target.value); setNotice(''); }}><option value="">채팅을 선택하세요</option>{links.map(link => <option key={targetKey(link)} value={targetKey(link)}>{link.target.cwd.split(/[\\/]/).pop()} · {link.target.threadId.slice(-8)}</option>)}</select></label>{target && <p className="ui-pet-target">{target.target.cwd}<br />채팅 {target.target.threadId}</p>}<button className="button secondary" disabled={disabled || !routingSupported || !target?.connected || unresolvedPetRun(target)} onClick={() => void apply()}>저장하고 선택 채팅에 적용</button></>}
          <button className="text-button" disabled={busy} onClick={onConnection}>연결 도움</button>
        </details>
        {!routingSupported && <p className="error" role="alert">이 구성의 모델 조합은 아직 연결할 수 없어요. 작업 설정을 다시 선택해 주세요.</p>}
        {!isDesktop && <p className="workspace-note">브라우저 미리보기 · 실제 저장과 연결은 설치된 앱에서 사용해요.</p>}
        {(error || library.error || favorites.error) && <p className="error" role="alert">{error || library.error || favorites.error}</p>}{overlayError && <p role="status">{overlayError}</p>}
      </div>
    </div>
  </section>;
}
