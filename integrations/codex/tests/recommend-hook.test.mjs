import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { hookIdentity, recommendForTurn, recommendForPet, main, RECOMMEND_HOOK_MARKER } from '../hooks/recommend-hook.mjs';
import { configureRecommendationHook, recommendationHandler, RECOMMEND_STATUS } from '../bootstrap/recommendation-hook.mjs';

const session = '11111111-1111-4111-8111-111111111111';
const input = (prompt, extra = {}) => ({ hook_event_name: 'UserPromptSubmit', session_id: session, turn_id: 'turn-1', cwd: path.resolve('/work'), prompt, model: 'gpt-6-luna', ...extra });
const fakeBridge = begin => { const calls = []; return { calls, request: async (url, body) => { calls.push({ url, body }); return body.operation === 'begin' ? begin : { ok: true, duplicate: false }; } }; };

test('only top-level UserPromptSubmit input with a real chat identity is handled', () => {
  assert.equal(hookIdentity(input('부산 여행 코스 짜줘')).sessionId, session);
  for (const value of [input('x', { hook_event_name: 'PreToolUse' }), input('x', { agent_id: 'child' }), input('x', { session_id: 'abc' }),
    input('x', { cwd: 'relative' }), input(undefined), null, 'text']) assert.equal(hookIdentity(value), null);
});

test('the request text is never sent for a chat that is not connected to a pet', async () => {
  const bridge = fakeBridge({ ok: true, eligible: false, reason: 'chat-not-connected' });
  const result = await recommendForTurn(hookIdentity(input('부산 2박 3일 여행 일정 짜줘')), bridge.request);
  assert.equal(result.sent, false);
  assert.deepEqual(bridge.calls.map(call => call.body.operation), ['begin']);
  assert.equal(JSON.stringify(bridge.calls).includes('부산'), false);
});

test('a connected chat receives existing-pet candidates, the request for prefill and a fingerprint', async () => {
  const bridge = fakeBridge({ ok: true, eligible: true, activePetIds: [] });
  const result = await recommendForTurn(hookIdentity(input('제주도 여행 일정을 계획하고 발표자료로 정리해줘')), bridge.request);
  assert.deepEqual(result.candidates, ['travel-plan', 'presentation']);
  const offer = bridge.calls[1].body;
  assert.equal(offer.operation, 'offer'); assert.equal(offer.turnId, 'turn-1'); assert.equal(offer.sessionId, session);
  assert.equal(offer.request, '제주도 여행 일정을 계획하고 발표자료로 정리해줘'); assert.match(offer.fingerprint, /^[0-9a-f]{64}$/u);
  assert.ok(offer.candidates.every(item => item.reason && Array.isArray(item.cues)));
});

test('no fitting pet, a greeting or the pet already in use clears the turn without sending text', async () => {
  for (const [prompt, active] of [['안녕하세요', []], ['이 함수 버그 고쳐줘', []], ['부산 2박 3일 여행 일정 짜줘', ['travel-plan']]]) {
    const bridge = fakeBridge({ ok: true, eligible: true, activePetIds: active });
    await recommendForTurn(hookIdentity(input(prompt)), bridge.request);
    assert.deepEqual(bridge.calls.map(call => call.body.operation), ['begin', 'clear'], prompt);
    assert.equal(bridge.calls[1].body.request, undefined);
  }
});

test('the $autopet pet receives a recommendation only for the chat it belongs to', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-pet-state-'));
  await fs.mkdir(path.join(dir, 'handoff'));
  const env = { AUTOPET_PREVIEW_STATE_DIR: dir };
  const writeState = state => fs.writeFile(path.join(dir, 'handoff', 'state.json'), JSON.stringify(state));
  const calls = [];
  const run = async (exe, args) => {
    const file = args[args.indexOf('--file') + 1];
    calls.push({ exe, args, body: JSON.parse(await fs.readFile(file, 'utf8')) });
    return { stdout: '{"ok":true,"state":"shown","id":"rec-1"}\n' };
  };
  const identity = hookIdentity(input('피피티 만들고싶어'));
  await writeState({ ownerThread: '22222222-2222-4222-8222-222222222222', petPid: process.pid });
  assert.equal((await recommendForPet(identity, { env, run, petExe: 'C:\\pet.exe' })).reason, 'not-pet-chat');
  await writeState({ ownerThread: session, petPid: 999999999 });
  assert.equal((await recommendForPet(identity, { env, run, petExe: 'C:\\pet.exe' })).reason, 'pet-closed');
  assert.equal(calls.length, 0);
  await writeState({ ownerThread: session, petPid: process.pid });
  const sent = await recommendForPet(identity, { env, run, petExe: 'C:\\pet.exe' });
  assert.equal(sent.sent, true); assert.deepEqual(sent.candidates, ['presentation']);
  assert.deepEqual(calls[0].args.slice(0, 5), ['recommend', '--chat', session, '--turn', 'turn-1']);
  assert.equal(calls[0].body.request, '피피티 만들고싶어'); assert.match(calls[0].body.fingerprint, /^[0-9a-f]{64}$/u);
  // The temporary hand-off file is removed afterwards.
  await assert.rejects(fs.access(calls[0].args[calls[0].args.indexOf('--file') + 1]));
  assert.equal((await recommendForPet(hookIdentity(input('안녕')), { env, run, petExe: 'C:\\pet.exe' })).sent, false);
  assert.equal(calls.length, 1);
  assert.equal((await recommendForPet(identity, { env: { AUTOPET_PREVIEW_STATE_DIR: path.join(dir, 'missing') }, run })).reason, 'no-pet');
});

