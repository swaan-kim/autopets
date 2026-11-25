const assert = require('node:assert/strict');
const path = require('node:path');
const templates = require('../../../packages/contracts/data/roles.json');

// 설정 → 펫 설정, and what it changes on a pet tucked into a screen edge when a Codex notice
// arrives: jump out with the bubble / come out and tuck back in / only the badge. Fixture data
// only: the native window is stubbed (get_pet_dock says "right"), nothing is opened in Codex.
const KEY = 'autopets.pet-settings.v1';
exports.runPetSettingsChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const threadId = '11111111-2222-4333-8444-555555555555';
  const target = { sourceId: 'codex-windows-local', threadId, cwd: 'C:/UI fixture only' };
  const link = { version: 1, target, slot: 0, revision: 1, enabled: true, connected: true, profile: 'light', template: templates[1], run: null };
  const state = { ...structuredClone(fixture), sessions: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })), petLinks: [link], codexAttention: [] };
  const notice = (id, kind = 'completed', read = false) => ({ id, target, chatTitle: '발표자료 채팅', turnId: `turn-${id}`, kind, reason: kind === 'action_required' ? 'confirmation_required' : 'final_answer',
    source: 'stop', summary: '발표자료 초안을 다 만들었어.', evidence: null, read, createdAt: Date.now(), updatedAt: Date.now() });

  // --- The page under 설정, right below 역할과 내 펫 ---
  const manager = await newPage({ width: 1120, height: 900 });
  await mockBridge(manager, state); await manager.goto(origin);
  await manager.locator('.app-settings summary').click();
  const items = await manager.locator('.settings-menu .nav-item').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
  assert.deepEqual(items.slice(-2), ['역할과 내 펫', '펫 설정'], '펫 설정 sits right below 역할과 내 펫');
  await manager.getByRole('button', { name: '펫 설정', exact: true }).click();
  const page = manager.getByRole('region', { name: '펫 설정', exact: true });
  await page.waitFor();
  assert.equal(await page.getByRole('radio', { name: /뛰어나와서 알려주기/ }).isChecked(), true, 'default: jump out with the bubble');
  assert.equal(await page.getByRole('checkbox', { name: '작업이 끝났을 때', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: '확인이 필요할 때', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: '복습할 문제가 생겼을 때', exact: true }).isChecked(), false);
  assert.equal(await page.getByRole('radiogroup', { name: '다시 숨기까지' }).count(), 0, 'seconds only for "잠깐 나왔다"');
  if (screenshotDir) await manager.screenshot({ path: path.join(screenshotDir, 'pet-settings-page.png'), fullPage: true });
  await page.getByText('잠깐 나왔다 다시 숨기', { exact: true }).click();
  await page.getByRole('radiogroup', { name: '다시 숨기까지' }).waitFor();
  await page.getByText('5초', { exact: true }).click();
  await page.getByText('조용히 미끄러지기', { exact: true }).click();
  await page.getByRole('status').getByText('저장했어요. 펫에 바로 적용돼요.', { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await manager.evaluate(key => localStorage.getItem(key), KEY)),
    { dockedAlert: 'peek', peekSeconds: 5, alertOn: { done: true, ask: true, review: false }, entrance: 'slide', bubbleWhenOut: true });
  if (screenshotDir) await manager.screenshot({ path: path.join(screenshotDir, 'pet-settings-peek.png'), fullPage: true });
  await page.getByText('숨은 채로 표시만', { exact: true }).click();
  assert.equal(await page.getByRole('checkbox', { name: '작업이 끝났을 때', exact: true }).isDisabled(), true, 'badge-only: the notice kinds do not apply');
  await page.getByRole('button', { name: '기본값으로 되돌리기', exact: true }).click();
  assert.equal(await page.getByRole('radio', { name: /뛰어나와서 알려주기/ }).isChecked(), true);
  assert.equal(await manager.evaluate(key => JSON.parse(localStorage.getItem(key)).dockedAlert, KEY), 'jump');
  checks.push('pet settings page: under 역할과 내 펫, defaults, peek seconds, saved at once, badge-only disables kinds, reset');
  await manager.close();

  // --- A pet tucked into the right edge ---
  const tuckedPet = async (settings, initial = state, given = null) => {
    const pet = given ?? await newPage({ width: 252, height: 404 });
    await mockBridge(pet, initial);
    await pet.addInitScript(({ key, settings }) => {
      if (settings) localStorage.setItem(key, JSON.stringify(settings));
      const bridge = window.__TAURI_INTERNALS__; const invoke = bridge.invoke;
      bridge.invoke = async (name, args) => name === 'get_pet_dock' ? 'right' : invoke(name, args);
    }, { key: KEY, settings });
    await pet.goto(`${origin}/?pet=0`);
    await pet.getByRole('button', { name: new RegExp(`^${templates[1].name} 다시 보기`) }).waitFor();
    return pet;
  };
  const arrive = (pet, item) => pet.evaluate(item => {
    window.__uiTest.state.codexAttention = [...(window.__uiTest.state.codexAttention ?? []), item];
    window.__uiTest.emitEvent('autopets://snapshot', { ...structuredClone(window.__uiTest.state), now: Date.now() });
  }, item);
  const called = (pet, name) => pet.evaluate(name => window.__uiTest.calls.filter(call => call.name === name).map(call => call.args ?? null), name);
  const bubble = pet => pet.locator('[data-agent-id="pet-codex-attention.bubble"]');

  // Default (jump): a finished Codex chat brings the pet out with a hop and the bubble open; it stays out.
  const jump = await tuckedPet(null);
  await arrive(jump, notice('done-1'));
  await jump.locator('.pet-overlay.dock-enter.dock-jump.dock-right').waitFor();
  await bubble(jump).locator('.pet-codex-headline', { hasText: 'Codex 작업이 완료됐어!' }).waitFor();
  assert.equal((await called(jump, 'undock_pet')).length, 1);
  if (screenshotDir) await jump.screenshot({ path: path.join(screenshotDir, 'pet-jump-out.png') });
  await jump.waitForTimeout(1500);
  assert.equal((await called(jump, 'dock_pet')).length, 0, 'jump: the pet stays out');
  checks.push('tucked pet + new Codex notice (default): hops out with the bubble and stays');
  await jump.close();

  // A notice that was already there when the window opened does not bring it out.
  const old = await tuckedPet(null, { ...state, codexAttention: [notice('old-1')] });
  await old.waitForTimeout(800);
  assert.equal((await called(old, 'undock_pet')).length, 0, 'notices from before do not bring it out');
  assert.equal(await old.locator('.pet-dock-badge.codex-done').count(), 1);
  checks.push('tucked pet: an existing notice at start only shows the badge');
  await old.close();

  // peek 5 s + slide: out without the hop, then back into the same side when left alone.
  const peek = await tuckedPet({ dockedAlert: 'peek', peekSeconds: 5, alertOn: { done: true, ask: true, review: false }, entrance: 'slide', bubbleWhenOut: true });
  await arrive(peek, notice('ask-1', 'action_required'));
  await bubble(peek).locator('.pet-codex-headline', { hasText: 'Codex에서 확인이 필요해!' }).waitFor();
  assert.equal(await peek.locator('.pet-overlay.dock-jump').count(), 0, 'slide: no hop');
  await peek.getByRole('button', { name: new RegExp(`^${templates[1].name} 다시 보기`) }).waitFor({ timeout: 9000 });
  assert.deepEqual(await called(peek, 'dock_pet'), [{ edge: 'right' }], 'peek: back into the side it came from');
  checks.push('tucked pet + peek 5s: comes out with the bubble, tucks back into the same side when left alone');
  // Touching it keeps it out.
  await arrive(peek, notice('ask-2', 'action_required'));
  await bubble(peek).waitFor();
  await peek.waitForTimeout(800);
  await peek.mouse.move(120, 300); await peek.mouse.move(130, 310);
  await peek.waitForTimeout(5500);
  assert.equal((await called(peek, 'dock_pet')).length, 1, 'peek: a pet the pointer touched stays out');
  checks.push('peek: the pointer on the pet keeps it out');
  await peek.close();

  // Only the badge, and a kind that is switched off.
  for (const [label, settings, item] of [
    ['badge only', { dockedAlert: 'badge', peekSeconds: 10, alertOn: { done: true, ask: true, review: false }, entrance: 'bounce', bubbleWhenOut: true }, notice('done-2')],
    ['완료 off', { dockedAlert: 'jump', peekSeconds: 10, alertOn: { done: false, ask: true, review: false }, entrance: 'bounce', bubbleWhenOut: true }, notice('done-3')],
  ]) {
    const pet = await tuckedPet(settings);
    await arrive(pet, item);
    await pet.locator('.pet-dock-badge.codex-done').waitFor();
    await pet.waitForTimeout(800);
    assert.equal((await called(pet, 'undock_pet')).length, 0, `${label}: stays tucked in`);
    checks.push(`tucked pet + notice, ${label}: stays tucked in with the badge`);
    await pet.close();
  }

  // "숨은 펫으로 시험해보기" on the page reaches a tucked-in pet in another window.
  // Both windows in one browser context, like the app's windows sharing one origin.
  const shared = await jump.context().browser().newContext({ viewport: { width: 1120, height: 900 }, deviceScaleFactor: 1 });
  const tried = await tuckedPet(null, state, await shared.newPage());
  const settingsWindow = await shared.newPage();
  await mockBridge(settingsWindow, state); await settingsWindow.goto(origin);
  await settingsWindow.locator('.app-settings summary').click();
  await settingsWindow.getByRole('button', { name: '펫 설정', exact: true }).click();
  await settingsWindow.getByRole('button', { name: '숨은 펫으로 시험해보기', exact: true }).click();
  await tried.locator('.floating-pet .pet-hit').waitFor();
  assert.equal((await called(tried, 'undock_pet')).length, 1);
  checks.push('펫 설정 "숨은 펫으로 시험해보기": a tucked pet in another window comes out');
  await shared.close();

  // Out already, with the automatic bubble switched off: the mark only, no bubble.
  const quiet = await newPage({ width: 252, height: 404 });
  await mockBridge(quiet, state);
  await quiet.addInitScript(key => localStorage.setItem(key, JSON.stringify({ dockedAlert: 'jump', peekSeconds: 10, alertOn: { done: true, ask: true, review: false }, entrance: 'bounce', bubbleWhenOut: false })), KEY);
  await quiet.goto(`${origin}/?pet=0`);
  await quiet.locator('.floating-pet .pet-hit').waitFor();
  await arrive(quiet, notice('done-4'));
  await quiet.locator('.floating-pet .pet-codex-mark.done').waitFor();
  await quiet.waitForTimeout(500);
  assert.equal(await bubble(quiet).count(), 0, 'bubbleWhenOut off: no bubble by itself');
  checks.push('pet out + 말풍선 자동 off: only the ✓ mark');
  await quiet.close();
  return [];
};
