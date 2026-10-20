import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../install-preview.ps1', import.meta.url));
const commit = '1234567890abcdef1234567890abcdef12345678';
const tag = `v0.1.0-dev.20261020.${commit.slice(0, 12)}`;
const payload = 'isolated fixture, not an executable';
const hash = createHash('sha256').update(payload).digest('hex');
const manifest = () => ({
  schemaVersion: 1, channel: 'unsigned-preview', platform: 'win32-x64', repository: 'swaan-kim/autopets', sourceCommit: commit,
  release: { tag, publishedAt: '2026-10-20T00:00:00Z' },
  installer: { url: `https://github.com/swaan-kim/autopets/releases/download/${tag}/AutoPets_0.1.0_x64-setup.exe`, sha256: hash, authenticode: 'unsigned' },
  app: { identifier: 'local.autopets.desktop', sha256: hash },
});
const quote = value => `'${value.replaceAll("'", "''")}'`;
const windows = { skip: process.platform !== 'win32' };

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'autopets-preview-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'preview.json');
  const binary = path.join(dir, 'AutoPets.exe');
  await writeFile(file, JSON.stringify(manifest()));
  await writeFile(binary, payload);
  return { dir, file, binary };
}

async function run(t, { value = manifest(), before = '', action = 'Invoke-PreviewInstall $testManifest $true $false $false' } = {}) {
  const f = await fixture(t);
  await writeFile(f.file, JSON.stringify(value));
  const runner = path.join(f.dir, 'runner.ps1');
  await writeFile(runner, `\uFEFF
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$testManifest = ${quote(f.file)}
$testBinary = ${quote(f.binary)}
. ${quote(script)} -ManifestPath $testManifest
$testPublicationCheck = \${function:Assert-PreviewPublication}
$script:effects = New-Object 'System.Collections.Generic.List[string]'
function Assert-PreviewWindows {}
function Assert-PreviewPublication($Manifest) { $script:effects.Add('publication') }
function New-PreviewMutex {
  $lock = New-Object PSObject
  $lock | Add-Member ScriptMethod WaitOne { param($timeout) $true }
  $lock | Add-Member ScriptMethod ReleaseMutex { $script:effects.Add('release-lock') }
  $lock | Add-Member ScriptMethod Dispose {}
  return $lock
}
function Find-PreviewApp { return $testBinary }
function Get-AuthenticodeSignature { param($LiteralPath) return @{ Status = 'NotSigned' } }
function Get-Process { param($Name, $ErrorAction) return @() }
function Get-PreviewInstaller($Manifest) { $script:effects.Add('download'); Assert-PreviewFile $testBinary $Manifest.installer.sha256; return $testBinary }
function Start-Process { param($FilePath, $ArgumentList, [switch]$PassThru, [switch]$Wait, $WindowStyle)
  if ($Wait) { $script:effects.Add('install'); return @{ ExitCode = 0 } }
  $script:effects.Add('launch')
}
${before}
try { $result = ${action}; @{ ok=$true; result=$result; effects=@($script:effects.ToArray()) } | ConvertTo-Json -Depth 8 -Compress }
catch { @{ ok=$false; error=$_.Exception.Message; effects=@($script:effects.ToArray()) } | ConvertTo-Json -Depth 8 -Compress }
`, 'utf8');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', runner], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().replace(/^\uFEFF/u, ''));
}

test('preview manifest validation is offline and does not install or discover existing apps', windows, async t => {
  const result = await run(t, { action: 'Invoke-PreviewInstall $testManifest $false $true $false' });
  assert.equal(result.ok, true);
  assert.equal(result.result.stage, 'manifest-validated');
  assert.equal(result.result.connectionConfirmed, false);
  assert.deepEqual(result.effects, []);
});

test('preview validation rejects a substituted owner, tag, source, URL, channel, app or digest before effects', windows, async t => {
  const base = manifest();
  const changes = [
    { repository: 'someone/autopets' },
    { channel: 'stable' },
    { sourceCommit: 'f'.repeat(40) },
    { release: { ...base.release, tag: 'latest' } },
    { installer: { ...base.installer, url: base.installer.url.replace('github.com', 'github.com.evil.test') } },
    { installer: { ...base.installer, url: `${base.installer.url}?download=1` } },
    { installer: { ...base.installer, sha256: 'bad' } },
    { app: { ...base.app, identifier: 'other.app' } },
  ];
  for (const change of changes) {
    const result = await run(t, { value: { ...base, ...change }, action: 'Invoke-PreviewInstall $testManifest $true $true $false' });
    assert.equal(result.ok, false, JSON.stringify(change));
    assert.deepEqual(result.effects, []);
  }
});

test('unsigned preview requires an explicit opt-in before network or installation', windows, async t => {
  const result = await run(t, { action: 'Invoke-PreviewInstall $testManifest $false $false $false' });
  assert.equal(result.ok, false);
  assert.match(result.error, /AllowUnsignedPreview/u);
  assert.deepEqual(result.effects, []);
});

