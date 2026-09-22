import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from './package-chatgpt.mjs';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const plugin = 'integrations/plugins/autopets';
const files = ['.codex-plugin/plugin.json', 'skills/autopets/SKILL.md'];
const entries = await Promise.all(files.map(async name => ({ name: `autopets/${name}`, data: await fs.readFile(path.join(root, plugin, name)) })));
const manifest = JSON.parse(entries[0].data);
if (manifest.name !== 'autopets' || manifest.skills !== './skills/' || manifest.mcpServers || manifest.hooks) throw Error('Unexpected plugin capabilities');
const out = path.join(root, 'release/AutoPets-plugin-review.zip');
await fs.mkdir(path.dirname(out), { recursive: true });
const zip = makeZip(entries);
await fs.writeFile(out, zip);
const hash = createHash('sha256').update(zip).digest('hex');
await fs.writeFile(`${out}.sha256`, `${hash}  ${path.basename(out)}\n`);
console.log(JSON.stringify({ file: out, sha256: hash, directorySubmitted: false, desktopInstalled: false }));
