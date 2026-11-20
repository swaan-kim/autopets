// Adds or removes ONLY the AutoPets attention hooks ("AutoPets attention v1") in the user's Codex
// hooks.json. Every other hook — including the recommendation hook and project hooks — is kept as
// it is, the previous file is backed up, and Codex's own review/trust of new hooks is left to the user.
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, safeDirectory } from './files.mjs';
import { codexHome } from './recommendation-hook.mjs';

export const ATTENTION_STATUS = 'AutoPets attention v1';
export const ATTENTION_MARKER = '--autopets-attention-v1';
// Event → matcher. Every handler is async: Codex never waits for it and its output is ignored.
export const ATTENTION_EVENTS = Object.freeze({
  Stop: null,                                // the turn ended: question, plan to confirm, or finished work
  PermissionRequest: null,                   // Codex is about to show an approval prompt
  PreToolUse: '^request_user_input$',        // Codex shows questions (Plan mode) and waits
  PostToolUse: null,                         // the approved tool / the answered question finished
  UserPromptSubmit: null,                    // the user wrote in the chat: earlier asks are answered
});
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function attentionHandler(node, script, connection) {
  for (const value of [node, script, connection]) if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('absolute-path-required');
  const args = [node, script, '--connection', connection, ATTENTION_MARKER];
  return {
    type: 'command', command: args.map(shellQuote).join(' '),
    commandWindows: `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(`& ${args.map(psQuote).join(' ')}; exit $LASTEXITCODE`, 'utf16le').toString('base64')}`,
    statusMessage: ATTENTION_STATUS, timeout: 10, async: true,
  };
}

const ours = hook => object(hook) && hook.statusMessage === ATTENTION_STATUS;

export function mergeAttentionHooks(config, handler) {
  if (!object(config) || (config.hooks !== undefined && !object(config.hooks))) throw Error('hooks-format');
  const next = structuredClone(config); next.hooks ??= {};
  for (const [event, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups) || groups.some(group => !object(group) || !Array.isArray(group.hooks))) throw Error('hooks-format');
    next.hooks[event] = groups.flatMap(group => { const keep = group.hooks.filter(hook => !ours(hook)); return keep.length ? [{ ...group, hooks: keep }] : []; });
    if (!next.hooks[event].length) delete next.hooks[event];
  }
  if (handler) for (const [event, matcher] of Object.entries(ATTENTION_EVENTS)) {
    (next.hooks[event] ??= []).push({ ...(matcher ? { matcher } : {}), hooks: [handler] });
  }
  return next;
}

export function attentionHookState(config) {
  const found = object(config?.hooks) ? Object.entries(config.hooks).flatMap(([event, groups]) => Array.isArray(groups)
    ? groups.flatMap(group => (Array.isArray(group?.hooks) ? group.hooks : []).filter(ours).map(() => event)) : []) : [];
  return { installed: Object.keys(ATTENTION_EVENTS).every(event => found.includes(event)), events: [...new Set(found)], count: found.length };
}

/** enable=true installs/refreshes the handlers; enable=false removes them. */
export async function configureAttentionHook({ enable, node, script, connection, env = process.env, now = Date.now } = {}) {
  const home = codexHome(env);
  if (!path.isAbsolute(home)) throw Error('codex-path');
  await safeDirectory(home);
  const target = path.join(home, 'hooks.json');
  let raw = null;
  try { if ((await fs.lstat(target)).isSymbolicLink()) throw Error('hooks-link'); raw = await fs.readFile(target, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const current = raw === null ? {} : JSON.parse(raw.replace(/^﻿/u, ''));
  const next = mergeAttentionHooks(current, enable ? attentionHandler(node, script, connection) : null);
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  let backup = null;
  if (changed) {
    // Refuse to overwrite a concurrent edit by Codex or the user.
    if (await fs.readFile(target, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; }) !== raw) throw Error('hooks-changed');
    if (raw !== null) { backup = `${target}.autopets-attention-${now()}.backup`; await fs.writeFile(backup, raw, { flag: 'wx' }); }
    await atomicJson(target, next);
  }
  return { hooksFile: target, changed, backup, ...attentionHookState(next), trustReviewedByUser: false };
}
