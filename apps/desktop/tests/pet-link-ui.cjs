const assert = require('node:assert/strict');
const path = require('node:path');
const templates = require('../../../packages/contracts/data/roles.json');

exports.runPetLinkChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const page = await newPage({ width: 1120, height: 900 });
  const value = {
    ...structuredClone(fixture), sessions: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })),
    petLinks: [{
      version: 1, target: { sourceId: 'codex-windows-local', threadId: '11111111-2222-4333-8444-555555555555', cwd: 'C:/UI fixture only' },
      slot: 0, revision: 1, enabled: true, connected: true, profile: 'light', template: templates[1], run: null,
    }],
  };
  await mockBridge(page, value); await page.goto(origin);
  const card = page.locator('.explicit-pet');
  const profile = card.getByRole('combobox', { name: '다음 펫 작업 설정' });
  await card.getByText('작업 대기', { exact: true }).waitFor();
  assert.equal(await card.getByText('완료', { exact: true }).count(), 0);
  assert.equal(await profile.isVisible(), false, 'management starts collapsed');
  await card.locator('.explicit-settings summary').click();
  await profile.selectOption('careful');
  assert.equal(await page.evaluate(() => window.__uiTest.state.petLinks[0].profile), 'careful');

  // Observe the complete plan -> confirmation -> implementation -> result sequence.
  // These fixture events do not submit a request or execute a model.
  const showRun = async (state, profile, label) => {
    await page.evaluate(({ state, profile }) => {
      window.__uiTest.state.petLinks[0].run = {
        id: 'fixture-run', settingsRevision: window.__uiTest.state.petLinks[0].revision,
        profile, model: 'fixture-model', effort: 'medium', state,
        childId: null, turnId: null, observedModel: null, observedEffort: null,
        evidence: null, startedAt: Date.now(),
      };
      window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
    }, { state, profile });
    await card.locator(`.explicit-status-panel[data-state="${state}"]`).getByText(label, { exact: true }).waitFor();
  };
  await showRun('requested', 'plan', '계획 중');
  await card.getByText('실행 요청을 보냈어요. 시작 확인을 기다리고 있어요.', { exact: true }).waitFor();
  assert.equal(await profile.isDisabled(), true);
  await showRun('working', 'plan', '계획 중');
  await card.locator('[data-motion="thinking"]').waitFor();
  await showRun('waiting', 'plan', '계획 확인 필요');
  await card.getByRole('button', { name: '구현 요청 복사', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__uiTest.clipboard), '그대로 구현해줘');
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => /submit|send|prepare_pet|execute_pet/.test(call.name))), false, 'copying a follow-up never submits it');
  await showRun('requested', 'careful', '제작 중');
  await showRun('working', 'careful', '제작 중');
  await card.locator('[data-motion="writing"]').waitFor();
  assert.equal(await profile.isDisabled(), true);
  await showRun('returned', 'careful', '결과 확인');
  await card.locator('[data-motion="dizzy"]').waitFor();
  assert.equal(await card.getByText('완료', { exact: true }).count(), 0, 'a returned result alone does not mean completion');
  await showRun('complete', 'careful', '완료');
  await card.locator('[data-motion="celebrate"]').waitFor();
  assert.equal(await profile.isEnabled(), true);
  await showRun('unknown', 'careful', '실행 상태 확인 필요');
  await card.locator('[data-motion="angry"]').waitFor();
  assert.equal(await card.getByText('완료', { exact: true }).count(), 0);
  assert.equal(await profile.isDisabled(), true);
  await showRun('failed', 'careful', '작업 확인 실패');
  assert.equal(await card.getByText('완료', { exact: true }).count(), 0);
  await showRun('returned', 'careful', '결과 확인');

  await card.getByRole('button', { name: '도움 끄기', exact: true }).click();
  await card.getByText('새 펫 작업은 꺼져 있어요. 이미 시작한 작업은 계속 확인해요.', { exact: true }).waitFor();
  await card.getByText('결과 확인', { exact: true }).waitFor();
  await card.getByRole('button', { name: '도움 켜기', exact: true }).click();
  await card.getByRole('button', { name: '도움 끄기', exact: true }).waitFor();
  await card.getByRole('button', { name: '추적 정리', exact: true }).click();
  await card.getByRole('button', { name: '계속 추적', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => call.name === 'close_pet_tracking')), false);
  await card.getByRole('button', { name: '추적 정리', exact: true }).click();
  await card.getByRole('button', { name: '이 작업 추적 종료', exact: true }).click();
  await card.getByText('추적 종료', { exact: true }).waitFor();
  assert.equal(await profile.isEnabled(), true);
  await showRun('waiting', 'plan', '계획 확인 필요');
  await card.locator('.explicit-settings summary').click();
  const image = path.join(screenshotDir, 'native-ui-explicit-pet.png');
  await page.screenshot({ path: image, fullPage: true });

  const overlay = await newPage({ width: 420, height: 640 });
  await mockBridge(overlay, value); await overlay.goto(`${origin}/?pet=0`);
  await overlay.getByRole('button', { name: '제작 펫 메뉴', exact: true }).click();
  await overlay.locator('.explicit-settings summary').click();
  await overlay.getByRole('button', { name: '도움 끄기', exact: true }).waitFor();
  await overlay.evaluate(() => {
    window.__uiTest.state.petLinks[0].connected = false;
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  await overlay.locator('.explicit-status').filter({ hasText: /^연결 확인 필요$/ }).waitFor();
  await overlay.getByText('저장된 채팅을 열고 “펫 상태 확인”을 보내주세요.', { exact: true }).waitFor();
  checks.push('explicit pet: collapsed management; settings update; planning/confirmation/production/result/completion order; unknown/failed never imply completion; follow-up copy never submits; unresolved settings lock; disabled assistance keeps observing; deliberate tracking closure; disconnected recovery');
  return [image];
};
