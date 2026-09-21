const assert = require('node:assert/strict');
const path = require('node:path');

const presets = {
  light: { planning: { model: 'gpt-5.6-sol', reasoning: 'medium' }, execution: { model: 'gpt-5.6-luna', reasoning: 'low' } },
  balanced: { planning: { model: 'gpt-5.6-sol', reasoning: 'medium' }, execution: { model: 'gpt-5.6-terra', reasoning: 'medium' } },
  complex: { planning: { model: 'gpt-6-astra', reasoning: 'high' }, execution: { model: 'gpt-6-astra', reasoning: 'medium' } },
};
const unsupported = { modelObservation: false, reasoningObservation: false, modeObservation: false, submissionHold: false, inputPreservation: false, singleSubmission: false, modelSwitch: false, reasoningSwitch: false, planModeSwitch: false, verification: 'unverified', availableModels: [], requestIdentity: false };
const emptyWorkflow = {
  preferences: { version: 1, enabled: false, preset: 'balanced', planFirst: true, ...presets.balanced, revision: 0 },
  tasks: [], capabilities: { codex: { ...unsupported }, chatgpt: { ...unsupported } },
};
const taskFixture = (identity, overrides = {}) => ({
  identity, enabled: true, preset: 'balanced', planFirst: true, ...structuredClone(presets.balanced),
  phase: 'planning', settingsRevision: 0, planRevision: 0, plan: null, approval: null, observation: null,
  guard: { status: 'unavailable', reason: '연결 검증 전 · 시연 데이터', submissionId: null, requestFingerprint: null, checkedAt: null },
  onceAvailable: false, updatedAt: Date.now(), ...overrides,
});

