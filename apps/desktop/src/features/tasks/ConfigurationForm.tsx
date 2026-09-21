import { useState } from 'react';
import type { Session, TaskConfiguration } from '@autopets/contracts/types';
import { DEFAULT_CONFIGURATION } from './constants';
import { shortPath } from '../../app/shared/format';

export function ConfigurationForm({ session, submitLabel, busy, onSave }: { session: Session; submitLabel: string; busy: boolean; onSave: (config: TaskConfiguration) => Promise<void> }) {
  const [config, setConfig] = useState<TaskConfiguration>({
    completionCriterion: session.completionCriterion ?? DEFAULT_CONFIGURATION.completionCriterion,
    interventionMode: session.interventionMode ?? DEFAULT_CONFIGURATION.interventionMode,
    elapsedAlertMinutes: session.elapsedAlertMinutes === undefined ? 10 : session.elapsedAlertMinutes,
  });
  return <form className="configuration-form" onSubmit={event => { event.preventDefault(); void onSave({ ...config, completionCriterion: config.completionCriterion.trim() }); }}>
    <div className="chosen-task"><span className="field-label">연결할 작업</span><strong>{session.label}</strong><p title={session.cwd}>{shortPath(session.cwd)} · {session.id}</p></div>
    <label className="field-label" htmlFor="completion-criterion">완료 기준 · 선택사항</label>
    <textarea id="completion-criterion" className="text-input" maxLength={2000} rows={2} placeholder="비워두면 기존 채팅의 요청을 기준으로 진행해요." value={config.completionCriterion} onChange={event => setConfig({ ...config, completionCriterion: event.target.value })} />
    <fieldset className="mode-fieldset"><legend>언제 알려드릴까요?</legend><label className={`mode-option ${config.interventionMode === 'when-needed' ? 'selected' : ''}`}><input type="radio" name="intervention-mode" value="when-needed" checked={config.interventionMode === 'when-needed'} onChange={() => setConfig({ ...config, interventionMode: 'when-needed' })} /><span><strong>확인이 필요할 때</strong><small>요청이나 시간 알림이 있을 때 확인해요.</small></span></label><label className={`mode-option ${config.interventionMode === 'milestones' ? 'selected' : ''}`}><input type="radio" name="intervention-mode" value="milestones" checked={config.interventionMode === 'milestones'} onChange={() => setConfig({ ...config, interventionMode: 'milestones' })} /><span><strong>계획 단계가 바뀔 때도</strong><small>실제로 전달된 단계의 변경도 알려드려요.</small></span></label></fieldset>
    <details className="time-settings"><summary>시간 알림 · {config.elapsedAlertMinutes === null ? '끔' : `${config.elapsedAlertMinutes}분`}</summary><label className="toggle-row"><input type="checkbox" checked={config.elapsedAlertMinutes !== null} onChange={event => setConfig({ ...config, elapsedAlertMinutes: event.target.checked ? 10 : null })} /><span>일정 시간이 지나면 알림 받기</span></label>{config.elapsedAlertMinutes !== null && <label className="minutes-input"><input type="number" aria-label="시간 알림 간격 (분)" min={1} max={1440} required value={config.elapsedAlertMinutes} onChange={event => setConfig({ ...config, elapsedAlertMinutes: event.target.value === '' ? 0 : Number(event.target.value) })} />분</label>}<p className="small-note">시간 알림은 작업을 일시정지하거나 종료하지 않아요.</p></details>
    <button className="button primary form-submit" disabled={busy}>{busy ? '저장 중…' : submitLabel}</button>
  </form>;
}
