const assert = require('node:assert/strict');
const path = require('node:path');

exports.runToolActivityChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const state = structuredClone(fixture);
  const task = state.sessions[0];
  Object.assign(task, { attention: null, activity: 'tool', lastTool: 'mcp__fixture__read', toolActivityV1: {
    version: 1, turnId: 'fixture-turn', truncated: false, calls: [
      { id: 'one', name: 'mcp__fixture__read', state: 'completed', observedAt: 10 },
      { id: 'two', name: 'exec_command', state: 'running', observedAt: 20 },
    ],
  } });
  const manager = await newPage();
  await mockBridge(manager, state);
  await manager.goto(origin);
  await manager.locator('.pet-card-0').getByRole('button', { name: '작업 카드 열기 →' }).click();
  const activity = manager.getByRole('region', { name: '관측된 도구 실행' });
  await activity.getByText('mcp__fixture__read', { exact: true }).waitFor();
  assert.match(await activity.innerText(), /사용 가능 여부는 미확인/);
  assert.match(await activity.locator('li').filter({ hasText: 'mcp__fixture__read' }).innerText(), /실행 완료/);
  await manager.locator('.task-details').getByText('1개 도구 사용 중', { exact: true }).waitFor();
  await manager.evaluate(() => {
    const calls = window.__uiTest.state.sessions[0].toolActivityV1.calls;
    Object.assign(calls[1], { state: 'failed', observedAt: 30 });
  });
  await manager.locator('.task-details').getByText('최근 도구 실행 실패', { exact: true }).waitFor();
  assert.equal(await manager.getByText('1개 도구 사용 중', { exact: true }).count(), 0);
  const detailImage = path.join(screenshotDir, 'native-ui-tool-details.png');
  await manager.screenshot({ path: detailImage, fullPage: true });

  const pet = await newPage({ width: 500, height: 700 });
  await mockBridge(pet, state);
  await pet.goto(`${origin}/?pet=0`);
  const prop = pet.getByRole('img', { name: 'MCP · 최근 도구 실행 완료', exact: true });
  await prop.waitFor();
  assert.equal(await prop.getAttribute('data-state'), 'completed');
  // A running non-MCP tool must not turn a completed MCP call into "in use".
  assert.equal(await prop.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  const hit = await pet.locator('.pet-hit').boundingBox();
  const ornament = await prop.boundingBox();
  assert(hit && ornament && ornament.x >= hit.x && ornament.y >= hit.y
    && ornament.x + ornament.width <= hit.x + hit.width && ornament.y + ornament.height <= hit.y + hit.height);
  const petImage = path.join(screenshotDir, 'native-ui-tool-prop.png');
  await pet.screenshot({ path: petImage });
  await pet.evaluate(() => {
    window.__uiTest.state.sessions[0].toolActivityV1.calls[0].state = 'running';
  });
  await pet.getByRole('img', { name: 'MCP · 1개 도구 사용 중', exact: true }).waitFor();
  await pet.evaluate(() => {
    window.__uiTest.state.sessions[0].toolActivityV1.calls[1].state = 'completed';
    window.__uiTest.state.sessions[0].toolActivityV1.calls[0].state = 'failed';
  });
  await pet.getByRole('img', { name: 'MCP · 최근 도구 실행 실패', exact: true }).waitFor();
  await pet.locator('.sprite-tool').waitFor({ state: 'detached' });
  await pet.evaluate(() => { window.__uiTest.state.sessions[0].toolActivityV1.calls[0].state = 'running'; });
  await pet.getByRole('img', { name: 'MCP · 1개 도구 사용 중', exact: true }).waitFor();
  await pet.evaluate(() => { window.__uiTest.state.sessions[0].connection = 'unknown'; });
  await pet.getByRole('img', { name: 'MCP · 최근 도구 결과 확인 필요', exact: true }).waitFor();
  await pet.evaluate(() => { delete window.__uiTest.state.sessions[0].toolActivityV1; });
  await pet.locator('.mcp-pet-prop').waitFor({ state: 'detached' });
  assert.equal(await pet.getByText('1개 도구 사용 중', { exact: true }).count(), 0);
  checks.push('tool results distinguish running/completed/failed/unknown, MCP uses only matching calls, missing history invents no prop, and its ornament does not intercept pet input');
  return [detailImage, petImage];
};
