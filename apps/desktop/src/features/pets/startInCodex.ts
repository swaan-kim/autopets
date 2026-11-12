import type { PetRoleSnapshot, PetRoleTemplate, SavedPet, SetupState } from '@autopets/contracts/types';
import recipeData from '../../../../../packages/contracts/data/recipes.json';
import { petStartRequest, fitsCodexLink } from '../../../../../packages/guidance/start-request.mjs';
import { command } from '../../bridge/command';
import type { PetCatalogEntry } from './petCatalog';

// Starting a catalog pet without the manager window (from the floating pet). Same rules as the
// pet screen: prepare Codex on first use, reuse an identical saved pet, open one short request.
// Nothing is sent to the chat; the user presses send there.
const recipeIds = new Set(recipeData.recipes.map(recipe => recipe.id));
const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)])) : value;
const sameTemplate = (left: PetRoleTemplate, right: PetRoleTemplate) => JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
const setupReady = (setup?: SetupState | null) => setup?.connectionMode === 'explicit-pet'
  && setup.connections?.some(connection => connection.hostId === 'codex-windows-local' && connection.configured) === true;

export type StartResult = 'opened' | 'copied' | 'not-ready';

export async function startCatalogPet(entry: PetCatalogEntry, task: string, setup?: SetupState | null): Promise<StartResult> {
  if (!setupReady(setup)) {
    const connected = await command<SetupState>('connect_ai', { hostId: 'codex-windows-local' });
    if (!setupReady(connected)) return 'not-ready';
  }
  const library = await command<PetRoleSnapshot>('roles_snapshot');
  const pet = library?.pets?.find(item => sameTemplate(item.template, entry.template))
    ?? await command<SavedPet>('save_pet', { id: null, expectedRevision: 0, template: entry.template });
  const prompt = petStartRequest({ name: entry.name, petId: pet.id, petRevision: pet.revision, recipe: recipeIds.has(entry.id) ? entry.id : null, task });
  if (fitsCodexLink(prompt)) {
    try { await command('open_pet_in_codex', { petId: pet.id, expectedRevision: pet.revision, prompt }); return 'opened'; }
    catch (cause) { if (!/prompt-too-long/.test(String(cause))) throw cause; }
  }
  // A job too long for a link is copied whole rather than cut.
  await navigator.clipboard.writeText(prompt);
  return 'copied';
}
