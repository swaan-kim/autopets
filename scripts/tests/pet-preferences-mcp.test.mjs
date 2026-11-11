import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createLibraryClient, PetLibraryError } from '../../integrations/mcp/client.mjs';
import { createSession, runStdio } from '../../integrations/mcp/server.mjs';
import { packagePetPreferences } from '../package-pet-preferences.mjs';

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture-only', version: '1' } } };
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };
const call = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

test('MCP initialization is lazy and only the selected pet preference can be read', async () => {
  const requests = [];
  const session = createSession({ library: async input => { requests.push(input); return { fixtureOnly: true }; } });
  assert.equal((await session(call(0, 'autopets_list_pets'))).error.code, -32002);
  const result = await session(initialize);
  assert.equal(result.result.protocolVersion, '2025-06-18');
  assert.deepEqual(requests, []);
  await session(initialized);
  const list = await session({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(list.result.tools.length, 2);
  assert.ok(list.result.tools.every(tool => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));
  await session(call(3, 'autopets_list_pets'));
  await session(call(4, 'autopets_read_pet', { petId: 'chosen-a', expectedRevision: 3 }));
  assert.deepEqual(requests, [{ operation: 'list', offset: 0 }, { operation: 'read', petId: 'chosen-a', expectedRevision: 3 }]);
  for (const request of [call(5, 'send_message'), call(6, 'autopets_read_pet', { petId: 'chosen-a', expectedRevision: 3, chatId: 'other-chat' }), call(7, 'autopets_list_pets', { path: 'C:/private' }), call(8, 'autopets_read_pet', { petId: 'chosen-a', expectedRevision: 0 })]) {
    assert.equal((await session(request)).error.code, -32602);
  }
  assert.equal(requests.length, 2, 'unknown actions and alternate targets never reach the app');
  const failed = createSession({ library: async () => { throw new PetLibraryError('pet-changed'); } });
  await failed(initialize); await failed(initialized);
  assert.equal((await failed(call(2, 'autopets_read_pet', { petId: 'a', expectedRevision: 1 }))).result.isError, true);
});

test('authenticated loopback reads redact private fields, stale revisions, and remote errors', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-mcp-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('autopets-mcp-')); await fs.rm(root, { recursive: true, force: true }); });
  const token = 'synthetic_test_token_'.repeat(3);
  const calls = [];
  let mode = 'valid';
  const server = http.createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(request.headers.origin, undefined);
    assert.equal(request.url, '/v1/pet-library');
    assert.equal(request.method, 'POST');
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks)); calls.push(body);
    response.setHeader('Content-Type', 'application/json');
    if (body.operation === 'list') return response.end(JSON.stringify({ version: 1, pets: [{ id: 'pet-a', revision: 3, name: '합성 이미지 펫', roleId: 'research-document', privateChat: 'not returned' }], nextOffset: null, token: 'not returned', bindings: ['not returned'] }));
    if (body.expectedRevision !== 3) { response.statusCode = 409; return response.end(JSON.stringify({ error: 'synthetic-private-diagnostic-never-forwarded' })); }
    response.end(JSON.stringify({ version: 1, pet: { id: mode === 'wrong' ? 'pet-b' : 'pet-a', revision: 3, template: { name: '합성 이미지 펫', instruction: '사용자의 현재 요청으로 프롬프트를 정리하세요.', planFirst: false, execution: { model: 'not returned' }, skills: [{ id: 'autopets-research-document', version: '1.0.0', private: 'not returned' }], conversation: 'not returned' } }, bindings: ['not returned'] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const connection = path.join(root, 'connection.json');
  await fs.writeFile(connection, JSON.stringify({ version: 1, token, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  const library = createLibraryClient({ environment: { AUTOPETS_CONNECTION_FILE: connection } });
  assert.deepEqual(await library({ operation: 'list', offset: 0 }), { pets: [{ id: 'pet-a', revision: 3, name: '합성 이미지 펫', roleId: 'research-document' }], nextOffset: null });
  const selected = await library({ operation: 'read', petId: 'pet-a', expectedRevision: 3 });
  assert.equal(selected.pet.skillsLoaded, false); assert.equal(selected.pet.hostSettingsChanged, false);
  assert.equal(JSON.stringify(selected).includes('not returned'), false);
  assert.equal(selected.pet.routing, null, 'malformed saved routing is omitted, not forwarded');
  await assert.rejects(library({ operation: 'read', petId: 'pet-a', expectedRevision: 2 }), error => error.code === 'pet-changed' && !error.message.includes('diagnostic'));
  mode = 'wrong'; await assert.rejects(library({ operation: 'read', petId: 'pet-a', expectedRevision: 3 }), error => error.code === 'invalid-library-response');
  assert.ok(calls.every(input => !JSON.stringify(input).includes(token)));
  assert.deepEqual(JSON.parse(await fs.readFile(connection, 'utf8')).token, token, 'reading preferences does not rewrite connection data');
});

test('stdio preserves split Korean text, rejects invalid messages, and never logs content', async () => {
  const requests = [initialize, initialized, call(2, 'autopets_read_pet', { petId: '선택한-펫', expectedRevision: 1 })];
  const bytes = Buffer.from(requests.map(request => JSON.stringify(request)).join('\n') + '\n');
  const chunks = Array.from(bytes, byte => Buffer.from([byte]));
  let output = '';
  await runStdio({ input: Readable.from(chunks), output: new Writable({ write(chunk, _encoding, done) { output += chunk; done(); } }), session: createSession({ library: async input => ({ petId: input.petId }) }) });
  const messages = output.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(messages.length, 2);
  assert.equal(messages[1].result.structuredContent.petId, '선택한-펫');
  await assert.rejects(runStdio({ input: Readable.from(['x'.repeat(65537)]), output: new Writable({ write(_chunk, _encoding, done) { done(); } }) }), /message-limit/);
});

test('detached MCPB has every runtime file, no credentials, and starts without the checkout', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-mcp-package-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('autopets-mcp-package-')); await fs.rm(root, { recursive: true, force: true }); });
  const file = path.join(root, 'preferences.mcpb');
  const report = await packagePetPreferences({ out: file });
  assert.equal(report.actualHostVerified, false); assert.equal(report.hostInstalled, false);
  const bytes = await fs.readFile(file); let offset = 0; const files = [];
  const extracted = path.join(root, 'detached 한글');
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + length).toString('utf8'), start = offset + 30 + length + extra;
    const target = path.resolve(extracted, name); assert.ok(target.startsWith(extracted + path.sep));
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes.subarray(start, start + size));
    files.push(name); offset = start + size;
  }
  assert.equal(files.length, 8);
  assert.ok(files.includes('packages/contracts/data/routing-profiles.json'), 'routing hint table ships with the server');
  assert.ok(!files.some(name => /connection\.json|\.sqlite|node_modules|\.local/u.test(name)));
  const manifest = JSON.parse(await fs.readFile(path.join(extracted, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, '0.3');
  assert.deepEqual(manifest.compatibility.platforms, ['win32']);
  await import(pathToFileURL(path.join(extracted, 'server/mcp/server.mjs')));
  const cli = spawnSync(process.execPath, [path.join(extracted, 'server/mcp/server.mjs')], { input: JSON.stringify(initialize) + '\n', encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).result.serverInfo.name, 'autopets-pet-preferences');
  assert.equal(cli.stderr, '');
  // Hosts launch the manifest entry with their own spelling of the path; it must always answer.
  assert.equal(manifest.server.entry_point, 'server/mcp/main.mjs');
  const hostSpelled = `${extracted}${path.sep}.${path.sep}server/mcp/./main.mjs`;
  const host = spawnSync(process.execPath, [hostSpelled], { input: JSON.stringify({ ...initialize, params: { ...initialize.params, protocolVersion: '2025-11-25' } }) + '\n', encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(host.status, 0, host.stderr);
  assert.equal(JSON.parse(host.stdout).result.protocolVersion, '2025-11-25');
});

test('long MCP sessions do not expire by message count and wait for a slow host reader', async () => {
  let reads = 0;
  let output = '';
  const requests = [initialize, initialized, ...Array.from({ length: 600 }, (_, index) => ({ jsonrpc: '2.0', id: index + 2, method: 'ping' }))];
  await runStdio({
    input: Readable.from([requests.map(request => JSON.stringify(request)).join('\n') + '\n']),
    output: new Writable({ highWaterMark: 1, write(chunk, _encoding, done) { setTimeout(() => { output += chunk; done(); }, 0); } }),
    session: createSession({ library: async () => { reads++; return {}; } }),
  });
  const replies = output.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(replies.length, 601);
  assert.equal(replies.at(-1).id, 601);
  assert.equal(reads, 0, 'health checks never read the app or its connection file');
});

test('stdio answers hosts whose stdin only emits data events and whose write returns nothing', async () => {
  const { EventEmitter } = await import('node:events');
  const input = new EventEmitter();
  const written = [];
  const output = { write: text => { written.push(JSON.parse(text)); } };
  const done = runStdio({ input, output, session: createSession({ library: async () => ({ pets: [], nextOffset: null }) }) });
  input.emit('data', Buffer.from(`${JSON.stringify({ ...initialize, params: { ...initialize.params, protocolVersion: '2025-11-25' } })}\r\n${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n{"jsonrpc":"2.0","id":2,"method":"tools/li`));
  input.emit('data', 'st"}\n');
  input.emit('end');
  await done;
  assert.deepEqual(written.map(message => message.id), [1, 2]);
  assert.equal(written[0].result.protocolVersion, '2025-11-25');
  assert.equal(written[1].result.tools.length, 2);
});

test('read pet returns a host-neutral routing hint from the shared table and never claims it was applied', async () => {
  const uiPet = JSON.parse(await fs.readFile(new URL('../../packages/contracts/data/ui-pet.json', import.meta.url), 'utf8'));
  const library = createLibraryClient({ environment: { AUTOPETS_CONNECTION_FILE: 'synthetic' }, connect: async () => ({}),
    request: async () => ({ version: 1, pet: { id: 'pet-ui', revision: 1, template: uiPet } }) });
  const { pet } = await library({ operation: 'read', petId: 'pet-ui', expectedRevision: 1 });
  assert.deepEqual(pet.routing.planning.hosts['codex-windows-local'], { model: 'gpt-6-astra', effort: 'high' });
  assert.deepEqual(pet.routing.planning.hosts['claude-code'], { model: 'opus', effort: 'high' });
  assert.deepEqual(pet.routing.execution.hosts['claude-code'], { model: 'sonnet', effort: 'low' });
  assert.equal(pet.routing.applied, false); assert.equal(pet.hostSettingsChanged, false);
});
