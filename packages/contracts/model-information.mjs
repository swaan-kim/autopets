import catalog from './data/model-information.json' with { type: 'json' };

/** Reference information only: never add model availability or routing capabilities. */
export function modelInformation(model, surface, now = Date.now()) {
  const entry = catalog.entries.find(item => item.model === model && item.surfaces.includes(surface));
  if (!entry) return { status: 'unknown', model };
  const reviewed = Date.parse(`${entry.reviewedAt}T00:00:00Z`);
  const stale = !Number.isFinite(now) || now < reviewed || now - reviewed >= catalog.reviewAfterDays * 86_400_000;
  return { status: stale ? 'stale' : 'reference', ...structuredClone(entry) };
}
