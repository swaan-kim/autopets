import type { PetRoleTemplate, PetSkillReference } from './roles';
export interface SavedPetReference { id: string; revision: number }
export interface PetLink {
  version: 1;
  target: { sourceId: 'codex-windows-local'; threadId: string; cwd: string };
  slot: number; revision: number; enabled: boolean; connected: boolean;
  profile: 'light' | 'standard' | 'careful' | 'plan';
  template: PetRoleTemplate;
  savedPet?: SavedPetReference | null;
  run: null | { id: string; settingsRevision: number; profile: PetLink['profile']; model: string; effort: string;
    state: 'requested' | 'working' | 'returned' | 'waiting' | 'complete' | 'failed' | 'unknown';
    childId: string | null; turnId: string | null; observedModel: string | null; observedEffort: string | null;
    evidence: string | null; startedAt: number; agentPath?: string | null; trackingClosed?: boolean;
    resultReturned?: boolean; runtimeCompleted?: boolean;
    template?: PetRoleTemplate | null; savedPet?: SavedPetReference | null;
    skillEvidence?: PetSkillReference[]; figmaUsed?: boolean };
}
/** One existing catalog pet suggested for a request sent in a connected Codex chat. */
export interface PetRecommendationCandidate { petId: string; reason: string; cues: string[] }
/** In-memory app state; `request` is the user's own message, kept only for prefill. */
export interface PetRecommendation {
  id: string; target: PetLink['target']; turnId: string; source: 'hook' | 'skill';
  state: 'preparing' | 'shown' | 'accepted' | 'dismissed' | 'running';
  request: string | null; requestTruncated: boolean; candidates: PetRecommendationCandidate[];
  acceptedPetId: string | null; createdAt: number; updatedAt: number;
}
/**
 * A connected Codex chat needs the user (`action_required`: a question, a plan to confirm, an
 * approval prompt) or the requested work finished (`completed`). In-memory app state from the
 * AutoPets attention hook. `read` means the user closed or opened it from the pet; Codex may still
 * be waiting. A notice disappears only when Codex reports the wait ended.
 */
export interface CodexAttention {
  id: string; target: PetLink['target']; chatTitle: string | null; turnId: string;
  kind: 'action_required' | 'completed';
  reason: 'question' | 'confirmation_required' | 'approval_required' | 'completed';
  source: 'stop' | 'permission' | 'user-input';
  summary: string;
  /** Completed notices: what the turn observably did. `verified: false` = no transcript to check. */
  evidence: { fileChanges: number; workCommands: number; verified: boolean } | null;
  read: boolean; createdAt: number; updatedAt: number;
}
