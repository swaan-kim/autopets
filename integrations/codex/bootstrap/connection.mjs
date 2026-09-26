import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { atomicJson, readJson, safeDirectory, digest } from './files.mjs';

export const HOOK_MARKER = '--autopets-user-v1';
const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd', 'PermissionRequest', 'PostCompact'];
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
export function handlers(node, runner) {
  return Object.fromEntries(events.map(event => {
    const roles = ['UserPromptSubmit', 'SessionStart', 'PostCompact'].includes(event) ? ['observe', 'prepare'] : ['observe'];
    return [event, roles.map(role => {
      const args = [node, runner, role, HOOK_MARKER];
      return { type: 'command', command: args.map(value => `'${value.replaceAll("'", "'\\''")}'`).join(' '),
        commandWindows: `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(`& ${args.map(psQuote).join(' ')}; exit $LASTEXITCODE`, 'utf16le').toString('base64')}`,
        statusMessage: `AutoPets ${role} v1`, timeout: ['Interrupt', 'SessionEnd'].includes(event) ? 3 : 8,
        ...(role === 'observe' && !['Stop', 'SessionEnd', 'PermissionRequest'].includes(event) ? { async: true } : {}),
        ...(role === 'prepare' && event === 'UserPromptSubmit' ? { additionalContextLimit: 3072 } : {}) };
    })];
  }));
}
export function mergeHooks(config, desired, owned = [], remove = false) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || (config.hooks !== undefined && (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)))) throw Error('hooks-format');
  const next = structuredClone(config); next.hooks ??= {};
  const identity = h => digest(JSON.stringify([h.command, h.commandWindows, h.statusMessage]));
  const wanted = Object.values(desired).flat().map(identity);
  const known = new Set([...owned, ...wanted]);
  for (const [event, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups) || groups.some(g => !g || !Array.isArray(g.hooks))) throw Error('hooks-format');
    next.hooks[event] = groups.flatMap(group => {
      const keep = group.hooks.filter(h => !known.has(identity(h)));
      return keep.length ? [{ ...group, hooks: keep }] : [];
    });
    if (!next.hooks[event].length) delete next.hooks[event];
  }
  if (!remove) for (const [event, items] of Object.entries(desired)) (next.hooks[event] ??= []).push({ hooks: items });
  return { config: next, ids: remove ? [] : wanted };
}
export async function configureConnection(root, manifest, { remove = false, env = process.env } = {}) {
  const codex = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  if (!path.isAbsolute(codex)) throw Error('codex-path');
  await safeDirectory(codex);
  const target = path.join(codex, 'hooks.json');
  let raw = null;
  try { if ((await fs.lstat(target)).isSymbolicLink()) throw Error('hooks-link'); raw = await fs.readFile(target, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const desired = handlers(path.join(root, 'connector/runtime/node.exe'), path.join(root, 'connector/integrations/codex/bootstrap/user-hook.mjs'));
  const merged = mergeHooks(raw === null ? {} : JSON.parse(raw.replace(/^\uFEFF/u, '')), desired, manifest.hookIds, remove);
  const text = JSON.stringify(merged.config, null, 2);
  if (raw === null || JSON.stringify(JSON.parse(raw.replace(/^\uFEFF/u, ''))) !== JSON.stringify(merged.config)) {
    if (await fs.readFile(target, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; }) !== raw) throw Error('hooks-changed');
    if (raw !== null) await fs.writeFile(`${target}.autopets-${Date.now()}.backup`, raw, { flag: 'wx' });
    await atomicJson(target, merged.config);
  }
  await atomicJson(path.join(root, 'state/connection-settings.json'), { version: 1, enabled: !remove, codexHome: codex });
  return merged.ids;
}
