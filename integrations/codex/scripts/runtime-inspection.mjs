#!/usr/bin/env node
import { inspectRuntime, summarizeRuntime } from '../runtime/read-only.mjs';
import path from 'node:path';
const [executable, cwd] = process.argv.slice(2);
if (!path.isAbsolute(executable ?? '') || !path.isAbsolute(cwd ?? '')) throw new Error('Use absolute executable and project paths');
try { console.log(JSON.stringify(summarizeRuntime(await inspectRuntime({ executable, cwd })), null, 2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
