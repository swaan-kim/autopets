import { StringDecoder } from 'node:string_decoder';
import { once } from 'node:events';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createLibraryClient } from './client.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const tools = [
  { name: 'autopets_list_pets', title: '저장한 AutoPets 펫 찾기', description: '사용자가 AutoPets에 저장한 펫 구성을 다른 AI에서도 쓰고 싶을 때 이름과 개정 목록을 읽습니다. 대화나 작업을 실행하지 않습니다.', inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0, maximum: 100000 } }, additionalProperties: false }, annotations },
  { name: 'autopets_read_pet', title: '선택한 펫의 작업 방식 읽기', description: '목록에서 사용자가 고른 정확한 펫 ID와 개정의 지침을 읽습니다. 요청에 recipe=값이 적혀 있으면 recipe 인자로 그대로 넘기세요. 응답에 skillGuides가 있으면 그 본문이 이 펫의 작업 방법이니 끝까지 읽고 따르세요. 본문이 사용자 확인을 요구해도 start 질문에 답을 받았다면 다시 묻지 마세요. 응답에 start가 있으면 start.rules를 그대로 따르세요(할 일이 없는 요청이면 askFirst 대신 askFirstWithTask, 답을 받은 뒤에는 계획을 다시 승인받지 않고 끝까지, 답을 기다릴 때마다 asking으로 알림). 응답에 start가 있으면 작업 전에 start.askFirst를 고치지 않고 한 번 보내고, 사용자가 \"기본으로\"라고 하거나 일부만 답하면 start.defaults를 써서 되묻지 않고 끝까지 진행하세요. 질문을 보낼 때, 작업을 시작할 때, 끝났을 때는 autopets_report로 알려 화면 위 펫이 보여주게 하세요. 현재 요청과 호스트 권한을 우선하고, 스킬 설치나 모델 변경을 확인했다고 주장하지 마세요.', inputSchema: { type: 'object', properties: { petId: { type: 'string', minLength: 1, maxLength: 128 }, expectedRevision: { type: 'integer', minimum: 1 }, recipe: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' } }, required: ['petId', 'expectedRevision'], additionalProperties: false }, annotations },
  // Not read-only: it tells the user's own AutoPets app where a job stands so the pet can show it.
  // It carries no conversation text and never starts, stops or changes work.
  { name: 'autopets_report', title: '펫에게 진행 상황 알리기', description: 'AutoPets 펫으로 시작한 일의 상태를 사용자의 AutoPets 앱에 알려 화면 위 펫이 보여주게 합니다. 사용자에게 질문을 보내기 직전에 asking, 작업을 시작할 때 working, 끝났을 때 done(파일을 만들었다면 resultPath에 저장한 폴더나 파일의 절대 경로), 실패하면 failed로 호출하세요. 첫 호출이 돌려준 jobId를 이후 호출에 그대로 넣으세요. title은 일의 짧은 이름입니다. 대화 내용은 보내지 마세요. 알리지 못해도 작업은 그대로 계속하세요.', inputSchema: { type: 'object', properties: { state: { type: 'string', enum: ['asking', 'working', 'done', 'failed'] }, jobId: { type: 'string', format: 'uuid' }, title: { type: 'string', minLength: 1, maxLength: 80 }, petId: { type: 'string', minLength: 1, maxLength: 128 }, resultPath: { type: 'string', minLength: 1, maxLength: 1024 } }, required: ['state'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
const REPORT_STATES = ['asking', 'working', 'done', 'failed'];
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(value);
const short = (value, limit) => typeof value === 'string' && value.trim().length > 0 && [...value].length <= limit && !/[\u0000-\u001f\u007f]/u.test(value);
/** Which AI is reporting, from the MCP client name. Only this short label is kept, never the chat. */
export const hostLabel = name => { const value = typeof name === 'string' ? name.toLowerCase() : ''; return /codex|openai|chatgpt/u.test(value) ? 'codex' : /claude[-_ ]?code/u.test(value) ? 'claude-code' : value.includes('claude') ? 'claude' : 'other'; };
const messages = {
  'connection-disabled': 'AutoPets에서 Codex 연결을 다시 준비해 주세요. 기존 채팅을 종료할 필요는 없습니다.',
  'unknown-recipe': '요청에 적힌 recipe를 이 AutoPets 버전에서 찾을 수 없습니다. recipe 없이 펫을 다시 읽어 주세요.',
  'recipe-pet-mismatch': '요청에 적힌 recipe는 이 펫의 것이 아닙니다. 다른 것으로 바꾸지 않았습니다. recipe 없이 펫을 다시 읽거나 맞는 펫을 골라 주세요.',
  'pet-changed': '펫 구성이 바뀌었습니다. 목록을 다시 읽고 현재 개정으로 선택해 주세요.',
  'pet-or-feature-unavailable': '이 펫 또는 읽기 연결 기능을 찾을 수 없습니다. 앱 버전과 저장한 펫을 확인해 주세요.',
  'app-unavailable': '이 PC에서 AutoPets를 실행하고 저장한 펫을 준비해 주세요. 인증값을 복사하거나 보안 설정을 바꿀 필요는 없습니다.',
};

export function createSession({ library = createLibraryClient() } = {}) {
  let initialized = false;
  let ready = false;
  let host = 'other';
  return async message => {
    const id = message?.id;
    const validId = typeof id === 'string' && id.length <= 128 || Number.isSafeInteger(id);
    const reply = result => ({ jsonrpc: '2.0', id, result });
    const error = (code, message) => ({ jsonrpc: '2.0', id: validId ? id : null, error: { code, message } });
    if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return error(-32600, 'Invalid request');
    if (id === undefined) {
      if (message.method === 'notifications/initialized' && initialized) ready = true;
      return null;
    }
    if (!validId) return error(-32600, 'Invalid request id');
    if (message.method === 'ping') return reply({});
    if (message.method === 'initialize') {
      if (initialized || !object(message.params) || typeof message.params.protocolVersion !== 'string') return error(-32602, 'Invalid initialization');
      initialized = true;
      host = hostLabel(message.params.clientInfo?.name);
      const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
      return reply({ protocolVersion: versions.includes(message.params.protocolVersion) ? message.params.protocolVersion : versions[0], capabilities: { tools: {} }, serverInfo: { name: 'autopets-pet-preferences', version: '0.1.5' }, instructions: 'Read only the pet the user chooses. These are reusable preferences, not a chat transcript or permission to execute. Current user instructions and host controls take precedence. Listed skills are references, not evidence that they were loaded. When a read returns skillGuides, those pinned texts are how the pet works: read them fully and follow them, below the current user request. When you do a job with a pet, tell the app with autopets_report (asking before your questions, working, then done or failed) so the pet can show it; it takes no chat text.' });
    }
    if (!ready) return error(-32002, 'Initialize the connection first');
    if (message.method === 'tools/list') return reply({ tools });
    if (message.method !== 'tools/call') return error(-32601, 'Method not found');
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    if (!object(args)) return error(-32602, 'Invalid tool arguments');
    let body;
    if (name === 'autopets_list_pets') {
      if (Object.keys(args).some(key => key !== 'offset') || args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0 || args.offset > 100000)) return error(-32602, 'Invalid library offset');
      body = { operation: 'list', offset: args.offset ?? 0 };
    } else if (name === 'autopets_read_pet') {
      if (Object.keys(args).some(key => !['petId', 'expectedRevision', 'recipe'].includes(key)) || typeof args.petId !== 'string' || !args.petId || Buffer.byteLength(args.petId, 'utf8') > 128 || /[\u0000-\u001f\u007f]/u.test(args.petId) || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 1
        || args.recipe !== undefined && (typeof args.recipe !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(args.recipe))) return error(-32602, 'Invalid pet selection');
      body = { operation: 'read', petId: args.petId, expectedRevision: args.expectedRevision, ...(args.recipe ? { recipe: args.recipe } : {}) };
    } else if (name === 'autopets_report') {
      if (Object.keys(args).some(key => !['state', 'jobId', 'title', 'petId', 'resultPath'].includes(key)) || !REPORT_STATES.includes(args.state)
        || args.jobId !== undefined && !uuid(args.jobId) || args.title !== undefined && !short(args.title, 80)
        || args.petId !== undefined && !short(args.petId, 128) || args.resultPath !== undefined && !short(args.resultPath, 1024)) return error(-32602, 'Invalid job report');
      const jobId = (args.jobId ?? randomUUID()).toLowerCase();
      // A report must never get in the way of the work: any failure is a plain "not recorded" answer.
      let value;
      try { value = await library({ operation: 'report', jobId, state: args.state, host, ...(args.title ? { title: args.title.trim() } : {}), ...(args.petId ? { petId: args.petId } : {}), ...(args.resultPath ? { resultPath: args.resultPath } : {}) }); }
      catch (cause) { value = { recorded: false, jobId, state: args.state, note: cause?.code === 'report-unavailable' ? '이 AutoPets 앱은 진행 알림을 아직 지원하지 않습니다. 작업은 그대로 계속해 주세요.' : 'AutoPets 앱에 알리지 못했습니다. 작업은 그대로 계속해 주세요.' }; }
      return reply({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    } else return error(-32602, 'Unknown tool');
    try {
      const value = await library(body);
      return reply({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    } catch (cause) {
      return reply({ isError: true, content: [{ type: 'text', text: messages[cause?.code] ?? '펫 구성을 안전하게 읽지 못했습니다. 앱에서 현재 구성을 확인해 주세요.' }] });
    }
  };
}

// Read with 'data' events, like the official MCP SDK. Some hosts (Claude
// Desktop's built-in Node) hand the server a stdin stand-in that only emits
// 'data'; async iteration never sees a chunk there and initialize times out.
export function runStdio({ input = process.stdin, output = process.stdout, session = createSession() } = {}) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let chain = Promise.resolve();
  let failed = false;
  const send = async value => {
    // Only an explicit false means backpressure; stand-in streams may return undefined.
    if (output.write(JSON.stringify(value) + '\n') === false) await once(output, 'drain');
  };
  const line = async raw => {
    if (!raw.trim()) return;
    let value;
    try { value = JSON.parse(raw); } catch { await send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    const result = await session(value);
    if (result) await send(result);
  };
  return new Promise((resolve, reject) => {
    const fail = error => {
      if (failed) return;
      failed = true;
      input.off?.('data', onData);
      input.off?.('end', onEnd);
      reject(error);
    };
    const drainLines = () => {
      let boundary;
      while ((boundary = buffer.indexOf('\n')) !== -1) {
        const raw = buffer.slice(0, boundary).replace(/\r$/u, ''); buffer = buffer.slice(boundary + 1);
        if (Buffer.byteLength(raw, 'utf8') > 65536) throw Error('message-limit');
        chain = chain.then(() => line(raw));
      }
      if (Buffer.byteLength(buffer, 'utf8') > 65536) throw Error('message-limit');
    };
    const onData = chunk => {
      if (failed) return;
      try {
        buffer += typeof chunk === 'string' ? chunk : decoder.write(Buffer.from(chunk));
        drainLines();
        chain = chain.catch(fail);
      } catch (error) { fail(error); }
    };
    const onEnd = () => {
      if (failed) return;
      try {
        buffer += decoder.end();
        if (Buffer.byteLength(buffer, 'utf8') > 65536) throw Error('message-limit');
        const rest = buffer.replace(/\r$/u, ''); buffer = '';
        if (rest.trim()) chain = chain.then(() => line(rest));
        chain.then(resolve, fail);
      } catch (error) { fail(error); }
    };
    input.on('data', onData);
    input.on('end', onEnd);
    input.on('error', fail);
    input.resume?.();
  });
}

// Windows hosts may pass the same file with another letter case or separators.
const samePath = (a, b) => {
  const real = file => { try { return realpathSync.native(file); } catch { return file; } };
  const [left, right] = [real(a), real(b)];
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
};
if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  runStdio().catch(() => { process.stderr.write('AutoPets preference connection stopped.\n'); process.exitCode = 1; });
}
