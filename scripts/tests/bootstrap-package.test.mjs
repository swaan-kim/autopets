import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packageBootstrap } from '../package-bootstrap.mjs';

test('standalone setup ZIP imports without the checkout and validates every payload file', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-bootstrap-package-'));
  t.after(async () => { assert.equal(path.dirname(directory), os.tmpdir()); assert.ok(path.basename(directory).startsWith('autopets-bootstrap-package-')); await fs.rm(directory, { recursive: true, force: true }); });
  const fake = path.join(directory, 'fake-executable'); await fs.writeFile(fake, 'fixture only, never executed');
  const root = fileURLToPath(new URL('../../', import.meta.url)), out = path.join(directory, 'package.zip');
  const report = await packageBootstrap({ root, installer: fake, node: fake, license: fake, out });
  assert.equal(report.publicOneCallVerified, false);
  const bytes = await fs.readFile(out), extracted = path.join(directory, 'detached 한글'); let offset = 0; const names = [];
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0);
    const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + length).toString('utf8'), start = offset + 30 + length + extra;
    const file = path.resolve(extracted, name); assert.ok(file.startsWith(extracted + path.sep));
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes.subarray(start, start + size));
    names.push(name); offset = start + size;
  }
  assert.ok(names.includes('runtime/LICENSE'));
  assert.ok(!names.some(name => /(^|\/)(tests|node_modules|\.local)(\/|$)|connection\.json|\.sqlite3/u.test(name)));
  const packaged = await import(pathToFileURL(path.join(extracted, 'integrations/codex/bootstrap/start.mjs')).href);
  assert.equal((await packaged.verifyPackage(extracted)).appVersion, '0.1.0');
  await import(pathToFileURL(path.join(extracted, 'integrations/codex/assistance/prepare.mjs')).href);
  await fs.appendFile(path.join(extracted, 'packages/contracts/index.mjs'), '//tamper');
  await assert.rejects(packaged.verifyPackage(extracted), /integrity/);
});
