import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookCommands, isAutoPetsHandler, STATUS, EVENTS, updateConfig } from '../scripts/install-hooks.mjs';
import { prepare } from '../assistance/prepare.mjs';
import { handlers } from '../bootstrap/connection.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const adapter = path.join(root, 'integrations', 'codex', 'hooks', 'codex-hook.mjs');
const installer = path.join(root, 'integrations', 'codex', 'scripts', 'install-hooks.mjs');
const checker = path.join(root, 'integrations', 'codex', 'scripts', 'check-hooks.mjs');
const token = 'test-secret-never-output-0123456789abcdefgh';
const hook = (event = 'PermissionRequest', extra = {}) => ({
  hook_event_name: event, session_id: 'session-a', turn_id: 'turn-a', cwd: 'C:\\tasks\\sample',
  tool_name: 'Bash', tool_use_id: 'call-a', tool_input: { command: 'Write-Output hello', description: 'Print a greeting' },
  ...extra,
});

function run(file, args = [], input = '', command = process.execPath, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, command === process.execPath ? [file, ...args] : args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('child exceeded 7 seconds')); }, 7000);
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.on('error', () => {});
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

async function temporary(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'autopets-adapter-test-'));
  t.after(async () => {
    assert.equal(path.dirname(folder), tmpdir());
    assert.ok(path.basename(folder).startsWith('autopets-adapter-test-'));
    await rm(folder, { recursive: true, force: true });
  });
  return folder;
}

