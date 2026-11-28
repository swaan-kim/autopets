const assert = require('node:assert/strict');
const path = require('node:path');
const { chooseRole } = require('./entry-navigation.cjs');
const hosts = require('../../../packages/contracts/data/connections.json');

exports.runPresentationChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const { fitsCodexLink } = await import('../../../packages/guidance/start-request.mjs');
  const base = { ...structuredClone(fixture), sessions: [], petLinks: [], slots: [], setup: { version: 1, hosts, connectionMode: 'explicit-pet',
    connections: [{ hostId: 'codex-windows-local', configured: true, settingsVerified: { model: false, reasoning: false, submission: false } }] } };
  const screenshots = [];
  for (const [format, label] of [['recommend', '추천받기'], ['html', 'HTML'], ['figma', 'Figma'], ['pptx', 'PPTX']]) {
    const page = await newPage({ width: 992, height: 900 }); await mockBridge(page, base); await page.goto(origin);
    await chooseRole(page, '발표자료 만들기');
    const flow = page.locator('.pet-start');
    const options = flow.locator('[data-agent-id="pet-selection.composer.presentation"]');
    assert.equal(await options.locator('details').getAttribute('open'), null);
    assert.equal(await flow.getByText('PowerPoint 파일(.pptx)로도 받기').count(), 0);
    await flow.getByLabel('펫에게 맡길 일', { exact: true }).fill('동아리 활동을 신입생에게 5장으로 소개하고 싶어.');
    await options.getByLabel('발표자료 결과 형식', { exact: true }).selectOption(format);
    if (format === 'pptx') {
      await options.locator('summary').click();
      await options.getByLabel('발표자료 분위기·색상 (선택)', { exact: true }).fill('네이비와 아이보리');
      await options.getByRole('checkbox').check();
      await options.getByText('사진 없이도 주제에 맞는 디자인을 추천해요.', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(screenshotDir, 'presentation-options.png'), fullPage: true, animations: 'disabled' });
      screenshots.push(path.join(screenshotDir, 'presentation-options.png'));
      // Back to another task and back preserves only this task's choices, never leaks them.
      await chooseRole(page, '공부 도우미');
      assert.equal(await page.locator('[data-agent-id="pet-selection.composer.presentation"]').count(), 0);
      await chooseRole(page, '발표자료 만들기');
      assert.equal(await options.getByLabel('발표자료 결과 형식', { exact: true }).inputValue(), 'pptx');
      await options.locator('summary').click();
      assert.equal(await options.getByLabel('발표자료 분위기·색상 (선택)', { exact: true }).inputValue(), '네이비와 아이보리');
      assert.equal(await options.getByRole('checkbox').isChecked(), true);
    }
    assert.equal(await flow.getByRole('button', { name: 'Codex에서 시작', exact: true }).isEnabled(), true, 'no photo is required');
    await flow.getByRole('button', { name: 'Codex에서 시작', exact: true }).click();
    await page.waitForFunction(() => window.__uiTest.calls.some(call => call.name === 'open_pet_in_codex'));
    const calls = await page.evaluate(() => window.__uiTest.calls);
    const opened = calls.filter(call => call.name === 'open_pet_in_codex');
    assert.equal(opened.length, 1);
    assert.ok(opened[0].args.prompt.includes(`발표 형식: ${label}.`));
    assert.ok(opened[0].args.prompt.includes('recipe=presentation'));
    assert.ok(fitsCodexLink(opened[0].args.prompt));
    assert.equal(calls.some(call => /save_design|submit|execute|send_message/.test(call.name)), false);
    if (format === 'pptx') {
      assert.ok(opened[0].args.prompt.includes('디자인 요청: 네이비와 아이보리'));
      assert.ok(opened[0].args.prompt.includes('참고 사진은 채팅에 첨부'));
      assert.ok(!opened[0].args.prompt.includes('HTML'));
    } else assert.ok(!opened[0].args.prompt.includes('참고 사진'));
    await page.close();
  }
  const small = await newPage({ width: 390, height: 844 }); await mockBridge(small, base); await small.goto(origin); await chooseRole(small, '발표자료 만들기');
  assert.equal(await small.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const panel = small.locator('.workspace-detail-content'), preview = small.locator('.workspace-detail-preview');
  assert.ok((await panel.boundingBox()).y < (await preview.boundingBox()).y, 'input is before the large preview on a narrow screen');
  await small.locator('.presentation-design summary').focus(); await small.keyboard.press('Enter');
  await small.getByLabel('발표자료 분위기·색상 (선택)', { exact: true }).waitFor();
  assert.notEqual(await small.locator('.presentation-design summary').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
  await small.keyboard.press('Enter');
  await small.screenshot({ path: path.join(screenshotDir, 'presentation-narrow.png'), fullPage: true, animations: 'disabled' }); screenshots.push(path.join(screenshotDir, 'presentation-narrow.png'));
  await small.close();
  checks.push('presentation: four independent formats, optional reference photos, scoped preserved drafts, short launch requests without photo storage or auto-send; narrow and keyboard disclosure');
  return screenshots;
};
