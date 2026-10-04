import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { prepareEvaluation, measuredTokenTotal, summarizeEvaluation } from '../prepare-intro-evaluation.mjs';
test('Korean evaluation schedules all 72 independent slots without fabricated results', async () => {
  const data = JSON.parse(await fs.readFile(new URL('../../packages/guidance/evaluation/intro-cases.json', import.meta.url), 'utf8'));
  const rows = prepareEvaluation(data.cases, 'a'.repeat(40));
  assert.equal(rows.length, 72); assert.equal(new Set(rows.map(row => row.blindId)).size, 72);
  for (const condition of ['A', 'B', 'C', 'D']) assert.equal(rows.filter(row => row.condition === condition).length, 18);
  assert.ok(rows.every(row => row.status === 'not-run' && row.totalTokens === null && row.outcome === null));
  assert.ok(summarizeEvaluation(rows).every(group => group.completed === 0 && group.meanMeasuredTokens === null));
});
test('usage combines all phases only when fully observed; null never becomes zero', () => {
  const row = { condition: 'D', status: 'completed', outcome: 'accepted', tokenObservation: 'complete', preparationTokens: 10, generationTokens: 20, reviewTokens: 5, retryTokens: 0 };
  assert.equal(measuredTokenTotal(row), 35);
  assert.equal(measuredTokenTotal({ ...row, retryTokens: null }), null);
  assert.equal(measuredTokenTotal({ ...row, tokenObservation: 'unavailable' }), null);
  assert.equal(measuredTokenTotal({ ...row, reviewTokens: -1 }), null);
  assert.equal(summarizeEvaluation([row]).find(group => group.condition === 'D').meanMeasuredTokens, 35);
});
