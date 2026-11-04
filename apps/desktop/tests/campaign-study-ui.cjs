const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Isolated usability prototype: never sends an AI request or changes real app data.
const root = path.resolve(__dirname, '../../..');
const url = process.env.AUTOPETS_STUDY_URL || 'http://127.0.0.1:1420/campaign-study.html';
const output = path.join(root, 'work/campaign-study-20261019');
const captures = path.join(root, 'docs/images/campaign-study-20261019');
const report = { url, fixtureOnly: true, actualAiTurns: 0, nativeWindowsTested: false, participants: 0, environment: { node: process.version, platform: process.platform, arch: process.arch }, checks: [], pageErrors: [], sideEffects: [], screenshots: [] };
let browser;

async function createPage({ reducedMotion = 'no-preference', failImages = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 992, height: 688 }, reducedMotion });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('request', request => {
    const requested = new URL(request.url());
    if (request.method() !== 'GET' || (requested.protocol.startsWith('http') && requested.origin !== new URL(url).origin)) {
      report.sideEffects.push({ method: request.method(), url: request.url() });
    }
  });
  if (failImages) await page.route('**/assets/companion-v1/*.webp', route => route.abort());
  if (failImages) await page.route('**/assets/design-example-v1/*.webp', route => route.abort());
  await page.addInitScript(() => {
    window.__studyTest = { clipboard: '', copyFailure: false, copyCalls: 0, storageWrites: [], networkCalls: [], bridgeCalls: [] };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
      window.__studyTest.copyCalls++;
      if (window.__studyTest.copyFailure) throw new Error('fixture clipboard failure');
      window.__studyTest.clipboard = text;
    } } });
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        window.__studyTest.storageWrites.push({ method, key: args[0] });
        return original.apply(this, args);
      };
    }
    window.fetch = async (...args) => { window.__studyTest.networkCalls.push(['fetch', String(args[0])]); throw new Error('prototype must not fetch runtime data'); };
    XMLHttpRequest.prototype.open = function (...args) { window.__studyTest.networkCalls.push(['xhr', String(args[1])]); throw new Error('prototype must not call XHR'); };
    navigator.sendBeacon = (...args) => { window.__studyTest.networkCalls.push(['beacon', String(args[0])]); return false; };
    window.__TAURI_INTERNALS__ = { invoke: async (...args) => { window.__studyTest.bridgeCalls.push(args); throw new Error('prototype must not invoke native bridge'); } };
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('navigation', { name: '체험 장면' }).waitFor();
  return page;
}

async function scene(page, name) {
  await page.getByRole('navigation', { name: '체험 장면' }).getByRole('button', { name, exact: false }).click();
  await page.getByRole('region', { name, exact: true }).waitFor();
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(captures, `${name}.png`), fullPage: true, animations: 'disabled' });
  report.screenshots.push(path.relative(root, path.join(captures, `${name}.png`)).replaceAll('\\', '/'));
}

async function verifyIsolation(page, label) {
  const effects = await page.evaluate(() => ({ storage: window.__studyTest.storageWrites, network: window.__studyTest.networkCalls, bridge: window.__studyTest.bridgeCalls }));
  assert.deepEqual(effects, { storage: [], network: [], bridge: [] }, `${label}: no persistent writes or runtime/network calls`);
}

