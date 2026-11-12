import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Builds packages/contracts/data/skill-guides.json: the pinned skill texts that the read tool
// (autopets_read_pet) hands to whichever AI the user works in. In the M0 run the AI received only
// the skill names, so the "skill" never reached the work. Each text is copied unchanged from the
// current pinned skill and checked against skill-sources.json; a third-party skill keeps its
// source and a copy of its license in the same file, so every bundle that ships it carries the notice.
const root = fileURLToPath(new URL('../', import.meta.url));
const skills = path.join(root, 'integrations/codex/skills');
const sha = data => createHash('sha256').update(data).digest('hex');
export const GUIDE_FILE = 'packages/contracts/data/skill-guides.json';

export function buildSkillGuides() {
  const registry = JSON.parse(fs.readFileSync(path.join(skills, 'skill-sources.json'), 'utf8'));
  const guides = registry.skills.map(entry => {
    const raw = fs.readFileSync(path.join(skills, entry.id, 'SKILL.md'));
    const text = entry.integrity === 'utf8-lf' ? raw.toString('utf8').replaceAll('\r\n', '\n') : raw.toString('utf8');
    // The stored string must hash to the registered value by itself, without the original file.
    if (sha(Buffer.from(text, 'utf8')) !== entry.sha256) throw Error(`skill-integrity: ${entry.id}`);
    const guide = { id: entry.id, version: entry.version, publisher: entry.publisher, sha256: entry.sha256 };
    if (entry.source) guide.source = entry.source;
    if (entry.license) {
      const license = fs.readFileSync(path.join(skills, entry.id, entry.license.file));
      if (sha(license) !== entry.license.sha256) throw Error(`skill-license-integrity: ${entry.id}`);
      guide.license = { spdx: entry.license.spdx, text: license.toString('utf8') };
    }
    return { ...guide, text };
  });
  return { version: 1, guides };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = path.join(root, GUIDE_FILE);
  fs.writeFileSync(file, `${JSON.stringify(buildSkillGuides(), null, 2)}\n`);
  console.log(`${GUIDE_FILE}: ${buildSkillGuides().guides.length} skills`);
}
