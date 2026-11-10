import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderClaudeAgents, writeClaudeAgents } from '../agents.mjs';

const read = rel => JSON.parse(fs.readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8'));
const uiPet = read('packages/contracts/data/ui-pet.json');
const daily = read('packages/contracts/data/pet-catalog.json').find(e => !e.template.planFirst).template;
const front = content => Object.fromEntries(content.split('---')[1].trim().split('\n').map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]));

test('plan-first pet gets a read-only opus/high planner and a sonnet/low builder', () => {
  const [plan, build] = renderClaudeAgents(uiPet);
  assert.equal(plan.name, 'autopets-plan.md');
  assert.deepEqual([front(plan.content).model, front(plan.content).effort, front(plan.content).permissionMode], ['opus', 'high', 'plan']);
  assert.doesNotMatch(front(plan.content).tools, /Edit|Write|Bash/);
  assert.deepEqual([front(build.content).model, front(build.content).effort], ['sonnet', 'low']);
  for (const file of [plan, build]) { assert.equal(front(file.content).disallowedTools, 'Agent'); assert.ok(file.content.includes(uiPet.instruction)); }
  assert.deepEqual(renderClaudeAgents(uiPet), renderClaudeAgents(uiPet), 'deterministic');
});

test('direct pets get only a builder; unlisted routing is rejected, not substituted', () => {
  assert.deepEqual(renderClaudeAgents(daily).map(f => f.name), ['autopets-light.md']);
  assert.throws(() => renderClaudeAgents({ ...uiPet, planning: { model: 'gpt-6-sol', reasoning: 'xhigh' } }), /routing-unsupported/);
  assert.throws(() => renderClaudeAgents({ ...uiPet, execution: { model: 'gpt-6-astra', reasoning: 'high' } }), /routing-unsupported/);
  assert.throws(() => renderClaudeAgents({ ...uiPet, instruction: '' }), /invalid/);
});

test('writing needs an absolute directory and never overwrites a user-made agent', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopets-claude-agents-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => writeClaudeAgents(uiPet, 'relative'), /absolute/);
  assert.deepEqual(writeClaudeAgents(uiPet, dir).written, ['autopets-plan.md', 'autopets-light.md']);
  assert.ok(writeClaudeAgents(uiPet, dir), 're-writing own files is allowed');
  fs.writeFileSync(path.join(dir, 'autopets-plan.md'), '---\nname: mine\n---\n');
  assert.throws(() => writeClaudeAgents(uiPet, dir), /not-autopets-agent/);
  assert.equal(fs.readFileSync(path.join(dir, 'autopets-plan.md'), 'utf8'), '---\nname: mine\n---\n');
});
