import { useEffect, useRef, useState } from 'react';
import type { PetLink, PetRoleTemplate, SavedPet, SetupState, WorkflowModel } from '@autopets/contracts/types';
import template from '../../../../../packages/contracts/data/ui-pet.json';
import { command, isDesktop } from '../../bridge/command';
import { useRoles } from '../../bridge/useRoles';
import { Pet } from './Pet';
import { unresolvedPetRun } from './ExplicitPet';
import './ui-pet-studio.css';

export const FIGMA_GUIDE = 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/#codex';
const SKILL_SOURCE = 'https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md';
const settingLabel = (value: WorkflowModel | null) => value ? `${({ 'gpt-6-luna': 'Luna', 'gpt-6-sol': 'Sol', 'gpt-6-astra': 'Astra' } as Record<string, string>)[value.model] ?? value.model} · ${value.reasoning}` : 'Luna · low (기본)';
const supportedRouting = (draft: PetRoleTemplate) => (!draft.planning || (draft.planning.model === 'gpt-6-luna' && draft.planning.reasoning === 'low')) && (!draft.execution || (draft.execution.model === 'gpt-6-luna' && draft.execution.reasoning === 'low') || (draft.execution.model === 'gpt-6-sol' && ['low', 'medium'].includes(draft.execution.reasoning)));
const targetKey = (link: PetLink) => JSON.stringify([link.target.sourceId, link.target.threadId, link.target.cwd]);
const explicitSetupReady = (setup?: SetupState | null) => setup?.connectionMode === 'explicit-pet' && setup.connections?.some(connection => connection.hostId === 'codex-windows-local' && connection.configured) === true;
export const uiPetStartPrompt = (pet: SavedPet) => [
  `AutoPets 스킬로 현재 채팅에 UI 제작 펫을 연결해줘. 저장한 펫: petId=${pet.id}, petRevision=${pet.revision}.`,
  '이 펫으로 가상 학과 행사 소개 웹페이지 한 장의 계획만 세워줘. 행사 소개, 일정, 신청 안내와 모바일 화면을 포함해줘.',
  pet.template.features?.figmaDesign ? 'Figma 시안 활용 특성을 선택했어. 사용할 프레임 링크를 나에게 먼저 확인하고, 실제 시안을 읽은 뒤 계획해줘. 연결이나 접근이 안 되면 필요한 조치를 알려줘.' : '외부 서비스 없이 브라우저에서 열 수 있는 작은 페이지로 만들고, 실제 개인정보 대신 가상 내용을 사용해줘.',
  '지금은 파일을 바꾸지 말고 계획을 보여준 뒤 내 구현 요청을 기다려줘. 구현할 때는 새 autopets-demo 폴더를 사용하되 기존 파일이 있으면 먼저 알려줘.',
].join('\n');

