import type { PetState, TaskConfiguration } from '@autopets/contracts/types';

export const STATE_LABEL: Record<PetState, string> = {
  idle: '다음 활동 대기', working: '작업 진행 중', waiting: 'Codex 확인 필요',
  done: '응답 도착', failed: '작업 오류',
};
export const DEFAULT_CONFIGURATION: TaskConfiguration = {
  completionCriterion: '', interventionMode: 'when-needed', elapsedAlertMinutes: 10,
};
