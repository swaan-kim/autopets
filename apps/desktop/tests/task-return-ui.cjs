const assert = require('node:assert/strict');

exports.runTaskReturnChecks = async ({ newPage, mockBridge, fixture, origin, checks }) => {
  const state = structuredClone(fixture);
  const id = '11111111-2222-4333-8444-555555555555';
  state.sessions[0].id = id;
  state.sessions[0].cwd = 'C:/한글과 공백/시험';
  state.slots[0].sessionId = id;
  const page = await newPage();
  await mockBridge(page, state);
  await page.goto(origin);
  await page.locator('.pet-card-0').getByRole('button', { name: '작업 카드 열기 →' }).click();
  await page.getByRole('button', { name: 'Codex 작업 찾기 ↗' }).click();
  const before = await page.evaluate(() => structuredClone(window.__uiTest.state));
  await page.getByRole('button', { name: '앱에서 열기 시도 ↗' }).click();
  await page.getByText('작업 앱에 열기를 요청했어요.', { exact: false }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__uiTest.calls.filter(x => x.name === 'open_local_task')), [
    { name: 'open_local_task', args: { sessionId: id, expectedCwd: state.sessions[0].cwd } },
  ]);
  assert.deepEqual(await page.evaluate(() => window.__uiTest.state), before);
  await page.evaluate(() => { window.__uiTest.returnError = '연결된 앱 없음'; });
  await page.getByRole('button', { name: '앱에서 열기 시도 ↗' }).click();
  await page.getByText('연결된 앱 없음', { exact: false }).waitFor();
  await page.getByRole('button', { name: '작업 ID 복사', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__uiTest.clipboard), id);
  await page.evaluate(() => { window.__uiTest.returnError = null; window.__uiTest.returnWrongTarget = true; });
  await page.getByRole('button', { name: '앱에서 열기 시도 ↗' }).click();
  await page.getByText('열기 요청 결과를 확인하지 못했어요.', { exact: false }).waitFor();
  assert.equal(await page.getByText('작업 앱에 열기를 요청했어요.', { exact: false }).count(), 0);
  const pet = await newPage({ width: 500, height: 700 });
  await mockBridge(pet, state);
  await pet.goto(`${origin}/?pet=0`);
  await pet.getByRole('button', { name: '근거 자료 조사 · 작업 카드 열기', exact: true }).click();
  await pet.getByRole('button', { name: /^앱에서 열기 시도/ }).click();
  await pet.getByText('작업 앱에 열기를 요청했어요.', { exact: false }).waitFor();
  assert.equal(await pet.evaluate(() => window.__uiTest.calls.filter(x => x.name === 'open_local_task').length), 1);
  checks.push('local UUID return dispatch is task-bound, never claims navigation, keeps ID fallback on failure and does not alter A/B state');
};