async function run() {
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(captures, { recursive: true });
  browser = await chromium.launch({ headless: true });
  report.environment.chromium = browser.version();
  const page = await createPage();
  const input = page.getByRole('textbox', { name: '어떤 페이지가 필요한가요?', exact: true });
  const prepare = page.getByRole('button', { name: /요청 준비하기/ });

  assert.ok(await page.getByText('시제품 · 가상 작업 · AI 실행 없음', { exact: true }).isVisible());
  assert.equal(await prepare.isEnabled(), false);
  await input.fill('   ');
  assert.equal(await prepare.isEnabled(), false);
  await page.getByRole('button', { name: /예시로 시작/ }).click();
  assert.match(await input.inputValue(), /봄 오픈캠퍼스/);
  await page.getByRole('button', { name: '펫에게 인사하기', exact: true }).click();
  assert.ok(await input.evaluate(element => element === document.activeElement));
  await capture(page, 'start');
  const firstDraft = '첫 행사 A — 소개와 일정만 정리해줘.\n개인 정보 없는 합성 요청.';
  await input.fill(firstDraft);
  await prepare.click();
  const copy = page.getByRole('button', { name: /체험 문구 복사/ });
  await copy.click();
  const copied = await page.evaluate(() => window.__studyTest.clipboard);
  assert.ok(copied.includes(firstDraft));
  assert.match(copied, /실제 실행용 요청이 아닙니다/);
  assert.match(copied, /frontend-design/);
  assert.match(copied, /Luna \/ low/);
  assert.match(copied, /Sol \/ low/);
  assert.ok(await page.getByText('체험 문구를 복사했어요. 채팅 연결·실행은 하지 않았어요.', { exact: true }).isVisible());
  await page.evaluate(() => { window.__studyTest.copyFailure = true; });
  await copy.click();
  const fallback = page.getByRole('textbox', { name: '실행용이 아닌 체험 문구', exact: true });
  await fallback.waitFor({ state: 'visible' });
  assert.equal(await fallback.inputValue(), copied);
  assert.ok(await page.getByText(/복사하지 못했어요/).isVisible());
  assert.ok(await fallback.evaluate(element => element === document.activeElement), 'failed copy should focus readable manual-copy fallback');
  report.checks.push('Empty requests are blocked; example and pet greeting focus the request; copy includes a non-executable disclaimer, and failure preserves/selects the complete request.');

  await scene(page, '지난 방식');
  const reuse = page.getByRole('textbox', { name: '이번에는 어떤 일을 맡길까요?', exact: true });
  assert.equal(await reuse.inputValue(), '', 'new work must not inherit old request');
  assert.ok(await page.getByText('스킬·설정만 가져왔어요. 새 요청을 적어주세요.', { exact: true }).isVisible());
  await capture(page, 'reuse');
  const newDraft = '새 행사 C — 동아리 체험전의 방문 안내를 만들어줘.';
  await reuse.fill(newDraft);
  await page.getByRole('button', { name: /요청 준비하기/ }).click();
  await page.evaluate(() => { window.__studyTest.copyFailure = false; });
  await page.getByRole('button', { name: /체험 문구 복사/ }).click();
  const reusedText = await page.evaluate(() => window.__studyTest.clipboard);
  assert.ok(reusedText.includes(newDraft));
  assert.ok(!reusedText.includes(firstDraft), 'new request excludes previous task content');
  assert.match(reusedText, /frontend-design/);
  assert.match(reusedText, /계획 예시: Luna \/ low/);
  assert.match(reusedText, /제작 예시: Sol \/ low/);
  await scene(page, '처음 맡기기');
  assert.equal(await input.inputValue(), firstDraft);
  assert.ok(await page.getByRole('button', { name: /체험 문구 복사/ }).isVisible(), 'prepared first request survives scene changes');
  await scene(page, '지난 방식');
  assert.equal(await reuse.inputValue(), newDraft);
  await reuse.fill(`${newDraft}\n추가 수정`);
  assert.ok(await page.getByRole('button', { name: /요청 준비하기/ }).isVisible(), 'editing invalidates preparation');
  assert.equal(await page.getByRole('button', { name: /체험 문구 복사/ }).count(), 0);
  report.checks.push('First and new requests keep independent drafts and preparation; settings are reused without previous content, and editing requires preparing the new revision.');

  await scene(page, '작업 이어가기');
  await capture(page, 'resume');
  const openA = page.getByRole('button', { name: /계획 보러 가기/ });
  const openB = page.getByRole('button', { name: /결과 보러 가기/ });
  await openA.click();
  let dialog = page.getByRole('dialog');
  assert.equal(await dialog.getByRole('heading', { level: 2 }).textContent(), '봄 오픈캠퍼스');
  assert.ok(await dialog.getByText(/대상 확인: 가상 작업 A/).isVisible());
  assert.ok(await dialog.getByText('안내 예시 · 전송되지 않음', { exact: true }).isVisible());
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
  assert.ok(await openA.evaluate(element => element === document.activeElement));
  await openB.click();
  assert.equal(await dialog.getByRole('heading', { level: 2 }).textContent(), '지난 오픈캠퍼스');
  assert.ok(await dialog.getByText(/대상 확인: 가상 작업 B/).isVisible());
  await dialog.getByRole('button', { name: '행사 웹페이지 디자인 예시 크게 보기', exact: true }).click();
  assert.ok(await dialog.getByRole('heading', { name: '행사 소개 웹페이지', exact: true }).isVisible());
  await page.keyboard.press('Escape');
  assert.equal(await dialog.getByRole('heading', { level: 2 }).textContent(), '지난 오픈캠퍼스', 'closing nested preview returns to the correct B task');
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  assert.ok(await openB.evaluate(element => element === document.activeElement));
  await page.getByText('작업명 바꿔보기', { exact: true }).click();
  await page.getByRole('textbox', { name: '가상 작업 A', exact: true }).fill('수정된 행사 A');
  await page.getByRole('textbox', { name: '가상 작업 B', exact: true }).fill('수정된 행사 B');
  await openA.click();
  assert.equal(await dialog.getByRole('heading', { level: 2 }).textContent(), '수정된 행사 A');
  assert.ok(await dialog.getByText(/대상 확인: 가상 작업 A/).isVisible());
  await page.keyboard.press('Escape');
  await openB.click();
  assert.equal(await dialog.getByRole('heading', { level: 2 }).textContent(), '수정된 행사 B');
  assert.ok(await dialog.getByText(/대상 확인: 가상 작업 B/).isVisible());
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: '가상 작업 A', exact: true }).fill('봄 오픈캠퍼스');
  await page.getByRole('textbox', { name: '가상 작업 B', exact: true }).fill('지난 오픈캠퍼스');
  report.checks.push('A and B open their own simulated plan/result; editable labels do not mix target identity; Escape and close return focus to the triggering action.');

  await scene(page, '결과 확인');
  await capture(page, 'result');
  const preview = page.getByRole('button', { name: '행사 웹페이지 디자인 예시 크게 보기', exact: true });
  await preview.click();
  assert.ok(await dialog.getByRole('heading', { name: '행사 소개 웹페이지', exact: true }).isVisible());
  await dialog.getByRole('button', { name: '모바일', exact: true }).click();
  assert.ok(await dialog.getByRole('img', { name: '가상 학과 행사 페이지 모바일 디자인 예시', exact: true }).isVisible());
  await page.keyboard.press('Escape');
  assert.ok(await preview.evaluate(element => element === document.activeElement));
  await page.getByText('완료 반응 체험', { exact: true }).click();
  const replay = page.getByRole('button', { name: '작업 중 → 완료 반응 보기', exact: true });
  await replay.click();
  assert.equal(await page.getByRole('button', { name: '이 가상 작업의 반응을 보여드렸어요', exact: true }).isEnabled(), false);
  await page.waitForFunction(() => document.querySelector('.companion-pet')?.dataset.state === 'complete');
  report.checks.push('Results remain design examples; desktop/mobile modal closes accessibly, and a simulated completion reaction cannot be replayed for the same fixture.');

  await page.getByLabel('펫 표시 설정', { exact: true }).click();
  await page.getByRole('checkbox', { name: '동작 줄이기', exact: true }).check();
  await page.waitForFunction(() => document.querySelector('.companion-pet')?.dataset.playing === 'false');
  await page.getByRole('checkbox', { name: '펫 숨기기', exact: true }).check();
  assert.equal(await page.getByRole('button', { name: '펫에게 인사하기', exact: true }).count(), 0);
  await page.getByRole('button', { name: '다시 보기', exact: true }).click();
  assert.ok(await page.getByRole('button', { name: '펫에게 인사하기', exact: true }).isVisible());
  await page.getByLabel('펫 표시 설정', { exact: true }).click();
  await verifyIsolation(page, 'main interactions');

  // Restart controls are tested through the visible confirmation, not a private state reset.
  await page.getByLabel('펫 표시 설정', { exact: true }).click();
  const reset = page.getByRole('button', { name: '처음부터 체험', exact: true });
  await reset.click();
  dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  assert.ok(await reset.evaluate(element => element === document.activeElement));
  await scene(page, '처음 맡기기');
  assert.equal(await input.inputValue(), firstDraft, 'cancelled reset preserves draft');
  await reset.click();
  await dialog.getByRole('button', { name: /초기화|처음부터/ }).click();
  await input.waitFor();
  assert.equal(await input.inputValue(), '');
  await scene(page, '지난 방식');
  assert.equal(await reuse.inputValue(), '');
  await scene(page, '작업 이어가기');
  assert.ok(await page.getByRole('heading', { name: '봄 오픈캠퍼스', exact: true }).isVisible());
  assert.ok(await page.getByRole('heading', { name: '지난 오픈캠퍼스', exact: true }).isVisible());
  await page.getByLabel('펫 표시 설정', { exact: true }).click();
  report.checks.push('Reduced motion and pet hiding work; reset requires confirmation, cancellation preserves drafts, and confirmation restores both drafts and fixture names.');

  for (const viewport of [{ width: 992, height: 688 }, { width: 716, height: 701 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const name of ['처음 맡기기', '작업 이어가기', '지난 방식', '결과 확인']) {
      await scene(page, name);
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }));
      assert.ok(width.scroll <= width.viewport + 1, `${name} overflows at ${viewport.width}: ${width.scroll}`);
      const buttons = page.getByRole('region', { name, exact: true }).getByRole('button');
      assert.ok(await buttons.count() > 0);
      await buttons.first().scrollIntoViewIfNeeded();
      assert.ok(await buttons.first().isVisible());
    }
    if (viewport.width === 390) { await scene(page, '처음 맡기기'); await capture(page, 'narrow'); }
  }
  await verifyIsolation(page, 'navigation/reset/responsive');
  report.checks.push('All four scenes retain reachable actions without horizontal overflow at 992×688, 716×701, and 390×844.');

  const reduced = await createPage({ reducedMotion: 'reduce' });
  await reduced.waitForFunction(() => document.querySelector('.companion-pet')?.dataset.reduced === 'true' && document.querySelector('.companion-pet')?.dataset.playing === 'false');
  await verifyIsolation(reduced, 'OS reduced motion');
  const broken = await createPage({ failImages: true });
  await broken.waitForFunction(() => document.querySelector('.companion-pet')?.dataset.assets === 'failed');
  const fallbackPet = broken.locator('.pet-art[data-asset="soft"],.pet-art[data-asset="legacy"],.pet-art[data-asset="missing"]');
  await fallbackPet.waitFor();
  assert.ok(await fallbackPet.isVisible(), 'fallback pet remains visible');
  const fallbackBounds = await fallbackPet.boundingBox();
  assert.ok(fallbackBounds && fallbackBounds.width > 0 && fallbackBounds.height > 0, 'fallback pet has an actual display area');
  assert.ok(await broken.getByText('디자인 예시를 불러오지 못했어요.', { exact: true }).isVisible());
  assert.ok(await broken.getByRole('textbox', { name: '어떤 페이지가 필요한가요?', exact: true }).isVisible());
  const brokenPreview = broken.getByRole('button', { name: '행사 웹페이지 디자인 예시 크게 보기', exact: true });
  await brokenPreview.click();
  await broken.getByRole('dialog').getByText('큰 미리보기를 불러오지 못했어요. 닫고 체험을 이어갈 수 있어요.', { exact: true }).waitFor();
  await broken.keyboard.press('Escape');
  assert.equal(await broken.getByRole('dialog').count(), 0);
  assert.ok(await brokenPreview.evaluate(element => element === document.activeElement));
  await verifyIsolation(broken, 'asset fallback');
  report.checks.push('OS reduced-motion preference stops playback; failed motion sheets retain a visible fallback, and missing inline/full preview images show recovery without blocking request controls.');

  assert.deepEqual(report.sideEffects, [], 'all browser requests are local static GET requests');
  assert.deepEqual(report.pageErrors, []);
  report.status = 'passed';
}

run().catch(error => { report.status = 'failed'; report.error = error.stack; process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'ui-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});
