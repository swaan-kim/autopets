#!/usr/bin/env node
// Usage: node recommendation-hook.mjs enable|disable|status [--connection <connection.json>] [--node <node.exe>]
// Turns on automatic pet recommendations for Codex chats connected to AutoPets.
// After `enable`, open Codex and review/trust the new "AutoPets recommend v1" hook yourself.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureRecommendationHook, recommendationHookState, codexHome } from '../bootstrap/recommendation-hook.mjs';

const defaultConnection = env => env.AUTOPETS_CONNECTION_FILE
  || path.join(env.AUTOPETS_DATA_DIR || path.join(env.LOCALAPPDATA || '', 'local.autopets.desktop'), 'connection.json');

export async function run(args = process.argv.slice(2), env = process.env) {
  const [operation, ...rest] = args;
  if (!['enable', 'disable', 'status'].includes(operation)) throw Error('usage: enable|disable|status [--connection <file>] [--node <exe>]');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = { '--connection': 'connection', '--node': 'node' }[rest[i]];
    if (!key || !rest[i + 1] || options[key]) throw Error('invalid-arguments');
    options[key] = path.resolve(rest[i + 1]);
  }
  if (operation === 'status') {
    const file = path.join(codexHome(env), 'hooks.json');
    const raw = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error; });
    return { hooksFile: file, ...recommendationHookState(JSON.parse(raw.replace(/^﻿/u, ''))) };
  }
  return configureRecommendationHook({ enable: operation === 'enable', env, node: options.node ?? process.execPath,
    script: fileURLToPath(new URL('../hooks/recommend-hook.mjs', import.meta.url)), connection: options.connection ?? defaultConnection(env) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await run(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
