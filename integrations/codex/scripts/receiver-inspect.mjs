#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { inspectReceiver } from '../runtime/receiver-diagnostics.mjs';

try {
  const [connectionPath, targetFile] = process.argv.slice(2);
  if (process.argv.length !== 4 || ![connectionPath, targetFile].every(value => path.isAbsolute(value ?? ''))) throw new Error('arguments');
  if ((await stat(targetFile)).size > 128 * 1024) throw new Error('size');
  const raw = await readFile(targetFile);
  if (raw.length > 128 * 1024) throw new Error('size');
  const targets = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw).replace(/^\uFEFF/u, ''));
  console.log(JSON.stringify(await inspectReceiver({ connectionPath, targets }), null, 2));
} catch {
  console.error('Receiver inspection failed. Supply absolute connection and selected-target JSON paths.');
  process.exitCode = 1;
}
