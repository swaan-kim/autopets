#!/usr/bin/env node
// Explicit current-chat artifact actions only. This helper never installs hooks or generates images.
import { lstat, open, realpath, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeError, isObject, validString, readConnection, requestJson } from '../skills/autopets/scripts/bridge-client.mjs';
import { loadConfig } from './prepare.mjs';
import { identityFor } from './workflow.mjs';
import { INTRO_LIMITS, validateArtifactRequest, validateIntroBrief, validateIntroStyle } from '../../../packages/contracts/artifacts.mjs';
import { validateIdentity } from '../../../packages/contracts/identity.mjs';
import { buildIntroPrompt } from '../../../packages/guidance/intro.mjs';

export const MAX_PNG_BYTES = INTRO_LIMITS.pngBytes;
export const MAX_ARTIFACT_BODY = INTRO_LIMITS.requestBytes;
export const MAX_ARTIFACT_RESPONSE = INTRO_LIMITS.responseBytes;
export const MAX_CLI_OUTPUT_BYTES = 64 * 1024;
const entry = fileURLToPath(import.meta.url);
const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
const sameIdentity = (left, right) => isObject(left) && ['provider', 'accountId', 'chatId'].every(key => left[key] === right[key]);

function argumentsFor(args) {
  const operation = args.shift();
  const specific = { inspect: [], prepare: ['brief'], publishPNG: ['png', 'manifest'], revise: ['revision'] }[operation];
  if (!specific) throw new BridgeError('arguments');
  const options = { operation };
  const allowed = new Set(['config', 'connection', 'cwd', 'chat', 'turn', ...specific, ...(operation === 'inspect' ? ['out'] : [])]);
  while (args.length) {
    const flag = args.shift(), key = flag?.startsWith('--') ? flag.slice(2) : '';
    if (!allowed.has(key) || options[key] !== undefined || !args.length) throw new BridgeError('arguments');
    options[key] = args.shift();
  }
  if (Boolean(options.config) === Boolean(options.connection) || specific.some(key => !options[key])) throw new BridgeError('arguments');
  for (const key of ['config', 'connection', 'cwd', 'out', ...specific]) {
    if (options[key] !== undefined && !path.isAbsolute(options[key])) throw new BridgeError('file-path');
  }
  return options;
}

