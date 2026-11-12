import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { readConnection, requestJson } from '../codex/skills/autopets/scripts/bridge-client.mjs';
import { routingHint } from '../../packages/contracts/routing.mjs';
import { baseRecipeStart } from '../../packages/contracts/recipes.mjs';

export class PetLibraryError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);

export function createLibraryClient({ environment = process.env, connect = readConnection, request = requestJson } = {}) {
  return async body => {
    // Managed Codex tools can remain loaded in a running host after removal.
    // Check this local switch on each read; no polling or host termination.
    if (environment.AUTOPETS_MCP_ACCESS_FILE) {
      try {
        const file = environment.AUTOPETS_MCP_ACCESS_FILE;
        if (!path.isAbsolute(file) || (await stat(file)).size > 256) throw Error('invalid-access-file');
        const access = JSON.parse(await readFile(file, 'utf8'));
        if (access.version !== 1 || access.enabled !== true) throw Error('disabled');
      } catch { throw new PetLibraryError('connection-disabled'); }
    }
    const root = environment.AUTOPETS_DATA_DIR || (environment.LOCALAPPDATA ? path.join(environment.LOCALAPPDATA, 'local.autopets.desktop') : null);
    const location = environment.AUTOPETS_CONNECTION_FILE || (root && path.join(root, 'connection.json'));
    if (!location) throw new PetLibraryError('app-unavailable');
    let result;
    try { result = await request(await connect(location), '/v1/pet-library', body, 1800, 32768); }
    catch (error) {
      throw new PetLibraryError(error?.status === 409 ? 'pet-changed' : error?.status === 404 ? 'pet-or-feature-unavailable' : 'app-unavailable');
    }
    if (!object(result) || result.version !== 1) throw new PetLibraryError('invalid-library-response');
    if (body.operation === 'list') {
      if (!Array.isArray(result.pets) || result.pets.length > 20 || !(result.nextOffset === null || Number.isSafeInteger(result.nextOffset) && result.nextOffset > (body.offset ?? 0) && result.nextOffset <= 100_000)) throw new PetLibraryError('invalid-library-response');
      const pets = result.pets.map(pet => {
        if (!object(pet) || !text(pet.id, 128) || !text(pet.name, 120) || !Number.isSafeInteger(pet.revision) || pet.revision < 1 || !text(pet.roleId, 64)) throw new PetLibraryError('invalid-library-response');
        return { id: pet.id, revision: pet.revision, name: pet.name, roleId: pet.roleId };
      });
      return { pets, nextOffset: result.nextOffset };
    }
    const pet = result.pet;
    if (!object(pet) || pet.id !== body.petId || pet.revision !== body.expectedRevision || !object(pet.template)
      || !text(pet.template.name, 120) || !text(pet.template.instruction, 1536) || typeof pet.template.planFirst !== 'boolean'
      || !Array.isArray(pet.template.skills) || pet.template.skills.length > 8
      || pet.template.skills.some(skill => !object(skill) || !text(skill.id, 128) || !text(skill.version, 128))) throw new PetLibraryError('invalid-library-response');
    // Saved plan/build stages become a host-neutral hint built only from the shared routing table.
    // Raw saved model strings are never forwarded; a malformed or unlisted combination yields no hint.
    const modelOk = value => value === undefined || value === null || object(value) && text(value.model, 128) && text(value.reasoning, 16);
    let routing = null;
    if (modelOk(pet.template.planning) && modelOk(pet.template.execution)) {
      try { routing = routingHint(pet.template); } catch { routing = null; }
    }
    // The same one-time questions the Codex skill asks, so the first reply in this AI is also
    // "a few choices, or just say 기본으로". Built from bundled data only; null when the pet has none.
    let start = null;
    try { start = baseRecipeStart(pet.template); } catch { start = null; }
    // Return only the selected reusable preferences. Runtime links, accounts,
    // folder paths, conversation text and authentication never leave this tool.
    return { pet: { id: pet.id, revision: pet.revision, name: pet.template.name, instruction: pet.template.instruction,
      planFirst: pet.template.planFirst, skillReferences: pet.template.skills.map(({ id, version }) => ({ id, version })),
      routing, start, skillsLoaded: false, hostSettingsChanged: false } };
  };
}
