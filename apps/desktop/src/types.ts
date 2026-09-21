export type PetState = 'idle' | 'working' | 'waiting' | 'done' | 'failed';
export type Activity = 'idle' | 'research' | 'writing' | 'tool' | 'working';
export type InterventionMode = 'when-needed' | 'milestones';
export interface PlanStep { step: string; status: 'pending' | 'in_progress' | 'completed' }
export interface Attention {
  id: string;
  kind: 'elapsed' | 'milestone' | 'permission' | 'tool-error';
  summary: string;
  createdAt: number;
  snoozedUntil: number | null;
}
export interface Session {
  id: string;
  label: string;
  cwd: string;
  state: PetState;
  unread: boolean;
  lastSeen: number;
  lastTool: string | null;
  connection: 'observed' | 'unknown' | 'ended';
  completionCriterion: string;
  interventionMode: InterventionMode;
  activity: Activity;
  planSteps: PlanStep[];
  planUpdatedAt: number | null;
  turnStartedAt: number | null;
  turnEndedAt: number | null;
  elapsedAlertMinutes: number | null;
  attention: Attention | null;
  canOpenTask?: boolean;
}
export interface Slot { index: number; sessionId: string | null }
export interface Snapshot {
  sessions: Session[];
  slots: Slot[];
  connectionPath: string;
  now: number;
  capabilities: { tokenUsage: 'unavailable'; taskReturn: 'manual' };
}
export interface TaskConfiguration {
  completionCriterion: string;
  interventionMode: InterventionMode;
  elapsedAlertMinutes: number | null;
}
export const STATE_LABEL: Record<PetState, string> = {
  idle: '다음 활동 대기', working: '작업 진행 중', waiting: 'Codex 확인 필요',
  done: '응답 도착', failed: '작업 오류',
};
export const PET_NAMES = ['모스', '루나', '토피'];
export const DEFAULT_CONFIGURATION: TaskConfiguration = {
  completionCriterion: '', interventionMode: 'when-needed', elapsedAlertMinutes: 10,
};
