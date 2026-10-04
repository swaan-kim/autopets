const assert = require('node:assert/strict');
const path = require('node:path');

exports.runTaskGraphChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const page = await newPage({ width: 1120, height: 1000 });
  await mockBridge(page, fixture);
  await page.goto(origin);
  const graph = page.getByRole('region', { name: '전달된 작업 관계' });
  assert.equal(await graph.count(), 0);
  await page.evaluate(() => {
    const make = (id, label, extra = {}) => ({ id, label, cwd: 'C:/UI fixture only', projectId: 'fixture-project', parentId: null,
      forkedFromId: null, creationSurface: 'codex-local', runtimeStatus: 'active', configuredModel: 'fixture', configuredReasoning: 'high',
      metadataUpdatedAt: Date.now(), observedAt: Date.now(), ...extra });
    window.__uiTest.taskGraph = [{ revision: 1, report: { version: 1, sourceId: 'fixture-source', source: 'app-server-metadata', runtime: 'fixture', nodes: [
      make('fixture-research-id', '관계 A'), make('fixture-writing-id', '관계 B', { creationSurface: 'work-local' }),
      make('fixture-child', '합성 하위 작업', { parentId: 'fixture-research-id' }),
      make('fixture-fork', '독립 복제 작업', { projectId: null, forkedFromId: 'fixture-research-id' }),
    ] } }];
  });
  await graph.getByText('관계 A', { exact: true }).waitFor();
  assert.equal(await graph.getByRole('list', { name: '관계 A의 하위 작업' }).getByText('합성 하위 작업', { exact: true }).count(), 1);
  assert.equal(await graph.locator('[data-graph-task="fixture-writing-id"] button').count(), 0);
  assert.match(await graph.locator('[data-graph-task="fixture-writing-id"]').innerText(), /진행 미확인/u);
  assert.equal(await graph.getByText('프로젝트 미확인', { exact: true }).count(), 1);
  assert.equal(await graph.getByText('복제된 작업 · 하위 작업 관계와 별개', { exact: true }).count(), 1);
  const screenshot = path.join(screenshotDir, 'native-ui-task-graph.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.evaluate(() => { window.__uiTest.graphError = true; });
  await page.getByText('작업 관계를 다시 확인해주세요.', { exact: true }).waitFor();
  assert.equal(await graph.count(), 0);
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => /configure|approve|open_local_task/.test(call.name))), false);
  checks.push('metadata hierarchy nests known children, keeps forks separate, never borrows Codex progress for Work, and clears stale display after read failure');
  await page.close();
  return [screenshot];
};
