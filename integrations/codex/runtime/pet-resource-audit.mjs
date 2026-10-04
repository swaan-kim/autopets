import path from 'node:path';
import { skillDigest } from './pet-skills.mjs';

const normalized = value => value.replaceAll('\\\\', '\\').replaceAll('\\', '/').toLowerCase();
// A shell command can be nested in JavaScript and JSON. Collapse escaped command
// separators only; the returned file path and complete content remain exact checks.
const commandSource = value => (typeof value === 'string' ? value : JSON.stringify(value ?? ''))
  .replace(/\\+/gu, '/').toLowerCase();
const canonical = text => text.replaceAll('\r\n', '\n');

function objects(value, depth = 0) {
  if (depth > 10 || value == null) return [];
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > 256 * 1024) return [];
    try { return objects(JSON.parse(value), depth + 1); } catch { /* CLI headers may precede JSON. */ }
    return value.split(/\r?\n/u).filter(line => line.trim().startsWith('{')).flatMap(line => {
      try { return objects(JSON.parse(line), depth + 1); } catch { return []; }
    });
  }
  if (Array.isArray(value)) return value.flatMap(item => objects(item, depth + 1));
  if (typeof value !== 'object') return [];
  if (value.exit_code != null && value.exit_code !== 0) return [];
  if (value.isError === true || value.error != null) return [];
  if (value.status === 'rejected') return [];
  return [value, ...['output', 'text', 'content', 'result'].flatMap(key => objects(value[key], depth + 1)),
    ...(value.status === 'fulfilled' ? objects(value.value, depth + 1) : [])];
}

/** Only direct host-recorded MCP calls can authenticate tool identity. Arbitrary JS mentions cannot. */
export function classifyFigmaRead(call, output) {
  const name = call?.name ?? '';
  if (!/^mcp__figma(?:_[a-z0-9]+)?__(?:get_design_context|getDesignContext)$/iu.test(name) && name !== 'mcp__codex_apps__figma_get_design_context') {
    return /figma|get_design_context/u.test(JSON.stringify(call ?? {})) ? 'unverified-nested-call' : 'not-figma-read';
  }
  let args;
  try { args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments; } catch { return 'unverified-arguments'; }
  if (!args || typeof (args.nodeId ?? args.node_id) !== 'string' || typeof (args.fileKey ?? args.file_key) !== 'string') return 'unverified-target';
  const candidates = objects(output);
  // Require an explicitly successful MCP envelope and real returned content. A tool name,
  // function echo, permission prompt, or a model's "used Figma" claim is insufficient.
  if (candidates.some(value => value.isError === false && Array.isArray(value.content) && value.content.length > 0
    && value.content.some(item => item.type === 'image' || (item.type === 'text' && typeof item.text === 'string' && item.text.trim().length > 0))
    && !value.content.some(item => typeof item.text === 'string' && /(?:unauthorized|authentication required|permission denied|access denied|tool.*error)/iu.test(item.text)))) return 'read-confirmed';
  return 'unverified-result';
}

/** Reduce only a bound child's selected turn to resource identities; never return source text. */
export function auditPetResources(rows, turnId, expectedSkills, figmaEnabled = false) {
  const calls = new Map(), invalidCalls = new Set(), completedCalls = new Set(), read = new Set();
  const counts = new Map();
  let countedTurn = null;
  for (const row of rows) {
    const p = row?.payload;
    if (row.type === 'turn_context') countedTurn = p?.turn_id;
    if (row.type === 'event_msg' && p?.type === 'task_started') countedTurn = p.turn_id;
    if (countedTurn !== turnId || row.type !== 'response_item' || typeof p?.call_id !== 'string') continue;
    if (!['function_call', 'custom_tool_call', 'function_call_output', 'custom_tool_call_output'].includes(p.type)) continue;
    const countsForId = counts.get(p.call_id) ?? { calls: 0, outputs: 0 };
    countsForId[p.type.endsWith('_output') ? 'outputs' : 'calls']++;
    counts.set(p.call_id, countsForId);
  }
  let currentTurn = null, figmaUsed = false;
  const figmaDiagnostics = new Set();
  for (const row of rows) {
    const p = row?.payload;
    if (row.type === 'turn_context') currentTurn = p?.turn_id;
    if (row.type === 'event_msg' && p?.type === 'task_started') currentTurn = p.turn_id;
    if (currentTurn !== turnId || row.type !== 'response_item' || !p) continue;
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      if (typeof p.call_id !== 'string') continue;
      if (calls.has(p.call_id)) invalidCalls.add(p.call_id);
      calls.set(p.call_id, p);
      continue;
    }
    if (!['function_call_output', 'custom_tool_call_output'].includes(p.type) || !calls.has(p.call_id)
      || counts.get(p.call_id)?.calls !== 1 || counts.get(p.call_id)?.outputs !== 1
      || invalidCalls.has(p.call_id) || completedCalls.has(p.call_id)) continue;
    completedCalls.add(p.call_id);
    const call = calls.get(p.call_id);
    const source = commandSource(call.arguments ?? call.input);
    const resultObjects = objects(p.output);
    for (const skill of expectedSkills) {
      // Reader input and complete file output must agree. Neither the requested command
      // nor a hash-only acknowledgement proves the model received a skill's instructions.
      const readerRequested = source.includes('/autopets/scripts/read-skill.mjs') && source.includes('--id') && source.includes(skill.id) && source.includes(skill.version);
      if (!readerRequested) continue;
      const confirmed = resultObjects.some(value => value.kind === 'autopets-skill-read-v1'
        && value.id === skill.id && value.version === skill.version && value.sha256 === skill.sha256
        && typeof value.path === 'string' && normalized(path.resolve(value.path)) === normalized(path.resolve(skill.path))
        && typeof value.text === 'string' && skillDigest(canonical(value.text)) === skill.textSha256);
      if (confirmed) read.add(`${skill.id}@${skill.version}`);
    }
    if (figmaEnabled) {
      const state = classifyFigmaRead(call, p.output);
      if (state === 'read-confirmed') figmaUsed = true;
      else if (state !== 'not-figma-read') figmaDiagnostics.add(state);
    }
  }
  return { skills: expectedSkills.filter(skill => read.has(`${skill.id}@${skill.version}`)).map(({ id, version }) => ({ id, version })),
    figmaUsed, figmaObservation: figmaUsed ? 'read-confirmed' : [...figmaDiagnostics][0] ?? 'not-observed' };
}
