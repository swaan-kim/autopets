const assert = require('node:assert/strict');
const path = require('node:path');
const { chooseRole, openPetSettings, openCopy, closePetPanel } = require('./entry-navigation.cjs');

exports.runPetQuickUseChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const page = await newPage({ width: 992, height: 688 });
  await mockBridge(page, { ...structuredClone(fixture), sessions: [], slots: [], petLinks: [], connectionPath: null,
    setup: { version: 1, connectionMode: 'explicit-pet', connections: [{ hostId: 'codex-windows-local', configured: false }] } });
  await page.goto(origin);
  await chooseRole(page, '웹페이지 만들기');
  const composer = page.locator('.pet-composer');
  const dialog = composer.locator('.composer-panel');
  const create = composer.getByRole('button', { name: '펫 만들기', exact: true });
  assert.equal(await create.isEnabled(), true, 'creating a pet does not require a connected host or chat');
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await composer.locator('.composer-copy-fallback').isVisible(), false);
  assert.equal(await composer.locator('details').filter({ visible: true }).count(), 0);
  const before = await page.evaluate(() => ({ links: structuredClone(window.__uiTest.state.petLinks), clipboard: window.__uiTest.clipboard }));
  await page.evaluate(() => { window.__uiTest.savePetError = 'fixture save denied'; });
  await create.click();
  await composer.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(() => window.__uiTest.roles.pets.length), 0);
  assert.equal(await composer.locator('.composer-hosts').count(), 0, 'failed save never offers a saved pet');
  await page.evaluate(() => { window.__uiTest.savePetError = null; window.__uiTest.holdSavePet = true; });
  await create.evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => typeof window.__uiTest.releaseSavePet === 'function');
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'save_pet').length), 2, 'one failed attempt and one pending save');
  await page.evaluate(() => { window.__uiTest.holdSavePet = false; window.__uiTest.releaseSavePet(); });
  await composer.getByRole('button', { name: 'Codex에 펫 준비', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__uiTest.roles.pets.length), 1);
  assert.equal(await composer.getByText('내 펫', { exact: true }).isVisible(), true);
  const after = await page.evaluate(() => ({ links: structuredClone(window.__uiTest.state.petLinks), clipboard: window.__uiTest.clipboard,
    calls: window.__uiTest.calls.map(call => call.name) }));
  assert.deepEqual(after.links, before.links);
  assert.equal(after.clipboard, before.clipboard);
  assert.deepEqual(after.calls, ['save_pet', 'save_pet'], 'saving alone never configures a host, exports a file, or submits AI work');

  const gear = composer.getByRole('button', { name: '펫 설정', exact: true });
  await gear.focus(); await page.keyboard.press('Enter');
  assert.equal(await dialog.evaluate(element => element.open && element.contains(document.activeElement)), true);
  await openCopy(composer);
  assert.equal(await composer.locator('.composer-copy-fallback').isVisible(), true);
  assert.equal(await composer.locator('.composer-settings').isVisible(), false);
  await composer.getByLabel('펫에게 맡길 일', { exact: true }).fill('저장만 하고 아직 전송하지 않는 가상 요청');
  await openPetSettings(composer);
  assert.equal(await composer.locator('.composer-settings').isVisible(), true);
  assert.equal(await composer.locator('.composer-copy-fallback').isVisible(), false);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await gear.evaluate(element => document.activeElement === element), true, 'Escape restores the settings trigger');

  const images = [];
  for (const [width, height] of [[992, 688], [661, 459], [375, 812]]) {
    await page.setViewportSize({ width, height });
    await openCopy(composer);
    assert.equal(await composer.getByLabel('펫에게 맡길 일', { exact: true }).inputValue(), '저장만 하고 아직 전송하지 않는 가상 요청');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await dialog.evaluate(element => { const r = element.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight; }));
    const close = composer.getByRole('button', { name: '펫 편집 닫기', exact: true });
    await close.focus(); await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'keyboard stays in the modal');
    await closePetPanel(composer);
    if (width === 375) { const file = path.join(screenshotDir, 'pet-quick-use-narrow.png'); await page.screenshot({ path: file, fullPage: true, animations: 'disabled' }); images.push(file); }
  }
  await page.evaluate(() => { window.__uiTest.preferenceExportError = true; });
  const exportButton = composer.getByRole('button', { name: 'Claude 연결 파일', exact: true });
  await exportButton.click();
  await composer.getByRole('alert').filter({ hasText: '연결 파일을 저장하지 못했어요' }).waitFor();
  assert.equal(await composer.getByText('파일 저장됨', { exact: true }).count(), 0);
  await page.evaluate(() => { window.__uiTest.preferenceExportError = false; window.__uiTest.holdPreferenceExport = true; });
  await exportButton.evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => typeof window.__uiTest.releasePreferenceExport === 'function');
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'export_pet_preferences').length), 2);
  await page.evaluate(() => window.__uiTest.releasePreferenceExport());
  await composer.getByText('파일 저장됨', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => /connect_ai|apply_pet|install|submit|execute|open_pet_task/.test(call.name))), false);
  checks.push('quick-use: disconnected create, failed save and repeated click, one stored pet with unchanged chats/clipboard and no AI; flat settings/request modal, Escape focus return, keyboard containment, preserved draft and small layouts; compact connector export failures/duplicates never claim installation');
  await page.close();
  return images;
};
