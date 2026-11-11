#!/usr/bin/env node
// Claude Code hook adapter: maps Claude Code hook input onto the same
// metadata-only activity events the Codex hook sends (on its own /v1/claude-code/events route), so the pet reacts to
// Claude Code work. It never sends prompts, tool input/output, transcripts or
// paths other than cwd, prints nothing, and never makes a permission decision.
// Hook input reference: https://code.claude.com/docs/en/hooks
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MAX_BODY, isObject, validString, readConnection, requestJson } from '../../codex/skills/autopets/scripts/bridge-client.mjs';

const EVENTS = Object.freeze({
  SessionStart: 'session_started', UserPromptSubmit: 'turn_started',
  PreToolUse: 'tool_started', PostToolUse: 'tool_finished', PostToolUseFailure: 'tool_finished',
  PermissionRequest: 'permission_requested', Stop: 'turn_finished', StopFailure: 'interrupted',
  SessionEnd: 'session_ended',
});
const SESSION_EVENTS = new Set(['SessionStart', 'SessionEnd']);
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);

export function activityFor(toolName) {
  // Exact Claude Code tool names only; shell text is never read.
  if (['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch'].includes(toolName)) return 'research';
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)) return 'writing';
  if (['Bash', 'PowerShell'].includes(toolName)) return 'tool';
  return 'working';
}

const digest = (...parts) => createHash('sha256').update(JSON.stringify(['autopets-claude-code-v1', ...parts])).digest('hex');

// Returns the /v1/events body, or null when the input must be ignored.
export function eventFor(input, now = Date.now()) {
  if (!isObject(input)) return null;
  const name = input.hook_event_name;
  const kind = typeof name === 'string' && Object.hasOwn(EVENTS, name) ? EVENTS[name] : null;
  if (!kind) return null;
  // Subagents and teammates report as part of the parent turn; their own
  // hooks would otherwise end or restart the parent's work.
  if (input.agent_id !== undefined || input.agent_type !== undefined) return null;
  const sessionId = input.session_id;
  const cwd = input.cwd;
  if (!validString(sessionId, 512) || !validString(cwd, 32768) || !path.isAbsolute(cwd)) return null;
  const turnId = input.prompt_id;
  if (!SESSION_EVENTS.has(name) && !validString(turnId, 512)) return null;
  const event = { sessionId, cwd, kind, timestamp: now };
  if (!SESSION_EVENTS.has(name)) event.turnId = turnId;
  if (TOOL_EVENTS.has(name)) {
    if (!validString(input.tool_name, 256) || !validString(input.tool_use_id, 512)) return null;
    event.toolName = input.tool_name;
    event.toolCallId = input.tool_use_id;
    event.activity = activityFor(input.tool_name);
    if (name === 'PostToolUseFailure') event.toolError = true;
  } else if (name === 'PermissionRequest') {
    if (!validString(input.tool_name, 256)) return null;
    event.toolName = input.tool_name;
  }
  // Deterministic IDs make retried or duplicated hook runs idempotent.
  const call = TOOL_EVENTS.has(name) ? input.tool_use_id : null;
  event.eventId = digest(sessionId, name, SESSION_EVENTS.has(name) ? (input.source ?? input.reason ?? now) : turnId, call);
  return event;
}

// AutoPets writes `--connection <file>` into the plugin when it connects, so the
// hook reaches the exact app instance (and data folder) that installed it.
export function connectionPath(environment = process.env, args = process.argv.slice(2)) {
  if (args.length === 2 && args[0] === '--connection' && path.isAbsolute(args[1])) return args[1];
  if (environment.AUTOPETS_CONNECTION_FILE) return environment.AUTOPETS_CONNECTION_FILE;
  const root = environment.AUTOPETS_DATA_DIR || (environment.LOCALAPPDATA ? path.join(environment.LOCALAPPDATA, 'local.autopets.desktop') : null);
  return root ? path.join(root, 'connection.json') : null;
}

async function readInput(stream = process.stdin) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => finish(new Error('input_timeout')), 2000);
    function finish(error, value) {
      clearTimeout(timer);
      stream.removeAllListeners('data'); stream.removeAllListeners('end'); stream.removeAllListeners('error');
      stream.pause?.();
      if (error) reject(error); else resolve(value);
    }
    stream.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) return finish(new Error('input_limit'));
      chunks.push(Buffer.from(chunk));
    });
    stream.on('end', () => {
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(new Error('input_json')); }
    });
    stream.on('error', () => finish(new Error('input_error')));
  });
}

export async function main({ stdin = process.stdin, environment = process.env, args = process.argv.slice(2), request = requestJson } = {}) {
  try {
    const event = eventFor(await readInput(stdin));
    const location = connectionPath(environment, args);
    if (!event || !location) return;
    await request(await readConnection(location), '/v1/claude-code/events', event);
  } catch { /* AutoPets closed or input unusable: never disturb Claude Code. */ }
}