test('the hook always prints an empty observation reply, even when the app is closed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-recommend-'));
  const writes = []; const original = process.stdout.write;
  // Never the user's real app or pet: every surface points into the temp folder.
  const env = { AUTOPETS_CONNECTION_FILE: path.join(dir, 'app', 'connection.json'), AUTOPET_PREVIEW_STATE_DIR: path.join(dir, 'pet'), AUTOPETS_RECOMMEND_TRACE_DIR: dir };
  process.stdout.write = chunk => { writes.push(String(chunk)); return true; };
  try {
    await main(['--connection', path.join(dir, 'missing.json'), RECOMMEND_HOOK_MARKER], Readable.from([JSON.stringify(input('발표자료 만들어줘'))]), env);
    await main(['--bad'], Readable.from(['{}']), env);
    await main(['--connection', path.join(dir, 'missing.json'), RECOMMEND_HOOK_MARKER], Readable.from(['not json']), env);
  } finally { process.stdout.write = original; }
  assert.deepEqual(writes, ['{}\n', '{}\n', '{}\n']);
  // The trace has ids and a reason for each surface (given app, user's app, pet), never the message text.
  const lines = (await fs.readFile(path.join(dir, 'recommend-trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0].results.map(item => [item.target, item.reason]), [[`app:${path.basename(dir)}`, 'app-not-running'], ['app:app', 'app-not-running'], ['pet', 'no-pet']]);
  assert.equal(lines[0].promptChars, '발표자료 만들어줘'.length);
  assert.ok(!JSON.stringify(lines).includes('발표자료'));
});

test('installing adds one async UserPromptSubmit handler, keeps other hooks, backs up and removes only itself', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-codex-home-'));
  const env = { CODEX_HOME: home };
  const other = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo user', statusMessage: 'mine' }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] } };
  await fs.writeFile(path.join(home, 'hooks.json'), JSON.stringify(other));
  const args = { env, node: path.resolve('/node.exe'), script: path.resolve('/a b/recommend-hook.mjs'), connection: path.resolve('/data/connection.json'), now: () => 1 };
  const enabled = await configureRecommendationHook({ ...args, enable: true });
  assert.equal(enabled.changed, true); assert.equal(enabled.installed, true); assert.equal(enabled.trustReviewedByUser, false);
  const saved = JSON.parse(await fs.readFile(path.join(home, 'hooks.json'), 'utf8'));
  assert.equal(saved.hooks.Stop[0].hooks[0].command, 'echo stop');
  const handlers = saved.hooks.UserPromptSubmit.flatMap(group => group.hooks);
  assert.deepEqual(handlers.map(hook => hook.statusMessage), ['mine', RECOMMEND_STATUS]);
  const ours = handlers[1];
  assert.equal(ours.async, true); assert.ok(ours.command.includes(RECOMMEND_HOOK_MARKER));
  assert.ok(Buffer.from(ours.commandWindows.split(' ').pop(), 'base64').toString('utf16le').includes(`'${args.script}'`));
  assert.deepEqual(JSON.parse(await fs.readFile(enabled.backup, 'utf8')), other);
  assert.equal((await configureRecommendationHook({ ...args, enable: true, now: () => 2 })).changed, false);
  const disabled = await configureRecommendationHook({ ...args, enable: false, now: () => 3 });
  assert.equal(disabled.installed, false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(home, 'hooks.json'), 'utf8')), other);
  assert.throws(() => recommendationHandler('node', args.script, args.connection));
});
