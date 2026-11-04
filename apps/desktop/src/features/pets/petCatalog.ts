import data from '../../../../../packages/contracts/data/pet-catalog.json';
import type { PetRoleTemplate } from '@autopets/contracts/types';
import { promptPets } from './promptIdeas';

export interface PetCatalogEntry {
  id: string; category: 'daily' | 'work'; name: string; summary: string;
  inputLabel: string; optionalLabel: string; example: string; output: string;
  before: string; after: string; limit: string; symbol: string;
  publisher: string; source: string | null; template: PetRoleTemplate;
}
export const petCatalog = data as PetCatalogEntry[];
export const allPetCatalog = [...petCatalog, ...promptPets];
export const catalogFor = (template: PetRoleTemplate) => {
  const candidates = allPetCatalog.filter(entry =>
    entry.template.id === template.id && entry.template.skills[0]?.id === template.skills[0]?.id);
  return candidates.find(entry => entry.template.name === template.name)
    ?? (template.id === 'research-document' ? undefined : candidates[0]);
};
