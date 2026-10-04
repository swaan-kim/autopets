import path from 'node:path';
import { withReadOnlyRuntime } from './rpc.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const text = (value, max = 256) => typeof value === 'string' && value.trim() && Buffer.byteLength(value) <= max && !/[\p{Cc}]/u.test(value);
const cwdKey = value => typeof value === 'string' && /^[A-Za-z]:[\\/]/u.test(value) && text(value, 4096)
  ? path.win32.normalize(value).replaceAll('\\', '/').replace(/\/$/u, '').toLowerCase() : null;

export function validateTaskTargets(targets) {
  if (!Array.isArray(targets) || !targets.length || targets.length > 32) throw new Error('Select 1–32 exact local tasks');
  const seen = new Set();
  for (const target of targets) {
    if (!uuid(target?.id) || !cwdKey(target.cwd) || !text(target.label, 256) || seen.has(target.id)
        || Object.keys(target).some(key => !['id', 'cwd', 'label'].includes(key))) throw new Error('Invalid or duplicate task target');
    seen.add(target.id);
  }
}

export function summarizeTaskMetadata(thread, expected, observedAt) {
  validateTaskTargets([expected]);
  if (thread?.id !== expected.id || cwdKey(thread.cwd) !== cwdKey(expected.cwd) || !Array.isArray(thread.turns) || thread.turns.length)
    throw new Error('Task metadata identity, source or history mismatch');
  const directParent = thread.parentThreadId ?? null;
  const sourceParent = thread.source?.subAgent?.thread_spawn?.parent_thread_id ?? null;
  if (directParent && sourceParent && directParent !== sourceParent) throw new Error('Conflicting parent task evidence');
  const parentId = directParent ?? sourceParent;
  const forkedFromId = thread.forkedFromId ?? null;
  if ([parentId, forkedFromId].some(id => id !== null && (!uuid(id) || id === thread.id))) throw new Error('Invalid task relation');
  if (thread.projectId != null && !text(thread.projectId, 256)) throw new Error('Invalid project identity');
  if (!Number.isSafeInteger(thread.updatedAt) || thread.updatedAt < 0 || !Number.isSafeInteger(thread.updatedAt * 1000)
      || !Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error('Invalid metadata time');
  return {
    id: expected.id, label: expected.label, cwd: thread.cwd, projectId: thread.projectId ?? null, parentId, forkedFromId,
    creationSurface: thread.originator === 'Codex Desktop' ? 'codex-local' : thread.originator === 'codex_work_desktop' ? 'work-local' : 'unknown',
    runtimeStatus: ({ notLoaded: 'not-loaded', idle: 'idle', active: 'active', systemError: 'error' })[thread.status?.type] ?? 'unknown',
    configuredModel: text(thread.model, 128) ? thread.model : null,
    configuredReasoning: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(thread.reasoningEffort) ? thread.reasoningEffort : null,
    metadataUpdatedAt: thread.updatedAt * 1000, observedAt,
  };
}

/** Reads only explicitly selected IDs. No global listing or full conversation collection. */
export async function inspectTaskMetadata({ targets, sourceId, ...options }) {
  validateTaskTargets(targets);
  if (!text(sourceId, 256)) throw new Error('Invalid metadata source');
  return withReadOnlyRuntime(options, async ({ call, initialized }) => {
    const nodes = [];
    for (const target of targets) {
      const result = await call('thread/read', { threadId: target.id, includeTurns: false });
      nodes.push(summarizeTaskMetadata(result?.thread, target, Date.now()));
    }
    return { version: 1, sourceId, source: 'app-server-metadata', runtime: text(initialized?.userAgent, 256) ? initialized.userAgent : 'unknown', nodes };
  });
}
