import type { WorkflowModel } from '@autopets/contracts/types';
import { modelLabel } from './presentation';

const candidates = ['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra'];
const efforts: WorkflowModel['reasoning'][] = ['low', 'medium', 'high'];
export function WorkflowStageSettings({ label, value, disabled, onChange }: { label: string; value: WorkflowModel; disabled: boolean; onChange: (value: WorkflowModel) => void }) {
  return <div className="workflow-stage-setting"><h4>{label} 희망 설정</h4><label>{label} 모델<select className="text-input" aria-label={`${label} 모델`} value={value.model} disabled={disabled} onChange={event => onChange({ ...value, model: event.target.value })}>{[...new Set([...candidates, value.model])].map(model => <option key={model} value={model}>{modelLabel(model)}</option>)}</select></label><label>{label} 추론 수준<select className="text-input" aria-label={`${label} 추론 수준`} value={value.reasoning} disabled={disabled} onChange={event => onChange({ ...value, reasoning: event.target.value as WorkflowModel['reasoning'] })}>{[...new Set([...efforts, value.reasoning])].map(reasoning => <option key={reasoning} value={reasoning}>{reasoning}</option>)}</select></label></div>;
}
