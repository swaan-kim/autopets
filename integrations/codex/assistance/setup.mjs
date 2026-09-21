#!/usr/bin/env node
// Defaults to inspection only. No trust decisions, global hooks or app installation.
import { mkdir, readFile, writeFile, copyFile, rename, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectProject } from '../scripts/install-hooks.mjs';

export const STATUS = 'AutoPets bounded assistance (review required)';
const entry = fileURLToPath(new URL('./prepare.mjs', import.meta.url));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
export function hookCommands(configPath) {
  const args = [process.execPath, entry, 'hook', '--config', configPath];
  return { command: args.map(quote).join(' '), commandWindows: `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(`& ${args.map(psQuote).join(' ')}; exit $LASTEXITCODE`, 'utf16le').toString('base64')}` };
}
export function updateHooks(existing, command, install) {
  const result = structuredClone(existing); result.hooks ??= {};
  for (const [name, groups] of Object.entries(result.hooks)) {
    result.hooks[name] = groups.flatMap(group => {
      const keep = group.hooks.filter(item => !(item.type === 'command' && item.statusMessage === STATUS && item.command === command.command && item.commandWindows === command.commandWindows));
      return keep.length ? [{ ...group, hooks: keep }] : [];
    });
    if (!result.hooks[name].length) delete result.hooks[name];
  }
  if (install) for (const event of ['UserPromptSubmit', 'SessionStart', 'PostCompact']) (result.hooks[event] ??= []).push({ hooks: [{ type: 'command', ...command,
    statusMessage: STATUS, timeout: 8, ...(event === 'UserPromptSubmit' ? { additionalContextLimit: 1800 } : {}) }] });
  return result;
}
async function noLink(file) { try { if ((await lstat(file)).isSymbolicLink()) throw new Error('linked-path'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
async function main() {
  const args = process.argv.slice(2), options = {};
  while (args.length) {
    const flag = args.shift();
    if (['--apply', '--remove', '--validation'].includes(flag)) { options[flag] = true; continue; }
    if (!['--project', '--connection'].includes(flag) || !args.length || options[flag]) throw new Error('arguments'); options[flag] = args.shift();
  }
  if (!path.isAbsolute(options['--project'] ?? '') || (!options['--remove'] && !path.isAbsolute(options['--connection'] ?? ''))) throw new Error('absolute-path-required');
  const project = await realpath(options['--project']), dataDir = path.join(project, '.local', 'autopets-assistance'), file = path.join(dataDir, 'config.json');
  for (const dir of [path.join(project, '.local'), dataDir, path.join(dataDir, 'records'), file]) await noLink(dir);
  const before = await inspectProject(project), after = updateHooks(before.config, hookCommands(file), !options['--remove']);
  const changed = JSON.stringify(before.config) !== JSON.stringify(after);
  if (options['--apply']) {
    await mkdir(path.join(dataDir, 'records'), { recursive: true });
    const config = options['--remove'] ? { version: 1, enabled: false, validationMode: false, project, connection: '' }
      : { version: 1, enabled: true, validationMode: !!options['--validation'], project, connection: options['--connection'] };
    const temporary = `${file}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(config), { flag: 'wx' }); await rename(temporary, file);
    if (changed) {
      await mkdir(before.codexDir, { recursive: true });
      const current = await readFile(before.target, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (current !== before.raw) throw new Error('concurrent-hook-change');
      if (before.raw !== null) await copyFile(before.target, `${before.target}.backup-autopets-assistance-${randomUUID()}`);
      const temporary = `${before.target}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(after, null, 2)}\n`, { flag: 'wx' }); await rename(temporary, before.target);
    }
  }
  console.log(JSON.stringify({ dryRun: !options['--apply'], changed, removal: !!options['--remove'], validationMode: !!options['--validation'], trustChanged: false, productionVerified: false,
    note: '실제 연결과 전달은 별도 검증이 필요합니다. 이 도구는 신뢰 설정을 변경하지 않습니다.' }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('연결 설정을 준비하지 못했어요. 경로와 기존 훅을 확인해주세요.'); process.exitCode = 1; });
