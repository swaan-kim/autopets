import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectReceiver } from '../runtime/receiver-diagnostics.mjs';

const target = { id: '11111111-1111-4111-8111-111111111111', cwd: 'C:/한글 시험/A', label: 'A' };
async function fixture(t, handler) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-receiver-'));
  const token = 'test-only-'.padEnd(40, 'x');
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: new URL(req.url, 'http://localhost'), authorized: req.headers.authorization === `Bearer ${token}` });
    handler(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(temporary), os.tmpdir());
    assert.ok(path.basename(temporary).startsWith('autopets-receiver-'));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const connectionPath = path.join(temporary, 'connection.json');
  await fs.writeFile(connectionPath, JSON.stringify({ version: 1, baseUrl: `http://127.0.0.1:${server.address().port}`, token }));
  return { connectionPath, requests, token };
}

test('receiver sends both exact identity fields and separates active binding from history', async t => {
  const f = await fixture(t, (_req, res) => res.end(JSON.stringify({ sessionId: target.id, cwd: 'c:\\한글 시험\\A', turnId: 'turn-a', private: 'do-not-collect' })));
  const result = await inspectReceiver({ connectionPath: f.connectionPath, targets: [target] });
  assert.equal(result.targets[0].activeBinding, true);
  assert.equal(result.historicalReceipt, 'not-inspected');
  assert.equal(f.requests[0].method, 'GET');
  assert.equal(f.requests[0].authorized, true);
  assert.equal(f.requests[0].url.searchParams.get('cwd'), target.cwd);
  assert.equal(f.requests[0].url.searchParams.get('sessionId'), target.id);
  assert.doesNotMatch(JSON.stringify(result), /do-not-collect|turn-a/);
  assert.ok(!JSON.stringify(result).includes(f.token));
});

test('receiver distinguishes no task, inactive turn and unknown rejection without leaking raw text', async t => {
  const errors = ['task-not-observed', 'task-context-mismatch', 'active-turn-not-observed', 'private-secret-path'];
  const f = await fixture(t, (_req, res) => { res.writeHead(404); res.end(JSON.stringify({ error: errors.shift() })); });
  for (const expected of ['task-not-observed', 'task-context-mismatch', 'active-turn-not-observed', 'unclassified-rejection']) {
    const result = await inspectReceiver({ connectionPath: f.connectionPath, targets: [target] });
    assert.equal(result.targets[0].reason, expected);
    assert.equal(result.targets[0].httpStatus, 404);
    assert.equal(result.targets[0].activeBinding, false);
    assert.equal(result.historicalReceipt, 'not-inspected');
  }
});

test('receiver rejects cross-task success and oversized responses', async t => {
  let count = 0;
  const f = await fixture(t, (_req, res) => res.end(count++ === 0 ? JSON.stringify({ sessionId: target.id, cwd: 'C:/other', turnId: 'turn' }) : 'x'.repeat(5000)));
  assert.equal((await inspectReceiver({ connectionPath: f.connectionPath, targets: [target] })).targets[0].reason, 'response-identity-mismatch');
  assert.equal((await inspectReceiver({ connectionPath: f.connectionPath, targets: [target] })).targets[0].reason, 'unreadable-response');
  await assert.rejects(inspectReceiver({ connectionPath: f.connectionPath, targets: [{ ...target, cwd: '' }] }));
  assert.equal(f.requests.length, 2);
});
