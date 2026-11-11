const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chooseRole, openPetSettings, openCopy, closePetPanel } = require('./entry-navigation.cjs');

exports.runPetQuickUseChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const page = await newPage({ width: 992, height: 688 }, true);
  const video = page.video();
  assert.ok(video, 'connection navigation produces a synthetic review recording');
  await mockBridge(page, { ...structuredClone(fixture), sessions: [], slots: [], petLinks: [], connectionPath: null,
    setup: { version: 1, connectionMode: 'explicit-pet', connections: [{ hostId: 'codex-windows-local', configured: false,
      settingsVerified: { model: false, reasoning: false, submission: false } }] } });
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
  const exportButton = composer.getByRole('button', { name: 'Claude에 설치', exact: true });
  const exportStatus = composer.locator('.composer-claude-connector').getByRole('status');
  await exportButton.click();
  await composer.getByRole('alert').filter({ hasText: 'Claude 설치 창을 열지 못했어요' }).waitFor();
  assert.equal(await exportStatus.count(), 0);
  await page.evaluate(() => { window.__uiTest.preferenceExportError = false; window.__uiTest.holdPreferenceExport = true; });
  await exportButton.evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => typeof window.__uiTest.releasePreferenceExport === 'function');
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'install_pet_preferences_in_claude').length), 2);
  await page.evaluate(() => { window.__uiTest.releasePreferenceExport(); window.__uiTest.holdPreferenceExport = false; });
  await exportStatus.filter({ hasText: 'Claude 설치 창에서 설치를 눌러 주세요' }).waitFor();
  const useButton = composer.getByRole('button', { name: 'Claude에서 쓰기', exact: true });
  await page.evaluate(() => { window.__uiTest.claudeOpenError = true; });
  await useButton.click();
  await composer.getByRole('alert').filter({ hasText: 'Claude 앱을 열지 못했어요' }).waitFor();
  await page.evaluate(() => { window.__uiTest.claudeOpenError = false; });
  await useButton.click();
  await exportStatus.filter({ hasText: '보내기만 누르세요' }).waitFor();
  const opened = await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_in_claude').map(call => call.args));
  assert.equal(opened.length, 2);
  assert.deepEqual(Object.keys(opened[1]).sort(), ['expectedRevision', 'petId'], 'the UI sends only the pet identity, never a URL or prompt');
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => /connect_ai|apply_pet|submit|execute|open_pet_task/.test(call.name))), false);
  checks.push('quick-use: disconnected create, failed save and repeated click, one stored pet with unchanged chats/clipboard and no AI; flat settings/request modal, Escape focus return, keyboard containment, preserved draft and small layouts; compact Claude install/use buttons report failures, ignore duplicates and send only the saved pet identity');

  await page.setViewportSize({ width: 992, height: 688 });
  await openPetSettings(composer);
  await composer.getByRole('radio', { name: '꼼꼼하게', exact: true }).check();
  await closePetPanel(composer);
  const beforeConnection = await page.evaluate(() => ({ pets: structuredClone(window.__uiTest.roles.pets), clipboard: window.__uiTest.clipboard,
    mutations: window.__uiTest.calls.filter(call => /save_pet|connect_ai|disconnect_ai|apply_pet|install|submit|execute|open_pet_task/.test(call.name)) }));
  await composer.locator('.composer-tools').getByRole('button', { name: 'AI 연결', exact: true }).click();
  const guide = page.locator('.connection-guide');
  await guide.waitFor();
  assert.equal(await composer.isVisible(), false);
  await guide.locator('.setup-heading > button').click();
  await guide.waitFor({ state: 'hidden' });
  const returned = path.join(screenshotDir, 'pet-connection-return.png');
  await page.screenshot({ path: returned, fullPage: true, animations: 'disabled' }); images.push(returned);
  assert.equal(await composer.isVisible(), true, 'returning from connection settings resumes the chosen pet without searching again');
  await page.waitForFunction(() => document.activeElement === document.querySelector('.composer-identity h1'));
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await composer.getByText('내 펫', { exact: true }).isVisible(), true, 'editing an existing pet does not label it as a new pet');
  assert.equal(await composer.getByRole('button', { name: '변경 저장', exact: true }).isVisible(), true);
  await openCopy(composer);
  assert.equal(await composer.getByLabel('펫에게 맡길 일', { exact: true }).inputValue(), '저장만 하고 아직 전송하지 않는 가상 요청');
  await openPetSettings(composer);
  assert.equal(await composer.getByRole('radio', { name: '꼼꼼하게', exact: true }).isChecked(), true);
  await closePetPanel(composer);
  await page.locator('.app-settings > summary').click();
  await page.getByRole('button', { name: '연결 설정', exact: true }).click();
  await guide.getByRole('button', { name: '돌아가기', exact: true }).click();
  assert.equal(await composer.isVisible(), true, 'using the app menu for the same connection detour also resumes the chosen pet');
  const afterConnection = await page.evaluate(() => ({ pets: structuredClone(window.__uiTest.roles.pets), clipboard: window.__uiTest.clipboard,
    mutations: window.__uiTest.calls.filter(call => /save_pet|connect_ai|disconnect_ai|apply_pet|install|submit|execute|open_pet_task/.test(call.name)) }));
  assert.deepEqual(afterConnection, beforeConnection, 'navigation neither saves a dirty pet nor changes host settings, clipboard or AI work');

  await page.setViewportSize({ width: 375, height: 812 });
  await composer.locator('.composer-tools').getByRole('button', { name: 'AI 연결', exact: true }).click();
  await guide.getByRole('button', { name: '펫으로 돌아가기', exact: true }).click();
  assert.equal(await composer.isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const narrowReturn = path.join(screenshotDir, 'pet-connection-return-narrow.png');
  await page.screenshot({ path: narrowReturn, fullPage: true, animations: 'disabled' }); images.push(narrowReturn);
  const originalPet = beforeConnection.pets[0];
  await composer.getByRole('button', { name: '변경 저장', exact: true }).click();
  await composer.getByRole('button', { name: 'Codex에 펫 준비', exact: true }).waitFor();
  const changedPets = await page.evaluate(() => window.__uiTest.roles.pets);
  assert.equal(changedPets.length, 1, 'saving changes updates the selected pet rather than creating a duplicate');
  assert.equal(changedPets[0].id, originalPet.id);
  assert.equal(changedPets[0].revision, originalPet.revision + 1);
  assert.equal(changedPets[0].template.execution.reasoning, 'medium');
  await page.setViewportSize({ width: 992, height: 688 });

  await composer.locator('.composer-tools').getByRole('button', { name: 'AI 연결', exact: true }).click();
  await guide.waitFor();
  assert.equal(await guide.getByRole('button', { name: '펫으로 돌아가기', exact: true }).isVisible(), true);
  await page.locator('.app-header nav').getByRole('button', { name: '내 작업', exact: true }).click();
  assert.equal(await composer.isVisible(), false, 'explicit navigation leaves the composer instead of restoring an old destination');
  await page.locator('.app-settings > summary').click();
  await page.getByRole('button', { name: '연결 설정', exact: true }).click();
  await guide.getByRole('button', { name: '돌아가기', exact: true }).click();
  assert.equal(await composer.isVisible(), false, 'opening general connection settings does not recover a previous pet');
  await page.locator('.app-header nav').getByRole('button', { name: '펫 고르기', exact: true }).click();
  await page.locator('.app-settings > summary').click();
  await page.getByRole('button', { name: '연결 설정', exact: true }).click();
  await guide.getByRole('button', { name: '돌아가기', exact: true }).click();
  assert.equal(await composer.isVisible(), false, 'returning to the catalog without an open composer does not pick a pet');
  assert.equal(await page.locator('.app-header nav').getByRole('button', { name: '펫 고르기', exact: true }).getAttribute('aria-current'), 'page');
  checks.push('connection round trip resumes the same dirty pet, request, work profile and heading focus without extra save, clipboard, host configuration or AI; explicit menu navigation clears the return destination');
  await page.close();
  const reviewVideo = path.join(screenshotDir, 'artifacts', 'pet-connection-return.webm');
  await video.saveAs(reviewVideo);
  const originalVideo = await video.path();
  if (path.resolve(originalVideo) !== path.resolve(reviewVideo) && path.dirname(path.resolve(originalVideo)) === path.dirname(path.resolve(reviewVideo))) await fs.unlink(originalVideo);
  checks.push('connection navigation video is synthetic UI evidence and is retained in the existing Windows review artifact, not in Git');

  const linked = await newPage({ width: 992, height: 688 });
  const template = require('../../../packages/contracts/data/ui-pet.json');
  const makeLink = (threadId, slot) => ({ version: 1, target: { sourceId: 'codex-windows-local', threadId, cwd: `C:/UI fixture only/${slot ? 'B' : 'A'}` },
    slot, revision: 4, enabled: true, connected: true, profile: 'light', template: structuredClone(template), run: null });
  const a = makeLink('11111111-2222-4333-8444-555555555555', 0);
  const b = makeLink('11111111-2222-4333-8444-666666666666', 1);
  const targetKey = link => JSON.stringify([link.target.sourceId, link.target.threadId, link.target.cwd]);
  await mockBridge(linked, { ...structuredClone(fixture), sessions: [], slots: [], petLinks: [a, b],
    setup: { version: 1, connectionMode: 'explicit-pet', connections: [{ hostId: 'codex-windows-local', configured: true,
      settingsVerified: { model: false, reasoning: false, submission: false } }] } });
  await linked.goto(origin);
  await chooseRole(linked, '웹페이지 만들기');
  const linkedComposer = linked.locator('.pet-composer');
  const target = linkedComposer.getByLabel('UI 펫을 적용할 채팅', { exact: true });
  await target.selectOption(targetKey(b));
  await linkedComposer.locator('.composer-tools').getByRole('button', { name: 'AI 연결', exact: true }).click();
  await linked.locator('.connection-guide').waitFor();
  await linked.evaluate(() => {
    window.__uiTest.state.petLinks[1].connected = false;
    window.__uiTest.state.petLinks[1].revision++;
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  await linked.getByRole('button', { name: '펫으로 돌아가기', exact: true }).click();
  await linkedComposer.locator('.composer-target-blocker').waitFor();
  assert.equal(await target.inputValue(), targetKey(b), 'a disconnected selected B is preserved instead of silently switching to available A');
  assert.equal(await linkedComposer.getByRole('button', { name: '이 채팅에 펫 적용', exact: true }).isDisabled(), true);
  assert.deepEqual(await linked.evaluate(() => window.__uiTest.calls), [], 'navigation and a changed target never save, apply, configure or dispatch');
  checks.push('connection return keeps the selected B when it disconnects and changes revision; available A is never selected or mutated automatically');
  await linked.close();
  return images;
};
