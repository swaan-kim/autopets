import fs from 'node:fs';
// Node-only (reads JSON with fs). Not exported from index.mjs, which is also bundled into the browser extension.

const freeze = value => {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
};

export const ROUTING = freeze(JSON.parse(fs.readFileSync(new URL('./data/routing-profiles.json', import.meta.url), 'utf8')));
export const ROUTING_PROFILE_KEYS = Object.freeze(Object.keys(ROUTING.profiles));

/** Model and effort for one profile on one host. Unknown host/profile is an error, never a substitute. */
export function routingSettings(profile, host = 'codex-windows-local') {
  const meta = ROUTING.profiles[profile];
  const settings = ROUTING.hosts[host]?.profiles?.[profile];
  if (!meta || !settings) throw Error('unsupported-delegation-profile');
  return { key: profile, ...meta, ...settings };
}

/** Exact profile key for saved model settings, or null when no profile of that stage matches. */
export function profileForSettings(stage, model, effort, host = 'codex-windows-local') {
  const hostProfiles = ROUTING.hosts[host]?.profiles ?? {};
  return ROUTING_PROFILE_KEYS.find(key => ROUTING.profiles[key].stage === stage
    && hostProfiles[key]?.model === model && hostProfiles[key]?.effort === effort) ?? null;
}

/**
 * Plan settings for a saved pet template. A planning value from planOptions is used as saved;
 * a template without planning keeps the profile default. Anything else is rejected, never substituted.
 */
export function planSettings(template, host = 'codex-windows-local') {
  const base = routingSettings('plan', host);
  const planning = template?.planning;
  if (!planning) return base;
  const option = (ROUTING.hosts[host].planOptions ?? []).find(o => o.model === planning.model && o.effort === planning.reasoning);
  if (!option) throw Error('pet-template-routing-unsupported');
  return { ...base, model: option.model, effort: option.effort };
}
