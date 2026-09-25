import type { ChatIdentity } from './assistance';
import type { WorkflowModel } from './workflow';

export type PetRoleId = 'research-document' | 'build-implementation';
export interface PetRoleTemplate {
  id: PetRoleId; version: 1; name: string; instruction: string; planFirst: boolean;
  planning: WorkflowModel | null; execution: WorkflowModel | null;
  skills: { id: string; version: string }[];
  prop: 'none' | 'notebook'; background: 'none' | 'meadow';
}
export interface SavedPet {
  id: string; revision: number; template: PetRoleTemplate; updatedAt: number;
}
export interface PetRoleBinding {
  identity: ChatIdentity; revision: number; enabled: boolean;
  petId: string; petRevision: number; template: PetRoleTemplate; updatedAt: number;
}
export interface PetRoleSnapshot { templates: PetRoleTemplate[]; pets: SavedPet[]; bindings: PetRoleBinding[] }