export function UiPetStudio({ links, setup, onConnection }: { links: PetLink[]; setup?: SetupState | null; onConnection: () => void }) {
  const library = useRoles();
  const [draft, setDraft] = useState<PetRoleTemplate>(() => structuredClone(template) as PetRoleTemplate);
  const [saved, setSaved] = useState<SavedPet | null>(null);
  const [dirty, setDirty] = useState(true);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [localSetup, setLocalSetup] = useState<SetupState | null>(null);
  const [prompt, setPrompt] = useState('');
  const [notice, setNotice] = useState('');
  const [referenceNotice, setReferenceNotice] = useState('');
  const [referenceFallback, setReferenceFallback] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const setupKey = JSON.stringify(setup?.connections);
  useEffect(() => { setLocalSetup(null); }, [setupKey]);
  const currentSetup = localSetup ?? setup;
  const prepared = explicitSetupReady(currentSetup);
  const target = links.find(link => targetKey(link) === selectedTarget);
  const uiPets = library.snapshot.pets.filter(pet => pet.template.skills.some(skill => skill.id === 'frontend-design'));
  const disabled = busy || !isDesktop || !library.loaded || Boolean(library.error);
  const figma = draft.features?.figmaDesign === true;
  const routingSupported = supportedRouting(draft);
  const run = async (operation: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); }
    catch (cause) {
      const value = String(cause);
      setError(/revision|stale|conflict/.test(value) ? '다른 곳에서 설정이 바뀌었어요. 저장한 구성을 다시 선택하고 확인해 주세요.' : '처리하지 못했어요. 연결 설정을 확인하고 다시 시도해 주세요.');
      await library.refresh();
    } finally { working.current = false; setBusy(false); }
  };
  const save = async () => {
    if (saved && !dirty) return saved;
    const result = await command<SavedPet>('save_pet', { id: saved?.id ?? null, expectedRevision: saved?.revision ?? 0, template: draft });
    setSaved(result); setDraft(structuredClone(result.template)); setDirty(false); await library.refresh();
    return result;
  };
  const copy = async (value: string) => {
    setPrompt(value);
    try { await navigator.clipboard.writeText(value); setNotice('시작 요청을 복사했어요. 사용할 Codex 채팅에 붙여넣고 보내주세요. 아직 전송되지 않았어요.'); }
    catch { setNotice('자동 복사가 되지 않았어요. 아래 요청을 직접 선택해 복사한 뒤 Codex에서 보내주세요.'); }
  };
  const copyReference = async (url: string) => {
    setReferenceFallback('');
    try { await navigator.clipboard.writeText(url); setReferenceNotice('주소를 복사했어요. 브라우저 주소창에서 열 수 있어요.'); }
    catch { setReferenceNotice('아래 주소를 직접 선택해 복사해 주세요.'); setReferenceFallback(url); }
  };
  const prepare = () => run(async () => {
    const result = await command<SetupState>('connect_ai', { hostId: 'codex-windows-local' });
    setLocalSetup(result); setNotice([explicitSetupReady(result) ? 'Codex에서 펫을 부르는 스킬을 준비했어요. 이제 시작 요청을 복사해 주세요.' : '연결 준비가 확인되지 않았어요. 연결 설정에서 필요한 조치를 확인해 주세요.', ...(result.warnings ?? [])].join(' '));
  });
  const saveAndCopy = () => run(async () => { await copy(uiPetStartPrompt(await save())); });
  const apply = () => run(async () => {
    if (!target || !target.connected || unresolvedPetRun(target)) throw Error('target unavailable');
    const result = await save();
    await command('apply_pet_link_template', { target: target.target, expectedRevision: target.revision, petId: result.id, petRevision: result.revision });
    setNotice('선택한 채팅의 다음 펫 작업에 저장했어요. 새 계획부터 요청해 주세요. 현재 채팅의 모델은 그대로예요.');
  });
  return <section className="ui-pet-studio" aria-label="UI 제작 펫 시작하기">
    <div className="page-heading"><span className="eyebrow">작은 시작, 눈에 보이는 결과</span><h1>내 일에 맞게,<br />펫 하나로.</h1><p>화면을 만들고 싶을 때, 계획부터 결과 확인까지 함께해요.</p></div>
    <ol className="pet-journey" aria-label="펫과 일하는 순서">
      {['펫 선택', '준비', '계획', '제작', '완료'].map((label, index) => <li key={label}><span>{index + 1}</span>{label}</li>)}
    </ol>
    {!isDesktop && <p className="assistance-notice">브라우저 미리보기 · 실제 저장과 Codex 연결은 설치된 앱에서 사용해요.</p>}
    <details className="ui-pet-config" open={!links.length}>
      <summary>{links.length ? 'UI 제작 펫 부르기 · 구성하기' : 'UI 제작 펫으로 시작하기'}</summary>
      <div className="ui-pet-start-bar"><div><strong>{prepared ? '준비한 펫을 Codex에서 불러요' : '기존 Codex 채팅에서 함께 일해요'}</strong><small>{prepared ? '시작 요청을 복사해 사용할 채팅에 직접 보내세요.' : '한 번 준비하면 채팅에서 펫을 부를 수 있어요.'}</small></div><button className="button primary ui-pet-primary" disabled={disabled || (prepared && !routingSupported)} onClick={() => void (prepared ? saveAndCopy() : prepare())}>{busy ? '준비하는 중…' : prepared ? '저장하고 시작 요청 복사' : 'Codex 연결 준비'}</button></div>
      {!routingSupported && <p className="error" role="alert">이 구성의 모델 조합은 아직 연결할 수 없어요. 계획은 Luna/low, 제작은 Luna/low·Sol/low·Sol/medium을 지원해요. 새 구성을 선택하거나 고급 역할 설정에서 수정해 주세요.</p>}
      <div className="ui-pet-layout">
        <div className="ui-pet-introduction"><div className="ui-pet-visual"><Pet activity="idle" /><span className="ui-pet-tag">화면 구성 · 웹페이지 제작</span></div>
          <h2>UI 제작 펫</h2><p className="ui-pet-lead">만들고 싶은 화면을<br />함께 구체화해요.</p>
          <dl className="ui-pet-facts"><div><dt>잘하는 일</dt><dd>화면 구성, 색상·글자·배치의 방향 잡기</dd></div><div><dt>함께 확인해요</dt><dd>결과는 요청과 모델에 따라 달라져요. 기능과 접근성은 검수가 필요해요.</dd></div></dl>
          <a className="ui-pet-source" href={SKILL_SOURCE} target="_blank" rel="noreferrer">Anthropic 공개 스킬 · frontend-design ↗</a><button className="text-button ui-pet-reference-copy" onClick={() => void copyReference(SKILL_SOURCE)}>스킬 원본 주소 복사</button><small>스킬은 AI가 일할 때 참고하는 방법이에요. 출처가 품질 보증을 뜻하지는 않아요.</small>
        </div>
        <div className="ui-pet-options">
          <div className="ui-pet-section"><span className="ui-pet-kicker">01 · 기본 능력</span><h3>계획을 보고, 만들기는 그다음에</h3><p>Codex 채팅에서 계획을 확인한 뒤 “그대로 구현해줘”라고 요청하세요.</p><div className="ui-pet-route"><span>계획 <strong>{settingLabel(draft.planning)}</strong></span><span aria-hidden="true">→</span><span>제작 <strong>{settingLabel(draft.execution)}</strong></span></div><small>기본 구성은 가볍게 시작해요. 실행 전 가용성을 확인하며, 다른 모델로 임의 변경하지 않아요.</small></div>
          <div className="ui-pet-section"><span className="ui-pet-kicker">02 · 선택 특성</span><label className="ui-pet-feature"><span><strong>Figma 시안 활용</strong><small>시안을 읽고 배치와 스타일을 제작에 반영해요.</small></span><input type="checkbox" aria-label="Figma 시안 활용" checked={figma} disabled={busy} onChange={event => { setDraft({ ...draft, features: { figmaDesign: event.target.checked } }); setDirty(true); setPrompt(''); setNotice(''); }} /></label>
            {figma ? <div className="ui-pet-figma"><p><strong>전용 지침 + Figma 도구(MCP)</strong></p><p>MCP는 AI가 Figma 같은 서비스의 도구를 사용하는 연결이에요. 연결 후 사용할 프레임 링크를 Codex 채팅에 알려주세요.</p><a href={FIGMA_GUIDE} target="_blank" rel="noreferrer">공식 Figma 플러그인 연결 안내 ↗</a><button className="text-button ui-pet-reference-copy" onClick={() => void copyReference(FIGMA_GUIDE)}>Figma 안내 주소 복사</button><small>설치·로그인은 Codex와 Figma에서 진행해요. 이 선택만으로 연결이나 시안 읽기가 확인되지는 않아요. 이번 특성은 시안 읽기와 웹페이지 반영을 도와요.</small></div> : <p className="ui-pet-optional">Figma 없이도 설명만으로 웹페이지를 만들 수 있어요.</p>}</div>
          <div className="ui-pet-section"><span className="ui-pet-kicker">03 · Codex에서 시작</span><h3>{prepared ? '시작 요청을 채팅에 보내세요' : '사용 중인 Codex에 펫을 준비해요'}</h3><p>첫 체험은 가상 학과 행사 소개 페이지예요. 요청을 복사한 뒤 원하는 내용으로 바꿔도 돼요.</p>
            {uiPets.length > 0 && <label className="ui-pet-select">저장한 구성<select aria-label="저장한 구성" value={saved?.id ?? ''} disabled={busy} onChange={event => { const item = uiPets.find(pet => pet.id === event.target.value); setSaved(item ?? null); setDraft(structuredClone(item?.template ?? template) as PetRoleTemplate); setDirty(!item); setPrompt(''); setNotice(''); }}><option value="">새 구성</option>{uiPets.map(pet => <option key={pet.id} value={pet.id}>{pet.template.name} · {pet.template.features?.figmaDesign ? 'Figma 활용' : '기본 제작'} · 수정 {pet.revision}</option>)}</select></label>}
            <small>{prepared ? '복사는 전송이 아니에요. 연결 확인은 실제 채팅 응답 뒤에 표시해요.' : '펫 호출 스킬을 준비해요. 아직 채팅에 연결하거나 작업을 시작하지 않아요.'}</small>
            <button className="text-button" onClick={onConnection}>연결 설정·도움 보기 →</button>
          </div>
        </div>
      </div>
      {links.length > 0 && <details className="ui-pet-existing"><summary>이미 연결한 채팅에 이 구성 적용</summary><p>선택한 채팅의 다음 펫 작업을 바꿔요. 이전 계획은 다시 확인해야 해요.</p><label className="ui-pet-select">대상 채팅<select aria-label="UI 펫을 적용할 채팅" value={selectedTarget} disabled={disabled} onChange={event => { setSelectedTarget(event.target.value); setNotice(''); }}><option value="">정확한 채팅을 선택하세요</option>{links.map(link => <option key={targetKey(link)} value={targetKey(link)}>{link.target.cwd.split(/[\\/]/).pop()} · {link.target.threadId.slice(0, 8)}{!link.connected ? ' · 연결 재확인 필요' : ''}</option>)}</select></label>{target && <p className="ui-pet-target">{target.target.cwd}<br />채팅 {target.target.threadId}</p>}<button className="button secondary" disabled={disabled || !routingSupported || !target?.connected || unresolvedPetRun(target)} onClick={() => void apply()}>저장하고 선택 채팅에 적용</button></details>}
      {prompt && <div className="ui-pet-prompt"><label>Codex에 보낼 시작 요청<textarea aria-label="Codex에 보낼 시작 요청" readOnly rows={7} value={prompt} onFocus={event => event.currentTarget.select()} /></label><small>스킬이 호출되지 않으면 Codex에서 AutoPets 스킬을 직접 선택하고 보내세요.</small></div>}
      {referenceNotice && <div className="ui-pet-prompt"><p role="status">{referenceNotice}</p>{referenceFallback && <label>참고 링크 주소<textarea readOnly rows={3} value={referenceFallback} onFocus={event => event.currentTarget.select()} /></label>}</div>}
      {(error || library.error) && <p className="error" role="alert">{error || library.error}</p>}{notice && <p className="assistance-notice" role="status">{notice}</p>}
    </details>
  </section>;
}
