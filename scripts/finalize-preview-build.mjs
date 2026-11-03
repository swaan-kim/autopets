// CI metadata only. Never patches, installs or launches an executable.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const readJson = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function finalizePreviewBuild(build, evidence, installerHash, installerBytes) {
  if (build?.schemaVersion !== 1 || !/^[a-f0-9]{40}$/u.test(build.sourceCommit ?? '')
      || !sha256(build.installerSha256) || !Number.isSafeInteger(build.installerBytes) || build.installerBytes <= 0) {
    throw Error('Invalid preview build identity');
  }
  // The fallback permits explicit correction of an old artifact manifest:
  // its appSha256 was the restored, unbundled build output.
  const unbundled = build.unbundledAppSha256 ?? build.appSha256;
  if (!sha256(unbundled)) throw Error('Unbundled application hash is missing');
  if (evidence?.schemaVersion !== 1 || evidence.method !== 'windows-nsis-install'
      || !sha256(evidence.appSha256) || !Number.isSafeInteger(evidence.appBytes) || evidence.appBytes <= 0) {
    throw Error('Actual installed payload evidence is required');
  }
  if (installerHash !== build.installerSha256 || evidence.installerSha256 !== installerHash
      || installerBytes !== build.installerBytes) {
    throw Error('Installed payload evidence does not match the packaged installer');
  }
  return {
    ...build,
    appSha256: evidence.appSha256,
    unbundledAppSha256: unbundled,
    appBytes: evidence.appBytes,
    appHashSource: 'windows-installed-nsis-payload',
  };
}

export async function finalizePreviewArtifacts({ directory, evidenceFile }) {
  const manifestFile = path.join(directory, 'preview-build.json');
  const build = await readJson(manifestFile), evidence = await readJson(evidenceFile);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  if (entries.some(entry => entry.isSymbolicLink())) throw Error('Linked artifacts are not allowed');
  const installers = entries.filter(entry => entry.isFile() && /-setup\.exe$/iu.test(entry.name));
  if (installers.length !== 1) throw Error('Expected exactly one staged NSIS installer');
  const installer = path.join(directory, installers[0].name);
  const result = finalizePreviewBuild(build, evidence, await hashFile(installer), (await fs.stat(installer)).size);
  await fs.writeFile(manifestFile, JSON.stringify(result, null, 2) + '\n');
  // Include the finalized manifest and late installation evidence; exclude the
  // checksum file itself when correcting an already staged artifact directory.
  const checksums = [];
  for (const entry of entries.filter(item => item.isFile() && item.name !== 'SHA256SUMS.txt').sort((a, b) => a.name.localeCompare(b.name))) {
    checksums.push(`${await hashFile(path.join(directory, entry.name))}  ${entry.name}`);
  }
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
  return result;
}

async function main() {
  const args = process.argv.slice(2), options = {};
  while (args.length) {
    const flag = args.shift();
    if (!['--directory', '--evidence'].includes(flag) || !args.length || options[flag]) throw Error('Expected one artifact directory and evidence file');
    options[flag] = path.resolve(args.shift());
  }
  if (!options['--directory'] || !options['--evidence']) throw Error('Artifact directory and installed payload evidence are required');
  const result = await finalizePreviewArtifacts({ directory: options['--directory'], evidenceFile: options['--evidence'] });
  console.log(JSON.stringify({ sourceCommit: result.sourceCommit, appSha256: result.appSha256, unbundledAppSha256: result.unbundledAppSha256, appHashSource: result.appHashSource }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
