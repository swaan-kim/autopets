#!/usr/bin/env node
// Codex hook: tell the AutoPets dog pet when a Codex chat needs the user (a question, a plan to
// confirm, an approval prompt) or when the requested work actually finished.
// Wire format: https://learn.chatgpt.com/docs/hooks (Stop, PermissionRequest, PreToolUse, PostToolUse,
// UserPromptSubmit). Verified against Codex 0.167 (Codex Desktop 26.1106).
//
// Observation only. It never blocks, approves, denies, continues or edits anything, never adds
// model context, never calls a model, and always prints `{}`. Codex runs it asynchronously.
// Text leaves this process only as a short (≤160 chars) notice summary, and only after the
// AutoPets app confirms that the chat is connected to a pet. Nothing else of the conversation is
// sent; resolution signals carry ids and hashes only. A source checkout keeps an id-only trace
// in its git-ignored `.local/`.
import path, { isAbsolute } from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isObject, validString, readConnection, requestJson, MAX_BODY } from '../skills/autopets/scripts/bridge-client.mjs';
import { classifyTurn, approvalNotice, userInputNotice, digestTurn } from '../../../packages/guidance/codex-attention.mjs';
import { isChildHook } from './scope.mjs';

export const ATTENTION_HOOK_MARKER = '--autopets-attention-v1';
const ENDPOINT = '/v1/attention';
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Approvals the user never sees: Codex routes them to its automatic reviewer instead.
const AUTOMATIC_REVIEWERS = new Set(['auto_review', 'guardian_subagent']);

export const codexHome = env => env.CODEX_HOME || path.join(os.homedir(), '.codex');

export function hookEvent(input) {
  if (!isObject(input) || isChildHook(input) || !validString(input.hook_event_name, 64)) return null;
  if (!uuid(input.session_id) || !validString(input.turn_id, 128) || /[\u0000-\u001f]/u.test(input.turn_id)) return null;
  const name = input.hook_event_name;
  if (!['UserPromptSubmit', 'Stop', 'PermissionRequest', 'PreToolUse', 'PostToolUse'].includes(name)) return null;
  return {
    name, sessionId: input.session_id, turnId: input.turn_id,
    transcriptPath: typeof input.transcript_path === 'string' ? input.transcript_path : null,
    toolName: validString(input.tool_name, 256) ? input.tool_name : null,
    toolUseId: validString(input.tool_use_id, 128) ? input.tool_use_id : null,
    toolInput: input.tool_input,
    message: typeof input.last_assistant_message === 'string' ? input.last_assistant_message : null,
    stopHookActive: input.stop_hook_active === true,
  };
}

/** The same tool call, as PermissionRequest and PostToolUse both describe it (name + command). */
export function toolKey(toolName, toolInput) {
  const command = isObject(toolInput) ? (typeof toolInput.command === 'string' ? toolInput.command : Array.isArray(toolInput.command) ? toolInput.command.join('\u0000') : '') : '';
  return sha(JSON.stringify([String(toolName ?? ''), command]));
}

/** Rollout slice of this chat's current turn. Only the chat's own transcript under CODEX_HOME is read. */
// Windows may hand over `\\?\C:\...` (verbatim) paths and any drive-letter case.
const plainPath = value => path.resolve(String(value).replace(/^\\\\\?\\(?!UNC\\)/u, ''));
const inside = (root, file) => {
  const relative = path.relative(plainPath(root), plainPath(file));
  const same = process.platform === 'win32' ? relative.toLowerCase() : relative;
  return Boolean(same) && !same.startsWith('..') && !isAbsolute(same);
};
const ownTranscript = (file, event, env) => typeof file === 'string' && isAbsolute(plainPath(file)) && path.extname(file) === '.jsonl'
  && path.basename(file).includes(event.sessionId) && inside(codexHome(env), file);

/** This chat's rollout under CODEX_HOME/sessions, newest first (used when the hook got no usable path). */
async function findTranscript(event, env) {
  const root = path.join(codexHome(env), 'sessions');
  const found = [];
  const walk = async (dir, depth) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) await walk(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(`${event.sessionId}.jsonl`)) found.push(full);
    }
  };
  await walk(root, 0);
  const stats = await Promise.all(found.map(async file => ({ file, mtime: (await fs.stat(file).catch(() => ({ mtimeMs: 0 }))).mtimeMs })));
  return stats.sort((a, b) => b.mtime - a.mtime)[0]?.file ?? null;
}

/**
 * Rollout slice of this chat's current turn. Only the chat's own transcript under CODEX_HOME is read.
 * `transcript` says how it went (a diagnostics code, never a path): given, found-by-id, no-transcript,
 * turn-not-found, unreadable.
 */
