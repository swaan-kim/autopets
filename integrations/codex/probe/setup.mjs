#!/usr/bin/env node
import { readFile, writeFile, mkdir, copyFile, rename, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectProject } from '../scripts/install-hooks.mjs';

export const STATUS = 'AutoPets M1 preparation probe (review required)';
const entry = fileURLToPath(new URL('./prepare.mjs', import.meta.url));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
export function commands(configPath) {
  const args = [process.execPath, entry, 'hook', '--config', configPath];
  return { command: args.map(quote).join(' '), commandWindows:
    `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(`& ${args.map(psQuote).join(' ')}; exit $LASTEXITCODE`, 'utf16le').toString('base64')}` };
}
export function configureHooks(config, operation, command) {
  const next = structuredClone(config); next.hooks ??= {};
  for (const [event, groups] of Object.entries(next.hooks)) {
    next.hooks[event] = groups.flatMap(group => {
      const keep = group.hooks.filter(handler => !(handler.type === 'command' && handler.statusMessage === STATUS
        && handler.command === command.command && handler.commandWindows === command.commandWindows));
      return keep.length ? [{ ...group, hooks: keep }] : [];
    });
    if (!next.hooks[event].length) delete next.hooks[event];
  }
  if (operation === 'install') {
    for (const event of ['UserPromptSubmit', 'SessionStart', 'PostCompact']) {
      (next.hooks[event] ??= []).push({ hooks: [{ type: 'command', ...command, statusMessage: STATUS,
        timeout: 5, ...(event === 'UserPromptSubmit' ? { additionalContextLimit: 1800 } : {}) }] });
    }
  }
  return next;
}
async function main() {
  const args = process.argv.slice(2), operation = args.shift();
  if (!['install', 'uninstall'].includes(operation)) throw new Error('Use install or uninstall.');
  const opt = {};
  while (args.length) {
    const flag = args.shift();
    if (flag === '--dry-run') { opt.dryRun = true; continue; }
    if (!['--project', '--connection'].includes(flag) || !args.length || opt[flag]) throw new Error('Invalid arguments.');
    opt[flag] = args.shift();
  }
  if (!path.isAbsolute(opt['--project'] ?? '') || (operation === 'install' && !path.isAbsolute(opt['--connection'] ?? ''))) throw new Error('Absolute paths required.');
  const project = await realpath(opt['--project']);
  for (const folder of [path.join(project, '.local'), path.join(project, '.local', 'autopets-m1')]) {
    try { if ((await lstat(folder)).isSymbolicLink()) throw new Error('Probe data directory must not be a link.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const before = await inspectProject(project);
  const dataDir = path.join(project, '.local', 'autopets-m1');
  const configPath = path.join(dataDir, 'config.json');
  try { if ((await lstat(configPath)).isSymbolicLink()) throw new Error('Probe config must not be a link.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const next = configureHooks(before.config, operation, commands(configPath));
  const changed = JSON.stringify(next) !== JSON.stringify(before.config);
  if (!opt.dryRun) {
    await mkdir(dataDir, { recursive: true });
    if (operation === 'install') {
      const temporary = `${configPath}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: 1, enabled: true, project, connection: opt['--connection'] }), { flag: 'wx' });
      await rename(temporary, configPath);
    }
    else {
      try { const cfg = JSON.parse(await readFile(configPath, 'utf8')); await writeFile(configPath, JSON.stringify({ ...cfg, enabled: false })); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (changed) {
      await mkdir(before.codexDir, { recursive: true });
      const latest = await readFile(before.target, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (latest !== before.raw) throw new Error('Hooks changed during setup; review and retry.');
      if (before.raw !== null) await copyFile(before.target, `${before.target}.autopets-m1-backup-${randomUUID()}.json`);
      const temporary = `${before.target}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
      await rename(temporary, before.target);
    }
  }
  console.log(JSON.stringify({ operation, dryRun: !!opt.dryRun, changed, project, hookConfig: before.target,
    trustChanged: false, automaticSupportVerified: false,
    next: 'Review these three exact diagnostic hooks in Codex. Config presence is not delivery evidence.' }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('M1 setup failed; inspect paths and existing hook configuration locally.'); process.exitCode = 1; });
}
