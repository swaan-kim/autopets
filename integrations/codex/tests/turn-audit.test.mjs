import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditTurnSelection } from '../runtime/turn-audit.mjs';

test('turn selection audit binds the exact test task and discards all message/configuration contents', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'autopets-turn-audit-'));
  t.after(async () => { assert.equal(path.dirname(dir), tmpdir()); assert.ok(path.basename(dir).startsWith('autopets-turn-audit-')); await rm(dir, { recursive: true }); });
  const file = path.join(dir, 'selected.jsonl'), thread = '00000000-0000-4000-8000-000000000001', turn = '00000000-0000-4000-8000-000000000002';
  const meta = { type: 'session_meta', payload: { id: thread, session_id: thread, cwd: 'PRIVATE_PATH', instructions: 'PRIVATE_KEY' } };
  const context = { type: 'turn_context', payload: { turn_id: turn, model: 'fixture-model', effort: 'high', collaboration_mode: { mode: 'default', instructions: 'PRIVATE_PROMPT' } } };
  const save = records => writeFile(file, records.map(record => JSON.stringify(record)).join('\n'));
  await save([meta, context, { type: 'response_item', payload: { text: 'PRIVATE_CHAT_TEXT' } }, { type: 'event_msg', payload: { type: 'task_complete', turn_id: turn, last_agent_message: 'PRIVATE_OUTPUT' } }]);
  const result = await auditTurnSelection(file, thread);
  assert.deepEqual(result.turns, [{ turnId: turn, model: 'fixture-model', reasoning: 'high', mode: 'default', completed: true }]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  assert.equal(result.serverResolvedModelVerified, false); assert.equal(result.externalAdapterVerified, false);
  assert.equal(result.surface, 'unknown');
  for (const [originator, surface] of [['Codex Desktop', 'codex-desktop'], ['codex_work_desktop', 'work-local'], ['PRIVATE_ORIGINATOR', 'unknown']]) {
    await save([{ ...meta, payload: { ...meta.payload, originator } }, context]);
    const scoped = await auditTurnSelection(file, thread);
    assert.equal(scoped.surface, surface);
    assert.doesNotMatch(JSON.stringify(scoped), /PRIVATE_ORIGINATOR/);
  }
  await save([meta, { ...meta, payload: { ...meta.payload, originator: 'codex_work_desktop' } }]);
  await assert.rejects(auditTurnSelection(file, thread), /Conflicting runtime surface/);
  await assert.rejects(auditTurnSelection(file, turn), /identity mismatch/);
  await save([context, meta]); await assert.rejects(auditTurnSelection(file, thread), /Unbound/);
  await save([meta, context, { ...context, payload: { ...context.payload, model: 'different-model' } }]);
  await assert.rejects(auditTurnSelection(file, thread), /Conflicting/);
  await writeFile(file, JSON.stringify(meta) + '\n{'); await assert.rejects(auditTurnSelection(file, thread), /Incomplete/);
});