export async function readTurn(event, env = process.env) {
  let file = ownTranscript(event.transcriptPath, event, env) ? plainPath(event.transcriptPath) : null;
  let how = 'given';
  if (!file) { file = await findTranscript(event, env); how = 'found-by-id'; }
  if (!file) return { available: false, transcript: 'no-transcript' };
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const { size } = await handle.stat();
    for (const window of [2 * 1024 * 1024, 16 * 1024 * 1024]) {
      const start = Math.max(0, size - window);
      const buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.length, start);
      const lines = buffer.toString('utf8').split('\n');
      if (start > 0) lines.shift(); // partial first line
      const digest = digestTurn(lines.filter(Boolean), event.turnId);
      if (digest.available) return { ...digest, transcript: how };
      if (start === 0) break;
    }
    return { available: false, transcript: 'turn-not-found' };
  } catch { return { available: false, transcript: 'unreadable' }; }
  finally { await handle?.close().catch(() => {}); }
}

/** Codex Desktop's chat name, so two chats' notices can be told apart. Best effort. */
export async function chatTitle(sessionId, env = process.env) {
  try {
    const file = path.join(codexHome(env), 'session_index.jsonl');
    const { size } = await fs.stat(file);
    if (size > 8 * 1024 * 1024) return null;
    let title = null;
    for (const line of (await fs.readFile(file, 'utf8')).split('\n')) {
      if (!line.includes(sessionId)) continue;
      try { const entry = JSON.parse(line); if (entry.id === sessionId && typeof entry.thread_name === 'string') title = entry.thread_name; } catch { /* skip */ }
    }
    return title ? title.replace(/[\u0000-\u001f]/gu, ' ').trim().slice(0, 80) || null : null;
  } catch { return null; }
}

/**
 * What this hook event means for the pet. Returns `{ resolve?, notice? }`:
 * resolve — an id-only signal that a waiting state ended; notice — a new notice to offer.
 */
export async function interpret(event, { env = process.env, read = readTurn } = {}) {
  const base = { sessionId: event.sessionId, turnId: event.turnId };
  switch (event.name) {
    case 'UserPromptSubmit':
      // The user wrote in this chat: earlier questions are answered and finished work was seen.
      return { resolve: { ...base, cause: 'user-message' } };
    case 'PostToolUse':
      return { resolve: { ...base, cause: 'tool-finished', toolKey: toolKey(event.toolName, event.toolInput), ...(event.toolUseId ? { toolUseId: event.toolUseId } : {}) } };
    case 'PreToolUse': {
      if (event.toolName !== 'request_user_input') return {};
      const notice = userInputNotice(event.toolInput);
      return { notice: { ...base, source: 'user-input', kind: notice.kind, reason: notice.reason, summary: notice.summary, ...(event.toolUseId ? { toolUseId: event.toolUseId } : {}) } };
    }
    case 'PermissionRequest': {
      const digest = await read(event, env);
      if (digest.available && AUTOMATIC_REVIEWERS.has(digest.reviewer)) return { skipped: 'automatic-review', transcript: digest.transcript };
      const notice = approvalNotice(event.toolName, event.toolInput);
      return { transcript: digest.transcript, notice: { ...base, source: 'permission', kind: notice.kind, reason: notice.reason, summary: notice.summary, toolKey: toolKey(event.toolName, event.toolInput) } };
    }
    case 'Stop': {
      let digest = await read(event, env);
      // The rollout may be flushed a moment after the turn ends.
      if (!digest.available || (!event.message && !digest.lastMessage && !digest.plan)) { await sleep(500); digest = await read(event, env); }
      const message = event.message ?? digest.lastMessage ?? null;
      const result = classifyTurn({ message, evidence: digest, stopHookActive: event.stopHookActive });
      const resolve = { ...base, cause: 'turn-ended' };
      const diagnostics = { transcript: digest.transcript, evidence: digest.available ? `f${digest.fileChanges}/w${digest.workCommands}/t${digest.tools}/a${digest.delegated}` : null };
      if (result.kind === 'none') return { resolve, classified: result.reason, ...diagnostics };
      return { resolve, classified: result.reason, ...diagnostics, notice: { ...base, source: 'stop', kind: result.kind, reason: result.reason, summary: result.summary,
        ...(result.kind === 'completed' ? { evidence: { fileChanges: Number(digest.fileChanges) || 0, workCommands: Number(digest.workCommands) || 0, verified: result.verified === true } } : {}) } };
    }
    default: return {};
  }
}

