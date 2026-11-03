const { openTasks } = require('./entry-navigation.cjs');
const assert = require('node:assert/strict');
const template = require('../../../packages/contracts/data/ui-pet.json');

const A = '11111111-2222-4333-8444-555555555555';
const B = '11111111-2222-4333-8444-666666666666';
const C = '77777777-2222-4333-8444-777777777777';

exports.runPetTaskReturnChecks = async ({ newPage, mockBridge, fixture, origin, checks }) => {
  const value = {
    ...structuredClone(fixture), sessions: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })),
    petLinks: [A, B].map((threadId, slot) => ({
      version: 1, target: { sourceId: 'codex-windows-local', threadId, cwd: 'C:/한글과 공백/원플로우' },
      slot, revision: 1, enabled: slot === 0, connected: slot === 0, profile: 'light', template, run: null,
    })),
  };
  const page = await newPage({ width: 992, height: 688 });
  await mockBridge(page, value); await page.goto(origin); await openTasks(page);
  const a = page.locator('.pet-card-0');
  const b = page.locator('.pet-card-1');
  const before = await page.evaluate(() => structuredClone(window.__uiTest.state.petLinks));
  await a.getByRole('button', { name: 'Codex 작업 열기', exact: true }).click();
  await a.getByText(/Codex에 열기를 요청했어요/).waitFor();
  await b.getByRole('button', { name: 'Codex 작업 열기', exact: true }).click();
  await b.getByText(/Codex에 열기를 요청했어요/).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_task')), [
    { name: 'open_pet_task', args: { target: value.petLinks[0].target, expectedRevision: 1 } },
    { name: 'open_pet_task', args: { target: value.petLinks[1].target, expectedRevision: 1 } },
  ]);
  assert.deepEqual(await page.evaluate(() => window.__uiTest.state.petLinks), before);

  const setA = async patch => {
    await page.evaluate(patch => {
      Object.assign(window.__uiTest.state.petLinks[0], patch);
      window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
    }, patch);
  };
  await setA({ run: { id: 'plan-a', profile: 'plan', state: 'waiting' } });
  await a.getByRole('button', { name: '계획 보러 가기', exact: true }).waitFor();
  assert.equal(await a.getByRole('button', { name: '같은 펫으로 새 일', exact: true }).count(), 0);
  assert.equal(await b.getByRole('button', { name: 'Codex 작업 열기', exact: true }).count(), 1);
  await a.getByRole('button', { name: '계획 보러 가기', exact: true }).click();
  await a.getByText(/Codex에 열기를 요청했어요/).waitFor();
  await setA({ run: { id: 'done-a', profile: 'light', state: 'complete' } });
  await a.getByRole('button', { name: '결과 보러 가기', exact: true }).waitFor();
  await a.getByRole('button', { name: '같은 펫으로 새 일', exact: true }).waitFor();
  assert.equal(await a.getByRole('button', { name: '다음 계획 요청 복사', exact: true }).count(), 0, 'new task replaces the redundant generic next-request action in the manager');
  for (const patch of [
    { enabled: false, connected: true, run: { id: 'done-a', profile: 'light', state: 'complete' } },
    { enabled: true, connected: false, run: { id: 'done-a', profile: 'light', state: 'complete' } },
    { enabled: true, connected: true, run: { id: 'done-a', profile: 'light', state: 'complete', trackingClosed: true } },
    { enabled: true, connected: true, run: { id: 'returned-a', profile: 'light', state: 'returned' } },
    { enabled: true, connected: true, run: { id: 'unknown-a', profile: 'light', state: 'unknown' } },
    { enabled: true, connected: true, run: { id: 'non-plan-a', profile: 'light', state: 'waiting' } },
  ]) {
    await setA(patch);
    await a.getByRole('button', { name: 'Codex 작업 열기', exact: true }).waitFor();
    assert.equal(await a.getByRole('button', { name: '같은 펫으로 새 일', exact: true }).count(), 0, 'only a connected, enabled, confirmed completion can start a fresh task');
  }
  await setA({ enabled: true, connected: true, run: { id: 'done-a', profile: 'light', state: 'complete' } });
  await page.evaluate(() => {
    window.__uiTest.state.connectionPath = '';
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  await a.getByRole('button', { name: 'Codex 작업 열기', exact: true }).waitFor();
  assert.equal(await a.getByRole('button', { name: '같은 펫으로 새 일', exact: true }).count(), 0, 'a disconnected snapshot does not promote a historical completion');
  await page.evaluate(connectionPath => {
    window.__uiTest.state.connectionPath = connectionPath;
    window.__uiTest.state.petLinks[0].run = null;
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  }, value.connectionPath);
  assert.deepEqual(await page.evaluate(() => window.__uiTest.state.petLinks[1]), before[1]);

  await page.evaluate(() => { window.__uiTest.holdPetReturn = true; window.__uiTest.calls.length = 0; });
  const aButton = a.getByRole('button', { name: 'Codex 작업 열기', exact: true });
  await aButton.click();
  await page.waitForFunction(() => typeof window.__uiTest.releasePetReturn === 'function');
  assert.equal(await a.locator('[data-testid="pet-task-return"] button').first().isDisabled(), true);
  await a.locator('[data-testid="pet-task-return"] button').first().evaluate(button => { button.click(); button.click(); });
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_task').length), 1);
  await page.evaluate(threadId => {
    const state = window.__uiTest.state;
    state.petLinks[0].target.threadId = threadId; state.petLinks[0].revision++;
    state.now = Date.now(); window.__uiTest.emitEvent('autopets://snapshot', structuredClone(state));
  }, C);
  await a.getByText(`채팅 · ${C.slice(-8)}`, { exact: true }).waitFor();
  await page.evaluate(() => { window.__uiTest.holdPetReturn = false; window.__uiTest.releasePetReturn(); });
  await page.waitForFunction(() => !document.querySelector('.pet-card-0 [data-testid="pet-task-return"] button').disabled);
  assert.equal(await a.getByText(/Codex에 열기를 요청했어요/).count(), 0, 'old target receipt must not label the replacement pet');
  assert.deepEqual(await page.evaluate(() => window.__uiTest.state.petLinks[1]), before[1]);

  await page.evaluate(() => { window.__uiTest.returnWrongTarget = true; });
  await a.getByRole('button', { name: 'Codex 작업 열기', exact: true }).click();
  await a.getByRole('button', { name: '작업 ID 복사', exact: true }).waitFor();
  await a.getByText(C, { exact: true }).waitFor();
  assert.equal(await a.getByText(/Codex에 열기를 요청했어요/).count(), 0);
  await a.getByRole('button', { name: '작업 ID 복사', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__uiTest.clipboard), C);
  await page.evaluate(() => { window.__uiTest.returnWrongTarget = false; window.__uiTest.returnError = 'fixture OS dispatch denied'; });
  await a.getByRole('button', { name: 'Codex 작업 열기', exact: true }).click();
  await a.getByRole('button', { name: '작업 ID 복사', exact: true }).waitFor();
  assert.equal(await a.getByText(/Codex에 열기를 요청했어요/).count(), 0);
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => /submit|send|create.*thread/.test(call.name))), false);

  const overlay = await newPage({ width: 420, height: 640 });
  await mockBridge(overlay, value); await overlay.goto(`${origin}/?pet=0`);
  await overlay.getByRole('button', { name: `${template.name} 메뉴`, exact: true }).click();
  await overlay.getByRole('button', { name: 'Codex 작업 열기', exact: true }).click();
  await overlay.getByText(/Codex에 열기를 요청했어요/).waitFor();
  assert.deepEqual(await overlay.evaluate(() => window.__uiTest.calls.find(call => call.name === 'open_pet_task').args), {
    target: value.petLinks[0].target, expectedRevision: 1,
  });
  await overlay.evaluate(() => {
    window.__uiTest.state.petLinks[0].run = { id: 'overlay-plan', profile: 'plan', state: 'waiting' };
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  await overlay.getByRole('button', { name: '계획 보러 가기', exact: true }).waitFor();
  await overlay.evaluate(() => {
    window.__uiTest.state.petLinks[0].run = { id: 'overlay-done', profile: 'light', state: 'complete' };
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  await overlay.getByRole('button', { name: '결과 보러 가기', exact: true }).waitFor();
  assert.equal(await overlay.getByRole('button', { name: '같은 펫으로 새 일', exact: true }).count(), 0, 'overlay without composer callback keeps existing next-request flow');
  assert.equal(await overlay.getByRole('button', { name: '다음 계획 요청 복사', exact: true }).isVisible(), false);
  await overlay.locator('.explicit-chat-help > summary').click();
  await overlay.getByRole('button', { name: '다음 계획 요청 복사', exact: true }).waitFor();
  checks.push('explicit pet return: contextual plan/result labels require current connected/enabled records, new-task action only for confirmed completion, A/B isolation and disconnected fallback, duplicate clicks/stale receipts suppressed, wrong dispatch exposes ID fallback, manager/overlay share exact-target navigation; fixture dispatch is not real navigation');
  await page.close(); await overlay.close();
};