async function labelFixture(page) {
  await page.evaluate(() => { const label = document.querySelector('.connection-pill'); if (label) label.textContent = 'UI 검수용 · 합성 시나리오 · 실제 연결 미검증'; });
}
async function noOverflow(page, width) {
  assert.ok(await page.evaluate(width => document.documentElement.scrollWidth <= width && document.body.scrollWidth <= width, width), `horizontal overflow at ${width}px`);
  const buttons = page.locator('.workflow-preset');
  for (const button of await buttons.all()) assert.ok(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
}

async function runWorkflowChecks({ newPage, mockBridge, fixture, assistanceFixture, origin, screenshotDir, checks }) {
  const snapshots = [];
  const defaults = await newPage({ width: 1120, height: 1120 });
  const workflow = structuredClone(emptyWorkflow);
  workflow.tasks.push(taskFixture(assistanceFixture.tasks[0].identity));
  const originalTask = structuredClone(workflow.tasks[0]);
  await mockBridge(defaults, fixture, assistanceFixture, workflow);
  await defaults.goto(origin);
  await defaults.getByRole('button', { name: '자동 도움', exact: true }).click();
  assert.equal(await defaults.getByLabel('계획·실행 도움 켜기', { exact: true }).isChecked(), false);
  assert.equal(await defaults.getByRole('radio', { name: '균형 있게', exact: true }).getAttribute('aria-checked'), 'true');
  assert.equal(await defaults.locator('.workflow-preset').count(), 3);
  await defaults.getByRole('radio', { name: '어려운 일 풀기', exact: true }).click();
  await defaults.locator('.workflow-preset[aria-checked=true]').filter({ hasText: 'Astra · high' }).waitFor();
  await labelFixture(defaults);
  await noOverflow(defaults, 1120);
  const presetScreenshot = path.join(screenshotDir, 'native-ui-workflow-presets.png');
  await defaults.screenshot({ path: presetScreenshot, animations: 'disabled' });
  snapshots.push(presetScreenshot);
  checks.push('workflow desktop presets show candidate reasoning pairs without horizontal overflow or applied claims');
  await defaults.getByRole('radio', { name: '가볍게 끝내기', exact: true }).click();
  await defaults.getByLabel('계획·실행 도움 켜기', { exact: true }).check();
  await defaults.getByRole('button', { name: '새 작업 기본값 저장', exact: true }).click();
  await defaults.getByText('저장했어요. 새로 연결되는 작업부터 사용해요.', { exact: true }).waitFor();
  assert.deepEqual(await defaults.evaluate(() => window.__uiTest.workflow.tasks[0]), originalTask);
  assert.deepEqual(await defaults.evaluate(() => window.__uiTest.workflow.preferences.execution), presets.light.execution);
  assert.equal(await defaults.evaluate(() => window.__uiTest.assistance.preferences.enabled), false);
  await defaults.getByText('단계별 모델·추론 설정', { exact: true }).click();
  await defaults.getByLabel('계획 모델', { exact: true }).selectOption('gpt-6-astra');
  await defaults.getByLabel('계획 추론 수준', { exact: true }).selectOption('high');
  await defaults.getByRole('button', { name: '새 작업 기본값 저장', exact: true }).click();
  await defaults.waitForFunction(() => window.__uiTest.workflow.preferences.planning.model === 'gpt-6-astra');
  assert.equal(await defaults.evaluate(() => window.__uiTest.workflow.capabilities.codex.modelSwitch), false);
  assert.deepEqual(await defaults.evaluate(() => window.__uiTest.workflow.tasks[0]), originalTask);
  checks.push('workflow opt-in and desired detail values save locally for new tasks without mutating existing tasks or unrelated assistance preferences');

  await defaults.setViewportSize({ width: 430, height: 900 });
  await noOverflow(defaults, 430);
  await defaults.getByText('연결 없이 시작하기', { exact: true }).click();
  await defaults.getByRole('button', { name: '요청 문구 복사', exact: true }).click();
  assert.match(await defaults.evaluate(() => window.__uiTest.clipboard), /목표, 필요한 단계, 완료 기준/);
  assert.equal(await defaults.evaluate(() => window.__uiTest.calls.some(call => /submit|generate|completion/.test(call.name))), false);
  checks.push('workflow compact viewport fits and unconnected guidance copies without a model call');

  const preview = await newPage();
  await preview.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__previewCopy = text; } } }));
  await preview.goto(origin);
  await preview.getByRole('button', { name: '자동 도움', exact: true }).click();
  await preview.getByText('연결 없이 시작하기', { exact: true }).click();
  await preview.getByRole('button', { name: '요청 문구 복사', exact: true }).click();
  assert.match(await preview.evaluate(() => window.__previewCopy), /실행하지 마세요/);
  assert.equal(await preview.getByRole('button', { name: '새 작업 기본값 저장', exact: true }).isEnabled(), false);
  checks.push('read-only browser preview still offers manual prompt copy without persistence');

  const current = await newPage({ width: 1120, height: 1120 });
  const standaloneIdentity = { provider: 'codex', accountId: 'fixture-only-account', chatId: '시연용 계획 대기 작업' };
  const standalone = structuredClone(emptyWorkflow);
  standalone.tasks = [taskFixture(standaloneIdentity, { observation: { model: 'gpt-6-astra', reasoning: 'high', mode: 'plan', source: 'hook', submissionId: 'unverified', observedAt: Date.now() } }), taskFixture({ ...standaloneIdentity, accountId: 'another-account' })];
  await mockBridge(current, { ...fixture, sessions: [], slots: [] }, { ...assistanceFixture, tasks: [] }, standalone);
  await current.goto(origin);
  await current.getByRole('button', { name: '자동 도움', exact: true }).click();
  await current.getByRole('tab', { name: '현재 작업', exact: true }).click();
  await current.getByLabel('채팅 선택', { exact: true }).selectOption(JSON.stringify([standaloneIdentity.provider, standaloneIdentity.accountId, standaloneIdentity.chatId]));
  await current.getByText('채팅에서 계획을 확인하세요.', { exact: false }).waitFor();
  assert.equal(await current.getByTestId('workflow-plan-summary').count(), 0);
  assert.equal(await current.getByTestId('workflow-model').textContent(), '모델 · 미확인');
  assert.equal(await current.getByTestId('workflow-reasoning').textContent(), '추론 · 미확인');
  assert.equal(await current.getByTestId('workflow-mode').textContent(), 'Plan 모드 · 미확인');
  await current.getByTestId('workflow-guard').filter({ hasText: '전송 전 확인 미지원' }).waitFor();
  assert.equal(await current.getByRole('button', { name: '이번 전송만 예외 허용', exact: true }).count(), 0);
  await current.getByRole('button', { name: '채팅의 계획대로 진행', exact: true }).click();
  await current.getByTestId('workflow-task-status').filter({ hasText: '계획 확인 저장됨' }).waitFor();
  assert.equal(await current.evaluate(() => window.__uiTest.workflow.tasks[0].plan), null);
  assert.equal(await current.evaluate(() => window.__uiTest.workflow.tasks[1].approval), null);
  assert.deepEqual(await current.evaluate(() => window.__uiTest.calls.find(call => call.name === 'approve_workflow_plan').args), { identity: standaloneIdentity, expectedPlanRevision: 0, expectedSettingsRevision: 0 });
  checks.push('workflow-only tasks keep exact account identity, allow explicit chat-plan confirmation without inventing plan text, and show unavailable verification honestly');

  await current.evaluate(() => {
    const { workflow } = window.__uiTest;
    workflow.capabilities.codex = { ...workflow.capabilities.codex, verification: 'verified', modelObservation: true, submissionHold: true, inputPreservation: true, singleSubmission: true, requestIdentity: true, availableModels: [{ model: 'gpt-5.6-sol', reasoning: ['medium'] }, { model: 'gpt-5.6-terra', reasoning: ['medium'] }] };
    const task = workflow.tasks[0];
    task.plan = { summary: '비교 기준을 정하고 세 곳의 자료를 확인해 초안을 작성해요.', steps: ['기준 정리', '자료 확인', '비교 초안'], completionCriteria: ['세 곳 비교표와 출처 포함'] };
    task.planRevision = 1;
    task.phase = 'ready';
    task.guard = { status: 'held', reason: '합성 시나리오: 관측 모델이 설정한 후보와 달라요.', submissionId: 'fixture-held-submission', requestFingerprint: 'fixture-request-only', checkedAt: Date.now() };
    task.observation = { model: 'gpt-6-astra', reasoning: 'high', mode: 'plan', source: 'verified-adapter', submissionId: 'fixture-held-submission', observedAt: Date.now() - 7200000 };
  });
  await current.getByText('계획이나 설정이 바뀌었어요. 다시 확인해주세요.', { exact: true }).waitFor();
  await current.getByTestId('workflow-model').filter({ hasText: 'Astra' }).waitFor();
  await current.getByTestId('workflow-observed-at').filter({ hasText: '최근 제출 확인' }).waitFor();
  assert.ok(await current.evaluate(() => window.__uiTest.workflow.tasks[0].observation.observedAt < Date.now() - 3600000));
  assert.equal(await current.getByTestId('workflow-reasoning').textContent(), '추론 · 미확인');
  assert.equal(await current.getByTestId('workflow-mode').textContent(), 'Plan 모드 · 미확인');
  assert.equal(await current.getByRole('button', { name: '이대로 진행', exact: true }).isEnabled(), true);
  assert.equal(await current.getByRole('button', { name: '이번 전송만 예외 허용', exact: true }).count(), 0);
  assert.equal(await current.getByText('계획 확인을 저장했어요. 채팅의 실제 설정을 확인한 뒤 진행해주세요.', { exact: true }).count(), 0);
  await current.getByRole('button', { name: '이대로 진행', exact: true }).click();
  await current.getByTestId('workflow-task-status').filter({ hasText: '계획 확인 저장됨' }).waitFor();
  await current.evaluate(() => {
    const task = window.__uiTest.workflow.tasks[0];
    task.guard = { status: 'held', reason: '합성 시나리오: 관측 모델이 설정한 실행 후보와 달라요.', submissionId: 'fixture-held-submission', requestFingerprint: 'fixture-request-only', checkedAt: Date.now() };
    task.observation = { model: 'gpt-6-astra', reasoning: 'high', mode: 'plan', source: 'verified-adapter', submissionId: 'fixture-held-submission', observedAt: Date.now() - 7200000 };
  });
  await current.getByRole('button', { name: '이번 전송만 예외 허용', exact: true }).waitFor();
  await labelFixture(current);
  const taskScreenshot = path.join(screenshotDir, 'native-ui-workflow-task.png');
  await current.screenshot({ path: taskScreenshot, animations: 'disabled', fullPage: true });
  snapshots.push(taskScreenshot);
  await current.getByRole('button', { name: '이번 전송만 예외 허용', exact: true }).click();
  await current.getByTestId('workflow-guard').filter({ hasText: '이 전송의 예외를 저장했어요' }).waitFor();
  assert.equal(await current.getByRole('button', { name: '이번 전송만 예외 허용', exact: true }).count(), 0);
  assert.deepEqual(await current.evaluate(() => window.__uiTest.calls.find(call => call.name === 'allow_workflow_once').args), { identity: standaloneIdentity, submissionId: 'fixture-held-submission', expectedPlanRevision: 1, expectedSettingsRevision: 0 });
  assert.equal(await current.evaluate(() => window.__uiTest.workflow.tasks[1].onceAvailable), false);
  await current.evaluate(() => { const task = window.__uiTest.workflow.tasks[0]; task.onceAvailable = false; task.guard.status = 'exception'; task.guard.submissionId = 'fixture-consumed-next-submission'; });
  await current.getByTestId('workflow-guard').filter({ hasText: '이번 요청에만 현재 설정을 허용했어요' }).waitFor();
  assert.equal(await current.getByText('같은 요청을 다시 보내주세요.', { exact: false }).count(), 0);
  await current.evaluate(() => { const task = window.__uiTest.workflow.tasks[0]; task.guard.status = 'unavailable'; task.guard.reason = '모델은 일치해요. 추론 수준은 직접 확인해주세요.'; task.observation.model = 'gpt-5.6-terra'; });
  await current.getByTestId('workflow-guard').filter({ hasText: '전송 전 설정 확인 불가' }).waitFor();
  await current.getByText('모델은 일치해요. 추론 수준은 직접 확인해주세요.', { exact: true }).waitFor();
  checks.push('observed model is independent of missing reasoning and Plan evidence; changed plan invalidates approval; one-shot permission binds one held submission');

  await current.getByText('이번 작업 조합 변경', { exact: true }).click();
  await current.getByLabel('이번 작업 조합', { exact: true }).selectOption('complex');
  await current.waitForFunction(() => window.__uiTest.workflow.tasks[0].settingsRevision === 1);
  assert.equal(await current.evaluate(() => window.__uiTest.workflow.tasks[0].approval), null);
  assert.equal(await current.evaluate(() => window.__uiTest.workflow.tasks[0].onceAvailable), false);
  assert.deepEqual(await current.evaluate(() => window.__uiTest.workflow.tasks[0].planning), presets.complex.planning);
  await current.getByRole('button', { name: '이 작업의 계획 도움 끄기', exact: true }).click();
  await current.getByTestId('workflow-task-status').filter({ hasText: '이 작업은 꺼짐' }).waitFor();
  assert.equal(await current.getByRole('button', { name: '이대로 진행', exact: true }).isEnabled(), false);
  assert.equal(await current.evaluate(() => window.__uiTest.workflow.tasks[1].enabled), true);
  assert.ok(await current.evaluate(() => window.__uiTest.workflow.tasks[0].plan.summary.length > 0));
  checks.push('task combination changes invalidate approval and exception; workflow-only off preserves the plan and other account state');
  await current.setViewportSize({ width: 430, height: 900 });
  await noOverflow(current, 430);
  checks.push('workflow task detail remains usable in a compact viewport without horizontal overflow');
  const historicalPet = await newPage({ width: 328, height: 600 });
  const observedState = structuredClone(fixture);
  observedState.sessions[0].attention = null;
  const historicalWorkflow = structuredClone(emptyWorkflow);
  historicalWorkflow.capabilities.codex = { ...historicalWorkflow.capabilities.codex, verification: 'verified', modelObservation: true, reasoningObservation: true };
  historicalWorkflow.tasks = [taskFixture(assistanceFixture.tasks[0].identity, { observation: { model: 'gpt-6-astra', reasoning: 'high', mode: null, source: 'verified-adapter', submissionId: 'past-submission', observedAt: Date.now() - 7200000 } })];
  await mockBridge(historicalPet, observedState, assistanceFixture, historicalWorkflow);
  await historicalPet.goto(`${origin}/?pet=0`);
  await historicalPet.locator('.floating-status').filter({ hasText: '최근 확인' }).waitFor();
  assert.match(await historicalPet.locator('.floating-status').textContent(), /Astra · high/);
  assert.equal(await historicalPet.evaluate(() => window.__uiTest.workflow.preferences.enabled), false);
  await historicalPet.getByRole('button', { name: '펫 메뉴', exact: true }).click();
  await historicalPet.getByRole('button', { name: '펫 카드 메뉴', exact: true }).click();
  await historicalPet.getByRole('button', { name: '이번 채팅 도움 끄기', exact: true }).click();
  await historicalPet.locator('.floating-status').filter({ hasText: '자동 도움은 꺼져 있어요' }).waitFor();
  assert.equal(await historicalPet.evaluate(() => window.__uiTest.workflow.tasks[0].enabled), false);
  assert.equal(await historicalPet.evaluate(() => window.__uiTest.assistance.tasks[0].enabled), false);
  checks.push('pet labels old verified settings as historical, retains existing tasks when new defaults are off, and turns off both help paths');
  return snapshots;
}

module.exports = { emptyWorkflow, runWorkflowChecks };
