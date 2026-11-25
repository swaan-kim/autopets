const assert = require('node:assert/strict');
const path = require('node:path');
const catalog = require('../../../packages/contracts/data/pet-catalog.json');
const templates = require('../../../packages/contracts/data/roles.json');
const { chooseRole } = require('./entry-navigation.cjs');

// 복습 도우미 on the desktop pet (synthetic bridge): the once-a-day bubble, the due badge, the menu at the
// top of its popup, the panel after a drop on a Codex window. A press sends the request into the pet's own
// chat once (`send_review_request`: 보냈어요 → 시작됐어요); a bubble, a menu or a drop alone sends nothing,
// and a failed send is typed in instead ("보내기만 누르세요"). No quiz runs on the pet.
// In the app: the 복습 도우미 detail → 문제 묶음 → one batch, which sends to the chat it names (`send_review_batch`).
exports.runReviewPetChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const reviewTemplate = catalog.find(entry => entry.id === 'review-helper').template;
  const link = (template, connected = true) => ({
    version: 1, target: { sourceId: 'codex-windows-local', threadId: '11111111-2222-4333-8444-555555555555', cwd: 'C:/UI fixture only' },
    slot: 0, revision: 1, enabled: true, connected, profile: 'light', template, run: null,
  });
  const state = (template, review, connected = true) => ({
    ...structuredClone(fixture), sessions: [], slots: [0, 1, 2].map(index => ({ index, sessionId: null })),
    petLinks: [link(template, connected)], review,
  });
  const calls = (page, name) => page.evaluate(name => window.__uiTest.calls.filter(call => call.name === name).map(call => call.args), name);
  const status = page => page.locator('.floating-pet .floating-status').first();
  const chat = '「UI fixture only · 55555555」';

  // Once a day: "복습할 때예요" with 시작. The app records it was shown.
  const pet = await newPage({ width: 252, height: 404 });
  await mockBridge(pet, state(reviewTemplate, { due: 2, total: 5, batches: 2, notifiedToday: false })); await pet.goto(`${origin}/?pet=0`);
  const due = pet.locator('[data-agent-id="task-card.review-due"]');
  await due.waitFor();
  assert.equal((await due.innerText()).replace(/\s+/g, ' ').trim(), `복습할 때예요 2개 → ${chat} 시작 나중에`, 'the chat it goes to is named before the press');
  assert.equal((await calls(pet, 'send_review_request')).length, 0, 'the bubble alone sends nothing');
  assert.equal((await calls(pet, 'mark_review_notice')).length, 1);
  assert.equal(await pet.locator('.pet-review-badge').innerText(), '2');
  assert.equal(await pet.locator('.pet-hit').getAttribute('aria-label'), `${reviewTemplate.name} 메뉴 · 복습 2개`);
  assert.ok((await calls(pet, 'set_pet_expanded')).some(args => args.notice === true && args.expanded === false), 'the bubble uses the small notice window');
  if (screenshotDir) { await pet.waitForTimeout(400); await pet.screenshot({ path: path.join(screenshotDir, 'review-pet-due.png') }); }
  await due.getByRole('button', { name: '시작', exact: true }).click();
  assert.deepEqual(await calls(pet, 'send_review_request'), [{ kind: 'review', expectedRevision: 1 }]);
  await status(pet).getByText(`${chat}에 보냈어요`, { exact: true }).waitFor();
  await status(pet).getByText('시작됐어요', { exact: true }).waitFor();
  assert.equal(await due.count(), 0);

  // The popup: 복습하기 N first, then 문제 내기 / 쉽게 설명 / 문제 묶음 N, above the usual popup.
  await pet.setViewportSize({ width: 328, height: 600 });
  await pet.locator('.pet-hit').click();
  const popup = pet.locator('.pet-popup');
  await popup.waitFor();
  const menu = popup.locator('[data-agent-id="task-card.review-menu"]');
  assert.deepEqual(await menu.locator('button').allInnerTexts(), ['복습하기 2', '문제 내기', '쉽게 설명', '문제 묶음 2']);
  assert.equal(await menu.locator('[data-agent-id="task-card.review-saved"]').innerText(), '문제 묶음 2', 'the existing id is kept');
  assert.equal(await popup.evaluate(node => node.firstElementChild?.getAttribute('data-agent-id')), 'task-card.review-menu', 'the menu is at the very top');
  for (const id of ['root', 'open-chat', 'open-app', 'hide', 'quit', 'profile']) assert.equal(await pet.locator(`[data-agent-id="task-card.${id}"]`).count(), 1, `task-card.${id} kept`);
  if (screenshotDir) await popup.screenshot({ path: path.join(screenshotDir, 'review-pet-popup.png') });
  await menu.getByRole('button', { name: '문제 묶음 2', exact: true }).click();
  assert.ok((await calls(pet, 'show_manager')).some(args => args.section === 'review'));
  // A double press sends once.
  await pet.evaluate(() => { window.__uiTest.sendDelay = 300; });
  await menu.getByRole('button', { name: '문제 내기', exact: true }).evaluate(button => { button.click(); button.click(); });
  await popup.waitFor({ state: 'detached' });
  await pet.evaluate(() => { window.__uiTest.sendDelay = 0; });
  assert.deepEqual((await calls(pet, 'send_review_request')).slice(1), [{ kind: 'quiz', expectedRevision: 1 }], 'one press, one send');
  await status(pet).getByText(`${chat}에 보냈어요`, { exact: true }).waitFor();

  // Dragging over Codex says "여기에 놓기"; a drop there opens 문제 내기 / 쉽게 설명. Esc closes it.
  await pet.setViewportSize({ width: 252, height: 404 });
  await pet.evaluate(() => window.__uiTest.emitEvent('autopets://pet-drag-over', { label: 'pet-0', codex: true }));
  await status(pet).getByText('여기에 놓기', { exact: true }).waitFor();
  await pet.evaluate(() => window.__uiTest.emitEvent('autopets://pet-drag-end', { label: 'pet-0', edge: null, codex: true }));
  const drop = pet.locator('[data-agent-id="task-card.review-drop"]');
  await drop.waitFor();
  assert.deepEqual(await drop.locator('button').allInnerTexts(), ['문제 내기', '쉽게 설명']);
  assert.equal(await drop.locator('[data-agent-id="task-card.review-drop-chat"]').innerText(), `→ ${chat}`);
  assert.equal((await calls(pet, 'send_review_request')).length, 2, 'a drop alone sends nothing');
  if (screenshotDir) { await pet.waitForTimeout(400); await pet.screenshot({ path: path.join(screenshotDir, 'review-pet-drop.png') }); }
  await pet.keyboard.press('Escape');
  await drop.waitFor({ state: 'detached' });
  // An edge drop docks instead; another pet's drop is not this pet's.
  await pet.evaluate(() => window.__uiTest.emitEvent('autopets://pet-drag-end', { label: 'pet-1', edge: null, codex: true }));
  await pet.waitForTimeout(150);
  assert.equal(await drop.count(), 0);
  await pet.evaluate(() => window.__uiTest.emitEvent('autopets://pet-drag-end', { label: 'pet-0', edge: null, codex: true }));
  // Codex cannot take it (an old Codex): typed into the same chat instead, and the pet says so.
  await pet.evaluate(() => { window.__uiTest.sendFallback = 'codex-queue-unsupported'; });
  await drop.getByRole('button', { name: '쉽게 설명', exact: true }).click();
  assert.deepEqual((await calls(pet, 'send_review_request')).at(-1), { kind: 'explain', expectedRevision: 1 });
  await drop.waitFor({ state: 'detached' });
  await status(pet).getByText('입력칸에 넣었어요 · 보내기만 누르세요', { exact: true }).waitFor();
  assert.match(await status(pet).getAttribute('title'), /^이 Codex 버전은 바로 보내기를 지원하지 않아요\./);
  // Pressed again right away: the app refuses the repeat and the pet says so; nothing new is sent.
  await pet.evaluate(() => { window.__uiTest.sendFallback = null; window.__uiTest.sendError = 'already-delivered'; });
  await pet.evaluate(() => window.__uiTest.emitEvent('autopets://pet-drag-end', { label: 'pet-0', edge: null, codex: true }));
  await drop.getByRole('button', { name: '쉽게 설명', exact: true }).click();
  await drop.getByText('방금 보낸 요청이에요. Codex 채팅을 확인해 주세요.', { exact: true }).waitFor();
  await pet.evaluate(() => { window.__uiTest.sendError = null; });
  await pet.close();

  // A disconnected pet fills nothing and shows the existing reconnect guide.
  const lost = await newPage({ width: 252, height: 404 });
  await mockBridge(lost, state(reviewTemplate, { due: 0, total: 0, batches: 0, notifiedToday: true }, false)); await lost.goto(`${origin}/?pet=0`);
  await lost.locator('.pet-hit').waitFor();
  assert.equal(await lost.locator('[data-agent-id="task-card.review-due"]').count(), 0, 'no bubble without due cards');
  assert.equal(await lost.locator('.pet-review-badge').count(), 0);
  await lost.evaluate(() => window.__uiTest.emitEvent('autopets://pet-drag-end', { label: 'pet-0', edge: null, codex: true }));
  const lostDrop = lost.locator('[data-agent-id="task-card.review-drop"]');
  await lostDrop.getByText('“다시 연결”을 누르면 채팅을 열고 다시 이어요.', { exact: true }).waitFor();
  assert.equal(await lostDrop.getByRole('button', { name: '문제 내기' }).count(), 0);
  await lost.keyboard.press('Escape');
  await lost.setViewportSize({ width: 328, height: 600 });
  await lost.locator('.pet-hit').click();
  const lostMenu = lost.locator('[data-agent-id="task-card.review-menu"]');
  assert.deepEqual(await lostMenu.locator('button').allInnerTexts(), ['문제 내기', '쉽게 설명', '문제 묶음 0']);
  assert.equal(await lostMenu.getByRole('button', { name: '문제 묶음 0' }).isDisabled(), true);
  await lostMenu.getByRole('button', { name: '문제 내기', exact: true }).click();
  await lostMenu.getByText('연결이 끊겼어요. “다시 연결”을 눌러 주세요.', { exact: true }).waitFor();
  assert.equal((await calls(lost, 'send_review_request')).length, 0, 'never sent to a disconnected chat');
  await lost.locator('.pet-popup').getByRole('button', { name: '다시 연결', exact: true }).waitFor();
  await lost.close();

  // Other pets are unchanged: no review menu, a drop on Codex does nothing.
  const other = await newPage({ width: 252, height: 404 });
  await mockBridge(other, state(templates[1], { due: 3, total: 3, batches: 1, notifiedToday: false })); await other.goto(`${origin}/?pet=0`);
  await other.locator('.pet-hit').waitFor();
  await other.evaluate(() => window.__uiTest.emitEvent('autopets://pet-drag-end', { label: 'pet-0', edge: null, codex: true }));
  await other.waitForTimeout(150);
  assert.equal(await other.locator('.pet-review-bubble, .pet-review-badge').count(), 0);
  assert.equal((await calls(other, 'mark_review_notice')).length, 0);
  await other.setViewportSize({ width: 328, height: 600 });
  await other.locator('.pet-hit').click();
  await other.locator('.pet-popup').waitFor();
  assert.equal(await other.locator('[data-agent-id="task-card.review-menu"]').count(), 0);
  await other.close();
  checks.push('복습 도우미 pet: once-a-day due bubble and badge, menu at the popup top, Codex-drop panel with Esc; each names its chat, a press sends once into its own connected chat (보냈어요 → 시작됐어요), bubble/drop alone send nothing, a failed send is typed in with the reason, a quick repeat is refused; other pets unchanged');

  // The app: 문제 묶음 pages instead of the old "저장된 문제" popup.
  const thread = link(reviewTemplate).target.threadId;
  const day = new Date(2026, 10, 24, 9).getTime();
  const batches = [
    { id: 'bbbb2222', name: '광고와 PR · PESO', threadId: thread, createdAt: day - 86400000, topics: ['광고와 PR', 'PESO'], count: 2, correct: 1, due: 1, nextReviewDays: 0, cards: [{ id: 'c1' }, { id: 'c2' }] },
    { id: 'aaaa1111', name: '통합 마케팅 커뮤니케이션', threadId: thread, createdAt: day, topics: ['IMC', '촉진 믹스', 'PR'], count: 3, correct: 2, due: 0, nextReviewDays: 3, cards: [{ id: 'c3' }, { id: 'c4' }, { id: 'c5' }] },
  ];
  const app = await newPage({ width: 1280, height: 900 });
  await mockBridge(app, state(reviewTemplate, { due: 1, total: 5, batches: 2, notifiedToday: true }));
  await app.addInitScript(batches => { window.__uiTest.reviewBatches = batches; }, batches);
  await app.goto(origin);
  const list = app.locator('[data-agent-id="task-card.review-batches"]');
  const page = app.locator('[data-agent-id="task-card.review-batch"]');
  const detail = app.locator('.pet-start');
  const entryButton = app.locator('[data-agent-id="pet-selection.detail.review-batches"]');
  const appCalls = name => calls(app, name);

  // "문제 묶음 N" on the pet opens the page in the app; its back button lands on the 복습 도우미 detail.
  await app.locator('.app-header').waitFor();
  await app.evaluate(() => window.__uiTest.emitEvent('autopets://open-review-batches', {}));
  await list.waitFor();
  assert.equal(await app.locator('.modal').count(), 0, 'no popup any more');
  await list.getByRole('button', { name: '← 복습 도우미', exact: true }).click();
  await detail.getByRole('heading', { name: '복습 도우미', exact: true }).waitFor();
  await list.waitFor({ state: 'detached' });

  // ① The detail screen: one button under the preview, nothing else changed.
  await entryButton.waitFor();
  assert.equal((await entryButton.innerText()).replace(/\s+/g, ' ').trim(), '문제 묶음 2 오늘 복습 1 →');
  assert.equal(await app.locator('.workspace-detail-preview [data-agent-id="pet-selection.detail.review-batches"]').count(), 1, 'under the thumbnail');
  for (const id of ['pet-selection.detail', 'pet-selection.detail.back', 'pet-selection.composer', 'pet-selection.composer.start']) assert.equal(await app.locator(`[data-agent-id="${id}"]`).count(), 1, `${id} kept`);
  if (screenshotDir) await app.screenshot({ path: path.join(screenshotDir, 'review-app-detail.png') });

  // ② 문제 묶음: one row per batch, today's first; delete asks once.
  await entryButton.click();
  await list.waitFor();
  assert.equal(await detail.isVisible(), false, 'a page, not a popup over the detail');
  const rows = list.locator('li.review-batch');
  assert.equal(await rows.count(), 2);
  const rowText = async i => (await rows.nth(i).innerText()).replace(/\s+/g, ' ').trim();
  assert.equal(await rowText(0), '광고와 PR · PESO 2문제 · 11월 23일 · 지난번 1/2 오늘 1 삭제');
  assert.equal(await rowText(1), '통합 마케팅 커뮤니케이션 3문제 · 11월 24일 · 지난번 2/3 3일 뒤 삭제');
  await list.getByRole('button', { name: '묶음 삭제: 통합 마케팅 커뮤니케이션', exact: true }).click();
  await list.getByText('“통합 마케팅 커뮤니케이션”과 문제 3개를 지울까요?', { exact: true }).waitFor();
  await list.getByRole('button', { name: '취소', exact: true }).click();
  assert.equal(await rows.count(), 2);
  assert.equal((await appCalls('delete_review_batch')).length, 0, 'nothing deleted before confirming');
  if (screenshotDir) await app.screenshot({ path: path.join(screenshotDir, 'review-app-batches.png') });

  // ③ One batch as a whole: what it is about, count and score; Codex에서 복습 N and 전체 다시 풀기
  // send to the chat the page names. Its questions are not listed.
  await list.getByRole('button', { name: '광고와 PR · PESO 열기', exact: true }).click();
  await page.getByRole('heading', { name: '광고와 PR · PESO', exact: true }).waitFor();
  assert.equal(await page.locator('.review-page-meta').innerText(), '2문제 · 11월 23일 · 지난번 1/2 · 오늘 1');
  assert.deepEqual(await page.locator('.review-topics li').allInnerTexts(), ['광고와 PR', 'PESO']);
  assert.deepEqual(await page.locator('.review-batch-actions button').allInnerTexts(), ['Codex에서 복습 1', '전체 다시 풀기']);
  assert.equal(await page.locator('.review-card, [data-agent-id="task-card.review-cards"]').count(), 0, 'no question list');
  if (screenshotDir) await app.screenshot({ path: path.join(screenshotDir, 'review-app-batch.png') });
  assert.equal(await page.locator('[data-agent-id="task-card.review-batch.chat"]').innerText(), `보낼 채팅: ${chat}`);
  assert.equal((await appCalls('send_review_batch')).length, 0, 'opening the page sends nothing');
  await page.getByRole('button', { name: 'Codex에서 복습 1', exact: true }).click();
  await page.getByText(`${chat}에 보냈어요`, { exact: true }).waitFor();
  assert.deepEqual(await appCalls('send_review_batch'), [{ batchId: 'bbbb2222', kind: 'due', threadId: thread }]);
  await page.getByText('시작됐어요', { exact: true }).waitFor();
  // The chat is busy or not open in Codex: still not started after a while → "Codex가 받는 중이에요", then 시작됐어요.
  await app.evaluate(() => { window.__uiTest.sendStatus = 'waiting'; });
  await page.getByRole('button', { name: '전체 다시 풀기', exact: true }).click();
  await page.getByText(`${chat}에 보냈어요`, { exact: true }).waitFor();
  await page.getByText('Codex가 받는 중이에요. 채팅이 바쁘거나 열려 있지 않으면 그다음에 시작해요.', { exact: true }).waitFor({ timeout: 20000 });
  await app.evaluate(() => { window.__uiTest.sendStatus = null; });
  await page.getByText('시작됐어요', { exact: true }).waitFor({ timeout: 10000 });
  // A disconnected 복습 도우미: nothing is sent, the reconnect guide shows.
  await app.evaluate(() => { window.__uiTest.reviewFillError = 'pet-not-connected'; });
  await page.getByRole('button', { name: '전체 다시 풀기', exact: true }).click();
  await page.getByText('연결이 끊겼어요. “다시 연결”을 눌러 주세요.', { exact: true }).waitFor();
  assert.equal(await page.getByText(/보냈어요|시작됐어요/).count(), 0);
  await page.getByRole('button', { name: '다시 연결', exact: true }).click();
  assert.deepEqual((await appCalls('open_pet_task')).at(-1), { target: link(reviewTemplate).target, expectedRevision: 1 });
  await app.evaluate(() => { window.__uiTest.reviewFillError = 'no-review-pet'; });
  await page.getByRole('button', { name: '전체 다시 풀기', exact: true }).click();
  await page.getByText('복습 도우미가 연결된 채팅이 없어요. Codex 채팅에서 $autopets로 불러 주세요.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '← 문제 묶음', exact: true }).click();
  await list.waitFor();
  assert.equal(await rows.count(), 2);
  // Confirmed delete removes a batch with its questions.
  await list.getByRole('button', { name: '묶음 삭제: 통합 마케팅 커뮤니케이션', exact: true }).click();
  await list.getByRole('button', { name: '지우기', exact: true }).click();
  await rows.nth(1).waitFor({ state: 'detached' });
  await list.getByRole('button', { name: '묶음 삭제: 광고와 PR · PESO', exact: true }).click();
  await list.getByRole('button', { name: '지우기', exact: true }).click();
  await list.getByText('문제 묶음이 없어요. Codex 채팅에서 복습 도우미로 문제를 풀면 여기에 모여요.', { exact: true }).waitFor();
  assert.deepEqual(await appCalls('delete_review_batch'), [{ id: 'aaaa1111' }, { id: 'bbbb2222' }]);
  // Back to the detail screen as it was; with no batches the button is hidden.
  await list.getByRole('button', { name: '← 복습 도우미', exact: true }).click();
  await detail.getByRole('heading', { name: '복습 도우미', exact: true }).waitFor();
  await entryButton.waitFor({ state: 'detached' });
  // Other pets' detail screens have no batch button, and leaving through the menu closes the pages.
  await app.evaluate(() => { window.__uiTest.state.review = { due: 1, total: 5, batches: 2, notifiedToday: true }; window.__uiTest.emitEvent('autopets://snapshot', { ...structuredClone(window.__uiTest.state), now: Date.now() }); });
  await entryButton.waitFor();
  await chooseRole(app, catalog.find(entry => entry.id === 'study-helper').name);
  assert.equal(await entryButton.count(), 0, 'only 복습 도우미');
  await app.close();
  checks.push('복습 도우미 app: detail button → 문제 묶음 page → batch page (topics, no question list) and back, delete asks once, Codex에서 복습 / 전체 다시 풀기 send once to the chat the page names (reconnect guide when disconnected), no popup, other pets unchanged');
};
