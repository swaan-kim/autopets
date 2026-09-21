#!/usr/bin/env node
// Opt-in connector, not installed by importing or building. Unverified production is inert.
import { readFile, stat, lstat, realpath, writeFile, rename, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readConnection, requestJson, validString, isObject } from '../skills/autopets/scripts/bridge-client.mjs';
import { validateContext, resolvePreferences, utf8Bytes, MAX_INJECTION_BYTES } from '../../../packages/contracts/index.mjs';
import { classifyTask, buildGuidanceMetadata } from '../../../packages/guidance/index.mjs';

const entry = fileURLToPath(import.meta.url);
const hash = text => createHash('sha256').update(text).digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export const identityFor = sessionId => ({ provider: 'codex', accountId: `session:${hash(sessionId)}`, chatId: sessionId });
async function json(file, limit = 16384) {
  if ((await stat(file)).size > limit) throw new Error('file-limit');
  const bytes = await readFile(file);
  if (bytes.length > limit) throw new Error('file-limit');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/u, ''));
}
export async function loadConfig(file) {
  if (!path.isAbsolute(file ?? '')) throw new Error('config-path');
  const config = await json(file, 4096);
  if (config.version !== 1 || typeof config.enabled !== 'boolean' || typeof config.validationMode !== 'boolean'
    || !path.isAbsolute(config.project ?? '') || !path.isAbsolute(config.connection ?? '')) throw new Error('config-shape');
  const project = await realpath(config.project), dataDir = await realpath(path.dirname(file));
  if (!samePath(dataDir, path.join(project, '.local', 'autopets-assistance')) || path.basename(file) !== 'config.json'
    || !samePath(await realpath(file), path.join(dataDir, 'config.json'))) throw new Error('config-location');
  return { ...config, project, dataDir, file: path.join(dataDir, 'config.json') };
}
function transport(config) {
  let connection;
  return async (url, body) => { connection ??= await readConnection(config.connection); return requestJson(connection, url, body, 1400, 16384); };
}
function assistance(request, operation, identity, binding, extra = {}) {
  return request('/v1/assistance', { operation, identity, binding, ...extra });
}
async function restoreKey(config, sessionId, reset = false) {
  const file = path.join(config.dataDir, `restore-${hash(sessionId)}.json`);
  if (reset) {
    const token = randomUUID(), temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ token }), { flag: 'wx' }); await rename(temp, file); return token;
  }
  try { const state = await json(file, 256); return validString(state.token, 64) ? state.token : ''; }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}
function helperText(config) {
  const args = JSON.stringify([entry, 'inspect', '--config', config.file]);
  return `\n목표·조건·결정·남은 일이 의미 있게 바뀔 때만 현재 실행에서 기록하세요. 별도 요약 모델을 호출하지 마세요. Node 인수 ${args}로 현재 채팅 개정번호를 읽고, {expectedRevision,context:{goal,outputFormat,constraints:[],decisions:[],remaining:[]}} JSON을 .local/autopets-assistance/records/ 안에 작성한 뒤 같은 스크립트의 record --config <위 설정 경로> --record <JSON 절대 경로>를 실행하세요. 3KB 이하 기록만 허용하며 현재 모드에서 파일·도구 쓰기가 금지되면 생략하세요. 실패해도 원래 요청을 계속하세요.`;
}

