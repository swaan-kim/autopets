import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { PROFILES, renderAgentProfiles, selectProfile, delegationEvent } from '../runtime/delegation.mjs';
import { prepare } from '../assistance/prepare.mjs';
import { preflightSubmission, submissionEvidence } from '../assistance/workflow.mjs';
import { chatConfig } from '../bootstrap/user-hook.mjs';
import { runHookOnce } from '../bootstrap/deduplicate.mjs';

const models = ['gpt-6-luna', 'gpt-6-sol'].map(model => ({ model, supportedReasoningEfforts: ['low', 'medium'] }));
const input = { session_id: 'parent-a', agent_id: 'child-a', agent_type: PROFILES.light.name, turn_id: 'reported-turn',
  cwd: path.resolve('synthetic 한글 project'), hook_event_name: 'SubagentStart', model: 'gpt-6-luna' };

test('fixed routing uses available catalog, a one-request override, and no quoted instructions', () => {
  assert.equal(selectProfile('이번만 꼼꼼하게: 구현', 'light', models).key, 'careful');
  assert.equal(selectProfile('다음 구현', 'light', models).key, 'light');
  assert.equal(selectProfile('인용문\n이번만 꼼꼼하게', 'light', models).key, 'light');
  assert.equal(selectProfile('> 이번만 꼼꼼하게', 'light', models).key, 'light');
  assert.equal(selectProfile('계획만: 파일 수정 계획', 'standard', models).profile.readOnly, true);
  assert.throws(() => selectProfile('이번만 꼼꼼하게', 'light', [models[0]]), /unavailable/);
  assert.throws(() => selectProfile('작업', 'unknown', models), /unsupported/);
  assert.throws(() => selectProfile('작업', 'light', [...models, models[0]]), /unavailable/);
});

test('profiles pin model and effort, prevent recursive delegation, and do not grant permissions', () => {
  const options = { models, skillPath: path.resolve('한글 skill/SKILL.md'), roleInstruction: '선택한 역할을 수행하고 검증하세요.' };
  const a = renderAgentProfiles(options), b = renderAgentProfiles(options);
  assert.deepEqual(a, b); assert.equal(a.length, 4);
  for (const file of a) {
    assert.match(file.content, /\[agents\]\nenabled = false/);
    assert.match(file.content, /model_reasoning_effort = "(?:low|medium)"/);
    assert.doesNotMatch(file.content, /danger-full-access|approval_policy|bypass/);
    assert.match(file.sha256, /^[a-f0-9]{64}$/u);
  }
  assert.match(a.find(f => f.name.includes('-plan.')).content, /sandbox_mode = "read-only"/);
  assert.throws(() => renderAgentProfiles({ ...options, roleInstruction: '가'.repeat(2000) }), /invalid/);
  assert.throws(() => renderAgentProfiles({ ...options, skillPath: 'relative/SKILL.md' }), /invalid/);
});

test('all child event kinds retain parent and child identity without prompt, output or execution claims', () => {
  for (const hook_event_name of ['SubagentStart', 'SubagentStop', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PermissionRequest']) {
    const event = delegationEvent({ ...input, hook_event_name, tool_name: 'Bash', tool_use_id: 'tool-1',
      prompt: 'PRIVATE INPUT', last_assistant_message: 'PRIVATE ANSWER', tool_input: { command: 'PRIVATE COMMAND' }, tool_response: { output: 'PRIVATE OUTPUT' } });
    assert.equal(event.parentSessionId, 'parent-a'); assert.equal(event.agentId, 'child-a');
    assert.equal(event.reportedTurnId, 'reported-turn'); assert.equal(event.executionSettingsVerified, false);
    assert.ok(!JSON.stringify(event).includes('PRIVATE'));
    assert.equal(event.eventId, delegationEvent({ ...input, hook_event_name, tool_name: 'Bash', tool_use_id: 'tool-1' }).eventId);
  }
  assert.notEqual(delegationEvent(input).eventId, delegationEvent({ ...input, agent_id: 'child-b' }).eventId);
  assert.notEqual(delegationEvent(input).eventId, delegationEvent({ ...input, session_id: 'parent-b' }).eventId);
});

test('unbound and malformed child identities never produce delegated events', () => {
  for (const change of [{ agent_id: undefined }, { agent_id: 'parent-a' }, { agent_type: 'worker' }, { turn_id: '' },
    { cwd: 'relative' }, { hook_event_name: 'PreToolUse', tool_name: 'Bash' }, { hook_event_name: 'Unknown' }]) {
    assert.equal(delegationEvent({ ...input, ...change }), null);
  }
  assert.equal(delegationEvent(null), null);
});

test('child submission cannot read or change parent assistance, approval, binding or saved context', async () => {
  let calls = 0; const request = async () => { calls++; throw Error('must not contact parent receiver'); };
  for (const child of [{ agent_id: 'child-a' }, { agent_id: '' }, { agent_type: 'worker' }, { hook_event_name: 'SubagentStop' }]) {
    const hook = { ...input, hook_event_name: 'UserPromptSubmit', prompt: '구현', ...child };
    assert.equal(submissionEvidence(hook), null);
    assert.equal((await preflightSubmission(hook, request)).available, false);
    assert.deepEqual(await prepare({ enabled: true }, hook, request), { output: {} });
    await assert.rejects(chatConfig(os.tmpdir(), hook, 'not-read'), /child-requires/);
  }
  assert.equal(calls, 0);
});

test('deduplication distinguishes sibling agents with the same parent and reported turn', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-delegation-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('autopets-delegation-')); await fs.rm(root, { recursive: true, force: true }); });
  await fs.mkdir(path.join(root, 'state')); await fs.writeFile(path.join(root, 'state/connection-settings.json'), '{"enabled":true}');
  let calls = 0; const run = async () => { calls++; return { output: {} }; };
  await runHookOnce(input, 'observe-child', run, root);
  await runHookOnce(input, 'observe-child', run, root);
  await runHookOnce({ ...input, agent_id: 'child-b' }, 'observe-child', run, root);
  assert.equal(calls, 2);
});
