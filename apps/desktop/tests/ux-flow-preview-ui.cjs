const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const origin = process.env.AUTOPETS_UI_URL || 'http://127.0.0.1:1421';
const output = path.resolve(process.env.AUTOPETS_UX_SCREENSHOTS || 'work/ux25/preview');

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const external = [];
  fs.mkdirSync(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) external.push(request.url()); });
    await page.addInitScript(() => {
      window.__prototypeWrites = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { window.__prototypeWrites.push('clipboard'); } } });
    });
    await page.goto(`${origin}/tests/ux-flow-preview.html`);
    await page.getByRole('heading', { name: '하던 일, 이어서.', exact: true }).waitFor();
    await page.locator('.companion-pet[data-assets="ready"]').waitFor();
    await page.screenshot({ path: path.join(output, 'tasks-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: '기존 대화에서 이어가기', exact: false }).click();
    await page.getByRole('status').filter({ hasText: '이 시제품은 외부 앱을 열지 않아요' }).waitFor();
    await page.getByRole('button', { name: '작업 중', exact: true }).click();
    await page.locator('.companion-sprite[data-clip="working"]').waitFor();
    await page.getByRole('button', { name: '완료', exact: true }).click();
    await page.getByRole('button', { name: /결과 보러 가기/ }).waitFor();

    await page.getByRole('button', { name: '둘러보기', exact: false }).first().click();
    assert.equal(await page.locator('.ux-example-card').count(), 6);
    await page.screenshot({ path: path.join(output, 'explore-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: '영상', exact: true }).click();
    assert.equal(await page.locator('.ux-example-card').count(), 2);
    const trigger = page.getByRole('button', { name: '느긋한 해변의 한 장면 살펴보기', exact: true });
    await trigger.click();
    await page.getByRole('dialog', { name: '느긋한 해변의 한 장면', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'example-detail.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'Escape restores the original example button');
    await trigger.click();
    await page.getByRole('button', { name: /이 예시로 작업 준비/ }).click();
    await page.getByRole('heading', { name: '느긋한 해변의 한 장면', exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: '실제 전달과 실행은 하지 않아요' }).waitFor();

    await page.getByRole('button', { name: '둘러보기', exact: false }).first().click();
    await page.getByRole('textbox', { name: '예시 검색', exact: true }).fill('찾을 수 없는 결과');
    await page.getByRole('heading', { name: '아직 맞는 예시가 없어요.', exact: true }).waitFor();
    await page.getByRole('button', { name: '전체 예시 보기', exact: true }).click();
    assert.equal(await page.locator('.ux-example-card').count(), 6);

    await page.getByRole('button', { name: '연결', exact: false }).filter({ has: page.locator('span') }).first().click();
    await page.getByRole('button', { name: /Claude/ }).click();
    await page.getByText('이 호스트의 공식 연결 수단과 현재 대화 식별은 별도 확인이 필요해요.', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'connection-design.png'), fullPage: true });
    for (const [width, height] of [[992, 688], [716, 701], [390, 844], [320, 740]]) {
      await page.setViewportSize({ width, height });
      for (const name of ['이어서 하기', '둘러보기', '연결']) {
        await page.locator('.ux-sidebar nav').getByRole('button', { name: new RegExp(name) }).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} fits ${width}px`);
        await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.ux-sidebar nav').getByRole('button', { name: /이어서 하기/ }).click();
    await page.getByRole('button', { name: '동작 줄이기 적용 중', exact: true }).waitFor();
    assert.equal(await page.locator('.companion-pet').getAttribute('data-playing'), 'false');
    await page.locator('.ux-sidebar nav').getByRole('button', { name: /둘러보기/ }).click();
    await page.getByRole('button', { name: /느긋한 해변의 한 장면 살펴보기/ }).click();
    assert.equal(await page.locator('.ux-art-scene').last().evaluate(element => getComputedStyle(element).animationName), 'none');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile detail remains within the viewport');
    assert.deepEqual(await page.evaluate(() => window.__prototypeWrites), []);
    assert.deepEqual(external, [], 'the preview does not transmit data to other services');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ evidence: 'design-prototype', actualAIExecutions: 0, externalRequests: 0, pageErrors: errors, screenshots: output, checks: ['current task first', 'image/video/work filtering', 'empty search recovery', 'example selection without clipboard', 'dialog Escape and focus return', 'unsupported host distinction', '320–1280px layouts', 'reduced motion'] }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
