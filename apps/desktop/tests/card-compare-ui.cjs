const assert = require('node:assert/strict');
const path = require('node:path');
const { openCatalog } = require('./entry-navigation.cjs');
const catalog = require('../../../packages/contracts/data/pet-catalog.json');

// Pet-selection cards: the "그냥 시켰을 때 ↔ 펫" comparison thumbnails (synthetic bridge, desktop size).
// The pet layer sits at 40%, covers the thumbnail while the card is pointed at or focused, nudges once
// after the app starts, and stays still with reduced motion. The detail screen is unchanged.
const LABELS = {
  'daily-plan': '하루 정리: 그냥 시키면 할 일 12개가 빽빽하고, 펫은 3개와 여유 25분으로 정리해요',
  'travel-plan': '여행 일정: 그냥 시키면 전부 확정처럼 적고, 펫은 확인 못 한 곳에 확인 필요를 붙여요',
  'study-helper': '공부 도우미: 그냥 시키면 정답이 바로 보이고, 펫은 풀고 나서 정답을 보여줘요',
  'review-helper': '복습 도우미: 그냥 시키면 한 번 풀고 끝이고, 펫은 3일, 7일, 16일 뒤에 다시 물어봐요',
  'ui-webpage': '웹페이지 만들기: 그냥 시키면 PC 화면만 확인하고, 펫은 모바일 화면까지 확인해요',
  'marketing-copy': '홍보글 쓰기: 그냥 시키면 근거 없는 말을 지어내고, 펫은 있는 사실만 써요',
  presentation: '발표자료 만들기: 그냥 시키면 한 장에 전부 넣고, 펫은 한 장에 한 메시지만 담아요',
};

