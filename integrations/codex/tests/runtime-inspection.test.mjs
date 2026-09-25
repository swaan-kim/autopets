import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRuntime } from '../runtime/read-only.mjs';

test('runtime report excludes secrets and commands and does not promote capabilities', () => {
  const secret = 'never-print-this';
  const result = summarizeRuntime({ initialized: { userAgent: 'test', platformOs: 'windows' }, stderrPresent: false, result: {
    'config/read': { config: { features: { hooks: true }, apiKey: secret }, layers: [{ name: { type: 'user', file: 'config.toml' }, config: { apiKey: secret, hooks: { command: secret } } }] },
    'hooks/list': { data: [{ cwd: 'test', hooks: [{ eventName: 'Stop', command: secret, trustStatus: 'untrusted' }], errors: [{ message: secret }] }] },
    'model/list': { data: [{ id: 'current', model: 'current', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] },
  } });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.existingDesktopControlVerified, false);
  assert.equal(result.accountIdentity, 'unknown');
  assert.deepEqual(result.models[0].supportedReasoningEfforts, ['low']);
  assert.equal(result.hooks[0].errorCount, 1);
});
