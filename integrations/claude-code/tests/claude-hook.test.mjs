import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { eventFor, activityFor } from '../hooks/claude-hook.mjs';
import { packageClaudeCodePlugin } from '../../../scripts/package-claude-code-plugin.mjs';

// Mirrors the Rust ClaudeCodeEvent (deny_unknown_fields) so drift fails here too.
const ALLOWED = new Set(['eventId', 'sessionId', 'turnId', 'kind', 'cwd', 'toolName', 'toolCallId', 'timestamp', 'activity', 'toolError']);
const KINDS = new Set(['session_started', 'turn_started', 'tool_started', 'tool_finished', 'permission_requested', 'turn_finished', 'interrupted', 'session_ended']);
const session = '7f6e5d4c-3b2a-4190-8877-665544332211';
const prompt = '550e8400-e29b-41d4-a716-446655440000';
const cwd = process.platform === 'win32' ? 'C:\\합성 프로젝트\\시험' : '/tmp/합성 프로젝트/시험';
const base = { session_id: session, prompt_id: prompt, transcript_path: '/private/transcript.jsonl', cwd, permission_mode: 'default' };

test('a Claude Code turn maps to metadata-only pet activity', () => {
  const turn = [
    { ...base, hook_event_name: 'SessionStart', source: 'startup', prompt_id: undefined },
    { ...base, hook_event_name: 'UserPromptSubmit', prompt: '비밀 요청 내용' },
    { ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'toolu_1', tool_input: { file_path: '/secret' } },
    { ...base, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'toolu_1', tool_response: { content: 'secret' } },
    { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_2', tool_input: { command: 'rm -rf /' } },
    { ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
    { ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'toolu_2', error: 'denied' },
    { ...base, hook_event_name: 'Stop', last_assistant_message: '완료 내용' },
    { ...base, hook_event_name: 'SessionEnd', reason: 'other' },
  ].map(input => eventFor(input, 1000));
  assert.deepEqual(turn.map(event => event.kind), ['session_started', 'turn_started', 'tool_started', 'tool_finished', 'tool_started', 'permission_requested', 'tool_finished', 'turn_finished', 'session_ended']);
  assert.equal(turn[2].activity, 'research');
  assert.equal(turn[4].activity, 'tool');
  assert.equal(turn[6].toolError, true);
  assert.equal(turn[0].turnId, undefined);
  assert.ok(turn.slice(1, -1).every(event => event.turnId === prompt));
  for (const event of turn) {
    assert.ok(Object.keys(event).every(key => ALLOWED.has(key)), Object.keys(event).join());
    assert.ok(KINDS.has(event.kind));
    assert.match(event.eventId, /^[0-9a-f]{64}$/u);
  }
  const text = JSON.stringify(turn);
  for (const secret of ['비밀 요청', '/secret', 'rm -rf', '완료 내용', 'transcript', 'denied']) assert.equal(text.includes(secret), false, secret);
  assert.equal(eventFor({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'toolu_1' }, 9).eventId, turn[2].eventId, 'retries deduplicate');
  assert.notEqual(turn[2].eventId, turn[3].eventId);
});

test('subagents, unknown events and incomplete input never reach the app', () => {
  for (const input of [
    null, [], { ...base, hook_event_name: 'Notification' }, { ...base, hook_event_name: 'SubagentStop' },
    { ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 't', agent_id: 'a1' },
    { ...base, hook_event_name: 'Stop', agent_type: 'Explore' },
    { ...base, hook_event_name: 'UserPromptSubmit', prompt_id: undefined },
    { ...base, hook_event_name: 'Stop', cwd: 'relative/path' },
    { ...base, hook_event_name: 'PreToolUse', tool_name: 'Read' },
    { ...base, hook_event_name: 'Stop', session_id: 'bad\nid' },
    { ...base, hook_event_name: 'toString' },
  ]) assert.equal(eventFor(input), null, JSON.stringify(input));
  assert.equal(activityFor('Write'), 'writing');
  assert.equal(activityFor('mcp__x__y'), 'working');
});

test('packaged plugin hook runs without a shell, prints nothing and fails open', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-claude-code-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const { directory } = await packageClaudeCodePlugin({ out: path.join(dir, 'marketplace') });
  const hooks = JSON.parse(await fs.readFile(path.join(directory, 'autopets/hooks/hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'StopFailure', 'UserPromptSubmit']);
  const pluginRoot = path.join(directory, 'autopets');
  const [hook] = hooks.Stop[0].hooks;
  const args = hook.args.map(arg => arg.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot.replaceAll('\\', '/')));

  const token = 'a'.repeat(48);
  const received = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      received.push({ url: request.url, auth: request.headers.authorization, body: JSON.parse(body) });
      response.setHeader('content-type', 'application/json');
      response.end('{"ok":true}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const data = path.join(dir, 'data');
  await fs.mkdir(data);
  await fs.writeFile(path.join(data, 'connection.json'), JSON.stringify({ version: 1, token, baseUrl: `http://127.0.0.1:${server.address().port}` }));

  const run = async (input, environment) => {
    const child = spawn(hook.command, args, { env: { PATH: process.env.PATH, ...environment }, windowsHide: true });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stdin.end(JSON.stringify(input));
    const [code] = await once(child, 'exit');
    return { code, stdout };
  };
  const stop = { ...base, hook_event_name: 'Stop', last_assistant_message: '완료' };
  assert.deepEqual(await run(stop, { AUTOPETS_DATA_DIR: data }), { code: 0, stdout: '' });
  assert.equal(received.length, 1);
  assert.equal(received[0].url, '/v1/claude-code/events');
  assert.equal(received[0].auth, `Bearer ${token}`);
  assert.equal(received[0].body.kind, 'turn_finished');
  assert.equal(received[0].body.turnId, prompt);

  const started = Date.now();
  assert.deepEqual(await run(stop, { AUTOPETS_DATA_DIR: path.join(dir, 'closed-app') }), { code: 0, stdout: '' });
  assert.deepEqual(await run('not json', { AUTOPETS_DATA_DIR: data }), { code: 0, stdout: '' });
  assert.ok(Date.now() - started < 4000);
  assert.equal(received.length, 1, 'closed app and bad input send nothing');
});

test('the connection written by AutoPets wins over defaults', async () => {
  const { connectionPath } = await import('../hooks/claude-hook.mjs');
  const own = path.resolve('/autopets-dev/connection.json');
  assert.equal(connectionPath({ AUTOPETS_DATA_DIR: path.resolve('/other') }, ['--connection', own]), own);
  assert.equal(connectionPath({ AUTOPETS_CONNECTION_FILE: path.resolve('/env.json') }, []), path.resolve('/env.json'));
  assert.equal(connectionPath({ LOCALAPPDATA: path.resolve('/local') }, ['--connection', 'relative.json']), path.join(path.resolve('/local'), 'local.autopets.desktop', 'connection.json'));
  assert.equal(connectionPath({}, []), null);
});
