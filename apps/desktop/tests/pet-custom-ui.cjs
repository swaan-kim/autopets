const { openSaved } = require('./entry-navigation.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');

// 내 펫 › 진화 / 꾸미기 on fixture data. Fixture only: nothing is bought or worn in a real app.
exports.runPetCustomChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const screenshots = [];
  const shot = async (page, name) => { const file = path.join(screenshotDir, name); await page.screenshot({ path: file }); screenshots.push(file); };
  const page = await newPage({ width: 1120, height: 880 });
  await mockBridge(page, { ...structuredClone(fixture), sessions: [], slots: [], petLinks: [], setup: { version: 1, connectionMode: 'explicit-pet', connections: [{ hostId: 'codex-windows-local', configured: true }] } });
  await page.addInitScript(() => {
    // Survives a reload within this page, like the app's saved state survives a restart.
    const saved = sessionStorage.getItem('pet-custom-fixture');
    window.__uiTest.petCustom = saved ? JSON.parse(saved) : { coins: 80, owned: ['ribbon'], worn: { head: 'ribbon' }, completed: 12, byPet: {} };
    window.addEventListener('beforeunload', () => sessionStorage.setItem('pet-custom-fixture', JSON.stringify(window.__uiTest.petCustom)));
  });
  await page.goto(origin);
  await openSaved(page);

  // 내 펫 shows only the 펫 커스텀 button; ① opens from it.
  const opener = page.locator('[data-agent-id="pet-selection.custom.open"]');
  await opener.getByText('펫 커스텀 →', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-agent-id="pet-selection.custom"]').count(), 0, 'the cards are not on 내 펫 itself');
  await page.getByRole('heading', { name: '즐겨찾기', exact: true }).waitFor();
  await shot(page, 'pet-custom-0-button.png');
  const openCustom = async () => { await page.locator('[data-agent-id="pet-selection.custom.open"]').click(); };
  await openCustom();
  // ① 펫 커스텀
  const entry = page.locator('[data-agent-id="pet-selection.custom"]');
  await entry.waitFor();
  await entry.getByText('작업 12번을 함께했어요', { exact: true }).waitFor();
  assert.equal(await entry.locator('.pet-custom-identity .pet-coin-count').innerText(), '80');
  const evolutionCard = page.locator('[data-agent-id="pet-selection.custom.evolution"]');
  await evolutionCard.getByText('다음 모습까지 12 / 30', { exact: true }).waitFor();
  await evolutionCard.getByText('도감 1 / 8', { exact: true }).waitFor();
  const decorateCard = page.locator('[data-agent-id="pet-selection.custom.decorate"]');
  await decorateCard.getByText('내 아이템 1개', { exact: true }).waitFor();
  assert.equal(await entry.locator('.pet-custom-identity [data-item="ribbon"]').count(), 1, 'the pet on 내 펫 wears its ribbon');
  await shot(page, 'pet-custom-1-entry.png');
  checks.push('내 펫 has one 펫 커스텀 button; it opens coins, the evolution card and the decorate card');

  // ② Evolution
  await evolutionCard.click();
  const evolution = page.locator('.pet-custom-page[data-screen="evolution"]');
  await evolution.getByRole('heading', { name: '도감 1 / 8 발견', exact: true }).waitFor();
  await evolution.getByText('No.01 · 처음 모습', { exact: true }).waitFor();
  const stage = no => evolution.locator(`[data-agent-id="pet-selection.custom.stage.${no}"]`);
  assert.equal(await stage(1).getByText('처음 모습', { exact: true }).isVisible(), true);
  assert.equal(await stage(2).getByText('???', { exact: true }).isVisible(), true);
  assert.equal(await stage(2).getByText('작업 30번', { exact: true }).isVisible(), true);
  assert.equal(await stage(5).getByText('공부를 많이', { exact: true }).isVisible(), true);
  const silhouette = await stage(2).locator('.pet-dressed.is-silhouette .pet-dressed-body').evaluate(element => getComputedStyle(element).opacity);
  assert.equal(Number(silhouette).toFixed(2), '0.14');
  await shot(page, 'pet-custom-2-evolution.png');
  await evolution.getByRole('button', { name: '← 펫 커스텀', exact: true }).click();
  await entry.waitFor();
  checks.push('evolution shows the 8-stage collection with silhouettes for unfound stages');

  // ③ Decorate · my items
  await decorateCard.click();
  const decorate = page.locator('.pet-custom-page[data-screen="decorate"]');
  await decorate.getByText('누르면 바로 입어요', { exact: true }).waitFor();
  const item = id => decorate.locator(`[data-agent-id="pet-selection.custom.item.${id}"]`);
  assert.equal(await item('ribbon').getAttribute('aria-pressed'), 'true');
  await item('ribbon').getByText('착용 중', { exact: true }).waitFor();
  await item('ribbon').click();
  await page.waitForFunction(() => !window.__uiTest.petCustom.worn.head);
  assert.equal(await item('ribbon').getAttribute('aria-pressed'), 'false', 'pressing a worn item takes it off');
  await item('ribbon').click();
  await page.waitForFunction(() => window.__uiTest.petCustom.worn.head === 'ribbon');
  await shot(page, 'pet-custom-3-items.png');
  checks.push('my items wear and take off on press');

  // ④ Buy: try on, revert, not enough coins, buy, double press
  await decorate.locator('[data-agent-id="pet-selection.custom.to-shop"]').click();
  await item('sprout').click();
  await decorate.getByText('입어보는 중', { exact: true }).waitFor();
  assert.equal(await decorate.locator('.pet-custom-showcase [data-item="sprout"]').count(), 1, 'the pet tries the item on');
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'pet_custom_buy').length), 0, 'trying on does not buy');
  await decorate.getByRole('button', { name: '되돌리기', exact: true }).click();
  assert.equal(await decorate.locator('.pet-custom-showcase [data-item="sprout"]').count(), 0);
  assert.equal(await decorate.locator('.pet-custom-showcase [data-item="ribbon"]').count(), 1, 'revert brings back the worn ribbon');
  await item('crown').click();
  assert.equal(await item('crown').locator('.pet-custom-price').evaluate(element => element.classList.contains('is-short')), true);
  assert.equal(await decorate.locator('[data-agent-id="pet-selection.custom.buy"]').isDisabled(), true, 'not enough coins disables buying');
  await decorate.getByText('도전으로만 받아요', { exact: true }).waitFor();
  assert.equal(await decorate.locator('[data-agent-id="pet-selection.custom.challenges"] li').count(), 5);
  await decorate.getByText('작업을 끝낼 때마다 모여요', { exact: false }).waitFor();
  await item('glasses').click();
  await shot(page, 'pet-custom-4-shop.png');
  await page.evaluate(() => { window.__uiTest.holdPetCustom = true; });
  const buy = decorate.locator('[data-agent-id="pet-selection.custom.buy"]');
  await buy.click();
  await buy.click({ force: true }).catch(() => {});
  await page.evaluate(() => { window.__uiTest.holdPetCustom = false; window.__uiTest.releasePetCustom(); });
  await page.waitForFunction(() => window.__uiTest.petCustom.owned.includes('glasses'));
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'pet_custom_buy').length), 1, 'a double press sends one purchase');
  assert.equal(await page.evaluate(() => window.__uiTest.petCustom.coins), 50);
  await decorate.locator('.pet-custom-toolbar .pet-coin-count', { hasText: '50' }).waitFor();
  assert.equal(await item('glasses').count(), 0, 'an owned item leaves the shop');
  checks.push('buying tries on first, refuses without coins, charges once and removes the item from the shop');

  // Same slot replaces; wearing survives a reload.
  await decorate.locator('[data-agent-id="pet-selection.custom.tab.mine"]').click();
  await item('glasses').getByText('착용 중', { exact: true }).waitFor();
  await decorate.locator('[data-agent-id="pet-selection.custom.tab.buy"]').click();
  await item('sprout').click();
  await decorate.locator('[data-agent-id="pet-selection.custom.buy"]').click();
  await page.waitForFunction(() => window.__uiTest.petCustom.worn.head === 'sprout');
  await decorate.locator('[data-agent-id="pet-selection.custom.tab.mine"]').click();
  assert.equal(await item('ribbon').getAttribute('aria-pressed'), 'false', 'one head item at a time');
  await decorate.locator('[data-agent-id="pet-selection.custom.slot.face"]').click();
  assert.equal(await decorate.locator('.pet-custom-items .pet-custom-item:not(.is-shop)').count(), 1, 'slot chips filter items');
  await decorate.getByRole('button', { name: '← 펫 커스텀', exact: true }).click();
  await page.locator('.pet-custom-page[data-screen="hub"]').getByRole('button', { name: '← 내 펫', exact: true }).click();
  await opener.waitFor();
  await page.reload();
  await openSaved(page);
  await openCustom();
  await page.locator('[data-agent-id="pet-selection.custom.decorate"]').click();
  assert.equal(await item('sprout').getAttribute('aria-pressed'), 'true');
  assert.equal(await item('glasses').getAttribute('aria-pressed'), 'true');
  checks.push('same-slot items replace each other and stay worn after a reload');
  await page.close();
  return screenshots;
};
