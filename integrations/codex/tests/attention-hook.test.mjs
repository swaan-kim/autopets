import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { hookEvent, interpret, deliver, toolKey, readTurn, chatTitle, main, ATTENTION_HOOK_MARKER } from '../hooks/attention-hook.mjs';
import { mergeAttentionHooks, attentionHandler, attentionHookState, configureAttentionHook, ATTENTION_STATUS } from '../bootstrap/attention-hook.mjs';
import { recommendationHandler, mergeRecommendationHook } from '../bootstrap/recommendation-hook.mjs';

const session = '01a1d04a-16f2-7522-9ce2-b3a7b57e8791';
const turn = '01a1d04a-172a-7061-b9bc-d712a11accc2';
const base = (name, extra = {}) => ({ hook_event_name: name, session_id: session, turn_id: turn, cwd: path.resolve('/work'), model: 'gpt-5.6-sol', permission_mode: 'default', transcript_path: null, ...extra });
const NO_WORK = { available: true, fileChanges: 0, workCommands: 0, tools: 0, delegated: 0, plan: null, userPrompt: null, reviewer: 'user' };
const reader = digest => async () => digest;
const fakeBridge = (eligible = true) => { const calls = []; return { calls, request: async (url, body) => { calls.push({ url, body });
  return body.operation === 'check' ? (eligible ? { ok: true, eligible: true } : { ok: true, eligible: false, reason: 'chat-not-connected' }) : { ok: true, resolved: 0 }; } }; };

test('only top-level hook events with a real chat and turn are handled', () => {
  assert.equal(hookEvent(base('Stop')).name, 'Stop');
  for (const value of [base('Stop', { agent_id: 'child' }), base('Stop', { session_id: 'abc' }), base('Stop', { turn_id: '' }), base('SessionStart'), base('SubagentStop'), null, 'x'])
    assert.equal(hookEvent(value), null);
});

test('a plan awaiting the go-ahead becomes an action_required notice; the turn end is also reported', async () => {
  const outcome = await interpret(hookEvent(base('Stop', { last_assistant_message: '## 구현 계획\n- 헤더\n- 일정\n- 신청\n\n이 계획으로 진행하려면 “그대로 구현해줘”라고 말씀해 주세요.' })), { read: reader(NO_WORK) });
  assert.equal(outcome.resolve.cause, 'turn-ended');
  assert.deepEqual([outcome.notice.kind, outcome.notice.reason, outcome.notice.source], ['action_required', 'confirmation_required', 'stop']);
});

test('finished work becomes a completed notice with evidence; an explanation sends only the turn end', async () => {
  const done = await interpret(hookEvent(base('Stop', { last_assistant_message: 'index.html을 만들었습니다.' })), { read: reader({ ...NO_WORK, fileChanges: 1 }) });
  assert.deepEqual([done.notice.kind, done.notice.evidence], ['completed', { fileChanges: 1, workCommands: 0, verified: true }]);
  const plain = await interpret(hookEvent(base('Stop', { last_assistant_message: 'useEffect는 렌더링 뒤에 실행됩니다.' })), { read: reader(NO_WORK) });
  assert.equal(plain.notice, undefined); assert.equal(plain.resolve.cause, 'turn-ended');
});

