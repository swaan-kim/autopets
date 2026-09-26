import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRuntime } from '../runtime/read-only.mjs';

test('runtime report excludes secrets and commands and does not promote capabilities', () => {
  const secret = 'never-print-this';
  const result = summarizeRuntime({ initialized: { userAgent: 'test', platformOs: 'windows' }, stderrPresent: false, result: {
    'config/read': { config: { features: { hooks: true }, apiKey: secret }, layers: [{ name: { type: 'user', file: 'config.toml' }, config: { apiKey: secret, hooks: { command: secret } } }] },
    'hooks/list': { data: [{ cwd: 'test', hooks: [{ eventName: 'Stop', command: secret, trustStatus: 'untrusted' }], errors: [{ message: secret }] }] },
    'model/list': { data: [{ id: 'current', model: 'current', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] },
    'skills/list': { data: [{ cwd: 'test', errors: [{ message: secret }], skills: [
      { name: secret, path: secret, description: secret },
      { name: 'autopets-build-implementation', path: 'fixture/SKILL.md', enabled: true, scope: 'repo', description: secret, dependencies: { tools: [{ value: secret }] } },
    ] }] },
  } });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.existingDesktopControlVerified, false);
  assert.equal(result.accountIdentity, 'unknown');
  assert.deepEqual(result.models[0].supportedReasoningEfforts, ['low']);
  assert.equal(result.hooks[0].errorCount, 1);
  assert.equal(result.roleSkills.executionVerified, false);
  assert.deepEqual(result.roleSkills.entries, [{ cwd: 'test', errorCount: 1,
    skills: [{ name: 'autopets-build-implementation', path: 'fixture/SKILL.md', enabled: true, scope: 'repo' }] }]);
});

test('missing or failed skill discovery never becomes execution evidence', () => {
  for (const value of [undefined, { inspectionError: 'RPC timeout' }, { data: [{ cwd: 'test', skills: [] }] }]) {
    const result = summarizeRuntime({ initialized: {}, result: { 'skills/list': value } });
    assert.equal(result.roleSkills.executionVerified, false);
    assert.equal(result.roleSkills.inspectionError, value?.inspectionError ?? null);
    assert.deepEqual(result.roleSkills.entries.flatMap(entry => entry.skills), []);
  }
});
