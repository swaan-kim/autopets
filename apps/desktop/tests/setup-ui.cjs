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
  await page.locator('.app-settings > summary').click(); await page.getByRole('button', { name: '연결 설정', exact: true }).click();
  await page.getByRole('heading', { name: '연결 설정', exact: true }).waitFor();
  assert.equal(await page.getByLabel('사용할 AI', { exact: true }).isVisible(), false);
  assert.equal(await page.locator('.connection-manage-card input').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__uiTest.calls), []);
  await page.waitForFunction(() => !window.__uiTest.onboardingActive);
  await page.evaluate(() => { document.querySelector('.connection-pill').textContent = 'UI 검수용 · 실제 연결 미검증'; });
  const initial = path.join(screenshotDir, 'native-ui-setup.png');
  await page.screenshot({ path: initial, fullPage: true, animations: 'disabled' });

  // A long onboarding page must not push the app's only main-window exit away.
  for (const viewport of [{ width: 960, height: 640 }, { width: 912, height: 449 }, { width: 640, height: 480 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.app-settings > summary').click();
    const quit = page.getByRole('button', { name: 'AutoPets 종료', exact: true });
    const bounds = await quit.boundingBox();
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height,
      `Quit control must be visible without scrolling at ${viewport.width}x${viewport.height}: ${JSON.stringify(bounds)}`);
    await quit.click();
    await page.locator('.app-settings > summary').click();
    assert.equal(await page.evaluate(() => window.__uiTest.calls.at(-1)?.name), 'quit_app');
    await page.evaluate(() => { window.__uiTest.calls.length = 0; });
    await page.screenshot({ path: path.join(screenshotDir, `native-ui-exit-${viewport.width}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1120, height: 880 });
  checks.push('settings exit remains reachable without scrolling on short and narrow screens');

  await page.getByRole('button', { name: '이 AI 연결하기', exact: true }).click();
  await page.getByText('호출 준비됨', { exact: true }).waitFor();
  await page.getByText('이제 쓰던 Codex 채팅에서 불러주세요.', { exact: true }).waitFor();
  assert.equal(await page.locator('.setup-progress li[data-done="true"]').count(), 2, 'app and skill preparation do not claim a connected conversation');
  assert.equal(await page.locator('.setup-next-step').innerText().then(text => text.includes('붙여넣을 필요가 없어요')), true);
  assert.equal(await page.evaluate(() => window.__uiTest.clipboard), '', 'connection preparation does not copy a prompt');
  await page.getByText('펫이 연결되지 않나요?', { exact: true }).click();
  await page.getByText(/펫 호출에는 새 훅 허용이 필요하지 않아요/).waitFor();
  assert.equal(await page.getByText('펫 연결됨', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '연결 복구', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__uiTest.calls), [{ name: 'connect_ai', args: { hostId: 'codex-windows-local' } }]);
  const pending = path.join(screenshotDir, 'native-ui-unified-pending.png');
  await page.screenshot({ path: pending, fullPage: true, animations: 'disabled' });
  checks.push('connection management does not mutate on entry; configured calling skill is distinct from a linked pet; other hosts and technical details are collapsed');

  await page.evaluate(() => { const connection = window.__uiTest.state.setup.connections[0]; connection.status = 'connected'; connection.firstTask = { sessionId: 'fixture-first-task', lastEventAt: Date.now() }; window.__uiTest.state.now = Date.now(); window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state)); });
  await page.getByText('다른 환경과 연결 상세', { exact: true }).click();
  await page.getByText('수신 확인', { exact: true }).waitFor();
  assert.equal(await page.locator('.connection-detail-list div').filter({ hasText: '자동 도움 전달' }).locator('dd').textContent(), '미확인');
  assert.equal(await page.getByText('펫 연결됨', { exact: true }).count(), 0);
  assert.equal(await page.locator('.setup-default strong').textContent(), '균형 있게');
  await page.getByText('실제 설정 확인', { exact: true }).click();
  await page.getByText('모델 미검증 · 추론 미검증 · 제출 보호 미검증', { exact: true }).waitFor();
  await page.getByLabel('사용할 AI', { exact: true }).selectOption('work-local');
  await page.getByText('호환성 확인 전', { exact: true }).waitFor();
  assert.equal(await page.locator('.setup-progress').count(), 0, 'an unsupported host never inherits Codex preparation steps');
  assert.equal(await page.getByRole('button', { name: '이 AI 연결하기', exact: true }).count(), 0);
  assert.equal(await page.locator('.setup-status').textContent(), '연결 전');
  await page.getByLabel('사용할 AI', { exact: true }).selectOption('chatgpt-web');
  await page.getByText(/이 웹·클라우드 환경은 아직 펫과 연결되지 않아요/).waitFor();
  assert.equal(await page.evaluate(() => window.__uiTest.calls.length), 1);
  await page.setViewportSize({ width: 430, height: 1000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 430), JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > 430).map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })))));
  const guidance = path.join(screenshotDir, 'native-ui-unified-guidance-mobile.png');
  await page.screenshot({ path: guidance, fullPage: true, animations: 'disabled' });
  checks.push('first task does not imply guidance or setting verification, and another host never inherits the selected host evidence');

  await page.getByLabel('사용할 AI', { exact: true }).selectOption('codex-windows-local');
  await page.getByText('연결 해제', { exact: true }).click();
  await page.getByRole('button', { name: '이 AI 연결 해제', exact: true }).click();
  await page.getByRole('button', { name: '이 AI 연결하기', exact: true }).waitFor();
  await page.evaluate(() => { window.__uiTest.connectionError = '검수용 연결 실패'; });
  await page.getByRole('button', { name: '이 AI 연결하기', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '연결 설정을 바꾸지 못했어요' }).waitFor();
  assert.equal(await page.locator('.setup-status').textContent(), '연결 전');
  assert.equal(await page.getByRole('button', { name: '이 AI 연결하기', exact: true }).isEnabled(), true);
  checks.push('disconnect and failed setup leave a retryable connection and never fabricate a first task');

  const beforeDownload = await page.evaluate(() => window.__uiTest.calls.length);
  await page.getByText('다른 AI에서도 펫 설정 쓰기', { exact: true }).click();
  await page.evaluate(() => { window.__uiTest.holdPreferenceExport = true; });
  await page.getByRole('button', { name: 'Claude에 설치', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '여는 중…', exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.__uiTest.releasePreferenceExport(); window.__uiTest.holdPreferenceExport = false; });
  await page.getByText(/Claude 설치 창에서 설치를 눌러 주세요/).waitFor();
  assert.deepEqual(await page.evaluate(index => window.__uiTest.calls.slice(index), beforeDownload), [{ name: 'install_pet_preferences_in_claude', args: {} }]);
  assert.equal(await page.evaluate(() => window.__uiTest.clipboard), '');
  await page.evaluate(() => { window.__uiTest.preferenceExportError = true; });
  await page.getByRole('button', { name: 'Claude에 설치', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Claude 설치 창을 열지 못했어요' }).waitFor();
  assert.equal(await page.getByText(/Claude 설치 창에서 설치를 눌러 주세요/).count(), 0, 'failed export does not retain the previous success');
  assert.equal(await page.getByRole('button', { name: 'Claude에 설치', exact: true }).isEnabled(), true);
  const claudeCode = page.getByRole('region', { name: 'Claude Code 연결' });
  await claudeCode.getByRole('button', { name: 'Claude Code에 연결', exact: true }).click();
  await claudeCode.getByText('연결했어요. 새로 여는 Claude Code 세션부터 펫이 움직여요.', { exact: true }).waitFor();
  await page.evaluate(() => { window.__uiTest.claudeCodeError = true; });
  await claudeCode.getByRole('button', { name: 'Claude Code 연결 해제', exact: true }).click();
  await claudeCode.getByRole('alert').filter({ hasText: 'Claude Code를 찾지 못했어요' }).waitFor();
  assert.equal(await claudeCode.getByRole('status').count(), 0, 'a failed change never keeps the previous success');
  await page.evaluate(() => { window.__uiTest.claudeCodeError = false; });
  assert.deepEqual(await page.evaluate(() => window.__uiTest.calls.filter(call => /claude_code/.test(call.name)).map(call => call.name)), ['connect_claude_code', 'disconnect_claude_code']);
  checks.push('native connector export and Claude Code connect/disconnect are click-only, suppresses duplicate clicks and reports save failure without installing or granting host capability');

  const browserPage = await newPage();
  await browserPage.goto(origin);
  await browserPage.locator('.app-settings > summary').click();
  await browserPage.getByRole('button', { name: '연결 설정', exact: true }).click();
  await browserPage.getByText('다른 AI에서도 펫 설정 쓰기', { exact: true }).click();
  const download = browserPage.waitForEvent('download');
  await browserPage.getByRole('link', { name: 'Claude 연결 파일', exact: true }).click();
  const bundle = await download;
  assert.equal(bundle.suggestedFilename(), 'AutoPets-pet-preferences.mcpb');
  assert.equal(await bundle.failure(), null);
  const stream = await bundle.createReadStream(); const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).readUInt32LE(0), 0x04034b50, 'the user receives an actual local extension ZIP');
  await browserPage.close();
  checks.push('browser preview downloads an actual local extension ZIP; file download is distinct from native export and host installation');

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
