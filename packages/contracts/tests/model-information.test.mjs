import test from 'node:test';
import assert from 'node:assert/strict';
import { modelInformation } from '../model-information.mjs';

test('model references bind exact IDs and surfaces, disclose evidence, and expire without guessing', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  const sol = modelInformation('gpt-6-sol', 'codex', now);
  assert.equal(sol.status, 'reference');
  assert.match(sol.summary, /복잡한 코딩/);
  assert.match(sol.conditions, /평가하지 않았습니다/);
  assert.equal(new URL(sol.sourceUrl).hostname, 'learn.chatgpt.com');
  assert.equal(sol.publishedAt, '2026-09-22');
  assert.equal(sol.reviewedAt, '2026-09-26');
  const luna = modelInformation('gpt-6-luna', 'work-local', now);
  assert.notEqual(luna.summary, sol.summary);
  for (const [model, surface] of [['gpt-6-sol', 'chatgpt'], ['gpt-6-sol', undefined], ['gpt-6-sol-latest', 'codex'], ['gpt-6-astra', 'codex'], [null, 'codex']]) {
    assert.equal(modelInformation(model, surface, now).status, 'unknown');
  }
  assert.equal(modelInformation('gpt-6-sol', 'codex', Date.parse('2026-10-26T00:00:00Z')).status, 'stale');
  assert.equal(modelInformation('gpt-6-sol', 'codex', Date.parse('2026-09-25T00:00:00Z')).status, 'stale');
  assert.equal(modelInformation('gpt-6-sol', 'codex', NaN).status, 'stale');
  sol.surfaces.push('chatgpt');
  assert.equal(modelInformation('gpt-6-sol', 'chatgpt', now).status, 'unknown');
  assert.doesNotMatch(JSON.stringify(luna), /availableModels|modelSwitch|score|savings|verified/);
});
