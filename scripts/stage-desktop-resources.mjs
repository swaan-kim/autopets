import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, safeDirectory } from '../integrations/codex/bootstrap/files.mjs';

/** Build-time only: all runtime dependencies travel inside the same installer. */
export async function collectConnectorFiles({ root, node, license }) {
  const files = [];
  async function add(name, file) {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw Error('No linked release files');
    files.push({ name, data: await fs.readFile(file) });
  }
  async function walk(relative) {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      if (['tests', 'node_modules', '.local'].includes(entry.name)) continue;
      const name = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw Error('No linked release files');
      if (entry.isDirectory()) await walk(name);
      else if (/\.(mjs|json|md|ts)$/u.test(name) || entry.name === 'LICENSE') await add(name, path.join(root, name));
    }
  }
  for (const directory of ['integrations/codex/bootstrap', 'integrations/codex/hooks', 'integrations/codex/assistance', 'integrations/codex/skills', 'integrations/codex/runtime', 'packages/contracts', 'packages/guidance']) await walk(directory);
  for (const name of ['runtime-inspection.mjs', 'tasks-inspect.mjs', 'tasks-import.mjs', 'turn-selection-audit.mjs']) {
    const file = `integrations/codex/scripts/${name}`;
    await add(file, path.join(root, file));
  }
  for (const file of ['LICENSE', 'docs/releases/start.md', 'docs/releases/channel.json', 'docs/testing/one-call-setup.md']) await add(file, path.join(root, file));
  await add('runtime/node.exe', node);
  await add('runtime/LICENSE', license);
  return files;
}

export async function stageDesktopResources({ root, node, license, out }) {
  const appVersion = JSON.parse(await fs.readFile(path.join(root, 'apps/desktop/package.json'), 'utf8')).version;
  const files = await collectConnectorFiles({ root, node, license });
  const connector = path.join(out, 'connector');
  await safeDirectory(connector);
  // Refuse stale staging files rather than silently including removed helpers.
  const existing = await fs.readdir(connector);
  if (existing.length) throw Error('Resource staging must use a new empty directory');
  for (const file of files) {
    const destination = path.join(connector, ...file.name.split('/'));
    await safeDirectory(path.dirname(destination));
    await fs.writeFile(destination, file.data, { flag: 'wx' });
  }
  const manifest = { version: 1, kind: 'installed-connector', appVersion, platform: 'win32-x64', channel: 'review', publicOneCallVerified: false,
    files: files.map(file => ({ path: file.name, sha256: digest(file.data) })) };
  await fs.writeFile(path.join(connector, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  const configPath = path.join(out, 'tauri-bundle.json');
  const config = { bundle: { active: true, targets: ['nsis'], createUpdaterArtifacts: false, resources: { [`${connector.replaceAll('\\', '/')}/`]: 'connector/' } } };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  return { connector, configPath, files: files.length, channel: 'review', publicOneCallVerified: false };
}

async function main() {
  const args = process.argv.slice(2), options = {};
  while (args.length) {
    const flag = args.shift();
    if (!['--node', '--license', '--out'].includes(flag) || !args.length) throw Error('Arguments');
    options[flag.slice(2)] = path.resolve(args.shift());
  }
  if (!options.node || !options.license || !options.out) throw Error('Node, LICENSE and empty output directory required');
  const root = fileURLToPath(new URL('../', import.meta.url));
  console.log(JSON.stringify(await stageDesktopResources({ root, ...options })));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
