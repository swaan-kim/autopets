import type { PetState, TaskConfiguration } from '@autopets/contracts/types';

export const STATE_LABEL: Record<PetState, string> = {
  idle: '다음 활동 대기', working: '작업 중', waiting: 'Codex에서 답을 기다려요',
  done: 'Codex 답변 끝남', failed: '문제가 생겼어요',
};
export const DEFAULT_CONFIGURATION: TaskConfiguration = {
  completionCriterion: '', interventionMode: 'when-needed', elapsedAlertMinutes: 10,
};
