import { useEffect, useRef, useState } from 'react';
import type { WorkflowPreferences as Preferences } from '@autopets/contracts/types';
import { command, isDesktop } from '../../bridge/command';
import type { useWorkflow } from '../../bridge/useWorkflow';
import { WORKFLOW_PRESETS, modelLabel } from './presentation';
import { WorkflowStageSettings } from './WorkflowStageSettings';
import { ManualWorkflowGuide } from './ManualWorkflowGuide';
import './workflow.css';

export function WorkflowPreferences({ workflow }: { workflow: ReturnType<typeof useWorkflow> }) {
  const preferences = workflow.snapshot.preferences;
  const [draft, setDraft] = useState<Preferences>(preferences);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const working = useRef(false);
  useEffect(() => { if (!dirty) setDraft(preferences); }, [preferences, dirty]);
  const disabled = !isDesktop || !workflow.loaded || !!workflow.error || busy;
  const stale = dirty && draft.revision !== preferences.revision;
  const update = (next: Preferences) => { setDraft(next); setDirty(true); setNotice(''); };
  const save = async () => {
    if (disabled || stale || working.current) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try { await command('save_workflow_preferences', { preferences: draft }); await workflow.refresh(); setDirty(false); setNotice('저장했어요. 새로 연결되는 작업부터 사용해요.'); }
    catch { setError('저장하지 못했어요. 최신 설정을 확인하고 다시 시도해 주세요.'); }
    finally { setBusy(false); working.current = false; }
  };
  return <section className="workflow-preferences" aria-label="계획과 실행 설정">
    <div className="workflow-intro"><div><h2>계획부터 실행까지</h2><p className="small-note">일에 맞는 조합을 한 번 골라 두세요.</p></div><span className="workflow-badge">{preferences.enabled ? '새 작업 기본값' : '사용 안 함'}</span></div>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="assistance-toggle"><span><strong>계획·실행 도움 켜기</strong><small>새로 시작하는 작업에만 써요. 진행 중인 작업은 그대로예요.</small></span><input type="checkbox" aria-label="계획·실행 도움 켜기" checked={draft.enabled} disabled={disabled} onChange={event => update({ ...draft, enabled: event.target.checked })} /></label>
      {!draft.enabled && <p className="small-note">스위치가 꺼져 있어 지금은 쓰지 않아요. 켜면 아래에서 고른 조합을 새 작업에 써요.</p>}
      <fieldset className="workflow-presets"><legend>계획과 실행 조합</legend>{WORKFLOW_PRESETS.map(item => <button key={item.id} className="workflow-preset" type="button" role="radio" aria-checked={draft.preset === item.id} aria-label={item.title} disabled={disabled} onClick={() => update({ ...draft, preset: item.id, planning: item.planning, execution: item.execution })}>
        <strong>{item.title}</strong><small>{item.description}</small><span className="workflow-combo">{modelLabel(item.planning.model)} · {item.planning.reasoning}<br />→ {modelLabel(item.execution.model)} · {item.execution.reasoning}</span>{item.id === 'balanced' && <span className="workflow-recommended">추천</span>}
      </button>)}</fieldset>
      <p className="small-note">아직 시험 중인 조합이에요. 사용량이 줄거나 모델이 실제로 바뀐다고 약속하지 않아요.</p>
      <details className="assistance-details workflow-preset-details"><summary>단계별 모델·추론 설정</summary>
        <div className="workflow-detail-grid">{([['planning', '계획'], ['execution', '실행']] as const).map(([key, label]) => <WorkflowStageSettings key={key} label={label} value={draft[key]} disabled={disabled} onChange={value => update({ ...draft, [key]: value })} />)}</div>
        <p className="small-note">원하는 설정을 적어 두는 곳이에요. 쓸 수 있는 모델인지는 확인 못 했고, 저장해도 실제 설정은 바뀌지 않아요.</p>
        <label className="assistance-toggle"><span><strong>실행 전에 계획 확인</strong><small>계획을 먼저 보여 달라고 요청해요. Codex의 Plan 모드를 켜는 것과는 달라요.</small></span><input type="checkbox" checked={draft.planFirst} disabled={disabled} aria-label="실행 전에 계획 확인" onChange={event => update({ ...draft, planFirst: event.target.checked })} /></label>
      </details>
      {(workflow.error || error) && <p className="error" role="alert">{workflow.error || error}</p>}
      {stale && <p className="error" role="alert">다른 창에서 기본값이 바뀌었어요. 최신 설정을 불러와 주세요.</p>}
      {notice && <p className="assistance-notice" role="status">{notice}</p>}
      <div className="action-row"><span className="small-note">기존 작업은 자동으로 바뀌지 않아요.</span>{stale && <button className="button secondary" type="button" disabled={disabled} onClick={() => { setDraft(preferences); setDirty(false); }}>최신 계획 설정 불러오기</button>}<button className="button primary" disabled={disabled || !dirty || stale}>새 작업 기본값 저장</button></div>
    </form>
    <ManualWorkflowGuide initial />
  </section>;
}
