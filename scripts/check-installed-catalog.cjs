// Windows: node scripts/check-installed-catalog.cjs <AutoPets.exe>
// Run with AutoPets closed. Screenshots and the isolated profile go under work/.
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function findManager(app, port) {
  const address = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 60000;
  let browser;
  try {
    while (Date.now() < deadline) {
      assert.ok(app.exitCode === null && app.signalCode === null, 'The native app exited before showing its catalog.');
      if (!browser) {
        try { browser = await chromium.connectOverCDP(address, { timeout: 1500 }); }
        catch { await delay(350); continue; }
      }
      for (const page of browser.contexts().flatMap(context => context.pages())) {
        if (await page.locator('.app-header').isVisible() && await page.evaluate(() => !!window.__TAURI_INTERNALS__)) {
          return { browser, manager: page };
        }
      }
      await delay(250);
    }
    throw new Error(browser ? 'WebView opened, but the native manager did not render.' : 'The isolated WebView did not open its inspection port.');
  } catch (error) {
    if (browser) await browser.close();
    throw error;
  }
}

async function inspectCatalog(manager, output) {
  const home = manager.locator('.pet-home-find');
  const catalog = manager.locator('.app-header nav').getByRole('button', { name: '펫 고르기', exact: true });
  await (await home.isVisible() ? home : catalog).click();
  const upcoming = manager.getByRole('region', { name: '준비 중인 펫 기능' });
  await upcoming.scrollIntoViewIfNeeded();
  assert.deepEqual(await upcoming.locator('li strong').allTextContents(), ['펫 추가', '펫 꾸미기', '펫 진화']);
  assert.equal(await upcoming.getByText('준비 중', { exact: true }).count(), 3);
  assert.equal(await upcoming.locator('button, a, [tabindex]').count(), 0);
  await manager.screenshot({ path: path.join(output, 'native-teaser.png') });

  await manager.getByRole('button', { name: '스킬·도구', exact: true }).click();
  const cards = manager.locator('.research-grid article');
  await cards.first().waitFor();
  assert.equal(await cards.count(), 3);
  await manager.getByRole('button', { name: '새 Codex 채팅에서 사용' }).waitFor();
  await manager.screenshot({ path: path.join(output, 'native-skills.png') });
}

async function main() {
  assert.equal(process.platform, 'win32', 'Run this check on Windows.');
  const [executable] = process.argv.slice(2);
  assert.ok(executable && path.basename(executable).toLowerCase() === 'autopets.exe', 'Pass the packaged AutoPets.exe path.');
  await fs.access(executable);
  const running = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', "@(Get-Process -Name AutoPets -ErrorAction SilentlyContinue).Count",
  ], { encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(running, '0', 'Close the running AutoPets instance before using this check.');

  await fs.mkdir('work', { recursive: true });
  const output = await fs.mkdtemp(path.resolve('work', 'native-catalog-'));
  const port = await freePort();
  const app = spawn(path.resolve(executable), [], {
    windowsHide: true, stdio: 'ignore',
    env: {
      ...process.env,
      AUTOPETS_DATA_DIR: path.join(output, 'data'),
      AUTOPETS_HOME: path.join(output, 'managed'),
      CODEX_HOME: path.join(output, 'codex'),
      WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-address=127.0.0.1 --remote-debugging-port=' + port,
    },
  });
  await new Promise((resolve, reject) => app.once('error', reject).once('spawn', resolve));
  let browser;
  try {
    const session = await findManager(app, port);
    browser = session.browser;
    await inspectCatalog(session.manager, output);
    console.log('Three upcoming features and three skills verified in the native app. Screenshots:', path.relative(process.cwd(), output));
  } finally {
    try { if (browser) await browser.close(); }
    finally { if (app.exitCode === null && app.signalCode === null) app.kill(); }
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
