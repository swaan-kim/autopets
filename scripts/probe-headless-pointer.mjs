import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// A synthetic input experiment, not an AutoPets motion or connection test.
// This command never attaches to a running browser or a native app.
const root = fileURLToPath(new URL('../', import.meta.url));
const parent = path.join(root, 'work', 'headless-pointer-probe');
await fs.mkdir(parent, { recursive: true });
const directory = await fs.mkdtemp(path.join(parent, 'sample-'));
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 640, height: 420 },
    offline: true,
    serviceWorkers: 'block',
    acceptDownloads: false,
    permissions: [],
  });
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8">
    <title>Isolated pointer feasibility fixture</title>
    <style>
      body { margin: 0; background: #f4f5f1; font: 16px sans-serif; }
      #pad { position: relative; width: 640px; height: 340px; }
      #object { position: absolute; left: 120px; top: 100px; width: 80px; height: 80px;
        border-radius: 28px; background: #64866b; color: white; display: grid;
        place-items: center; touch-action: none; }
      button { margin: 15px; padding: 12px; }
    </style>
    <div id="pad"><div id="object" role="img" aria-label="Test object">Fixture</div></div>
    <button id="card">Open fixture card</button><output id="result"></output>
    <script>
      window.probe = { moves: 0, downs: 0, ups: 0, cardOpens: 0 };
      let dragging = false, offsetX = 0, offsetY = 0;
      const object = document.getElementById('object');
      object.addEventListener('pointerdown', event => {
        window.probe.downs++;
        dragging = true;
        offsetX = event.clientX - object.offsetLeft;
        offsetY = event.clientY - object.offsetTop;
        object.setPointerCapture(event.pointerId);
      });
      object.addEventListener('pointermove', event => {
        window.probe.moves++;
        if (!dragging) return;
        object.style.left = (event.clientX - offsetX) + 'px';
        object.style.top = (event.clientY - offsetY) + 'px';
      });
      object.addEventListener('pointerup', event => {
        window.probe.ups++;
        dragging = false;
        object.releasePointerCapture(event.pointerId);
      });
      document.getElementById('card').addEventListener('click', () => {
        window.probe.cardOpens++;
        document.getElementById('result').textContent = 'Fixture card open';
      });
    </script></html>`);

  await page.mouse.move(160, 140);
  await page.mouse.down();
  await page.mouse.move(380, 230, { steps: 30 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Open fixture card' }).click();

  const observed = await page.evaluate(() => ({
    ...window.probe,
    left: document.getElementById('object').offsetLeft,
    top: document.getElementById('object').offsetTop,
    output: document.getElementById('result').textContent,
    url: location.href,
  }));
  assert.ok(observed.moves >= 30);
  assert.equal(observed.downs, 1);
  assert.equal(observed.ups, 1);
  assert.equal(observed.cardOpens, 1);
  assert.equal(observed.left, 340);
  assert.equal(observed.top, 190);
  assert.equal(observed.output, 'Fixture card open');
  assert.equal(observed.url, 'about:blank');
  await page.screenshot({ path: path.join(directory, 'fixture-after.png') });

  const report = {
    result: 'passed',
    experiment: 'headless virtual-pointer feasibility only',
    recordedAt: new Date().toISOString(),
    browser: browser.version(),
    headless: true,
    freshBrowserAndContext: true,
    offline: true,
    allPageNetworkBlocked: true,
    nativeAutomationApisUsedByScript: false,
    userBrowserProfileAttached: false,
    installedAutoPetsTouched: false,
    productMotionQualityVerified: false,
    modelRequests: 0,
    observed,
  };
  await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, outputDirectory: path.relative(root, directory) }));
  await context.close();
} catch (error) {
  await fs.writeFile(path.join(directory, 'failure.json'), JSON.stringify({
    result: 'failed',
    experiment: 'headless virtual-pointer feasibility only',
    message: error instanceof Error ? error.message : String(error),
  }, null, 2) + '\n');
  throw error;
} finally {
  if (browser) await browser.close();
}
