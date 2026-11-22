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
  const composer = page.locator('.pet-start');
  const change = composer.getByRole('button', { name: '바꾸기', exact: true });
  assert.equal(await composer.locator('.pet-start-change').count(), 0, 'less common actions stay folded');
  assert.equal(await composer.locator('details[open]').count(), 0);
  // "시작 없이 저장" under "바꾸기" → "자세한 정보" creates a pet without a connected host or chat.
  await openPetSettings(composer);
  const create = composer.getByRole('button', { name: '시작 없이 저장', exact: true });
  assert.equal(await create.isEnabled(), true, 'creating a pet does not require a connected host or chat');
  const before = await page.evaluate(() => ({ links: structuredClone(window.__uiTest.state.petLinks), clipboard: window.__uiTest.clipboard }));
  await page.evaluate(() => { window.__uiTest.savePetError = 'fixture save denied'; });
  await create.click();
  await composer.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(() => window.__uiTest.roles.pets.length), 0);
  assert.equal(await composer.getByRole('button', { name: '저장됨', exact: true }).count(), 0, 'failed save never offers a saved pet');
  await page.evaluate(() => { window.__uiTest.savePetError = null; window.__uiTest.holdSavePet = true; });
  await create.evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => typeof window.__uiTest.releaseSavePet === 'function');
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'save_pet').length), 2, 'one failed attempt and one pending save');
  await page.evaluate(() => { window.__uiTest.holdSavePet = false; window.__uiTest.releaseSavePet(); });
  await composer.getByRole('button', { name: '저장됨', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__uiTest.roles.pets.length), 1);
  assert.equal(await composer.locator('.composer-eyebrow').innerText(), '저장한 펫', 'only a saved pet is labelled above its name');
  const after = await page.evaluate(() => ({ links: structuredClone(window.__uiTest.state.petLinks), clipboard: window.__uiTest.clipboard,
    calls: window.__uiTest.calls.map(call => call.name) }));
  assert.deepEqual(after.links, before.links);
  assert.equal(after.clipboard, before.clipboard);
  assert.deepEqual(after.calls, ['save_pet', 'save_pet'], 'saving alone never configures a host, exports a file, or submits AI work');
  await closePetPanel(composer);

  // "바꾸기" folds open in place (no modal); the keyboard toggles it and focus stays on the toggle.
  await composer.getByLabel('펫에게 맡길 일', { exact: true }).fill('저장만 하고 아직 전송하지 않는 가상 요청');
  await change.focus(); await page.keyboard.press('Enter');
  assert.equal(await change.getAttribute('aria-expanded'), 'true');
  await composer.locator('.pet-start-change').waitFor();
  await page.keyboard.press('Enter');
  assert.equal(await composer.locator('.pet-start-change').count(), 0);
  assert.equal(await change.evaluate(element => document.activeElement === element), true, 'folding keeps focus on the toggle');

  const images = [];
  for (const [width, height] of [[992, 688], [661, 459], [375, 812]]) {
    await page.setViewportSize({ width, height });
    await openCopy(composer);
    assert.equal(await composer.getByLabel('펫에게 맡길 일', { exact: true }).inputValue(), '저장만 하고 아직 전송하지 않는 가상 요청');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await composer.locator('.pet-start-change').evaluate(element => { const r = element.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth; }));
    await closePetPanel(composer);
    if (width === 375) { const file = path.join(screenshotDir, 'pet-quick-use-narrow.png'); await page.screenshot({ path: file, fullPage: true, animations: 'disabled' }); images.push(file); }
  }
  // Choosing Claude as the place to start shows its own install/use actions under "바꾸기".
  await openPetSettings(composer);
  await composer.getByRole('radio', { name: 'Claude', exact: true }).check();
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
  await exportStatus.filter({ hasText: '요청을 확인해 보내 주세요' }).waitFor();
  const opened = await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_in_claude').map(call => call.args));
  assert.equal(opened.length, 2);
  assert.deepEqual(Object.keys(opened[1]).sort(), ['expectedRevision', 'petId'], 'the UI sends only the pet identity, never a URL or prompt');
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => /connect_ai|apply_pet|submit|execute|open_pet_task/.test(call.name))), false);
  // The start button for Claude: until its install window was opened from start once, it installs first, then opens a new chat.
  const startClaude = composer.getByRole('button', { name: 'Claude에서 시작', exact: true });
  await startClaude.click();
  await composer.getByText('펫 저장 ✓ · Claude 설치 창 열림 ✓', { exact: true }).waitFor();
  await composer.getByText(/설치한 뒤 다시 시작을 누르면 새 채팅이 열려요/).waitFor();
  await startClaude.click();
  await composer.getByText('펫 저장 ✓ · Claude 새 채팅 열림 ✓', { exact: true }).waitFor();
  const startedInClaude = await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_in_claude').map(call => call.args));
  assert.equal(startedInClaude.length, 3);
  assert.deepEqual(Object.keys(startedInClaude[2]).sort(), ['expectedRevision', 'petId'], 'starting in Claude sends only the pet identity');
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => /connect_ai|apply_pet|submit|execute|open_pet_task/.test(call.name))), false);
  await openPetSettings(composer);
  await composer.getByRole('radio', { name: 'Codex', exact: true }).check();
  // Codex start asks once before connecting; when the connection is not ready it stops and offers the connection settings.
  await closePetPanel(composer);
  await page.evaluate(() => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (name, args) => {
      if (name !== 'connect_ai') return invoke(name, args);
      window.__uiTest.calls.push({ name, args });
      return { version: 1, connectionMode: 'explicit-pet', connections: [{ hostId: 'codex-windows-local', configured: false }] };
    };
  });
  await composer.getByRole('button', { name: 'Codex에서 시작', exact: true }).click();
  const confirm = composer.getByRole('alert').filter({ hasText: 'Codex에 AutoPets를 연결해요' });
  await confirm.waitFor();
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => call.name === 'connect_ai')), false, 'nothing connects before the user agrees');
  await confirm.getByRole('button', { name: '연결하고 시작', exact: true }).click();
  await composer.getByRole('alert').filter({ hasText: 'Codex 연결이 아직 준비되지 않았어요.' }).waitFor();
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'connect_ai').length), 1);
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => call.name === 'open_pet_in_codex')), false, 'an unready connection never opens Codex');
  await composer.getByRole('button', { name: 'Codex에서 시작', exact: true }).click();
  await page.waitForFunction(() => window.__uiTest.calls.filter(call => call.name === 'connect_ai').length === 2);
  await composer.getByRole('button', { name: 'AI 연결 열기 →', exact: true }).waitFor();
  assert.equal(await composer.getByRole('alert').filter({ hasText: 'Codex에 AutoPets를 연결해요' }).count(), 0, 'the connection is confirmed only once');
  checks.push('quick-use: disconnected create, failed save and repeated click, one stored pet with unchanged chats/clipboard and no AI; flat settings/request modal, Escape focus return, keyboard containment, preserved draft and small layouts; compact Claude install/use buttons report failures, ignore duplicates and send only the saved pet identity');

  await page.setViewportSize({ width: 992, height: 688 });
  await openPetSettings(composer);
  await composer.getByRole('radio', { name: '꼼꼼하게', exact: true }).check();
  await closePetPanel(composer);
  const beforeConnection = await page.evaluate(() => ({ pets: structuredClone(window.__uiTest.roles.pets), clipboard: window.__uiTest.clipboard,
    mutations: window.__uiTest.calls.filter(call => /save_pet|connect_ai|disconnect_ai|apply_pet|install|submit|execute|open_pet_task/.test(call.name)) }));
  await composer.getByRole('button', { name: 'AI 연결 열기 →', exact: true }).click();
  const guide = page.locator('.connection-guide');
  await guide.waitFor();
  assert.equal(await composer.isVisible(), false);
  await guide.locator('.setup-heading > button').click();
  await guide.waitFor({ state: 'hidden' });
  const returned = path.join(screenshotDir, 'pet-connection-return.png');
  await page.screenshot({ path: returned, fullPage: true, animations: 'disabled' }); images.push(returned);
  assert.equal(await composer.isVisible(), true, 'returning from connection settings resumes the chosen pet without searching again');
  await page.waitForFunction(() => document.activeElement === document.querySelector('.composer-identity h1'));
  assert.equal(await composer.locator('.composer-eyebrow').innerText(), '저장한 펫', 'editing an existing pet does not label it as a new pet');
  await openCopy(composer);
  assert.equal(await composer.getByRole('button', { name: '변경 저장', exact: true }).isVisible(), true);
  assert.equal(await composer.getByLabel('펫에게 맡길 일', { exact: true }).inputValue(), '저장만 하고 아직 전송하지 않는 가상 요청');
  await openPetSettings(composer);
  assert.equal(await composer.getByRole('radio', { name: '꼼꼼하게', exact: true }).isChecked(), true);
  await closePetPanel(composer);
  await require('./entry-navigation.cjs').openSettingsPage(page, 'AI 연결');
  await guide.getByRole('button', { name: '돌아가기', exact: true }).click();
  assert.equal(await composer.isVisible(), true, 'using the app menu for the same connection detour also resumes the chosen pet');
  const afterConnection = await page.evaluate(() => ({ pets: structuredClone(window.__uiTest.roles.pets), clipboard: window.__uiTest.clipboard,
    mutations: window.__uiTest.calls.filter(call => /save_pet|connect_ai|disconnect_ai|apply_pet|install|submit|execute|open_pet_task/.test(call.name)) }));
  assert.deepEqual(afterConnection, beforeConnection, 'navigation neither saves a dirty pet nor changes host settings, clipboard or AI work');

  await page.setViewportSize({ width: 375, height: 812 });
  await composer.getByRole('button', { name: 'AI 연결 열기 →', exact: true }).click();
  await guide.getByRole('button', { name: '펫으로 돌아가기', exact: true }).click();
  assert.equal(await composer.isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const narrowReturn = path.join(screenshotDir, 'pet-connection-return-narrow.png');
  await page.screenshot({ path: narrowReturn, fullPage: true, animations: 'disabled' }); images.push(narrowReturn);
  const originalPet = beforeConnection.pets[0];
  await openCopy(composer);
  await composer.getByRole('button', { name: '변경 저장', exact: true }).click();
  await composer.getByRole('button', { name: '저장됨', exact: true }).waitFor();
  const changedPets = await page.evaluate(() => window.__uiTest.roles.pets);
  assert.equal(changedPets.length, 1, 'saving changes updates the selected pet rather than creating a duplicate');
  assert.equal(changedPets[0].id, originalPet.id);
  assert.equal(changedPets[0].revision, originalPet.revision + 1);
  assert.equal(changedPets[0].template.execution.reasoning, 'medium');
  await page.setViewportSize({ width: 992, height: 688 });

  await composer.getByRole('button', { name: 'AI 연결 열기 →', exact: true }).click();
  await guide.waitFor();
  assert.equal(await guide.getByRole('button', { name: '펫으로 돌아가기', exact: true }).isVisible(), true);
  await page.locator('.app-header nav').getByRole('button', { name: '내 작업', exact: true }).click();
  assert.equal(await composer.isVisible(), false, 'explicit navigation leaves the composer instead of restoring an old destination');
  await require('./entry-navigation.cjs').openSettingsPage(page, 'AI 연결');
  await guide.getByRole('button', { name: '돌아가기', exact: true }).click();
  assert.equal(await composer.isVisible(), false, 'opening general connection settings does not recover a previous pet');
  await page.locator('.app-header nav').getByRole('button', { name: '펫 고르기', exact: true }).click();
  await require('./entry-navigation.cjs').openSettingsPage(page, 'AI 연결');
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
  const linkedComposer = linked.locator('.pet-start');
  const target = linkedComposer.getByLabel('펫을 쓸 채팅', { exact: true });
  await openPetSettings(linkedComposer);
  await target.selectOption(targetKey(b));
  await require('./entry-navigation.cjs').openSettingsPage(linked, 'AI 연결');
  await linked.locator('.connection-guide').waitFor();
  await linked.evaluate(() => {
    window.__uiTest.state.petLinks[1].connected = false;
    window.__uiTest.state.petLinks[1].revision++;
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  await linked.locator('.connection-guide').getByRole('button', { name: '돌아가기', exact: true }).click();
  await openPetSettings(linkedComposer);
  await linkedComposer.locator('.composer-target-blocker').waitFor();
  assert.equal(await target.inputValue(), targetKey(b), 'a disconnected selected B is preserved instead of silently switching to available A');
  assert.equal(await linkedComposer.getByRole('button', { name: '이 채팅에 펫 적용', exact: true }).isDisabled(), true);
  assert.deepEqual(await linked.evaluate(() => window.__uiTest.calls), [], 'navigation and a changed target never save, apply, configure or dispatch');
  checks.push('connection return keeps the selected B when it disconnects and changes revision; available A is never selected or mutated automatically');
  await linked.close();
  return images;
};
