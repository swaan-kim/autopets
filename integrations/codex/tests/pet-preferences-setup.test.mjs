import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { digest, readJson } from '../bootstrap/files.mjs';
import { insertionPatch, preparePetPreferences, removeOwnedPatch, removePetPreferences } from '../bootstrap/pet-preferences.mjs';
import { createLibraryClient } from '../../mcp/client.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const baseline = '# existing user settings · 한글\nmodel = "synthetic"\n\n[mcp_servers.existing]\ncommand = "do-not-execute"\nargs = []\n';
const ownHeader = '[mcp_servers.autopets_preferences]';
const recordAt = f => path.join(f.root, 'state/codex-pet-mcp.json');

// A bounded fake of the external CLI contract, not a general TOML parser.
// The optional real-CLI test below covers native parsing and serialization.
function cliStub(f) {
  return async (_executable, args, home) => {
    assert.notEqual(home, f.home, 'The official CLI must never edit the live profile');
    const file = path.join(home, 'config.toml');
    const text = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    f.calls.push(args.slice(0, 3));
    if (args[1] === 'list') {
      const entries = text.includes('[mcp_servers.existing]') ? [{ name: 'existing', transport: { type: 'stdio', command: 'do-not-execute', args: [], env: {} } }] : [];
      if (text.includes(ownHeader)) {
        const own = text.slice(text.indexOf(ownHeader) + ownHeader.length);
        const field = name => JSON.parse(new RegExp(`^${name} = (.+)$`, 'm').exec(own)[1]);
        entries.push({ name: 'autopets_preferences', enabled: !own.includes('enabled = false'), transport: { type: 'stdio', command: field('command'), args: field('args'), env: { AUTOPETS_CONNECTION_FILE: field('AUTOPETS_CONNECTION_FILE'), AUTOPETS_MCP_ACCESS_FILE: field('AUTOPETS_MCP_ACCESS_FILE') } } });
      }
      return JSON.stringify(entries);
    }
    assert.equal(args[1], 'add');
    assert.equal(args[2], 'autopets_preferences');
    const separator = args.indexOf('--');
    const variables = args.flatMap((arg, index) => arg === '--env' ? [args[index + 1]] : []);
    const environment = variables.map(variable => `${variable.slice(0, variable.indexOf('='))} = ${JSON.stringify(variable.slice(variable.indexOf('=') + 1))}`).join('\n');
    const added = `\n${ownHeader}\ncommand = ${JSON.stringify(args[separator + 1])}\nargs = ${JSON.stringify([args[separator + 2]])}\n\n[mcp_servers.autopets_preferences.env]\n${environment}\n`;
    await fs.writeFile(file, text + added);
    return '';
  };
}

async function fixture(t, before = baseline) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-mcp-setup-한글 '));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('autopets-mcp-setup-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const root = path.join(directory, 'managed'), home = path.join(directory, 'codex'), sourceDirectory = path.join(directory, 'source');
  await fs.mkdir(home, { recursive: true });
  if (before !== null) await fs.writeFile(path.join(home, 'config.toml'), before);
  const executable = path.join(directory, 'cli.exe');
  await fs.writeFile(executable, 'synthetic CLI, never executed');
  const files = [];
  for (const name of ['runtime/node.exe', 'runtime/LICENSE', 'LICENSE', 'integrations/mcp/server.mjs', 'integrations/mcp/client.mjs', 'integrations/codex/skills/autopets/scripts/bridge-client.mjs', 'packages/contracts/routing.mjs', 'packages/contracts/data/routing-profiles.json',
    'packages/contracts/recipes.mjs', 'packages/contracts/data/recipes.json', 'packages/contracts/data/pet-catalog.json']) {
    const bytes = name.startsWith('runtime/') ? Buffer.from('synthetic runtime, never executed') : await fs.readFile(path.join(repository, name));
    const destination = path.join(sourceDirectory, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
    files.push({ path: name, sha256: digest(bytes) });
  }
  const f = { root, home, directory, sourceDirectory, config: path.join(home, 'config.toml'), calls: [], manifest: { files }, env: { LOCALAPPDATA: directory, CODEX_HOME: home } };
  f.options = { ...f, discoverCodex: async () => executable, cli: cliStub(f) };
  return f;
}