async function savePacket(file, value) {
  const parent = path.dirname(file);
  if (!samePath(path.resolve(parent), await realpath(parent))) throw new BridgeError('file-type');
  const temporary = path.join(parent, `.autopets-packet-${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await open(temporary, 'wx', 0o600); created = true;
    try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    if (!samePath(path.resolve(parent), await realpath(parent))) throw new BridgeError('file-type');
    // A hard-link publishes the complete file atomically and fails if the destination
    // already exists (including symlinks). rename would overwrite on some platforms.
    await link(temporary, file);
    return file;
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError(error.code === 'EEXIST' ? 'output-exists' : 'output-failed');
  } finally { if (created) await unlink(temporary); }
}

const boundedText = (value, limit) => typeof value === 'string' ? [...value].slice(0, limit).join('') : '';
const numberOrNull = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const reviewStatus = value => ['pending', 'pass', 'fail'].includes(value) ? value : 'pending';
function styleSummary(style) {
  validateIntroStyle(style);
  return { palette: style.palette, copyLength: style.copyLength, layout: style.layout, hasLogo: style.logoDataUrl !== null };
}

/** CLI output is a bounded view; the programmatic API retains its full native packet. */
export function summarizeArtifact(result) {
  if (!result.ok) return { ok: false, code: boundedText(result.code, 80), message: boundedText(result.message, 300), deliveryVerified: false };
  const raw = result.project;
  let project = null;
  if (raw !== null) {
    validateIntroBrief(raw.brief);
    const { audience, message, points, sourceText, sourceLabel } = raw.brief;
    project = { identity: validateIdentity(raw.identity), revision: raw.revision, templateId: boundedText(raw.templateId, 30),
      brief: { audience, message, points, sourceText, sourceLabel }, style: styleSummary(raw.style),
      versions: (Array.isArray(raw.versions) ? raw.versions : []).slice(0, 20).map(version => ({
        id: boundedText(version.id, 128), createdAt: numberOrNull(version.createdAt), width: numberOrNull(version.width), height: numberOrNull(version.height),
        review: { readability: reviewStatus(version.review?.readability), layout: reviewStatus(version.review?.layout), fidelity: reviewStatus(version.review?.fidelity) },
        acceptedAt: numberOrNull(version.acceptedAt), revisionBaseVersionId: version.revisionRequest ? boundedText(version.revisionRequest.baseVersionId, 128) : null,
      })),
      pendingRevision: raw.pendingRevision ? { kind: boundedText(raw.pendingRevision.kind, 20), instruction: boundedText(raw.pendingRevision.instruction, 500), baseVersionId: boundedText(raw.pendingRevision.baseVersionId, 128) } : null,
      favorite: raw.favorite === true, updatedAt: numberOrNull(raw.updatedAt) };
  }
  const summary = { ok: true, operation: result.operation, project,
    styles: result.styles.slice(0, 20).map(saved => ({ id: boundedText(saved.id, 128), name: boundedText(saved.name, 60),
      templateId: boundedText(saved.templateId, 30), style: styleSummary(saved.style), updatedAt: numberOrNull(saved.updatedAt) })),
    ...(result.guidance ? { guidance: boundedText(result.guidance, INTRO_LIMITS.promptBytes) } : {}),
    ...(result.packetPath ? { packetPath: result.packetPath } : {}),
    summaryOnly: true, deliveryVerified: false };
  if (Buffer.byteLength(JSON.stringify(summary)) + 1 > MAX_CLI_OUTPUT_BYTES) {
    // Unusually large paths or metadata must not flood the conversation. The full
    // packet stays available via --out; explicitly disclose omitted source text.
    if (summary.project) summary.project.brief = { ...summary.project.brief, sourceText: '', sourceTextOmitted: true };
    if (Buffer.byteLength(JSON.stringify(summary)) + 1 > MAX_CLI_OUTPUT_BYTES) throw new BridgeError('output-size');
  }
  return summary;
}

async function regularBytes(file, limit) {
  if (!path.isAbsolute(file ?? '')) throw new BridgeError('file-path');
  const initial = await lstat(file);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1
    || !samePath(path.resolve(file), await realpath(file))) throw new BridgeError('file-type');
  if (initial.size > limit) throw new BridgeError('file-size');
  const handle = await open(file, 'r');
  const unchanged = stat => stat.isFile() && stat.dev === initial.dev && stat.ino === initial.ino
    && stat.size === initial.size && stat.mtimeMs === initial.mtimeMs;
  try {
    if (!unchanged(await handle.stat())) throw new BridgeError('file-changed');
    const bytes = await handle.readFile();
    if (bytes.length > limit) throw new BridgeError('file-size');
    if (!unchanged(await handle.stat()) || !unchanged(await lstat(file))) throw new BridgeError('file-changed');
    return bytes;
  } finally { await handle.close(); }
}

async function jsonFile(file, keys) {
  let value;
  try { value = JSON.parse((await regularBytes(file, 1024 * 1024)).toString('utf8').replace(/^\uFEFF/u, '')); }
  catch (error) { if (error instanceof BridgeError) throw error; throw new BridgeError('file-format'); }
  if (!isObject(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => value[key] === undefined)) throw new BridgeError('file-format');
  return value;
}

function pngHeader(bytes) {
  // The server performs full PNG decoding. Reject wrong/truncated containers before uploading.
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR'
    || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND'
    || bytes.readUInt32BE(bytes.length - 12) !== 0) throw new BridgeError('png-format');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16777216) throw new BridgeError('png-size');
}

export async function artifactRequest(connection, body, timeoutMs = 5000) {
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded) > MAX_ARTIFACT_BODY) throw new BridgeError('request-size');
  let response;
  try {
    response = await fetch(`${connection.baseUrl}/v1/artifacts`, {
      method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      body: encoded, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { throw new BridgeError('artifact-unconfirmed'); }
  if (!response.ok) { await response.body?.cancel(); throw new BridgeError('bridge-rejected', response.status); }
  const reader = response.body?.getReader();
  if (!reader) throw new BridgeError('response-format');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ARTIFACT_RESPONSE) { await reader.cancel(); throw new BridgeError('response-size'); }
      chunks.push(value);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!isObject(result)) throw new BridgeError('response-format');
    return result;
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError('artifact-unconfirmed');
  } finally { reader.releaseLock(); }
}

function scopedResult(result, identity, mutation) {
  if (!isObject(result) || !Object.hasOwn(result, 'project') || !Array.isArray(result.styles)
    || (mutation && result.project === null)
    || (result.project !== null && (!sameIdentity(result.project.identity, identity)
      || !Number.isSafeInteger(result.project.revision) || result.project.revision < 0))) throw new BridgeError('wrong-task');
  // Do not propagate unknown server fields or snapshots from other chats.
  return { project: result.project, styles: result.styles };
}

function userError(error) {
  const status = error instanceof BridgeError ? error.status : null;
  if (status === 401) return { code: 'authentication-failed', message: 'AutoPets 앱의 현재 연결 파일을 확인해주세요.' };
  if (status === 403 || status === 404) return { code: 'task-not-observed', message: '현재 채팅과 진행 중인 턴의 연결을 확인하지 못했습니다.' };
  if (status === 409) return { code: 'revision-conflict', message: '자료가 바뀌었습니다. inspect로 현재 버전을 확인한 뒤 요청을 다시 검토해주세요.' };
  const code = error instanceof BridgeError ? error.code : 'artifact-invalid';
  const messages = {
    arguments: 'inspect, prepare --brief, publishPNG --png --manifest, revise --revision과 --config 또는 --connection을 사용해주세요.',
    'current-task-unavailable': '현재 채팅 ID와 관측된 턴이 필요합니다. 다른 채팅으로 대신 연결하지 않았습니다.',
    'wrong-task': '현재 채팅 또는 작업 경로가 연결 정보와 다릅니다.',
    'config-disabled': '현재 채팅의 AutoPets 연결 설정이 꺼져 있습니다.',
    'file-path': '입력 파일과 연결 파일에는 절대 경로가 필요합니다.',
    'file-format': '명시된 JSON 입력의 필드와 내용을 확인해주세요.',
    'file-type': '링크가 아닌 일반 파일을 사용해주세요.',
    'file-size': '입력 파일이 허용 크기를 넘었습니다. PNG는 5MiB까지 지원합니다.',
    'file-changed': '읽는 동안 파일이 바뀌었습니다. 현재 파일을 확인해주세요.',
    'output-exists': '출력 파일이 이미 있어 덮어쓰지 않았습니다. 새 파일 경로를 사용해주세요.',
    'output-failed': '전체 자료 파일을 저장하지 못했습니다. 출력 경로를 확인해주세요.',
    'output-size': '요약 출력도 허용 크기를 넘었습니다. inspect --out으로 전체 자료를 새 파일에 저장해주세요.',
    'png-format': '실제 PNG 파일을 확인해주세요. 경로만으로 이미지를 만들지는 않습니다.',
    'png-size': 'PNG의 가로와 세로는 각각 1~4096픽셀이어야 합니다.',
    'artifact-unconfirmed': '저장 결과를 확인하지 못했습니다. 자동 재전송하지 않았으니 inspect로 현재 상태를 확인해주세요.',
  };
  return { code, message: messages[code] ?? '자료 처리 결과를 확인하지 못했습니다. 연결과 입력 내용을 확인해주세요.' };
}

export async function runArtifact(args = process.argv.slice(2), environment = process.env, { timeoutMs = 5000 } = {}) {
  try {
    const options = argumentsFor([...args]);
    const cwd = await realpath(process.cwd());
    if (options.cwd && !samePath(await realpath(options.cwd), cwd)) throw new BridgeError('wrong-task');
    const sessionId = environment.CODEX_THREAD_ID || options.chat;
    if (!validString(sessionId) || !sessionId.trim()
      || (options.chat && options.chat !== sessionId)
      || (!environment.CODEX_THREAD_ID && (!options.connection || !options.chat || !options.cwd || !options.turn))) throw new BridgeError('current-task-unavailable');
    let connectionPath = options.connection;
    if (options.config) {
      const config = await loadConfig(options.config);
      if (!config.enabled) throw new BridgeError('config-disabled');
      if (!samePath(config.project, cwd) || (config.version === 2 && config.sessionId !== sessionId)) throw new BridgeError('wrong-task');
      connectionPath = config.connection;
    }
    // Validate all local input before making any mutation request.
    let fields = {};
    if (options.operation === 'prepare') fields = await jsonFile(options.brief, ['expectedRevision', 'templateId', 'brief', 'style']);
    if (options.operation === 'revise') fields = await jsonFile(options.revision, ['expectedRevision', 'revisionRequest']);
    if (options.operation === 'publishPNG') {
      fields = await jsonFile(options.manifest, ['expectedRevision', 'renderedText']);
      const png = await regularBytes(options.png, MAX_PNG_BYTES); pngHeader(png);
      fields.pngBytes = [...png];
    }
    const operation = { inspect: 'inspect', prepare: 'save-brief', publishPNG: 'import-version', revise: 'request-revision' }[options.operation];
    const identity = validateIdentity(identityFor(sessionId));
    if (operation !== 'inspect') validateArtifactRequest({ operation, identity, ...fields });
    const connection = await readConnection(connectionPath);
    const observed = await requestJson(connection, `/v1/task-context?${new URLSearchParams({ sessionId, cwd })}`, undefined, timeoutMs);
    if (observed.sessionId !== sessionId || !validString(observed.turnId) || !path.isAbsolute(observed.cwd ?? '')
      || !samePath(await realpath(observed.cwd), cwd) || (options.turn && options.turn !== observed.turnId)) throw new BridgeError('wrong-task');
    const binding = { sessionId, cwd, turnId: observed.turnId };
    // A lost mutation response is uncertain: never automatically resend or generate replacement output.
    const data = scopedResult(await artifactRequest(connection, { operation, identity, binding, ...fields }, timeoutMs), identity, operation !== 'inspect');
    const result = { ok: true, operation: options.operation, ...data,
      ...(options.operation === 'prepare' ? { guidance: buildIntroPrompt(data.project) } : {}),
      deliveryVerified: false };
    if (options.out) result.packetPath = await savePacket(options.out, result);
    return result;
  } catch (error) { return { ok: false, ...userError(error), deliveryVerified: false }; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  const result = await runArtifact();
  let output;
  try { output = summarizeArtifact(result); }
  catch (error) { output = { ok: false, ...userError(error), deliveryVerified: false }; }
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (!output.ok) process.exitCode = 1;
}
