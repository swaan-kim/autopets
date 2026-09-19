const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const origin = process.env.AUTOPETS_UI_URL || 'http://127.0.0.1:1420';
const screenshot = path.resolve(process.env.AUTOPETS_SCREENSHOT || '../../work/native-ui-manager.png');
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

async function mockBridge(page, initial) {
  await page.addInitScript(initial => {
    const state = structuredClone(initial);
    const calls = [];
    window.__uiTest = { state, calls };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'pet-0' }, currentWebview: { label: 'pet-0' } },
      transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (name, args) => {
        if (name === 'get_snapshot') return { ...structuredClone(state), now: Date.now() };
        if (name === 'plugin:event|listen') return 1;
        if (name.startsWith('plugin:event|')) return null;
        calls.push({ name, args });
        const session = state.sessions.find(session => session.id === args?.sessionId);
        if (name === 'configure_session') {
          if (!session || !args.completionCriterion.trim()) throw Error('invalid configuration');
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
  }, initial);
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
    assert.equal(await manager.getByRole('button', { name: '이 작업 연결하기' }).isEnabled(), false);
    await manager.getByLabel('어떤 결과가 나오면 끝난 건가요?').fill('의사결정용 보고서 초안 완성');
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
    checks.push('two-field onboarding requires a criterion, preserves 10-minute default, saves timer-off and exact slot binding');

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
    await pet.getByRole('button', { name: '근거 자료 조사 · 설정한 시간이 지났어요' }).click();
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
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ fixtureOnly: true, nativeWindowsTested: false, screenshots: [screenshot, path.join(path.dirname(screenshot), 'native-ui-overlay.png')], checks, pageErrors: errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
