import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateReleaseChannel } from '../packages/contracts/release.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--public')) throw Error('Unknown release validation argument');
const file = fileURLToPath(new URL('../docs/releases/channel.json', import.meta.url));
const result = validateReleaseChannel(JSON.parse(await fs.readFile(file, 'utf8')));
if (!result.ok || (args.includes('--public') && !result.release)) {
  console.error(JSON.stringify({ publicReady: false, errors: result.errors.length ? result.errors : ['public-release-unverified'] }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ manifestValid: true, publicReady: Boolean(result.release), version: result.release?.version ?? null }));
}
