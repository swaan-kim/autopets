#!/usr/bin/env node
export { main, runTaskConnection } from '../skills/autopets/scripts/connect.mjs';
import { main } from '../skills/autopets/scripts/connect.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export async function runCli() { await main(); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
