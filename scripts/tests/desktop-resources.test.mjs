import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stageDesktopResources } from '../stage-desktop-resources.mjs';
import { connectInstalled, disconnect, runPowerShellJson, start, verifyPackage } from '../../integrations/codex/bootstrap/start.mjs';
import { readJson } from '../../integrations/codex/bootstrap/files.mjs';

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-single-exe-한글 '));
  t.after(async () => {
    assert.equal(path.dirname(temporary), os.tmpdir());
    assert.ok(path.basename(temporary).startsWith('autopets-single-exe-'));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const app = path.join(temporary, 'app'), fake = path.join(temporary, 'fake');
  await fs.writeFile(fake, 'fixture runtime only');
  const report = await stageDesktopResources({ root, node: fake, license: fake, out: app });
  const appExecutable = path.join(app, 'AutoPets.exe'); await fs.writeFile(appExecutable, 'fixture app only');
  const managed = path.join(temporary, 'managed');
  const env = { LOCALAPPDATA: temporary, AUTOPETS_HOME: managed, CODEX_HOME: path.join(temporary, 'codex') };
  const calls = [];
  const driver = { install: async () => { throw Error('Must not install'); }, launch: async () => calls.push('launch'),
    bridge: async () => ({ begin: async request => { calls.push(request); return { version: 1, phase: 'connecting', appReady: true, chatConnected: false, guidanceDelivered: false }; } }) };
  const options = { resourceDirectory: report.connector, appExecutable, root: managed, env, driver, platform: 'win32', arch: 'x64' };
  return { temporary, root, app, fake, report, appExecutable, managed, env, calls, driver, options };
}

test('installer resources work detached from checkout and contain no installer or private files', async t => {
  const f = await fixture(t);
  const manifest = await verifyPackage(f.report.connector, { installedResource: true });
  assert.equal(manifest.kind, 'installed-connector');
  assert.ok(manifest.files.some(file => file.path === 'runtime/LICENSE'));
  assert.ok(manifest.files.some(file => file.path === 'LICENSE'));
  assert.ok(manifest.files.some(file => file.path === 'packages/guidance/vendor/baoyu-infographic/LICENSE'));
  assert.ok(manifest.files.some(file => file.path === 'integrations/codex/assistance/artifact.mjs'));
  assert.ok(manifest.files.some(file => file.path === 'integrations/codex/skills/autopets-intro/SKILL.md'));
  assert.ok(!manifest.files.some(file => /(^|\/)(tests|node_modules|\.local)(\/|$)|connection\.json|\.sqlite3|setup\.exe/u.test(file.path)));
  const imported = await import(pathToFileURL(path.join(f.report.connector, 'integrations/codex/bootstrap/start.mjs')).href);
  assert.equal(typeof imported.connectInstalled, 'function');
  const config = await readJson(f.report.configPath);
  assert.equal(Object.values(config.bundle.resources)[0], 'connector/');
  await assert.rejects(stageDesktopResources({ root: f.root, node: f.fake, license: f.fake, out: f.app }), /empty directory/);
  await assert.rejects(fs.stat(f.env.CODEX_HOME), { code: 'ENOENT' });
});

test('verified connector manifests accept the same pinned beta version syntax as release metadata', async t => {
  const f = await fixture(t), file = path.join(f.report.connector, 'manifest.json');
  const manifest = await readJson(file);
  manifest.appVersion = '0.1.0-beta.1';
  await fs.writeFile(file, JSON.stringify(manifest));
  assert.equal((await verifyPackage(f.report.connector, { installedResource: true })).appVersion, '0.1.0-beta.1');
});

test('Windows PowerShell discovery preserves Korean and space characters without registry writes', { skip: process.platform !== 'win32' }, async () => {
  const result = await runPowerShellJson("[pscustomobject]@{ directory='C:\\사용자\\한글 폴더\\AutoPets'; version='0.1.0' } | ConvertTo-Json -Compress");
  assert.deepEqual(result, { directory: 'C:\\사용자\\한글 폴더\\AutoPets', version: '0.1.0' });
});

test('post-install connect, AI repeat and repair converge without another installer or duplicate hooks', async t => {
  const f = await fixture(t);
  const result = await connectInstalled(f.options);
  assert.equal(result.chatConnected, false);
  assert.equal(f.calls.filter(call => call === 'launch').length, 0);
  assert.equal(f.calls.at(-1).entryPoint, 'desktop');
  const manifestPath = path.join(f.managed, 'install-manifest.json');
  const installed = await readJson(manifestPath);
  assert.equal(installed.installSource, 'unknown');
  assert.equal(installed.updateOwner, 'autopets-signed-updater');
  assert.deepEqual(installed.connectionStates, [{ hostId: 'codex-windows-local', configured: true }]);
  const before = await fs.readFile(path.join(f.env.CODEX_HOME, 'hooks.json'), 'utf8');
  const skill = await fs.readFile(path.join(f.env.CODEX_HOME, 'skills/autopets/SKILL.md'), 'utf8');
  const executionLine = skill.split(/\r?\n/u).find(line => line.startsWith('실행 파일: '));
  assert.ok(executionLine, 'Registered skill must name its runtime executable');
  const skillRuntime = JSON.parse(executionLine.slice('실행 파일: '.length));
  assert.equal(await fs.realpath(skillRuntime), await fs.realpath(path.join(f.report.connector, 'runtime/node.exe')));
  await start({ ...f.options, root: f.managed });
  assert.equal(f.calls.filter(call => call === 'launch').length, 1);
  assert.equal(f.calls.at(-1).entryPoint, 'ai');
  assert.equal(await fs.readFile(path.join(f.env.CODEX_HOME, 'hooks.json'), 'utf8'), before);
  await fs.writeFile(path.join(f.managed, 'connector/runtime/LICENSE'), 'damaged');
  await connectInstalled(f.options);
  assert.equal(await fs.readFile(path.join(f.managed, 'connector/runtime/LICENSE'), 'utf8'), 'fixture runtime only');
  await disconnect({ root: f.managed, env: f.env });
  assert.deepEqual((await readJson(manifestPath)).connectionStates, [{ hostId: 'codex-windows-local', configured: false }]);
});

test('AI opens a fresh installed app before first connection without writing hooks or claiming connection', async t => {
  const f = await fixture(t);
  const state = { version: 1, installedVersion: '0.1.0', phase: 'not-started', appReady: true, chatConnected: false, guidanceDelivered: false };
  const driver = { ...f.driver, discover: async () => ({ directory: f.app, version: '0.1.0' }),
    bridge: async () => ({ state, begin: async () => { throw Error('Must not begin setup before user connects'); } }) };
  for (let call = 0; call < 2; call++) {
    const result = await start({ root: f.managed, env: f.env, driver, platform: 'win32', arch: 'x64' });
    assert.equal(result.ok, true); assert.equal(result.appReady, true);
    assert.equal(result.chatConnected, false); assert.equal(result.guidanceDelivered, false);
    assert.equal(result.nextAction, 'connect-in-app');
  }
  assert.equal(f.calls.filter(call => call === 'launch').length, 2);
  await assert.rejects(fs.stat(f.env.CODEX_HOME), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.managed, 'install-manifest.json')), { code: 'ENOENT' });
  await assert.rejects(start({ root: f.managed, env: f.env, driver: { ...driver, bridge: async () => ({ state: { ...state, installedVersion: '9.0.0' } }) }, platform: 'win32', arch: 'x64' }), /app-unavailable/);
  await assert.rejects(fs.stat(f.env.CODEX_HOME), { code: 'ENOENT' });
});

