#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './prepare.mjs';

try {
  if (process.argv.length !== 4 || process.argv[2] !== '--config') throw new Error('arguments');
  const cfg = await loadConfig(process.argv[3]);
  const entries = await readdir(cfg.dataDir);
  const records = [];
  for (const name of entries.filter(name => /^[a-f0-9]{64}\.json$/u.test(name)).sort()) {
    const file = path.join(cfg.dataDir, name);
    if ((await stat(file)).size > 16384) throw new Error('state-limit');
    const state = JSON.parse(await readFile(file, 'utf8'));
    records.push({ taskHash: name.slice(0, 12), hookOutputPrepared: Number.isFinite(state.hookOutputPreparedAt),
      acknowledgementReceived: Number.isFinite(state.acknowledgementAt), contextSaved: Number.isFinite(state.contextSavedAt),
      revision: Number.isSafeInteger(state.revision) ? state.revision : null,
      injectionBytes: Number.isSafeInteger(state.injectionBytes) ? state.injectionBytes : null,
      restoreRequired: state.restoreRequired === true });
  }
  console.log(JSON.stringify({ enabled: cfg.enabled, recordCount: records.length, records,
    pendingLocks: entries.filter(name => /^[a-f0-9]{64}\.lock$/u.test(name)).length,
    desktopDeliveryVerified: false,
    interpretation: 'Local diagnostic receipts only. Verify two actual Desktop chats and provenance using the runbook. Task content, IDs, paths and nonces are omitted.' }, null, 2));
} catch { console.error('M1 status unavailable. Inspect the local diagnostic setup.'); process.exitCode = 1; }
