#!/usr/bin/env node
// Codex hook wire format: https://learn.chatgpt.com/docs/hooks
// This process never logs input, tool content, connection tokens, or diagnostics.
import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_BODY, isObject, validString, readConnection, requestJson as request } from '../skills/autopets/scripts/bridge-client.mjs';

const EVENTS = Object.freeze({
  SessionStart: 'session_started', UserPromptSubmit: 'turn_started',
  PreToolUse: 'tool_started', PostToolUse: 'tool_finished', Stop: 'turn_finished',
  Interrupt: 'interrupted', SessionEnd: 'session_ended', PermissionRequest: 'permission_requested',
});

async function readInput() {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => finish(new Error('input_timeout')), 2000);
    function finish(error, value) {
      clearTimeout(timer);
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      process.stdin.removeAllListeners('error');
      process.stdin.pause();
      if (error) reject(error); else resolve(value);
    }
    process.stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) return finish(new Error('input_limit'));
      chunks.push(chunk);
    });
    process.stdin.on('end', () => {
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish(new Error('input_json')); }
    });
    process.stdin.on('error', () => finish(new Error('input_error')));
  });
}

async function connectionFromArgs() {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== '--connection' || args[2] !== '--autopets-hook-v1'
    || !isAbsolute(args[1])) throw new Error('arguments');
  return readConnection(args[1]);
}

function activityFor(toolName) {
  // Exact names only. Never send shell text to a model or guess from free text.
  if (['Read', 'Glob', 'Grep', 'read_file', 'list_files', 'search_files', 'list_directory'].includes(toolName)) return 'research';
  if (['apply_patch', 'Write', 'Edit', 'write_file', 'edit_file'].includes(toolName)) return 'writing';
  if (['Bash', 'exec_command', 'shell_command', 'shell', 'run_command'].includes(toolName)) return 'tool';
  return 'working';
}

function observedPlan(input) {
  // PostToolUse may also report failures. The currently supported update_plan
  // success output is the exact built-in text, not a model-authored summary.
  if (input.hook_event_name !== 'PostToolUse' || input.tool_name !== 'update_plan'
    || typeof input.tool_response !== 'string' || input.tool_response.trim() !== 'Plan updated'
    || !isObject(input.tool_input) || !Array.isArray(input.tool_input.plan)
    || input.tool_input.plan.length > 50) return undefined;
  const steps = [];
  for (const item of input.tool_input.plan) {
    if (!isObject(item) || !validString(item.step, 500) || !item.step.trim()
      || !['pending', 'in_progress', 'completed'].includes(item.status)) return undefined;
    steps.push({ step: item.step, status: item.status });
  }
  if (steps.filter(item => item.status === 'in_progress').length > 1) return undefined;
  return { steps };
}

function baseEvent(input) {
  if (!isObject(input) || !validString(input.session_id) || !validString(input.cwd, 32768)
    || !validString(input.hook_event_name, 64)) return null;
  if (input.turn_id !== undefined && !validString(input.turn_id)) return null;
  return { sessionId: input.session_id, cwd: input.cwd,
    ...(input.turn_id ? { turnId: input.turn_id } : {}) };
}

async function observe(input, base, connection) {
  const kind = EVENTS[input.hook_event_name];
  if (!kind) return;
  if (!['SessionStart', 'SessionEnd'].includes(input.hook_event_name) && !base.turnId) return;
  if (['PreToolUse', 'PostToolUse'].includes(input.hook_event_name)
    && (!validString(input.tool_name, 256) || !validString(input.tool_use_id))) return;
  if (input.hook_event_name === 'PermissionRequest' && !validString(input.tool_name, 256)) return;
  const plan = observedPlan(input);
  const event = { ...base, eventId: randomUUID(), kind, timestamp: Date.now(),
    ...(validString(input.tool_name, 256) ? { toolName: input.tool_name } : {}),
    ...(validString(input.tool_use_id) ? { toolCallId: input.tool_use_id } : {}),
    ...(['PreToolUse', 'PostToolUse'].includes(input.hook_event_name) ? { activity: activityFor(input.tool_name) } : {}),
    ...(input.hook_event_name === 'PostToolUse' && isObject(input.tool_response)
      && input.tool_response.isError === true ? { toolError: true } : {}),
    ...(plan ? { plan } : {}),
  };
  // One small best-effort request; the installer backgrounds advisory events.
  await request(connection, '/v1/events', event);
}

try {
  const input = await readInput();
  const base = baseEvent(input);
  if (base && Object.hasOwn(EVENTS, input.hook_event_name)) {
    const connection = await connectionFromArgs();
    await observe(input, base, connection);
  }
} catch { /* Exit successfully with no decision or added model context. */ }
// v1 is observation-only, including permission attention. No control reply.
process.stdout.write('{}\n');
