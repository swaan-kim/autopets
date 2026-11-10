// Adds or removes ONLY the AutoPets pet-recommendation hook in the user's Codex hooks.json.
// Other hooks (including other AutoPets hooks) are preserved byte-for-byte in meaning,
// the previous file is backed up, and Codex's own hook review/trust is left to the user.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { atomicJson, safeDirectory } from './files.mjs';

export const RECOMMEND_STATUS = 'AutoPets recommend v1';
export const RECOMMEND_MARKER = '--autopets-recommend-v1';
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function recommendationHandler(node, script, connection) {
  for (const value of [node, script, connection]) if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('absolute-path-required');
  const args = [node, script, '--connection', connection, RECOMMEND_MARKER];
  return {
    type: 'command', command: args.map(shellQuote).join(' '),
    commandWindows: `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(`& ${args.map(psQuote).join(' ')}; exit $LASTEXITCODE`, 'utf16le').toString('base64')}`,
    // Observation only: Codex does not wait for it before running the turn.
    statusMessage: RECOMMEND_STATUS, timeout: 5, async: true,
  };
}

const ours = hook => object(hook) && hook.statusMessage === RECOMMEND_STATUS;

export function mergeRecommendationHook(config, handler) {
  if (!object(config) || (config.hooks !== undefined && !object(config.hooks))) throw Error('hooks-format');
  const next = structuredClone(config); next.hooks ??= {};
  for (const [event, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups) || groups.some(group => !object(group) || !Array.isArray(group.hooks))) throw Error('hooks-format');
    next.hooks[event] = groups.flatMap(group => { const keep = group.hooks.filter(hook => !ours(hook)); return keep.length ? [{ ...group, hooks: keep }] : []; });
    if (!next.hooks[event].length) delete next.hooks[event];
  }
  if (handler) (next.hooks.UserPromptSubmit ??= []).push({ hooks: [handler] });
  return next;
}

export function recommendationHookState(config) {
  const found = object(config?.hooks) ? Object.entries(config.hooks).flatMap(([event, groups]) => Array.isArray(groups)
    ? groups.flatMap(group => (Array.isArray(group?.hooks) ? group.hooks : []).filter(ours).map(hook => ({ event, hook }))) : []) : [];
  return { installed: found.some(item => item.event === 'UserPromptSubmit'), count: found.length };
}

export const codexHome = (env = process.env) => env.CODEX_HOME || path.join(os.homedir(), '.codex');

/** enable=true installs/refreshes the single handler; enable=false removes it. */
export async function configureRecommendationHook({ enable, node, script, connection, env = process.env, now = Date.now } = {}) {
  const home = codexHome(env);
  if (!path.isAbsolute(home)) throw Error('codex-path');
  await safeDirectory(home);
  const target = path.join(home, 'hooks.json');
  let raw = null;
  try { if ((await fs.lstat(target)).isSymbolicLink()) throw Error('hooks-link'); raw = await fs.readFile(target, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const current = raw === null ? {} : JSON.parse(raw.replace(/^﻿/u, ''));
  const next = mergeRecommendationHook(current, enable ? recommendationHandler(node, script, connection) : null);
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  let backup = null;
  if (changed) {
    // Refuse to overwrite a concurrent edit by Codex or the user.
    if (await fs.readFile(target, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; }) !== raw) throw Error('hooks-changed');
    if (raw !== null) { backup = `${target}.autopets-recommend-${now()}.backup`; await fs.writeFile(backup, raw, { flag: 'wx' }); }
    await atomicJson(target, next);
  }
  return { hooksFile: target, changed, backup, ...recommendationHookState(next), trustReviewedByUser: false };
}
