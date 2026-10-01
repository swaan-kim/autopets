import { useEffect, useRef, useState } from 'react';
import type { PetLink, PetRoleSnapshot, PetRoleTemplate, SavedPet, SetupState, WorkflowModel } from '@autopets/contracts/types';
import template from '../../../../../packages/contracts/data/ui-pet.json';
import { command, isDesktop } from '../../bridge/command';
import { useRoles } from '../../bridge/useRoles';
import { Pet } from './Pet';
import { unresolvedPetRun } from './ExplicitPet';
import './ui-pet-studio.css';

export const FIGMA_GUIDE = 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/#codex';
const SKILL_SOURCE = 'https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md';
const settingLabel = (value: WorkflowModel | null) => value ? `${({ 'gpt-6-luna': 'Luna', 'gpt-6-sol': 'Sol', 'gpt-6-astra': 'Astra' } as Record<string, string>)[value.model] ?? value.model} · ${value.reasoning}` : 'Luna · low';
const supportedRouting = (draft: PetRoleTemplate) => (!draft.planning || (draft.planning.model === 'gpt-6-luna' && draft.planning.reasoning === 'low')) && (!draft.execution || (draft.execution.model === 'gpt-6-luna' && draft.execution.reasoning === 'low') || (draft.execution.model === 'gpt-6-sol' && ['low', 'medium'].includes(draft.execution.reasoning)));
const targetKey = (link: PetLink) => JSON.stringify([link.target.sourceId, link.target.threadId, link.target.cwd]);
const explicitSetupReady = (setup?: SetupState | null) => setup?.connectionMode === 'explicit-pet' && setup.connections?.some(connection => connection.hostId === 'codex-windows-local' && connection.configured) === true;
const executionProfiles = [
  { id: 'light', label: '가볍게', description: '작은 페이지부터', model: 'gpt-6-luna', reasoning: 'low' },
  { id: 'standard', label: '표준', description: '기본 제작에', model: 'gpt-6-sol', reasoning: 'low' },
  { id: 'careful', label: '꼼꼼하게', description: '더 깊이 검토할 때', model: 'gpt-6-sol', reasoning: 'medium' },
] as const;

function StudioIcon({ kind }: { kind: 'plan' | 'settings' | 'chat' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'plan' ? <><rect x="5" y="4" width="14" height="17" rx="3" /><path d="M9 3h6v4H9zM9 12h6M9 16h4" /></> : kind === 'settings' ? <><path d="M5 6h14M5 12h14M5 18h14" /><circle cx="9" cy="6" r="2" fill="white" /><circle cx="15" cy="12" r="2" fill="white" /><circle cx="10" cy="18" r="2" fill="white" /></> : <><path d="M20 11a8 8 0 0 1-8 8H8l-4 2 1-5a8 8 0 1 1 15-5Z" /><path d="M8 10h8M8 14h5" /></>}
  </svg>;
}
// Preserve order across quick navigation and React effect cleanup/remount.
let onboardingCommands = Promise.resolve();
function setOnboardingActive(active: boolean) {
  const request = onboardingCommands.then(() => command('set_onboarding_active', { active }));
  onboardingCommands = request.catch(() => undefined);
  return request;
}

export const uiPetStartPrompt = (pet: SavedPet) => [
  `AutoPets 스킬로 현재 채팅에 UI 제작 펫을 연결해줘. 저장한 펫: petId=${pet.id}, petRevision=${pet.revision}.`,
  '이 펫으로 가상 학과 행사 소개 웹페이지 한 장의 계획만 세워줘. 행사 소개, 일정, 신청 안내와 모바일 화면을 포함해줘.',
  pet.template.features?.figmaDesign ? 'Figma 시안 활용 특성을 선택했어. 사용할 프레임 링크를 나에게 먼저 확인하고, 실제 시안을 읽은 뒤 계획해줘. 연결이나 접근이 안 되면 필요한 조치를 알려줘.' : '외부 서비스 없이 브라우저에서 열 수 있는 작은 페이지로 만들고, 실제 개인정보 대신 가상 내용을 사용해줘.',
  '지금은 파일을 바꾸지 말고 계획을 보여준 뒤 내 구현 요청을 기다려줘. 구현할 때는 새 autopets-demo 폴더를 사용하되 기존 파일이 있으면 먼저 알려줘.',
].join('\n');

