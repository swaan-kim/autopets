import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Assemble the local Claude Code marketplace folder: one plugin that carries the
// metadata-only activity hooks and the read-only pet preference MCP server.
const root = fileURLToPath(new URL('../', import.meta.url));
export const pluginSources = [
  ['.claude-plugin/marketplace.json', 'integrations/claude-code/.claude-plugin/marketplace.json'],
  ['autopets/.claude-plugin/plugin.json', 'integrations/claude-code/plugin/.claude-plugin/plugin.json'],
  ['autopets/hooks/hooks.json', 'integrations/claude-code/plugin/hooks/hooks.json'],
  ['autopets/.mcp.json', 'integrations/claude-code/plugin/.mcp.json'],
  ['autopets/server/claude-code/hooks/run.mjs', 'integrations/claude-code/hooks/run.mjs'],
  ['autopets/server/claude-code/hooks/claude-hook.mjs', 'integrations/claude-code/hooks/claude-hook.mjs'],
  ['autopets/server/mcp/main.mjs', 'integrations/mcp/main.mjs'],
  ['autopets/server/mcp/server.mjs', 'integrations/mcp/server.mjs'],
  ['autopets/server/mcp/client.mjs', 'integrations/mcp/client.mjs'],
  ['autopets/server/codex/skills/autopets/scripts/bridge-client.mjs', 'integrations/codex/skills/autopets/scripts/bridge-client.mjs'],
  // client.mjs imports ../../packages/contracts/routing.mjs, which reads the routing table next to it.
  ['autopets/packages/contracts/routing.mjs', 'packages/contracts/routing.mjs'],
  ['autopets/packages/contracts/data/routing-profiles.json', 'packages/contracts/data/routing-profiles.json'],
  ['autopets/packages/contracts/recipes.mjs', 'packages/contracts/recipes.mjs'],
  ['autopets/packages/contracts/data/recipes.json', 'packages/contracts/data/recipes.json'],
  ['autopets/packages/contracts/data/pet-catalog.json', 'packages/contracts/data/pet-catalog.json'],
];

export async function packageClaudeCodePlugin({ out = path.join(root, 'release/claude-code/autopets-claude-code') } = {}) {
  const entries = await Promise.all(pluginSources.map(async ([name, file]) => ({ name, data: await fs.readFile(path.join(root, file)) })));
  const json = name => JSON.parse(entries.find(entry => entry.name === name).data);
  const hooks = json('autopets/hooks/hooks.json').hooks;
  const commands = Object.values(hooks).flat().flatMap(group => group.hooks);
  if (json('autopets/.claude-plugin/plugin.json').name !== 'autopets'
    || commands.some(hook => hook.type !== 'command' || hook.command !== 'node' || hook.args.join() !== '${CLAUDE_PLUGIN_ROOT}/server/claude-code/hooks/run.mjs')
    || json('.claude-plugin/marketplace.json').plugins.map(plugin => plugin.source).join() !== './autopets') throw Error('Unexpected Claude Code plugin package');
  await fs.rm(out, { recursive: true, force: true });
  for (const { name, data } of entries) {
    const file = path.join(out, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }
  return { directory: out, files: entries.length, hostInstalled: false };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) { process.stderr.write('Usage: node scripts/package-claude-code-plugin.mjs [--out directory]\n'); process.exitCode = 1; }
  else console.log(JSON.stringify(await packageClaudeCodePlugin(args.length ? { out: path.resolve(args[1]) } : {})));
}
