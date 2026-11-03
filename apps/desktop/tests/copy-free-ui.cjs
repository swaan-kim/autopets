const assert = require('node:assert/strict');
const path = require('node:path');
const template = require('../../../packages/contracts/data/ui-pet.json');
const { chooseRole, openCopy } = require('./entry-navigation.cjs');

const A = '11111111-2222-4333-8444-555555555555';
const B = '11111111-2222-4333-8444-666666666666';
const key = link => JSON.stringify([link.target.sourceId, link.target.threadId, link.target.cwd]);
const link = (threadId, slot = 0) => ({
  version: 1, target: { sourceId: 'codex-windows-local', threadId, cwd: `C:/UI fixture only/${slot ? 'B' : 'A'}` },
  slot, revision: 4, enabled: true, connected: true, profile: 'light',
  template: structuredClone(template), run: null,
});
const mainApply = composer => composer.getByRole('button', { name: /^(?:이 채팅에 펫 적용|적용 확인 중…)$/ });

exports.runCopyFreeChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const base = { ...structuredClone(fixture), sessions: [], slots: [], petLinks: [],
    setup: { version: 1, connectionMode: 'explicit-pet', connections: [{ hostId: 'codex-windows-local', configured: true }] } };
  const images = [];
  const create = async (links, options = {}) => {
    const page = await newPage({ width: 992, height: 688 });
    await mockBridge(page, { ...structuredClone(base), petLinks: links, ...(options.serviceDisconnected ? { connectionPath: null } : {}) });
    await page.addInitScript(options => {
      const original = window.__TAURI_INTERNALS__.invoke;
      let applied = false;
      window.__uiTest.copyFreeOrder = [];
      window.__TAURI_INTERNALS__.invoke = async (name, args) => {
        if (['roles_snapshot', 'save_pet', 'get_snapshot', 'apply_pet_link_template', 'open_pet_task'].includes(name)) {
          window.__uiTest.copyFreeOrder.push({ name, args: structuredClone(args) });
        }
        if (name === 'apply_pet_link_template') {
          if (options.holdApply) await new Promise(resolve => { window.__uiTest.releaseApply = resolve; });
          if (options.failApply) throw Error('fixture application unavailable');
          await original(name, args);
          applied = true;
          // The real Tauri command returns void; the UI must verify a separate read.
          return null;
        }
        if (name === 'get_snapshot' && applied) {
          if (options.holdReadback) {
            options.holdReadback = false;
            const snapshot = await original(name, args);
            await new Promise(resolve => { window.__uiTest.releaseReadback = () => resolve(); });
            return snapshot;
          }
          const snapshot = await original(name, args);
          if (options.readback === 'missing') snapshot.petLinks = [];
          if (options.readback === 'wrong-pet') snapshot.petLinks[0].savedPet.id = 'different-pet';
          if (options.readback === 'wrong-pet-revision') snapshot.petLinks[0].savedPet.revision++;
          if (options.readback === 'duplicate-target') snapshot.petLinks.push(structuredClone(snapshot.petLinks[0]));
          if (options.readback === 'wrong-template') snapshot.petLinks[0].template.execution.reasoning = 'medium';
          if (options.readback === 'wrong-profile') snapshot.petLinks[0].profile = 'careful';
          if (options.readback === 'wrong-revision') snapshot.petLinks[0].revision += 2;
          if (options.readback === 'disconnected') snapshot.petLinks[0].connected = false;
          if (options.readback === 'disabled') snapshot.petLinks[0].enabled = false;
          if (options.readback === 'timeout') throw Error('fixture readback timeout');
          return snapshot;
        }
        return original(name, args);
      };
    }, options);
    await page.goto(origin);
    await chooseRole(page, '웹페이지 만들기');
    return { page, composer: page.locator('.pet-composer') };
  };

  // Preparation is not connection, and a browser cannot mutate the native app.
  const waiting = await create([]);
  await waiting.composer.locator('.composer-connect-instruction').waitFor();
  assert.match(await waiting.composer.locator('.composer-connect-instruction').innerText(), /제작 펫 연결/);
  assert.equal(await waiting.composer.locator('.composer-copy-fallback').evaluate(el => el.open), false);
  assert.equal(await waiting.composer.getByRole('button', { name: 'Codex 작업 열기', exact: true }).count(), 0);
  assert.deepEqual(await waiting.page.evaluate(() => window.__uiTest.calls), [], 'prepared but unlinked state does not install, copy, guess a chat, or dispatch work');
  await waiting.page.close();
  const browser = await newPage();
  await browser.goto(origin); await chooseRole(browser, '웹페이지 만들기');
  assert.equal(await browser.locator('.pet-composer .composer-action button').first().isDisabled(), true);
  assert.match(await browser.locator('.workspace-note').innerText(), /브라우저 미리보기/);
  await browser.close();
  checks.push('copy-free entry: prepared/no-link state shows the short current-chat skill invocation, keeps free-text copying secondary, and never guesses a destination; browser preview remains non-executing');

  const { page, composer } = await create([link(A), link(B, 1)], { holdApply: true });
  const select = composer.getByLabel('UI 펫을 적용할 채팅', { exact: true });
  assert.equal(await select.inputValue(), '', 'multiple chats require an explicit selection');
  assert.equal(await mainApply(composer).isDisabled(), true);
  await select.selectOption(key(link(A)));
  assert.equal(await composer.getAttribute('data-agent-scope'), 'pet-selection');
  assert.equal(await mainApply(composer).getAttribute('data-agent-id'), 'pet-selection.composer.apply');
  const targetDetails = composer.locator('.composer-target-details');
  assert.equal(await targetDetails.locator('.composer-target-id').isVisible(), false, 'technical target details stay optional');
  await targetDetails.locator('summary').click();
  assert.ok((await targetDetails.innerText()).includes(A), 'expanded target details retain the exact selected chat ID');
  await targetDetails.locator('summary').click();
  await select.focus(); await page.keyboard.press('Tab');
  await openCopy(composer);
  const draft = composer.getByLabel('펫에게 맡길 일', { exact: true });
  await draft.fill('앱에만 남기는 초안\n이 문장을 아직 보내지 마.');
  await composer.locator('.composer-copy-fallback > summary').click();
  const beforeB = await page.evaluate(() => structuredClone(window.__uiTest.state.petLinks[1]));
  await mainApply(composer).evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => typeof window.__uiTest.releaseApply === 'function');
  assert.equal(await page.evaluate(() => window.__uiTest.copyFreeOrder.filter(call => call.name === 'apply_pet_link_template').length), 1);
  assert.equal(await mainApply(composer).isDisabled(), true);
  await page.evaluate(() => window.__uiTest.releaseApply());
  await composer.locator('.composer-applied').waitFor();
  await composer.getByText('펫 설정을 적용했어요.', { exact: true }).waitFor();
  const after = await page.evaluate(() => ({
    order: window.__uiTest.copyFreeOrder, calls: window.__uiTest.calls,
    links: structuredClone(window.__uiTest.state.petLinks), clipboard: window.__uiTest.clipboard,
  }));
  assert.deepEqual(after.links[1], beforeB);
  assert.equal(after.links[0].savedPet.id, 'ui-pet-0');
  assert.equal(after.clipboard, '', 'applying a pet never touches the clipboard');
  const applyIndex = after.order.findIndex(call => call.name === 'apply_pet_link_template');
  assert.ok(after.order.slice(applyIndex + 1).some(call => call.name === 'get_snapshot'), 'success requires a separate read after the void apply response');
  const appliedArgs = after.order[applyIndex].args;
  assert.deepEqual(appliedArgs.target, link(A).target);
  assert.equal(appliedArgs.expectedRevision, 4);
  assert.deepEqual(Object.keys(appliedArgs).sort(), ['expectedRevision', 'petId', 'petRevision', 'target']);
  assert.equal(after.calls.some(call => /submit|send|execute_pet|prepare_pet/.test(call.name)), false);
  assert.equal(await draft.inputValue(), '앱에만 남기는 초안\n이 문장을 아직 보내지 마.');
  for (const [width, height] of [[992, 688], [716, 701], [661, 459], [375, 812]]) {
    await page.setViewportSize({ width, height });
    const button = composer.locator('.composer-applied').getByRole('button', { name: 'Codex 작업 열기', exact: true });
    await button.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await button.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }));
  }
  await page.setViewportSize({ width: 992, height: 688 });
  const returnButton = composer.locator('.composer-applied').getByRole('button', { name: 'Codex 작업 열기', exact: true });
  await returnButton.focus(); await page.keyboard.press('Enter');
  await composer.locator('.composer-applied').getByText(/Codex에 열기를 요청했어요/).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_task').map(call => call.args.target.threadId)), [A]);
  assert.equal(await page.evaluate(() => window.__uiTest.clipboard), '');
  const image = path.join(screenshotDir, 'copy-free-applied.png');
  await page.screenshot({ path: image, fullPage: true, animations: 'disabled' }); images.push(image);
  await page.evaluate(() => {
    window.__uiTest.state.petLinks[0].connected = false;
    window.__uiTest.emitEvent('autopets://snapshot', window.__uiTest.state);
  });
  await composer.locator('.composer-applied').waitFor({ state: 'detached' });
  await page.evaluate(() => {
    window.__uiTest.state.petLinks[0].connected = true;
    window.__uiTest.emitEvent('autopets://snapshot', window.__uiTest.state);
  });
  await mainApply(composer).waitFor();
  assert.equal(await composer.locator('.composer-applied').count(), 0, 'reconnecting the same revision does not resurrect prior confirmation');
  assert.equal(await composer.getByText('펫 설정을 적용했어요.', { exact: true }).count(), 0);
  checks.push('copy-free exact A apply: explicit A/B choice, one mutation under repeated click, saved preset and separate native readback before success, no task-text/clipboard/AI submission, unchanged B, draft preservation, keyboard exact-chat return, and compact layouts');
  await page.close();

  for (const [name, patch] of [
    ['help off', { enabled: false }],
    ['connection stale', { connected: false }],
    ['unresolved work', { run: { id: 'existing-work', state: 'working', profile: 'light' } }],
  ]) {
    const blocked = await create([{ ...link(A), ...patch }]);
    const target = blocked.composer.getByLabel('UI 펫을 적용할 채팅', { exact: true });
    await target.selectOption(key(link(A)));
    assert.equal(await mainApply(blocked.composer).isDisabled(), true, name);
    assert.equal(await blocked.composer.locator('.composer-applied').count(), 0, name);
    assert.equal(await blocked.page.evaluate(() => window.__uiTest.calls.some(call => call.name === 'apply_pet_link_template')), false, name);
    await blocked.page.close();
  }
  const offline = await create([link(A)], { serviceDisconnected: true });
  await offline.composer.getByLabel('UI 펫을 적용할 채팅', { exact: true }).selectOption(key(link(A)));
  assert.equal(await mainApply(offline.composer).isDisabled(), true, 'local service offline');
  assert.equal(await offline.page.evaluate(() => window.__uiTest.calls.some(call => call.name === 'apply_pet_link_template')), false);
  await offline.page.close();
  for (const readback of ['missing', 'wrong-pet', 'wrong-pet-revision', 'duplicate-target', 'wrong-template', 'wrong-profile', 'wrong-revision', 'disconnected', 'disabled', 'timeout']) {
    const failed = await create([link(A)], { readback });
    const target = failed.composer.getByLabel('UI 펫을 적용할 채팅', { exact: true });
    await target.selectOption(key(link(A)));
    await mainApply(failed.composer).click();
    await failed.composer.getByRole('alert').waitFor();
    assert.equal(await failed.composer.locator('.composer-applied').count(), 0, readback);
    assert.equal(await failed.composer.locator('.composer-applied button').count(), 0, readback);
    assert.equal(await failed.page.evaluate(() => window.__uiTest.clipboard), '', readback);
    await failed.page.close();
  }
  for (const change of ['revision', 'removed', 'disabled', 'disconnected']) {
    const stale = await create([link(A), link(B, 1)], { holdReadback: true });
    await stale.composer.getByLabel('UI 펫을 적용할 채팅', { exact: true }).selectOption(key(link(A)));
    await mainApply(stale.composer).click();
    await stale.page.waitForFunction(() => typeof window.__uiTest.releaseReadback === 'function');
    const oldB = await stale.page.evaluate(() => structuredClone(window.__uiTest.state.petLinks[1]));
    await stale.page.evaluate(change => {
      const state = window.__uiTest.state;
      if (change === 'removed') state.petLinks = state.petLinks.filter(link => link.slot !== 0);
      else if (change === 'revision') state.petLinks[0].revision++;
      else state.petLinks[0][change === 'disabled' ? 'enabled' : 'connected'] = false;
      window.__uiTest.emitEvent('autopets://snapshot', state);
    }, change);
    await stale.page.evaluate(() => window.__uiTest.releaseReadback());
    await stale.composer.getByRole('button', { name: '이 채팅에 펫 적용', exact: true }).waitFor();
    assert.equal(await stale.composer.locator('.composer-applied').count(), 0, `late readback after ${change}`);
    assert.equal(await stale.composer.getByText('펫 설정을 적용했어요.', { exact: true }).count(), 0, change);
    assert.deepEqual(await stale.page.evaluate(() => window.__uiTest.state.petLinks.find(link => link.slot === 1)), oldB);
    assert.equal(await stale.page.evaluate(() => window.__uiTest.calls.some(call => /open_pet_task|submit|send|execute_pet/.test(call.name))), false);
    await stale.page.close();
  }
  checks.push('copy-free failures: help off, disconnected and unresolved target block apply; missing/mismatched pet, template, profile, revision, disabled/disconnected readback and timeout never show confirmed settings or trigger work');
  checks.push('late copy-free readbacks cannot confirm a removed, changed, disabled or disconnected A; reconnecting the same revision requires a fresh confirmation; unrelated B and chat dispatch remain untouched');
  return images;
};
