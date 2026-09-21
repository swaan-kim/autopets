import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { packageChatGPT } from '../scripts/package.mjs';
import { encodeFrame } from '../native/framing.mjs';
import { defaultPreferences } from '../../../packages/contracts/index.mjs';

async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'autopets-package-test-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith('autopets-package-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
async function extractStoredZip(file, directory) {
  const data = await readFile(file), files = [];
  let offset = 0;
  while (data.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(data.readUInt16LE(offset + 8), 0, 'packager uses stored ZIP entries');
    const bytes = data.readUInt32LE(offset + 18), nameLength = data.readUInt16LE(offset + 26), extra = data.readUInt16LE(offset + 28);
    const name = data.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const target = path.resolve(directory, name);
    assert.ok(target.startsWith(path.resolve(directory) + path.sep));
    const begin = offset + 30 + nameLength + extra;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data.subarray(begin, begin + bytes));
    files.push(name); offset = begin + bytes;
  }
  assert.equal(data.readUInt32LE(offset), 0x02014b50);
  return files;
}
function child(file, args, input = Buffer.alloc(0), cwd = path.dirname(file)) {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, [file, ...args], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    const timeout = setTimeout(() => { processChild.kill(); reject(Error('packaged child timeout')); }, 7000);
    processChild.stdout.on('data', part => stdout.push(part)); processChild.stderr.on('data', part => stderr.push(part));
    processChild.once('error', reject);
    processChild.once('close', code => { clearTimeout(timeout); resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8') }); });
    processChild.stdin.on('error', () => {}); processChild.stdin.end(input);
  });
}

test('extracted ChatGPT companion uses its packaged transport and framed loopback connection', async (t) => {
  const directory = await temporary(t), out = path.join(directory, 'archives'), extracted = path.join(directory, 'extracted 한글');
  const report = await packageChatGPT({ out });
  assert.equal(report.installed, false); assert.equal(report.liveMutation, false);
  const files = await extractStoredZip(path.join(out, 'AutoPets-chatgpt-companion.zip'), extracted);
  assert.ok(files.includes('integrations/codex/skills/autopets/scripts/bridge-client.mjs'));
  assert.ok(!files.includes('skills/autopets/scripts/bridge-client.mjs'));
  const token = 'package-fixture-secret-0123456789abcdef';
  const received = [];
  const server = createServer((req, res) => {
    received.push({ path: req.url, authorization: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ preferences: defaultPreferences(), capabilities: {} }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const connection = path.join(directory, 'connection.json');
  await writeFile(connection, JSON.stringify({ version: 1, token, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  const origin = `chrome-extension://${'a'.repeat(32)}/`;
  await writeFile(path.join(extracted, 'integrations/chatgpt/native/host-config.json'), JSON.stringify({ version: 1, allowedOrigin: origin, connectionPath: connection }));
  const result = await child(path.join(extracted, 'integrations/chatgpt/native/host.mjs'), [origin], encodeFrame({ version: 1, id: 'packaged-1', type: 'status' }));
  assert.equal(result.code, 0); assert.equal(result.stderr, '');
  const bytes = result.stdout.readUInt32LE(0);
  assert.equal(result.stdout.length, bytes + 4);
  const response = JSON.parse(result.stdout.subarray(4));
  assert.equal(response.id, 'packaged-1'); assert.equal(response.ok, true);
  assert.equal(received.length, 1); assert.equal(received[0].path, '/v1/assistance-status');
  assert.equal(received[0].authorization, `Bearer ${token}`); assert.ok(!result.stdout.includes(token));
  const install = await child(path.join(extracted, 'integrations/chatgpt/native/install.mjs'), ['--dry-run', '--extension-id', 'a'.repeat(32), '--destination', path.join(directory, 'install-target'), '--connection', connection]);
  assert.equal(install.code, 0); assert.equal(JSON.parse(install.stdout).mode, 'dry-run');
});

test('extension ZIP contains only runtime policy modules and imports without repository files', async (t) => {
  const directory = await temporary(t), out = path.join(directory, 'archives'), extracted = path.join(directory, 'extension');
  const report = await packageChatGPT({ out });
  assert.ok(report.extensionFiles.every(name => !/(^|\/)(node_modules|tests|types)(\/|$)|package\.json|\.test\.mjs/u.test(name)));
  await extractStoredZip(path.join(out, 'AutoPets-chatgpt-extension.zip'), extracted);
  const guidance = await import(pathToFileURL(path.join(extracted, 'vendor/guidance/index.mjs')).href);
  const contracts = await import(pathToFileURL(path.join(extracted, 'vendor/contracts/index.mjs')).href);
  const recipe = guidance.classifyTask('짧게 요약해줘');
  assert.equal(recipe.id, 'simple');
  const output = guidance.buildGuidance({ recipe, preferences: { ...contracts.defaultPreferences(), enabled: true } });
  assert.ok(output.length > 0); assert.ok(contracts.utf8Bytes(output) <= contracts.MAX_INJECTION_BYTES);
});
