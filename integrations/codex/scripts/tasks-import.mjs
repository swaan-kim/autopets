#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readConnection, requestJson } from '../skills/autopets/scripts/bridge-client.mjs';

const [connectionPath, reportPath] = process.argv.slice(2);
try {
  if (process.argv.length !== 4 || ![connectionPath, reportPath].every(value => path.isAbsolute(value ?? ''))) throw new Error('Use absolute connection and metadata report paths');
  const bytes = await readFile(reportPath);
  if (bytes.length > 192 * 1024) throw new Error('Metadata report exceeds limit');
  const report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ''));
  if (report?.version !== 1 || report.source !== 'app-server-metadata' || typeof report.sourceId !== 'string' || !report.sourceId.trim() || report.sourceId.length > 256
      || !Array.isArray(report.nodes) || report.nodes.length < 1 || report.nodes.length > 32) throw new Error('Invalid metadata report');
  const connection = await readConnection(connectionPath);
  const prior = await requestJson(connection, `/v1/task-graph?sourceId=${encodeURIComponent(report.sourceId)}`);
  if (prior.sourceId !== report.sourceId || !Number.isSafeInteger(prior.revision) || prior.revision < 0) throw new Error('Metadata source receipt mismatch');
  const result = await requestJson(connection, '/v1/task-graph', { expectedRevision: prior.revision, report });
  if (result.sourceId !== report.sourceId || result.revision !== prior.revision + 1) throw new Error('Metadata save receipt mismatch');
  console.log(JSON.stringify({ saved: true, revision: result.revision, importedTasks: report.nodes.length, controlEnabled: false }));
} catch (error) { console.error(error instanceof SyntaxError ? 'Invalid metadata JSON' : error.message); process.exitCode = 1; }
