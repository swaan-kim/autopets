const assert = require('node:assert/strict');
const path = require('node:path');
const templates = require('../../../packages/contracts/data/roles.json');

// "Codex 작업 중 · 12분째": a connected chat's current request, under the pet, on its card and on
// the docked handle. Fixture data only (snapshot.codexProgress); nothing runs in Codex.
const KEY = 'autopets.pet-settings.v1';
exports.runPetProgressChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const threadId = '11111111-2222-4333-8444-555555555555';
  const target = { sourceId: 'codex-windows-local', threadId, cwd: 'C:/UI fixture only' };
  const link = { version: 1, target, slot: 0, revision: 1, enabled: true, connected: true, profile: 'light', template: templates[1], run: null };
  const minute = 60_000;
  const progress = (extra = {}) => ({ target, turnId: '01a1d04a-0000-7000-8000-000000000001', startedAt: Date.now() - 12 * minute - 5000, partial: false,
    lastActivityAt: Date.now() - 20_000, tools: 7, lastTool: 'command', plan: [], endedAt: null, ...extra });
  const state = (item, extra = {}) => ({ ...structuredClone(fixture), sessions: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })), petLinks: [link], codexAttention: [], codexProgress: item ? [item] : [], ...extra });
  const plan = [{ step: '자료 조사', status: 'completed' }, { step: '초안 작성', status: 'in_progress' }, { step: '검토', status: 'pending' }];
  const status = pet => pet.locator('.floating-pet .floating-status').first();
  const open = async (initial, { settings = null, docked = false } = {}) => {
    const pet = await newPage({ width: 252, height: 404 });
    await mockBridge(pet, initial);
    await pet.addInitScript(({ key, settings, docked }) => {
      if (settings) localStorage.setItem(key, JSON.stringify(settings));
      if (!docked) return;
      const bridge = window.__TAURI_INTERNALS__; const invoke = bridge.invoke;
      bridge.invoke = async (name, args) => name === 'get_pet_dock' ? 'right' : invoke(name, args);
    }, { key: KEY, settings, docked });
    await pet.goto(`${origin}/?pet=0`);
    return pet;
  };
  const update = (pet, item) => pet.evaluate(item => {
    window.__uiTest.state.codexProgress = item ? [item] : [];
    window.__uiTest.emitEvent('autopets://snapshot', { ...structuredClone(window.__uiTest.state), now: Date.now() });
  }, item);

  // Out: the line under the pet, then the plan, the card, quiet and the end.
  const pet = await open(state(progress()));
  await status(pet).getByText('Codex 작업 중 · 12분째 · 명령 실행 중', { exact: true }).waitFor();
  checks.push('pet progress: "Codex 작업 중 · 12분째 · 명령 실행 중" under the pet');
  await update(pet, progress({ lastTool: 'plan', plan }));
  await status(pet).getByText('Codex 작업 중 · 12분째 · 1/3단계', { exact: true }).waitFor();
  await pet.locator('.floating-pet .pet-hit').click();
  const card = pet.getByRole('region', { name: 'Codex 진행 상황' });
  await card.waitFor();
  assert.equal(await card.getByRole('progressbar', { name: '계획 진행' }).getAttribute('aria-valuenow'), '1');
  await card.getByText('1/3단계 · 초안 작성', { exact: true }).waitFor();
  if (screenshotDir) await pet.screenshot({ path: path.join(screenshotDir, 'pet-progress-card.png') });
  await pet.keyboard.press('Escape'); await card.waitFor({ state: 'detached' });
  checks.push('pet progress: plan steps "1/3단계" and the card bar with the current step');
  await update(pet, progress({ lastActivityAt: Date.now() - 8 * minute }));
  await pet.locator('.floating-status.turn-progress.quiet').getByText('Codex 작업 중 · 12분째 · 8분째 소식 없음', { exact: true }).waitFor();
  checks.push('pet progress: no word for 8 minutes says so instead of looking busy');
  if (screenshotDir) { await update(pet, progress()); await status(pet).getByText(/명령 실행 중/).waitFor(); await pet.screenshot({ path: path.join(screenshotDir, 'pet-progress-line.png') }); }
  await update(pet, progress({ endedAt: Date.now() }));
  await pet.locator('.floating-status.turn-progress').waitFor({ state: 'detached' });
  await update(pet, progress({ startedAt: Date.now() - 30_000 }));
  await pet.waitForTimeout(400);
  assert.equal(await pet.locator('.floating-status.turn-progress').count(), 0, 'not before 2 minutes (default)');
  await update(pet, progress({ lastActivityAt: Date.now() - 70 * minute }));
  await pet.waitForTimeout(400);
  assert.equal(await pet.locator('.floating-status.turn-progress').count(), 0, 'an hour without a word: the end was missed, nothing shown');
  checks.push('pet progress: gone when the turn ends, hidden before 2 minutes and after an hour without a word');
  // A Codex question for the same chat outranks the clock.
  await pet.evaluate(item => {
    window.__uiTest.state.codexProgress = [item];
    window.__uiTest.state.codexAttention = [{ id: 'ask-1', target: item.target, chatTitle: '발표자료 채팅', turnId: item.turnId, kind: 'action_required', reason: 'approval_required',
      source: 'permission', summary: '명령 실행 승인을 기다리고 있어.', evidence: null, read: true, createdAt: Date.now(), updatedAt: Date.now() }];
    window.__uiTest.emitEvent('autopets://snapshot', { ...structuredClone(window.__uiTest.state), now: Date.now() });
  }, progress());
  await status(pet).getByText('Codex가 답을 기다리는 중', { exact: true }).waitFor();
  checks.push('pet progress: a waiting Codex question outranks the clock');
  await pet.close();

  // 펫 설정: off, or a later start.
  const off = await open(state(progress()), { settings: { dockedAlert: 'jump', peekSeconds: 10, alertOn: { done: true, ask: true, review: false }, entrance: 'bounce', bubbleWhenOut: true, showProgress: false, progressAfterMinutes: 2 } });
  await off.locator('.floating-pet .pet-hit').waitFor(); await off.waitForTimeout(500);
  assert.equal(await off.locator('.floating-status.turn-progress').count(), 0);
  await off.close();
  const later = await open(state(progress({ startedAt: Date.now() - 3 * minute })), { settings: { dockedAlert: 'jump', peekSeconds: 10, alertOn: { done: true, ask: true, review: false }, entrance: 'bounce', bubbleWhenOut: true, showProgress: true, progressAfterMinutes: 5 } });
  await later.locator('.floating-pet .pet-hit').waitFor(); await later.waitForTimeout(500);
  assert.equal(await later.locator('.floating-status.turn-progress').count(), 0, '5 minutes chosen: 3 minutes shows nothing');
  await later.close();
  checks.push('pet progress: 펫 설정 off and "5분 지나면" respected');

  // Tucked in: the handle says it, with the plan's share or the minutes.
  const docked = await open(state(progress({ plan })), { docked: true });
  const handle = docked.getByRole('button', { name: `${templates[1].name} 다시 보기 · Codex 작업 중 · 12분째 · 1/3단계`, exact: true });
  await handle.waitFor();
  assert.equal(await docked.locator('.pet-dock-progress i').evaluate(node => node.style.height), '33%');
  if (screenshotDir) await docked.screenshot({ path: path.join(screenshotDir, 'pet-progress-handle.png'), clip: { x: 252 - 60, y: 0, width: 60, height: 96 } });
  await update(docked, progress());
  await docked.locator('.pet-dock-minutes').getByText('12′', { exact: true }).waitFor();
  checks.push('pet progress: docked handle shows the plan share, or the minutes without a plan');
  await docked.close();
  return [];
};
