const { openTasks } = require('./entry-navigation.cjs');
const assert = require('node:assert/strict');
const template = require('../../../packages/contracts/data/ui-pet.json');

const A = '11111111-2222-4333-8444-555555555555';
const B = '11111111-2222-4333-8444-666666666666';
const C = '77777777-2222-4333-8444-777777777777';

exports.runPetTaskReturnChecks = async ({ newPage, mockBridge, fixture, origin, checks }) => {
  const value = {
    ...structuredClone(fixture), sessions: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })),
    petLinks: [A, B].map((threadId, slot) => ({
      version: 1, target: { sourceId: 'codex-windows-local', threadId, cwd: 'C:/한글과 공백/원플로우' },
      slot, revision: 1, enabled: slot === 0, connected: slot === 0, profile: 'light', template, run: null,
    })),
  };
  const page = await newPage({ width: 992, height: 688 });
  await mockBridge(page, value); await page.goto(origin); await openTasks(page);
  const a = page.locator('.pet-card-0');
  const b = page.locator('.pet-card-1');
  const before = await page.evaluate(() => structuredClone(window.__uiTest.state.petLinks));
  await a.getByRole('button', { name: 'Codex 작업 열기', exact: true }).click();
  await a.getByText(/Codex에 열기를 요청했어요/).waitFor();
  await b.getByRole('button', { name: 'Codex 작업 열기', exact: true }).click();
  await b.getByText(/Codex에 열기를 요청했어요/).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_task')), [
    { name: 'open_pet_task', args: { target: value.petLinks[0].target, expectedRevision: 1 } },
    { name: 'open_pet_task', args: { target: value.petLinks[1].target, expectedRevision: 1 } },
  ]);
  assert.deepEqual(await page.evaluate(() => window.__uiTest.state.petLinks), before);

  const setA = async patch => {
    await page.evaluate(patch => {
      Object.assign(window.__uiTest.state.petLinks[0], patch);
      window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
    }, patch);
  };
  await setA({ run: { id: 'plan-a', profile: 'plan', state: 'waiting' } });
  await a.getByRole('button', { name: '계획 보러 가기', exact: true }).waitFor();
  assert.equal(await a.getByRole('button', { name: '같은 펫으로 새 일', exact: true }).count(), 0);
  assert.equal(await b.getByRole('button', { name: 'Codex 작업 열기', exact: true }).count(), 1);
  await a.getByRole('button', { name: '계획 보러 가기', exact: true }).click();
  await a.getByText(/Codex에 열기를 요청했어요/).waitFor();
  await setA({ run: { id: 'done-a', profile: 'light', state: 'complete' } });
  await a.getByRole('button', { name: '결과 보러 가기', exact: true }).waitFor();
  await a.getByRole('button', { name: '같은 펫으로 새 일', exact: true }).waitFor();
  assert.equal(await a.getByRole('button', { name: '다음 계획 요청 복사', exact: true }).count(), 0, 'new task replaces the redundant generic next-request action in the manager');
  for (const patch of [
    { enabled: false, connected: true, run: { id: 'done-a', profile: 'light', state: 'complete' } },
    { enabled: true, connected: false, run: { id: 'done-a', profile: 'light', state: 'complete' } },
    { enabled: true, connected: true, run: { id: 'done-a', profile: 'light', state: 'complete', trackingClosed: true } },
    { enabled: true, connected: true, run: { id: 'returned-a', profile: 'light', state: 'returned' } },
    { enabled: true, connected: true, run: { id: 'unknown-a', profile: 'light', state: 'unknown' } },
    { enabled: true, connected: true, run: { id: 'non-plan-a', profile: 'light', state: 'waiting' } },
  ]) {
    await setA(patch);
    await a.getByRole('button', { name: 'Codex 작업 열기', exact: true }).waitFor();
    assert.equal(await a.getByRole('button', { name: '같은 펫으로 새 일', exact: true }).count(), 0, 'only a connected, enabled, confirmed completion can start a fresh task');
  }
  await setA({ enabled: true, connected: true, run: { id: 'done-a', profile: 'light', state: 'complete' } });
  await page.evaluate(() => {
    window.__uiTest.state.connectionPath = '';
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  await a.getByRole('button', { name: 'Codex 작업 열기', exact: true }).waitFor();
  assert.equal(await a.getByRole('button', { name: '같은 펫으로 새 일', exact: true }).count(), 0, 'a disconnected snapshot does not promote a historical completion');
  await page.evaluate(connectionPath => {
    window.__uiTest.state.connectionPath = connectionPath;
    window.__uiTest.state.petLinks[0].run = null;
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  }, value.connectionPath);
  assert.deepEqual(await page.evaluate(() => window.__uiTest.state.petLinks[1]), before[1]);

  await page.evaluate(() => { window.__uiTest.holdPetReturn = true; window.__uiTest.calls.length = 0; });
  const aButton = a.getByRole('button', { name: 'Codex 작업 열기', exact: true });
  await aButton.click();
  await page.waitForFunction(() => typeof window.__uiTest.releasePetReturn === 'function');
  assert.equal(await a.locator('[data-testid="pet-task-return"] button').first().isDisabled(), true);
  await a.locator('[data-testid="pet-task-return"] button').first().evaluate(button => { button.click(); button.click(); });
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_task').length), 1);
  await page.evaluate(threadId => {
    const state = window.__uiTest.state;
    state.petLinks[0].target.threadId = threadId; state.petLinks[0].revision++;
    state.now = Date.now(); window.__uiTest.emitEvent('autopets://snapshot', structuredClone(state));
  }, C);
  await a.getByText(`채팅 · ${C.slice(-8)}`, { exact: true }).waitFor();
  await page.evaluate(() => { window.__uiTest.holdPetReturn = false; window.__uiTest.releasePetReturn(); });
  await page.waitForFunction(() => !document.querySelector('.pet-card-0 [data-testid="pet-task-return"] button').disabled);
  assert.equal(await a.getByText(/Codex에 열기를 요청했어요/).count(), 0, 'old target receipt must not label the replacement pet');
  assert.deepEqual(await page.evaluate(() => window.__uiTest.state.petLinks[1]), before[1]);

  await page.evaluate(() => { window.__uiTest.returnWrongTarget = true; });
  await a.getByRole('button', { name: 'Codex 작업 열기', exact: true }).click();
  await a.getByRole('button', { name: '작업 ID 복사', exact: true }).waitFor();
  await a.getByText(C, { exact: true }).waitFor();
  assert.equal(await a.getByText(/Codex에 열기를 요청했어요/).count(), 0);
  await a.getByRole('button', { name: '작업 ID 복사', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__uiTest.clipboard), C);
  await page.evaluate(() => { window.__uiTest.returnWrongTarget = false; window.__uiTest.returnError = 'fixture OS dispatch denied'; });
  await a.getByRole('button', { name: 'Codex 작업 열기', exact: true }).click();
  await a.getByRole('button', { name: '작업 ID 복사', exact: true }).waitFor();
  assert.equal(await a.getByText(/Codex에 열기를 요청했어요/).count(), 0);
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => /submit|send|create.*thread/.test(call.name))), false);

  const overlay = await newPage({ width: 420, height: 640 });
  await mockBridge(overlay, value); await overlay.goto(`${origin}/?pet=0`);
  await overlay.getByRole('button', { name: `${template.name} 메뉴`, exact: true }).click();
  await overlay.getByRole('button', { name: 'Codex 작업 열기', exact: true }).click();
  await overlay.getByText(/Codex에 열기를 요청했어요/).waitFor();
  assert.deepEqual(await overlay.evaluate(() => window.__uiTest.calls.find(call => call.name === 'open_pet_task').args), {
    target: value.petLinks[0].target, expectedRevision: 1,
  });
  await overlay.evaluate(() => {
    window.__uiTest.state.petLinks[0].run = { id: 'overlay-plan', profile: 'plan', state: 'waiting' };
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  await overlay.getByRole('button', { name: '계획 보러 가기', exact: true }).waitFor();
  await overlay.evaluate(() => {
    window.__uiTest.state.petLinks[0].run = { id: 'overlay-done', profile: 'light', state: 'complete' };
    window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state));
  });
  await overlay.getByRole('button', { name: '결과 보러 가기', exact: true }).waitFor();
  assert.equal(await overlay.getByRole('button', { name: '같은 펫으로 새 일', exact: true }).count(), 0, 'overlay without composer callback keeps existing next-request flow');
  assert.equal(await overlay.getByRole('button', { name: '다음 계획 요청 복사', exact: true }).isVisible(), false);
  await overlay.locator('.explicit-chat-help > summary').click();
  await overlay.getByRole('button', { name: '다음 계획 요청 복사', exact: true }).waitFor();
  checks.push('explicit pet return: contextual plan/result labels require current connected/enabled records, new-task action only for confirmed completion, A/B isolation and disconnected fallback, duplicate clicks/stale receipts suppressed, wrong dispatch exposes ID fallback, manager/overlay share exact-target navigation; fixture dispatch is not real navigation');
  await page.close(); await overlay.close();

  // Pet notice: one line under the pet that opens the chat with one click, once per state.
  const noticePet = await newPage({ width: 328, height: 600 });
  const finished = structuredClone(value); finished.petLinks[0].run = { id: 'notice-done', profile: 'light', state: 'complete' };
  await mockBridge(noticePet, finished); await noticePet.goto(`${origin}/?pet=0`);
  const notice = noticePet.locator('.pet-bubble');
  await notice.waitFor();
  assert.equal(await notice.getAttribute('data-tone'), 'done');
  assert.equal(await noticePet.locator('.floating-status').count(), 0, 'the notice takes the place of the small status');
  const fit = await noticePet.evaluate(() => { const pet = document.querySelector('.floating-pet').getBoundingClientRect(), bubble = document.querySelector('.pet-bubble').getBoundingClientRect(); return { inside: bubble.left >= pet.left - 1 && bubble.right <= pet.right + 1, bottom: bubble.bottom - pet.top, focus: document.activeElement?.closest('.pet-bubble') !== null }; });
  assert.ok(fit.inside && fit.bottom <= 226, `the notice fits the compact pet window: ${JSON.stringify(fit)}`);
  assert.equal(fit.focus, false, 'a notice never takes focus');
  await notice.getByRole('button', { name: /다 됐어요!/ }).click();
  await noticePet.locator('.floating-status').waitFor();
  assert.equal(await notice.count(), 0, 'an opened notice is not shown again');
  assert.deepEqual(await noticePet.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_task').map(call => call.args)), [{ target: value.petLinks[0].target, expectedRevision: 1 }]);
  const change = async run => noticePet.evaluate(run => { window.__uiTest.state.petLinks[0].run = run; window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state)); }, run);
  await change({ id: 'notice-plan', profile: 'plan', state: 'waiting' });
  await notice.waitFor();
  assert.equal(await notice.getAttribute('data-tone'), 'ask'); assert.ok((await notice.innerText()).includes('계획을 확인해 주세요'));
  await notice.getByRole('button', { name: '알림 닫기', exact: true }).click();
  await noticePet.locator('.floating-status').waitFor();
  await change({ id: 'notice-plan', profile: 'plan', state: 'waiting' });
  assert.equal(await notice.count(), 0, 'a closed notice stays closed for the same state');
  assert.equal(await noticePet.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_task').length), 1, 'closing does not open the chat');
  await change({ id: 'notice-plan', profile: 'plan', state: 'failed' });
  await notice.waitFor();
  assert.equal(await notice.getAttribute('data-tone'), 'error');
  await noticePet.evaluate(() => { window.__uiTest.returnError = 'fixture OS dispatch denied'; });
  await notice.getByRole('button', { name: /문제가 생겼어요/ }).click();
  await noticePet.getByRole('button', { name: '닫기', exact: true }).waitFor();
  await change({ id: 'notice-plan', profile: 'plan', state: 'working' });
  assert.equal(await notice.count(), 0, 'work in progress is not a notice');
  checks.push('pet notice: complete/plan/failed states show one line in the compact pet without taking focus; one click opens the exact chat, a failed open falls back to the card, and an opened or closed notice is not repeated for the same state');
  await noticePet.close();

  // Jobs an AI reported through MCP: the first pet works, asks, finishes and shows where to look.
  const jobId = '77777777-7777-4777-8777-777777777777';
  const job = (state, extra = {}) => ({ id: jobId, state, host: 'claude-code', title: '발표자료 만들기', petId: null, resultPath: null, createdAt: Date.now(), updatedAt: Date.now(), ...extra });
  const reportedState = { ...structuredClone(fixture), sessions: [], petLinks: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })), petJobs: [job('asking')] };
  const jobPet = await newPage({ width: 328, height: 600 });
  await mockBridge(jobPet, reportedState); await jobPet.goto(`${origin}/?pet=0`);
  const jobNotice = jobPet.locator('.pet-bubble');
  await jobNotice.waitFor();
  assert.equal(await jobNotice.getAttribute('data-tone'), 'ask');
  assert.ok((await jobNotice.innerText()).includes('질문이 있어요') && (await jobNotice.innerText()).includes('Claude Code'), 'the notice names the AI, since the chat itself is not known');
  const jobFit = await jobPet.evaluate(() => { const pet = document.querySelector('.floating-pet').getBoundingClientRect(), bubble = document.querySelector('.pet-bubble').getBoundingClientRect(); return bubble.left >= pet.left - 1 && bubble.right <= pet.right + 1; });
  assert.equal(jobFit, true, 'the longest AI name still fits the compact pet');
  await jobNotice.getByRole('button', { name: /질문이 있어요/ }).click();
  const list = jobPet.getByRole('region', { name: 'AI가 알려준 일' });
  await list.waitFor();
  assert.ok((await list.innerText()).includes('발표자료 만들기') && (await list.innerText()).includes('Claude Code · 질문에 답해 주세요'));
  await jobPet.keyboard.press('Escape');
  const report = async next => jobPet.evaluate(next => { window.__uiTest.state.now = Date.now(); window.__uiTest.state.petJobs = [next]; window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state)); }, next);
  await report(job('working'));
  await jobPet.locator('.floating-status').filter({ hasText: 'Claude Code에서 작업 중' }).waitFor();
  assert.equal(await jobNotice.count(), 0, 'working is shown by the pet, not by a notice');
  await report(job('done', { resultPath: 'C:\\fixture\\Documents\\AutoPets\\1112-slides' }));
  await jobNotice.waitFor();
  assert.equal(await jobNotice.getAttribute('data-tone'), 'done'); assert.ok((await jobNotice.innerText()).includes('결과 열기'));
  await jobNotice.getByRole('button', { name: /다 됐어요!/ }).click();
  await jobPet.locator('.floating-status').waitFor();
  assert.deepEqual(await jobPet.evaluate(() => window.__uiTest.calls.filter(call => call.name === 'open_pet_job_result').map(call => call.args)), [{ id: jobId }], 'only the job id is sent; the app opens the folder it already holds');
  assert.equal(await jobPet.evaluate(() => window.__uiTest.calls.some(call => /submit|send|create.*thread|open_pet_task/.test(call.name))), false);
  await report(job('failed'));
  await jobNotice.waitFor();
  assert.equal(await jobNotice.getAttribute('data-tone'), 'error');
  // Only the newest job speaks: an older finished job that was never opened stays quiet while a newer
  // one works or waits, and does not come back after the newer result is opened.
  const older = { ...job('done'), id: '88888888-4888-4888-8888-888888888888', title: '예전 일', host: 'codex', updatedAt: Date.now() - 60_000 };
  const reportAll = async jobs => jobPet.evaluate(jobs => { window.__uiTest.state.now = Date.now(); window.__uiTest.state.petJobs = jobs; window.__uiTest.emitEvent('autopets://snapshot', structuredClone(window.__uiTest.state)); }, jobs);
  await reportAll([job('working'), older]);
  await jobPet.locator('.floating-status').filter({ hasText: 'Claude Code에서 작업 중' }).waitFor();
  assert.equal(await jobNotice.count(), 0, 'the older "done" does not speak over the job in progress');
  await jobPet.getByRole('button', { name: /작업 카드 열기/ }).click();
  const card = jobPet.locator('.pet-quick-card');
  await card.waitFor();
  assert.ok((await card.innerText()).includes('Claude Code에서 작업 중'));
  assert.equal(/작업 연결 전|채팅 연결 대기|전달된 단계 없음/u.test(await card.innerText()), false, 'the old link wording is not shown next to a reported job');
  await jobPet.keyboard.press('Escape');
  await reportAll([job('asking', { updatedAt: Date.now() + 1 }), older]);
  await jobNotice.waitFor();
  assert.equal(await jobNotice.getAttribute('data-tone'), 'ask');
  await jobNotice.getByRole('button', { name: '알림 닫기' }).click();
  await jobPet.locator('.floating-status').filter({ hasText: 'Claude Code에서 답을 기다려요' }).waitFor();
  assert.equal(await jobNotice.count(), 0, 'closing the newest notice does not bring the older one back');
  await jobPet.close();
  const jobManager = await newPage({ width: 992, height: 688 });
  await mockBridge(jobManager, { ...reportedState, petJobs: [job('done', { resultPath: 'C:\\fixture\\Documents\\AutoPets\\1112-slides' })] });
  await jobManager.goto(origin);
  await jobManager.locator('.app-header nav').getByRole('button', { name: '내 작업', exact: true }).click();
  const managerList = jobManager.getByRole('region', { name: 'AI가 알려준 일' });
  await managerList.waitFor();
  assert.ok((await managerList.innerText()).includes('Claude Code · 완료'));
  assert.equal(await jobManager.getByText('아직 맡긴 일이 없어요.', { exact: true }).count(), 0, 'a reported job is a task the user gave');
  await managerList.getByRole('button', { name: '결과 열기 →', exact: true }).click();
  await jobManager.waitForFunction(() => window.__uiTest.calls.some(call => call.name === 'open_pet_job_result'));
  checks.push('reported jobs: asking, working, done and failed reports change the first pet and its notice, name the AI instead of a chat, list the job in the pet card and in My tasks, and open the result by job id only');
  await jobManager.close();
};
