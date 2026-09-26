import { open } from 'node:fs/promises';
import path from 'node:path';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
const slug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(value);
const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

/** Read only an explicitly selected test transcript. Never discover or print conversation text. */
export async function auditTurnSelection(file, expectedThreadId, expectedParentId = null) {
  if (!path.isAbsolute(file) || !uuid(expectedThreadId)) throw Error('Explicit transcript path and thread UUID required');
  if (expectedParentId !== null && (!uuid(expectedParentId) || expectedParentId === expectedThreadId)) throw Error('Invalid expected parent');
  const handle = await open(file, 'r');
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw Error('Transcript size limit');
    bytes = await handle.readFile();
    if (bytes.length > 32 * 1024 * 1024) throw Error('Transcript size limit');
  } finally { await handle.close(); }
  const turns = new Map();
  let identitySeen = false;
  let surface = 'unknown';
  // Invalid/truncated input is an incomplete observation, never a partial success.
  for (const line of new TextDecoder('utf-8', { fatal: true }).decode(bytes).split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { throw Error('Incomplete transcript record'); }
    const payload = row?.payload;
    if (row.type === 'session_meta') {
      const parent = payload?.source?.subagent?.thread_spawn?.parent_thread_id ?? payload?.source?.subAgent?.thread_spawn?.parent_thread_id ?? payload?.parent_thread_id;
      if (payload?.id !== expectedThreadId || (expectedParentId !== null && (parent !== expectedParentId || (payload.parent_thread_id && payload.parent_thread_id !== expectedParentId)))
        || (payload.session_id && payload.session_id !== expectedThreadId && (expectedParentId === null || payload.session_id !== expectedParentId))) throw Error('Transcript identity mismatch');
      const observed = payload.originator === 'Codex Desktop' ? 'codex-desktop'
        : payload.originator === 'codex_work_desktop' ? 'work-local' : 'unknown';
      if (identitySeen && surface !== observed) throw Error('Conflicting runtime surface');
      surface = observed;
      identitySeen = true;
    } else if (row.type === 'turn_context') {
      if (!identitySeen || !uuid(payload?.turn_id) || !slug(payload?.model)) throw Error('Unbound turn context');
      const selection = { turnId: payload.turn_id, model: payload.model, reasoning: efforts.has(payload.effort) ? payload.effort : null,
        mode: ['default', 'plan'].includes(payload.collaboration_mode?.mode) ? payload.collaboration_mode.mode : null };
      const existing = turns.get(payload.turn_id);
      if (existing && JSON.stringify(existing.selection) !== JSON.stringify(selection)) throw Error('Conflicting turn selections');
      turns.set(payload.turn_id, existing ?? { selection, completed: false });
    } else if (row.type === 'event_msg' && payload?.type === 'task_complete') {
      const turn = turns.get(payload.turn_id);
      if (turn) turn.completed = true;
    }
  }
  if (!identitySeen) throw Error('Missing transcript identity');
  return { version: 1, threadId: expectedThreadId, surface, evidence: 'local-runtime-turn-context', serverResolvedModelVerified: false,
    externalAdapterVerified: false, turns: [...turns.values()].map(turn => ({ ...turn.selection, completed: turn.completed })) };
}
