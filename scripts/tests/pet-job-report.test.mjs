// `autopets_report`: an AI tells the user's AutoPets app where a job stands, so the pet can show it.
// Synthetic checks only: no app, no AI, no chat text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryClient, PetLibraryError } from '../../integrations/mcp/client.mjs';
import { createSession, hostLabel, tools } from '../../integrations/mcp/server.mjs';

const initialize = name => ({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1' } } });
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };
const call = (id, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'autopets_report', arguments: args } });
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/u;

async function session(name, library) {
  const run = createSession({ library });
  await run(initialize(name)); await run(initialized);
  return run;
}

test('the report tool is the only one that is not read-only, and it takes no free text beyond a short title', () => {
  const report = tools.find(tool => tool.name === 'autopets_report');
  assert.deepEqual(Object.keys(report.inputSchema.properties).sort(), ['jobId', 'petId', 'resultPath', 'state', 'title']);
  assert.equal(report.inputSchema.additionalProperties, false);
  assert.equal(report.inputSchema.properties.title.maxLength, 80);
  assert.deepEqual(report.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.ok(tools.filter(tool => tool !== report).every(tool => tool.annotations.readOnlyHint));
});

test('the reporting AI is named from the MCP client, never from the chat', () => {
  assert.equal(hostLabel('codex-mcp-client'), 'codex');
  assert.equal(hostLabel('ChatGPT'), 'codex');
  assert.equal(hostLabel('claude-code'), 'claude-code');
  assert.equal(hostLabel('Claude Code'), 'claude-code');
  assert.equal(hostLabel('claude-ai'), 'claude');
  assert.equal(hostLabel('some-editor'), 'other');
  assert.equal(hostLabel(undefined), 'other');
});

test('a job id is issued on the first report and reused; the app receives state, host and short labels only', async () => {
  const requests = [];
  const run = await session('claude-code', async input => { requests.push(input); return { recorded: true, jobId: input.jobId, state: input.state }; });
  const first = (await run(call(2, { state: 'asking', title: ' 발표자료 만들기 ', petId: 'pet-a' }))).result.structuredContent;
  assert.equal(first.recorded, true); assert.match(first.jobId, UUID);
  const folder = 'C:\\Users\\fixture\\Documents\\AutoPets\\1112-slides';
  const done = (await run(call(3, { state: 'done', jobId: first.jobId.toUpperCase(), resultPath: folder }))).result.structuredContent;
  assert.equal(done.jobId, first.jobId, 'the same job, whatever the letter case');
  assert.deepEqual(requests, [
    { operation: 'report', jobId: first.jobId, state: 'asking', host: 'claude-code', title: '발표자료 만들기', petId: 'pet-a' },
    { operation: 'report', jobId: first.jobId, state: 'done', host: 'claude-code', resultPath: folder },
  ]);
});

test('invalid reports never reach the app', async () => {
  const requests = [];
  const run = await session('codex', async input => { requests.push(input); return {}; });
  for (const args of [{}, { state: 'paused' }, { state: 'done', jobId: 'not-a-uuid' }, { state: 'working', title: 'x'.repeat(81) }, { state: 'working', title: '줄\n바꿈' },
    { state: 'working', title: '   ' }, { state: 'done', resultPath: '' }, { state: 'asking', message: '대화 내용' }, { state: 'asking', chatId: 'other-chat' }]) {
    assert.equal((await run(call(2, args))).error.code, -32602, JSON.stringify(args));
  }
  assert.deepEqual(requests, []);
});

test('a report that cannot be recorded is a plain answer, never an error that stops the work', async () => {
  for (const [code, note] of [['report-unavailable', /아직 지원하지 않습니다/u], ['app-unavailable', /알리지 못했습니다/u], ['report-rejected', /알리지 못했습니다/u]]) {
    const run = await session('codex', async () => { throw new PetLibraryError(code); });
    const reply = (await run(call(2, { state: 'working' }))).result;
    assert.equal(reply.isError, undefined);
    assert.equal(reply.structuredContent.recorded, false);
    assert.match(reply.structuredContent.jobId, UUID);
    assert.match(reply.structuredContent.note, note);
    assert.match(reply.structuredContent.note, /작업은 그대로 계속/u);
  }
});

test('the client posts the report to the local app only, without the operation name or anything else', async () => {
  const calls = [];
  const environment = { AUTOPETS_CONNECTION_FILE: 'synthetic' };
  const client = createLibraryClient({ environment, connect: async () => ({ fixture: true }),
    request: async (connection, url, body, timeout, limit) => { calls.push({ connection, url, body, limit }); return { ok: true, jobId: body.jobId, state: body.state }; } });
  const jobId = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(await client({ operation: 'report', jobId, state: 'working', host: 'codex', title: '공부 도우미' }), { recorded: true, jobId, state: 'working' });
  assert.deepEqual(calls, [{ connection: { fixture: true }, url: '/v1/pet-jobs', body: { jobId, state: 'working', host: 'codex', title: '공부 도우미' }, limit: 4096 }]);
  const failing = status => createLibraryClient({ environment, connect: async () => ({}), request: async () => { throw Object.assign(Error('http'), { status }); } });
  await assert.rejects(failing(404)({ operation: 'report', jobId, state: 'done', host: 'codex' }), { code: 'report-unavailable' }, 'an older app has no such route');
  await assert.rejects(failing(400)({ operation: 'report', jobId, state: 'done', host: 'codex' }), { code: 'report-rejected' });
  await assert.rejects(failing(undefined)({ operation: 'report', jobId, state: 'done', host: 'codex' }), { code: 'app-unavailable' });
  const wrong = createLibraryClient({ environment, connect: async () => ({}), request: async () => ({ ok: true, jobId: 'another' }) });
  await assert.rejects(wrong({ operation: 'report', jobId, state: 'done', host: 'codex' }), { code: 'invalid-library-response' });
});
