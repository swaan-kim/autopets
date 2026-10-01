import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const digest = data => createHash('sha256').update(data).digest('hex');
export const homeFor = (env = process.env) => {
  const root = env.AUTOPETS_HOME || (env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'AutoPets'));
  if (!root || !path.isAbsolute(root)) throw Error('local-path-unavailable');
  return root;
};
export async function readJson(file) {
  const data = await fs.readFile(file);
  if (data.length > 4 * 1024 * 1024) throw Error('file-too-large');
  return JSON.parse(data.toString('utf8').replace(/^\uFEFF/u, ''));
}
export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx' });
  await fs.rename(temp, file);
}
export async function regular(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('unsafe-file');
  return stat;
}
export async function safeDirectory(directory) {
  // Check every existing ancestor, including Windows junctions, before writing.
  const resolved = path.resolve(directory);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw Error('linked-directory'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await fs.mkdir(resolved, { recursive: true });
  return resolved;
}
export async function lock(directory, action) {
  await safeDirectory(directory);
  const file = path.join(directory, 'setup.lock');
  const claim = { pid: process.pid, nonce: randomUUID() };
  try { await fs.writeFile(file, JSON.stringify(claim), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // A dead process may leave a lock. Never reclaim by age or while PID exists.
    const recovery = `${file}.recovery`;
    try { await fs.writeFile(recovery, claim.nonce, { flag: 'wx' }); }
    catch { throw Error('setup-in-progress'); }
    try {
      await regular(file);
      const old = await readJson(file);
      if (!Number.isInteger(old.pid) || old.pid < 1) throw Error('setup-lock-review');
      try { process.kill(old.pid, 0); throw Error('setup-in-progress'); }
      catch (cause) { if (cause.code !== 'ESRCH') throw cause; }
      if ((await readJson(file)).nonce !== old.nonce) throw Error('setup-in-progress');
      await fs.unlink(file);
      await fs.writeFile(file, JSON.stringify(claim), { flag: 'wx' });
    } finally { await fs.unlink(recovery); }
  }
  try { return await action(); }
  finally {
    const current = await readJson(file).catch(() => null);
    if (current?.nonce === claim.nonce) await fs.unlink(file);
  }
}
export function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || relative.startsWith('/') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw Error('package-path');
  const result = path.resolve(root, ...relative.split('/'));
  if (!result.startsWith(path.resolve(root) + path.sep)) throw Error('package-path');
  return result;
}