test('default install location can share the managed root without recopying its running runtime', async t => {
  const f = await fixture(t);
  const env = { ...f.env, AUTOPETS_HOME: f.app };
  const before = await fs.stat(path.join(f.report.connector, 'runtime/node.exe'));
  await connectInstalled({ ...f.options, root: f.app, env });
  await start({ root: f.app, env, driver: f.driver, platform: 'win32', arch: 'x64' });
  const after = await fs.stat(path.join(f.report.connector, 'runtime/node.exe'));
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal((await verifyPackage(f.report.connector, { installedResource: true })).appVersion, '0.1.0');
  assert.equal((await readJson(path.join(f.app, 'install-manifest.json'))).appDirectory, await fs.realpath(f.app));
});

test('unavailable app, wrong resource location and tampering never connect AI', async t => {
  const f = await fixture(t);
  await assert.rejects(connectInstalled({ ...f.options, driver: { bridge: async () => { throw Error('app-unavailable'); } } }), /app-unavailable/);
  await assert.rejects(fs.stat(f.env.CODEX_HOME), { code: 'ENOENT' });
  await assert.rejects(connectInstalled({ ...f.options, appExecutable: f.fake }), /installed-resource-path/);
  await fs.appendFile(path.join(f.report.connector, 'integrations/codex/bootstrap/user-hook.mjs'), '// changed');
  await assert.rejects(connectInstalled(f.options), /integrity/);
  await assert.rejects(fs.stat(f.env.CODEX_HOME), { code: 'ENOENT' });
});

test('public installer helper rejects unpublished channels before downloading or installing', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(f.root, 'scripts/fetch-installer.ps1'), '-ManifestPath', path.join(f.root, 'docs/releases/channel.json'), '-ValidateOnly'], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /verified public AutoPets release/u);
});

test('AI installer validates pinned publication declarations without execution', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), file = path.join(f.temporary, 'channel.json');
  const release = { version: '0.1.0', tag: 'v0.1.0', installer: { url: 'https://github.com/swaan-kim/autopets/releases/download/v0.1.0/AutoPets_0.1.0_x64-setup.exe', sha256: 'a'.repeat(64), authenticodeThumbprint: 'b'.repeat(40) },
    update: { url: 'https://swaan-kim.github.io/autopets/updates/windows-x64.json', publicKey: 'fixture-public-key' },
    evidence: Object.fromEntries(['cleanWindows', 'windowsExecution', 'codexTwoChats', 'guidanceDelivery', 'repairAndUninstall', 'authenticode', 'signedUpdater'].map(key => [key, true])), publishedAt: '2026-09-22T00:00:00Z' };
  const run = async value => {
    await fs.writeFile(file, JSON.stringify({ version: 2, platform: 'win32-x64', publicRelease: value }));
    return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(f.root, 'scripts/fetch-installer.ps1'), '-ManifestPath', file, '-ValidateOnly'], { encoding: 'utf8', windowsHide: true });
  };
  const valid = await run(release); assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).ok, true);
  assert.notEqual((await run({ ...release, installer: { ...release.installer, url: release.installer.url.replace('v0.1.0', 'latest') } })).status, 0);
  assert.notEqual((await run({ ...release, evidence: { ...release.evidence, cleanWindows: false } })).status, 0);
  assert.notEqual((await run({ ...release, publishedAt: 'not-a-date' })).status, 0);
  await assert.rejects(fs.stat(f.env.CODEX_HOME), { code: 'ENOENT' });
});
