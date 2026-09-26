import type { PetRoleTemplate, PetRoleBinding } from '../contracts/types/roles';
import type { ChatIdentity } from '../contracts/types/assistance';
export function rolePrompt(template: PetRoleTemplate): string;
export function roleGuidance(binding: PetRoleBinding | null | undefined, identity: ChatIdentity, workflowEnabled?: boolean): string;
