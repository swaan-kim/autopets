import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { atomicJson, digest, inside, lock, readJson, regular, safeDirectory } from './files.mjs';

const NAME = 'autopets_preferences';
export const petPreferenceSources = [
  'integrations/mcp/server.mjs',
  'integrations/mcp/client.mjs',
  'integrations/codex/skills/autopets/scripts/bridge-client.mjs',
  // client.mjs imports the shared routing table; without these the read tool cannot start.
  'packages/contracts/routing.mjs',
  'packages/contracts/data/routing-profiles.json',
  'packages/contracts/recipes.mjs',
  'packages/contracts/data/recipes.json',
  'packages/contracts/data/pet-catalog.json',
  'packages/contracts/skill-guides.mjs',
  'packages/contracts/data/skill-guides.json',
];
const sources = petPreferenceSources;
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fingerprint = entry => digest(stable(entry));
const ownEntry = entries => entries.find(entry => entry.name === NAME);
const others = entries => stable(entries.filter(entry => entry.name !== NAME).sort((a, b) => a.name.localeCompare(b.name)));
const recordFile = root => path.join(root, 'state/codex-pet-mcp.json');
const accessFile = root => path.join(root, 'state/codex-pet-mcp-access.json');
const report = (status, reason = null) => ({ status, prepared: ['prepared', 'already-prepared'].includes(status), reason });

