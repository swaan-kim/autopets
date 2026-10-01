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
