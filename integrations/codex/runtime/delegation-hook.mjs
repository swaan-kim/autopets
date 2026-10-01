#!/usr/bin/env node
// Opt-in child observation gate. Never routes parent events, approves or starts AI.
import { readConnection, requestJson } from '../skills/autopets/scripts/bridge-client.mjs';
import { delegationEvent } from './delegation.mjs';
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--connection') throw Error('arguments');
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) { size += chunk.length; if (size > 256 * 1024) throw Error('limit'); chunks.push(chunk); }
  const event = delegationEvent(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (event) await requestJson(await readConnection(args[1]), '/v1/delegation/events', event, 1400, 4096);
} catch { /* Observation failure never changes the host request or permissions. */ }
process.stdout.write('{}\n');
