import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const roots = ['integrations/codex/tests','integrations/chatgpt/tests','packages/contracts/tests','packages/guidance/tests','scripts/tests'];
const files = [];
for (const directory of roots) {
  try { for (const entry of await readdir(join(root, directory), {withFileTypes:true})) if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(join(root, directory, entry.name)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (!files.length) throw Error('No tests found in the component test directories');
const child = spawn(process.execPath, ['--test', ...files.sort()], {cwd:root, stdio:'inherit', windowsHide:true});
child.on('error', error => {console.error(error.message);process.exitCode=1;});
child.on('exit', code => {process.exitCode=code ?? 1;});