async function bridge(t, handle) {
  const folder = await temporary(t);
  const received = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk.toString();
    const request = { path: req.url, method: req.method, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
    received.push(request);
    if (request.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end('{}'); return; }
    const response = await handle(request, received);
    if (response === 'disconnect') { req.socket.destroy(); return; }
    res.writeHead(response?.httpStatus ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response?.body ?? response ?? { ok: true }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const connection = path.join(folder, "connect ' 한글.json");
  await writeFile(connection, JSON.stringify({ version: 1, baseUrl: `http://127.0.0.1:${server.address().port}`, token }));
  const invoke = (input) => run(adapter, ['--connection', connection, '--autopets-hook-v1'], input);
  return { connection, received, invoke, folder };
}

function assertQuiet(result) { assert.equal(result.code, 0); assert.equal(result.stderr, ''); assert.ok(!result.stdout.includes(token)); }

test('permission request is metadata-only and never registers or returns a decision', async (t) => {
  const b = await bridge(t, () => ({ status: 'approved', hookSpecificOutput: { decision: { behavior: 'allow' } } }));
  const result = await b.invoke(hook());
  assertQuiet(result); assert.equal(result.stdout, '{}\n');
  assert.equal(b.received.length, 1); assert.equal(b.received[0].path, '/v1/events');
  const body = b.received[0].body;
  assert.equal(body.kind, 'permission_requested');
  assert.equal(body.sessionId, 'session-a'); assert.equal(body.turnId, 'turn-a');
  assert.match(body.eventId, /^[a-f0-9-]{36}$/u);
  assert.ok(!JSON.stringify(body).includes('Write-Output'));
  assert.equal(body.details, undefined); assert.equal(body.description, undefined);
});

test('permission bridge failures always preserve normal Codex approval flow', async (t) => {
  for (const response of ['disconnect', { httpStatus: 503, body: {} }, { mode: 'pending', expiresAt: Date.now() + 100_000 }, { status: 'denied' }]) {
    const b = await bridge(t, () => response);
    const result = await b.invoke(hook());
    assertQuiet(result); assert.equal(result.stdout, '{}\n');
    assert.equal(b.received.length, 1); assert.equal(b.received[0].path, '/v1/events');
  }
});

test('permission body is never required or exposed for observation', async (t) => {
  const b = await bridge(t, () => ({ ok: true }));
  for (const tool_input of [undefined, {}, { command: 'private'.repeat(20000) }]) {
    const result = await b.invoke(hook('PermissionRequest', { tool_input }));
    assertQuiet(result); assert.equal(result.stdout, '{}\n');
    assert.equal(b.received.at(-1).body.kind, 'permission_requested');
    assert.ok(!JSON.stringify(b.received.at(-1).body).includes('private'));
  }
});

test('all observational events carry metadata only and return empty JSON', async (t) => {
  const b = await bridge(t, () => ({ ok: true }));
  for (const [event, kind] of Object.entries({ SessionStart: 'session_started', UserPromptSubmit: 'turn_started', PreToolUse: 'tool_started', PostToolUse: 'tool_finished', Stop: 'turn_finished', Interrupt: 'interrupted', SessionEnd: 'session_ended' })) {
    const result = await b.invoke(hook(event, { prompt: 'private prompt', last_assistant_message: 'private answer', tool_response: 'private output' }));
    assertQuiet(result); assert.equal(result.stdout, '{}\n');
    const body = b.received.at(-1).body;
    assert.equal(body.kind, kind); assert.ok(Number.isSafeInteger(body.timestamp));
    assert.ok(!JSON.stringify(body).includes('private')); assert.ok(!JSON.stringify(body).includes('Write-Output'));
  }
});

test('observer and synchronous preparation register one logical start across retries and keep A/B separate', async t => {
  const b = await bridge(t, req => req.path === '/v1/events' ? { ok: true } : { httpStatus: 503 });
  const config = { version: 1, enabled: true, validationMode: true, project: await realpath(b.folder), connection: b.connection };
  const input = hook('UserPromptSubmit', { cwd: b.folder, prompt: '합성 입력', model: 'fixture-model' });
  await Promise.all([b.invoke(input), prepare(config, input)]);
  await b.invoke(input);
  const starts = b.received.filter(r => r.path === '/v1/events').map(r => r.body);
  assert.equal(starts.length, 3, 'exercise both independent processes and a delivery retry');
  assert.equal(new Set(starts.map(e => e.eventId)).size, 1, 'receiver can deduplicate the same turn start');
  await b.invoke({ ...input, session_id: 'session-b' });
  await b.invoke({ ...input, turn_id: 'turn-b' });
  const all = b.received.filter(r => r.path === '/v1/events').map(r => r.body);
  assert.equal(new Set(all.map(e => e.eventId)).size, 3);
  assert.ok(all.every(e => !JSON.stringify(e).includes('합성 입력')));
});

test('terminal hook delivery is synchronous and waits for the receiver before finishing', async t => {
  const legacy = updateConfig({}, 'install', hookCommands('node', adapter, 'connection'));
  const bundled = handlers('node', 'user-hook.mjs');
  assert.notEqual(legacy.hooks.Stop[0].hooks[0].async, true);
  assert.notEqual(bundled.Stop[0].async, true);
  let release, arrived;
  const entered = new Promise(resolve => { arrived = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const b = await bridge(t, async () => { arrived(); await gate; return { ok: true }; });
  let settled = false;
  const delivery = b.invoke(hook('Stop')).then(r => { settled = true; return r; });
  await entered;
  assert.equal(settled, false);
  release();
  const result = await delivery;
  assertQuiet(result); assert.equal(result.stdout, '{}\n');
  assert.equal(b.received[0].body.kind, 'turn_finished');
});

test('subagent stop, malformed identities, and incomplete requests never contact bridge', async (t) => {
  const b = await bridge(t, () => ({ ok: true }));
  for (const input of ['not json', null, [], hook('SubagentStop'), hook('NewUnknownHook'),
    hook('PermissionRequest', { turn_id: undefined }), hook('PermissionRequest', { session_id: '' }),
    hook('PermissionRequest', { tool_name: undefined }), hook('PermissionRequest', { tool_name: '' }),
    hook('PreToolUse', { tool_use_id: undefined })]) {
    const result = await b.invoke(input === null ? 'null' : input);
    assertQuiet(result); assert.equal(result.stdout, '{}\n');
  }
  assert.equal(b.received.length, 0);
});

test('oversize input falls through before any metadata is sent', async (t) => {
  const b = await bridge(t, () => ({ ok: true }));
  for (const length of [270_000, 280_000]) {
    const result = await b.invoke(hook('PermissionRequest', { tool_input: { command: 'x'.repeat(length) } }));
    assertQuiet(result); assert.equal(result.stdout, '{}\n');
  }
  assert.equal(b.received.length, 0);
});

test('connection file cannot redirect bearer credentials away from exact loopback', async (t) => {
  const b = await bridge(t, () => ({ ok: true }));
  for (const baseUrl of ['http://localhost:1234', 'http://127.0.0.2:1234', 'https://127.0.0.1:1234', 'http://127.0.0.1:1234/path', 'http://127.0.0.1:1234@evil.test']) {
    await writeFile(b.connection, JSON.stringify({ version: 1, baseUrl, token }));
    const result = await b.invoke(hook());
    assertQuiet(result); assert.equal(result.stdout, '{}\n');
  }
  assert.equal(b.received.length, 0);
});

test('installer dry run, idempotent install, preservation, backup and uninstall', async (t) => {
  const project = await temporary(t);
  const configDir = path.join(project, '.codex');
  await mkdir(configDir);
  const original = { description: 'Keep this', extension: { keep: true }, hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo user-hook', timeout: 12 }] }] } };
  const target = path.join(configDir, 'hooks.json');
  await writeFile(target, JSON.stringify(original));
  const connection = path.join(project, "app data ' 한글", 'connection.json');
  const args = ['install', '--project', project, '--connection', connection];
  let result = await run(installer, [...args, '--dry-run']);
  assert.equal(result.code, 0); assert.equal(JSON.parse(result.stdout).autoPetsHandlers, 8);
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), original);
  result = await run(installer, args); assert.equal(result.code, 0);
  let config = JSON.parse(await readFile(target, 'utf8'));
  assert.equal(config.description, original.description); assert.deepEqual(config.extension, original.extension);
  assert.deepEqual(config.hooks.Stop[0], original.hooks.Stop[0]);
  for (const event of EVENTS) assert.equal(config.hooks[event].flatMap((group) => group.hooks).filter(isAutoPetsHandler).length, 1);
  assert.equal(config.hooks.PermissionRequest[0].hooks[0].timeout, 5);
  assert.equal(config.hooks.PermissionRequest[0].hooks[0].async, undefined);
  assert.equal(config.hooks.Stop.at(-1).hooks[0].async, undefined);
  assert.equal(config.hooks.SessionEnd[0].hooks[0].async, undefined);
  result = await run(installer, args); assert.equal(JSON.parse(result.stdout).changed, false);
  const backups = (await readdir(configDir)).filter((name) => name.includes('backup'));
  assert.equal(backups.length, 1); assert.deepEqual(JSON.parse(await readFile(path.join(configDir, backups[0]), 'utf8')), original);
  result = await run(checker, ['--project', project]); assert.equal(JSON.parse(result.stdout).complete, true);
  result = await run(installer, ['uninstall', '--project', project]); assert.equal(result.code, 0);
  config = JSON.parse(await readFile(target, 'utf8')); assert.deepEqual(config, original);
  result = await run(installer, ['uninstall', '--project', project]); assert.equal(JSON.parse(result.stdout).changed, false);
});

test('ownership marker cannot delete a user command with a similar label', () => {
  assert.equal(isAutoPetsHandler({ type: 'command', command: "echo '--autopets-hook-v1'", statusMessage: STATUS }), false);
  const commands = hookCommands(process.execPath, "C:\\team's app\\codex-hook.mjs", "C:\\team's app\\connection.json");
  assert.equal(isAutoPetsHandler({ type: 'command', ...commands, statusMessage: STATUS }), true);
  assert.equal(isAutoPetsHandler({ type: 'command', ...commands, command: `${commands.command} ; echo malicious`, statusMessage: STATUS }), false);
});

test('generated Windows command executes adapter through paths with spaces and apostrophes', { skip: process.platform !== 'win32' }, async (t) => {
  const b = await bridge(t, () => ({ ok: true }));
  const { commandWindows } = hookCommands(process.execPath, adapter, b.connection);
  const [command, ...args] = commandWindows.split(' ');
  const result = await run(null, args, hook('Stop'), command);
  assertQuiet(result); assert.equal(result.stdout, '{}\n'); assert.equal(b.received.length, 1);
});

test('successful real update_plan preserves structured steps only', async (t) => {
  const b = await bridge(t, () => ({ ok: true }));
  const plan = [{ step: '자료 읽기', status: 'completed' }, { step: '보고서 쓰기', status: 'in_progress' }, { step: '확인', status: 'pending' }];
  const result = await b.invoke(hook('PostToolUse', {
    tool_name: 'update_plan', tool_response: 'Plan updated',
    tool_input: { plan, explanation: 'Private explanation excluded', access_token: 'private-key' },
  }));
  assertQuiet(result); assert.equal(result.stdout, '{}\n');
  const body = b.received[0].body;
  assert.equal(body.kind, 'tool_finished'); assert.deepEqual(body.plan, { steps: plan });
  assert.equal(body.activity, 'working');
  assert.ok(!JSON.stringify(body).includes('private-key'));
  assert.ok(!JSON.stringify(body).includes('Private explanation'));
  assert.ok(!Object.hasOwn(body, 'tokens'));
});

test('only confirmed supported plan updates change plan data', async (t) => {
  const b = await bridge(t, () => ({ ok: true }));
  const good = { tool_name: 'update_plan', tool_input: { plan: [{ step: 'Test', status: 'pending' }] }, tool_response: 'Plan updated' };
  const inputs = [
    hook('PreToolUse', good),
    hook('PostToolUse', { ...good, tool_name: 'other_tool' }),
    hook('PostToolUse', { ...good, tool_response: 'Plan update failed' }),
    hook('PostToolUse', { ...good, tool_response: { isError: true, content: 'Plan updated' } }),
    hook('PostToolUse', { ...good, tool_response: { success: true } }),
    hook('PostToolUse', { ...good, tool_input: { plan: [{ step: 'Test', status: 'invented' }] } }),
    hook('PostToolUse', { ...good, tool_input: { plan: [{ step: ' ', status: 'pending' }] } }),
    hook('PostToolUse', { ...good, tool_input: { plan: [{ step: 'One', status: 'in_progress' }, { step: 'Two', status: 'in_progress' }] } }),
    hook('PostToolUse', { ...good, tool_input: { plan: Array.from({ length: 51 }, () => ({ step: 'Test', status: 'pending' })) } }),
  ];
  for (const input of inputs) {
    const result = await b.invoke(input); assertQuiet(result);
    assert.equal(b.received.at(-1).body.plan, undefined);
  }
  await b.invoke(hook('PostToolUse', { ...good, tool_input: { plan: [] } }));
  assert.deepEqual(b.received.at(-1).body.plan, { steps: [] });
});

test('activity uses exact tool names without exposing or interpreting shell text', async (t) => {
  const b = await bridge(t, () => ({ ok: true }));
  for (const [tool_name, activity] of [['Read', 'research'], ['apply_patch', 'writing'], ['Bash', 'tool'], ['unknown_read_everything', 'working']]) {
    const result = await b.invoke(hook('PreToolUse', { tool_name,
      tool_input: { command: 'PRIVATE_SHELL_TEXT', file_path: 'PRIVATE_DOCUMENT_PATH' } }));
    assertQuiet(result);
    assert.equal(b.received.at(-1).body.activity, activity);
    assert.ok(!JSON.stringify(b.received.at(-1).body).includes('PRIVATE_'));
  }
});

test('tool error requires exact structured PostToolUse isError true', async (t) => {
  const b = await bridge(t, () => ({ ok: true }));
  for (const [event, tool_response, expected] of [
    ['PostToolUse', { isError: true, content: 'PRIVATE_ERROR_BODY' }, true],
    ['PostToolUse', { isError: false }, undefined],
    ['PostToolUse', { isError: 'true' }, undefined],
    ['PostToolUse', 'isError: true; exit code 1; failed', undefined],
    ['PostToolUse', { exitCode: 1 }, undefined],
    ['PreToolUse', { isError: true }, undefined],
  ]) {
    const result = await b.invoke(hook(event, { tool_response }));
    assertQuiet(result); assert.equal(result.stdout, '{}\n');
    const body = b.received.at(-1).body;
    assert.equal(body.toolError, expected);
    assert.ok(!JSON.stringify(body).includes('PRIVATE_ERROR_BODY'));
  }
});

const taskCli = path.join(root, 'integrations', 'codex', 'skills', 'autopets', 'scripts', 'connect.mjs');
const taskConfig = { completionCriterion: '비교 보고서와 근거 링크 완성', interventionMode: 'when-needed' };
const currentTask = { sessionId: 'session-a', turnId: 'turn-a', cwd: root.replace(/[\\/]+$/u, '') };
async function configFile(folder, config = taskConfig) {
  const file = path.join(folder, 'task-config.json'); await writeFile(file, JSON.stringify(config)); return file;
}
function taskRun(args, env = {}, file = taskCli) {
  return run(file, args, '', process.execPath, { cwd: root, env: { ...process.env, CODEX_THREAD_ID: 'session-a', ...env } });
}

test('skill context identifies only current observed task and does not configure', async (t) => {
  const b = await bridge(t, () => currentTask);
  const result = await taskRun(['context', '--connection', b.connection]);
  assert.equal(result.code, 0); const output = JSON.parse(result.stdout);
  assert.equal(output.configured, false); assert.equal(output.sessionId, 'session-a');
  assert.equal(b.received.length, 1); assert.equal(b.received[0].method, 'GET');
  const query = new URL(b.received[0].path, 'http://127.0.0.1').searchParams;
  assert.equal(query.get('sessionId'), 'session-a'); assert.equal(query.get('cwd'), currentTask.cwd);
  assert.ok(!result.stdout.includes(token));
});

test('skill configure defaults to 10 minutes and is idempotent across processes', async (t) => {
  const b = await bridge(t, (req) => req.method === 'GET' ? currentTask : { ok: true, sessionId: 'session-a', slot: 1 });
  const file = await configFile(b.folder);
  const args = ['configure', '--connection', b.connection, '--config', file];
  const first = await taskRun(args); const second = await taskRun(args);
  assert.equal(first.code, 0); assert.equal(second.code, 0);
  const posts = b.received.filter((req) => req.method === 'POST');
  assert.equal(posts.length, 2); assert.deepEqual(posts[0].body, posts[1].body);
  assert.match(posts[0].body.requestId, /^config-[a-f0-9]{64}$/u);
  assert.equal(posts[0].body.elapsedAlertMinutes, 10);
  assert.equal(posts[0].body.completionCriterion, taskConfig.completionCriterion);
  assert.deepEqual(JSON.parse(first.stdout), { ok: true, operation: 'configure', sessionId: 'session-a', slot: 1,
    elapsedAlertMinutes: 10, interventionMode: 'when-needed', taskTokenUsage: 'unavailable', taskInterrupt: 'manual-in-codex' });
  assert.ok(!first.stdout.includes(token)); assert.ok(!first.stdout.includes(taskConfig.completionCriterion));
});

test('skill allows explicit milestone mode and disabled time alerts', async (t) => {
  const b = await bridge(t, (req) => req.method === 'GET' ? currentTask : { ok: true, sessionId: 'session-a', slot: 0 });
  const file = await configFile(b.folder, { ...taskConfig, interventionMode: 'milestones', elapsedAlertMinutes: null });
  const result = await taskRun(['configure', '--connection', b.connection, '--config', file]);
  assert.equal(result.code, 0); assert.equal(b.received[1].body.elapsedAlertMinutes, null);
  assert.equal(b.received[1].body.interventionMode, 'milestones');
});

test('skill retries uncertain configuration with unchanged request ID', async (t) => {
  let posts = 0;
  const b = await bridge(t, (req) => req.method === 'GET' ? currentTask
    : ++posts === 1 ? 'disconnect' : { ok: true, sessionId: 'session-a', slot: 0 });
  const file = await configFile(b.folder);
  const result = await taskRun(['configure', '--connection', b.connection, '--config', file]);
  assert.equal(result.code, 0); assert.equal(posts, 2);
  assert.deepEqual(b.received[1].body, b.received[2].body);
});

test('skill never configures a mismatched task or project', async (t) => {
  for (const wrong of [{ ...currentTask, sessionId: 'someone-else' }, { ...currentTask, cwd: path.parse(root).root }, { ...currentTask, turnId: '' }]) {
    const b = await bridge(t, () => wrong); const file = await configFile(b.folder);
    const result = await taskRun(['configure', '--connection', b.connection, '--config', file]);
    assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).code, 'wrong-task');
    assert.equal(b.received.length, 1);
  }
});

test('skill refuses absent current identity, forged flags and unsupported config fields', async (t) => {
  const b = await bridge(t, () => currentTask);
  let result = await taskRun(['context', '--connection', b.connection], { CODEX_THREAD_ID: '' });
  assert.equal(JSON.parse(result.stdout).code, 'current-task-unavailable');
  result = await taskRun(['context', '--connection', b.connection, '--session', 'someone-else']);
  assert.equal(result.code, 1);
  for (const config of [{ ...taskConfig, sessionId: 'someone-else' }, { ...taskConfig, taskTokens: 100 }, { ...taskConfig, elapsedAlertMinutes: 0 }]) {
    const file = await configFile(b.folder, config);
    result = await taskRun(['configure', '--connection', b.connection, '--config', file]);
    assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).configured, false);
  }
  assert.equal(b.received.length, 0);
});

