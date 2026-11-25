const assert = require('node:assert/strict');
const path = require('node:path');
const templates = require('../../../packages/contracts/data/roles.json');
const catalog = require('../../../packages/contracts/data/pet-catalog.json');

// "컴퓨터를 켤 때 · 펫 띄우기" in 설정 → 펫 설정, the one-time question, and pets right after a restart:
// resting (not an error) with their chat name, and "채팅 열기" connecting the same saved link again.
// Fixture data only: the Windows sign-in entry and the Codex chat check are stood in for.
exports.runPetAutostartChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const threadId = '11111111-2222-4333-8444-555555555555';
  const target = { sourceId: 'codex-windows-local', threadId, cwd: 'C:/UI fixture only' };
  const link = (extra = {}) => ({ version: 1, target, slot: 0, revision: 3, enabled: true, connected: false, resting: true, profile: 'light', template: templates[1], run: null, ...extra });
  const state = (links = [link()], extra = {}) => ({ ...structuredClone(fixture), sessions: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })), petLinks: links, ...extra });
  const manager = async (autostart, initial = state([])) => {
    const page = await newPage({ width: 1120, height: 900 });
    await mockBridge(page, initial);
    await page.addInitScript(value => { window.__uiTest.autostart = value; window.__uiTest.chatTitles = { '11111111-2222-4333-8444-555555555555': '발표 준비' }; }, autostart);
    await page.goto(origin);
    return page;
  };
  const openSettings = async page => {
    await page.locator('.app-settings summary').click();
    await page.getByRole('button', { name: '펫 설정', exact: true }).click();
    return page.getByRole('region', { name: '컴퓨터를 켤 때' });
  };

  // --- The card: off by default, saved at once, off removes the entry ---
  const page = await manager({ enabled: false, asked: true });
  const card = await openSettings(page);
  await card.waitFor();
  const toggle = card.getByRole('checkbox', { name: '펫 띄우기', exact: true });
  assert.equal(await toggle.isChecked(), false, 'off by default');
  await card.getByText('컴퓨터를 켜면 마지막에 쓰던 펫이 바로 떠요', { exact: true }).waitFor();
  assert.equal(await toggle.getAttribute('data-agent-id'), 'settings.autostart');
  assert.equal(await page.locator('[data-agent-id="settings.autostart-prompt"]').count(), 0, 'already asked: no question');
  await toggle.check();
  await page.getByRole('status').getByText('저장했어요. 다음에 컴퓨터를 켜면 펫이 떠요.', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__uiTest.autostart), { enabled: true, asked: true });
  if (screenshotDir) await card.screenshot({ path: path.join(screenshotDir, 'pet-autostart-card.png') });
  await toggle.uncheck();
  await page.getByRole('status').getByText('저장했어요. 컴퓨터를 켜도 펫이 뜨지 않아요.', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__uiTest.autostart), { enabled: false, asked: true }, 'off removes the entry');
  await page.evaluate(() => { window.__uiTest.autostartError = 'denied'; });
  await toggle.click();
  await card.getByRole('alert').getByText('시작 프로그램 설정을 바꾸지 못했어요.', { exact: true }).waitFor();
  assert.equal(await toggle.isChecked(), false, 'a failed change is not shown as saved');
  if (screenshotDir) {
    await page.evaluate(() => { window.__uiTest.autostartError = null; });
    await toggle.check(); await page.getByRole('status').getByText('저장했어요. 다음에 컴퓨터를 켜면 펫이 떠요.', { exact: true }).waitFor();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.locator('.pet-settings-page').screenshot({ path: path.join(screenshotDir, 'pet-autostart-page.png') });
  }
  checks.push('펫 설정 "컴퓨터를 켤 때": 펫 띄우기 off by default, saved at once on and off, a failure says so');
  await page.close();

  // --- Asked once: 띄우기 turns it on, 나중에 keeps it off; never again ---
  for (const [answer, expected] of [['띄우기', { enabled: true, asked: true }], ['나중에', { enabled: false, asked: true }]]) {
    const first = await manager({ enabled: false, asked: false });
    const prompt = first.getByRole('dialog', { name: '컴퓨터를 켤 때' });
    await prompt.getByText('컴퓨터를 켜면 펫을 띄울까요?', { exact: true }).waitFor();
    if (screenshotDir && answer === '띄우기') await first.screenshot({ path: path.join(screenshotDir, 'pet-autostart-prompt.png') });
    await prompt.getByRole('button', { name: answer, exact: true }).click();
    await prompt.waitFor({ state: 'detached' });
    assert.deepEqual(await first.evaluate(() => window.__uiTest.autostart), expected, answer);
    // The app reads the saved answer again (as on its next start): the question stays away.
    await first.evaluate(() => window.dispatchEvent(new Event('autopets-autostart-changed')));
    await first.waitForTimeout(400);
    assert.equal(await first.getByRole('dialog', { name: '컴퓨터를 켤 때' }).count(), 0, `${answer}: not asked again`);
    await first.close();
  }
  checks.push('one-time "컴퓨터를 켜면 펫을 띄울까요?": 띄우기 → on, 나중에 → off, never asked again');

  // --- After a restart: the pet rests with its chat name; 채팅 열기 connects the same link ---
  const pet = await newPage({ width: 328, height: 600 });
  await mockBridge(pet, state());
  await pet.addInitScript(() => { window.__uiTest.chatTitles = { '11111111-2222-4333-8444-555555555555': '발표 준비' }; });
  await pet.goto(`${origin}/?pet=0`);
  await pet.locator('.floating-pet .floating-status').getByText('쉬는 중', { exact: true }).waitFor();
  assert.equal(await pet.getByText('연결 확인 필요').count(), 0, 'not an error');
  await pet.locator('.pet-hit').click();
  const popup = pet.locator('.pet-popup');
  await popup.waitFor();
  assert.equal(await popup.getAttribute('data-connection'), 'resting');
  assert.equal(await popup.locator('.pet-popup-title strong').innerText(), '발표 준비', 'which chat it belongs to');
  assert.equal(await popup.locator('.pet-popup-status').innerText(), `${templates[1].name} · 쉬는 중`);
  await popup.getByText('‘채팅 열기’를 누르면 다시 이어져요.', { exact: true }).waitFor();
  assert.equal(await popup.locator('.pet-popup-guide.lost').count(), 0);
  const open = popup.locator('[data-agent-id="task-card.open-chat"]');
  assert.equal(await open.getAttribute('aria-label'), '채팅 열기');
  assert.equal(await pet.evaluate(() => window.__uiTest.calls.some(call => /open_pet_task|send_|connect/.test(call.name))), false, 'nothing is opened, connected or sent by itself');
  if (screenshotDir) await pet.screenshot({ path: path.join(screenshotDir, 'pet-resting-popup.png') });
  await open.click();
  await popup.getByText('채팅을 열고 다시 이었어요.', { exact: true }).waitFor();
  assert.deepEqual(await pet.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_task').map(call => call.args)), [{ target, expectedRevision: 3 }], 'the same saved link, once');
  await popup.locator('.pet-popup-status').getByText(`${templates[1].name} · 작업 대기`, { exact: true }).waitFor();
  assert.equal(await popup.getAttribute('data-connection'), 'connected');
  checks.push('restart: the pet rests (쉬는 중) with its chat name; 채팅 열기 opens and connects the same saved link once, nothing by itself');
  await pet.close();

  // --- The chat is gone from Codex: not connected, no other chat, how to start again ---
  const gone = await newPage({ width: 328, height: 600 });
  await mockBridge(gone, state());
  await gone.addInitScript(() => { window.__uiTest.returnError = 'codex-chat-not-found'; });
  await gone.goto(`${origin}/?pet=0`);
  await gone.locator('.pet-hit').click();
  await gone.locator('[data-agent-id="task-card.open-chat"]').click();
  await gone.getByText('채팅을 찾을 수 없어요. Codex에서 새 채팅을 열고 $autopets를 입력하면 새로 시작해요.', { exact: true }).waitFor();
  assert.equal(await gone.evaluate(() => window.__uiTest.state.petLinks[0].connected), false);
  assert.equal(await gone.getByRole('button', { name: '작업 ID 복사' }).count(), 0, 'no copy-the-id fallback for a chat that is gone');
  checks.push('restart + chat gone: "채팅을 찾을 수 없어요" with how to start again; nothing connected');
  await gone.close();

  // --- An unfinished task keeps the usual check; a 복습 도우미 drop offers 채팅 열기 ---
  const busy = await newPage({ width: 328, height: 600 });
  await mockBridge(busy, state([link({ run: { id: 'r1', settingsRevision: 3, profile: 'light', model: 'm', effort: 'low', state: 'unknown', childId: null, turnId: null } })]));
  await busy.goto(`${origin}/?pet=0`);
  // Its own state, not a broken connection; its rules stay (nothing changes until it is checked).
  await busy.locator('.floating-pet .floating-status').getByText('실행 상태 확인 필요', { exact: true }).waitFor();
  assert.equal(await busy.getByText('연결 확인 필요').count(), 0);
  checks.push('restart + unfinished task: shows its task state (실행 상태 확인 필요), not 연결 확인 필요');
  await busy.close();
  const review = await newPage({ width: 328, height: 600 });
  await mockBridge(review, state([link({ template: catalog.find(entry => entry.id === 'review-helper').template })], { review: { due: 0, total: 0, batches: 0, notifiedToday: true } }));
  await review.goto(`${origin}/?pet=0`);
  await review.locator('.pet-hit').waitFor();
  await review.evaluate(() => window.__uiTest.emitEvent('autopets://pet-drag-end', { label: 'pet-0', edge: null, codex: true }));
  const drop = review.locator('[data-agent-id="task-card.review-drop"]');
  await drop.getByText('‘채팅 열기’를 누르면 다시 이어져요.', { exact: true }).waitFor();
  await drop.getByRole('button', { name: '채팅 열기', exact: true }).click();
  assert.equal((await review.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_task'))).length, 1);
  checks.push('restart + 복습 도우미 dropped on Codex: 채팅 열기 instead of an error');
  await review.close();
  return [];
};
