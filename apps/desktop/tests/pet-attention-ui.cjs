const assert = require('node:assert/strict');
const templates = require('../../../packages/contracts/data/roles.json');

// The pet's ? mark: hover shows the Codex attention bubble, leaving hides it, a click pins it and
// another click closes it (fixture data only; nothing is opened in Codex). No screenshots, so
// docs/images stay untouched.
exports.runPetAttentionChecks = async ({ newPage, mockBridge, fixture, origin, checks }) => {
  const threadId = '11111111-2222-4333-8444-555555555555';
  const target = { sourceId: 'codex-windows-local', threadId, cwd: 'C:/UI fixture only' };
  const ask = { id: 'fixture-ask', target, chatTitle: '발표자료 채팅', turnId: 'fixture-turn', kind: 'action_required', reason: 'confirmation_required',
    source: 'stop', summary: '작업 계획을 정리했어. 이대로 진행할지 물어보고 있어.', evidence: null, read: true, createdAt: fixture.now, updatedAt: fixture.now };
  const link = { version: 1, target, slot: 0, revision: 1, enabled: true, connected: true, profile: 'light', template: templates[1], run: null };
  const cases = [
    ['explicit pet', { ...structuredClone(fixture), sessions: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })), petLinks: [link], codexAttention: [ask] }],
    ['session pet', { ...structuredClone(fixture), petLinks: [], codexAttention: [{ ...ask, target: { ...target, threadId: '99999999-2222-4333-8444-555555555555' } }] }],
  ];
  for (const [label, state] of cases) {
    // The pet window's own size before the bubble (the page does not resize like the native window).
    const page = await newPage({ width: 252, height: 404 });
    await mockBridge(page, state); await page.goto(`${origin}/?pet=0`);
    const mark = page.locator('.floating-pet .pet-codex-mark.ask');
    const bubble = page.locator('[data-agent-id="pet-codex-attention.bubble"]');
    const card = page.locator('.quick-card-stack');
    const away = () => page.mouse.move(2, 2);
    const settle = () => page.waitForTimeout(250);
    await mark.waitFor();
    assert.equal(await bubble.count(), 0, `${label}: an already-seen ask does not pop up by itself`);
    const box = await page.locator('.floating-pet .pet-hit').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8); await settle();
    assert.equal(await bubble.count(), 0, `${label}: only the mark opens the bubble`);

    // Hover shows it, leaving hides it.
    const before = await mark.boundingBox();
    await mark.hover();
    await bubble.locator('.pet-codex-headline', { hasText: 'Codex에서 확인이 필요해!' }).waitFor();
    await bubble.getByRole('button', { name: 'Codex에서 확인하기', exact: true }).waitFor();
    assert.deepEqual(await mark.boundingBox(), before, `${label}: the pet stays under the pointer while the bubble opens`);
    await page.waitForFunction(() => window.__uiTest.calls.some(call => call.name === 'set_pet_expanded' && call.args?.notice === true));
    await away();
    await bubble.waitFor({ state: 'detached' });

    // A click pins it: it stays after the pointer leaves and the card does not open.
    await mark.hover(); await bubble.waitFor();
    await mark.click(); await away(); await settle();
    assert.equal(await bubble.count(), 1, `${label}: a clicked bubble stays after the pointer leaves`);
    assert.equal(await card.count(), 0, `${label}: clicking the mark does not open the pet card`);
    // Its buttons are reachable while pinned.
    await bubble.getByRole('button', { name: 'Codex에서 확인하기', exact: true }).hover();
    assert.equal(await bubble.count(), 1);

    // Clicking the mark again closes it, even with the pointer still on the mark.
    await mark.click(); await bubble.waitFor({ state: 'detached' }); await settle();
    assert.equal(await bubble.count(), 0, `${label}: the second click closes the bubble`);
    await away(); await mark.hover(); await bubble.waitFor();
    await away(); await bubble.waitFor({ state: 'detached' });

    // A pinned bubble also closes with 닫기.
    await mark.click(); await away(); await settle();
    await bubble.getByRole('button', { name: '닫기', exact: true }).click();
    await bubble.waitFor({ state: 'detached' });

    // The pet body still opens the card.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
    await card.waitFor();
    assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => call.name === 'open_codex_attention')), false, `${label}: hovering or pinning never opens Codex`);
    checks.push(`pet attention hover/pin: ${label}`);
    await page.close();
  }
  return [];
};
