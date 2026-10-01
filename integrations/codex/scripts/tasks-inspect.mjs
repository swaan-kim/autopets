#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { inspectTaskMetadata } from '../runtime/task-metadata.mjs';

const [executable, cwd, targetFile] = process.argv.slice(2);
try {
  if (process.argv.length !== 5 || ![executable, cwd, targetFile].every(value => path.isAbsolute(value ?? ''))) throw new Error('Use absolute executable, project and target-file paths');
  const raw = await readFile(targetFile);
  if (raw.length > 128 * 1024) throw new Error('Task target file exceeds limit');
  const targets = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw).replace(/^\uFEFF/u, ''));
  const sourceId = `codex-runtime:${createHash('sha256').update(JSON.stringify([await realpath(executable), process.env.CODEX_HOME || path.join(os.homedir(), '.codex')])).digest('hex')}`;
  const report = await inspectTaskMetadata({ executable, cwd, targets, sourceId });
  console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(error instanceof SyntaxError ? 'Invalid task target JSON' : error.message); process.exitCode = 1; }
