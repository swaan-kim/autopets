#!/usr/bin/env node
// Codex UserPromptSubmit hook: recommend an EXISTING AutoPets pet for the message the user
// just sent. Wire format: https://learn.chatgpt.com/docs/hooks#userpromptsubmit
//
// Observation only. It never blocks, edits or re-sends the submission, never adds model
// context, never calls a model, and always prints `{}`. The request text leaves this
// process only when the AutoPets app confirms the chat is connected to a pet AND the
// local classifier found a fitting pet. The message text is never logged (a source checkout
// keeps an id-only trace in its git-ignored `.local/`).
import path, { isAbsolute } from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isObject, validString, readConnection, requestJson, MAX_BODY } from '../skills/autopets/scripts/bridge-client.mjs';
import { recommendPets } from '../../../packages/guidance/pet-recommendation.mjs';
import { isChildHook } from './scope.mjs';

export const RECOMMEND_HOOK_MARKER = '--autopets-recommend-v1';
const execFileAsync = promisify(execFile);
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(value);

export function hookIdentity(input) {
  if (!isObject(input) || isChildHook(input) || input.hook_event_name !== 'UserPromptSubmit') return null;
  if (!uuid(input.session_id) || !validString(input.turn_id, 128) || !validString(input.cwd, 4096) || !isAbsolute(input.cwd)
    || typeof input.prompt !== 'string') return null;
  return { sessionId: input.session_id, turnId: input.turn_id, cwd: input.cwd, prompt: input.prompt };
}

/** One recommendation cycle for one submitted turn. `request(path, body)` talks to the app bridge. */
export async function recommendForTurn(identity, request) {
  const begin = await request('/v1/recommendations', { operation: 'begin', sessionId: identity.sessionId, turnId: identity.turnId, cwd: identity.cwd, source: 'hook' });
  if (begin?.eligible !== true) return { sent: false, reason: typeof begin?.reason === 'string' ? begin.reason : 'not-eligible' };
  const exclude = Array.isArray(begin.activePetIds) ? begin.activePetIds.filter(id => typeof id === 'string') : [];
  const result = recommendPets(identity.prompt, { exclude });
  if (result.status !== 'match') {
    await request('/v1/recommendations', { operation: 'clear', sessionId: identity.sessionId, turnId: identity.turnId });
    return { sent: false, reason: result.reason };
  }
  const fingerprint = createHash('sha256').update(result.request).digest('hex');
  const offered = await request('/v1/recommendations', { operation: 'offer', sessionId: identity.sessionId, turnId: identity.turnId,
    request: result.request, requestTruncated: result.requestTruncated, fingerprint, candidates: result.candidates });
  return { sent: offered?.ok === true, reason: offered?.duplicate === true ? 'duplicate' : result.reason, candidates: result.candidates.map(item => item.petId) };
}

const petStateDir = env => env.AUTOPET_PREVIEW_STATE_DIR || path.join(env.LOCALAPPDATA || '', 'local.autopets.petpreview');
export const defaultPetExe = env => path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills', 'autopet', 'bin', 'autopet-preview.exe');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

/**
 * The AutoPets pet started with `$autopet` belongs to the chat that invoked it (`ownerThread`).
 * Only for that chat is the message classified and handed to the pet; any other chat makes
 * no process and sends nothing.
 */
export async function recommendForPet(identity, { env = process.env, petExe = defaultPetExe(env), run = execFileAsync } = {}) {
  let state;
  try { state = JSON.parse(await fs.readFile(path.join(petStateDir(env), 'handoff', 'state.json'), 'utf8')); }
  catch { return { sent: false, reason: 'no-pet' }; }
  if (!isObject(state) || state.ownerThread !== identity.sessionId) return { sent: false, reason: 'not-pet-chat' };
  if (!Number.isInteger(state.petPid) || !alive(state.petPid)) return { sent: false, reason: 'pet-closed' };
  const result = recommendPets(identity.prompt);
  if (result.status !== 'match') return { sent: false, reason: result.reason };
  const file = path.join(os.tmpdir(), `autopets-recommend-${randomUUID()}.json`);
  try {
    await fs.writeFile(file, JSON.stringify({ request: result.request, requestTruncated: result.requestTruncated,
      fingerprint: createHash('sha256').update(result.request).digest('hex'), candidates: result.candidates }), { flag: 'wx' });
    const { stdout } = await run(petExe, ['recommend', '--chat', identity.sessionId, '--turn', identity.turnId, '--file', file], { timeout: 4500, windowsHide: true, env });
    const reply = JSON.parse(String(stdout).trim().split('\n').pop() || '{}');
    return { sent: reply.ok === true && reply.state === 'shown', reason: reply.state ?? 'pet-refused', candidates: result.candidates.map(item => item.petId) };
  } catch { return { sent: false, reason: 'pet-unavailable' }; }
  finally { await fs.rm(file, { force: true }).catch(() => {}); }
}

