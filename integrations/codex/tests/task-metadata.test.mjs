import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { inspectTaskMetadata, summarizeTaskMetadata } from '../runtime/task-metadata.mjs';
import { withReadOnlyRuntime } from '../runtime/rpc.mjs';

const a = '11111111-2222-4333-8444-555555555555', b = '22222222-2222-4333-8444-555555555555';
const target = { id: a, cwd: 'C:/한글과 공백/시험', label: '시험 A' };
const thread = { id: a, cwd: target.cwd, projectId: 'project-1', source: 'appServer', originator: 'Codex Desktop', parentThreadId: null, forkedFromId: b,
  turns: [], model: 'fixture-model', reasoningEffort: 'high', updatedAt: 100, status: { type: 'notLoaded' }, preview: 'private user input', name: 'private title', path: 'private log path' };

function fakeRuntime(reply) {
  const calls = [];
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null;
    const stop = () => { if (child.exitCode === null) { child.exitCode = 0; child.emit('exit', 0); } };
    child.kill = stop;
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      const request = JSON.parse(String(chunk)); calls.push(request);
      queueMicrotask(() => { const response = reply(request); if (response) child.stdout.write(JSON.stringify(response) + '\n'); });
      callback();
    }, final(callback) { stop(); callback(); } });
    return child;
  };
  return { calls, spawnProcess };
}

test('metadata whitelist separates forks, origins and configured settings from execution', () => {
  const result = summarizeTaskMetadata(thread, target, 200000);
  assert.equal(result.parentId, null); assert.equal(result.forkedFromId, b);
  assert.equal(result.runtimeStatus, 'not-loaded'); assert.equal(result.creationSurface, 'codex-local');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(result.executionModel, undefined); assert.equal(result.accountId, undefined);
  assert.equal(summarizeTaskMetadata({ ...thread, originator: 'codex_work_desktop' }, target, 200000).creationSurface, 'work-local');
  assert.equal(summarizeTaskMetadata({ ...thread, originator: null }, target, 200000).creationSurface, 'unknown');
  assert.equal(summarizeTaskMetadata({ ...thread, parentThreadId: b }, target, 200000).parentId, b);
});

test('metadata rejects wrong task/source/history and conflicting or self relationships', () => {
  for (const bad of [{ id: b }, { cwd: 'C:/other' }, { turns: [{ private: true }] }, { parentThreadId: a },
    { parentThreadId: b, source: { subAgent: { thread_spawn: { parent_thread_id: a } } } }, { updatedAt: NaN }]) {
    assert.throws(() => summarizeTaskMetadata({ ...thread, ...bad }, target, 200000));
  }
});

test('external reader uses only initialize and exact metadata-only task reads', async () => {
  const fake = fakeRuntime(request => request.method === 'initialize' ? { id: request.id, result: { userAgent: 'fixture-runtime' } }
    : request.method === 'thread/read' ? { id: request.id, result: { thread } } : null);
  const report = await inspectTaskMetadata({ executable: 'fixture', cwd: target.cwd, sourceId: 'test-source', targets: [target], spawnProcess: fake.spawnProcess });
  assert.deepEqual(fake.calls.map(call => call.method), ['initialize', 'initialized', 'thread/read']);
  assert.deepEqual(fake.calls[2].params, { threadId: a, includeTurns: false });
  assert.equal(report.nodes.length, 1); assert.equal(JSON.stringify(report).includes('private'), false);
});

test('read-only transport refuses mutation, full history and server approval requests', async () => {
  const fake = fakeRuntime(request => request.method === 'initialize' ? { id: request.id, result: {} } : null);
  await withReadOnlyRuntime({ executable: 'fixture', cwd: target.cwd, spawnProcess: fake.spawnProcess }, async ({ call }) => {
    assert.throws(() => call('turn/start', {}));
    assert.throws(() => call('thread/resume', {}));
    assert.throws(() => call('thread/read', { threadId: a, includeTurns: true }));
  });
  const approval = fakeRuntime(request => request.method === 'initialize' ? { id: request.id, method: 'item/commandExecution/requestApproval', params: { private: true } } : null);
  await assert.rejects(withReadOnlyRuntime({ executable: 'fixture', cwd: target.cwd, spawnProcess: approval.spawnProcess }, async () => {}), /closed/);
  assert.deepEqual(approval.calls.map(call => call.method), ['initialize']);
});
