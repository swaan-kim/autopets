#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArguments, inspectProject, isAutoPetsHandler, EVENTS } from './install-hooks.mjs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runCli() {
try {
  const options = parseArguments(process.argv.slice(2), false);
  const { target, raw, config } = await inspectProject(options.project);
  const counts = Object.fromEntries(EVENTS.map((event) => [event,
    (config.hooks?.[event] ?? []).flatMap((group) => group.hooks).filter(isAutoPetsHandler).length]));
  let connection = 'not checked';
  if (options.connection) {
    try {
      const parsed = JSON.parse((await readFile(options.connection, 'utf8')).replace(/^\uFEFF/u, ''));
      connection = parsed.version === 1 && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/?$/u.test(parsed.baseUrl)
        && typeof parsed.token === 'string' && /^[A-Za-z0-9_-]{32,256}$/u.test(parsed.token)
        ? 'file present; local connection shape valid (reachability not tested)' : 'invalid shape';
    } catch { connection = 'missing or unreadable'; }
  }
  console.log(JSON.stringify({ target, configExists: raw !== null, nodeVersion: process.versions.node,
    handlersByEvent: counts, complete: Object.values(counts).every((count) => count === 1), connection,
    desktopVerified: false, trust: 'Not inspected or modified. Review hooks in Codex. Config presence is not proof of Desktop delivery.',
  }, null, 2));
} catch (error) { console.error(`AutoPets hook check: ${error.message}`); process.exitCode = 1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
