import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const powershell = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const quote = value => `'${value.replaceAll("'", "''")}'`;

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-watchdog-한글 '));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('autopets-watchdog-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function supervise(directory, workerBody, postlude = '') {
  const worker = path.join(directory, 'worker.ps1');
  const driver = path.join(directory, 'driver.ps1');
  await fs.writeFile(worker, `\ufeff$ErrorActionPreference = 'Stop'\n${workerBody}\n`);
  await fs.writeFile(driver, `\ufeff$ErrorActionPreference = 'Stop'
. ${quote(path.join(root, 'scripts/native-lifecycle-watchdog.ps1'))}
$taskResult = Invoke-LifecycleWorker -ScriptFile ${quote(worker)} -EvidenceDirectory ${quote(directory)} -StartupSeconds 4 -MaximumSeconds 10
${postlude}
$taskResult | ConvertTo-Json -Compress
`);
  const { stdout } = await execute(powershell, ['-NoProfile', '-NonInteractive', '-File', driver], { windowsHide: true, timeout: 20000 });
  return JSON.parse(stdout.trim().split(/\r?\n/u).at(-1));
}

test('native watchdog preserves completed and failed worker exit codes without UI access', { skip: process.platform !== 'win32' }, async t => {
  const first = await supervise(await fixture(t), 'exit 0');
  assert.equal(first.timedOut, false);
  assert.equal(first.workerExitCode, 0);
  assert.equal(first.workerTerminated, false);
  const second = await supervise(await fixture(t), 'exit 7');
  assert.equal(second.timedOut, false);
  assert.equal(second.workerExitCode, 7);
  assert.equal(second.appTerminationRequested, false);
});

test('blocked native observation times out and reclaims only its worker, preserving app-like child', { skip: process.platform !== 'win32' }, async t => {
  const directory = await fixture(t);
  const sentinelScript = path.join(directory, 'sentinel.ps1');
  const sentinelPid = path.join(directory, 'sentinel-pid.txt');
  const phase = path.join(directory, 'phase.json');
  await fs.writeFile(sentinelScript, 'Start-Sleep -Seconds 60\n');
  // The sentinel is a synthetic process, never an AutoPets/user application.
  // The test driver cleans it only after proving the watchdog left it alive.
  const result = await supervise(directory, `
$taskChild = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile', '-NonInteractive', '-File', ('"' + ${quote(sentinelScript)} + '"')) -WindowStyle Hidden -PassThru
$taskChild.Id | Set-Content -LiteralPath ${quote(sentinelPid)}
@{ name = 'restart-uia-ready'; startedAt = [DateTime]::UtcNow.ToString('O'); timeoutSeconds = 1 } | ConvertTo-Json | Set-Content -LiteralPath ${quote(phase)}
Start-Sleep -Seconds 60
`, `
$taskSentinel = Get-Process -Id ([int](Get-Content -LiteralPath ${quote(sentinelPid)})) -ErrorAction Stop
try { $taskResult | Add-Member NoteProperty syntheticChildSurvived (-not $taskSentinel.HasExited) }
finally { $taskSentinel.Kill(); [void]$taskSentinel.WaitForExit(5000) }
`);
  assert.equal(result.timedOut, true);
  assert.equal(result.phase, 'restart-uia-ready');
  assert.equal(result.workerTerminated, true);
  assert.equal(result.appTerminationRequested, false);
  assert.equal(result.syntheticChildSurvived, true);
  assert.ok(result.elapsedSeconds < 8, 'the blocked provider must not consume the CI job timeout');
});
