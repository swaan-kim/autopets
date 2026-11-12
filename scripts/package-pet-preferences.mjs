import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { makeZip } from './package-chatgpt.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// [name inside the .mcpb, repository file]. Exported so tests can check every import is shipped.
export const petPreferenceBundleSources = [
  ['manifest.json', 'integrations/mcp/manifest.json'],
  ['README.md', 'integrations/mcp/README.md'],
  ['server/mcp/main.mjs', 'integrations/mcp/main.mjs'],
  ['server/mcp/server.mjs', 'integrations/mcp/server.mjs'],
  ['server/mcp/client.mjs', 'integrations/mcp/client.mjs'],
  ['server/codex/skills/autopets/scripts/bridge-client.mjs', 'integrations/codex/skills/autopets/scripts/bridge-client.mjs'],
  // client.mjs imports ../../packages/contracts/routing.mjs, which reads the routing table next to it.
  ['packages/contracts/routing.mjs', 'packages/contracts/routing.mjs'],
  ['packages/contracts/data/routing-profiles.json', 'packages/contracts/data/routing-profiles.json'],
  // client.mjs also reads the recipe questions, which are checked against the pet catalog.
  ['packages/contracts/recipes.mjs', 'packages/contracts/recipes.mjs'],
  ['packages/contracts/data/recipes.json', 'packages/contracts/data/recipes.json'],
  ['packages/contracts/data/pet-catalog.json', 'packages/contracts/data/pet-catalog.json'],
  // client.mjs hands the pinned skill texts to the AI; third-party texts keep their license in the same file.
  ['packages/contracts/skill-guides.mjs', 'packages/contracts/skill-guides.mjs'],
  ['packages/contracts/data/skill-guides.json', 'packages/contracts/data/skill-guides.json'],
];

export async function packagePetPreferences({ out = path.join(root, 'release/mcp/AutoPets-pet-preferences.mcpb') } = {}) {
  const sources = petPreferenceBundleSources;
  const entries = await Promise.all(sources.map(async ([name, file]) => ({ name, data: await fs.readFile(path.join(root, file)) })));
  const manifest = JSON.parse(entries[0].data);
  if (manifest.server.type !== 'node' || manifest.server.entry_point !== 'server/mcp/main.mjs' || manifest.server.mcp_config.command !== 'node'
    || manifest.compatibility.platforms.join() !== 'win32' || entries.some(entry => /connection\.json|\.sqlite|host-config/u.test(entry.name))) throw Error('Unexpected pet preference package');
  const bytes = makeZip(entries);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, bytes);
  await fs.writeFile(`${out}.sha256`, `${sha256}  ${path.basename(out)}\n`);
  return { file: out, sha256, hostInstalled: false, actualHostVerified: false, readOnly: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) { process.stderr.write('Usage: node scripts/package-pet-preferences.mjs [--out file.mcpb]\n'); process.exitCode = 1; }
  else console.log(JSON.stringify(await packagePetPreferences(args.length ? { out: path.resolve(args[1]) } : {})));
}
