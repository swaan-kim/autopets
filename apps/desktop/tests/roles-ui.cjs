const assert = require('node:assert/strict');
const path = require('node:path');
const templates = require('../../../packages/contracts/data/roles.json');
const { emptyWorkflow } = require('./workflow-ui.cjs');

async function runRoleChecks({ newPage, mockBridge, fixture, assistanceFixture, origin, screenshotDir, checks }) {
  const page = await newPage({ width: 1120, height: 900 });
  const workflow = structuredClone(emptyWorkflow);
  workflow.tasks = assistanceFixture.tasks.map(task => ({ identity: task.identity, enabled: false, preset: 'balanced', planFirst: true,
    planning: { model: 'fixture-model', reasoning: 'high' }, execution: { model: 'fixture-model', reasoning: 'low' },
    phase: 'unknown', settingsRevision: 0, planRevision: 0, plan: null, approval: null, observation: null,
    guard: { status: 'unavailable', reason: '', submissionId: null, requestFingerprint: null, checkedAt: null }, onceAvailable: false, updatedAt: Date.now(),
  }));
  workflow.capabilities.codex.availableModels = [{ model: 'fixture-model', reasoning: ['low', 'high'] }];
  await mockBridge(page, fixture, assistanceFixture, workflow);
  await page.addInitScript(({ templates }) => {
    // Rendered UI fixture only. SQLite persistence and revision atomicity are Rust checks.
    let inner;
    Object.defineProperty(window, '__roleInvoke', { value: async function(name, args) {
      const state = window.__uiTest;
      state.roles ??= { templates, pets: [], bindings: [] };
      if (name === 'roles_snapshot') return structuredClone(state.roles);
      if (name === 'save_pet') {
        if (state.roleError) throw Error(state.roleError);
        const previous = state.roles.pets.find(pet => pet.id === args.id);
        if ((previous?.revision ?? 0) !== args.expectedRevision) throw Error('stale pet');
        const pet = { id: previous?.id ?? `role-${state.roles.pets.length}`, revision: args.expectedRevision + 1, template: structuredClone(args.template), updatedAt: Date.now() };
        if (previous) state.roles.pets.splice(state.roles.pets.indexOf(previous), 1, pet); else state.roles.pets.push(pet);
        return structuredClone(pet);
      }
      if (name === 'apply_pet') {
        if (state.roleError) throw Error(state.roleError);
        const key = value => JSON.stringify([value.provider, value.accountId, value.chatId]);
        const pet = state.roles.pets.find(pet => pet.id === args.petId);
        const task = state.workflow.tasks.find(task => key(task.identity) === key(args.identity));
        if (!pet || !task || task.settingsRevision !== args.expectedSettingsRevision) throw Error('stale role');
        const old = state.roles.bindings.find(binding => key(binding.identity) === key(args.identity));
        const binding = { identity: args.identity, petId: pet.id, petRevision: pet.revision, revision: (old?.revision ?? 0) + 1, enabled: args.enabled, template: structuredClone(pet.template), updatedAt: Date.now() };
        if (old) state.roles.bindings.splice(state.roles.bindings.indexOf(old), 1, binding); else state.roles.bindings.push(binding);
        task.settingsRevision++; task.approval = null;
        state.calls.push({ name, args });
        return structuredClone(binding);
      }
      return inner(name, args);
    } });
    // Init scripts order is not guaranteed. Intercept assignment of the mock bridge itself.
    let bridge = window.__TAURI_INTERNALS__;
    if (bridge) { inner = bridge.invoke; bridge.invoke = window.__roleInvoke; }
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, get: () => bridge, set(value) { inner = value.invoke; value.invoke = window.__roleInvoke; bridge = value; } });
  }, { templates });
  // Wrap after navigation too: this makes init-script ordering immaterial before entering the roles page.
  await page.goto(origin);
  await page.evaluate(() => {
    if (!window.__TAURI_INTERNALS__) throw Error('missing mock bridge');
  });
  await page.getByRole('button', { name: '역할과 내 펫', exact: true }).click();
  await page.getByRole('heading', { name: /필요한 역할을 고르고/ }).waitFor();
  await page.getByRole('button', { name: '제작·구현', exact: true }).click();
  await page.getByLabel('펫 이름', { exact: true }).fill('나의 구현 펫');
  await page.getByLabel('역할 소품').selectOption('notebook');
  await page.getByLabel('역할 배경').selectOption('meadow');
  const key = identity => JSON.stringify([identity.provider, identity.accountId, identity.chatId]);
  await page.getByLabel('역할을 선택할 작업').selectOption(key(workflow.tasks[0].identity));
  await page.getByLabel('계획 역할 모델').selectOption('fixture-model');
  await page.getByLabel('계획 역할 추론').selectOption('high');
  assert.equal(await page.getByLabel('계획 역할 추론').locator('option').count(), 2);
  await page.getByRole('button', { name: '내 펫 저장', exact: true }).click();
  await page.getByText('내 펫을 저장했어요.', { exact: false }).waitFor();
  await page.getByRole('button', { name: '이 작업에 역할 선택', exact: true }).click();
  await page.getByTestId('role-binding').waitFor();
  const state = await page.evaluate(() => ({ roles: window.__uiTest.roles, assistance: window.__uiTest.assistance, workflow: window.__uiTest.workflow }));
  assert.equal(state.roles.bindings.length, 1);
  assert.equal(state.workflow.tasks[1].settingsRevision, 0);
  assert.deepEqual(state.assistance.tasks.map(task => task.context), assistanceFixture.tasks.map(task => task.context));
  assert.equal(state.roles.pets[0].template.planning.reasoning, 'high');
  assert.equal(await page.getByLabel('노트 소품').count(), 1);
  await page.getByText('채팅에 직접 전달할 지침', { exact: true }).click();
  await page.getByRole('button', { name: '역할 지침 복사' }).click();
  const prompt = await page.evaluate(() => window.__uiTest.clipboard);
  assert.match(prompt, /나의 구현 펫/); assert.doesNotMatch(prompt, /조사 채팅만의 조건/); assert.ok(Buffer.byteLength(prompt) <= 3072);
  await page.getByLabel('역할을 선택할 작업').selectOption(key(workflow.tasks[1].identity));
  assert.equal(await page.getByTestId('role-binding').count(), 0);
  await page.getByRole('button', { name: '이 작업에 역할 선택', exact: true }).click();
  await page.getByTestId('role-binding').waitFor();
  await page.getByRole('button', { name: '이 작업의 역할 도움 끄기' }).click();
  await page.getByTestId('role-binding').filter({ hasText: '역할 도움 꺼짐' }).waitFor();
  await page.getByLabel('역할 지침').fill('한'.repeat(513));
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('button', { name: '내 펫 변경 저장' }).isEnabled(), false);
  await page.getByLabel('역할 지침').fill(templates[1].instruction);
  await page.setViewportSize({ width: 800, height: 650 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 800));
  const screenshot = path.join(screenshotDir, 'native-ui-roles.png');
  await page.evaluate(() => { document.querySelector('.connection-pill').textContent = '합성 UI 검사 · 실제 연결 미검증'; });
  await page.screenshot({ path: screenshot, fullPage: true });
  checks.push('two roles save selected preferences, bind separate chats, copy bounded instructions without context, support off and validate Korean byte limits');
  await page.close();
  return [screenshot];
}
module.exports = { runRoleChecks };
