import { useRef, useState } from 'react';
import type { PetRoleTemplate, SavedPet, WorkflowModel, WorkflowSnapshot } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';
import { useRoles } from '../../bridge/useRoles';
import { identityKey } from '../assistance/identity';
import { Pet } from '../pets/Pet';
import { PetAppearance } from '../pets/PetAppearance';
import { rolePrompt } from '../../../../../packages/guidance/roles.mjs';
import './roles.css';

function RoleModel({ label, value, models, disabled, onChange }: { label: string; value: WorkflowModel | null; models: { model: string; reasoning: WorkflowModel['reasoning'][] }[]; disabled: boolean; onChange: (value: WorkflowModel | null) => void }) {
  const current = models.find(model => model.model === value?.model);
  return <fieldset className="role-model" disabled={disabled}><legend>{label} 희망 설정</legend>
    <label>모델<select aria-label={`${label} 역할 모델`} className="text-input" value={value?.model ?? ''} onChange={event => { const found = models.find(model => model.model === event.target.value); onChange(found ? { model: found.model, reasoning: found.reasoning[0] } : null); }}>
      <option value="">대상 작업 설정 유지</option>{models.filter(model => model.reasoning.length).map(model => <option key={model.model} value={model.model}>{model.model}</option>)}
      {value && !current && <option value={value.model} disabled>{value.model} · 가용성 미확인</option>}
    </select></label>
    {value && <label>추론 수준<select aria-label={`${label} 역할 추론`} className="text-input" value={value.reasoning} disabled={!current} onChange={event => onChange({ ...value, reasoning: event.target.value as WorkflowModel['reasoning'] })}>
      {current?.reasoning.map(effort => <option key={effort}>{effort}</option>)}
      {!current?.reasoning.includes(value.reasoning) && <option value={value.reasoning} disabled>{value.reasoning} · 가용성 미확인</option>}
    </select></label>}
  </fieldset>;
}

