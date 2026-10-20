const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');

(async () => {
  const output = path.resolve(__dirname, '../../../work/campaign-study-20261019');
  const site = path.join(output, 'site');
  const manifest = JSON.parse(fs.readFileSync(path.join(site, 'manifest.json'), 'utf8'));
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(site, file.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 992, height: 688 }, reducedMotion: 'reduce' });
    const errors = [], failed = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => failed.push({ url: request.url(), error: request.failure() }));
    page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
    await page.goto(pathToFileURL(path.join(site, 'index.html')).href);
    await page.getByRole('button', { name: '예시로 시작' }).click();
    await page.getByRole('button', { name: '요청 준비하기' }).click();
    await page.locator('.cs-method > summary').click();
    assert.match(await page.locator('.cs-method-body').innerText(), /Anthropic/);
    await page.getByRole('button', { name: /작업 이어가기/ }).click();
    await page.getByRole('button', { name: /계획 보러 가기/ }).click();
    assert.match(await page.locator('dialog').innerText(), /가상 작업 A/);
    await page.keyboard.press('Escape');
    await page.getByRole('navigation').getByRole('button', { name: /결과 확인/ }).click();
    await page.getByRole('button', { name: '행사 웹페이지 디자인 예시 크게 보기' }).click();
    await page.getByRole('button', { name: '모바일', exact: true }).click();
    await page.locator('.cs-full-preview').evaluate(image => image.decode());
    await page.keyboard.press('Escape');
    await page.screenshot({ path: path.join(output, 'offline-package.png'), fullPage: true });
    assert.equal(await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
    assert.equal(await page.locator('.companion-pet').getAttribute('data-assets'), 'ready');
    const fontLoaded = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some(font => /Pretendard/.test(font.family) && font.status === 'loaded'); });
    assert.equal(fontLoaded, true);
    assert.deepEqual(errors, []); assert.deepEqual(failed, []); assert.deepEqual(external, []);
    const report = { package: 'campaign-study-20261019', protocol: 'file:', browser: browser.version(), node: process.version, platform: process.platform, manifestFiles: manifest.files.length, pageErrors: errors, failedRequests: failed, externalRequests: external, fontLoaded, result: 'pass', actualAiTurns: 0 };
    fs.writeFileSync(path.join(output, 'package-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
