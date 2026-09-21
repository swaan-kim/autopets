#!/usr/bin/env node
// Compatibility entrypoint. Copy integrations/codex/skills/autopets for standalone use.
export * from '../../../integrations/codex/skills/autopets/scripts/connect.mjs';
import { main } from '../../../integrations/codex/skills/autopets/scripts/connect.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
