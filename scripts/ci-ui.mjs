import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const desktopRequire = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { createServer } = await import(pathToFileURL(desktopRequire.resolve('vite')).href);

const root = fileURLToPath(new URL('../', import.meta.url));
const appRoot = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
let server;
try {
  // Await the actual listener, independent of Vite's colored/TTY log formatting.
  // strictPort rejects an occupied port instead of testing an unrelated server.
  server = await createServer({ root: appRoot, logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 1420, strictPort: true },
  });
  await server.listen();
  const test = spawn(process.execPath, ['apps/desktop/tests/ui-smoke.cjs'], { cwd: root, windowsHide: true, stdio: 'inherit' });
  const [code] = await once(test, 'exit');
  if (code !== 0) throw new Error(`UI smoke test failed (${code}).`);
  // Keep this owned server alive for the separate, non-executing study as well.
  // Its previews must not be mistaken for the native app's real task results.
  for (const args of [
    ['apps/desktop/tests/campaign-study-ui.cjs'],
    ['apps/desktop/node_modules/vite/bin/vite.js', 'build', '--config', 'apps/desktop/campaign-study.vite.config.ts'],
    ['apps/desktop/tests/campaign-package-ui.cjs'],
  ]) {
    // createServer sets NODE_ENV=development. Do not leak that into the offline
    // production bundle: React's conditional exports must match the build mode.
    const env = args[0].endsWith('/vite.js') ? { ...process.env, NODE_ENV: 'production' } : process.env;
    const check = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: 'inherit' });
    const [result] = await once(check, 'exit');
    if (result !== 0) throw new Error(`Study verification failed: ${args[0]} (${result}).`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await server?.close();
}
