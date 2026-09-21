#!/usr/bin/env node
// Read-only runtime inspection. Never starts a thread/turn or changes hook trust.
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';

function optionsFromArgs(args) {
  const options = { codex: 'codex' };
  while (args.length) {
    const name = args.shift();
    if (!['--project', '--codex'].includes(name) || !args.length) throw new Error('Use --project <absolute directory> [--codex <absolute executable>].');
    const value = args.shift();
    if (!path.isAbsolute(value)) throw new Error('Paths must be absolute.');
    options[name.slice(2)] = value;
  }
  if (!options.project) throw new Error('--project is required.');
  return options;
}

function safeError(error) {
  // Runtime parse errors can echo configuration commands. Never print raw text.
  const text = typeof error?.message === 'string' ? error.message : '';
  let category = 'hook configuration error';
  if (/parse|syntax|expected/u.test(text)) category = 'hook configuration parse error';
  else if (/unknown|unsupported/u.test(text)) category = 'unsupported hook configuration value';
  else if (/read|open|permission/u.test(text)) category = 'hook configuration could not be read';
  const position = /line (\d+)(?:[, ]+column (\d+))?/u.exec(text);
  return { sourcePath: typeof error?.path === 'string' ? error.path : null, category,
    ...(position ? { line: Number(position[1]), ...(position[2] ? { column: Number(position[2]) } : {}) } : {}),
    detail: 'Inspect the source file locally; raw diagnostic text is omitted because it may contain command arguments.',
  };
}

async function inspect(options) {
  if (!(await stat(options.project)).isDirectory()) throw new Error('Project is not a directory.');
  const child = spawn(options.codex, ['app-server', '--stdio'], {
    cwd: options.project, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  let pending = '', total = 0, diagnostics = false, finished = false;
  let initialize;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('Read-only app-server probe timed out after 20 seconds.')), 20_000);
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const fail = (error) => { if (!finished) { finished = true; clearTimeout(timer); reject(error); } };
    const complete = (value) => { if (!finished) { finished = true; clearTimeout(timer); resolve(value); } };
    child.on('error', () => fail(new Error('Could not start the Codex executable.')));
    child.on('exit', () => { if (!finished) fail(new Error('Codex app-server ended before hooks/list completed.')); });
    child.stdin.on('error', () => fail(new Error('Codex app-server input channel closed.')));
    child.stderr.on('data', () => { diagnostics = true; });
    child.stdout.on('data', (chunk) => {
      total += Buffer.byteLength(chunk);
      if (total > 8 * 1024 * 1024) { fail(new Error('Runtime response exceeded the 8 MiB probe limit.')); return; }
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { fail(new Error('Runtime emitted non-JSON protocol data.')); return; }
        if (![1, 2].includes(message.id)) continue; // Ignore unsolicited informational notifications.
        if (message.error) { fail(new Error(`Runtime rejected ${message.id === 1 ? 'initialize' : 'hooks/list'} (code ${Number.isInteger(message.error.code) ? message.error.code : 'unknown'}).`)); return; }
        if (message.id === 1) {
          if (initialize || !message.result) { fail(new Error('Unexpected initialize response.')); return; }
          initialize = message.result;
          send({ method: 'initialized' });
          send({ id: 2, method: 'hooks/list', params: { cwds: [options.project] } });
        } else {
          if (!initialize || !Array.isArray(message.result?.data)) { fail(new Error('Unexpected hooks/list response shape.')); return; }
          complete(message.result);
        }
      }
    });
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'autopets_feasibility_probe', title: 'AutoPets read-only hook inspection', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    } });
  }).finally(async () => {
    child.stdin.end();
    if (child.exitCode !== null) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  });
  return {
    inspectedAt: new Date().toISOString(), runtime: 'separate installed Codex app-server process',
    platform: initialize.platformOs ?? 'unknown',
    protocolCalls: ['initialize', 'initialized (notification)', 'hooks/list'],
    desktopRoundTripVerified: false, approvalExecutionVerified: false,
    stderrDiagnosticsPresent: diagnostics,
    projects: result.data.map((entry) => ({
      cwd: entry.cwd, hooks: (entry.hooks ?? []).map((hook) => ({
        event: hook.eventName, source: hook.source, sourcePath: hook.sourcePath,
        trustStatus: hook.trustStatus, enabled: hook.enabled, managed: hook.isManaged,
        handlerType: hook.handlerType, async: hook.async ?? false, timeoutSeconds: hook.timeoutSec,
      })), errors: (entry.errors ?? []).map(safeError), warningCount: entry.warnings?.length ?? 0,
    })),
    limitation: 'This inspects configuration discovery and trust only. It does not establish that the running Desktop emits hooks or accepts permission decisions. No thread, model turn, tool action, or trust mutation was requested.',
  };
}

import { fileURLToPath } from 'node:url';

export async function runCli() {
try { console.log(JSON.stringify(await inspect(optionsFromArgs(process.argv.slice(2))), null, 2)); }
catch (error) { console.error(`AutoPets feasibility probe: ${error.message}`); process.exitCode = 1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
