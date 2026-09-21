#!/usr/bin/env node
// Compatibility entrypoint. Implementation lives with its integration/package.
export * from '../integrations/codex/scripts/feasibility-probe.mjs';
import { runCli } from '../integrations/codex/scripts/feasibility-probe.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
