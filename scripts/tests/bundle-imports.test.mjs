// Every bundle that copies a fixed list of files must contain everything its code loads.
// Twice a module gained an import (the routing table) while a bundle list stayed the same, and the
// shipped tool could not start. This follows the static relative references of each bundled .mjs
// file — `import … from`, `import()`, and `new URL('…', import.meta.url)` — and requires each
// referenced repository file to be in the same bundle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectConnectorFiles } from '../stage-desktop-resources.mjs';
import { petPreferenceBundleSources } from '../package-pet-preferences.mjs';
import { pluginSources } from '../package-claude-code-plugin.mjs';
import { petPreferenceSources } from '../../integrations/codex/bootstrap/pet-preferences.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const REFERENCE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bnew URL\(\s*)(['"])(\.{1,2}\/[^'"\n]+)\1/gu;

function missing(files) {
  const bundled = new Set(files.map(file => file.replaceAll('\\', '/')));
  const gaps = [];
  for (const file of bundled) {
    if (!file.endsWith('.mjs')) continue;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, , reference] of text.matchAll(REFERENCE)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), reference));
      const absolute = path.join(root, target);
      // Optional runtime locations (a folder, a git-ignored trace file) are not repository files.
      if (target.startsWith('..') || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
      if (!bundled.has(target)) gaps.push(`${file} -> ${target}`);
    }
  }
  return gaps;
}

test('the reference scanner sees imports, dynamic imports and data URLs', () => {
  const found = [...`import a from './a.mjs';\nconst b = await import("../b.mjs");\nread(new URL('./data/c.json', import.meta.url));\nimport fs from 'node:fs';`.matchAll(REFERENCE)].map(match => match[2]);
  assert.deepEqual(found, ['./a.mjs', '../b.mjs', './data/c.json']);
  assert.deepEqual(missing(['integrations/mcp/client.mjs']).sort(), [
    'integrations/mcp/client.mjs -> integrations/codex/skills/autopets/scripts/bridge-client.mjs',
    'integrations/mcp/client.mjs -> packages/contracts/recipes.mjs',
    'integrations/mcp/client.mjs -> packages/contracts/routing.mjs',
  ], 'a list without its imports is reported');
});

test('the .mcpb, the Claude Code plugin and the Codex read tool ship every file their code loads', () => {
  assert.deepEqual(missing(petPreferenceBundleSources.map(([, file]) => file)), [], 'AutoPets-pet-preferences.mcpb');
  assert.deepEqual(missing(pluginSources.map(([, file]) => file)), [], 'Claude Code plugin');
  assert.deepEqual(missing(petPreferenceSources), [], 'Codex pet-preferences connector');
});

test('the installed connector ships every file its skills, hooks and runtime load', async () => {
  const license = path.join(root, 'LICENSE');
  const files = (await collectConnectorFiles({ root, node: license, license })).map(file => file.name).filter(name => !name.startsWith('runtime/'));
  assert.ok(files.includes('integrations/codex/skills/autopets/scripts/pet.mjs'));
  assert.ok(files.includes('packages/contracts/data/recipes.json'), 'the recipe questions travel with the skill');
  assert.deepEqual(missing(files), []);
});