test('approval prompts notify, except the ones Codex sends to its automatic reviewer', async () => {
  const input = base('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'node -v', description: '버전 확인' } });
  const shown = await interpret(hookEvent(input), { read: reader(NO_WORK) });
  assert.equal(shown.notice.reason, 'approval_required');
  assert.equal(shown.notice.toolKey, toolKey('Bash', { command: 'node -v' }));
  const auto = await interpret(hookEvent(input), { read: reader({ ...NO_WORK, reviewer: 'auto_review' }) });
  assert.equal(auto.notice, undefined); assert.equal(auto.skipped, 'automatic-review');
});

test('the approved tool finishing and the answered question carry the matching keys', async () => {
  const post = await interpret(hookEvent(base('PostToolUse', { tool_name: 'Bash', tool_use_id: 'exec-1', tool_input: { command: 'node -v' }, tool_response: 'v24' })));
  assert.deepEqual([post.resolve.cause, post.resolve.toolKey, post.resolve.toolUseId], ['tool-finished', toolKey('Bash', { command: 'node -v' }), 'exec-1']);
  const ask = await interpret(hookEvent(base('PreToolUse', { tool_name: 'request_user_input', tool_use_id: 'call_1', tool_input: { questions: [{ id: 'a', question: '어떤 성격인가요?' }] } })));
  assert.deepEqual([ask.notice.reason, ask.notice.source, ask.notice.toolUseId], ['question', 'user-input', 'call_1']);
  assert.deepEqual(await interpret(hookEvent(base('PreToolUse', { tool_name: 'Bash', tool_input: {} }))), {});
  assert.equal((await interpret(hookEvent(base('UserPromptSubmit', { prompt: '그대로 구현해줘' })))).resolve.cause, 'user-message');
});

test('no notice text is sent for a chat that is not connected; resolutions are ids only', async () => {
  const outcome = await interpret(hookEvent(base('Stop', { last_assistant_message: '어떤 디자인으로 진행할까요? 비밀 프로젝트 A' })), { read: reader(NO_WORK) });
  const bridge = fakeBridge(false);
  const sent = await deliver(outcome, bridge.request, { title: async () => '비밀 채팅' });
  assert.equal(sent.notice, 'chat-not-connected');
  assert.deepEqual(bridge.calls.map(call => call.body.operation), ['resolve', 'check']);
  assert.equal(JSON.stringify(bridge.calls).includes('비밀'), false);
  const connected = fakeBridge(true);
  await deliver(outcome, connected.request, { title: async () => '행사 페이지' });
  const notify = connected.calls.find(call => call.body.operation === 'notify').body;
  assert.equal(notify.chatTitle, '행사 페이지'); assert.match(notify.fingerprint, /^[0-9a-f]{64}$/u);
  assert.ok(notify.summary.length <= 160);
});

test('the transcript is read only inside CODEX_HOME and only for the same chat', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-attention-'));
  const day = path.join(home, 'sessions', '2026', '11', '13'); await fs.mkdir(day, { recursive: true });
  const file = path.join(day, `rollout-2026-11-13T00-00-00-${session}.jsonl`);
  await fs.writeFile(file, [{ type: 'turn_context', payload: { turn_id: turn, approvals_reviewer: 'user' } },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'FileChange', changes: { 'a.txt': {} } } } }].map(line => JSON.stringify(line)).join('\n'));
  const env = { CODEX_HOME: home };
  assert.equal((await readTurn({ sessionId: session, turnId: turn, transcriptPath: file }, env)).fileChanges, 1);
  assert.equal((await readTurn({ sessionId: '01a1d04a-0000-7000-8000-000000000000', turnId: turn, transcriptPath: file }, env)).available, false);
  assert.equal((await readTurn({ sessionId: session, turnId: turn, transcriptPath: file }, { CODEX_HOME: path.join(home, 'other') })).available, false);
  // Codex Desktop may pass a verbatim (\\?\) path, an upper/lower-case drive or no path at all.
  if (process.platform === 'win32') {
    assert.equal((await readTurn({ sessionId: session, turnId: turn, transcriptPath: `\\\\?\\${file}` }, env)).transcript, 'given');
    assert.equal((await readTurn({ sessionId: session, turnId: turn, transcriptPath: file.replace(/^[a-z]/iu, c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) }, env)).transcript, 'given');
  }
  const byId = await readTurn({ sessionId: session, turnId: turn, transcriptPath: null }, env);
  assert.deepEqual([byId.transcript, byId.fileChanges], ['found-by-id', 1]);
  assert.equal((await readTurn({ sessionId: session, turnId: 'other-turn', transcriptPath: file }, env)).transcript, 'turn-not-found');
  await fs.writeFile(path.join(home, 'session_index.jsonl'), `${JSON.stringify({ id: session, thread_name: '옛 이름' })}\n${JSON.stringify({ id: session, thread_name: '학과 행사 페이지' })}\n`);
  assert.equal(await chatTitle(session, env), '학과 행사 페이지');
  await fs.rm(home, { recursive: true, force: true });
});

