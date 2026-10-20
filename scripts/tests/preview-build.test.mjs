import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { finalizePreviewBuild, finalizePreviewArtifacts } from '../finalize-preview-build.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const installer = Buffer.from('fixture installer; never executed');
const unbundled = hash('fixture main binary __TAURI_BUNDLE_TYPE_VAR_UNK');
const installed = hash('fixture main binary __TAURI_BUNDLE_TYPE_VAR_NSS');
const build = () => ({ schemaVersion: 1, sourceCommit: 'a'.repeat(40), unbundledAppSha256: unbundled, installerSha256: hash(installer), installerSignature: 'NotSigned', installerBytes: installer.length });
const evidence = () => ({ schemaVersion: 1, method: 'windows-nsis-install', installerSha256: hash(installer), appSha256: installed, appBytes: 1234 });

test('preview expects installed NSIS bytes and retains the different unbundled hash', () => {
  const result = finalizePreviewBuild(build(), evidence(), hash(installer), installer.length);
  assert.equal(result.appSha256, installed);
  assert.equal(result.unbundledAppSha256, unbundled);
  assert.notEqual(result.appSha256, result.unbundledAppSha256);
  assert.equal(result.sourceCommit, build().sourceCommit);
  assert.equal(result.installerSha256, hash(installer));
  assert.equal(result.appHashSource, 'windows-installed-nsis-payload');
  const legacy = build();
  delete legacy.unbundledAppSha256;
  legacy.appSha256 = unbundled;
  assert.deepEqual(finalizePreviewBuild(legacy, evidence(), hash(installer), installer.length), result);
});

test('unobserved or different-installer payloads cannot finalize the preview', () => {
  for (const invalid of [undefined, {}, { ...evidence(), method: 'build-output' }, { ...evidence(), appSha256: 'invalid' }, { ...evidence(), appBytes: 0 }]) {
    assert.throws(() => finalizePreviewBuild(build(), invalid, hash(installer), installer.length), /installed payload evidence/u);
  }
  assert.throws(() => finalizePreviewBuild(build(), { ...evidence(), installerSha256: 'b'.repeat(64) }, hash(installer), installer.length), /does not match/u);
  assert.throws(() => finalizePreviewBuild(build(), evidence(), 'c'.repeat(64), installer.length), /does not match/u);
  assert.throws(() => finalizePreviewBuild(build(), evidence(), hash(installer), installer.length + 1), /does not match/u);
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-preview-build-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('autopets-preview-build-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const evidenceFile = path.join(directory, 'bootstrap-installed-payload.json');
  await fs.writeFile(path.join(directory, 'AutoPets_0.1.0_x64-setup.exe'), installer);
  await fs.writeFile(path.join(directory, 'preview-build.json'), '\uFEFF' + JSON.stringify(build()));
  await fs.writeFile(evidenceFile, JSON.stringify(evidence()));
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), 'old checksums\n');
  return { directory, evidenceFile };
}

test('artifact finalization hashes the final manifest and late installed evidence without executing fixtures', async t => {
  const f = await fixture(t);
  await finalizePreviewArtifacts(f);
  const manifest = JSON.parse(await fs.readFile(path.join(f.directory, 'preview-build.json'), 'utf8'));
  assert.equal(manifest.appSha256, installed);
  const lines = (await fs.readFile(path.join(f.directory, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 3);
  for (const line of lines) {
    const [digest, name] = line.split('  ');
    assert.notEqual(name, 'SHA256SUMS.txt');
    assert.equal(digest, hash(await fs.readFile(path.join(f.directory, name))));
  }
  assert.equal(hash(await fs.readFile(path.join(f.directory, 'AutoPets_0.1.0_x64-setup.exe'))), hash(installer));
});

test('mismatched actual installer preserves the staged manifest and checksums', async t => {
  const f = await fixture(t);
  const manifestFile = path.join(f.directory, 'preview-build.json'), sumsFile = path.join(f.directory, 'SHA256SUMS.txt');
  const before = await fs.readFile(manifestFile), sums = await fs.readFile(sumsFile);
  await fs.writeFile(path.join(f.directory, 'AutoPets_0.1.0_x64-setup.exe'), 'different installer');
  await assert.rejects(finalizePreviewArtifacts(f), /does not match/u);
  assert.deepEqual(await fs.readFile(manifestFile), before);
  assert.deepEqual(await fs.readFile(sumsFile), sums);
});
