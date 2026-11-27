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
export interface ToolActivity {
  version: 1;
  turnId: string;
  calls: { id: string; name: string; state: 'running' | 'completed' | 'failed' | 'unknown'; observedAt: number }[];
  truncated: boolean;
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
  toolActivityV1?: ToolActivity | null;
  canOpenTask?: boolean;
}
export interface Slot { index: number; sessionId: string | null }
export interface ReviewSummary { due: number; total: number; batches: number; notifiedToday: boolean; dueByThread?: Record<string, number> }
export interface Snapshot {
  petLinks?: import('./pet-link').PetLink[];
  petRecommendations?: import('./pet-link').PetRecommendation[];
  codexAttention?: import('./pet-link').CodexAttention[];
  /** 복습 도우미: today's review count (at most 10), saved cards and batches, and whether today's notice was shown. */
  review?: ReviewSummary;
  petJobs?: import('./pet-link').PetJob[];
  setup?: import('./setup').SetupState | null;
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
