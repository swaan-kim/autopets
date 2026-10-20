const { openCatalog, chooseRole, openSaved, openTasks, dismissRoleDetail, openCopy } = require('./entry-navigation.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const template = require('../../../packages/contracts/data/ui-pet.json');
const hosts = require('../../../packages/contracts/data/connections.json');
const catalog = require('../../../packages/contracts/data/pet-catalog.json');
async function openMore(composer) {
  if (!await composer.locator('.composer-more').evaluate(element => element.open)) {
    await composer.locator('.composer-more > summary').click();
  }
}

exports.runFirstSuccessChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const base = {
    ...structuredClone(fixture), sessions: [], slots: [], petLinks: [],
    setup: { version: 1, hosts, connectionMode: 'explicit-pet', connections: [{ hostId: 'codex-windows-local', configured: true, settingsVerified: { model: false, reasoning: false, submission: false } }] },
  };
  const images = [];
  const page = await newPage({ width: 992, height: 688 });
  await mockBridge(page, base); await page.goto(origin);
  await chooseRole(page, '웹페이지 만들기');
  const flow = page.locator('.pet-composer');
  await openCopy(flow);
  const task = flow.getByLabel('펫에게 맡길 일', { exact: true });
  assert.equal(await flow.locator('.composer-brief').evaluate(element => element.open), false);
  assert.equal(await flow.getByLabel('페이지를 볼 사람', { exact: true }).isVisible(), false);
  await task.fill('가상 동아리의 소규모 작품 소개 페이지를 계획해줘.\n기존 파일은 바꾸지 마.');
  await flow.locator('.composer-brief > summary').click();
  await flow.getByLabel('페이지를 볼 사람', { exact: true }).fill('처음 방문하는 가상 신입생');
  await flow.getByLabel('꼭 알릴 내용', { exact: true }).fill('가상 작품 세 개와 다음 전시 일정');
  await flow.getByRole('button', { name: '시작 요청 복사', exact: true }).click();
  const copyNotice = '쓸 Codex 채팅에 붙여넣고 보내세요.';
  await flow.getByText(copyNotice, { exact: true }).waitFor();
  const copied = await page.evaluate(() => window.__uiTest.clipboard);
  assert.ok(copied.includes('이 페이지를 볼 사람: 처음 방문하는 가상 신입생'));
  assert.ok(copied.includes('꼭 알릴 내용: 가상 작품 세 개와 다음 전시 일정'));
  assert.ok(copied.includes('기존 파일은 바꾸지 마.'));
  assert.equal(await flow.locator('.composer-applied').count(), 0, 'copy is not confirmed application');
  assert.equal(await flow.locator('.composer-observed').count(), 0, 'copy is not a task receipt');
  assert.deepEqual(await page.evaluate(() => window.__uiTest.state.petLinks), []);

  // Navigate through app tabs and another role. Drafts and the handoff receipt belong to the role.
  await openSaved(page);
  await page.locator('nav').getByRole('button', { name: '펫 고르기', exact: true }).click();
  await page.getByRole('button', { name: '전체 펫', exact: true }).click();
  await page.getByRole('button', { name: '일상', exact: true }).click();
  await chooseRole(page, '하루 정리');
  await openCopy(flow);
  await task.fill('가상 하루 일정을 정리해줘.');
  assert.equal(await flow.getByText(copyNotice, { exact: true }).count(), 0);
  assert.equal(await flow.locator('.composer-brief').count(), 0);
  await flow.getByRole('button', { name: '← 돌아가기', exact: true }).click(); await dismissRoleDetail(page);
  await page.getByRole('button', { name: '업무', exact: true }).click();
  await chooseRole(page, '웹페이지 만들기');
  await openCopy(flow);
  assert.equal(await task.inputValue(), '가상 동아리의 소규모 작품 소개 페이지를 계획해줘.\n기존 파일은 바꾸지 마.');
  assert.equal(await flow.getByLabel('페이지를 볼 사람', { exact: true }).inputValue(), '처음 방문하는 가상 신입생');
  assert.equal(await flow.getByLabel('꼭 알릴 내용', { exact: true }).inputValue(), '가상 작품 세 개와 다음 전시 일정');
  await flow.getByText(copyNotice, { exact: true }).waitFor();
  await task.fill('수정된 새 요청');
  assert.equal(await flow.getByText(copyNotice, { exact: true }).count(), 0);
  assert.equal(await flow.getByLabel('Codex에 보낼 시작 요청', { exact: true }).count(), 0);
  await page.evaluate(daily => {
    window.__uiTest.roles.pets.push({ id: 'saved-daily', revision: 1, template: daily.template, updatedAt: 1 });
    window.__uiTest.emitEvent('autopets://roles-changed', {});
  }, catalog.find(entry => entry.id === 'daily-plan'));
  await openMore(flow);
  await flow.getByText('저장한 구성과 연결 관리', { exact: true }).click();
  await flow.getByLabel('저장한 구성', { exact: true }).selectOption('saved-daily');
  await flow.getByRole('heading', { name: '하루 정리', exact: true }).waitFor();
  assert.notEqual(await task.inputValue(), '수정된 새 요청', 'changing saved configuration across roles must not carry the webpage brief');
  await flow.getByRole('button', { name: '← 돌아가기', exact: true }).click(); await dismissRoleDetail(page);
  await page.getByRole('button', { name: '업무', exact: true }).click();
  await chooseRole(page, '웹페이지 만들기');
  await flow.getByRole('heading', { name: '웹페이지 만들기', exact: true }).waitFor();
  assert.equal(await task.inputValue(), '수정된 새 요청', 'the saved daily preset cannot replace the webpage role draft');
  assert.equal(await flow.getByLabel('페이지를 볼 사람', { exact: true }).inputValue(), '처음 방문하는 가상 신입생');
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'connect_ai').length), 0);
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'save_pet').length), 1);
  await page.setViewportSize({ width: 661, height: 459 });
  const sourceBounds = await flow.locator('.composer-identity').evaluate(element => ({
    preview: element.getBoundingClientRect().toJSON(),
    source: element.querySelector('.pet-source-line').getBoundingClientRect().toJSON(),
  }));
  assert.ok(sourceBounds.source.width > 100 && sourceBounds.source.left >= sourceBounds.preview.left && sourceBounds.source.right <= sourceBounds.preview.right, 'compact source name fits inside the preview alongside the pet');
  assert.equal(await flow.locator('.composer-identity .pet-source-line').innerText(), 'frontend-design');
  const compactImage = path.join(screenshotDir, 'first-success-compact.png');
  await page.screenshot({ path: compactImage, fullPage: true, animations: 'disabled' }); images.push(compactImage);
  checks.push('first-success brief: optional audience/message starts collapsed, included in copied prompt, per-role/tab navigation preserves draft and copy guidance, saved cross-role selection isolates original draft, editing invalidates copied request, prepared host is not reconfigured');
  await page.close();

  const saved = { id: 'first-success-saved', revision: 3, template: structuredClone(template), updatedAt: 1 };
  const live = structuredClone(base);
  live.slots = [0, 1, 2].map(index => ({ index, sessionId: null }));
  live.petLinks = ['11111111-2222-4333-8444-555555555555', '11111111-2222-4333-8444-666666666666'].map((threadId, slot) => ({
    version: 1, target: { sourceId: 'codex-windows-local', threadId, cwd: 'C:/UI fixture only/first-success' },
    slot, revision: 4, enabled: true, connected: true, profile: slot === 0 ? 'careful' : 'light',
    template: structuredClone(template), savedPet: { id: saved.id, revision: saved.revision },
    run: { id: `old-result-${slot}`, state: 'complete', profile: slot === 0 ? 'careful' : 'light', savedPet: { id: saved.id, revision: saved.revision },
      model: slot === 0 ? 'gpt-6-sol' : 'gpt-6-luna', effort: slot === 0 ? 'medium' : 'low',
      result: 'PREVIOUS_TASK_CONTENT_DO_NOT_COPY', planApproval: 'PREVIOUS_APPROVAL_DO_NOT_COPY' },
  }));
  const next = await newPage({ width: 992, height: 688 });
  await mockBridge(next, live);
  await next.addInitScript(saved => { window.__uiTest.roles.pets = [saved]; }, saved);
  await next.goto(origin); await openTasks(next);
  const prior = await next.evaluate(() => ({ links: structuredClone(window.__uiTest.state.petLinks), saved: structuredClone(window.__uiTest.roles.pets[0]) }));
  await next.locator('.pet-card-0').getByRole('button', { name: /같은 펫으로 새 일/ }).click();
  const composer = next.locator('.pet-composer');
  await openCopy(composer);
  await composer.getByText('설정만 가져왔어요. 새 할 일은 Codex에서 말해 주세요.', { exact: true }).waitFor();
  assert.equal(await composer.getByLabel('펫에게 맡길 일', { exact: true }).inputValue(), '');
  assert.equal(await composer.getByLabel('페이지를 볼 사람', { exact: true }).inputValue(), '');
  assert.equal(await composer.getByLabel('꼭 알릴 내용', { exact: true }).inputValue(), '');
  assert.equal(await composer.locator('input[aria-label="꼼꼼하게"]').isChecked(), true);
  assert.equal(await composer.getByRole('button', { name: '시작 요청 복사', exact: true }).isDisabled(), true);
  assert.equal(await next.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'save_pet').length), 0, 'opening a new task only creates a local draft');
  assert.deepEqual(await next.evaluate(() => window.__uiTest.state.petLinks), prior.links);
  assert.deepEqual(await next.evaluate(() => window.__uiTest.roles.pets[0]), prior.saved);
  await composer.getByLabel('펫에게 맡길 일', { exact: true }).fill('가상 사진 동아리의 다음 행사 페이지를 새 폴더에 계획해줘.');
  await composer.getByRole('button', { name: '시작 요청 복사', exact: true }).click();
  await composer.getByText(copyNotice, { exact: true }).waitFor();
  const actual = await next.evaluate(() => ({ calls: structuredClone(window.__uiTest.calls), pets: structuredClone(window.__uiTest.roles.pets), links: structuredClone(window.__uiTest.state.petLinks), prompt: window.__uiTest.clipboard }));
  const saves = actual.calls.filter(call => call.name === 'save_pet');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].args.id, null, 'current linked profile differs from the saved preset, so save a new configuration');
  assert.equal(saves[0].args.expectedRevision, 0);
  assert.deepEqual(saves[0].args.template, { ...structuredClone(template), execution: { model: 'gpt-6-sol', reasoning: 'medium' } });
  assert.deepEqual(actual.pets[0], prior.saved);
  assert.deepEqual(actual.links, prior.links, 'preparing/copying another task never changes A or B');
  assert.ok(actual.prompt.includes('이전 작업의 내용이나 계획 승인을 이 요청에 재사용하지 마.'));
  assert.equal(/PREVIOUS_TASK_CONTENT|PREVIOUS_APPROVAL/.test(actual.prompt), false);
  assert.equal(actual.calls.some(call => /connect_ai|apply_pet_link_template|submit|send|execute_pet|prepare_pet/.test(call.name)), false);
  assert.equal(await composer.locator('.composer-applied').count(), 0, 'copy is not a confirmed configuration change');
  assert.equal(await composer.locator('.composer-observed').count(), 0, 'a historical completion is not a receipt for the copied request');
  const image = path.join(screenshotDir, 'first-success-new-task.png');
  await next.screenshot({ path: image, fullPage: true, animations: 'disabled' }); images.push(image);
  checks.push('repeat success: completed A creates a blank request with current careful profile and unchanged skill pins, preserves old saved preset and both chats, creates one new config only on copy, never carries task content/approval or claims receipt from historical completion');
  await next.close();

  const presets = ['preset-a', 'preset-b'].map((id, index) => ({ id, revision: 1, updatedAt: 1,
    template: { ...structuredClone(template), name: `저장 구성 ${index ? 'B' : 'A'}`,
      execution: index ? { model: 'gpt-6-sol', reasoning: 'medium' } : { model: 'gpt-6-luna', reasoning: 'low' } } }));
  const library = await newPage({ width: 992, height: 688 });
  await mockBridge(library, base);
  await library.addInitScript(presets => { window.__uiTest.roles.pets = presets; }, presets);
  await library.goto(origin);
  await openSaved(library);
  const savedA = library.locator('.workspace-saved-card').filter({ hasText: '저장 구성 A' });
  await savedA.getByRole('button', { name: '이 펫 부르기 →', exact: true }).click();
  const editor = library.locator('.pet-composer');
  await openCopy(editor);
  await editor.getByLabel('펫에게 맡길 일', { exact: true }).fill('A에만 남길 초안');
  await openMore(editor);
  await editor.getByText('저장한 구성과 연결 관리', { exact: true }).click();
  await editor.getByLabel('저장한 구성', { exact: true }).selectOption('preset-b');
  await openCopy(editor);
  assert.equal(await editor.locator('input[aria-label="꼼꼼하게"]').isChecked(), true);
  await editor.getByLabel('펫에게 맡길 일', { exact: true }).fill('B에만 남길 초안');
  await editor.getByRole('button', { name: '← 돌아가기', exact: true }).click();
  await savedA.getByRole('button', { name: '이 펫 부르기 →', exact: true }).click();
  assert.equal(await editor.getByLabel('저장한 구성', { exact: true }).inputValue(), 'preset-a');
  assert.equal(await editor.locator('input[aria-label="가볍게"]').isChecked(), true);
  assert.equal(await editor.getByLabel('펫에게 맡길 일', { exact: true }).inputValue(), 'A에만 남길 초안');
  await editor.getByRole('button', { name: '← 돌아가기', exact: true }).click();
  await library.locator('.workspace-saved-card').filter({ hasText: '저장 구성 B' }).getByRole('button', { name: '이 펫 부르기 →', exact: true }).click();
  assert.equal(await editor.getByLabel('저장한 구성', { exact: true }).inputValue(), 'preset-b');
  assert.equal(await editor.getByLabel('펫에게 맡길 일', { exact: true }).inputValue(), 'B에만 남길 초안');
  assert.deepEqual(await library.evaluate(() => window.__uiTest.roles.pets), presets);
  assert.equal(await library.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'save_pet').length), 0);
  checks.push('same-role saved configurations: switching A to B preserves each preset identity, execution settings and separate request draft without writing either saved preset');
  await library.close();
  return images;
};