function cachePaths(text) {
  const own = text.slice(text.indexOf(ownHeader) + ownHeader.length);
  return { command: JSON.parse(/^command = (.+)$/mu.exec(own)[1]), server: JSON.parse(/^args = (.+)$/mu.exec(own)[1])[0] };
}

test('a CLI patch cannot remove or rewrite any previous setting byte', () => {
  const added = '\n[new]\nvalue = "한글"\n';
  for (const original of [baseline, '\uFEFF' + baseline.replaceAll('\n', '\r\n'), '']) {
    assert.equal(insertionPatch(original, original + added), added);
    assert.equal(removeOwnedPatch(original + added, added), original);
  }
  assert.throws(() => insertionPatch(baseline, baseline.replace('synthetic', 'changed') + added), /other-settings/);
  assert.throws(() => removeOwnedPatch(added + added, added), /user-changed/);
});

test('one-time preparation is repeatable, cached, detached and restores original config', async t => {
  const f = await fixture(t);
  assert.equal((await preparePetPreferences(f.options)).status, 'prepared');
  const bytes = await fs.readFile(f.config), paths = cachePaths(bytes.toString());
  const { command, server } = paths;
  assert.ok(command.startsWith(path.join(f.root, 'mcp/runtime')));
  assert.ok(server.startsWith(path.join(f.root, 'mcp/pet-preferences')));
  assert.equal(await fs.readFile(path.join(path.dirname(command), 'LICENSE'), 'utf8'), 'synthetic runtime, never executed');
  const second = await preparePetPreferences(f.options);
  assert.equal(second.status, 'already-prepared');
  assert.deepEqual(await fs.readFile(f.config), bytes);
  assert.equal(f.calls.filter(args => args[1] === 'add').length, 1);
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ].map(value => JSON.stringify(value)).join('\n') + '\n';
  const cached = spawnSync(process.execPath, [server], { input, cwd: f.directory, encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(cached.status, 0, cached.stderr);
  assert.equal(JSON.parse(cached.stdout.trim().split('\n').at(-1)).result.tools.length, 3);
  assert.equal((await removePetPreferences(f.options)).status, 'removed');
  assert.equal(await fs.readFile(f.config, 'utf8'), baseline);
  assert.equal((await removePetPreferences(f.options)).status, 'not-managed');
  assert.equal(await fs.readFile(server, 'utf8'), await fs.readFile(path.join(f.sourceDirectory, 'integrations/mcp/server.mjs'), 'utf8'));
});

test('an unowned same-name entry is preserved even when its values match', async t => {
  const f = await fixture(t);
  await preparePetPreferences(f.options);
  await fs.unlink(recordAt(f));
  const before = await fs.readFile(f.config);
  assert.equal((await preparePetPreferences(f.options)).reason, 'mcp-user-changed');
  assert.equal((await removePetPreferences(f.options)).status, 'not-managed');
  assert.deepEqual(await fs.readFile(f.config), before);
});

test('user changes inside the owned entry prevent both replacement and removal', async t => {
  const f = await fixture(t);
  await preparePetPreferences(f.options);
  const modified = (await fs.readFile(f.config, 'utf8')).replace(ownHeader, ownHeader + '\nenabled = false');
  await fs.writeFile(f.config, modified);
  assert.equal((await preparePetPreferences(f.options)).reason, 'mcp-user-changed');
  assert.equal((await removePetPreferences(f.options)).reason, 'mcp-user-changed');
  assert.equal(await fs.readFile(f.config, 'utf8'), modified);
});

test('unrelated later settings survive removal without requiring a whole-config hash match', async t => {
  const f = await fixture(t);
  await preparePetPreferences(f.options);
  const extra = '\n[profiles.user]\nmodel = "later-setting"\n';
  await fs.appendFile(f.config, extra);
  assert.equal((await removePetPreferences(f.options)).status, 'removed');
  assert.equal(await fs.readFile(f.config, 'utf8'), baseline + extra);
});

test('a changed source creates a new JS version and reuses the immutable Node runtime', async t => {
  const f = await fixture(t);
  await preparePetPreferences(f.options);
  const old = cachePaths(await fs.readFile(f.config, 'utf8'));
  const oldBytes = await fs.readFile(old.server);
  const source = path.join(f.sourceDirectory, 'integrations/mcp/server.mjs');
  await fs.appendFile(source, '\n// next packaged version\n');
  f.manifest.files.find(file => file.path === 'integrations/mcp/server.mjs').sha256 = digest(await fs.readFile(source));
  assert.equal((await preparePetPreferences(f.options)).status, 'prepared');
  const next = cachePaths(await fs.readFile(f.config, 'utf8'));
  assert.equal(next.command, old.command);
  assert.notEqual(next.server, old.server);
  assert.deepEqual(await fs.readFile(old.server), oldBytes);
  assert.equal((await removePetPreferences(f.options)).status, 'removed');
  assert.equal(await fs.readFile(f.config, 'utf8'), baseline);
});

test('an editor changing the live config during staging wins; retry recovers pending ownership', async t => {
  const f = await fixture(t);
  await preparePetPreferences(f.options);
  const source = path.join(f.sourceDirectory, 'integrations/mcp/server.mjs');
  await fs.appendFile(source, '\n// upgraded source\n');
  f.manifest.files.find(file => file.path === 'integrations/mcp/server.mjs').sha256 = digest(await fs.readFile(source));
  const originalCli = f.options.cli;
  f.options.cli = async (...args) => {
    const result = await originalCli(...args);
    if (args[1][1] === 'add') await fs.appendFile(f.config, '\n# concurrent user edit\n');
    return result;
  };
  assert.equal((await preparePetPreferences(f.options)).reason, 'mcp-config-changed');
  const interrupted = await readJson(recordAt(f));
  assert.equal(interrupted.phase, 'pending');
  assert.equal(interrupted.previous.phase, 'ready');
  assert.ok((await fs.readFile(f.config, 'utf8')).endsWith('# concurrent user edit\n'));
  f.options.cli = originalCli;
  assert.equal((await preparePetPreferences(f.options)).status, 'prepared');
  assert.equal((await removePetPreferences(f.options)).status, 'removed');
  assert.equal(await fs.readFile(f.config, 'utf8'), baseline + '\n# concurrent user edit\n');
});

test('a CLI rewriting another setting is rejected before the live profile changes', async t => {
  const f = await fixture(t);
  const originalCli = f.options.cli;
  f.options.cli = async (...args) => {
    const result = await originalCli(...args);
    if (args[1][1] === 'add') {
      const file = path.join(args[2], 'config.toml');
      await fs.writeFile(file, 'model = "unexpected-change"\n' + await fs.readFile(file, 'utf8'));
    }
    return result;
  };
  assert.equal((await preparePetPreferences(f.options)).reason, 'mcp-other-settings-changed');
  assert.equal(await fs.readFile(f.config, 'utf8'), baseline);
  await assert.rejects(fs.stat(recordAt(f)), { code: 'ENOENT' });
});

test('missing CLI and bad package preserve skill setup and existing config', async t => {
  const f = await fixture(t);
  assert.equal((await preparePetPreferences({ ...f.options, discoverCodex: async () => null })).reason, 'mcp-cli-unavailable');
  assert.equal((await preparePetPreferences({ ...f.options, manifest: { files: [] } })).reason, 'mcp-package-incomplete');
  assert.equal(await fs.readFile(f.config, 'utf8'), baseline);
});

test('a fresh profile gets an owned entry and damaged packaged bytes never reach live config', async t => {
  const f = await fixture(t, null);
  assert.equal((await preparePetPreferences(f.options)).status, 'prepared');
  assert.equal((await removePetPreferences(f.options)).status, 'removed');
  assert.equal(await fs.readFile(f.config, 'utf8'), '');
  const damaged = await fixture(t);
  await fs.appendFile(path.join(damaged.sourceDirectory, 'runtime/node.exe'), 'tampered');
  assert.equal((await preparePetPreferences(damaged.options)).reason, 'mcp-cache-review');
  assert.equal(await fs.readFile(damaged.config, 'utf8'), baseline);
  await assert.rejects(fs.stat(recordAt(damaged)), { code: 'ENOENT' });
});

test('changed cached code is preserved and cannot be reported as repaired', async t => {
  const f = await fixture(t);
  await preparePetPreferences(f.options);
  const before = await fs.readFile(f.config), { server } = cachePaths(before.toString());
  await fs.appendFile(server, '\n// user-edited cache\n');
  assert.equal((await preparePetPreferences(f.options)).reason, 'mcp-cache-review');
  assert.deepEqual(await fs.readFile(f.config), before);
  assert.ok((await fs.readFile(server, 'utf8')).endsWith('// user-edited cache\n'));
});

test('an unchanged owned snapshot can be removed after the Codex CLI is gone', async t => {
  const f = await fixture(t);
  await preparePetPreferences(f.options);
  const removed = await removePetPreferences({ ...f.options, discoverCodex: async () => null });
  assert.equal(removed.status, 'removed');
  assert.equal(await fs.readFile(f.config, 'utf8'), baseline);
});

test('unknown edits are retained when the CLI needed for safe removal is missing', async t => {
  const f = await fixture(t);
  await preparePetPreferences(f.options);
  await fs.appendFile(f.config, '\n# later user change\n');
  const before = await fs.readFile(f.config);
  assert.equal((await removePetPreferences({ ...f.options, discoverCodex: async () => null })).reason, 'mcp-cli-unavailable');
  assert.deepEqual(await fs.readFile(f.config), before);
});

test('disconnect revokes an already-loaded managed client even if edited config is retained', async t => {
  const f = await fixture(t);
  await preparePetPreferences(f.options);
  const access = path.join(f.root, 'state/codex-pet-mcp-access.json');
  let calls = 0;
  const client = createLibraryClient({
    environment: { ...f.env, AUTOPETS_MCP_ACCESS_FILE: access },
    connect: async () => ({}),
    request: async () => { calls++; return { version: 1, pets: [], nextOffset: null }; },
  });
  await client({ operation: 'list', offset: 0 });
  assert.equal(calls, 1);
  await fs.writeFile(f.config, (await fs.readFile(f.config, 'utf8')).replace(ownHeader, ownHeader + '\nenabled = false'));
  assert.equal((await removePetPreferences(f.options)).reason, 'mcp-user-changed');
  await assert.rejects(client({ operation: 'list', offset: 0 }), { code: 'connection-disabled' });
  assert.equal(calls, 1, 'No app request may escape after disconnect');
});

test('missing, invalid and oversized local connection state cannot reach the app', async t => {
  const f = await fixture(t);
  const file = path.join(f.directory, 'connection-state.json');
  let calls = 0;
  const client = createLibraryClient({ environment: { ...f.env, AUTOPETS_MCP_ACCESS_FILE: file },
    connect: async () => { calls++; return {}; }, request: async () => ({}) });
  for (const bytes of [null, '{', JSON.stringify({ version: 1, enabled: false }), ' '.repeat(257)]) {
    if (bytes !== null) await fs.writeFile(file, bytes);
    await assert.rejects(client({ operation: 'list', offset: 0 }), { code: 'connection-disabled' });
  }
  assert.equal(calls, 0);
});

test('official Codex CLI prepares and removes LF / BOM+CRLF profiles without AI', { skip: !process.env.AUTOPETS_TEST_CODEX }, async t => {
  for (const original of [baseline, '\uFEFF' + baseline.replaceAll('\n', '\r\n')]) {
    const f = await fixture(t, original);
    const options = { ...f.options, cli: undefined, discoverCodex: async () => process.env.AUTOPETS_TEST_CODEX };
    const first = await preparePetPreferences(options);
    assert.equal(first.status, 'prepared', JSON.stringify(first));
    assert.equal((await preparePetPreferences(options)).status, 'already-prepared');
    assert.equal((await removePetPreferences(options)).status, 'removed');
    assert.equal(await fs.readFile(f.config, 'utf8'), original);
  }
});
