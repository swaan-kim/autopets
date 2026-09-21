import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleHook, acknowledge, loadConfig, identityKey, validateContext, renderInjection, MAX_INJECTION_BYTES } from '../probe/prepare.mjs';
import { configureHooks, commands, STATUS } from '../probe/setup.mjs';

const entry = fileURLToPath(new URL('../probe/prepare.mjs', import.meta.url));
const setup = fileURLToPath(new URL('../probe/setup.mjs', import.meta.url));
const token = 'm1-test-only-no-production-credentials-0123456789';
const context = goal => ({ goal, constraints: ['출처를 포함'], decisions: [], remaining: ['비교표 작성'] });

function child(file, args, input = '', env = process.env, cwd, command = process.execPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, command === process.execPath ? [file, ...args] : args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env, cwd });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error('probe child timed out')); }, 8000);
    proc.on('error', error => { clearTimeout(timer); reject(error); });
    proc.stdout.on('data', value => stdout += value); proc.stderr.on('data', value => stderr += value);
    proc.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    proc.stdin.on('error', () => {}); proc.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}
async function fixture(t) {
  const project = await mkdtemp(path.join(tmpdir(), "autopets-m1-한글-'"));
  t.after(async () => {
    assert.equal(path.dirname(project), tmpdir()); assert.ok(path.basename(project).startsWith('autopets-m1-'));
    await rm(project, { recursive: true, force: true });
  });
  const dataDir = path.join(project, '.local', 'autopets-m1'); await mkdir(dataDir, { recursive: true });
  const sessions = new Map(), received = []; let rejectRequests = false;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    received.push({ url: req.url, body });
    if (req.headers.authorization !== `Bearer ${token}` || rejectRequests) { res.writeHead(403).end('{}'); return; }
    if (req.url === '/v1/events') sessions.set(body.sessionId, { sessionId: body.sessionId, turnId: body.turnId, cwd: body.cwd });
    const result = req.url.startsWith('/v1/task-context?') ? sessions.get(new URL(req.url, 'http://127.0.0.1').searchParams.get('sessionId'))
      : req.url === '/v1/task-config' ? { ok: true, sessionId: body.sessionId, slot: 0 } : { ok: true };
    res.writeHead(result ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(result ?? {}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const connection = path.join(project, 'connection.json');
  await writeFile(connection, JSON.stringify({ version: 1, baseUrl: `http://127.0.0.1:${server.address().port}`, token }));
  const file = path.join(dataDir, 'config.json'); await writeFile(file, JSON.stringify({ version: 1, enabled: true, project, connection }));
  const cfg = await loadConfig(file);
  const input = (session = 'task-a', turn = 'turn-a', event = 'UserPromptSubmit') => ({ hook_event_name: event,
    session_id: session, turn_id: turn, cwd: project, prompt: 'PRIVATE_RAW_PROMPT', transcript_path: 'PRIVATE_TRANSCRIPT' });
  const state = async (session = 'task-a') => JSON.parse(await readFile(path.join(dataDir, `${identityKey(session)}.json`), 'utf8'));
  const record = async (goal, name = 'record.json') => { const file = path.join(project, name); await writeFile(file, JSON.stringify(context(goal))); return file; };
  return { project, cfg, input, state, record, received, sessions, reject: () => { rejectRequests = true; } };
}

test('M1 two chats retain isolated context and stdout is not called delivery proof', async t => {
  const f = await fixture(t);
  const first = await handleHook(f.cfg, f.input());
  assert.equal(first.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok(!JSON.stringify(first).includes('PRIVATE_')); assert.ok(!JSON.stringify(first).includes(token));
  assert.ok(Buffer.byteLength(first.hookSpecificOutput.additionalContext) <= MAX_INJECTION_BYTES);
  const a = await f.state();
  assert.equal(a.desktopDeliveryVerified, false); assert.equal(a.acknowledgementAt, null);
  const saved = await acknowledge(f.cfg, a.nonce, await f.record('회사 A 비교'), 'task-a', f.project);
  assert.equal(saved.contextSaved, true); assert.equal(saved.desktopDeliveryVerified, false);
  const again = await acknowledge(f.cfg, a.nonce, await f.record('회사 A 비교'), 'task-a', f.project);
  assert.equal(again.revision, 1);
  const second = await handleHook(f.cfg, f.input('task-b', 'turn-b'));
  assert.ok(!second.hookSpecificOutput.additionalContext.includes('회사 A 비교'));
  const b = await f.state('task-b');
  await assert.rejects(acknowledge(f.cfg, a.nonce, await f.record('wrong'), 'task-b', f.project));
  await acknowledge(f.cfg, b.nonce, await f.record('회의 메모'), 'task-b', f.project);
  assert.equal((await f.state()).context.goal, '회사 A 비교');
  assert.equal((await f.state('task-b')).context.goal, '회의 메모');
  assert.ok(!JSON.stringify(f.received).includes('PRIVATE_'));
  const status = await child(fileURLToPath(new URL('../probe/status.mjs', import.meta.url)), ['--config', f.cfg.file]);
  assert.equal(status.code, 0); assert.equal(JSON.parse(status.stdout).recordCount, 2);
  for (const privateValue of ['회사 A 비교', '회의 메모', 'task-a', 'task-b', a.nonce, token, f.project]) assert.ok(!status.stdout.includes(privateValue));
});

test('M1 does not repeat unchanged context and restores only the same chat after compaction', async t => {
  const f = await fixture(t); await handleHook(f.cfg, f.input());
  const state = await f.state(); await acknowledge(f.cfg, state.nonce, await f.record('A만 비교'), 'task-a', f.project);
  const count = f.received.length;
  assert.deepEqual(await handleHook(f.cfg, f.input()), {});
  assert.deepEqual(await handleHook(f.cfg, f.input('task-a', 'next-turn')), {});
  assert.equal(f.received.length, count);
  assert.deepEqual(await handleHook(f.cfg, f.input('task-a', 'next-turn', 'PostCompact')), {});
  const restored = await handleHook(f.cfg, f.input('task-a', 'next-turn'));
  assert.ok(restored.hookSpecificOutput.additionalContext.includes('A만 비교'));
  assert.ok(!restored.hookSpecificOutput.additionalContext.includes('PRIVATE_'));
});

test('M1 disabled, unknown events and wrong working directories produce no guidance', async t => {
  const f = await fixture(t);
  assert.deepEqual(await handleHook({ ...f.cfg, enabled: false }, f.input()), {});
  assert.deepEqual(await handleHook(f.cfg, { ...f.input(), cwd: tmpdir() }), {});
  assert.deepEqual(await handleHook(f.cfg, f.input('task-a', 'turn-a', 'PermissionRequest')), {});
  assert.equal(f.received.length, 0);
});

test('M1 rejects acknowledgement from missing identity, wrong turn and excessive context', async t => {
  const f = await fixture(t); await handleHook(f.cfg, f.input()); const state = await f.state();
  const file = await f.record('비교');
  await assert.rejects(acknowledge(f.cfg, state.nonce, file, '', f.project));
  f.sessions.get('task-a').turnId = 'newer-turn';
  await assert.rejects(acknowledge(f.cfg, state.nonce, file, 'task-a', f.project));
  assert.equal((await f.state()).acknowledgementAt, null);
  assert.throws(() => validateContext({ ...context('비교'), rawTranscript: 'not permitted' }));
  assert.throws(() => validateContext({ ...context('가'.repeat(200)), constraints: ['나'.repeat(160), '다'.repeat(160)] }));
  assert.throws(() => renderInjection({ file: '가'.repeat(1500) }, 'nonce', null));
});

test('M1 real child stdin/stdout fails open without exposing raw data or credentials', async t => {
  const f = await fixture(t);
  const invoke = input => child(entry, ['hook', '--config', f.cfg.file], input);
  for (const input of ['bad-json PRIVATE', { ...f.input(), prompt: 'x'.repeat(300_000) }]) {
    assert.deepEqual(await invoke(input), { code: 0, stdout: '{}\n', stderr: '' });
  }
  f.reject(); assert.deepEqual(await invoke(f.input()), { code: 0, stdout: '{}\n', stderr: '' });
});

test('M1 real child emits bounded context and accepts a bound normal-turn record', async t => {
  const f = await fixture(t);
  const prepared = await child(entry, ['hook', '--config', f.cfg.file], f.input());
  assert.equal(prepared.code, 0); assert.equal(prepared.stderr, '');
  assert.ok(JSON.parse(prepared.stdout).hookSpecificOutput.additionalContext);
  const state = await f.state();
  const result = await child(entry, ['acknowledge', '--config', f.cfg.file, '--nonce', state.nonce, '--record', await f.record('시장 조사')], '',
    { ...process.env, CODEX_THREAD_ID: 'task-a' }, f.project);
  assert.equal(result.code, 0); assert.equal(result.stderr, ''); assert.equal(JSON.parse(result.stdout).contextSaved, true);
});

test('M1 installer is scoped, idempotent, synchronous, and preserves unrelated hooks', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.project, '.codex'));
  const target = path.join(f.project, '.codex', 'hooks.json');
  const original = { marker: 'keep', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user command' }] }] } };
  await writeFile(target, JSON.stringify(original));
  const args = ['install', '--project', f.project, '--connection', f.cfg.connection];
  assert.equal((await child(setup, [...args, '--dry-run'])).code, 0);
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), original);
  assert.equal((await child(setup, args)).code, 0);
  const installed = JSON.parse(await readFile(target, 'utf8'));
  const own = installed.hooks.UserPromptSubmit[0].hooks[0];
  assert.equal(own.statusMessage, STATUS); assert.equal(own.async, undefined);
  assert.equal(own.additionalContextLimit, 1800);
  assert.equal(JSON.parse((await child(setup, args)).stdout).changed, false);
  assert.equal((await child(setup, ['uninstall', '--project', f.project])).code, 0);
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), original);
  assert.equal((await loadConfig(f.cfg.file)).enabled, false);
});

test('M1 removal never deletes a modified or similarly named handler', () => {
  const command = commands(path.resolve('config.json'));
  const custom = { type: 'command', statusMessage: STATUS, command: 'custom', commandWindows: 'custom' };
  const original = { hooks: { UserPromptSubmit: [{ hooks: [custom] }] } };
  const installed = configureHooks(original, 'install', command);
  assert.deepEqual(configureHooks(installed, 'uninstall', command), original);
});

test('M1 generated Windows hook runs through Korean paths and apostrophes', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  const encoded = commands(f.cfg.file).commandWindows.split(' ').at(-1);
  const result = await child(null, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    f.input(), process.env, f.project, 'powershell.exe');
  assert.equal(result.code, 0); assert.equal(result.stderr, '');
  assert.ok(JSON.parse(result.stdout).hookSpecificOutput.additionalContext);
  assert.ok(!result.stdout.includes(token));
});
