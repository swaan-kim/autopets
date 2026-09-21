import { useEffect, useState } from 'react';
import type { AssistanceTask, UserPreferences, WorkflowTask } from '@autopets/contracts/types';
import { identityKey } from '../assistance/identity';

type WorkStyle = UserPreferences['workStyle'];
type Action = () => void | Promise<void>;
export interface PetQuickCardProps {
  title: string;
  help: string;
  goal?: string;
  constraints?: string[];
  currentStep?: string | null;
  task?: AssistanceTask;
  workflowTask?: WorkflowTask;
  defaultWorkStyle: WorkStyle;
  assistanceEnabled: boolean;
  busy?: boolean;
  disabled?: boolean;
  error?: string;
  notice?: string;
  returnLabel?: string;
  onReturn?: Action;
  onWorkStyle: (style: WorkStyle | null) => void | Promise<void>;
  onDetails: Action;
  onToggleAssistance?: Action;
  onHide: Action;
  onQuit: Action;
  onClose: () => void;
}

const styles: [WorkStyle, string][] = [['auto', '자동'], ['fast', '빠르게'], ['thorough', '꼼꼼하게']];
export function PetQuickCard({ title, help, goal, constraints = [], currentStep, task, workflowTask, defaultWorkStyle, assistanceEnabled, busy = false, disabled = false, error, notice, returnLabel = '작업으로 돌아가기', onReturn, onWorkStyle, onDetails, onToggleAssistance, onHide, onQuit, onClose }: PetQuickCardProps) {
  const [more, setMore] = useState(false);
  const taskKey = task ? identityKey(task.identity) : workflowTask ? identityKey(workflowTask.identity) : '';
  useEffect(() => { setMore(false); }, [taskKey]);
  const effectiveStyle = task?.workStyleOverride ?? defaultWorkStyle;
  return <section className="pet-quick-card" aria-label={`${title} 빠른 설정`}>
    <header className="quick-card-header"><h2 title={title}>{title}</h2><button className="icon-button" aria-label="펫 카드 메뉴" aria-expanded={more} onClick={() => setMore(!more)}>⋯</button><button className="icon-button" aria-label="카드 접기" onClick={onClose}>×</button></header>
    <p className="quick-help" title={help}>{help}</p>
    {task?.enabled && assistanceEnabled && task.assistance.status === 'unavailable' && <p className="quick-connection" role="status">자동 도움 연결을 확인해주세요.</p>}
    {more && <div className="quick-more-actions" aria-label="펫 카드 메뉴 항목">{(task || workflowTask) && onToggleAssistance && <button disabled={disabled || busy} onClick={() => void onToggleAssistance()}>{task?.enabled || workflowTask?.enabled ? '이번 채팅 도움 끄기' : '이번 채팅 도움 켜기'}</button>}<button disabled={disabled || busy} onClick={() => void onHide()}>이 펫 숨기기</button><button className="danger-text" disabled={disabled || busy} onClick={() => void onQuit()}>AutoPets 종료</button></div>}
    {(goal || constraints.length > 0) && <div className="quick-context">{goal && <p className="quick-goal" title={goal}><span>목표</span>{goal}</p>}{constraints.length > 0 && <ul aria-label="기억한 조건">{constraints.slice(0, 3).map((condition, index) => <li key={index} title={condition}>{condition}</li>)}</ul>}{constraints.length > 3 && <span className="quick-overflow">나머지 {constraints.length - 3}개는 상세 설정에서</span>}</div>}
    <p className="quick-step"><span>현재 단계</span><strong title={currentStep || undefined}>{currentStep || '전달된 단계 없음'}</strong></p>
    <div className={`quick-primary-actions ${onReturn ? 'has-return' : ''}`}>{onReturn && <button className="button primary quick-return" disabled={disabled || busy} onClick={() => void onReturn()}>{returnLabel} ↗</button>}<button className="button secondary quick-details" disabled={disabled || busy} onClick={() => void onDetails()}>상세 설정 열기 →</button></div>
    {task && <fieldset className="quick-style-field"><legend>이번 작업 방식</legend><div className="quick-style-choices" role="radiogroup" aria-label="이번 작업 방식">{styles.map(([value, label]) => <button key={value} role="radio" aria-checked={effectiveStyle === value} disabled={disabled || busy || !assistanceEnabled || !task.enabled} onClick={() => void onWorkStyle(value)}>{label}</button>)}</div><div className="quick-style-note"><span>다음 메시지부터 적용 요청</span>{task.workStyleOverride != null && <button className="text-button" disabled={disabled || busy} onClick={() => void onWorkStyle(null)}>기본 설정 사용</button>}</div></fieldset>}
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="quick-notice" role="status">{notice}</p>}
  </section>;
}