/** A CLI-generated edit is accepted only when every previous byte remains. */
export function insertionPatch(before, after) {
  let start = 0, suffix = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (suffix < before.length - start && suffix < after.length - start && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  if (start + suffix !== before.length || after.length <= before.length) throw Error('mcp-other-settings-changed');
  return after.slice(start, after.length - suffix);
}

export function removeOwnedPatch(text, patch) {
  const at = text.indexOf(patch);
  if (!patch || at < 0 || text.indexOf(patch, at + patch.length) !== -1) throw Error('mcp-user-changed');
  return text.slice(0, at) + text.slice(at + patch.length);
}

export async function runCodexMcp(executable, args, home, env) {
  return new Promise((resolve, reject) => {
    // Only the private staging profile is passed to the official CLI. It never
    // writes the user's live config, starts a model, or receives auth.json.
    const environment = { ...process.env, ...env, CODEX_HOME: home };
    delete environment.CODEX_THREAD_ID;
    const child = spawn(executable, args, { cwd: home, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let settled = false, size = 0;
    const chunks = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { child.kill(); reject(error); } else resolve(value);
    };
    const timer = setTimeout(() => finish(Error('mcp-cli-unavailable')), 4000);
    child.on('error', () => finish(Error('mcp-cli-unavailable')));
    child.stdout.on('data', bytes => {
      size += bytes.length;
      if (size > 1024 * 1024) return finish(Error('mcp-cli-unavailable'));
      chunks.push(bytes);
    });
    child.on('close', code => finish(code === 0 ? null : Error('mcp-cli-unavailable'), Buffer.concat(chunks).toString('utf8')));
  });
}

async function entriesAt(cli, executable, home, env) {
  let value;
  try { value = JSON.parse(await cli(executable, ['mcp', 'list', '--json'], home, env)); }
  catch { throw Error('mcp-config-review'); }
  if (!Array.isArray(value) || value.length > 200 || value.some(entry => !entry || typeof entry.name !== 'string')
    || new Set(value.map(entry => entry.name)).size !== value.length) throw Error('mcp-config-review');
  return value;
}

async function configBytes(file) {
  try {
    const info = await regular(file);
    if (info.size > 1024 * 1024) throw Error('mcp-config-review');
    return await fs.readFile(file);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const decode = bytes => bytes === null ? '' : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
function keepLineEndings(text, before) {
  text = text.replace(/^\uFEFF/u, '');
  if (/\r\n/u.test(before) && !/(?<!\r)\n/u.test(before)) text = text.replace(/\r?\n/gu, '\r\n');
  return text;
}

function generatedEntry(text, before) {
  // The CLI writes only an EMPTY staging profile. Harvest its own generated
  // table instead of accepting incidental normalization of other user settings
  // (for example, the CLI omits an existing args = [] when rewriting TOML).
  const lines = text.split(/\r?\n/u).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const header = `[mcp_servers.${NAME}]`, environment = `[mcp_servers.${NAME}.env]`;
  if (lines[0] !== header || lines.some(line => line.startsWith('[') && line !== header && line !== environment)) throw Error('mcp-other-settings-changed');
  const separator = before.length ? before.endsWith('\n') ? '\n' : '\n\n' : '';
  return keepLineEndings(separator + text, before);
}

async function staged(root, original, action) {
  const parent = await safeDirectory(path.join(root, 'state/mcp-staging'));
  const directory = await fs.mkdtemp(path.join(parent, 'profile-'));
  try {
    if (original !== null) await fs.writeFile(path.join(directory, 'config.toml'), original, { flag: 'wx', mode: 0o600 });
    return await action(directory);
  } finally {
    // Only the fresh directory created by this operation can be removed.
    if (path.dirname(directory) !== parent || !path.basename(directory).startsWith('profile-')) throw Error('mcp-stage-path');
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function loadRecord(root, home) {
  const saved = await readJson(recordFile(root)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const valid = record => record?.version === 1 && record.owner === 'autopets' && record.home === home
    && typeof record.patch === 'string' && record.patch.length > 0 && record.patch.length <= 16384
    && /^[a-f0-9]{64}$/u.test(record.entryDigest) && /^[a-f0-9]{64}$/u.test(record.afterDigest)
    && ['pending', 'ready', 'removed'].includes(record.phase);
  if (saved && (!valid(saved) || saved.previous && (!valid(saved.previous) || saved.previous.phase !== 'ready'))) throw Error('mcp-ownership-review');
  return saved?.phase === 'removed' ? null : saved;
}

function matchingRecord(saved, entry) {
  if (!entry) return saved;
  if (saved && fingerprint(entry) === saved.entryDigest) return saved;
  const previous = saved?.phase === 'pending' ? saved.previous : null;
  if (previous?.version === 1 && previous.owner === 'autopets' && previous.home === saved.home
    && previous.phase === 'ready' && typeof previous.patch === 'string' && previous.patch.length <= 16384
    && fingerprint(entry) === previous.entryDigest) return previous;
  throw Error('mcp-user-changed');
}

async function immutableFile(source, destination, expected) {
  await safeDirectory(path.dirname(destination));
  try {
    await regular(destination);
    if (digest(await fs.readFile(destination)) !== expected) throw Error('mcp-cache-review');
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.copyFile(source, temporary, constants.COPYFILE_EXCL);
    if (digest(await fs.readFile(temporary)) !== expected) throw Error('mcp-cache-review');
    // Exclusive publication: never overwrite an existing version or live file.
    try { await fs.link(temporary, destination); }
    catch (error) {
      if (error.code !== 'EEXIST' || digest(await fs.readFile(destination)) !== expected) throw error;
    }
  } finally { await fs.rm(temporary, { force: true }); }
  await regular(destination);
}

function desiredFiles(root, sourceDirectory, manifest) {
  const required = ['runtime/node.exe', 'runtime/LICENSE', 'LICENSE', ...sources];
  const files = required.map(name => {
    const entry = manifest.files.find(item => item.path === name);
    if (!entry || !/^[a-f0-9]{64}$/u.test(entry.sha256)) throw Error('mcp-package-incomplete');
    return { name, sha256: entry.sha256, source: inside(sourceDirectory, name) };
  });
  const bundle = digest(stable(files.filter(file => !file.name.startsWith('runtime/')).map(({ name, sha256 }) => ({ name, sha256 }))));
  const directory = path.join(root, 'mcp/pet-preferences', bundle);
  return {
    command: path.join(root, 'mcp/runtime', files[0].sha256, 'node.exe'),
    server: path.join(directory, 'integrations/mcp/server.mjs'),
    files: files.map(file => ({ ...file, destination: file.name.startsWith('runtime/')
      ? path.join(root, 'mcp/runtime', files[0].sha256, path.basename(file.name)) : inside(directory, file.name) })),
  };
}

async function commitConfig(root, file, before, after) {
  const current = await configBytes(file);
  if (current?.equals(before) !== true && !(current === null && before === null)) throw Error('mcp-config-changed');
  await safeDirectory(path.dirname(file));
  if (before !== null) {
    const directory = await safeDirectory(path.join(root, 'state/mcp-backups'));
    await fs.writeFile(path.join(directory, `${randomUUID()}.toml`), before, { flag: 'wx', mode: 0o600 });
  }
  const temporary = `${file}.autopets-${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, after, { flag: 'wx', mode: 0o600 });
    // Recheck after backup/temp I/O too. Do not restore over a concurrent edit.
    const latest = await configBytes(file);
    if (latest?.equals(before) !== true && !(latest === null && before === null)) throw Error('mcp-config-changed');
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

/** Called only for the desktop's explicit Connect action, never app launch. */
export async function preparePetPreferences({ root, sourceDirectory, manifest, env = process.env, discoverCodex, cli = runCodexMcp }) {
  try {
    return await lock(path.join(root, 'state/mcp-operation'), async () => {
      const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
      if (!path.isAbsolute(home)) throw Error('mcp-config-review');
      const executable = await discoverCodex?.();
      if (!path.isAbsolute(executable || '') || !(await fs.stat(executable)).isFile()) throw Error('mcp-cli-unavailable');
      const config = path.join(home, 'config.toml');
      const before = await configBytes(config), text = decode(before);
      const ownership = await loadRecord(root, home);
      const desired = desiredFiles(root, sourceDirectory, manifest);
      const connection = env.AUTOPETS_CONNECTION_FILE || path.join(env.AUTOPETS_DATA_DIR || path.join(env.LOCALAPPDATA, 'local.autopets.desktop'), 'connection.json');
      if (!path.isAbsolute(connection)) throw Error('mcp-config-review');
      const toolEnv = { AUTOPETS_CONNECTION_FILE: connection, AUTOPETS_MCP_ACCESS_FILE: accessFile(root) };
      return staged(root, before, async stage => {
        const existing = await entriesAt(cli, executable, stage, env);
        const entry = ownEntry(existing);
        const saved = matchingRecord(ownership, entry);
        if (entry && saved) {
          const transport = entry.transport;
          if (transport?.command === desired.command && stable(transport.args) === stable([desired.server])
            && stable(transport.env || {}) === stable(toolEnv)) {
            removeOwnedPatch(text, saved.patch);
            for (const file of desired.files) await immutableFile(file.source, file.destination, file.sha256);
            // A previous interruption may have committed the config already.
            await atomicJson(recordFile(root), { ...saved, previous: undefined, phase: 'ready', afterDigest: digest(before) });
            await atomicJson(accessFile(root), { version: 1, enabled: true });
            return report('already-prepared');
          }
        }
        const baseline = entry ? removeOwnedPatch(text, saved.patch) : text;
        if (entry) await fs.writeFile(path.join(stage, 'config.toml'), baseline);
        const clean = await entriesAt(cli, executable, stage, env);
        if (ownEntry(clean) || others(clean) !== others(existing)) throw Error('mcp-user-changed');
        await fs.writeFile(path.join(stage, 'config.toml'), '');
        await cli(executable, ['mcp', 'add', NAME, ...Object.entries(toolEnv).flatMap(([key, value]) => ['--env', `${key}=${value}`]), '--', desired.command, desired.server], stage, env);
        const after = baseline + generatedEntry(await fs.readFile(path.join(stage, 'config.toml'), 'utf8'), baseline);
        const patch = insertionPatch(baseline, after);
        if (patch.length > 16384) throw Error('mcp-config-review');
        await fs.writeFile(path.join(stage, 'config.toml'), after);
        const added = await entriesAt(cli, executable, stage, env);
        const registered = ownEntry(added), transport = registered?.transport;
        if (others(added) !== others(existing) || transport?.type !== 'stdio' || transport.command !== desired.command
          || stable(transport.args) !== stable([desired.server]) || stable(transport.env || {}) !== stable(toolEnv)) throw Error('mcp-config-review');
        for (const file of desired.files) await immutableFile(file.source, file.destination, file.sha256);
        const record = { version: 1, owner: 'autopets', home, phase: 'pending', patch,
          entryDigest: fingerprint(registered), afterDigest: digest(after), originalExists: before !== null };
        if (saved) record.previous = { ...saved, previous: undefined, phase: 'ready' };
        await atomicJson(recordFile(root), record);
        await commitConfig(root, config, before, Buffer.from(after));
        await atomicJson(recordFile(root), { ...record, previous: undefined, phase: 'ready' });
        await atomicJson(accessFile(root), { version: 1, enabled: true });
        return report('prepared');
      });
    });
  } catch (error) {
    return report('preserved', /^mcp-[a-z-]+$/u.test(error.message) ? error.message : 'mcp-config-review');
  }
}

/** Remove only the unchanged entry recorded by this installer, retaining data. */
export async function removePetPreferences({ root, env = process.env, discoverCodex, cli = runCodexMcp }) {
  try {
    return await lock(path.join(root, 'state/mcp-operation'), async () => {
      const raw = await readJson(recordFile(root)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!raw) return report('not-managed');
      if (!path.isAbsolute(raw.home || '')) throw Error('mcp-ownership-review');
      let saved = await loadRecord(root, raw.home);
      await atomicJson(accessFile(root), { version: 1, enabled: false });
      if (!saved) return report('not-managed');
      const config = path.join(saved.home, 'config.toml');
      const before = await configBytes(config);
      if (before === null) {
        await atomicJson(recordFile(root), { ...saved, phase: 'removed' });
        return report('removed');
      }
      const text = decode(before);
      // Resolve an interrupted replacement by its unchanged previous snapshot.
      if (saved.phase === 'pending' && saved.previous?.phase === 'ready' && digest(before) === saved.previous.afterDigest) saved = saved.previous;
      let after;
      // Without a CLI we can still remove a wholly unchanged owned snapshot.
      // Once other edits exist, parse both snapshots with the official CLI.
      if (digest(before) !== saved.afterDigest) {
        const executable = await discoverCodex?.();
        if (!path.isAbsolute(executable || '')) throw Error('mcp-cli-unavailable');
        await staged(root, before, async stage => {
          const existing = await entriesAt(cli, executable, stage, env);
          if (!ownEntry(existing)) throw Error('mcp-user-changed');
          saved = matchingRecord(saved, ownEntry(existing));
          after = removeOwnedPatch(text, saved.patch);
          await fs.writeFile(path.join(stage, 'config.toml'), after);
          const clean = await entriesAt(cli, executable, stage, env);
          if (ownEntry(clean) || others(clean) !== others(existing)) throw Error('mcp-user-changed');
        });
      } else after = removeOwnedPatch(text, saved.patch);
      await commitConfig(root, config, before, Buffer.from(after));
      await atomicJson(recordFile(root), { ...saved, phase: 'removed' });
      return report('removed');
    });
  } catch (error) {
    return report('preserved', /^mcp-[a-z-]+$/u.test(error.message) ? error.message : 'mcp-config-review');
  }
}
