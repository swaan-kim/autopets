import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rolePrompt } from '../roles.mjs';
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
