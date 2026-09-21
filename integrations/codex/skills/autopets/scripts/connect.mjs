#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { BridgeError, isObject, validString, readConnection, requestJson } from './bridge-client.mjs';

function argumentsFor(args) {
  const options = { operation: args.shift() };
  if (!['context', 'configure'].includes(options.operation)) throw new BridgeError('arguments');
  while (args.length) {
    const flag = args.shift();
    const key = { '--config': 'config', '--connection': 'connection' }[flag];
    if (!key || options[key] !== undefined || !args.length || !path.isAbsolute(args[0])) throw new BridgeError('arguments');
    options[key] = args.shift();
  }
  if (options.operation === 'configure' && !options.config) throw new BridgeError('config-required');
  if (options.operation === 'context' && options.config) throw new BridgeError('arguments');
  return options;
}

async function connectionPathFor(options, environment) {
  const explicit = options.connection ?? environment.AUTOPETS_CONNECTION_FILE;
  if (explicit) {
    if (!path.isAbsolute(explicit)) throw new BridgeError('connection-path');
    return explicit;
  }
  if (environment.AUTOPETS_DATA_DIR) {
    if (!path.isAbsolute(environment.AUTOPETS_DATA_DIR)) throw new BridgeError('connection-path');
    return path.join(environment.AUTOPETS_DATA_DIR, 'connection.json');
  }
  const candidates = [
    ...(environment.LOCALAPPDATA ? [path.join(environment.LOCALAPPDATA, 'local.autopets.desktop', 'connection.json')] : []),
    fileURLToPath(new URL('../../../../../release/.local/connection.json', import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (await stat(candidate).then((item) => item.isFile()).catch(() => false)) return candidate;
  }
  throw new BridgeError('connection-unavailable');
}

function sameCwd(left, right) {
  if (!validString(left, 32768) || !validString(right, 32768)) return false;
  const normalize = (value) => path.resolve(value).replace(/[\\/]+$/u, '');
  return process.platform === 'win32'
    ? normalize(left).toLocaleLowerCase('en-US') === normalize(right).toLocaleLowerCase('en-US')
    : normalize(left) === normalize(right);
}

async function readConfig(configPath) {
  let input;
  try {
    if ((await stat(configPath)).size > 16384) throw new BridgeError('config-size');
    const data = await readFile(configPath);
    if (data.length > 16384) throw new BridgeError('config-size');
    input = JSON.parse(data.toString('utf8').replace(/^\uFEFF/u, ''));
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError('config-format');
  }
  const keys = ['completionCriterion', 'interventionMode', 'elapsedAlertMinutes'];
  if (!isObject(input) || Object.keys(input).some((key) => !keys.includes(key))
    || !validString(input.completionCriterion, 2000) || !input.completionCriterion.trim()
    || !['when-needed', 'milestones'].includes(input.interventionMode)) throw new BridgeError('config-format');
  const elapsedAlertMinutes = input.elapsedAlertMinutes === undefined ? 10 : input.elapsedAlertMinutes;
  if (elapsedAlertMinutes !== null && (!Number.isSafeInteger(elapsedAlertMinutes)
    || elapsedAlertMinutes < 1 || elapsedAlertMinutes > 1440)) throw new BridgeError('config-format');
  return { completionCriterion: input.completionCriterion.trim(), interventionMode: input.interventionMode, elapsedAlertMinutes };
}

function userError(error) {
  if (error instanceof BridgeError && error.status === 401) return { code: 'authentication-failed', message: 'AutoPets 인증을 확인할 수 없습니다. 앱의 현재 연결 파일을 확인해주세요.' };
  if (error instanceof BridgeError && error.status === 403) return { code: 'task-not-authorized', message: '현재 작업과 연결 요청이 일치하지 않습니다. 다른 작업으로 대신 연결하지 않았습니다.' };
  if (error instanceof BridgeError && error.status === 404) return { code: 'task-not-observed', message: '현재 작업의 진행 중인 턴이 관측되지 않았습니다. AutoPets의 프로젝트 연결을 확인해주세요.' };
  if (error instanceof BridgeError && error.status === 409) return { code: 'configuration-conflict', message: '연결할 빈 펫이 없거나 작업 상태가 바뀌었습니다. AutoPets 관리 창에서 확인해주세요.' };
  const messages = {
    'arguments': 'context 또는 configure --config <절대 JSON 경로>를 사용해주세요.',
    'config-required': '완료 기준과 개입 방식을 담은 설정 JSON 파일이 필요합니다.',
    'config-format': '완료 기준, when-needed 또는 milestones, 1~1440분 또는 null을 확인해주세요.',
    'config-size': '설정 파일이 너무 큽니다. 완료 기준을 간결하게 적어주세요.',
    'current-task-unavailable': '현재 Codex 작업 ID를 확인할 수 없어 연결하지 않았습니다.',
    'wrong-task': 'AutoPets가 응답한 작업과 현재 작업이 달라 연결하지 않았습니다.',
    'connection-path': '연결 파일 또는 데이터 폴더는 절대 경로여야 합니다.',
    'connection-unavailable': 'AutoPets 연결 파일이 없습니다. 먼저 앱을 실행하고 연결 설정을 확인해주세요.',
    'connection-format': 'AutoPets 연결 파일이 올바르지 않습니다. 앱에서 현재 경로를 확인해주세요.',
    'connection-size': 'AutoPets 연결 파일이 올바르지 않습니다.',
    'bridge-unavailable': 'AutoPets에 연결할 수 없습니다. 앱 실행 상태를 확인해주세요.',
  };
  const code = error instanceof BridgeError ? error.code : 'connection-failed';
  return { code, message: messages[code] ?? '연결 결과를 확인하지 못했습니다. 현재 설정은 성공으로 표시하지 않습니다.' };
}

export async function runTaskConnection(args = process.argv.slice(2), environment = process.env) {
  try {
    const options = argumentsFor([...args]);
    // Caller-controlled --session/--turn flags are deliberately unavailable.
    const sessionId = environment.CODEX_THREAD_ID;
    if (!validString(sessionId) || !sessionId.trim()) throw new BridgeError('current-task-unavailable');
    const config = options.config ? await readConfig(options.config) : null;
    const connection = await readConnection(await connectionPathFor(options, environment));
    const cwd = process.cwd();
    const current = await requestJson(connection, `/v1/task-context?${new URLSearchParams({ sessionId, cwd })}`);
    if (current.sessionId !== sessionId || !validString(current.turnId) || !sameCwd(current.cwd, cwd)) throw new BridgeError('wrong-task');
    if (options.operation === 'context') {
      return { ok: true, operation: 'context', sessionId, turnId: current.turnId, observed: true, configured: false };
    }
    const fields = { sessionId, turnId: current.turnId, cwd: current.cwd, ...config };
    const requestId = `config-${createHash('sha256').update(JSON.stringify(fields)).digest('hex')}`;
    const payload = { requestId, ...fields };
    let result;
    try { result = await requestJson(connection, '/v1/task-config', payload); }
    catch (error) {
      // Only a transport failure is retried. The identical ID/body cannot restart
      // a timer or configure another slot after an uncertain first response.
      if (!(error instanceof BridgeError) || error.code !== 'bridge-unavailable') throw error;
      result = await requestJson(connection, '/v1/task-config', payload);
    }
    if (result.ok !== true || result.sessionId !== sessionId
      || !Number.isSafeInteger(result.slot) || result.slot < 0 || result.slot > 2) throw new BridgeError('wrong-task');
    return { ok: true, operation: 'configure', sessionId, slot: result.slot,
      elapsedAlertMinutes: config.elapsedAlertMinutes, interventionMode: config.interventionMode,
      taskTokenUsage: 'unavailable', taskInterrupt: 'manual-in-codex' };
  } catch (error) { return { ok: false, configured: false, ...userError(error) }; }
}

export async function main() {
  const result = await runTaskConnection();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
