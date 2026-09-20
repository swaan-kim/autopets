import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, link, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { defaultPreferences, emptyContext, unverifiedCapabilities } from '../packages/contracts/index.mjs';
import { prepare, record, loadConfig, identityFor } from '../integrations/codex/assistance/prepare.mjs';

async function fixture(t) {
  const project = await mkdtemp(path.join(tmpdir(), 'autopets-assistance-한글-'));
  t.after(async () => { assert.equal(path.dirname(project), tmpdir()); assert.ok(path.basename(project).startsWith('autopets-assistance-')); await rm(project, { recursive: true, force: true }); });
  const dataDir = path.join(project, '.local', 'autopets-assistance');
  await mkdir(path.join(dataDir, 'records'), { recursive: true });
  const file = path.join(dataDir, 'config.json');
  await writeFile(file, JSON.stringify({ version: 1, enabled: true, validationMode: true, project, connection: path.join(project, 'connection.json') }));
  const config = await loadConfig(file), calls = [], records = new Map();
  const preferences = { ...defaultPreferences(), enabled: true, revision: 1 };
  let turnId = 'turn-1';
  const request = async (url, body) => {
    calls.push({ url, body });
    if (url.startsWith('/v1/task-context?')) return { sessionId: new URL(url, 'http://localhost').searchParams.get('sessionId'), turnId, cwd: project };
    if (url === '/v1/events') { turnId = body.turnId; return { ok: true }; }
    const key = JSON.stringify(body.identity);
    let task = records.get(key);
    if (!task) { task = { identity: body.identity, enabled: true, revision: 0, context: emptyContext() }; records.set(key, task); }
    if (body.operation === 'read') return { preferences, task, capabilities: { codex: unverifiedCapabilities() } };
    if (!preferences.enabled || !task.enabled) throw new Error('disabled');
    if (body.expectedRevision !== task.revision) throw new Error('stale');
    if (body.operation === 'prepare') {
      if (task.guidanceHash === body.guidanceHash) return { ok: true, duplicate: true, nonce: null };
      task.guidanceHash = body.guidanceHash; return { ok: true, nonce: 'fixture-nonce', task };
    }
    if (body.operation === 'sync') { if (JSON.stringify(task.context) !== JSON.stringify(body.context)) { task.context = body.context; task.revision++; } return { ok: true, task }; }
    throw new Error('unexpected operation');
  };
  const input = (chat = 'chat-a', prompt = '경쟁사 비교', turn = 'turn-1') => ({ hook_event_name: 'UserPromptSubmit', session_id: chat, turn_id: turn, cwd: project, prompt });
  return { config, calls, request, input, records, preferences };
}
test('Codex unverified production is inert; explicitly configured validation emits bounded hook output only', async t => {
  const f = await fixture(t);
  assert.deepEqual((await prepare({ ...f.config, validationMode: false }, f.input(), f.request)).output, {});
  const result = await prepare(f.config, f.input('chat-a', 'PRIVATE 원문 경쟁사 비교'), f.request);
  assert.ok(Buffer.byteLength(result.output.hookSpecificOutput.additionalContext) <= 3072);
  assert.ok(result.receipt);
  assert.ok(!JSON.stringify(f.calls).includes('PRIVATE'));
  assert.ok(!JSON.stringify(result.output).includes('PRIVATE'));
  assert.ok(!('model' in result.output));
});
test('Codex unchanged guidance deduplicates; preference and compaction changes restore bounded guidance', async t => {
  const f = await fixture(t);
  assert.ok((await prepare(f.config, f.input(), f.request)).receipt);
  assert.deepEqual((await prepare(f.config, f.input('chat-a', '경쟁사 비교', 'turn-2'), f.request)).output, {});
  f.preferences.workStyle = 'thorough'; f.preferences.revision++;
  assert.ok((await prepare(f.config, f.input(), f.request)).receipt);
  assert.deepEqual((await prepare(f.config, { ...f.input(), hook_event_name: 'PostCompact' }, f.request)).output, {});
  assert.ok((await prepare(f.config, f.input(), f.request)).receipt);
});
test('Codex per-chat off and global off suppress guidance independently', async t => {
  const f = await fixture(t); await prepare(f.config, f.input(), f.request);
  f.records.get(JSON.stringify(identityFor('chat-a'))).enabled = false;
  assert.deepEqual((await prepare(f.config, f.input(), f.request)).output, {});
  assert.ok((await prepare(f.config, f.input('chat-b'), f.request)).receipt);
  f.preferences.enabled = false;
  assert.deepEqual((await prepare(f.config, f.input('chat-b'), f.request)).output, {});
});
test('Codex normal-turn sync is isolated, optimistic, scoped to ignored records and never confirms delivery', async t => {
  const f = await fixture(t);
  await prepare(f.config, f.input(), f.request);
  const data = { expectedRevision: 0, context: { ...emptyContext(), goal: '회사 A만 비교', constraints: ['최신 자료'] } };
  const file = path.join(f.config.dataDir, 'records', 'change.json'); await writeFile(file, JSON.stringify(data));
  const saved = await record(f.config, 'record', file, 'chat-a', f.config.project, f.request);
  assert.equal(saved.revision, 1); assert.equal(saved.deliveryVerified, false);
  await assert.rejects(lstat(file), { code: 'ENOENT' });
  const other = await prepare(f.config, f.input('chat-b'), f.request);
  assert.ok(!other.output.hookSpecificOutput.additionalContext.includes('회사 A만 비교'));
  await writeFile(file, JSON.stringify(data));
  await assert.rejects(record(f.config, 'record', file, 'chat-a', f.config.project, f.request), /stale/);
  await assert.rejects(lstat(file), { code: 'ENOENT' });
  await assert.rejects(record(f.config, 'record', file, '', f.config.project, f.request));
  const outside = path.join(f.config.project, 'outside.json'); await writeFile(outside, JSON.stringify(data));
  await assert.rejects(record(f.config, 'record', outside, 'chat-a', f.config.project, f.request), /record-location/);
  assert.equal(await readFile(outside, 'utf8'), JSON.stringify(data));
});
test('Codex consumes only the temporary record on malformed input and transport failure', async t => {
  const f = await fixture(t); await prepare(f.config, f.input(), f.request);
  const records = path.join(f.config.dataDir, 'records'), file = path.join(records, 'consume.json'), neighbor = path.join(records, 'keep.json');
  await writeFile(neighbor, 'untouched');
  const attempt = async (text, request = f.request) => {
    await writeFile(file, text);
    await assert.rejects(record(f.config, 'record', file, 'chat-a', f.config.project, request));
    await assert.rejects(lstat(file), { code: 'ENOENT' });
    assert.equal(await readFile(neighbor, 'utf8'), 'untouched');
  };
  await attempt('{invalid');
  await attempt('null');
  await attempt(JSON.stringify({ expectedRevision: 0, context: { ...emptyContext(), goal: 'x'.repeat(1025) } }));
  await attempt('x'.repeat(4097));
  await attempt(JSON.stringify({ expectedRevision: 0, context: emptyContext() }), (url, body) => {
    if (body?.operation === 'sync') throw new Error('fixture transport failure');
    return f.request(url, body);
  });
});
test('Codex never consumes a linked record, directory or a file replaced during sync', async t => {
  const f = await fixture(t); await prepare(f.config, f.input(), f.request);
  const records = path.join(f.config.dataDir, 'records'), file = path.join(records, 'input.json');
  const source = path.join(f.config.project, 'keep.json'), data = JSON.stringify({ expectedRevision: 0, context: emptyContext() });
  await writeFile(source, data); await link(source, file);
  await assert.rejects(record(f.config, 'record', file, 'chat-a', f.config.project, f.request), /record-file/);
  assert.equal(await readFile(source, 'utf8'), data); assert.equal(await readFile(file, 'utf8'), data);
  await rm(file);
  const directory = path.join(records, 'keep-directory'); await mkdir(directory);
  await assert.rejects(record(f.config, 'record', directory, 'chat-a', f.config.project, f.request), /record-file/);
  assert.ok((await lstat(directory)).isDirectory());
  await writeFile(file, data);
  const retained = path.join(records, 'moved-input.json');
  const result = await record(f.config, 'record', file, 'chat-a', f.config.project, async (url, body) => {
    if (body?.operation === 'sync') {
      await rename(file, retained); await writeFile(file, 'replacement must survive');
    }
    return f.request(url, body);
  });
  assert.equal(result.contextSaved, true);
  assert.equal(await readFile(file, 'utf8'), 'replacement must survive');
  assert.equal(await readFile(retained, 'utf8'), data);
});
test('Codex invalid/unconfigured hook fails open without input, credentials or diagnostics on stdout', async () => {
  const result = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['integrations/codex/assistance/prepare.mjs', 'hook', '--config', 'missing'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; proc.stdout.on('data', value => stdout += value); proc.stderr.on('data', value => stderr += value);
    proc.on('error', reject); proc.on('close', code => resolve({ code, stdout, stderr })); proc.stdin.on('error', () => {}); proc.stdin.end('PRIVATE RAW BODY');
  });
  assert.deepEqual(result, { code: 0, stdout: '{}\n', stderr: '' });
});
