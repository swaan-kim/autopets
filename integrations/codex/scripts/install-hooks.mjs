#!/usr/bin/env node
import { readFile, mkdir, writeFile, rename, copyFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const MARKER = '--autopets-hook-v1';
export const STATUS = 'AutoPets local bridge v1';
export const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd', 'PermissionRequest'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;

export function hookCommands(nodePath, adapterPath, connectionPath) {
  const args = [nodePath, adapterPath, '--connection', connectionPath, MARKER];
  const command = args.map(shellQuote).join(' ');
  const ps = `& ${args.map(psQuote).join(' ')}; exit $LASTEXITCODE`;
  const commandWindows = `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(ps, 'utf16le').toString('base64')}`;
  return { command, commandWindows };
}

export function isAutoPetsHandler(handler) {
  if (!object(handler) || handler.type !== 'command' || handler.statusMessage !== STATUS) return false;
  const encoded = /^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/]+=*)$/u.exec(handler.commandWindows ?? '');
  if (!encoded) return false;
  const source = Buffer.from(encoded[1], 'base64').toString('utf16le');
  const quoted = "'((?:[^']|'')*)'";
  const expected = new RegExp(`^& ${quoted} ${quoted} '--connection' ${quoted} '${MARKER}'; exit \\$LASTEXITCODE$`, 'u');
  const match = expected.exec(source);
  if (!match) return false;
  const args = match.slice(1).map((part) => part.replaceAll("''", "'"));
  if (!/[\\/]codex-hook\.mjs$/u.test(args[1])) return false;
  const exact = hookCommands(...args);
  return handler.command === exact.command && handler.commandWindows === exact.commandWindows;
}

export function validateConfig(config) {
  if (!object(config) || (config.hooks !== undefined && !object(config.hooks))) throw new Error('hooks.json must contain an object with an optional hooks object.');
  for (const groups of Object.values(config.hooks ?? {})) {
    if (!Array.isArray(groups)) throw new Error('Existing hook event is not an array; refusing to rewrite it.');
    for (const group of groups) {
      if (!object(group) || !Array.isArray(group.hooks)) throw new Error('Existing hook group is malformed; refusing to rewrite it.');
    }
  }
  return config;
}

export function updateConfig(config, operation, commands) {
  const updated = structuredClone(validateConfig(config));
  if (operation === 'uninstall' && updated.hooks === undefined) return updated;
  updated.hooks ??= {};
  for (const [event, groups] of Object.entries(updated.hooks)) {
    updated.hooks[event] = groups.flatMap((group) => {
      const kept = group.hooks.filter((handler) => !isAutoPetsHandler(handler));
      if (kept.length === group.hooks.length) return [group];
      return kept.length ? [{ ...group, hooks: kept }] : [];
    });
    if (groups.length && !updated.hooks[event].length) delete updated.hooks[event];
  }
  if (operation === 'install') {
    for (const event of EVENTS) {
      const handler = { type: 'command', ...commands, statusMessage: STATUS,
        timeout: ['Interrupt', 'SessionEnd'].includes(event) ? 3 : 5,
        ...(!['PermissionRequest', 'SessionEnd'].includes(event) ? { async: true } : {}),
      };
      (updated.hooks[event] ??= []).push({ hooks: [handler] });
    }
  }
  return updated;
}

export function parseArguments(args, allowOperation = true) {
  const operation = allowOperation ? args.shift() : 'check';
  if (allowOperation && !['install', 'uninstall'].includes(operation)) throw new Error('First argument must be install or uninstall.');
  const options = { operation, dryRun: false };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--dry-run') { options.dryRun = true; continue; }
    const key = { '--project': 'project', '--connection': 'connection', '--node': 'node' }[flag];
    if (!key || !args.length || args[0].startsWith('--') || options[key] !== undefined) throw new Error('Invalid or duplicate argument.');
    options[key] = args.shift();
  }
  if (!options.project || !path.isAbsolute(options.project)) throw new Error('--project must be an absolute directory path.');
  if (operation === 'install' && (!options.connection || !path.isAbsolute(options.connection))) throw new Error('--connection must be an absolute file path.');
  if (options.connection && !path.isAbsolute(options.connection)) throw new Error('--connection must be absolute.');
  if (options.node && !path.isAbsolute(options.node)) throw new Error('--node must be absolute.');
  return options;
}

export async function inspectProject(project) {
  const root = await realpath(project);
  if (!(await stat(root)).isDirectory()) throw new Error('Project is not a directory.');
  const codexDir = path.join(root, '.codex');
  // A project-local installation must never follow a link into another directory.
  try {
    const actual = await realpath(codexDir);
    if (path.relative(root, actual) !== '.codex') throw new Error('Project .codex resolves outside its expected directory.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const target = path.join(codexDir, 'hooks.json');
  try {
    const actual = await realpath(target);
    if (path.relative(codexDir, actual) !== 'hooks.json') throw new Error('hooks.json resolves outside its expected file.');
    const raw = await readFile(target, 'utf8');
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Existing hooks config exceeds 2 MiB.');
    return { target, codexDir, raw, config: validateConfig(JSON.parse(raw.replace(/^\uFEFF/u, ''))) };
  } catch (error) {
    if (error.code === 'ENOENT') return { target, codexDir, raw: null, config: { hooks: {} } };
    throw error;
  }
}

export async function main() {
  const options = parseArguments(process.argv.slice(2));
  const adapter = fileURLToPath(new URL('../hooks/codex-hook.mjs', import.meta.url));
  const nodePath = options.node ?? process.execPath;
  if (options.operation === 'install') {
    if (!(await stat(nodePath)).isFile() || !(await stat(adapter)).isFile()) throw new Error('Node or adapter path is not a file.');
  }
  const before = await inspectProject(options.project);
  const commands = options.operation === 'install' ? hookCommands(nodePath, adapter, options.connection) : undefined;
  const config = updateConfig(before.config, options.operation, commands);
  const changed = JSON.stringify(config) !== JSON.stringify(before.config);
  const report = { operation: options.operation, dryRun: options.dryRun, target: before.target, changed,
    autoPetsHandlers: Object.values(config.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks)).filter(isAutoPetsHandler).length,
    trust: 'Review and trust the exact hook definitions in Codex before use. This installer does not modify trust or policies.',
  };
  if (!options.dryRun && changed) {
    await mkdir(before.codexDir, { recursive: true });
    // Detect changes made after the inspection; never overwrite concurrent edits.
    const current = await readFile(before.target, 'utf8').catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (current !== before.raw) throw new Error('hooks.json changed during installation; retry after reviewing it.');
    if (before.raw !== null) {
      report.backup = `${before.target}.autopets-backup-${Date.now()}-${randomUUID()}.json`;
      await copyFile(before.target, report.backup);
    }
    const temporary = `${before.target}.autopets-${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, before.target);
  }
  console.log(JSON.stringify(report, null, 2));
}

export async function runCli() {
  await main().catch((error) => { console.error(`AutoPets hook setup: ${error.message}`); process.exitCode = 1; });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
