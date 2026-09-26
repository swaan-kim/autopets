import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rolePrompt, roleGuidance } from '../roles.mjs';
import { buildWorkflowGuidance } from '../workflow.mjs';
import { defaultPreferences, emptyContext } from '../../contracts/index.mjs';
const templates = JSON.parse(await readFile(new URL('../../contracts/data/roles.json', import.meta.url), 'utf8'));
test('both roles have bounded independent instructions and pinned existing skills', async () => {
  for (const template of templates) {
    const prompt = rolePrompt(template);
    assert.ok(Buffer.byteLength(prompt) <= 3072);
    assert.match(prompt, /현재 채팅 설정 유지/);
    assert.equal(template.planning, null);
    assert.equal(template.execution, null);
    const skill = await readFile(new URL(`../../../integrations/codex/skills/${template.skills[0].id}/SKILL.md`, import.meta.url), 'utf8');
    assert.ok(skill.includes(`version: "${template.skills[0].version}"`));
  }
});
test('role reuse rejects chat context, approvals, oversized Korean and unknown versions', () => {
  for (const extra of [{ context: 'previous chat' }, { approval: true }, { instruction: '한'.repeat(513) }, { version: 2 }, { skills: [{ id: 'other', version: '1.0.0' }] }]) {
    assert.throws(() => rolePrompt({ ...templates[0], ...extra }));
  }
  assert.ok(Buffer.byteLength(rolePrompt({ ...templates[0], instruction: '한'.repeat(512) })) <= 3072);
});

test('role and workflow share one 3KB budget without truncating instructions or hiding omitted plan', () => {
  const identity = { provider: 'codex', accountId: 'scope-a', chatId: 'a' };
  const template = { ...templates[0], instruction: '한'.repeat(512) };
  const role = { identity, enabled: true, revision: 1, petRevision: 1, template };
  const suffix = roleGuidance(role, identity, true);
  for (const phase of ['planning', 'executing', 'review']) {
    const task = { planFirst: true, phase, settingsRevision: 1, planRevision: 1,
      approval: phase === 'planning' ? null : { settingsRevision: 1, planRevision: 1 },
      plan: { summary: '큰'.repeat(300), steps: ['조사'], completionCriteria: ['근거'] } };
    const result = buildWorkflowGuidance({ task, intent: 'continue', preferences: { ...defaultPreferences(), enabled: true },
      context: { ...emptyContext(), goal: '남'.repeat(250) }, reserveBytes: Buffer.byteLength(suffix) });
    assert.ok(Buffer.byteLength(result.text + suffix) <= 3072);
    assert.ok((result.text + suffix).includes(template.instruction));
    assert.match(result.text, /일부 생략됨/);
  }
  assert.throws(() => roleGuidance(role, { ...identity, accountId: 'scope-b' }), /binding/);
  assert.throws(() => roleGuidance({ ...role, revision: 0 }, identity), /binding/);
  assert.equal(roleGuidance({ ...role, enabled: false }, identity), '');
});
