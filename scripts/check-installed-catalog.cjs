// The isolated Windows install job opens the real manager once. Inspect its catalog without invoking a host.
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');

async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const port = Number(process.argv[2]);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  const address = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 45000;
  let manager;
  let browser;
  try {
    while (!manager && Date.now() < deadline) {
      if (!browser) {
        try { browser = await chromium.connectOverCDP(address, { timeout: 2000 }); }
        catch { await delay(500); continue; }
      }
      for (const page of browser.contexts().flatMap(context => context.pages())) {
        if (await page.locator('.app-header').isVisible()) { manager = page; break; }
      }
      if (!manager) await delay(250);
    }
    assert.ok(manager, 'installed manager window is visible');
    const home = manager.locator('.pet-home-find');
    const catalog = manager.locator('.app-header nav').getByRole('button', { name: '펫 고르기', exact: true });
    await (await home.isVisible() ? home : catalog).click();
    const upcoming = manager.getByRole('region', { name: '준비 중인 펫 기능' });
    await upcoming.scrollIntoViewIfNeeded();
    assert.deepEqual(await upcoming.locator('li strong').allTextContents(), ['펫 추가', '펫 꾸미기', '펫 진화']);
    assert.equal(await upcoming.getByText('준비 중', { exact: true }).count(), 3);
    assert.equal(await upcoming.locator('button, a, [tabindex]').count(), 0);
    await manager.screenshot({ path: 'work/artifacts/installed-pet-preview.png' });
    await manager.getByRole('button', { name: '스킬·도구', exact: true }).click();
    const cards = manager.locator('.research-grid article');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 3);
    await manager.getByRole('button', { name: '새 Codex 채팅에서 사용' }).waitFor();
    await manager.screenshot({ path: 'work/artifacts/installed-skill-catalog.png' });
    console.log('Installed app navigation passed: three upcoming features and three research skills; no host opened.');
  } finally {
    if (browser) await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
