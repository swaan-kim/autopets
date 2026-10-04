import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const script = path.join(root, 'scripts/check-windows-signatures.ps1');
const powershell = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const native = { skip: process.platform !== 'win32' };
const quote = value => `'${value.replaceAll("'", "''")}'`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parseJson = text => JSON.parse(text.replace(/^\uFEFF/u, ''));
const unsignedBytes = Buffer.alloc(512);
unsignedBytes.write('MZ');
unsignedBytes.write('Unsigned audit fixture. Never launch this file.', 64);

async function workspace(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-signatures-한글 '));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('autopets-signatures-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function runAudit(directory, installer, options = {}) {
  const report = options.report ?? path.join(directory, `report-${randomUUID()}.json`);
  const args = ['-NoProfile', '-NonInteractive', '-File', script, '-Installer', installer, '-ReportPath', report];
  if (options.payload) args.push('-InstalledDirectory', options.payload);
  if (options.publisher !== undefined) args.push('-ExpectedPublisher', options.publisher);
  if (options.thumbprint !== undefined) args.push('-ExpectedThumbprint', options.thumbprint);
  if (options.inventory) args.push('-InventoryOnly');
  let exitCode = 0;
  let output;
  try { output = await execute(powershell, args, { cwd: root, windowsHide: true, timeout: 45000 }); }
  catch (error) {
    assert.equal(typeof error.code, 'number', `PowerShell did not exit normally: ${error.code}`);
    exitCode = error.code;
    output = error;
  }
  let raw;
  try { raw = await fs.readFile(report, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (raw) {
    assert.ok(!raw.includes(directory), 'absolute input/report paths must not appear in evidence');
    assert.ok(!raw.includes(directory.replaceAll('\\', '\\\\')), 'escaped absolute paths must not appear in evidence');
  }
  return { exitCode, result: raw ? parseJson(raw) : undefined, stdout: output.stdout, stderr: output.stderr, report };
}

async function payload(directory, source) {
  const target = path.join(directory, 'payload');
  await fs.mkdir(path.join(target, 'connector/runtime'), { recursive: true });
  for (const relative of ['autopets.exe', 'uninstall.exe', 'connector/runtime/node.exe']) {
    const file = path.join(target, relative);
    if (source) await fs.copyFile(source, file);
    else await fs.writeFile(file, unsignedBytes);
  }
  return target;
}

test('Windows signature audit parses as PowerShell and contains no execution or security mutation commands', native, async t => {
  const directory = await workspace(t);
  const driver = path.join(directory, 'parse.ps1');
  await fs.writeFile(driver, `\ufeff$taskTokens = $null
$taskErrors = $null
$taskAst = [Management.Automation.Language.Parser]::ParseFile(${quote(script)}, [ref]$taskTokens, [ref]$taskErrors)
$taskCommands = @($taskAst.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] }, $true))
[ordered]@{ errors = @($taskErrors | ForEach-Object { $_.Message }); commands = @($taskCommands | ForEach-Object { $_.GetCommandName() }); invocationOperators = @($taskCommands | Where-Object { $_.InvocationOperator.ToString() -ne 'Unknown' } | ForEach-Object { $_.InvocationOperator.ToString() }) } | ConvertTo-Json -Depth 4
`);
  const { stdout } = await execute(powershell, ['-NoProfile', '-NonInteractive', '-File', driver], { windowsHide: true, timeout: 15000 });
  const parsed = parseJson(stdout);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.invocationOperators, []);
  for (const command of parsed.commands) {
    assert.ok(command, 'computed command invocation is not allowed');
    assert.doesNotMatch(command, /^(?:Start-Process|Invoke-|Set-AuthenticodeSignature|Set-ExecutionPolicy|Unblock-File|Import-Certificate|Import-PfxCertificate|New-SelfSignedCertificate|Add-Type|Remove-Item|Copy-Item|Move-Item|Set-Content|Out-File|reg|signtool|certutil|cmd|powershell|pwsh)/iu);
  }
  assert.ok(parsed.commands.includes('Get-AuthenticodeSignature'));
});

test('strict audit requires an exact publisher and rejects native unsigned bytes; inventory cannot claim readiness', native, async t => {
  const directory = await workspace(t);
  const installer = path.join(directory, 'setup.exe');
  await fs.writeFile(installer, unsignedBytes);
  for (const options of [{}, { publisher: 'CN=AutoPets Test' }, { inventory: true }, { publisher: '*AutoPets*' }]) {
    const { exitCode, result } = await runAudit(directory, installer, options);
    assert.equal(exitCode, options.inventory ? 0 : 1);
    assert.equal(result.signatureReady, false);
    assert.equal(result.publicReleaseReady, false);
    assert.equal(result.runtimePolicyVerified, false);
    assert.equal(result.smartAppControlVerified, false);
    assert.equal(result.installedPayloadComplete, false);
    assert.equal(result.files[0].sha256, hash(unsignedBytes));
    assert.equal(result.files[0].bytes, unsignedBytes.length);
    assert.notEqual(result.files[0].signatureStatus, 'Valid');
    assert.ok(result.failures.some(item => item.code === 'signature-not-valid'));
    assert.ok(result.failures.some(item => item.code === 'first-party-timestamp-missing'));
    if (!options.publisher && !options.inventory) assert.ok(result.failures.some(item => item.code === 'expected-publisher-required'));
    if (options.publisher === '*AutoPets*') assert.ok(result.failures.some(item => item.code === 'invalid-expected-publisher'));
  }
  assert.equal(hash(await fs.readFile(installer)), hash(unsignedBytes));
});

test('payload inventory includes every nested executable type and ignores self-reported signed JSON', native, async t => {
  const directory = await workspace(t);
  const installer = path.join(directory, 'setup.exe');
  await fs.writeFile(installer, unsignedBytes);
  const installed = await payload(directory);
  await fs.mkdir(path.join(installed, 'nested/deeper'), { recursive: true });
  await fs.writeFile(path.join(installed, 'nested/deeper/library.DLL'), unsignedBytes);
  await fs.writeFile(path.join(installed, 'nested/addon.node'), unsignedBytes);
  const declaration = JSON.stringify({ signed: true, signatureReady: true, publisher: 'CN=AutoPets Test' });
  await fs.writeFile(path.join(installed, 'release.json'), declaration);
  const { exitCode, result } = await runAudit(directory, installer, { payload: installed, publisher: 'CN=AutoPets Test', inventory: true });
  assert.equal(exitCode, 0);
  assert.equal(result.signatureReady, false);
  assert.equal(result.installedPayloadComplete, true);
  assert.equal(result.files.length, 6);
  assert.ok(result.files.every(item => item.sha256 === hash(unsignedBytes)));
  assert.ok(result.files.some(item => item.file === 'payload/nested/deeper/library.DLL'));
  assert.ok(result.files.some(item => item.file === 'payload/nested/addon.node'));
  assert.equal(await fs.readFile(path.join(installed, 'release.json'), 'utf8'), declaration);
});

test('incomplete and missing payloads fail even if a supplied executable has a valid Windows signature', native, async t => {
  const directory = await workspace(t);
  const empty = path.join(directory, 'empty');
  await fs.mkdir(empty);
  for (const installed of [empty, path.join(directory, 'missing')]) {
    const { exitCode, result } = await runAudit(directory, powershell, { payload: installed, publisher: 'CN=AutoPets Test' });
    assert.equal(exitCode, 1);
    assert.equal(result.signatureReady, false);
    assert.equal(result.installedPayloadComplete, false);
    if (installed === empty) {
      assert.deepEqual(result.failures.filter(item => item.code === 'required-file-missing').map(item => item.file).sort(),
        ['payload/autopets.exe', 'payload/connector/runtime/node.exe', 'payload/uninstall.exe']);
    } else assert.ok(result.failures.some(item => item.code === 'payload-directory-missing'));
  }
});

test('valid native signatures still require full first-party publisher and optional thumbprint matches', native, async t => {
  const directory = await workspace(t);
  const installed = await payload(directory, powershell);
  const initial = await runAudit(directory, powershell, { payload: installed, inventory: true });
  assert.equal(initial.exitCode, 0);
  assert.equal(initial.result.signatureReady, false, 'inventory without a publisher pin does not prove publisher identity');
  const entry = initial.result.files.find(item => item.file === 'installer');
  assert.equal(entry.signatureStatus, 'Valid', 'Windows PowerShell itself must have a valid OS signature for this native fixture');
  assert.ok(entry.signer.subject);
  assert.match(entry.signer.thumbprint, /^[A-Fa-f0-9]{40}$/u);
  assert.equal(typeof entry.timestamp.present, 'boolean');
  assert.equal(entry.timestamp.signedAtUtc, null);
  for (const options of [
    { publisher: 'CN=This Is Not The Windows Publisher', expectedCode: 'first-party-publisher-mismatch' },
    { publisher: entry.signer.subject, thumbprint: '0'.repeat(40), expectedCode: 'first-party-thumbprint-mismatch' },
    { publisher: entry.signer.subject, thumbprint: 'not-a-thumbprint', expectedCode: 'invalid-expected-thumbprint' },
  ]) {
    const audited = await runAudit(directory, powershell, { payload: installed, ...options });
    assert.equal(audited.exitCode, 1);
    assert.equal(audited.result.signatureReady, false);
    assert.ok(audited.result.failures.some(item => item.code === options.expectedCode));
    if (options.expectedCode.startsWith('first-party')) {
      assert.equal(audited.result.failures.filter(item => item.code === options.expectedCode).length, 3);
    }
  }
  const passed = await runAudit(directory, powershell, { payload: installed, publisher: entry.signer.subject, thumbprint: entry.signer.thumbprint });
  assert.equal(passed.exitCode, 0, JSON.stringify(passed.result));
  assert.equal(passed.result.signatureReady, true);
  assert.equal(passed.result.publicReleaseReady, false);
  assert.equal(passed.result.runtimePolicyVerified, false);
  assert.equal(passed.result.smartAppControlVerified, false);
  const installerOnly = await runAudit(directory, powershell, { publisher: entry.signer.subject });
  assert.equal(installerOnly.exitCode, 1);
  assert.equal(installerOnly.result.signatureReady, false, 'installer-only success does not inspect installed payload');
  assert.ok(installerOnly.result.failures.some(item => item.code === 'required-payload-not-supplied'));
});

test('audit rejects reparse payload escapes and refuses to write into the audited payload or replace evidence', native, async t => {
  const directory = await workspace(t);
  const installed = await payload(directory);
  const shortPathDriver = path.join(directory, 'short-path.ps1');
  await fs.writeFile(shortPathDriver, `\ufeff[Console]::OutputEncoding = New-Object Text.UTF8Encoding
$taskFileSystem = New-Object -ComObject Scripting.FileSystemObject
try { [ordered]@{ shortPath = $taskFileSystem.GetFolder(${quote(installed)}).ShortPath } | ConvertTo-Json }
finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskFileSystem) }
`);
  const shortPathOutput = await execute(powershell, ['-NoProfile', '-NonInteractive', '-File', shortPathDriver], { windowsHide: true, timeout: 15000 });
  const shortInstalled = parseJson(shortPathOutput.stdout).shortPath;
  const shortInventory = await runAudit(directory, powershell, { payload: shortInstalled, inventory: true });
  assert.equal(shortInventory.exitCode, 0);
  assert.equal(shortInventory.result.installedPayloadComplete, true, JSON.stringify(shortInventory.result));
  assert.equal(shortInventory.result.files.length, 4);
  for (const [inputPath, report] of [[shortInstalled, path.join(installed, 'short-input.json')], [installed, path.join(shortInstalled, 'short-output.json')]]) {
    const denied = await runAudit(directory, powershell, { payload: inputPath, inventory: true, report });
    assert.equal(denied.exitCode, 2);
    await assert.rejects(fs.stat(report), { code: 'ENOENT' });
  }
  const outside = path.join(directory, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'never-audit.exe'), unsignedBytes);
  const junction = path.join(installed, 'escaped');
  await fs.symlink(outside, junction, 'junction');
  const audited = await runAudit(directory, powershell, { payload: installed, publisher: 'CN=AutoPets Test' });
  assert.equal(audited.exitCode, 1);
  assert.equal(audited.result.installedPayloadComplete, false);
  assert.ok(audited.result.failures.some(item => item.code === 'reparse-point-rejected'));
  assert.ok(!audited.result.files.some(item => item.file.includes('never-audit')));
  const rootLink = path.join(directory, 'payload-link');
  await fs.symlink(installed, rootLink, 'junction');
  const linked = await runAudit(directory, powershell, { payload: rootLink, inventory: true });
  assert.equal(linked.result.signatureReady, false);
  assert.ok(linked.result.failures.some(item => item.code === 'reparse-point-rejected' && item.file === 'payload'));
  for (const report of [path.join(installed, 'audit.json'), audited.report]) {
    const original = await fs.readFile(report).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const refused = await runAudit(directory, powershell, { payload: installed, inventory: true, report });
    assert.equal(refused.exitCode, 2);
    if (original) assert.deepEqual(await fs.readFile(report), original);
    else await assert.rejects(fs.stat(report), { code: 'ENOENT' });
  }
  assert.deepEqual(await fs.readFile(path.join(outside, 'never-audit.exe')), unsignedBytes);
});

test('an explicitly supplied real unsigned Windows installer is audited without launching it', {
  skip: process.platform !== 'win32' || !process.env.AUTOPETS_SIGNATURE_TEST_INSTALLER,
}, async t => {
  const directory = await workspace(t);
  const installer = path.resolve(process.env.AUTOPETS_SIGNATURE_TEST_INSTALLER);
  const before = await fs.readFile(installer);
  assert.equal(before.subarray(0, 2).toString(), 'MZ');
  assert.equal(before.subarray(before.readUInt32LE(0x3c), before.readUInt32LE(0x3c) + 4).toString(), 'PE\0\0');
  const audited = await runAudit(directory, installer, { publisher: 'CN=AutoPets Test' });
  assert.equal(audited.exitCode, 1);
  assert.equal(audited.result.files[0].signatureStatus, 'NotSigned');
  assert.equal(audited.result.files[0].sha256, hash(before));
  assert.equal(audited.result.files[0].bytes, before.length);
  assert.equal(audited.result.signatureReady, false);
  assert.equal(audited.result.publicReleaseReady, false);
  assert.equal(hash(await fs.readFile(installer)), hash(before));
});
