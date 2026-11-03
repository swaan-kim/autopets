const assert = require('node:assert/strict');
const path = require('node:path');
const template = require('../../../packages/contracts/data/ui-pet.json');
const { openCatalog, chooseRole, openCopy } = require('./entry-navigation.cjs');

exports.runVisualSimplicityChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const images = [];
  const page = await newPage({ width: 992, height: 688 });
  await mockBridge(page, { ...structuredClone(fixture), sessions: [], slots: [], petLinks: [],
    setup: { version: 1, connectionMode: 'explicit-pet', connections: [{ hostId: 'codex-windows-local', configured: true }] } });
  await page.goto(origin);
  const capture = async name => { const file = path.join(screenshotDir, `after-${name}.png`); await page.screenshot({ path: file, fullPage: true, animations: 'disabled' }); images.push(file); };
  const home = page.locator('.pet-home');
  await home.getByRole('heading', { name: '어떤 펫과 일할까요?', exact: true }).waitFor();
  await home.locator('[data-assets="ready"]').first().waitFor();
  assert.deepEqual(await page.locator('.app-header > nav .nav-text').allTextContents(), ['홈', '펫 고르기', '내 작업']);
  assert.equal(await home.locator('.result-preview, .experience-output, textarea, input').count(), 0, 'home chooses a pet; requests remain in the existing Codex chat');
  for (const viewport of [{ width: 992, height: 688 }, { width: 716, height: 701 }]) {
    await page.setViewportSize(viewport);
    for (const locator of [page.locator('.pet-home-greeting'), page.locator('.pet-home-intro'), page.locator('.pet-home-find')]) {
      const box = await locator.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height, `pet, explanation and primary action appear on first screen ${viewport.width}×${viewport.height}: ${JSON.stringify(box)}`);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(`home-${viewport.width}`);
  }
  await page.setViewportSize({ width: 992, height: 688 });
  await capture('home');
  await page.locator('.pet-home-find').click();
  assert.equal(await page.locator('.workspace-role-card').count(), 6, 'one primary home action opens the six-role catalog');
  await page.getByRole('button', { name: '웹페이지 만들기 펫 선택', exact: true }).click();
  assert.equal(await page.locator('.pet-composer').count(), 0, 'preview requires explicit use');
  assert.deepEqual(await page.evaluate(() => window.__uiTest.calls), [], 'browsing never saves, connects or executes');
  await page.locator('.workspace-role-detail').getByRole('button', { name: '웹페이지 만들기 이 펫으로', exact: true }).click();
  const composer = page.locator('.pet-composer');
  assert.equal(await composer.locator('.composer-copy-fallback').evaluate(el => el.open), false, 'app task composition is a secondary, disclosed path');
  assert.equal(await composer.getByLabel('펫에게 맡길 일', { exact: true }).isVisible(), false);
  await openCopy(composer);
  const task = composer.getByLabel('펫에게 맡길 일', { exact: true });
  await task.fill('학과 행사 웹페이지를 만들어줘.\n일정과 신청 안내, 모바일 화면을 포함해줘.');
  assert.equal(await composer.locator('.result-preview').count(), 0);
  assert.equal(await composer.locator('.composer-more').evaluate(el => el.open), false);
  await capture('composer');
  await composer.getByRole('button', { name: '시작 요청 복사', exact: true }).click();
  await composer.getByText('쓸 Codex 채팅에 붙여넣고 보내세요.', { exact: true }).waitFor();
  assert.ok((await page.evaluate(() => window.__uiTest.clipboard)).includes('일정과 신청 안내, 모바일 화면을 포함해줘.'));
  assert.equal(await composer.locator('.composer-applied, .composer-observed').count(), 0, 'copy never becomes application or execution evidence');
  assert.deepEqual(await page.evaluate(() => window.__uiTest.state.petLinks), []);
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => /connect_ai|apply_pet|submit|send|execute/.test(call.name))), false);
  await composer.getByRole('button', { name: '← 돌아가기', exact: true }).click();
  await openCatalog(page);
  assert.equal(await page.locator('.workspace-role-card').count(), 6);
  await page.getByRole('button', { name: '웹페이지 만들기 펫 선택', exact: true }).click();
  const detail = page.locator('.workspace-role-detail');
  await detail.locator('.result-preview img').first().evaluate(img => img.decode());
  assert.equal(await detail.locator('.result-preview').getAttribute('data-evidence'), 'design-example');
  assert.ok((await detail.innerText()).includes('디자인 예시'));
  assert.equal(await detail.getByText('실제 제작 예시', { exact: true }).count(), 0, 'redesigned example is not execution proof');
  await capture('selection');
  await detail.getByRole('button', { name: '모바일', exact: true }).click();
  await detail.locator('.result-preview img').first().evaluate(img => img.decode());
  assert.match(await detail.locator('.result-preview img').getAttribute('src'), /mobile\.webp$/);
  const openExample = detail.getByRole('button', { name: '크게 보기 ↗', exact: true });
  await openExample.focus(); await page.keyboard.press('Enter');
  const example = page.getByRole('dialog', { name: '가상 학과 행사 디자인 예시', exact: true });
  await example.waitFor();
  assert.ok(await example.locator('img').evaluate(img=>img.complete && img.naturalWidth>0));
  assert.equal(await example.getByRole('button', { name: '닫기 ×', exact: true }).evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Escape'); await example.waitFor({ state: 'hidden' });
  assert.equal(await openExample.evaluate(el => document.activeElement === el), true, 'example close returns focus');
  await detail.getByRole('button', { name: '데스크톱', exact: true }).click();
  await detail.getByRole('button', { name: '웹페이지 만들기 이 펫으로', exact: true }).click();
  await openCopy(composer);
  await task.fill('역할별 기존 초안: 작품 소개 웹페이지');
  await page.locator('.app-header nav').getByRole('button', { name: '펫 고르기', exact: true }).click();
  await composer.waitFor({ state: 'detached' });
  assert.equal(await composer.count(), 0, 'the current top-level navigation also leaves the composer');
  assert.equal(await page.locator('.workspace-role-card').count(), 6, 'same-navigation return preserves the all-role filter');
  await page.locator('.app-header nav').getByRole('button', { name: '홈', exact: true }).click();
  assert.equal(await home.locator('textarea, input').count(), 0, 'returning home never asks the user to re-enter a Codex task');
  await page.locator('.pet-home-find').click();
  await chooseRole(page, '공부 도우미');
  await openCopy(composer);
  await task.fill('공부 역할에만 남기는 선택형 초안');
  await composer.getByRole('button', { name: '← 돌아가기', exact: true }).click();
  await chooseRole(page, '웹페이지 만들기');
  await openCopy(composer);
  assert.equal(await task.inputValue(), '역할별 기존 초안: 작품 소개 웹페이지', 'browsing and another role cannot overwrite an optional role draft');
  await composer.getByRole('button', { name: '← 돌아가기', exact: true }).click();
  await openCatalog(page);
  await chooseRole(page, '공부 도우미');
  await composer.getByRole('heading', { name: '공부 도우미', exact: true }).waitFor();
  await page.close();
  checks.push('pet and single selection action fit 992×688/716×701; home has no task submission; browsing is local only; optional copy and role drafts preserved; preview is design-only and absent from composer; copy never claims chat receipt or executes');

  const fallback = await newPage();
  await fallback.route('**/assets/design-example-v1/*.webp', route => route.abort());
  await fallback.goto(origin); await openCatalog(fallback);
  await fallback.getByRole('button', { name: '웹페이지 만들기 펫 선택', exact: true }).click();
  await fallback.locator('.workspace-role-detail .result-thumbnail-fallback').waitFor();
  assert.equal(await fallback.getByRole('button', { name: '웹페이지 만들기 이 펫으로', exact: true }).isEnabled(), true, 'missing example does not block choosing a role');
  await fallback.close();
  const A = '11111111-2222-4333-8444-555555555555';
  const B = '11111111-2222-4333-8444-666666666666';
  const returning = await newPage({ width: 992, height: 688 });
  const value = { ...structuredClone(fixture), sessions: [], slots: [], petLinks: [A, B].map((threadId, slot) => ({
    version: 1, target: { sourceId: 'codex-windows-local', threadId, cwd: 'C:/UI fixture only' }, slot, revision: 1,
    enabled: true, connected: true, profile: 'light', template,
    run: { id: `run-${slot}`, profile: slot ? 'plan' : 'light', state: slot ? 'waiting' : 'complete' },
  })) };
  await mockBridge(returning, value); await returning.goto(origin);
  const items = returning.locator('.pet-home .workspace-live-card');
  await items.first().waitFor();
  await returning.locator('[data-agent-id="home.connection"]').getByText('연결된 Codex 채팅 2개', { exact: true }).waitFor();
  assert.ok((await items.first().getAttribute('class')).includes('pet-card-1'), 'attention precedes recent completion');
  await items.first().getByRole('button', { name: '계획 보러 가기', exact: true }).click();
  await items.first().getByText(/Codex에 열기를 요청했어요/).waitFor();
  assert.deepEqual(await returning.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_task').map(call => call.args.target.threadId)), [B]);
  assert.deepEqual(await returning.evaluate(() => window.__uiTest.state.petLinks), value.petLinks);
  const output = path.join(screenshotDir, 'after-task-return.png');
  await returning.screenshot({ path: output, fullPage: true, animations: 'disabled' }); images.push(output);
  await returning.close();
  checks.push('returning home prioritizes confirmation and dispatches the exact registered B without changing A/B records');
  return images;
};