export function RoleStudio({ workflow, sessions, refreshWorkflow }: { workflow: WorkflowSnapshot; sessions: { id: string; label: string }[]; refreshWorkflow: () => Promise<void> }) {
  const library = useRoles();
  const [draft, setDraft] = useState<PetRoleTemplate>(() => structuredClone(library.snapshot.templates[0]));
  const [saved, setSaved] = useState<SavedPet | null>(null);
  const [dirty, setDirty] = useState(true);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const task = workflow.tasks.find(task => identityKey(task.identity) === target);
  const binding = library.snapshot.bindings.find(binding => identityKey(binding.identity) === target);
  const models = task ? workflow.capabilities[task.identity.provider]?.availableModels ?? [] : [];
  const disabled = busy || !library.loaded || !!library.error;
  let prompt = '', validation = '';
  try { prompt = rolePrompt(draft); } catch { validation = '이름·지침 길이와 역할 설정을 확인해주세요. 지침은 UTF-8 1.5KB 이내로 저장해요.'; }
  const edit = (change: Partial<PetRoleTemplate>) => { setDraft({ ...draft, ...change }); setDirty(true); setNotice(''); };
  const run = async (operation: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); await library.refresh(); }
    catch (cause) { setError(String(cause)); await library.refresh(); await refreshWorkflow(); }
    finally { working.current = false; setBusy(false); }
  };
  const save = (copy: boolean) => run(async () => {
    const pet = await command<SavedPet>('save_pet', { id: copy ? null : saved?.id ?? null, expectedRevision: copy ? 0 : saved?.revision ?? 0, template: draft });
    setSaved(pet); setDraft(pet.template); setDirty(false); setNotice('내 펫을 저장했어요. 기존 작업의 역할은 직접 다시 선택할 때 바뀌어요.');
  });
  const apply = (enabled: boolean) => run(async () => {
    if (!task || !saved) throw new Error('작업과 저장한 펫을 선택해주세요.');
    await command('apply_pet', { identity: task.identity, petId: saved.id, petRevision: saved.revision, expectedRevision: binding?.revision ?? 0, expectedSettingsRevision: task.settingsRevision, enabled });
    await refreshWorkflow(); setNotice(enabled ? '이 작업에 역할 선호를 저장했어요. 지침 전달·모델 적용은 미확인이고 계획 확인은 다시 필요해요.' : '이 작업의 역할 도움을 껐어요. 채팅과 모델 설정은 그대로 유지돼요.');
  });
  return <section className="role-studio" aria-label="역할과 내 펫">
    <div className="page-heading"><span className="eyebrow">YOUR PET, YOUR WAY</span><h1>필요한 역할을 고르고,<br />내 펫으로 저장해요.</h1><p>작업마다 다시 쓸 수 있는 짧은 지침과 희망 설정이에요.</p></div>
    {!isDesktop && <p className="assistance-notice">브라우저 미리보기 · 실제 저장과 작업 연결은 데스크톱 앱에서 사용할 수 있어요.</p>}
    <div className="role-templates" aria-label="기본 역할">{library.snapshot.templates.map(template => <button className="button secondary" key={template.id} disabled={busy} onClick={() => { setDraft(structuredClone(template)); setSaved(null); setDirty(true); setNotice(''); }}>{template.name}</button>)}</div>
    {library.snapshot.pets.length > 0 && <label>저장한 내 펫<select className="text-input" aria-label="저장한 내 펫" disabled={disabled} value={saved?.id ?? ''} onChange={event => { const pet = library.snapshot.pets.find(pet => pet.id === event.target.value); if (pet) { setSaved(pet); setDraft(structuredClone(pet.template)); setDirty(false); setNotice(''); } }}><option value="">새 펫 만들기</option>{library.snapshot.pets.map(pet => <option value={pet.id} key={pet.id}>{pet.template.name} · 수정 {pet.revision}</option>)}</select></label>}
    <div className="role-editor"><div className="role-preview"><PetAppearance template={draft}><Pet activity={draft.id === 'research-document' ? 'research' : 'tool'} /></PetAppearance><strong>{draft.name}</strong></div>
      <div className="role-fields"><label>펫 이름<input className="text-input" aria-label="펫 이름" value={draft.name} disabled={busy} onChange={event => edit({ name: event.target.value })} /></label>
        <label>역할 지침<textarea className="text-input" aria-label="역할 지침" rows={5} disabled={busy} value={draft.instruction} onChange={event => edit({ instruction: event.target.value })} /></label>
        <label><input type="checkbox" checked={draft.planFirst} disabled={busy} onChange={event => edit({ planFirst: event.target.checked })} /> 복잡한 작업은 계획 먼저 확인</label>
        <div className="role-templates"><label>소품<select className="text-input" aria-label="역할 소품" value={draft.prop} disabled={busy} onChange={event => edit({ prop: event.target.value as PetRoleTemplate['prop'] })}><option value="none">없음</option><option value="notebook">노트</option></select></label><label>배경<select className="text-input" aria-label="역할 배경" value={draft.background} disabled={busy} onChange={event => edit({ background: event.target.value as PetRoleTemplate['background'] })}><option value="none">없음</option><option value="meadow">풀밭</option></select></label></div>
      </div></div>
    <label>역할을 선택할 작업<select className="text-input" aria-label="역할을 선택할 작업" value={target} disabled={disabled || !isDesktop} onChange={event => { setTarget(event.target.value); setNotice(''); }}><option value="">연결에서 확인한 작업 선택</option>{workflow.tasks.map(task => <option key={identityKey(task.identity)} value={identityKey(task.identity)}>{sessions.find(session => session.id === task.identity.chatId)?.label ?? task.identity.chatId} · {task.identity.provider} · {task.identity.accountId} · {task.identity.chatId}</option>)}</select></label>
    <div className="role-models">{(['planning', 'execution'] as const).map((stage, index) => <RoleModel key={stage} label={index ? '실행' : '계획'} value={draft[stage]} models={models} disabled={disabled} onChange={value => edit({ [stage]: value })} />)}</div>
    {!models.length && <p className="small-note">이 작업의 가용 모델 목록을 아직 확인하지 못했어요. 기본값은 대상 작업 설정 유지예요.</p>}
    <p className="small-note">스킬 참조 · {draft.skills.map(skill => `${skill.id}@${skill.version}`).join(', ')} · 실행 미확인</p>
    <div className="role-actions"><button className="button primary" disabled={!isDesktop || disabled || !!validation || !dirty} onClick={() => void save(false)}>{saved ? '내 펫 변경 저장' : '내 펫 저장'}</button>{saved && <button className="button secondary" disabled={!isDesktop || disabled || !!validation} onClick={() => void save(true)}>새 펫으로 복사</button>}<button className="button secondary" disabled={!isDesktop || disabled || dirty || !saved || !task} onClick={() => void apply(true)}>이 작업에 역할 선택</button>{binding?.enabled && saved?.id === binding.petId && <button className="text-button" disabled={disabled || dirty} onClick={() => void apply(false)}>이 작업의 역할 도움 끄기</button>}</div>
    {binding && <p className="assistance-notice" data-testid="role-binding">선택한 역할: {binding.template.name} · 수정 {binding.petRevision} · {binding.enabled ? '선호 저장됨 / 실제 전달 미확인' : '역할 도움 꺼짐'}</p>}
    <details><summary>채팅에 직접 전달할 지침</summary><p className="small-note">자동 전송되지 않아요. 원하는 채팅에서 내용을 확인하고 직접 보내세요.</p><pre className="role-prompt">{prompt}</pre><button className="button secondary" disabled={!prompt || busy} onClick={() => void run(async () => { await navigator.clipboard.writeText(prompt); setNotice('역할 지침을 복사했어요. AI에 전달된 상태는 아니에요.'); })}>역할 지침 복사</button></details>
    {(validation || library.error || error) && <p className="error" role="alert">{validation || library.error || error}</p>}{notice && <p role="status" className="assistance-notice">{notice}</p>}
  </section>;
}
