import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { homeFor, digest, readJson, atomicJson, safeDirectory } from './files.mjs';

// Shared by legacy project hooks and user hooks. Only hashes and the hold reason
// are retained; prompts, tool output and injected guidance are never cached.
export async function runHookOnce(input, role, run, rootOverride) {
  let root;
  try { root = rootOverride || homeFor(); if (!(await readJson(path.join(root, 'state/connection-settings.json'))).enabled) return run(); }
  catch { return run(); }
  if (!input.session_id || !input.turn_id) return run();
  const directory = path.join(root, 'state/claims', digest(input.session_id));
  await safeDirectory(directory);
  // Ignore hook-specific metadata: two definitions may receive the same event
  // with different source IDs. Prompt/model changes are genuinely new work.
  const key = digest(JSON.stringify([role, input.session_id, input.agent_id ?? '', input.agent_type ?? '', input.turn_id, input.hook_event_name, input.tool_use_id ?? '', input.model ?? '', digest(input.prompt || ''), input.source ?? '']));
  const file = path.join(directory, `${key}.json`);
  try { await fs.writeFile(file, JSON.stringify({ status: 'running', at: Date.now() }), { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    for (let attempt = 0; attempt < 100; attempt++) {
      const saved = await readJson(file).catch(() => null);
      if (saved?.status === 'done') return { output: saved.hold || {} };
      if (!saved || saved?.status === 'failed') throw Error('hook-retry');
      await delay(40);
    }
    throw Error('hook-in-progress');
  }
  try {
    const result = await run();
    await atomicJson(file, { status: 'done', at: Date.now(), hold: result?.output?.decision === 'block' ? result.output : null });
    return result;
  } catch (error) { await atomicJson(file, { status: 'failed', at: Date.now() }); throw error; }
}
