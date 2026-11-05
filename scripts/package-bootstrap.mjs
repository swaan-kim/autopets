import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from './package-chatgpt.mjs';
import { digest } from '../integrations/codex/bootstrap/files.mjs';
import { collectConnectorFiles } from './stage-desktop-resources.mjs';

export async function packageBootstrap({ root, installer, node, license, out }) {
  const appVersion = JSON.parse(await fs.readFile(path.join(root, 'apps/desktop/package.json'), 'utf8')).version;
  const files = await collectConnectorFiles({ root, node, license });
  async function add(name, file) {
    if ((await fs.lstat(file)).isSymbolicLink()) throw Error('No linked release files');
    files.push({ name, data: await fs.readFile(file) });
  }
  const installerName = `app/AutoPets_${appVersion}_x64-setup.exe`;
  await add(installerName, installer);
  await add('install.ps1', path.join(root, 'integrations/codex/bootstrap/install.ps1'));
  const manifest = { version: 1, appVersion, platform: 'win32-x64', channel: 'review', publicOneCallVerified: false, installer: installerName,
    files: files.map(file => ({ path: file.name, sha256: digest(file.data) })) };
  files.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) });
  await fs.mkdir(path.dirname(out), { recursive: true });
  const zip = makeZip(files); await fs.writeFile(out, zip);
  await fs.writeFile(`${out}.sha256`, `${digest(zip)}  ${path.basename(out)}\n`);
  return { file: out, files: files.length, sha256: digest(zip), publicOneCallVerified: false };
}
async function main() {
  const args = process.argv.slice(2), options = {};
  while (args.length) { const flag = args.shift(); if (!['--installer', '--node', '--license', '--out'].includes(flag) || !args.length) throw Error('Arguments'); options[flag.slice(2)] = path.resolve(args.shift()); }
  if (!options.installer || !options.node || !options.license) throw Error('Installer, Node and LICENSE are required');
  const root = fileURLToPath(new URL('../', import.meta.url));
  console.log(JSON.stringify(await packageBootstrap({ root, ...options, out: options.out || path.join(root, 'release/AutoPets-windows-x64.zip') })));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