/** Sends one interpreted event to one app. The summary is sent only for a connected chat. */
export async function deliver(outcome, request, { title = async () => null } = {}) {
  const sent = {};
  if (outcome.resolve) { const reply = await request(ENDPOINT, { operation: 'resolve', ...outcome.resolve }); sent.resolved = reply?.ok === true ? reply.resolved ?? 0 : 'refused'; }
  if (outcome.notice) {
    const check = await request(ENDPOINT, { operation: 'check', sessionId: outcome.notice.sessionId });
    if (check?.eligible !== true) return { ...sent, notice: typeof check?.reason === 'string' ? check.reason : 'not-eligible' };
    const notice = { ...outcome.notice, chatTitle: await title() };
    if (!notice.chatTitle) delete notice.chatTitle;
    notice.fingerprint = sha(JSON.stringify([notice.sessionId, notice.turnId, notice.source, notice.kind, notice.reason, notice.toolKey ?? notice.toolUseId ?? '', notice.summary]));
    const reply = await request(ENDPOINT, { operation: 'notify', ...notice });
    sent.notice = reply?.duplicate ? 'duplicate' : reply?.stale ? 'stale' : reply?.ok === true ? 'shown' : 'refused';
  }
  return sent;
}

async function readInput(stream = process.stdin) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) { size += chunk.length; if (size > MAX_BODY * 4) throw Error('input-limit'); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export const defaultConnection = env => env.AUTOPETS_CONNECTION_FILE
  || path.join(env.AUTOPETS_DATA_DIR || path.join(env.LOCALAPPDATA || '', 'local.autopets.desktop'), 'connection.json');

const TRACE_DIR = fileURLToPath(new URL('../../../.local/', import.meta.url));
async function trace(event, record, directory = TRACE_DIR) {
  try {
    await fs.access(directory);
    const file = path.join(directory, 'attention-trace.jsonl');
    if ((await fs.stat(file).catch(() => null))?.size > 256 * 1024) await fs.rm(file, { force: true });
    await fs.appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event: event?.name ?? null, tool: event?.toolName ?? null,
      session: event?.sessionId ?? null, turn: event?.turnId ?? null, ...record })}\n`);
  } catch { /* diagnostics never affect the hook */ }
}

const failure = error => error?.code === 'connection-unavailable' ? 'app-not-running'
  : typeof error?.code === 'string' && /^[a-z][a-z-]{0,40}$/u.test(error.code) ? `${error.code}${error.status ? `:${error.status}` : ''}` : 'unreachable';

export async function main(args = process.argv.slice(2), stream = process.stdin, env = process.env) {
  let event = null; const record = {};
  try {
    if (args.length !== 3 || args[0] !== '--connection' || !isAbsolute(args[1]) || args[2] !== ATTENTION_HOOK_MARKER) throw Error('arguments');
    event = hookEvent(await readInput(stream));
    if (event) {
      const outcome = await interpret(event, { env });
      if (outcome.skipped) record.skipped = outcome.skipped;
      if (outcome.classified) record.classified = outcome.classified;
      // How the transcript was found, the shape of the path Codex gave (never the path), and counts only.
      if (outcome.transcript) record.transcript = outcome.transcript;
      if (outcome.evidence) record.evidence = outcome.evidence;
      if (['Stop', 'PermissionRequest'].includes(event.name)) record.pathGiven = event.transcriptPath === null ? 'none' : /^\\\\\?\\/u.test(event.transcriptPath) ? 'verbatim' : isAbsolute(event.transcriptPath) ? 'absolute' : 'relative';
      if (outcome.notice) record.kind = `${outcome.notice.kind}:${outcome.notice.reason}`;
      if (outcome.resolve || outcome.notice) {
        let cachedTitle;
        const title = async () => (cachedTitle ??= chatTitle(event.sessionId, env));
        // Every AutoPets app the user may run: the given one (the source dev app) and the installed one.
        const connections = [...new Map([args[1], defaultConnection(env)].map(file => [path.resolve(file).toLowerCase(), file])).values()];
        const settled = await Promise.allSettled(connections.map(file => readConnection(file)
          .then(connection => deliver(outcome, (url, body) => requestJson(connection, url, body, 1500, 4096), { title }))));
        record.results = settled.map((item, index) => ({ target: `app:${path.basename(path.dirname(connections[index]))}`,
          ...(item.status === 'fulfilled' ? item.value : { error: failure(item.reason) }) }));
      }
    } else record.reason = 'ignored';
  } catch { record.reason = 'input'; /* Fail open: Codex continues unchanged. */ }
  await trace(event, record, env.AUTOPETS_ATTENTION_TRACE_DIR || TRACE_DIR);
  process.stdout.write('{}\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
