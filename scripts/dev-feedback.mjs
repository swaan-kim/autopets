import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { startHttpServer } from 'agentation-mcp';

const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const { createServer } = await import(pathToFileURL(requireDesktop.resolve('vite')).href);
const port = Number(process.env.AUTOPETS_UI_PORT || 1420), feedbackPort = Number(process.env.AUTOPETS_FEEDBACK_PORT || 4747);
if (![port, feedbackPort].every(value => Number.isInteger(value) && value > 0 && value < 65536) || port === feedbackPort) throw Error('Choose two different local development ports.');
process.env.AGENTATION_CORS_ORIGINS = `http://127.0.0.1:${port},http://localhost:${port}`;
let feedback, vite;
async function close() {
  await vite?.close();
  if (feedback?.listening) {
    feedback.closeAllConnections();
    await new Promise(resolve => feedback.close(resolve));
  }
}
try {
  feedback = startHttpServer(feedbackPort, undefined, {host:'127.0.0.1'});
  await once(feedback, 'listening');
  vite = await createServer({root:fileURLToPath(new URL('../apps/desktop/', import.meta.url)),
    clearScreen:false, server:{host:'127.0.0.1',port,strictPort:true},
    define:{'import.meta.env.VITE_AGENTATION':JSON.stringify('1'), 'import.meta.env.VITE_AGENTATION_ENDPOINT':JSON.stringify(`http://127.0.0.1:${feedbackPort}`)},
  });
  await vite.listen();
  console.log(`AutoPets feedback preview: http://127.0.0.1:${port}\nAgentation: http://127.0.0.1:${feedbackPort}\nOwners: home / pet-selection / task-card. No AI tasks are started.`);
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { void close().finally(() => process.exit(0)); });
} catch (error) {
  await close(); console.error(error.message); process.exitCode = 1;
}
