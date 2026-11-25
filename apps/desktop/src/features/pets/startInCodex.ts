import type { PetLink, PetRoleSnapshot, PetRoleTemplate, SavedPet, SetupState } from '@autopets/contracts/types';
import recipeData from '../../../../../packages/contracts/data/recipes.json';
import { petStartRequest, fitsCodexLink } from '../../../../../packages/guidance/start-request.mjs';
import { command } from '../../bridge/command';
import type { Delivery } from './codexDelivery';
import { unresolvedPetRun } from './ExplicitPet';
import type { PetCatalogEntry } from './petCatalog';
import type { PrimaryAi } from './primaryAi';

// Starting a catalog pet without the manager window (from the floating pet). Same rules as the
// pet screen: reuse an identical saved pet. In Codex the start request is sent straight into the
// chat shown on the card (the chat that ran `$autopets`, else a connected chat), built by the app
// from the pet and the job (`send_pet_start`). Only when there is no such chat does a new Codex
// chat open with it typed in, because Codex cannot send into a chat it has not created yet.
// Claude Code keeps its own link with the request filled in.
const recipeIds = new Set(recipeData.recipes.map(recipe => recipe.id));
const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)])) : value;
const sameTemplate = (left: PetRoleTemplate, right: PetRoleTemplate) => JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
const setupReady = (setup?: SetupState | null) => setup?.connectionMode === 'explicit-pet'
  && setup.connections?.some(connection => connection.hostId === 'codex-windows-local' && connection.configured) === true;

export type StartChat = { threadId: string; cwd: string };
export type StartResult = 'opened' | 'copied' | 'not-ready' | Delivery;

/** Where a Codex start goes, shown before the press: the chat that ran `$autopets`, else the
 *  connected chat in the lowest slot whose pet is on and has no unfinished task, else none (new chat). */
export function startChat(setup: SetupState | null | undefined, links: PetLink[]): StartChat | null {
  if (setup?.setupChat?.sourceId === 'codex-windows-local') return { threadId: setup.setupChat.threadId, cwd: setup.setupChat.cwd };
  const ready = links.filter(link => link.target.sourceId === 'codex-windows-local' && link.connected && link.enabled && !unresolvedPetRun(link))
    .sort((a, b) => a.slot - b.slot)[0];
  return ready ? { threadId: ready.target.threadId, cwd: ready.target.cwd } : null;
}

export async function startCatalogPet(entry: PetCatalogEntry, task: string, setup?: SetupState | null, ai: PrimaryAi = 'codex', chat: StartChat | null = null): Promise<StartResult> {
  // Codex needs its AutoPets skill prepared once (a chat to send to already has it). Claude Code
  // reads the pet through the AutoPets tools installed in Claude, so there is nothing to prepare.
  if (ai === 'codex' && !chat && !setupReady(setup)) {
    const connected = await command<SetupState>('connect_ai', { hostId: 'codex-windows-local' });
    if (!setupReady(connected)) return 'not-ready';
  }
  const library = await command<PetRoleSnapshot>('roles_snapshot');
  const pet = library?.pets?.find(item => sameTemplate(item.template, entry.template))
    ?? await command<SavedPet>('save_pet', { id: null, expectedRevision: 0, template: entry.template });
  if (ai === 'codex') {
    const delivery = await command<Delivery>('send_pet_start', { petId: pet.id, expectedRevision: pet.revision,
      start: { kind: 'quick', entry: entry.id, task }, chat });
    // A job too long for a link is copied whole rather than cut.
    if (delivery.outcome === 'copy' && delivery.text) await navigator.clipboard.writeText(delivery.text);
    return delivery;
  }
  const prompt = petStartRequest({ name: entry.name, petId: pet.id, petRevision: pet.revision, recipe: recipeIds.has(entry.id) ? entry.id : null, task, via: 'tool' });
  if (fitsCodexLink(prompt)) {
    try { await command('open_pet_in_claude_code', { petId: pet.id, expectedRevision: pet.revision, prompt }); return 'opened'; }
    catch (cause) { if (!/prompt-too-long/.test(String(cause))) throw cause; }
  }
  await navigator.clipboard.writeText(prompt);
  return 'copied';
}
