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
  await mockBridge(page, value); await page.goto(origin);
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
  await a.getByText(`채팅 ${C.slice(0, 8)}`, { exact: true }).waitFor();
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
  await overlay.getByRole('button', { name: '제작 펫 메뉴', exact: true }).click();
  await overlay.getByRole('button', { name: 'Codex 작업 열기', exact: true }).click();
  await overlay.getByText(/Codex에 열기를 요청했어요/).waitFor();
  assert.deepEqual(await overlay.evaluate(() => window.__uiTest.calls.find(call => call.name === 'open_pet_task').args), {
    target: value.petLinks[0].target, expectedRevision: 1,
  });
  checks.push('explicit pet return: exact A/B targets, disconnected/help-off allowed without state mutation, duplicate clicks and stale receipts suppressed, wrong/failed dispatch exposes ID fallback, overlay shares the same path; fixture dispatch is not real navigation');
  await page.close(); await overlay.close();
};