test('download-only verifies bytes and signature but does not install, launch or locate the app', windows, async t => {
  const result = await run(t, {
    before: 'function Find-PreviewApp { throw "must-not-inspect-existing-app" }',
    action: 'Invoke-PreviewInstall $testManifest $true $false $true',
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.stage, 'download-verified');
  assert.equal(result.result.installed, false);
  assert.deepEqual(result.effects, ['publication', 'download', 'release-lock']);
});

test('the exact installed preview is launched without reinstalling and without claiming a connection', windows, async t => {
  const result = await run(t);
  assert.equal(result.ok, true);
  assert.equal(result.result.alreadyInstalled, true);
  assert.equal(result.result.connectionConfirmed, false);
  assert.equal(result.result.stage, 'launch-requested');
  assert.deepEqual(result.effects, ['publication', 'launch', 'release-lock']);
});

test('a running previous installation is left alone', windows, async t => {
  const base = manifest();
  const result = await run(t, {
    value: { ...base, app: { ...base.app, sha256: 'f'.repeat(64) } },
    before: 'function Get-Process { param($Name, $ErrorAction) return @(@{ Id = 123 }) }',
    action: 'Invoke-PreviewInstall $testManifest $true $false $false $true',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Close AutoPets/u);
  assert.deepEqual(result.effects, ['publication', 'release-lock']);
});

test('unknown-age and signed existing installations are preserved', windows, async t => {
  const base = manifest();
  const value = { ...base, app: { ...base.app, sha256: 'f'.repeat(64) } };
  const unknown = await run(t, { value });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /age is unknown/u);
  assert.deepEqual(unknown.effects, ['publication', 'release-lock']);
  const signed = await run(t, {
    value,
    before: 'function Get-AuthenticodeSignature { param($LiteralPath) return @{ Status = "Valid" } }',
    action: 'Invoke-PreviewInstall $testManifest $true $false $false $true',
  });
  assert.equal(signed.ok, false);
  assert.match(signed.error, /existing signed/u);
  assert.deepEqual(signed.effects, ['publication', 'release-lock']);
});

test('tampered downloads and broken signatures never start the installer', windows, async t => {
  const base = manifest();
  for (const options of [
    { value: { ...base, installer: { ...base.installer, sha256: 'f'.repeat(64) } } },
    { before: 'function Get-AuthenticodeSignature { param($LiteralPath) return @{ Status = "HashMismatch" } }' },
  ]) {
    const result = await run(t, { ...options, action: 'Invoke-PreviewInstall $testManifest $true $false $true' });
    assert.equal(result.ok, false);
    assert.deepEqual(result.effects, ['publication', 'download', 'release-lock']);
  }
});

test('concurrent installation exits before network or process actions', windows, async t => {
  const result = await run(t, { before: `
function New-PreviewMutex {
  $lock = New-Object PSObject
  $lock | Add-Member ScriptMethod WaitOne { param($timeout) $false }
  $lock | Add-Member ScriptMethod Dispose {}
  return $lock
}` });
  assert.equal(result.ok, false);
  assert.match(result.error, /already in progress/u);
  assert.deepEqual(result.effects, []);
});

test('successful isolated setup verifies the installed executable before launch', windows, async t => {
  const result = await run(t, { before: `
$script:lookups = 0
function Find-PreviewApp { $script:lookups++; if ($script:lookups -eq 1) { return $null }; return $testBinary }
` });
  assert.equal(result.ok, true);
  assert.equal(result.result.alreadyInstalled, false);
  assert.deepEqual(result.effects, ['publication', 'download', 'install', 'launch', 'release-lock']);
});

test('setup failure or an unknown installed binary never launches or retries', windows, async t => {
  for (const before of [
    'function Find-PreviewApp { return $null }; function Start-Process { param($FilePath, $ArgumentList, [switch]$PassThru, [switch]$Wait, $WindowStyle) $script:effects.Add("install"); return @{ ExitCode = 2 } }',
    'function Find-PreviewApp { return $null }',
  ]) {
    const result = await run(t, { before });
    assert.equal(result.ok, false);
    assert.deepEqual(result.effects, ['publication', 'download', 'install', 'release-lock']);
  }
});

test('preview helper does not change the signed release gate or Windows and host trust', async () => {
  const source = await readFile(script, 'utf8');
  assert.doesNotMatch(source, /Set-ExecutionPolicy|ExecutionPolicy\s+Bypass|Unblock-File|Stop-Process|Remove-Item|Set-MpPreference|hooks\/trust|trust\.json/u);
  const stable = await readFile(fileURLToPath(new URL('../fetch-installer.ps1', import.meta.url)), 'utf8');
  assert.match(stable, /Assert-TrustedSignature/u);
  assert.doesNotMatch(stable, /AllowUnsignedPreview/u);
});

test('published preview requires the exact commit and one uploaded asset on a public prerelease', windows, async t => {
  const restore = `
Set-Item Function:Assert-PreviewPublication $testPublicationCheck
function Invoke-RestMethod { param($Uri, $Headers, $TimeoutSec)
  if ($Uri -like '*/commits/*') { return @{ sha = '${commit}' } }
  return @{ tag_name = '${tag}'; prerelease = $true; draft = $false;
    assets = @(@{ browser_download_url = '${manifest().installer.url}'; state = 'uploaded' }) }
}`;
  const valid = await run(t, { before: restore, action: 'Invoke-PreviewInstall $testManifest $true $false $true' });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.effects, ['download', 'release-lock']);
  for (const before of [
    restore.replace(`sha = '${commit}'`, `sha = '${'f'.repeat(40)}'`),
    restore.replace('draft = $false', 'draft = $true'),
    restore.replace('prerelease = $true', 'prerelease = $false'),
    restore.replace("state = 'uploaded'", "state = 'new'"),
  ]) {
    const result = await run(t, { before, action: 'Invoke-PreviewInstall $testManifest $true $false $true' });
    assert.equal(result.ok, false);
    assert.deepEqual(result.effects, ['release-lock']);
  }
});
