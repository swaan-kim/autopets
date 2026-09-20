const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const origin = process.env.AUTOPETS_UI_URL || 'http://127.0.0.1:1420';
const screenshot = path.resolve(process.env.AUTOPETS_SCREENSHOT || path.join(__dirname, '../work/native-ui-manager.png'));
const now = Date.now();
const base = {
  cwd: 'C:/UI fixture only', unread: false, lastSeen: now, connection: 'observed',
  completionCriterion: '', interventionMode: 'when-needed', activity: 'idle',
  planSteps: [], planUpdatedAt: null, turnStartedAt: now - 660000, turnEndedAt: null,
  elapsedAlertMinutes: 10, attention: null, canOpenTask: false,
};
const fixture = {
  sessions: [
    { ...base, id: 'fixture-research-id', label: '근거 자료 조사', state: 'working', activity: 'research', lastTool: 'web_search', completionCriterion: '근거 링크를 포함한 비교 보고서 완성', planUpdatedAt: now,
      planSteps: [{ step: '자료 조사', status: 'completed' }, { step: '실제 전달된 <b>계획</b> 비교', status: 'in_progress' }],
      attention: { id: 'elapsed-actual-id', kind: 'elapsed', summary: '관측 시간이 설정한 10분을 지났어요.', createdAt: now, snoozedUntil: null } },
    { ...base, id: 'fixture-writing-id', label: '보고서 작성', state: 'working', activity: 'writing', lastTool: null },
    { ...base, id: 'fixture-done-id', label: 'Notion 정리', state: 'done', activity: 'idle', lastTool: 'mcp__notion__update_page', unread: true, turnEndedAt: now - 180000, completionCriterion: '검토 가능한 페이지 저장', planSteps: [{ step: '페이지 저장', status: 'completed' }], planUpdatedAt: now - 180000 },
  ],
  slots: [{ index: 0, sessionId: 'fixture-research-id' }, { index: 1, sessionId: null }, { index: 2, sessionId: 'fixture-done-id' }],
  connectionPath: 'C:/UI fixture only/connection.json', capabilities: { tokenUsage: 'unavailable', taskReturn: 'manual' }, now,
};

const unverified = { inputAssistance: false, modelSwitch: false, reasoningSwitch: false, contextSync: false, tokenUsage: false, additionalRepair: false, verification: 'unverified' };
const blankContext = { goal: '', outputFormat: '', constraints: [], decisions: [], remaining: [] };
const assistanceFixture = {
  preferences: { enabled: false, workStyle: 'auto', routingMode: 'auto', fixedModel: null, allowedModels: [], allowEscalation: false, revision: 0 },
  capabilities: { codex: unverified, chatgpt: unverified },
  tasks: ['fixture-research-id', 'fixture-writing-id'].map((chatId, index) => ({
    identity: { provider: 'codex', accountId: `fixture-account-${index}`, chatId }, enabled: true,
    context: { ...blankContext, goal: index ? '보고서 작성' : '근거 자료 조사', constraints: [index ? '작성 채팅만의 조건' : '조사 채팅만의 조건'] },
    revision: 1, updatedAt: now, recipeId: index ? 'document' : 'research',
    assistance: { status: 'pending', requestedModel: 'fixture-requested-model', appliedModel: null, reason: '설정을 저장했어요. 전달은 아직 확인되지 않았어요.', injectionBytes: 0, updatedAt: now },
    quality: { status: 'unchecked', findings: [], repairCount: 0 },
  })),
};

