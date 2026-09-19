import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
let server;
try {
  // Await the actual listener, independent of Vite's colored/TTY log formatting.
  // strictPort rejects an occupied port instead of testing an unrelated server.
  server = await createServer({ root, logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 1420, strictPort: true },
  });
  await server.listen();
  const test = spawn(process.execPath, ['tests/ui-smoke.cjs'], { cwd: root, windowsHide: true, stdio: 'inherit' });
  const [code] = await once(test, 'exit');
  if (code !== 0) throw new Error(`UI smoke test failed (${code}).`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await server?.close();
}