async function readInput(stream = process.stdin) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) { size += chunk.length; if (size > MAX_BODY) throw Error('input-limit'); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** The app the user runs (`$autopets` starts it) keeps its bridge here, like start.mjs and user-hook.mjs. */
export const defaultConnection = env => env.AUTOPETS_CONNECTION_FILE
  || path.join(env.AUTOPETS_DATA_DIR || path.join(env.LOCALAPPDATA || '', 'local.autopets.desktop'), 'connection.json');

// Source checkouts only (the git-ignored `.local/` next to this repo): ids and reason codes,
// never the message text. Installed copies have no `.local/` and write nothing.
const TRACE_DIR = fileURLToPath(new URL('../../../.local/', import.meta.url));
async function trace(identity, results, directory = TRACE_DIR) {
  try {
    await fs.access(directory);
    const file = path.join(directory, 'recommend-trace.jsonl');
    if ((await fs.stat(file).catch(() => null))?.size > 256 * 1024) await fs.rm(file, { force: true });
    await fs.appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, session: identity?.sessionId ?? null, turn: identity?.turnId ?? null,
      promptChars: identity?.prompt.length ?? null, results })}\n`);
  } catch { /* diagnostics never affect the hook */ }
}

// Bridge errors carry short codes (e.g. a missing connection file, a closed app's port, a 404 from an
// older app without recommendations); anything else is reported without its message.
const failure = error => error?.code === 'connection-unavailable' ? 'app-not-running'
  : typeof error?.code === 'string' && /^[a-z][a-z-]{0,40}$/u.test(error.code) ? `${error.code}${error.status ? `:${error.status}` : ''}` : 'unreachable';

export async function main(args = process.argv.slice(2), stream = process.stdin, env = process.env) {
  let identity = null; const results = [];
  try {
    if (args.length !== 3 || args[0] !== '--connection' || !isAbsolute(args[1]) || args[2] !== RECOMMEND_HOOK_MARKER) throw Error('arguments');
    identity = hookIdentity(await readInput(stream));
    if (identity) {
      // Every AutoPets surface, independently: the given app, the user's app (when different)
      // and the `$autopet` pet. Each one decides itself whether this chat is connected to it.
      // A closed app or pet is a no-op: hooks never launch AutoPets or the pet.
      const connections = [...new Map([args[1], defaultConnection(env)].map(file => [path.resolve(file).toLowerCase(), file])).values()];
      const settled = await Promise.allSettled([
        ...connections.map(file => readConnection(file).then(connection => recommendForTurn(identity, (url, body) => requestJson(connection, url, body, 1500, 4096)))),
        recommendForPet(identity, { env }),
      ]);
      const names = [...connections.map(file => `app:${path.basename(path.dirname(file))}`), 'pet'];
      settled.forEach((item, index) => results.push({ target: names[index], ...(item.status === 'fulfilled'
        ? { sent: item.value.sent, reason: item.value.reason, candidates: item.value.candidates }
        : { sent: false, reason: failure(item.reason) }) }));
    } else results.push({ reason: 'not-a-user-prompt' });
  } catch { results.push({ reason: 'input' }); /* Fail open: the user's message is always submitted unchanged. */ }
  await trace(identity, results, env.AUTOPETS_RECOMMEND_TRACE_DIR || TRACE_DIR);
  process.stdout.write('{}\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
