import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROUTING, ROUTING_PROFILE_KEYS, routingSettings, profileForSettings } from '../routing.mjs';
import { PROFILES } from '../../../integrations/codex/runtime/delegation.mjs';

const read = rel => fs.readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');

test('current codex profiles are unchanged by moving them to one table', () => {
  assert.deepEqual(Object.fromEntries(ROUTING_PROFILE_KEYS.map(k => [k, [routingSettings(k).model, routingSettings(k).effort]])), {
    light: ['gpt-6-luna', 'low'], standard: ['gpt-6-sol', 'low'], careful: ['gpt-6-sol', 'medium'], plan: ['gpt-6-luna', 'low'],
  });
  assert.equal(PROFILES.plan.readOnly, true);
  assert.equal(PROFILES.light.name, 'autopets-build-light');
  assert.ok(Object.isFrozen(ROUTING.hosts['codex-windows-local'].profiles.light));
});

test('every host defines every profile and unknown keys never fall back', () => {
  for (const [host, entry] of Object.entries(ROUTING.hosts)) {
    for (const key of ROUTING_PROFILE_KEYS) assert.ok(entry.profiles[key]?.model && entry.profiles[key]?.effort, `${host}.${key}`);
  }
  assert.throws(() => routingSettings('turbo'), /unsupported/);
  assert.throws(() => routingSettings('light', 'unknown-host'), /unsupported/);
  assert.equal(profileForSettings('execution', 'gpt-6-sol', 'medium'), 'careful');
  assert.equal(profileForSettings('planning', 'gpt-6-sol', 'medium'), null);
  assert.equal(profileForSettings('planning', 'gpt-6-luna', 'low'), 'plan');
});

test('Rust and UI read the shared table instead of their own copies', () => {
  const rust = read('apps/desktop/src-tauri/src/domain/pet_link.rs');
  const ui = read('apps/desktop/src/features/pets/UiPetStudio.tsx');
  assert.match(rust, /packages\/contracts\/data\/routing-profiles\.json/);
  assert.match(ui, /packages\/contracts\/data\/routing-profiles\.json/);
  assert.doesNotMatch(rust, /Self::Standard => \("gpt-6-sol"/);
  assert.doesNotMatch(ui, /description: '빠른 초안에', model: 'gpt-6-luna'/);
});
