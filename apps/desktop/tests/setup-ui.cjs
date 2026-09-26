const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const hosts = require('../../../packages/contracts/data/connections.json');

async function runSetupChecks({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const setup = {
    version: 1, installedVersion: '0.1.0', phase: 'not-started', appReady: true,
    chatConnected: false, guidanceDelivered: false, protection: { model: false, reasoning: false, submission: false },
    retryable: true, nextAction: 'start', currentHostId: null, hosts,
    connections: [{ hostId: 'codex-windows-local', configured: false, status: 'disconnected', hostVersion: null, firstTask: null, guidanceDelivered: false, settingsVerified: { model: false, reasoning: false, submission: false } }],
  };
  const page = await newPage();
  await mockBridge(page, { ...structuredClone(fixture), sessions: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })), setup });
  await page.goto(origin);
  await page.getByRole('heading', { name: 'AI 연결', exact: true }).waitFor();
  assert.equal(await page.locator('.setup-step').count(), 3);
  assert.equal(await page.locator('.setup-default strong').textContent(), '균형 있게');
  assert.equal(await page.locator('.setup-step input').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__uiTest.calls), []);
  await page.getByText('희망 설정과 AI의 실제 모델·추론 설정은 별도예요.', { exact: true }).waitFor();
  await page.evaluate(() => { document.querySelector('.connection-pill').textContent = 'UI 검수용 · 실제 연결 미검증'; });
  const initial = path.join(screenshotDir, 'native-ui-setup.png');
  await page.screenshot({ path: initial, fullPage: true, animations: 'disabled' });

  // A long onboarding page must not push the app's only main-window exit away.
  for (const viewport of [{ width: 960, height: 640 }, { width: 912, height: 449 }, { width: 640, height: 480 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    const quit = page.getByRole('button', { name: 'AutoPets 종료', exact: true });
    const bounds = await quit.boundingBox();
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height,
      `Quit control must be visible without scrolling at ${viewport.width}x${viewport.height}: ${JSON.stringify(bounds)}`);
    await quit.click();
    assert.equal(await page.evaluate(() => window.__uiTest.calls.at(-1)?.name), 'quit_app');
    await page.evaluate(() => { window.__uiTest.calls.length = 0; });
    await page.screenshot({ path: path.join(screenshotDir, `native-ui-exit-${viewport.width}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1120, height: 880 });
  checks.push('main-window exit remains visible and callable on short and narrow screens');

  await page.getByRole('button', { name: '이 AI 연결하기', exact: true }).click();
  await page.getByText('채팅에서 호출 대기', { exact: true }).waitFor();
  await page.getByText(/이 연결에는 훅 허용이 필요하지 않아요/).waitFor();
  assert.equal(await page.locator('.setup-step').nth(2).locator('.setup-status').textContent(), '확인 전');
  assert.equal(await page.getByRole('button', { name: '연결 설정 준비됨', exact: true }).isEnabled(), false);
  assert.deepEqual(await page.evaluate(() => window.__uiTest.calls), [{ name: 'connect_ai', args: { hostId: 'codex-windows-local' } }]);
  const pending = path.join(screenshotDir, 'native-ui-unified-pending.png');
  await page.screenshot({ path: pending, fullPage: true, animations: 'disabled' });
  checks.push('first launch has three steps, no forced questions or mutations; explicit connect waits for trust/restart and a real first task');

  await page.evaluate(() => { const connection = window.__uiTest.state.setup.connections[0]; connection.status = 'connected'; connection.firstTask = { sessionId: 'fixture-first-task', lastEventAt: Date.now() }; });
  await page.getByText('활동 확인됨', { exact: true }).waitFor();
  await page.getByText('자동 도움 전달 · 미확인', { exact: true }).waitFor();
  await page.getByText('실제 설정 확인', { exact: true }).click();
  await page.getByText('모델 미검증 · 추론 미검증 · 제출 보호 미검증', { exact: true }).waitFor();
  await page.getByLabel('사용할 AI', { exact: true }).selectOption('work-local');
  await page.getByText('호환성 확인 전', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '이 AI 연결하기', exact: true }).count(), 0);
  assert.equal(await page.locator('.setup-step').nth(2).locator('.setup-status').textContent(), '확인 전');
  await page.getByLabel('사용할 AI', { exact: true }).selectOption('chatgpt-web');
  await page.getByText(/웹·클라우드 채팅은 이 PC와 자동 연결되지 않아요/).waitFor();
  assert.equal(await page.evaluate(() => window.__uiTest.calls.length), 1);
  await page.setViewportSize({ width: 430, height: 1000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 430), JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > 430).map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })))));
  const guidance = path.join(screenshotDir, 'native-ui-unified-guidance-mobile.png');
  await page.screenshot({ path: guidance, fullPage: true, animations: 'disabled' });
  checks.push('first task does not imply guidance or setting verification, and another host never inherits the selected host evidence');

  await page.getByLabel('사용할 AI', { exact: true }).selectOption('codex-windows-local');
  await page.getByText('연결 관리', { exact: true }).click();
  await page.getByRole('button', { name: '이 AI 연결 해제', exact: true }).click();
  await page.getByRole('button', { name: '이 AI 연결하기', exact: true }).waitFor();
  await page.evaluate(() => { window.__uiTest.connectionError = '검수용 연결 실패'; });
  await page.getByRole('button', { name: '이 AI 연결하기', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '검수용 연결 실패' }).waitFor();
  assert.equal(await page.locator('.setup-step').nth(2).locator('.setup-status').textContent(), '확인 전');
  assert.equal(await page.getByRole('button', { name: '이 AI 연결하기', exact: true }).isEnabled(), true);
  checks.push('disconnect and failed setup leave a retryable connection and never fabricate a first task');

  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => call.name.includes('app_update'))), false);
  await page.getByText('앱 업데이트', { exact: true }).click();
  await page.getByRole('button', { name: '업데이트 확인', exact: true }).click();
  await page.getByText('이 빌드에서는 공개 업데이트를 제공하지 않아요.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /설치하기$/ }).count(), 0);
  await page.evaluate(() => { window.__uiTest.update = { status: 'available', version: '0.2.0-fixture' }; });
  await page.getByRole('button', { name: '업데이트 확인', exact: true }).click();
  await page.getByRole('button', { name: '0.2.0-fixture 설치하기', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'install_app_update').length), 0);
  await page.getByRole('button', { name: '0.2.0-fixture 설치하기', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'install_app_update')), [{ name: 'install_app_update', args: { version: '0.2.0-fixture' } }]);
  checks.push('updates are never checked or installed automatically; review builds stay disabled and installation binds the offered version');
  await page.close();
  return [initial, pending, guidance];
}
module.exports = { runSetupChecks };
