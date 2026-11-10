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

test('plan follows the saved pet: existing Luna/low pets stay, new plan-first pets use Astra/high', async () => {
  const { planSettings } = await import('../routing.mjs');
  const { availableProfile } = await import('../../../integrations/codex/runtime/delegation.mjs');
  const catalog = JSON.parse(read('packages/contracts/data/pet-catalog.json'));
  const models = [{ model: 'gpt-6-luna', supportedReasoningEfforts: ['low'] }, { model: 'gpt-6-sol', supportedReasoningEfforts: ['low', 'medium'] },
    { model: 'gpt-6-astra', supportedReasoningEfforts: ['medium', 'high'] }];
  const legacy = { planning: { model: 'gpt-6-luna', reasoning: 'low' } };
  assert.equal(planSettings(legacy).model, 'gpt-6-luna');
  assert.equal(planSettings({}).model, 'gpt-6-luna', 'no planning keeps the old default');
  for (const entry of catalog.filter(e => e.template.planFirst)) assert.deepEqual(availableProfile('plan', models, entry.template), { ...PROFILES.plan, model: 'gpt-6-astra', effort: 'high' });
  assert.equal(availableProfile('plan', models, legacy).model, 'gpt-6-luna');
  assert.equal(availableProfile('plan', models).model, 'gpt-6-luna', 'renderer default unchanged');
  assert.equal(availableProfile('light', models, catalog[0].template).model, 'gpt-6-luna', 'execution ignores planning');
  assert.throws(() => availableProfile('plan', models.slice(0, 2), catalog.find(e => e.template.planFirst).template), /unavailable/, 'no silent fallback when Astra is missing');
  assert.throws(() => planSettings({ planning: { model: 'gpt-6-sol', reasoning: 'xhigh' } }), /routing-unsupported/);
});

test('a missing plan model stops with a Korean next step instead of a bare code', async () => {
  const { availableProfile } = await import('../../../integrations/codex/runtime/delegation.mjs');
  const { petFailure } = await import('../../../integrations/codex/skills/autopets/scripts/pet.mjs');
  const catalog = JSON.parse(read('packages/contracts/data/pet-catalog.json'));
  const noAstra = [{ model: 'gpt-6-luna', supportedReasoningEfforts: ['low'] }, { model: 'gpt-6-sol', supportedReasoningEfforts: ['low', 'medium'] }];
  let error; try { availableProfile('plan', noAstra, catalog.find(e => e.template.planFirst).template); } catch (caught) { error = caught; }
  const plan = petFailure(error);
  assert.equal(plan.code, 'unavailable-delegation-profile'); assert.equal(plan.retrySubmission, false);
  assert.match(plan.message, /계획 단계에 필요한 Astra · 높음/); assert.match(plan.message, /이번만 가볍게/);
  try { availableProfile('careful', noAstra.slice(0, 1)); } catch (caught) { error = caught; }
  assert.match(petFailure(error).message, /작업 방식을 "가볍게"로/);
  assert.match(petFailure(Error('unavailable-delegation-profile')).message, /펫에 저장된 모델·강도/, 'works without details');
});
