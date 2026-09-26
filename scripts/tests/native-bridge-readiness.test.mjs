import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const powershell = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const quote = value => `'${value.replaceAll("'", "''")}'`;
const ready = { appReady: true, chatConnected: false, guidanceDelivered: false };

async function check(t, respond, { seconds = 6, processChanged = false, processDies = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-readiness-한글 '));
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    respond(res, requests.length);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('autopets-readiness-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const connection = path.join(directory, 'connection.json');
  const evidence = path.join(directory, 'evidence.json');
  const driver = path.join(directory, 'driver.ps1');
  const fakeToken = 'synthetic-token-never-in-evidence';
  await fs.writeFile(connection, JSON.stringify({ version: 1, baseUrl: `http://127.0.0.1:${server.address().port}`, token: fakeToken }));
  // The helper observes this test PowerShell process, never an installed app.
  await fs.writeFile(driver, `\ufeff$ErrorActionPreference = 'Stop'
. ${quote(path.join(root, 'scripts/native-bridge-readiness.ps1'))}
$taskSelf = ${processDies ? "Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Milliseconds 500') -WindowStyle Hidden -PassThru" : 'Get-Process -Id $PID'}
try {
  $taskStartedAt = $taskSelf.StartTime${processChanged ? '.AddSeconds(-1)' : ''}
  $null = Wait-NativeBridgeReady -AppProcessId $taskSelf.Id -AppStartedAt $taskStartedAt -AppPath $taskSelf.Path -ConnectionFile ${quote(connection)} -EvidenceFile ${quote(evidence)} -Seconds ${seconds}
} catch { }
${processDies ? 'finally { if (-not $taskSelf.HasExited) { $taskSelf.Kill(); [void]$taskSelf.WaitForExit(5000) } }' : ''}
`);
  await execute(powershell, ['-NoProfile', '-NonInteractive', '-File', driver], { windowsHide: true, timeout: (seconds + 8) * 1000 });
  const raw = await fs.readFile(evidence, 'utf8');
  assert.ok(!raw.includes(fakeToken), 'diagnostics must not contain the credential');
  assert.ok(!raw.includes('baseUrl'), 'diagnostics need no raw connection object');
  assert.ok(requests.every(request => request.method === 'GET' && request.url === '/v1/setup'));
  return { result: JSON.parse(raw.replace(/^\uFEFF/u, '')), requests };
}

test('native readiness records a bounded timeout then a successful GET without replaying mutations', { skip: process.platform !== 'win32' }, async t => {
  // Leave room for cold PowerShell/HTTP initialization on shared Windows runners.
  // The request timeout remains two seconds; permanent-timeout tests stay strict.
  const seconds = 12;
  const { result, requests } = await check(t, (res, count) => {
    if (count === 1) return; // A synthetic unresponsive HTTP handler.
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(ready));
  }, { seconds });
  assert.equal(result.outcome, 'passed', JSON.stringify(result));
  assert.equal(requests.length, 2);
  assert.equal(result.attempts[0].result, 'transport-not-ready');
  assert.equal(result.attempts[0].transportStatus, 'Timeout');
  assert.equal(result.attempts.at(-1).result, 'ready');
  assert.ok(result.elapsedSeconds >= 2 && result.elapsedSeconds < seconds);
});

test('native readiness retains permanent timeout as failure within its overall deadline', { skip: process.platform !== 'win32' }, async t => {
  const { result, requests } = await check(t, () => {}, { seconds: 2 });
  assert.equal(result.outcome, 'failed');
  assert.ok(requests.length >= 1);
  assert.ok(result.elapsedSeconds < 2.5);
  assert.ok(result.attempts.some(attempt => attempt.transportStatus === 'Timeout'));
});

test('native readiness never retries authentication, malformed JSON, or semantic failures', { skip: process.platform !== 'win32' }, async t => {
  for (const [status, body, expected] of [
    [401, '{}', 'fatal-http-error'],
    [403, '{}', 'fatal-http-error'],
    [200, '{broken', 'invalid-response-json'],
    [200, JSON.stringify({ ...ready, chatConnected: true }), 'unexpected-setup-state'],
    [200, JSON.stringify({ ...ready, appReady: false }), 'unexpected-setup-state'],
  ]) {
    const { result, requests } = await check(t, res => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body); });
    assert.equal(result.outcome, 'failed');
    assert.equal(result.attempts.at(-1).result, expected);
    assert.equal(requests.length, 1);
  }
});

test('native readiness rejects changed process identity before any HTTP request', { skip: process.platform !== 'win32' }, async t => {
  const { result, requests } = await check(t, res => res.end(JSON.stringify(ready)), { processChanged: true });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.attempts[0].result, 'app-exited-or-changed');
  assert.equal(requests.length, 0);
});

test('native readiness stops retrying when the synthetic app process exits', { skip: process.platform !== 'win32' }, async t => {
  const { result, requests } = await check(t, () => {}, { processDies: true });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.attempts[0].result, 'transport-not-ready');
  assert.equal(result.attempts.at(-1).result, 'app-exited-or-changed');
  assert.equal(requests.length, 1);
});