test('the hook always prints {} and never fails Codex', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-attention-main-'));
  const env = { AUTOPETS_ATTENTION_TRACE_DIR: dir, LOCALAPPDATA: dir, CODEX_HOME: dir };
  const write = process.stdout.write; let printed = '';
  process.stdout.write = chunk => { printed += chunk; return true; };
  try {
    await main(['--connection', path.join(dir, 'missing.json'), ATTENTION_HOOK_MARKER], Readable.from([JSON.stringify(base('Stop', { last_assistant_message: '진행할까요?' }))]), env);
    await main(['bad'], Readable.from(['{}']), env);
    await main(['--connection', path.join(dir, 'missing.json'), ATTENTION_HOOK_MARKER], Readable.from(['not json']), env);
  } finally { process.stdout.write = write; }
  assert.equal(printed, '{}\n{}\n{}\n');
  const trace = (await fs.readFile(path.join(dir, 'attention-trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(trace[0].kind, 'action_required:confirmation_required');
  assert.equal(JSON.stringify(trace).includes('진행할까요'), false);
  await fs.rm(dir, { recursive: true, force: true });
});

test('enable adds only async attention handlers and keeps every other hook; disable removes only them', async () => {
  const node = path.resolve('/node.exe'); const script = path.resolve('/a/attention-hook.mjs'); const connection = path.resolve('/c/connection.json');
  const recommend = recommendationHandler(node, path.resolve('/a/recommend-hook.mjs'), connection);
  const other = { type: 'command', command: 'echo mine', statusMessage: 'mine' };
  const config = { hooks: { UserPromptSubmit: [{ hooks: [recommend] }], Stop: [{ hooks: [other] }] } };
  const enabled = mergeAttentionHooks(config, attentionHandler(node, script, connection));
  assert.equal(attentionHookState(enabled).installed, true);
  assert.deepEqual(enabled.hooks.UserPromptSubmit[0], { hooks: [recommend] });
  assert.deepEqual(enabled.hooks.Stop[0], { hooks: [other] });
  assert.equal(enabled.hooks.PreToolUse[0].matcher, '^request_user_input$');
  for (const groups of Object.values(enabled.hooks)) for (const group of groups) for (const hook of group.hooks) if (hook.statusMessage === ATTENTION_STATUS) assert.equal(hook.async, true);
  assert.deepEqual(mergeAttentionHooks(mergeAttentionHooks(enabled, attentionHandler(node, script, connection)), null), config);
  // The recommendation hook's own enable/disable leaves the attention hooks alone.
  assert.equal(attentionHookState(mergeRecommendationHook(enabled, null)).installed, true);
});

test('configure writes a backup and refuses malformed files', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-attention-cfg-'));
  const env = { CODEX_HOME: home };
  const options = { env, node: path.resolve('/node.exe'), script: path.resolve('/a/attention-hook.mjs'), connection: path.resolve('/c/connection.json'), now: () => 1 };
  await fs.writeFile(path.join(home, 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'keep' }] }] } }));
  const enabled = await configureAttentionHook({ ...options, enable: true });
  assert.equal(enabled.changed, true); assert.ok(enabled.backup); assert.equal(enabled.trustReviewedByUser, false);
  const disabled = await configureAttentionHook({ ...options, enable: false, now: () => 2 });
  assert.equal(disabled.installed, false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(home, 'hooks.json'), 'utf8')), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'keep' }] }] } });
  await fs.writeFile(path.join(home, 'hooks.json'), JSON.stringify({ hooks: { Stop: 'bad' } }));
  await assert.rejects(configureAttentionHook({ ...options, enable: true, now: () => 3 }), /hooks-format/u);
  await fs.rm(home, { recursive: true, force: true });
});
