import path from 'node:path';
import { readConnection } from '../skills/autopets/scripts/bridge-client.mjs';
import { validateTaskTargets } from './task-metadata.mjs';

const reasons = new Set(['task-not-observed', 'task-context-mismatch', 'active-turn-not-observed']);
const cwdKey = value => typeof value === 'string' ? path.win32.normalize(value).replaceAll('\\', '/').replace(/\/$/u, '').toLowerCase() : null;

// Read only an explicitly selected active binding. No events or capabilities are written.
// A missing active binding is not evidence that historical events were never received.
export async function inspectReceiver({ connectionPath, targets, timeoutMs = 2000 }) {
  validateTaskTargets(targets);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error('Invalid diagnostic timeout');
  const connection = await readConnection(connectionPath);
  const result = { version: 1, source: 'autopets-active-binding', observedAt: Date.now(), historicalReceipt: 'not-inspected', targets: [] };
  for (const target of targets) {
    const row = { label: target.label, activeBinding: false, httpStatus: null, reason: 'unavailable' };
    try {
      const query = new URLSearchParams({ sessionId: target.id, cwd: target.cwd });
      const response = await fetch(`${connection.baseUrl}/v1/task-context?${query}`, {
        headers: { Authorization: `Bearer ${connection.token}` }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      });
      row.httpStatus = response.status;
      const reader = response.body?.getReader();
      if (!reader) throw new Error('body');
      const chunks = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 4096) throw new Error('limit');
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      row.activeBinding = response.ok && body?.sessionId === target.id && cwdKey(body.cwd) === cwdKey(target.cwd)
        && typeof body.turnId === 'string' && body.turnId.length > 0 && body.turnId.length <= 512 && !/[\p{Cc}]/u.test(body.turnId);
      row.reason = response.ok ? (row.activeBinding ? 'active-binding-observed' : 'response-identity-mismatch')
        : reasons.has(body?.error) ? body.error : 'unclassified-rejection';
    } catch { row.reason = row.httpStatus === null ? 'unavailable' : 'unreadable-response'; }
    result.targets.push(row);
  }
  return result;
}
