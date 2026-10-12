import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolvePetSkills, petSkillInstruction, readPinnedSkill } from '../../../integrations/codex/runtime/pet-skills.mjs';
const catalog = JSON.parse(await readFile(new URL('../data/pet-catalog.json', import.meta.url), 'utf8'));

test('six task pets resolve pinned, content-bearing skills and bounded instructions', async () => {
  assert.equal(new Set(catalog.map(p => p.id)).size, 6);
  assert.equal(catalog.filter(p => p.category === 'daily').length, 3);
  assert.equal(catalog.filter(p => p.category === 'work').length, 3);
  for (const entry of catalog) {
    const skills = await resolvePetSkills(entry.template);
    assert.equal(skills.length, 1);
    const content = await readPinnedSkill(skills[0].id, skills[0].version);
    assert.ok(content.text.length > 100);
    assert.ok(Buffer.byteLength(entry.template.instruction) <= 1536);
    assert.ok(Buffer.byteLength(petSkillInstruction(entry.template, skills, entry.template.planFirst ? 'plan' : 'light')) <= 3072);
    assert.equal(entry.template.features.figmaDesign, false);
    assert.equal(entry.template.planFirst, ['ui-webpage', 'presentation'].includes(entry.id));
  }
});