export function UiPetStudio({ links, setup, onConnection, onOpenChange, active = true, initiallyOpen = !links.length }: { links: PetLink[]; setup?: SetupState | null; onConnection: () => void; onOpenChange?: (open: boolean) => void; active?: boolean; initiallyOpen?: boolean }) {
  const library = useRoles();
  const [open, setOpen] = useState(initiallyOpen);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [draft, setDraft] = useState<PetRoleTemplate>(() => structuredClone(template) as PetRoleTemplate);
  const [saved, setSaved] = useState<SavedPet | null>(null);
  const [dirty, setDirty] = useState(true);
  const [staleSaved, setStaleSaved] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [localSetup, setLocalSetup] = useState<SetupState | null>(null);
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const [referenceNotice, setReferenceNotice] = useState('');
  const [referenceFallback, setReferenceFallback] = useState('');
  const [error, setError] = useState('');
  const [overlayError, setOverlayError] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const promptField = useRef<HTMLTextAreaElement>(null);
  const launchButton = useRef<HTMLButtonElement>(null);
  const focusLaunch = useRef(false);
  const focusHeading = useRef(false);
  const setupKey = JSON.stringify(setup?.connections);
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  useEffect(() => {
    if (notice.startsWith('자동 복사가 되지 않았어요.')) promptField.current?.focus();
  }, [notice]);
  useEffect(() => {
    if (!open && active && focusLaunch.current) launchButton.current?.focus();
    focusLaunch.current = false;
  }, [open, active]);
  useEffect(() => { setLocalSetup(null); }, [setupKey]);
  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false;
    void setOnboardingActive(open && active).then(() => { if (!disposed) setOverlayError(''); }).catch(() => { if (!disposed) setOverlayError('바탕화면 펫을 잠시 숨기지 못했어요. 화면을 가리면 펫 메뉴에서 숨겨 주세요.'); });
    return () => { disposed = true; void setOnboardingActive(false).catch(() => undefined); };
  }, [open, active]);
  useEffect(() => {
    if (open && active && focusHeading.current) heading.current?.focus();
    focusHeading.current = false;
  }, [step, open, active]);
  const goTo = (value: 1 | 2 | 3) => { focusHeading.current = true; setStep(value); setError(''); setNotice(''); setCopied(false); };
  const currentSetup = localSetup ?? setup;
  const prepared = explicitSetupReady(currentSetup);
  const target = links.find(link => targetKey(link) === selectedTarget);
  const matchingLinks = saved && !dirty && !staleSaved ? links.filter(link => link.connected && link.savedPet?.id === saved.id && link.savedPet.revision === saved.revision) : [];
  const uiPets = library.snapshot.pets.filter(pet => pet.template.skills.some(skill => skill.id === 'frontend-design'));
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
    setPrompt(value);
    try { await navigator.clipboard.writeText(value); setCopied(true); setNotice('복사했어요. 사용할 Codex 채팅에 붙여넣고 보내주세요.'); }
    catch { setNotice('자동 복사가 되지 않았어요. 아래 요청을 직접 선택해 복사해 주세요.'); }
  };
  const copyReference = async (url: string) => {
    setReferenceFallback('');
    try { await navigator.clipboard.writeText(url); setReferenceNotice('주소를 복사했어요. 브라우저에서 열어보세요.'); }
    catch { setReferenceNotice('아래 주소를 직접 선택해 복사해 주세요.'); setReferenceFallback(url); }
  };
  const prepare = () => {
    if (prepared) { goTo(3); return; }
    void run(async () => {
      const result = await command<SetupState>('connect_ai', { hostId: 'codex-windows-local' });
      setLocalSetup(result);
      if (explicitSetupReady(result)) goTo(3);
      setNotice([explicitSetupReady(result) ? '펫을 부르는 스킬을 준비했어요.' : '준비가 확인되지 않았어요. 연결 설정에서 필요한 조치를 확인해 주세요.', ...(result.warnings ?? [])].join(' '));
    });
  };
  const saveAndCopy = () => run(async () => { await copy(uiPetStartPrompt(await save())); });
  const apply = () => run(async () => {
    if (!target || !target.connected || unresolvedPetRun(target)) throw Error('target unavailable');
    const result = await save();
    await command('apply_pet_link_template', { target: target.target, expectedRevision: target.revision, petId: result.id, petRevision: result.revision });
    setNotice('선택한 채팅의 다음 펫 작업에 저장했어요. 새 계획부터 요청해 주세요.');
  });
  const title = step === 1 ? '아이디어를 웹페이지로.' : step === 2 ? '필요한 것만 연결해요.' : '이제, 채팅에서 시작해요.';
  if (!open) return <section className="ui-pet-launch" aria-label="새 펫 준비"><div><strong>새로운 작업도 펫과 함께</strong><p>다른 채팅에 쓸 펫을 준비해 보세요.</p></div><button ref={launchButton} className="button secondary" onClick={() => { focusHeading.current = true; setOpen(true); }}>펫 준비</button></section>;
  return <section className="ui-pet-studio" aria-label="UI 제작 펫 시작하기">
    <div className="ui-pet-wizard" data-step={step}>
      <header className="ui-pet-wizard-top"><ol className="pet-journey" aria-label="펫 준비 순서">{['내 펫', '연결', '시작'].map((label, index) => <li key={label} className={index + 1 < step ? 'is-complete' : undefined} aria-current={index + 1 === step ? 'step' : undefined}><span aria-hidden="true">{index + 1 < step ? '✓' : index + 1}</span>{label}</li>)}</ol><button className="ui-pet-close" disabled={busy} onClick={() => { focusLaunch.current = true; setOpen(false); }} aria-label="펫 준비 닫기">×</button></header>
      <div className="ui-pet-step" aria-labelledby="ui-pet-step-title">
        <h1 id="ui-pet-step-title" ref={heading} tabIndex={-1}>{title}</h1>
        {step === 1 && <>
          <div className="ui-pet-preview"><div className="ui-pet-portrait"><Pet activity="idle" /><span>UI 제작 펫</span></div><div className="ui-pet-introduction"><span className="ui-pet-tag">함께 만드는 첫 화면</span><h2>무엇을 만들지<br />알려주세요.</h2><p>계획을 정리하고, 확인한 내용을<br />웹페이지로 만드는 펫이에요.</p><a className="ui-pet-source" href={SKILL_SOURCE} target="_blank" rel="noreferrer">Anthropic frontend-design 기반 ↗</a></div></div>
          <fieldset className="ui-pet-profiles" disabled={busy}><legend>어떻게 만들까요?</legend><div>{executionProfiles.map(profile => <label key={profile.id} className="ui-pet-profile"><input type="radio" name="ui-pet-execution-profile" aria-label={profile.label} checked={executionProfile?.id === profile.id} onChange={() => editDraft({ ...draft, planning: { model: 'gpt-6-luna', reasoning: 'low' }, execution: { model: profile.model, reasoning: profile.reasoning } })} /><span><strong>{profile.label}</strong><small>{profile.description}</small></span></label>)}</div></fieldset>
          <ul className="ui-pet-benefits"><li><StudioIcon kind="plan" /><div><strong>만들기 전에, 계획부터</strong><span>먼저 계획을 보여주고 내 요청을 기다려요.</span></div></li><li><StudioIcon kind="settings" /><div><strong>일하는 방법과 설정을 함께</strong><span>화면 제작 스킬과 선택한 제작 설정을 준비해요.</span></div></li><li><StudioIcon kind="chat" /><div><strong>하던 채팅에서 끝까지</strong><span>Codex에서 요청하고 펫에서 진행을 확인해요.</span></div></li></ul>
          <p className="ui-pet-example"><span>첫 체험</span><strong>가상 학과 행사 소개 웹페이지 한 장</strong></p>
          <details className="ui-pet-detail" open={staleSaved || undefined}><summary>모델과 저장한 구성</summary>
            <p>스킬은 AI가 참고하는 일하는 방법이에요. 이 펫은 화면 제작 스킬을 사용해요.</p>
            <p className="ui-pet-route">계획 <strong>{settingLabel(draft.planning)}</strong><span aria-hidden="true">→</span>제작 <strong>{settingLabel(draft.execution)}</strong></p>
            <small>가용 모델은 실행 전에 확인해요. 원래 채팅 모델은 유지돼요.</small>
            {(uiPets.length > 0 || saved) && <label className="ui-pet-select">저장한 구성<select aria-label="저장한 구성" value={staleSaved ? '__stale__' : saved?.id ?? ''} disabled={busy} onChange={event => { const item = uiPets.find(pet => pet.id === event.target.value); setSaved(item ?? null); setDraft(structuredClone(item?.template ?? template) as PetRoleTemplate); setDirty(!item); setStaleSaved(false); setError(''); setPrompt(''); setNotice(''); setCopied(false); }}>{staleSaved && <option value="__stale__" disabled>최신 구성이나 새 구성을 선택해 주세요</option>}<option value="">새 구성</option>{uiPets.map(pet => <option key={pet.id} value={pet.id}>{pet.template.name} · {pet.template.features?.figmaDesign ? 'Figma 활용' : '기본 제작'} · 수정 {pet.revision}</option>)}</select></label>}
            <button className="text-button" onClick={() => void copyReference(SKILL_SOURCE)}>스킬 원본 주소 복사</button>
          </details>
        </>}
        {step === 2 && <>
          <p className="ui-pet-step-lead">지금 쓰는 Codex에서 펫을 부를 수 있게 준비해요.</p>
          <div className="ui-pet-services"><div className="ui-pet-service"><div className="ui-pet-service-symbol" aria-hidden="true">C</div><div><strong>Codex <span className="ui-pet-required">필수</span></strong><p>{prepared ? '이 PC에서 펫을 부를 준비가 됐어요.' : '계획과 제작을 요청할 곳이에요.'}</p></div><span className="ui-pet-service-state" data-ready={prepared}>{prepared ? '준비됨' : '준비 전'}</span></div>
          <label className="ui-pet-service ui-pet-feature"><div className="ui-pet-service-symbol figma-symbol" aria-hidden="true">F</div><div><strong>Figma <span className="ui-pet-required">선택</span></strong><p>가지고 있는 시안을 참고할 때 켜세요.</p></div><input type="checkbox" aria-label="Figma 시안 활용" checked={figma} disabled={busy} onChange={event => editDraft({ ...draft, features: { figmaDesign: event.target.checked } })} /></label></div>
          {figma ? <div className="ui-pet-figma"><strong>Figma는 Codex에서 연결해 주세요.</strong><p>연결 도구(MCP)를 준비한 뒤 사용할 프레임 링크를 채팅에 보내세요.</p><a href={FIGMA_GUIDE} target="_blank" rel="noreferrer">공식 Figma 플러그인 연결 안내 ↗</a><button className="text-button" onClick={() => void copyReference(FIGMA_GUIDE)}>Figma 안내 주소 복사</button><small>선택만으로 연결되지 않아요. 실제 시안 사용은 작업 뒤 확인해요.</small></div> : <p className="ui-pet-optional">Figma 없이도 설명만으로 만들 수 있어요.</p>}
        </>}
        {step === 3 && <>
          <p className="ui-pet-step-lead">시작 문장은 펫이 준비했어요.<br />복사해서 사용할 Codex 채팅에 한 번 보내주세요.</p>
          <div className="ui-pet-ready-summary"><Pet small paused /><div><span className="ui-pet-tag">준비한 구성</span><strong>{draft.name}</strong><p>{executionProfile?.label ?? '제작 설정 확인 필요'} · 계획 확인 후 제작 · {figma ? 'Figma 시안 활용' : '외부 연결 없이 제작'}</p></div></div>
          <ol className="ui-pet-use-steps"><li><span>1</span><div><strong>Codex에 시작 요청 보내기</strong><p>아래 버튼으로 복사한 문장을 붙여넣어 보내세요.</p></div></li><li><span>2</span><div><strong>계획을 보고 제작 요청하기</strong><p>마음에 들면 <em>“그대로 구현해줘”</em>라고 보내세요.</p></div></li><li><span>3</span><div><strong>완성된 웹페이지 확인하기</strong><p>펫에서 같은 채팅으로 돌아가 결과를 열어보세요.</p></div></li></ol>
          <p className="ui-pet-connection-state" role="status">{matchingLinks.length ? `이 구성으로 연결된 채팅 ${matchingLinks.length}개` : '채팅 연결 대기 · 복사는 아직 전송이 아니에요.'}</p>
          {prompt && <div className="ui-pet-prompt"><label>Codex에 보낼 시작 요청<textarea ref={promptField} aria-label="Codex에 보낼 시작 요청" readOnly rows={5} value={prompt} onFocus={event => event.currentTarget.select()} /></label><small>스킬이 호출되지 않으면 Codex에서 AutoPets 스킬을 직접 선택해 보내세요.</small></div>}
          {links.length > 0 && <details className="ui-pet-detail ui-pet-existing"><summary>이미 연결한 채팅에 이 구성 적용</summary><p>선택한 채팅의 다음 펫 작업을 바꿔요. 이전 계획은 다시 확인해야 해요.</p><label className="ui-pet-select">대상 채팅<select aria-label="UI 펫을 적용할 채팅" value={selectedTarget} disabled={disabled} onChange={event => { setSelectedTarget(event.target.value); setNotice(''); }}><option value="">정확한 채팅을 선택하세요</option>{links.map(link => <option key={targetKey(link)} value={targetKey(link)}>{link.target.cwd.split(/[\\/]/).pop()} · {link.target.threadId.slice(-8)}{!link.connected ? ' · 연결 재확인 필요' : ''}</option>)}</select></label>{target && <p className="ui-pet-target">{target.target.cwd}<br />채팅 {target.target.threadId}</p>}<button className="button secondary" disabled={disabled || !routingSupported || !target?.connected || unresolvedPetRun(target)} onClick={() => void apply()}>저장하고 선택 채팅에 적용</button></details>}
        </>}
        {!routingSupported && <p className="error" role="alert">이 구성의 모델 조합은 아직 연결할 수 없어요. 내 펫 단계에서 제작 설정을 다시 선택해 주세요.</p>}
        {!isDesktop && <p className="ui-pet-optional">브라우저 미리보기 · 실제 저장과 연결은 설치된 앱에서 사용해요.</p>}
        {referenceNotice && <div className="ui-pet-prompt"><p role="status">{referenceNotice}</p>{referenceFallback && <label>참고 링크 주소<textarea readOnly rows={3} value={referenceFallback} onFocus={event => event.currentTarget.select()} /></label>}</div>}
        {(error || library.error) && <p className="error" role="alert">{error || library.error}</p>}{staleSaved && step !== 1 && <button className="button secondary" disabled={busy} onClick={() => goTo(1)}>저장한 펫 다시 선택</button>}{overlayError && <p className="ui-pet-optional" role="status">{overlayError}</p>}{notice && <p className="ui-pet-notice" role="status">{notice}</p>}
      </div>
      <footer className="ui-pet-wizard-footer"><div>{step > 1 && <button className="text-button" disabled={busy} onClick={() => goTo(step === 3 ? 2 : 1)}>← 이전</button>}<button className="text-button" disabled={busy} onClick={onConnection}>연결 도움</button></div><button className="button primary ui-pet-primary" disabled={step === 1 ? busy || staleSaved || !routingSupported : disabled || !routingSupported || (step === 3 && !prepared)} onClick={() => { if (step === 1) goTo(2); else if (step === 2) prepare(); else void saveAndCopy(); }}>{busy ? '준비하는 중…' : step === 1 ? '이 펫으로 시작' : step === 2 ? prepared ? '채팅에서 시작하기' : 'Codex에 펫 준비' : copied ? '시작 요청 다시 복사' : '시작 요청 복사'}<span aria-hidden="true">{copied && step === 3 ? '✓' : '→'}</span></button></footer>
    </div>
  </section>;
}
