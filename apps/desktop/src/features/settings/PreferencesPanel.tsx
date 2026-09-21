import type { AssistanceSnapshot, UserPreferences } from '@autopets/contracts/types';
import { WORK_STYLES as styles } from './workStyles';
import type { useWorkflow } from '../../bridge/useWorkflow';
import { WorkflowPreferences } from '../workflow/WorkflowPreferences';

export function PreferencesPanel({ snapshot, draft, dirty, disabled, hidden, onUpdate, onSave, onReset, workflow }: {
  snapshot: AssistanceSnapshot; draft: UserPreferences; dirty: boolean; disabled: boolean; hidden: boolean;
  onUpdate: (value: UserPreferences) => void; onSave: (value: UserPreferences) => Promise<void>; onReset: () => void;
  workflow: ReturnType<typeof useWorkflow>;
}) {
  return <section id="assistance-panel-defaults" role="tabpanel" aria-labelledby="assistance-tab-defaults" className="assistance-card" hidden={hidden}>
      <WorkflowPreferences workflow={workflow} />
      <div className="block-heading"><div><h2>나를 위한 기본 설정</h2><p className="small-note">선호만 공유하고, 업무 내용은 채팅별로 보관해요.</p></div><span className={`status-badge ${snapshot.preferences.enabled ? 'working' : 'empty'}`}>{snapshot.preferences.enabled ? '자동 도움 켜짐' : '자동 도움 꺼짐'}</span></div>
      {!snapshot.preferences.enabled && <button className="button primary" disabled={disabled} onClick={() => void onSave({ ...snapshot.preferences, enabled: true, workStyle: 'auto', answerLength: 'concise', outputFormat: 'adaptive', routingMode: 'auto', fixedModel: null, allowedModels: [], allowEscalation: false })}>추천 설정으로 켜기</button>}
      <form onSubmit={event => { event.preventDefault(); void onSave(draft); }}>
        <label className="assistance-toggle"><span><strong>자동 도움</strong><small>검증된 연결에서 다음 메시지부터</small></span><input type="checkbox" aria-label="자동 도움" checked={draft.enabled} disabled={disabled} onChange={event => onUpdate({ ...draft, enabled: event.target.checked })} /></label>
        <fieldset className="mode-fieldset"><legend>작업 방식</legend><div className="preference-choices">{styles.map(([value, title, subtitle]) => <label key={value} className={`mode-option ${draft.workStyle === value ? 'selected' : ''}`}><input type="radio" name="work-style" value={value} checked={draft.workStyle === value} disabled={disabled} onChange={() => onUpdate({ ...draft, workStyle: value })} /><span><strong>{title}</strong><small>{subtitle}</small></span></label>)}</div></fieldset>
        <label className="field-label" htmlFor="routing-mode">모델 선택</label><select id="routing-mode" className="text-input" value={draft.routingMode} disabled={disabled} onChange={event => onUpdate({ ...draft, routingMode: event.target.value as UserPreferences['routingMode'] })}><option value="auto">허용 범위에서 자동</option><option value="fixed">내가 선택한 모델 유지</option></select>
        <p className="small-note">모델 변경은 연결 검증 전까지 추천만 제공해요.</p>
        <details className="assistance-details"><summary>상세 설정</summary>
          <div className="preference-output-grid"><label>답변 길이<select aria-label="답변 길이" className="text-input" value={draft.answerLength ?? 'concise'} disabled={disabled} onChange={event => onUpdate({ ...draft, answerLength: event.target.value as UserPreferences['answerLength'] })}><option value="concise">간결하게</option><option value="normal">보통</option><option value="detailed">자세하게</option></select></label><label>결과 형식 선호<select aria-label="결과 형식 선호" className="text-input" value={draft.outputFormat ?? 'adaptive'} disabled={disabled} onChange={event => onUpdate({ ...draft, outputFormat: event.target.value as UserPreferences['outputFormat'] })}><option value="adaptive">요청에 맞게</option><option value="table">표</option><option value="list">목록</option><option value="document">문서</option></select></label></div>
          <p className="small-note">현재 요청에서 지정한 길이와 형식을 먼저 따라요.</p>
          <label>고정할 모델 ID<input className="text-input" placeholder="직접 선택한 모델 ID" value={draft.fixedModel || ''} disabled={disabled} onChange={event => onUpdate({ ...draft, fixedModel: event.target.value || null })} /></label><label>허용할 모델 ID<textarea aria-label="허용할 모델 ID" className="text-input" rows={2} placeholder="한 줄에 하나 · 비워두면 검증된 기본 범위" value={draft.allowedModels.join('\n')} disabled={disabled} onChange={event => onUpdate({ ...draft, allowedModels: event.target.value.split('\n') })} /></label>
          <label className="assistance-toggle"><span><strong>더 높은 사용 수준 허용</strong><small>검증된 연결과 평가된 모델에만 적용</small></span><input type="checkbox" checked={draft.allowEscalation} disabled={disabled} onChange={event => onUpdate({ ...draft, allowEscalation: event.target.checked })} /></label><p className="small-note">확인되지 않은 모델로 자동 전환하지 않아요.</p>
        </details>
        {dirty && draft.revision !== snapshot.preferences.revision && <p className="error" role="alert">다른 창에서 설정이 바뀌었어요. 최신 설정을 불러온 뒤 수정해주세요.</p>}
        <div className="action-row"><span className="small-note">저장과 실제 전달은 별도예요.</span>{dirty && draft.revision !== snapshot.preferences.revision && <button className="button secondary" type="button" disabled={disabled} onClick={() => { onReset(); }}>최신 설정 불러오기</button>}<button className="button primary" disabled={disabled || !dirty || draft.revision !== snapshot.preferences.revision || (draft.routingMode === 'fixed' && !draft.fixedModel?.trim())}>설정 저장</button></div>
      </form>
    </section>;
}
