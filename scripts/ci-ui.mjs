import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '1420', '--strictPort'], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostic = '';
let exited = false;
let spawnError;
server.on('error', error => { spawnError = error; });
server.on('exit', () => { exited = true; });
for (const output of [server.stdout, server.stderr]) output.on('data', data => { diagnostic = (diagnostic + data.toString()).slice(-8000); });

try {
  const deadline = Date.now() + 20_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (exited) throw new Error(`UI server exited before readiness.\n${diagnostic}`);
    if (diagnostic.includes('http://127.0.0.1:1420/')) {
      try { ready = (await fetch('http://127.0.0.1:1420/', { signal: AbortSignal.timeout(500) })).ok; } catch {}
    }
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error('UI server readiness timed out.');
  if (exited) throw new Error(`UI server failed to start.\n${diagnostic}`);
  const test = spawn(process.execPath, ['tests/ui-smoke.cjs'], { cwd: root, windowsHide: true, stdio: 'inherit' });
  const [code] = await once(test, 'exit');
  if (code !== 0) throw new Error(`UI smoke test failed (${code}).`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (!exited) {
    const stopped = once(server, 'exit');
    server.kill();
    await Promise.race([stopped, delay(3000)]);
  }
}
