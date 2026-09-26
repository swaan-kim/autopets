import { createHash } from 'node:crypto';

// Observer and synchronous preparation can race to establish the same binding.
// The existing receiver event ID constraint deduplicates both without storing input.
export function turnStartId({ sessionId, turnId, cwd }) {
  const project = process.platform === 'win32' ? cwd.replaceAll('\\', '/').toLowerCase() : cwd;
  return `autopets-start-v1-${createHash('sha256').update(JSON.stringify([sessionId, turnId, project])).digest('hex')}`;
}
