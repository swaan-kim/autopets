const { openTasks } = require('./entry-navigation.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const templates = require('../../../packages/contracts/data/roles.json');

exports.runPetLinkChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const page = await newPage({ width: 1120, height: 900 });
  const value = {
    ...structuredClone(fixture), sessions: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })),
    petLinks: [{
      version: 1, target: { sourceId: 'codex-windows-local', threadId: '11111111-2222-4333-8444-555555555555', cwd: 'C:/UI fixture only' },
      slot: 0, revision: 1, enabled: true, connected: true, profile: 'light', template: templates[1], run: null,
    }],
  };
  await mockBridge(page, value); await page.goto(origin); await openTasks(page);
  const card = page.locator('.explicit-pet');
  assert.equal(await card.getAttribute('data-agent-scope'), 'task-card');
  assert.equal(await card.locator('[data-agent-id="task-card.return"]').count(), 1);
  const profile = card.getByRole('combobox', { name: '다음 펫 작업 설정' });
  await card.getByText('새 일을 맡길 수 있어요', { exact: true }).waitFor();
  assert.equal(await card.locator('.explicit-status-panel .explicit-help').count(), 0, 'healthy compact cards show status and action without repeated explanation');
  await card.getByRole('button', { name: 'Codex에서 보기 ↗', exact: true }).waitFor();
  assert.equal(await card.getByText('완료', { exact: true }).count(), 0);
  assert.equal(await profile.isVisible(), false, 'management starts collapsed');
  await card.locator('.explicit-settings summary').click();
  const alias = card.getByRole('textbox', { name: '작업 이름', exact: true });
  await page.waitForFunction(() => !document.querySelector('[aria-label="작업 이름"]').disabled);
  await alias.fill('행사 페이지 A');
  await card.locator('.explicit-heading strong').getByText('행사 페이지 A', { exact: true }).waitFor();
  await page.reload(); await openTasks(page); await card.locator('.explicit-settings summary').click();
  await page.waitForFunction(() => document.querySelector('[aria-label="작업 이름"]').value === '행사 페이지 A');
  assert.equal(await alias.inputValue(), '행사 페이지 A', 'local display name survives reload');
  await alias.fill('   ');
  await card.locator('.explicit-heading strong').getByText(templates[1].name, { exact: true }).waitFor();
  await alias.fill('행사 페이지 A');
  await page.evaluate(() => {
    window.__uiTest.state.petLinks[0].target.threadId = '22222222-2222-4333-8444-555555555555';
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  await page.waitForFunction(() => !document.querySelector('[aria-label="작업 이름"]').disabled && document.querySelector('[aria-label="작업 이름"]').value === '');
  assert.equal(await card.locator('.explicit-settings').evaluate(element => element.open), false, 'switching exact targets remounts the card with management collapsed');
  await card.locator('.explicit-settings > summary').click();
  await alias.fill('다른 작업 B');
  await page.evaluate(threadId => {
    window.__uiTest.state.petLinks[0].target.threadId = threadId;
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  }, value.petLinks[0].target.threadId);
  await page.waitForFunction(() => document.querySelector('[aria-label="작업 이름"]').value === '행사 페이지 A');
  await card.locator('.explicit-settings > summary').click();
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => call.name === 'rename_session')), false, 'display names do not rename host chats');
  await profile.selectOption('careful');
  assert.equal(await page.evaluate(() => window.__uiTest.state.petLinks[0].profile), 'careful');

  // Observe the complete plan -> confirmation -> implementation -> result sequence.
  // These fixture events do not submit a request or execute a model.
  const showRun = async (state, profile, label) => {
    await page.evaluate(({ state, profile }) => {
      window.__uiTest.state.petLinks[0].run = {
        id: 'fixture-run', settingsRevision: window.__uiTest.state.petLinks[0].revision,
        profile, model: 'fixture-model', effort: 'medium', state,
        childId: null, turnId: null, observedModel: null, observedEffort: null,
        evidence: null, startedAt: Date.now(),
      };
      window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
    }, { state, profile });
    await card.locator(`.explicit-status-panel[data-state="${state}"]`).getByText(label, { exact: true }).waitFor();
    assert.equal(await card.locator('.explicit-status-panel .explicit-help').count(), ['failed', 'unknown'].includes(state) ? 1 : 0, 'only failed or unconfirmed work needs recovery help');
  };
  await showRun('requested', 'plan', '계획 중');
  assert.equal(await card.getByRole('button', { name: '상태 확인 요청 복사', exact: true }).isVisible(), false, 'copy helpers stay behind optional disclosure');
  assert.equal(await card.getByRole('button', { name: '연결 해제', exact: true }).isDisabled(), true, 'active work cannot lose its observation target');
  await card.locator('.explicit-chat-help > summary').click();
  await card.getByRole('button', { name: '상태 확인 요청 복사', exact: true }).waitFor();
  const evidence = card.locator('.explicit-evidence');
  assert.equal(await evidence.evaluate(element => element.open), false, 'execution details are disclosed on request');
  await evidence.locator(':scope > summary').click();
  await evidence.getByText('이번 요청: fixture-model · medium', { exact: true }).waitFor();
  await evidence.getByText('실행 설정 확인 전', { exact: true }).waitFor();
  assert.equal(await evidence.getByText(/^실행 기록:/).count(), 0, 'requested settings are not claimed as observed execution');
  await evidence.locator(':scope > summary').click();
  assert.equal(await profile.isDisabled(), true);
  await showRun('working', 'plan', '계획 중');
  await card.locator('[data-motion="thinking"]').waitFor();
  await showRun('waiting', 'plan', '계획을 확인해 주세요');
  await card.getByRole('button', { name: '계획 보기 ↗', exact: true }).waitFor();
  await card.getByRole('button', { name: '구현 요청 복사', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__uiTest.clipboard), '그대로 구현해줘');
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => /submit|send|prepare_pet|execute_pet/.test(call.name))), false, 'copying a follow-up never submits it');
  await showRun('requested', 'careful', '작업 중');
  await showRun('working', 'careful', '작업 중');
  await card.locator('[data-motion="writing"]').waitFor();
  assert.equal(await profile.isDisabled(), true);
  await showRun('returned', 'careful', '결과 확인 중');
  await card.getByText('결과가 왔어요 · 일하는 방법은 확인하지 못했어요', { exact: true }).waitFor();
  await card.locator('[data-motion="dizzy"]').waitFor();
  assert.equal(await card.getByText('완료', { exact: true }).count(), 0, 'a returned result alone does not mean completion');
  await showRun('complete', 'careful', '완료');
  await card.getByRole('button', { name: 'Codex에서 보기 ↗', exact: true }).waitFor();
  await card.locator('[data-motion="celebrate"]').waitFor();
  assert.equal(await profile.isEnabled(), true);
  await showRun('unknown', 'careful', '문제가 생겼어요');
  await card.getByText('Codex 채팅에 ‘펫 상태 확인’이라고 보내 주세요.', { exact: true }).waitFor();
  await card.locator('[data-motion="angry"]').waitFor();
  assert.equal(await card.getByText('완료', { exact: true }).count(), 0);
  assert.equal(await profile.isDisabled(), true);
  await showRun('failed', 'careful', '문제가 생겼어요');
  await card.getByText('Codex 채팅에 ‘펫 상태 확인’이라고 보내 주세요.', { exact: true }).waitFor();
  assert.equal(await card.getByText('완료', { exact: true }).count(), 0);
  await showRun('returned', 'careful', '결과 확인 중');

  await card.getByRole('button', { name: '도움 끄기', exact: true }).click();
  await card.getByText('새 펫 작업은 꺼져 있어요. 이미 시작한 작업은 계속 확인해요.', { exact: true }).waitFor();
  await card.getByText('결과 확인 중', { exact: true }).waitFor();
  await card.getByRole('button', { name: '도움 켜기', exact: true }).click();
  await card.getByRole('button', { name: '도움 끄기', exact: true }).waitFor();
  await card.getByRole('button', { name: '이 작업 그만 확인하기', exact: true }).click();
  await card.getByRole('button', { name: '계속 확인하기', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => call.name === 'close_pet_tracking')), false);
  await card.getByRole('button', { name: '이 작업 그만 확인하기', exact: true }).click();
  await card.getByRole('button', { name: '그만 확인하기', exact: true }).click();
  await card.getByText('더 확인하지 않아요', { exact: true }).waitFor();
  assert.equal(await profile.isEnabled(), true);
  await showRun('waiting', 'plan', '계획을 확인해 주세요');
  await card.locator('.explicit-settings summary').click();
  const image = path.join(screenshotDir, 'native-ui-explicit-pet.png');
  await page.screenshot({ path: image, fullPage: true });

  // The desktop pet's popup: which chat, what state, what next. Management stays in the app card.
  const shots = process.env.AUTOPETS_UI_POPUP_SHOTS;
  const overlay = await newPage({ width: 180, height: 230 });
  await mockBridge(overlay, value); await overlay.goto(`${origin}/?pet=0`);
  const petButton = overlay.getByRole('button', { name: `${templates[1].name} 메뉴`, exact: true });
  await petButton.click();
  const popup = overlay.locator('.pet-popup');
  await overlay.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Codex에서 보기');
  // The native window expands asynchronously, after the popup receives keyboard focus.
  await overlay.setViewportSize({ width: 328, height: 600 });
  const opened = await overlay.evaluate(() => ({
    headingTop: document.querySelector('.pet-popup-head').getBoundingClientRect().top,
    scrollTop: document.querySelector('.quick-card-stack').scrollTop,
    width: Math.round(document.querySelector('.pet-popup').getBoundingClientRect().width),
    radius: getComputedStyle(document.querySelector('.pet-popup')).borderTopLeftRadius,
    dot: getComputedStyle(document.querySelector('.pet-popup-dot')).backgroundColor,
    buttons: [...document.querySelectorAll('.pet-popup button')].map(button => {
      const box = button.getBoundingClientRect();
      return { label: button.getAttribute('aria-label'), width: box.width, height: box.height };
    }),
  }));
  assert.ok(opened.headingTop >= 0, 'opening a compact pet keeps its chat heading visible');
  assert.equal(opened.scrollTop, 0, 'opening a pet does not scroll away its identity');
  assert.equal(opened.width, 300);
  assert.equal(opened.radius, '22px');
  assert.equal(opened.dot, 'rgb(47, 107, 79)', 'a connected pet shows the green dot');
  for (const button of opened.buttons) {
    assert.ok(button.label, 'every popup button is named');
    assert.ok(button.width >= 44 && button.height >= 44, `${button.label}: at least a 44px target`);
  }
  assert.equal(await popup.getAttribute('data-agent-scope'), 'task-card');
  assert.equal(await popup.getAttribute('data-agent-id'), 'task-card.root');
  assert.equal(await popup.getAttribute('data-agent-item'), 'slot-0');
  for (const id of ['open-chat', 'open-app', 'hide', 'quit', 'profile']) assert.equal(await popup.locator(`[data-agent-id="task-card.${id}"]`).count(), 1, `task-card.${id}`);
  // Without a Codex chat name the folder names the chat; the full value is in its title.
  const heading = popup.locator('.pet-popup-title strong');
  assert.equal(await heading.textContent(), 'UI fixture only');
  assert.equal(await heading.getAttribute('title'), 'UI fixture only');
  await overlay.evaluate(threadId => { window.__uiTest.chatTitles = { [threadId]: 'AutoPets 시험 채팅' }; window.dispatchEvent(new Event('focus')); }, value.petLinks[0].target.threadId);
  await heading.getByText('AutoPets 시험 채팅', { exact: true }).waitFor();
  await popup.locator('.pet-popup-status').getByText(`${templates[1].name} · 새 일을 맡길 수 있어요`, { exact: true }).waitFor();
  assert.equal(await popup.locator('.pet-popup-guide').count(), 0, 'a healthy pet needs no extra explanation');
  for (const name of ['Codex에서 보기', '앱 열기', '펫 숨기기', 'AutoPets 종료', '작업 방식 바꾸기']) await popup.getByRole('button', { name, exact: true }).waitFor();
  for (const text of ['실행 설정·스킬 확인', '채팅 요청 예시', '도움 끄기', '연결 해제', '이 작업 그만 확인하기', '닫기']) assert.equal(await popup.getByText(text, { exact: true }).count(), 0, `${text} stays in the app card`);
  assert.equal(await popup.getByRole('textbox').count(), 0, 'the task name is edited in the app card');
  if (shots) await popup.screenshot({ path: path.join(shots, 'pet-popup-connected.png') });

  // "바꾸기" turns the line into the three choices; choosing one saves it and folds the line again.
  await popup.locator('.pet-popup-profile strong').getByText('가볍게', { exact: true }).waitFor();
  await popup.getByRole('button', { name: '작업 방식 바꾸기', exact: true }).click();
  const choices = popup.getByRole('radiogroup', { name: '작업 방식', exact: true });
  assert.deepEqual(await choices.getByRole('radio').allTextContents(), ['가볍게', '표준', '꼼꼼하게']);
  assert.equal(await choices.getByRole('radio', { name: '작업 방식 가볍게', exact: true }).getAttribute('aria-checked'), 'true');
  await overlay.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '작업 방식 가볍게');
  if (shots) await popup.screenshot({ path: path.join(shots, 'pet-popup-change.png') });
  await choices.getByRole('radio', { name: '작업 방식 표준', exact: true }).click();
  await popup.locator('.pet-popup-profile strong').getByText('표준', { exact: true }).waitFor();
  assert.deepEqual(await overlay.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'set_pet_link_profile').map(call => call.args)), [
    { target: value.petLinks[0].target, expectedRevision: 1, profile: 'standard' },
  ]);
  await overlay.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '작업 방식 바꾸기');
  // A stale revision keeps the line open and shows the existing error.
  await overlay.evaluate(() => { window.__uiTest.state.petLinks[0].revision += 5; });
  await popup.getByRole('button', { name: '작업 방식 바꾸기', exact: true }).click();
  await choices.getByRole('radio', { name: '작업 방식 꼼꼼하게', exact: true }).click();
  await popup.getByRole('alert').getByText('설정이 바뀌었어요. 현재 상태를 확인한 뒤 다시 선택해 주세요.', { exact: true }).waitFor();
  await overlay.evaluate(() => { window.__uiTest.state.petLinks[0].revision -= 5; window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state)); });
  // Same locks as the app card's select: unresolved work, and a "plan" profile is shown but never offered.
  await overlay.evaluate(() => {
    window.__uiTest.state.petLinks[0].profile = 'plan';
    window.__uiTest.state.petLinks[0].run = { id: 'popup-run', profile: 'plan', state: 'working', model: 'fixture-model', effort: 'medium', startedAt: Date.now() };
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  await popup.locator('.pet-popup-profile strong').getByText('계획만', { exact: true }).waitFor();
  assert.equal(await popup.getByRole('button', { name: '작업 방식 바꾸기', exact: true }).isDisabled(), true, 'unresolved work locks the work style');
  await overlay.evaluate(() => {
    window.__uiTest.state.petLinks[0].run.state = 'waiting';
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  await popup.getByText('Codex에서 계획을 확인하고 “그대로 구현해줘”라고 보내 주세요.', { exact: true }).waitFor();
  await popup.getByRole('button', { name: '계획 보기', exact: true }).waitFor();
  await popup.getByRole('button', { name: '작업 방식 바꾸기', exact: true }).click();
  assert.deepEqual(await choices.getByRole('radio').allTextContents(), ['가볍게', '표준', '꼼꼼하게'], '"계획만" is never offered');
  assert.equal(await choices.locator('[aria-checked="true"]').count(), 0);
  await overlay.evaluate(() => {
    window.__uiTest.state.petLinks[0].profile = 'light'; window.__uiTest.state.petLinks[0].run = null;
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  // Wait until the snapshot above is applied; clicking earlier races it and saves the profile again.
  await choices.getByRole('radio', { name: '작업 방식 가볍게', exact: true }).and(choices.locator('[aria-checked="true"]')).waitFor();
  await choices.getByRole('radio', { name: '작업 방식 가볍게', exact: true }).click();
  assert.equal(await overlay.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'set_pet_link_profile').length), 2, 'choosing the current style only folds the line');

  // Quit asks once, in place of the buttons; cancelling keeps the app running.
  await popup.getByRole('button', { name: 'AutoPets 종료', exact: true }).click();
  const confirm = popup.getByRole('group', { name: 'AutoPets 종료 확인', exact: true });
  await confirm.getByText('AutoPets를 끌까요?', { exact: true }).waitFor();
  assert.equal(await popup.locator('.pet-popup-actions').count(), 0);
  assert.equal(await overlay.evaluate(() => window.__uiTest.calls.some(call => call.name === 'quit_app')), false, 'the first press only asks');
  await overlay.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '종료 취소');
  await confirm.getByRole('button', { name: '종료 취소', exact: true }).click();
  await popup.getByRole('button', { name: 'AutoPets 종료', exact: true }).waitFor();
  assert.equal(await overlay.evaluate(() => window.__uiTest.calls.some(call => call.name === 'quit_app')), false);
  await popup.getByRole('button', { name: 'AutoPets 종료', exact: true }).click();
  await confirm.getByRole('button', { name: 'AutoPets 끄기', exact: true }).click();
  await overlay.waitForFunction(() => window.__uiTest.calls.some(call => call.name === 'quit_app'));
  // The fixture app keeps running after quit_app; return to the buttons.
  await confirm.getByRole('button', { name: '종료 취소', exact: true }).click();

  await popup.getByRole('button', { name: '앱 열기', exact: true }).click();
  await overlay.waitForFunction(() => window.__uiTest.calls.some(call => call.name === 'show_manager'));
  await overlay.keyboard.press('Escape');
  await petButton.waitFor();
  assert.equal(await overlay.locator('.quick-card-stack').count(), 0, 'Escape closes the popup');
  await petButton.click(); await popup.waitFor();
  await overlay.mouse.click(4, 4);
  await popup.waitFor({ state: 'detached' });
  await petButton.click(); await popup.waitFor();

  // A lost connection: amber dot, plain words, and "다시 연결" only opens the chat.
  await overlay.evaluate(() => {
    window.__uiTest.state.petLinks[0].connected = false;
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  await popup.locator('.pet-popup-status').getByText(`${templates[1].name} · 연결이 끊겼어요`, { exact: true }).waitFor();
  assert.equal(await popup.locator('.pet-popup-dot').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(201, 138, 0)');
  await popup.locator('.pet-popup-guide.lost').getByText('“다시 연결”을 누르면 채팅을 열고 다시 이어요.', { exact: true }).waitFor();
  if (shots) await popup.screenshot({ path: path.join(shots, 'pet-popup-lost.png') });
  await popup.getByRole('button', { name: '다시 연결', exact: true }).click();
  await popup.getByText('채팅에 ‘펫 상태 확인’을 보내면 다시 이어져요.', { exact: true }).waitFor();
  assert.deepEqual(await overlay.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_task').map(call => call.args)), [
    { target: value.petLinks[0].target, expectedRevision: await overlay.evaluate(() => window.__uiTest.state.petLinks[0].revision) },
  ]);
  assert.equal(await overlay.evaluate(() => window.__uiTest.calls.some(call => /submit|send|connect_pet|pet_link_connect|prepare_pet|execute_pet/.test(call.name))), false, 'reconnecting never writes to the chat or connects by itself');
  assert.equal(await overlay.evaluate(() => window.__uiTest.state.petLinks[0].connected), false);
  await popup.getByRole('button', { name: '작업 방식 바꾸기', exact: true }).waitFor();
  await petButton.click();
  await popup.waitFor({ state: 'detached' });
  // "숨기기" tucks this pet into the closer screen side (the native window picks it: tuck_pet).
  // The fixture bridge has no screens, so first: no side found → the pet hides as before.
  await petButton.click();
  await popup.getByRole('button', { name: '펫 숨기기', exact: true }).click();
  await overlay.waitForFunction(() => window.__uiTest.calls.some(call => call.name === 'set_pet_visible' && call.args.slot === 0 && call.args.visible === false));
  assert.equal(await overlay.locator('.pet-dock-tab').count(), 0);
  // With a side (here: left), the popup closes, the window shrinks back to the pet, and the pet
  // slides into that side as the arrow handle, exactly like a drop at the edge.
  await overlay.evaluate(() => {
    const bridge = window.__TAURI_INTERNALS__; const invoke = bridge.invoke;
    bridge.invoke = async (name, args) => {
      if (name === 'tuck_pet') { window.__uiTest.calls.push({ name, args }); return 'left'; }
      return invoke(name, args);
    };
    window.__uiTest.calls.length = 0;
  });
  await petButton.click();
  await popup.getByRole('button', { name: '펫 숨기기', exact: true }).click();
  const handle = overlay.getByRole('button', { name: `${templates[1].name} 다시 보기`, exact: true });
  await handle.waitFor();
  assert.equal(await overlay.locator('.pet-dock.dock-left .pet-dock-arrow').textContent(), '›');
  const hideCalls = await overlay.evaluate(() => window.__uiTest.calls.map(call => call.name === 'set_pet_expanded' ? `${call.name}:${call.args.expanded}` : call.name)
    .filter(name => ['set_pet_expanded:false', 'tuck_pet', 'dock_pet', 'set_pet_visible'].includes(name)));
  assert.ok(hideCalls.indexOf('set_pet_expanded:false') < hideCalls.indexOf('tuck_pet'), 'the popup closes before the side is chosen');
  assert.ok(hideCalls.indexOf('tuck_pet') < hideCalls.indexOf('dock_pet'));
  assert.equal(hideCalls.includes('set_pet_visible'), false, 'a tucked pet is not hidden');
  assert.deepEqual(await overlay.evaluate(() => window.__uiTest.calls.find(call => call.name === 'dock_pet').args), { edge: 'left' });
  await handle.click();
  await petButton.waitFor();
  assert.ok(await overlay.evaluate(() => window.__uiTest.calls.some(call => call.name === 'undock_pet')));
  // The app's task card keeps everything the popup left out.
  await page.locator('.explicit-evidence > summary').getByText('실행 설정·스킬 확인', { exact: true }).waitFor();
  await page.locator('.explicit-chat-help > summary').getByText('채팅 요청 예시', { exact: true }).waitFor();
  const unavailableLabels = await newPage({ width: 716, height: 701 });
  await mockBridge(unavailableLabels, value);
  await unavailableLabels.addInitScript(() => Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true }));
  await unavailableLabels.goto(origin); await openTasks(unavailableLabels);
  await unavailableLabels.locator('.explicit-settings summary').click();
  await unavailableLabels.getByText('작업 이름을 저장할 수 없어요.', { exact: true }).waitFor();
  await unavailableLabels.getByRole('button', { name: 'Codex에서 보기 ↗', exact: true }).waitFor();
  assert.equal(await unavailableLabels.getByRole('textbox', { name: '작업 이름', exact: true }).isDisabled(), true, 'optional label storage failure never disables task return');
  await unavailableLabels.close();
  checks.push('explicit pet: stable Agentation task-card targets; healthy compact status/action with collapsed evidence and optional copy helpers; local display-name reload/A-B isolation/blank fallback without host rename; requested settings never imply observed execution; recovery help for unknown/failed/off/disconnected; settings update; planning/confirmation/production/result/completion order; unknown/failed never imply completion; follow-up copy never submits; unresolved settings/disconnect lock; disabled assistance keeps observing; deliberate tracking closure; desktop pet popup: 300px/22px, chat name with folder fallback, status line, four named 44px actions with task-card ids, focus on open, work-style change in place with revision check and plan/unresolved locks, quit asks once, Escape/outside click close, "숨기기" tucks into the closer side as the arrow handle (falls back to hiding when no side is found), lost connection shows amber state and "다시 연결" only opens the chat (no send, no connect), management stays in the app card');
  return [image];
};
