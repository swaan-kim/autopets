import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPreferences, emptyContext, validateContext, validateIdentity, validatePreferences } from '../packages/contracts/index.mjs';

test('identity limits use UTF-8 bytes and reject C1 controls', () => {
  const identity = { provider: 'codex', accountId: '가'.repeat(66) + 'aa', chatId: '나'.repeat(170) + 'aa' };
  assert.deepEqual(validateIdentity(identity), identity);
  assert.throws(() => validateIdentity({ ...identity, accountId: identity.accountId + 'a' }));
  assert.throws(() => validateIdentity({ ...identity, chatId: identity.chatId + 'a' }));
  assert.throws(() => validateIdentity({ ...identity, accountId: 'account\u0085' }));
});

test('context field boundaries match Rust and lists reject empty entries', () => {
  const context = { ...emptyContext(), goal: '가'.repeat(341) + 'a', outputFormat: '나'.repeat(170) + 'aa', constraints: ['다'.repeat(170) + 'aa'] };
  assert.deepEqual(validateContext(context), context);
  for (const field of ['goal', 'outputFormat']) assert.throws(() => validateContext({ ...context, [field]: context[field] + 'a' }));
  assert.throws(() => validateContext({ ...context, constraints: [context.constraints[0] + 'a'] }));
  for (const value of ['', '  ', 'text\r', 'text\u0085', '\ud800']) assert.throws(() => validateContext({ ...emptyContext(), decisions: [value] }));
  assert.doesNotThrow(() => validateContext({ ...emptyContext(), goal: '한 줄\n다음 줄\t내용 😀' }));
});

test('context enforces total serialized UTF-8 budget', () => {
  assert.throws(() => validateContext({ ...emptyContext(), constraints: Array(8).fill('가'.repeat(160)) }), /context-limit/);
  assert.throws(() => validateContext({ ...emptyContext(), transcript: 'private' }), /context-shape/);
});

test('preferences match Rust model byte limits and require a fixed model', () => {
  const preferences = { ...defaultPreferences(), routingMode: 'fixed', fixedModel: '가'.repeat(42) + 'aa', allowedModels: ['base', 'base'] };
  assert.deepEqual(validatePreferences(preferences), preferences);
  assert.throws(() => validatePreferences({ ...preferences, fixedModel: preferences.fixedModel + 'a' }));
  assert.throws(() => validatePreferences({ ...preferences, allowedModels: ['나'.repeat(43)] }));
  assert.throws(() => validatePreferences({ ...preferences, fixedModel: null }));
  assert.throws(() => validatePreferences({ ...preferences, fixedModel: '   ' }));
  assert.throws(() => validatePreferences({ ...preferences, enabledOverride: true }));
});
