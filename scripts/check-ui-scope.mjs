import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ownership = JSON.parse(await fs.readFile(new URL('../docs/development/ui-ownership.json', import.meta.url), 'utf8'));
export function validateOwnedFiles(owner, files) {
  const scope = Object.hasOwn(ownership.owners, owner) ? ownership.owners[owner] : null;
  if (!scope || !Array.isArray(files) || !files.length) throw Error('Specify an owner and its complete changed-file list.');
  const allowed = new Set(scope.files);
  for (const file of files) {
    if (typeof file !== 'string' || file.includes('\\') || file.startsWith('/') || file.split('/').includes('..') || !allowed.has(file)) throw Error(`Out of scope for ${owner}: ${file}`);
  }
  return {owner, files:[...new Set(files)]};
}
export function ownerForAnnotation(annotation) {
  const attrs = annotation?.attributes ?? {};
  const explicitScope = attrs['data-agent-scope'];
  const inheritedScope = attrs['data-agent-review-owner'];
  if (explicitScope && inheritedScope && explicitScope !== inheritedScope) return null;
  const scope = explicitScope ?? inheritedScope;
  const id = attrs['data-agent-id'];
  const prefix = typeof id === 'string' ? id.split('.')[0] : '';
  const knownScope = typeof scope === 'string' && Object.hasOwn(ownership.owners, scope);
  const knownPrefix = Object.hasOwn(ownership.owners, prefix);
  if (knownScope && knownPrefix && scope !== prefix) return null;
  const marked = knownScope ? scope : knownPrefix && !scope ? prefix : null;
  const path = typeof annotation?.elementPath === 'string' ? annotation.elementPath : '';
  const roots = [...path.matchAll(/\[data-agent-(?:id|scope)=["'](home|pet-selection|task-card)(?:\.[a-zA-Z0-9._:-]+)?["']\]/g)];
  const nearest = roots.at(-1)?.[1] ?? null;
  if (marked && nearest && marked !== nearest) return null;
  return marked ?? (!scope ? nearest : null);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(validateOwnedFiles(process.argv[2], process.argv.slice(3)))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