exports.runCardCompareChecks = async ({ newPage, mockBridge, fixture, origin, screenshotDir, checks }) => {
  const state = { ...structuredClone(fixture), sessions: [], slots: [], petLinks: [] };
  const page = await newPage({ width: 1280, height: 900 });
  await mockBridge(page, state);
  await page.goto(origin);
  await openCatalog(page);
  const allTab = page.getByRole('button', { name: '전체', exact: true });
  if (await allTab.isVisible()) await allTab.click();
  const cards = page.locator('.workspace-role-card');
  await cards.first().locator('.pct-t').waitFor();
  assert.equal(await cards.count(), 7);
  // Where the pet layer starts, as a share of the thumbnail width.
  const share = card => card.locator('.pct-pn').evaluate(node => Math.round(node.offsetLeft / node.parentElement.clientWidth * 100));
  const settle = () => page.waitForTimeout(500);

  // All seven: the reference labels and caption, the two layers, and the nudge in card order.
  const ids = await cards.evaluateAll(nodes => nodes.map(node => node.dataset.role));
  assert.deepEqual([...ids].sort(), Object.keys(LABELS).sort(), 'every catalog pet has a comparison');
  for (const [index, id] of ids.entries()) {
    const card = cards.nth(index);
    const thumb = card.locator('.pct-t');
    assert.equal(await thumb.getAttribute('role'), 'img');
    assert.equal(await thumb.getAttribute('aria-label'), LABELS[id]);
    assert.equal(await card.locator('.result-thumbnail-label').innerText(), '그냥 시켰을 때 ↔ 펫');
    assert.equal(await card.locator('.pct-bf .pct-chip').innerText(), '그냥');
    assert.equal(await card.locator('.pct-pn .pct-chip').innerText(), '펫');
    assert.equal(await card.locator('.pct-t div').count(), 0, 'spans only inside the card button');
    assert.equal(await card.locator('.workspace-role-select').getAttribute('data-agent-id'), `pet-selection.role.${id}.choose`, 'card ids kept');
    // The ☆ button over the thumbnail's corner stays on top and clickable.
    const star = card.locator('.pet-favorite-button');
    assert.equal(await star.evaluate(node => { const box = node.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('.pet-favorite-button') === node; }), true, `${id}: ☆ stays clickable`);
    assert.equal(await thumb.evaluate(node => node.classList.contains('pct-nudge')), true, 'nudges once at the first showing');
    assert.equal(await card.locator('.pct-pn').evaluate(node => getComputedStyle(node).animationDelay), `${(0.4 + index * 0.14).toFixed(2).replace(/0$/, '')}s`);
  }
  assert.equal(catalog.length, 7);
  // After the nudge: at 40%, no class left, so it never replays.
  await page.waitForFunction(() => document.querySelectorAll('.pct-nudge').length === 0, null, { timeout: 5000 });
  await settle();
  for (const index of [0, 6]) assert.equal(await share(cards.nth(index)), 40, 'the pet layer starts at 40%');

  // Pointing at a card slides its pet layer over the whole thumbnail; the others stay.
  for (const [index, id] of ids.entries()) {
    const card = cards.nth(index);
    const wrap = card.locator('.pct-wrap');
    await page.mouse.move(0, 0); await settle();
    if (screenshotDir) await wrap.screenshot({ path: path.join(screenshotDir, `card-compare-${id}-rest.png`) });
    await card.hover(); await settle();
    assert.equal(await share(card), 0, `${id}: covered while pointed at`);
    if (index > 0) assert.equal(await share(cards.nth(0)), 40, 'other cards stay');
    if (screenshotDir) await wrap.screenshot({ path: path.join(screenshotDir, `card-compare-${id}-hover.png`) });
  }
  await page.mouse.move(0, 0); await settle();
  assert.equal(await share(cards.nth(6)), 40, 'back to 40% when the pointer leaves');
  // Keyboard focus does the same.
  await cards.nth(2).locator('.workspace-role-select').focus(); await settle();
  assert.equal(await share(cards.nth(2)), 0, 'covered while focused');
  await page.evaluate(() => document.activeElement.blur()); await settle();
  if (screenshotDir) await page.locator('.workspace-role-grid').screenshot({ path: path.join(screenshotDir, 'card-compare-grid.png') });

  // Opening a detail and coming back does not replay the nudge; the detail keeps the shared example.
  await cards.nth(0).locator('.workspace-role-select').click();
  const detail = page.locator('.workspace-role-detail.pet-start');
  await detail.waitFor();
  assert.equal(await detail.locator('.pct-t').count(), 0, 'the detail screen has no comparison');
  assert.ok(await detail.locator('.result-preview [data-sample-kind], .result-preview .result-thumbnail img').count() > 0, 'the detail keeps the shared example');
  assert.equal(await detail.locator('.result-preview figcaption small').innerText(), '디자인 예시');
  await detail.getByRole('button', { name: '← 돌아가기', exact: true }).click();
  await cards.first().waitFor();
  assert.equal(await page.locator('.pct-nudge').count(), 0, 'no nudge when coming back');
  // A category shows its cards in their own order (the first one starts first).
  await page.getByRole('button', { name: '업무', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(await cards.first().locator('.pct-t').evaluate(node => node.style.getPropertyValue('--i')), '0');
  await page.close();

  // Reduced motion: no nudge and no slide.
  const still = await newPage({ width: 1280, height: 900 });
  await still.emulateMedia({ reducedMotion: 'reduce' });
  await mockBridge(still, state);
  await still.goto(origin);
  await openCatalog(still);
  const first = still.locator('.workspace-role-card').first();
  await first.locator('.pct-t').waitFor();
  const motion = await first.locator('.pct-pn').evaluate(node => { const style = getComputedStyle(node); return [style.animationName, style.transitionDuration]; });
  assert.deepEqual(motion, ['none', '0s']);
  await still.close();
  checks.push('pet-selection cards: seven "그냥 시켰을 때 ↔ 펫" comparisons with the reference labels, pet layer at 40%, covers on hover and focus and returns, nudges once in card order and never again, still with reduced motion; the detail keeps the shared example');
};