// Consume only one regular, unlinked temporary record. Never follow links or
// remove a replacement file if another writer changed the path while syncing.
async function consumeRecord(config, recordPath, consume) {
  const records = path.join(config.dataDir, 'records'), resolved = await realpath(recordPath);
  if (!samePath(path.resolve(recordPath), resolved) || !samePath(path.dirname(resolved), records)
    || !samePath(await realpath(records), records)) throw new Error('record-location');
  const initial = await lstat(resolved);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1) throw new Error('record-file');
  const handle = await open(resolved, 'r');
  const sameFile = value => value.isFile() && !value.isSymbolicLink() && value.dev === initial.dev && value.ino === initial.ino;
  try {
    const opened = await handle.stat();
    if (!sameFile(opened)) throw new Error('record-changed');
    if (opened.size > 4096) throw new Error('file-limit');
    const bytes = await handle.readFile();
    if (bytes.length > 4096) throw new Error('file-limit');
    return await consume(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/u, '')));
  } finally {
    await handle.close();
    try {
      if (samePath(await realpath(records), records) && sameFile(await lstat(resolved))) await unlink(resolved);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export async function prepare(config, input, request = transport(config)) {
  if (!config.enabled || !isObject(input) || !validString(input.session_id) || !validString(input.cwd, 32768)
    || !['UserPromptSubmit', 'SessionStart', 'PostCompact'].includes(input.hook_event_name)
    || !samePath(await realpath(input.cwd), config.project)) return { output: {} };
  if (input.hook_event_name !== 'UserPromptSubmit') { await restoreKey(config, input.session_id, true); return { output: {} }; }
  if (!validString(input.turn_id) || typeof input.prompt !== 'string' || utf8Bytes(input.prompt) > 128 * 1024) return { output: {} };
  const identity = identityFor(input.session_id), binding = { sessionId: input.session_id, turnId: input.turn_id, cwd: input.cwd };
  await request('/v1/events', { eventId: randomUUID(), kind: 'turn_started', ...binding, timestamp: Date.now() });
  const data = await assistance(request, 'read', identity, binding);
  const capability = data.capabilities?.codex ?? data.capabilities;
  if (!data.preferences?.enabled || !data.task?.enabled || (!config.validationMode && capability?.inputAssistance !== true)) return { output: {} };
  const recipe = classifyTask(input.prompt);
  const preferences = resolvePreferences({ preferences: data.preferences, task: data.task });
  const settingsRevision = data.task.settingsRevision ?? 0;
  const helper = helperText(config);
  const guidance = buildGuidanceMetadata({ recipe, preferences, context: data.task.context, reserveBytes: utf8Bytes(helper) });
  const additionalContext = guidance.text + helper;
  if (utf8Bytes(additionalContext) > MAX_INJECTION_BYTES) throw new Error('injection-limit');
  // Hash prompt only on explicit revision requests; never persist or transmit raw prompt.
  const change = /(조건.*(바꿔|변경|수정)|대신|앞으로는|이제부터|아까.*(취소|변경)|목표.*(변경|수정))/u.test(input.prompt) ? hash(input.prompt) : '';
  const effectiveSettings = JSON.stringify({ preferences, settingsRevision, contextRevision: data.task.revision });
  const guidanceHash = hash(`${additionalContext}\0${effectiveSettings}\0${await restoreKey(config, input.session_id)}\0${change}`);
  const prepared = await assistance(request, 'prepare', identity, binding, { expectedRevision: data.task.revision, preferencesRevision: data.preferences.revision,
    settingsRevision, contextPartial: guidance.contextPartial, includedContextKeys: guidance.includedContextKeys,
    recipeId: recipe.id, requestedModel: null, reason: config.validationMode ? '연결 검증용 지침 준비 · 실제 모델 유지' : '요청에 필요한 짧은 작업 지침 준비', injectionBytes: utf8Bytes(additionalContext), guidanceHash });
  if (prepared.duplicate) return { output: {} };
  if (!validString(prepared.nonce)) throw new Error('receipt-missing');
  return { output: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }, receipt: { identity, binding, nonce: prepared.nonce } };
}

export async function record(config, operation, recordPath, sessionId = process.env.CODEX_THREAD_ID, cwd = process.cwd(), request = transport(config)) {
  if (!config.enabled || !validString(sessionId) || !samePath(await realpath(cwd), config.project)) throw new Error('record-identity');
  const observed = await request(`/v1/task-context?sessionId=${encodeURIComponent(sessionId)}&cwd=${encodeURIComponent(cwd)}`);
  if (observed.sessionId !== sessionId || !validString(observed.turnId) || !samePath(await realpath(observed.cwd), config.project)) throw new Error('record-turn');
  const identity = identityFor(sessionId), binding = { sessionId, turnId: observed.turnId, cwd };
  const data = await assistance(request, 'read', identity, binding);
  const capability = data.capabilities?.codex ?? data.capabilities;
  if (!data.preferences.enabled || !data.task.enabled || (!config.validationMode && capability?.contextSync !== true)) throw new Error('record-disabled');
  if (operation === 'inspect') return { revision: data.task.revision, context: data.task.context, deliveryVerified: false };
  if (operation !== 'record' || !path.isAbsolute(recordPath ?? '')) throw new Error('record-path');
  return consumeRecord(config, recordPath, async value => {
    if (!isObject(value) || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 || Object.keys(value).some(key => !['expectedRevision', 'context'].includes(key))) throw new Error('record-shape');
    const context = validateContext(value.context);
    const saved = await assistance(request, 'sync', identity, binding, { expectedRevision: value.expectedRevision, context });
    return { ok: saved.ok === true, contextSaved: saved.ok === true, revision: saved.task?.revision, deliveryVerified: false };
  });
}

async function readInput() {
  const chunks = []; let size = 0;
  const timer = setTimeout(() => process.stdin.destroy(new Error('input-timeout')), 1500);
  try { for await (const chunk of process.stdin) { size += chunk.length; if (size > 256 * 1024) throw new Error('input-limit'); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  finally { clearTimeout(timer); }
}
async function main() {
  const [operation, ...args] = process.argv.slice(2), options = {};
  try {
    while (args.length) { const flag = args.shift(); if (!['--config', '--record'].includes(flag) || !args.length || options[flag]) throw new Error('arguments'); options[flag] = args.shift(); }
    const config = await loadConfig(options['--config']);
    if (operation === 'hook') {
      const request = transport(config), result = await prepare(config, await readInput(), request);
      await new Promise(resolve => process.stdout.write(`${JSON.stringify(result.output)}\n`, resolve));
      if (result.receipt) { try { const { identity, binding, nonce } = result.receipt; await assistance(request, 'delivered', identity, binding, { nonce, evidence: 'sent' }); } catch { /* sent to stdout is not model-confirmed */ } }
    } else console.log(JSON.stringify(await record(config, operation, options['--record'])));
  } catch {
    if (operation === 'hook') process.stdout.write('{}\n');
    else { console.log(JSON.stringify({ ok: false, contextSaved: false, reason: '기록을 확인하지 못했어요. 원래 작업은 계속하세요.' })); process.exitCode = 1; }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === entry) await main();
