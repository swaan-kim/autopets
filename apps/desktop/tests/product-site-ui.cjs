const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

async function runProductSiteChecks({ newPage, screenshotDir, checks }) {
  const root = path.resolve(__dirname, '../../..');
  const { buildProductSite } = await import(pathToFileURL(path.join(root, 'scripts/build-product-site.mjs')));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-product-ui-'));
  await buildProductSite({ root, out: path.join(temporary, 'start') });
  await fs.cp(path.join(root, 'docs/demo/assets'), path.join(temporary, 'demo/assets'), { recursive: true });
  const fixture = { version: 2, publicRelease: { version: '0.0.0-fixture', installer: { url: 'https://github.com/swaan-kim/autopets/releases/download/v0.0.0-fixture/AutoPets-fixture.exe', sha256: 'a'.repeat(64) } } };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '').replace(/\/$/, '/index.html');
    const file = path.resolve(temporary, relative);
    if (path.relative(temporary, file).startsWith('..')) { res.writeHead(404).end(); return; }
    try {
      let body = await fs.readFile(file);
      if (file.endsWith('index.html') && url.searchParams.has('fixture')) {
        const value = structuredClone(fixture);
        if (url.searchParams.get('fixture') === 'invalid') value.publicRelease.installer.url = 'https://example.invalid/untrusted.exe';
        body = Buffer.from(body.toString().replace(/(<script type="application\/json" id="autopets-release">)[\s\S]*?(<\/script>)/, `$1${JSON.stringify(value)}$2`));
      }
      res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'image/png');
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await newPage({ width: 1280, height: 960 });
  const screenshots = [];
  try {
    await page.goto(`${origin}/start/`);
    await page.getByRole('heading', { name: /부르면 나타나는/ }).waitFor();
    assert.equal(await page.getByRole('button', { name: '서명된 배포 준비 중', exact: true }).isEnabled(), false);
    assert.equal(await page.getByRole('button', { name: '호출 문구 복사', exact: true }).isEnabled(), true);
    assert.equal(await page.locator('a[href$=".exe"]').count(), 0);
    assert.ok(await page.locator('.hero-pet').evaluate(async element => { const image=new Image();image.src=getComputedStyle(element).backgroundImage.slice(5,-2);await image.decode();return image.naturalWidth>0; }));
    const desktop = path.join(screenshotDir, 'product-start-desktop.png');
    await page.screenshot({ path: desktop, fullPage: true, animations: 'disabled' }); screenshots.push(desktop);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390));
    const mobile = path.join(screenshotDir, 'product-start-mobile.png');
    await page.screenshot({ path: mobile, fullPage: true, animations: 'disabled' }); screenshots.push(mobile);
    checks.push('unpublished product page gates installation, distinguishes prepared-host invocation, loads the soft pet, and fits desktop/mobile');

    await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copiedRequest = text; } } }); });
    await page.goto(`${origin}/start/?fixture=published`);
    assert.equal(await page.locator('#download').getAttribute('href'), fixture.publicRelease.installer.url);
    assert.equal(await page.locator('#release-sha').textContent(),fixture.publicRelease.installer.sha256);
    await page.getByRole('button', { name: '호출 문구 복사', exact: true }).click();
    const request = await page.evaluate(() => window.__copiedRequest);
    assert.equal(request,'AutoPets 스킬로 제작 펫 연결해줘.');
    assert.ok(!request.includes('.exe'),'prepared-host invocation does not silently become an installer request');
    await page.goto(`${origin}/start/?fixture=invalid`);
    assert.equal(await page.locator('a[href$=".exe"]').count(), 0);
    assert.equal(await page.locator('#download-pending').isVisible(),true);
    checks.push('synthetic publication binds download to a pinned EXE/hash; prepared invocation stays separate and an untrusted installer fails closed');
  } finally {
    await page.close();
    await new Promise(resolve => server.close(resolve));
    // Only the unique directory returned by mkdtemp is removed.
    await fs.rm(temporary, { recursive: true, force: true });
  }
  return screenshots;
}
module.exports = { runProductSiteChecks };
