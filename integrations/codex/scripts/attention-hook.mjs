#!/usr/bin/env node
// Usage: node attention-hook.mjs enable|disable|status|doctor [--connection <connection.json>] [--node <node.exe>]
// Turns on (or off) the dog pet's "Codex에서 확인이 필요해 / Codex 작업이 완료됐어" notices for
// Codex chats connected to AutoPets. After `enable`, open Codex and review/trust the new
// "AutoPets attention v1" hooks yourself; Codex runs no new hook before that.
// `doctor` shows where the chain stops: installed → trusted → ran → delivered → connected chat →
// classified → stored in the app → drawn by the pet. It reads ids, states and reason codes only.
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configureAttentionHook, attentionHookState, ATTENTION_STATUS } from '../bootstrap/attention-hook.mjs';
import { codexHome } from '../bootstrap/recommendation-hook.mjs';
import { readConnection, requestJson } from '../skills/autopets/scripts/bridge-client.mjs';

const defaultConnection = env => env.AUTOPETS_CONNECTION_FILE
  || path.join(env.AUTOPETS_DATA_DIR || path.join(env.LOCALAPPDATA || '', 'local.autopets.desktop'), 'connection.json');
const TRACE = fileURLToPath(new URL('../../../.local/attention-trace.jsonl', import.meta.url));

/** Codex Desktop's own codex.exe (MSIX), unless AUTOPETS_CODEX_EXE names another. */
function codexExe(env) {
  if (env.AUTOPETS_CODEX_EXE) return env.AUTOPETS_CODEX_EXE;
  if (process.platform !== 'win32') return 'codex';
  const location = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "(Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1).InstallLocation"], { windowsHide: true }).toString().trim();
  return location ? path.join(location, 'app', 'resources', 'codex.exe') : 'codex';
}

/** Trust as Codex itself reports it (app-server `hooks/list`, read-only; no thread is started). */
async function hookTrust(env) {
  const server = spawn(codexExe(env), ['app-server'], { cwd: codexHome(env), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env });
  try {
    let id = 0; const waiting = new Map();
    readline.createInterface({ input: server.stdout }).on('line', line => { try { const m = JSON.parse(line); if (waiting.has(m.id) && !m.method) { waiting.get(m.id)(m); waiting.delete(m.id); } } catch { /* skip */ } });
    const call = (method, params) => Promise.race([
      new Promise(resolve => { const i = ++id; waiting.set(i, resolve); server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`); }),
      new Promise((_, reject) => setTimeout(() => reject(Error('codex-timeout')), 20000))]);
    await call('initialize', { clientInfo: { name: 'autopets-attention-doctor', version: '1' }, capabilities: {} });
    const list = await call('hooks/list', { cwds: [codexHome(env)] });
    return (list.result?.data ?? []).flatMap(entry => entry.hooks ?? []).filter(hook => hook.statusMessage === ATTENTION_STATUS)
      .map(hook => ({ event: hook.eventName, trust: hook.trustStatus, enabled: hook.enabled }));
  } finally { server.kill(); }
}

export async function doctor(env, connectionFile) {
  const report = { stages: {} };
  const set = (name, ok, detail) => { report.stages[name] = { ok, ...detail }; };
  const raw = await fs.readFile(path.join(codexHome(env), 'hooks.json'), 'utf8').catch(() => '{}');
  const installed = attentionHookState(JSON.parse(raw.replace(/^﻿/u, '')));
  set('1-installed', installed.installed, { events: installed.events });
  try {
    const trust = await hookTrust(env);
    const trusted = trust.length > 0 && trust.every(hook => hook.trust === 'trusted' && hook.enabled);
    set('2-trusted-in-codex', trusted, { hooks: trust, ...(trusted ? {} : { fix: 'Codex Desktop에서 "AutoPets attention v1" 훅을 검토하고 신뢰해 주세요. 신뢰 전에는 Codex가 실행하지 않습니다.' }) });
  } catch (error) { set('2-trusted-in-codex', false, { error: error.message }); }
  const trace = (await fs.readFile(env.AUTOPETS_ATTENTION_TRACE_FILE || TRACE, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  const stops = trace.filter(entry => entry.event === 'Stop');
  set('3-hook-ran', trace.length > 0, { lastEvent: trace.at(-1) ? { at: trace.at(-1).at, event: trace.at(-1).event } : null, ...(trace.length ? {} : { fix: '진단 기록이 없습니다: 훅이 아직 한 번도 실행되지 않았습니다(신뢰 전이거나 Codex 재시작 필요).' }) });
  const lastStop = stops.at(-1);
  if (lastStop) {
    const delivered = (lastStop.results ?? []).map(result => ({ target: result.target, notice: result.notice ?? null, error: result.error ?? null }));
    set('4-last-turn-classified', true, { at: lastStop.at, session: lastStop.session, turn: lastStop.turn, classified: lastStop.classified ?? null, notice: lastStop.kind ?? 'none' });
    set('5-delivered-to-app', delivered.some(result => !result.error), { results: delivered });
  }
  try {
    const status = await requestJson(await readConnection(connectionFile), '/v1/attention', { operation: 'status' }, 3000, 65536);
    set('6-app-reachable', true, { connection: connectionFile });
    set('7-connected-chats', Boolean(status.setupChat) || status.links?.some(link => link.link === 'connected'), { setupChat: status.setupChat, links: status.links });
    set('8-notices-in-app', true, { notices: status.notices });
    if (status.notices?.length) set('9-drawn-by-pet', status.notices.every(notice => notice.displayedOn), { notices: status.notices.map(notice => ({ id: notice.id, kind: notice.kind, displayedOn: notice.displayedOn })) });
  } catch (error) {
    set('6-app-reachable', false, { connection: connectionFile, error: error.code === 'connection-unavailable' ? 'app-not-running' : (error.code ?? error.message), fix: '개발 앱이 꺼져 있으면 완료 이벤트가 와도 받을 곳이 없습니다. .local\\start-dev.cmd 또는 $autopets로 켜 주세요.' });
  }
  report.firstFailure = Object.entries(report.stages).find(([, stage]) => !stage.ok)?.[0] ?? null;
  return report;
}

export async function run(args = process.argv.slice(2), env = process.env) {
  const [operation, ...rest] = args;
  if (!['enable', 'disable', 'status', 'doctor'].includes(operation)) throw Error('usage: enable|disable|status|doctor [--connection <file>] [--node <exe>]');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = { '--connection': 'connection', '--node': 'node' }[rest[i]];
    if (!key || !rest[i + 1] || options[key]) throw Error('invalid-arguments');
    options[key] = path.resolve(rest[i + 1]);
  }
  if (operation === 'status') {
    const file = path.join(codexHome(env), 'hooks.json');
    const raw = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error; });
    return { hooksFile: file, ...attentionHookState(JSON.parse(raw.replace(/^﻿/u, ''))) };
  }
  if (operation === 'doctor') return doctor(env, options.connection ?? defaultConnection(env));
  return configureAttentionHook({ enable: operation === 'enable', env, node: options.node ?? process.execPath,
    script: fileURLToPath(new URL('../hooks/attention-hook.mjs', import.meta.url)), connection: options.connection ?? defaultConnection(env) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await run(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
