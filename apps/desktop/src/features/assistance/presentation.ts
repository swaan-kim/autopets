import type { AssistanceTask } from '@autopets/contracts/types';

const stateLabels = {
  off: '자동 도움 꺼짐', pending: '다음 메시지 전달 대기', prepared: '전달할 지침 준비됨',
  sent: '지침 전송됨 · 적용 확인 대기', confirmed: '지침 적용 확인됨', unavailable: '자동 연결 확인 필요',
};
export function assistanceLabel(task: AssistanceTask, enabled = true) {
  return !enabled || !task.enabled ? stateLabels.off : stateLabels[task.assistance.status];
}
