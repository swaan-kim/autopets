import type { AssistanceTask } from '@autopets/contracts/types';

const stateLabels = {
  off: '자동 도움 꺼짐', pending: '다음 메시지에 전달 예정', prepared: '전달할 지침 준비됨',
  sent: '지침 보냄 · 적용은 아직', confirmed: '지침 적용됨', unavailable: '연결 확인 못 함',
};
export function assistanceLabel(task: AssistanceTask, enabled = true) {
  return !enabled || !task.enabled ? stateLabels.off : stateLabels[task.assistance.status];
}