async function mockBridge(page, initial, initialAssistance = assistanceFixture) {
  await page.addInitScript(({ initial, initialAssistance }) => {
    const state = structuredClone(initial);
    const assistance = structuredClone(initialAssistance);
    const calls = [];
    window.__uiTest = { state, assistance, calls };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'pet-0' }, currentWebview: { label: 'pet-0' } },
      transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (name, args) => {
        if (name === 'get_snapshot') return { ...structuredClone(state), now: Date.now() };
        if (name === 'get_assistance') return structuredClone(assistance);
        if (name === 'plugin:event|listen') return 1;
        if (name.startsWith('plugin:event|')) return null;
        calls.push({ name, args });
        const session = state.sessions.find(session => session.id === args?.sessionId);
        const task = assistance.tasks.find(task => JSON.stringify(task.identity) === JSON.stringify(args?.identity));
        if (name === 'save_preferences') {
          Object.assign(assistance.preferences, args.preferences, { revision: assistance.preferences.revision + 1 });
          for (const item of assistance.tasks) item.assistance.status = assistance.preferences.enabled && item.enabled ? 'pending' : 'off';
        }
        if (name === 'set_chat_assistance') {
          if (!task) throw Error('unknown identity');
          task.enabled = args.enabled;
          task.assistance.status = args.enabled ? 'pending' : 'off';
        }
        if (name === 'save_task_context') {
          if (!task || task.revision !== args.expectedRevision) throw Error('context revision conflict');
          task.context = args.context;
          task.revision++;
          task.assistance.status = 'pending';
        }
        if (name === 'delete_task_context' || name === 'delete_all_contexts') {
          for (const item of name === 'delete_all_contexts' ? assistance.tasks : [task]) {
            if (!item) throw Error('unknown identity');
            item.context = { goal: '', outputFormat: '', constraints: [], decisions: [], remaining: [] };
            item.revision++;
            item.assistance.status = item.enabled ? 'pending' : 'off';
          }
        }
        if (name === 'configure_session') {
          if (!session) throw Error('invalid configuration');
          Object.assign(session, { completionCriterion: args.completionCriterion, interventionMode: args.interventionMode, elapsedAlertMinutes: args.elapsedAlertMinutes });
        }
        if (name === 'assign_session') {
          if (!session || state.slots.some(slot => slot.sessionId === args.sessionId)) throw Error('invalid assignment');
          state.slots[args.slot].sessionId = args.sessionId;
        }
        if (name === 'acknowledge_attention' || name === 'snooze_attention') {
          if (session?.attention?.id !== args.attentionId) throw Error('attention/session mismatch');
          if (name === 'acknowledge_attention') session.attention = null;
          else session.attention.snoozedUntil = Date.now() + args.minutes * 60000;
        }
        if (name === 'acknowledge') session.unread = false;
        if (/approval|pause|stop|open_task/.test(name)) throw Error('unsupported operation called');
        return null;
      },
    };
  }, { initial, initialAssistance });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const checks = [];
  const newPage = async (viewport = { width: 1120, height: 880 }) => {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message));
    return page;
  };
  try {
    const empty = await newPage();
    await empty.goto(origin);
    await empty.locator('.pet-grid').waitFor();
    assert.equal(await empty.locator('.pet-card').count(), 3);
    assert.equal(await empty.getByRole('button', { name: '＋ 작업 연결' }).first().isEnabled(), false);
    await empty.getByText('브라우저 미리보기 · 연결 없음', { exact: true }).waitFor();
    await empty.getByRole('button', { name: '연결 안내 →' }).click();
    await empty.getByRole('heading', { name: 'Codex와 연결하기' }).waitFor();
    assert.equal(await empty.locator('input[type=checkbox]').count(), 0);
    assert.equal(await empty.getByRole('button', { name: /허용|거절|승인/ }).count(), 0);
    await empty.getByRole('button', { name: '자동 도움', exact: true }).click();
    await empty.getByText('브라우저 미리보기 · 연결 없음. 설정은 저장되지 않아요.', { exact: true }).waitFor();
    assert.equal(await empty.getByRole('button', { name: '추천 설정으로 켜기' }).isEnabled(), false);
    checks.push('empty/offline UI has no fabricated activity or approval controls');

    const missing = await newPage();
    await missing.route('**/assets/pet/sprite.png', route => route.abort());
    await missing.goto(origin);
    await missing.getByRole('img', { name: '펫 이미지 없음' }).first().waitFor();
    assert.equal(await missing.locator('.pet-sprite').count(), 0);
    checks.push('missing PNG produces an explicit image placeholder');

    const manager = await newPage();
    await mockBridge(manager, fixture);
    await manager.goto(origin);
    await manager.locator('.pet-sprite').first().waitFor();
    assert.equal(await manager.locator('.sprite-research').count(), 1);
    await manager.getByRole('button', { name: '＋ 작업 연결' }).click();
    await manager.locator('.picker-row').filter({ hasText: '보고서 작성' }).click();
    assert.equal(await manager.getByRole('button', { name: '이 작업 연결하기' }).isEnabled(), true);
    await manager.getByLabel('완료 기준 · 선택사항').fill('의사결정용 보고서 초안 완성');
    await manager.getByRole('radio', { name: '계획 단계가 바뀔 때도' }).check();
    await manager.locator('.time-settings summary').click();
    assert.equal(await manager.getByRole('spinbutton', { name: '시간 알림 간격 (분)' }).inputValue(), '10');
    await manager.getByRole('checkbox', { name: '일정 시간이 지나면 알림 받기' }).uncheck();
    await manager.getByRole('button', { name: '이 작업 연결하기' }).click();
    await manager.getByRole('dialog').waitFor({ state: 'hidden' });
    await manager.locator('.pet-card-1 h3').filter({ hasText: '보고서 작성' }).waitFor();
    const configured = await manager.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'configure_session' || call.name === 'assign_session'));
    assert.deepEqual(configured, [
      { name: 'configure_session', args: { sessionId: 'fixture-writing-id', completionCriterion: '의사결정용 보고서 초안 완성', interventionMode: 'milestones', elapsedAlertMinutes: null } },
      { name: 'assign_session', args: { slot: 1, sessionId: 'fixture-writing-id' } },
    ]);
    assert.equal(await manager.locator('.pet-card .card-button').count(), 3);
    assert.equal(await manager.getByRole('button', { name: '＋ 작업 연결' }).count(), 0);
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await manager.screenshot({ path: screenshot, fullPage: true });
    checks.push('manual binding makes the criterion optional, preserves 10-minute default, saves timer-off and exact slot binding');

    await manager.locator('.pet-card-1').getByRole('button', { name: '작업 카드 열기 →' }).click();
    await manager.getByText('계획이 아직 전달되지 않았어요.', { exact: false }).waitFor();
    assert.equal(await manager.locator('.plan-list').count(), 0);
    await manager.getByText('측정 불가', { exact: true }).waitFor();
    await manager.getByRole('button', { name: '닫기', exact: true }).click();
    await manager.locator('.pet-card-0').getByRole('button', { name: '작업 카드 열기 →' }).click();
    await manager.getByText('실제 전달된 <b>계획</b> 비교', { exact: true }).waitFor();
    assert.equal(await manager.locator('.plan-list b').count(), 0);
    await manager.getByRole('button', { name: 'Codex 작업 찾기 ↗' }).click();
    await manager.locator('.return-details dd').filter({ hasText: 'fixture-research-id' }).waitFor();
    assert.equal(await manager.locator('a[href^="codex:"]').count(), 0);
    await manager.getByRole('button', { name: '10분 뒤 다시 알림' }).click();
    await manager.locator('.attention-card').waitFor({ state: 'hidden' });
    const snoozed = await manager.evaluate(() => ({ state: window.__uiTest.state.sessions[0], calls: window.__uiTest.calls }));
    assert.equal(snoozed.state.state, 'working');
    assert.ok(snoozed.calls.some(call => call.name === 'snooze_attention' && call.args.sessionId === 'fixture-research-id' && call.args.attentionId === 'elapsed-actual-id' && call.args.minutes === 10));
    checks.push('only actual plan text is rendered, token unavailable, task return stays manual, snooze does not pause work');

    await manager.getByRole('button', { name: '닫기', exact: true }).click();
    await manager.getByRole('button', { name: '자동 도움', exact: true }).click();
    await manager.getByRole('button', { name: '추천 설정으로 켜기' }).click();
    await manager.getByText('설정을 저장했어요. 다음 메시지부터 전달을 시도해요.', { exact: true }).waitFor();
    assert.equal(await manager.getByRole('checkbox', { name: '자동 도움', exact: true }).isChecked(), true);
    await manager.getByRole('radio', { name: /^빠르게/ }).check();
    await manager.getByLabel('모델 선택', { exact: true }).selectOption('fixed');
    await manager.getByText('상세 설정', { exact: true }).click();
    await manager.getByLabel('고정할 모델 ID', { exact: true }).fill('fixture-model');
    await manager.getByLabel('허용할 모델 ID', { exact: true }).fill('fixture-model\nfixture-other-model');
    await manager.getByRole('button', { name: '설정 저장', exact: true }).click();
    const prefs = await manager.evaluate(() => window.__uiTest.assistance.preferences);
    assert.equal(prefs.workStyle, 'fast');
    assert.equal(prefs.routingMode, 'fixed');
    assert.equal(prefs.allowEscalation, false);
    assert.deepEqual(prefs.allowedModels, ['fixture-model', 'fixture-other-model']);
    await manager.getByLabel('채팅 선택', { exact: true }).selectOption(JSON.stringify(['codex', 'fixture-account-0', 'fixture-research-id']));
    await manager.getByTestId('assistance-state').filter({ hasText: '다음 메시지 전달 대기' }).waitFor();
    assert.equal(await manager.getByTestId('applied-model').textContent(), '확인되지 않음');
    await manager.getByText('이 채팅에 저장한 조건', { exact: true }).click();
    assert.equal(await manager.getByLabel('중요한 조건', { exact: true }).inputValue(), '조사 채팅만의 조건');
    await manager.getByLabel('목표', { exact: true }).fill('가'.repeat(342));
    await manager.getByText('목표가 너무 길어요. 핵심만 남겨주세요.', { exact: true }).waitFor();
    assert.equal(await manager.getByRole('button', { name: '기록 저장', exact: true }).isEnabled(), false);
    await manager.getByLabel('목표', { exact: true }).fill('근거 자료 조사');
    await manager.getByLabel('결과 형식', { exact: true }).fill('가'.repeat(171));
    await manager.getByText('결과 형식을 조금 더 짧게 적어주세요.', { exact: true }).waitFor();
    await manager.getByLabel('결과 형식', { exact: true }).fill('');
    await manager.getByLabel('중요한 조건', { exact: true }).fill(Array.from({ length: 13 }, (_, i) => `조건 ${i}`).join('\n'));
    await manager.getByText('중요한 조건은 12개까지 저장할 수 있어요.', { exact: true }).waitFor();
    await manager.getByLabel('중요한 조건', { exact: true }).fill('가'.repeat(171));
    await manager.getByText('중요한 조건의 한 항목이 너무 길어요. 짧게 나눠주세요.', { exact: true }).waitFor();
    await manager.getByLabel('중요한 조건', { exact: true }).fill(Array(7).fill('가'.repeat(160)).join('\n'));
    await manager.getByText('저장할 기록이 너무 많아요. 현재 작업에 필요한 내용만 남겨주세요.', { exact: true }).waitFor();
    assert.equal(await manager.getByRole('button', { name: '기록 저장', exact: true }).isEnabled(), false);
    assert.equal(await manager.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'save_task_context').length), 0);
    checks.push('Korean context byte and item limits show local explanations before invoking storage');
    await manager.getByLabel('중요한 조건', { exact: true }).fill('수정한 조건\n출처 확인');
    await manager.getByRole('button', { name: '기록 저장', exact: true }).click();
    const records = await manager.evaluate(() => window.__uiTest.assistance.tasks);
    assert.deepEqual(records[0].context.constraints, ['수정한 조건', '출처 확인']);
    assert.deepEqual(records[1].context.constraints, ['작성 채팅만의 조건']);
    await manager.getByRole('button', { name: '이번 채팅 도움 끄기', exact: true }).click();
    await manager.getByTestId('assistance-state').filter({ hasText: '자동 도움 꺼짐' }).waitFor();
    assert.equal(await manager.getByLabel('중요한 조건', { exact: true }).inputValue(), '수정한 조건\n출처 확인');
    await manager.getByRole('button', { name: '이 채팅 기록 삭제', exact: true }).click();
    await manager.getByRole('button', { name: '삭제 확인', exact: true }).click();
    await manager.waitForFunction(() => window.__uiTest.assistance.tasks[0].context.constraints.length === 0);
    assert.equal(await manager.evaluate(() => window.__uiTest.assistance.tasks[1].context.constraints[0]), '작성 채팅만의 조건');
    await manager.getByText('연결별 지원 상태', { exact: true }).click();
    assert.equal(await manager.getByText('모델 자동 변경 · 미검증', { exact: true }).count(), 2);
    await manager.screenshot({ path: path.join(path.dirname(screenshot), 'native-ui-assistance.png'), fullPage: true });
    await manager.getByRole('button', { name: '모든 채팅 기록 삭제', exact: true }).click();
    await manager.getByRole('button', { name: '모든 기록 삭제 확인', exact: true }).click();
    assert.ok(await manager.evaluate(() => window.__uiTest.assistance.tasks.every(task => !task.context.goal && !task.context.constraints.length)));
    checks.push('opt-in and preferences stay distinct from confirmed delivery; exact account/chat edits, off and deletion remain isolated');

    const emptyPet = await newPage({ width: 380, height: 600 });
    await mockBridge(emptyPet, { ...fixture, slots: [{ index: 0, sessionId: null }, { index: 1, sessionId: null }, { index: 2, sessionId: null }] });
    await emptyPet.goto(`${origin}/?pet=0`);
    await emptyPet.getByRole('button', { name: '펫 메뉴', exact: true }).click();
    assert.equal(await emptyPet.getByRole('button', { name: '이번 채팅 도움 끄기', exact: true }).count(), 0);
    await emptyPet.getByRole('button', { name: '도움 설정 열기', exact: true }).click();
    await emptyPet.getByRole('button', { name: '펫 모두 숨기기', exact: true }).click();
    await emptyPet.getByRole('button', { name: 'AutoPets 종료', exact: true }).click();
    assert.ok(await emptyPet.evaluate(() => window.__uiTest.calls.some(call => call.name === 'quit_app')));
    assert.ok(await emptyPet.evaluate(() => window.__uiTest.calls.some(call => call.name === 'set_pets_visible' && call.args.visible === false)));
    checks.push('unbound pet exposes assistance, hide and quit without inventing a chat identity');

    const ambiguousPet = await newPage({ width: 380, height: 600 });
    const ambiguous = structuredClone(assistanceFixture);
    ambiguous.tasks.push({ ...structuredClone(ambiguous.tasks[0]), identity: { ...ambiguous.tasks[0].identity, accountId: 'another-account' } });
    await mockBridge(ambiguousPet, fixture, ambiguous);
    await ambiguousPet.goto(`${origin}/?pet=0`);
    await ambiguousPet.getByRole('button', { name: '펫 메뉴', exact: true }).click();
    assert.equal(await ambiguousPet.getByRole('button', { name: '이번 채팅 도움 끄기', exact: true }).count(), 0);
    checks.push('ambiguous native-session/account matches never guess an assistance identity');

    const overlays = [];
    for (let index = 0; index < 3; index++) {
      const pet = await newPage({ width: 380, height: 600 });
      const state = structuredClone(fixture);
      state.slots[1].sessionId = 'fixture-writing-id';
      await mockBridge(pet, state);
      await pet.goto(`${origin}/?pet=${index}`);
      await pet.getByText(state.sessions[index].label, { exact: true }).waitFor();
      overlays.push(pet);
    }
    assert.equal(await overlays[1].locator('.sprite-writing').count(), 1);
    const pet = overlays[0];
    await pet.getByRole('button', { name: '근거 자료 조사 · 도움 설정 열기' }).click();
    assert.ok(await pet.evaluate(() => window.__uiTest.calls.some(call => call.name === 'show_manager' && call.args.section === 'assistance' && call.args.sessionId === 'fixture-research-id')));
    await pet.getByRole('button', { name: '펫 메뉴', exact: true }).click();
    await pet.getByRole('button', { name: '알림 확인', exact: true }).waitFor();
    await pet.screenshot({ path: path.join(path.dirname(screenshot), 'native-ui-overlay.png') });
    await pet.getByRole('button', { name: '알림 확인', exact: true }).click();
    await pet.locator('.attention-card').waitFor({ state: 'hidden' });
    const acknowledged = await pet.evaluate(() => ({ state: window.__uiTest.state.sessions[0], calls: window.__uiTest.calls }));
    assert.equal(acknowledged.state.state, 'working');
    assert.ok(acknowledged.calls.some(call => call.name === 'acknowledge_attention' && call.args.attentionId === 'elapsed-actual-id' && call.args.sessionId === 'fixture-research-id'));
    await pet.evaluate(() => { window.__uiTest.state.sessions[0].connection = 'unknown'; });
    await pet.locator('.floating-status.unknown').waitFor();
    assert.equal(await pet.locator('.sprite-research').count(), 0);
    assert.equal(await pet.locator('.sprite-paused').count(), 1);
    assert.equal(await pet.getByRole('button', { name: /허용|거절|일시정지/ }).count(), 0);
    checks.push('three overlays bind independently; exact attention acknowledgement preserves work; unknown state stops activity animation');
    await pet.evaluate(() => {
      const session = window.__uiTest.state.sessions[0];
      session.connection = 'observed';
      session.activity = 'tool';
      session.lastTool = 'mcp__notion__update_page';
      session.attention = { id: 'tool-error-actual-id', kind: 'tool-error', summary: 'Notion 도구가 오류 응답을 반환했어요.', createdAt: Date.now(), snoozedUntil: null };
    });
    await pet.locator('.floating-status.tool-error').waitFor();
    await pet.getByText('전체 작업이 실패한 것은 아니며,', { exact: false }).waitFor();
    assert.equal(await pet.locator('.notion-chip').count(), 1);
    await pet.getByRole('button', { name: '알림 확인', exact: true }).click();
    await pet.locator('.attention-card').waitFor({ state: 'hidden' });
    assert.equal(await pet.evaluate(() => window.__uiTest.state.sessions[0].state), 'working');
    checks.push('structured tool-error is distinct from whole-task failure and displays the observed Notion tool');

    const compact = await newPage({ width: 1120, height: 1120 });
    const compactAssistance = structuredClone(assistanceFixture);
    compactAssistance.preferences.enabled = true;
    await mockBridge(compact, fixture, compactAssistance);
    await compact.goto(origin);
    await compact.getByRole('button', { name: '자동 도움', exact: true }).click();
    await compact.getByRole('radio', { name: /^자동/ }).waitFor();
    assert.equal(await compact.locator('.assistance-details[open]').count(), 0);
    assert.equal(await compact.getByLabel('모델 선택', { exact: true }).inputValue(), 'auto');
    await compact.evaluate(() => {
      const label = document.querySelector('.connection-pill');
      if (label) label.textContent = 'UI 검수용 · 시연 데이터 · 실제 연결 미검증';
    });
    await compact.screenshot({ path: path.join(path.dirname(screenshot), 'native-ui-assistance-compact.png'), fullPage: true, animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ fixtureOnly: true, nativeWindowsTested: false, screenshots: [screenshot, path.join(path.dirname(screenshot), 'native-ui-assistance.png'), path.join(path.dirname(screenshot), 'native-ui-assistance-compact.png'), path.join(path.dirname(screenshot), 'native-ui-overlay.png')], checks, pageErrors: errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
