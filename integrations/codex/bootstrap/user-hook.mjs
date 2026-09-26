// No app launch, downloads, trust changes, or model calls from lifecycle hooks.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homeFor, readJson, atomicJson, safeDirectory, digest } from './files.mjs';
import { isChildHook } from '../hooks/scope.mjs';

export async function chatConfig(root, input, connection) {
  if (isChildHook(input)) throw Error('child-requires-delegation-bridge');
  if (typeof input.session_id !== 'string' || !input.session_id || input.session_id.length > 256 || typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd)) throw Error('identity');
  const project = await fs.realpath(input.cwd);
  const directory = path.join(root, 'state/chats', digest(input.session_id));
  await safeDirectory(path.join(directory, 'records'));
  const file = path.join(directory, 'config.json');
  const desired = { version: 2, enabled: true, validationMode: false, sessionId: input.session_id, project, connection };
  const old = await readJson(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (old && (old.sessionId !== input.session_id || old.project.toLowerCase() !== project.toLowerCase())) throw Error('chat-scope-changed');
  if (JSON.stringify(old) !== JSON.stringify(desired)) await atomicJson(file, desired);
  return file;
}
export async function main(role = process.argv[2], env = process.env) {
  try {
    if (!['observe', 'prepare'].includes(role)) throw Error('role');
    const parts = []; let size = 0;
    for await (const part of process.stdin) { size += part.length; if (size > 256 * 1024) throw Error('input-limit'); parts.push(part); }
    const raw = Buffer.concat(parts), input = JSON.parse(raw.toString('utf8'));
    if (role === 'prepare' && isChildHook(input)) throw Error('child-requires-delegation-bridge');
    const root = homeFor(env);
    if (!(await readJson(path.join(root, 'state/connection-settings.json'))).enabled) throw Error('disabled');
    const connection = env.AUTOPETS_CONNECTION_FILE || path.join(env.AUTOPETS_DATA_DIR || path.join(env.LOCALAPPDATA, 'local.autopets.desktop'), 'connection.json');
    // A missing connection after explicit exit is a no-op; never restart the app.
    await fs.access(connection);
    const source = fileURLToPath(new URL(role === 'prepare' ? '../assistance/prepare.mjs' : '../hooks/codex-hook.mjs', import.meta.url));
    const args = role === 'prepare' ? [source, 'hook', '--config', await chatConfig(root, input, connection)] : [source, '--connection', connection, '--autopets-hook-v1'];
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { windowsHide: true, env, stdio: ['pipe', 'pipe', 'ignore'] });
      const chunks = []; let length = 0;
      const timer = setTimeout(() => { child.kill(); reject(Error('timeout')); }, 6500);
      child.stdout.on('data', data => { length += data.length; if (length > 16384) { child.kill(); } else chunks.push(data); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', code => { clearTimeout(timer); code === 0 && length <= 16384 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(Error('child')); });
      child.stdin.on('error', () => {}); child.stdin.end(raw);
    });
    process.stdout.write(output);
  } catch { process.stdout.write('{}\n'); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
