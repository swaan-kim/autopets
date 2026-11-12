import fs from 'node:fs';
import { createHash } from 'node:crypto';
// Node-only (reads JSON with fs). Not exported from index.mjs, which is also bundled into the browser extension.
// The pinned skill texts a pet points to, for the read tool to hand to any AI (Codex, Claude Code,
// Claude). Built by scripts/build-skill-guides.mjs from the pinned skill files; nothing here comes
// from a saved pet, a chat or the network.

// Literal URL, so the bundle import check can see which data file this module needs.
const DATA = JSON.parse(fs.readFileSync(new URL('./data/skill-guides.json', import.meta.url), 'utf8'));
const sha = text => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
const short = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

/** One skill text may be this large, and one answer may carry this much in total (UTF-8 bytes). */
export const GUIDE_LIMIT = 16000;
export const GUIDE_TOTAL = 24000;

/** Shape and integrity of skill-guides.json. Throws `invalid-skill-guides`; never repairs data. */
export function validateSkillGuides(data) {
  const valid = data?.version === 1 && Array.isArray(data.guides) && data.guides.length > 0 && data.guides.length <= 64
    && new Set(data.guides.map(guide => `${guide?.id}/${guide?.version}`)).size === data.guides.length
    && data.guides.every(guide => /^[a-z0-9-]{1,64}$/u.test(guide.id ?? '') && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(guide.version ?? '')
      && short(guide.publisher, 60) && short(guide.text, 65536) && sha(guide.text) === guide.sha256
      && (guide.source === undefined || /^https:\/\/github\.com\//u.test(guide.source))
      // A text that came from someone else keeps its license next to it.
      && (guide.source === undefined || short(guide.license?.spdx, 40) && short(guide.license?.text, 65536)));
  if (!valid) throw Error('invalid-skill-guides');
  return data;
}

/**
 * The texts for exactly these skill references (same id and same pinned version), in order.
 * A reference without a bundled text, a text whose hash no longer matches, or one over the size
 * limits is left out; the caller still lists it as a reference. The license text stays in the
 * bundle and is not sent to the model.
 */
export function skillGuides(references, { data = DATA, limit = GUIDE_LIMIT, total = GUIDE_TOTAL } = {}) {
  const guides = [];
  let used = 0;
  for (const reference of Array.isArray(references) ? references : []) {
    const guide = data.guides.find(item => item.id === reference?.id && item.version === reference?.version);
    if (!guide || sha(guide.text) !== guide.sha256) continue;
    const size = Buffer.byteLength(guide.text, 'utf8');
    if (size > limit || used + size > total) continue;
    used += size;
    guides.push({ id: guide.id, version: guide.version, publisher: guide.publisher,
      ...(guide.source ? { source: guide.source, license: guide.license.spdx } : {}), text: guide.text });
  }
  return guides;
}