test('skill reports auth, unobserved and slot conflicts without printing server content', async (t) => {
  for (const status of [401, 403, 404, 409]) {
    const b = await bridge(t, () => ({ httpStatus: status, body: { error: token } }));
    const result = await taskRun(['context', '--connection', b.connection]);
    assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout).ok, false);
    assert.ok(!result.stdout.includes(token)); assert.equal(b.received.length, 1);
  }
});

test('distributed skill scripts work independently of repository paths', async (t) => {
  const b = await bridge(t, () => currentTask);
  const standalone = path.join(b.folder, 'standalone-skill'); await mkdir(standalone);
  for (const name of ['connect.mjs', 'bridge-client.mjs']) {
    await writeFile(path.join(standalone, name), await readFile(path.join(root, 'integrations', 'codex', 'skills', 'autopets', 'scripts', name)));
  }
  const result = await taskRun(['context', '--connection', b.connection], {}, path.join(standalone, 'connect.mjs'));
  assert.equal(result.code, 0); assert.equal(JSON.parse(result.stdout).observed, true);
});

test('legacy and canonical hooks preserve stdin/stdout and observed event content', async (t) => {
  const b = await bridge(t, () => ({ ok: true }));
  const legacy = path.join(root, 'hooks', 'codex-hook.mjs');
  const args = ['--connection', b.connection, '--autopets-hook-v1'];
  for (const input of [hook('PermissionRequest'), hook('PostToolUse', {
    tool_name: 'update_plan', tool_input: { plan: [{ step: 'Actual plan', status: 'in_progress' }] }, tool_response: 'Plan updated',
  })]) {
    const before = b.received.length;
    const oldResult = await run(legacy, args, input);
    const newResult = await run(adapter, args, input);
    assert.deepEqual(oldResult, newResult); assertQuiet(oldResult);
    const content = ({ eventId, timestamp, ...body }) => body;
    assert.deepEqual(content(b.received[before].body), content(b.received[before + 1].body));
  }
  assert.deepEqual(await run(legacy, args, 'invalid'), await run(adapter, args, 'invalid'));
});

test('old and new CLI entrypoints preserve errors and current task cwd', async (t) => {
  for (const name of ['install-hooks', 'check-hooks', 'feasibility-probe', 'autopets-task']) {
    assert.deepEqual(await run(path.join(root, 'scripts', `${name}.mjs`)),
      await run(path.join(root, 'integrations', 'codex', 'scripts', `${name}.mjs`)));
  }
  const b = await bridge(t, () => currentTask);
  const args = ['context', '--connection', b.connection];
  const files = [taskCli, path.join(root, 'skills', 'autopets', 'scripts', 'connect.mjs'),
    path.join(root, 'scripts', 'autopets-task.mjs'), path.join(root, 'integrations', 'codex', 'scripts', 'autopets-task.mjs')];
  const results = [];
  for (const file of files) results.push(await taskRun(args, {}, file));
  assert.ok(results.every(result => result.code === 0));
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal(b.received.length, files.length);
  for (const request of b.received) assert.equal(new URL(request.path, 'http://127.0.0.1').searchParams.get('cwd'), currentTask.cwd);
});
