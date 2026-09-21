import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkflowPlan, unverifiedWorkflowCapabilities } from '../index.mjs';

test('workflow plans are bounded structured data; default protection remains unavailable', () => {
  const plan = { summary: '원문에서 정리한 계획', steps: ['조사', '작성'], completionCriteria: ['출처와 날짜 확인'] };
  assert.deepEqual(validateWorkflowPlan(plan), plan);
  for (const bad of [{ ...plan, tool: 'execute' }, { ...plan, steps: Array(13).fill('x') }, { ...plan, summary: '가'.repeat(342) },
    { ...plan, steps: ['\ud800'] }, { ...plan, steps: ['가'.repeat(171)] }, { ...plan, steps: Array(12).fill('x'.repeat(512)) }]) assert.throws(() => validateWorkflowPlan(bad));
  assert.deepEqual(Object.values(unverifiedWorkflowCapabilities()).filter(value => value === true), []);
  assert.equal(unverifiedWorkflowCapabilities().verification, 'unverified');
});
