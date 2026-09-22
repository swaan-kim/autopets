import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReleaseChannel } from '../packages/contracts/release.mjs';

export async function buildProductSite({ root, out }) {
  const channel = JSON.parse(await fs.readFile(path.join(root, 'docs/releases/channel.json'), 'utf8'));
  const verified = validateReleaseChannel(channel);
  if (!verified.ok) throw Error(`Publication metadata rejected: ${verified.errors.join(', ')}`);
  const source = await fs.readFile(path.join(root, 'docs/start/index.html'), 'utf8');
  const marker = '<!-- AUTOPETS_RELEASE_DATA -->';
  if (source.split(marker).length !== 2) throw Error('Expected exactly one release data marker');
  // Inject only public display fields; signatures/evidence remain in the separate release manifest.
  const data = { version: 2, publicRelease: verified.release ? {
    version: verified.release.version, installer: {
      url: verified.release.installer.url, sha256: verified.release.installer.sha256,
    },
  } : null };
  const encoded = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
  await fs.mkdir(out, { recursive: true });
  await fs.cp(path.join(root, 'docs/start'), out, { recursive: true });
  await fs.writeFile(path.join(out, 'index.html'), source.replace(marker, `<script type="application/json" id="autopets-release">${encoded}</script>`));
  await fs.copyFile(path.join(root, 'docs/releases/channel.json'), path.join(out, 'channel.json'));
  await fs.copyFile(path.join(root, 'scripts/fetch-installer.ps1'), path.join(out, 'fetch-installer.ps1'));
  return { publicReady: Boolean(verified.release), output: out };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out') throw Error('Usage: build-product-site.mjs --out <directory>');
  console.log(JSON.stringify(await buildProductSite({ root: fileURLToPath(new URL('../', import.meta.url)), out: path.resolve(args[1]) })));
}
