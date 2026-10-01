import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const SKILL_ROOT = fileURLToPath(new URL('../skills/', import.meta.url));
export const skillDigest = text => createHash('sha256').update(text).digest('hex');
const canonical = text => text.replaceAll('\r\n', '\n');
const helper = { id: 'autopets-figma-design', version: '1.0.0' };

/** Resolve only packaged, pinned skill references. Saved templates never supply filesystem paths. */
export async function resolvePetSkills(template, options = {}) {
  const root = options.root ?? SKILL_ROOT;
  const load = options.readFile ?? readFile;
  const registry = JSON.parse(await load(path.join(root, 'skill-sources.json'), 'utf8'));
  if (registry.version !== 1 || !Array.isArray(registry.skills)) throw Error('bundled-skill-registry-invalid');
  const references = template?.skills;
  if (!Array.isArray(references) || !references.length || references.length > 8) throw Error('bundled-skill-reference-required');
  const requested = [...references, ...(template.features?.figmaDesign ? [helper] : [])];
  const seen = new Set(), selected = [];
  for (const ref of requested) {
    if (!ref || !/^[a-z0-9-]+$/u.test(ref.id) || typeof ref.version !== 'string') throw Error('bundled-skill-reference-invalid');
    if (seen.has(ref.id)) throw Error('bundled-skill-reference-duplicate');
    seen.add(ref.id);
    const found = registry.skills.filter(s => s.id === ref.id && s.version === ref.version);
    if (found.length !== 1) throw Error('bundled-skill-unavailable');
    const entry = found[0];
    const file = path.join(root, ref.id, 'SKILL.md');
    // Reject symlink substitution or checkout paths in a relocated installed package.
    const actual = await (options.realpath ?? realpath)(file).catch(() => { throw Error('bundled-skill-missing'); });
    const actualRoot = await (options.realpath ?? realpath)(root);
    if (path.relative(actualRoot, actual) !== path.join(ref.id, 'SKILL.md')) throw Error('bundled-skill-location-mismatch');
    const raw = await load(file, 'utf8').catch(() => { throw Error('bundled-skill-missing'); });
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 65536 || !raw.includes(`name: ${ref.id}`)) throw Error('bundled-skill-invalid');
    const digestInput = entry.integrity === 'utf8-lf' ? canonical(raw) : raw;
    if (skillDigest(digestInput) !== entry.sha256) throw Error('bundled-skill-integrity');
    if (entry.license) {
      const license = await load(path.join(root, ref.id, entry.license.file));
      if (skillDigest(license) !== entry.license.sha256) throw Error('bundled-skill-license-integrity');
    }
    selected.push({ id: ref.id, version: ref.version, path: actual, sha256: entry.sha256, textSha256: skillDigest(canonical(raw)) });
  }
  return selected;
}

export function petSkillInstruction(template, skills, profile) {
  if (typeof template?.instruction !== 'string' || !template.instruction.trim()) throw Error('pet-instruction-missing');
  const paths = skills.map(skill => skill.path).join('\n');
  const instruction = `${template.instruction}\n선택 스킬 파일을 각각 완전히 읽고 적용하세요:\n${paths}\n가능하면 반환된 skillReader 실행 파일과 인수를 그대로 사용해 읽으세요. 추가 하위 작업은 만들지 마세요.${profile === 'plan' ? '\n계획만 제시하고 확인을 기다리세요. 파일을 수정하지 마세요.' : ''}${template.features?.figmaDesign ? '\nFigma 시안 활용이 켜져 있습니다. 제공된 프레임과 현재 호스트의 공식 Figma 스킬·도구를 확인하세요. 연결이나 권한이 없으면 시안 작업을 멈추고 필요한 연결을 안내하세요. Figma 원본을 쓰지 마세요.' : ''}`;
  if (Buffer.byteLength(instruction) > 3072) throw Error('instruction-limit');
  return instruction;
}

/** A content-bearing read result; a path or model self-report alone is not read evidence. */
export async function readPinnedSkill(id, version, options = {}) {
  const [skill] = await resolvePetSkills({ skills: [{ id, version }] }, options);
  const text = await (options.readFile ?? readFile)(skill.path, 'utf8');
  if (skillDigest(canonical(text)) !== skill.textSha256) throw Error('bundled-skill-integrity');
  return { kind: 'autopets-skill-read-v1', id, version, path: skill.path, sha256: skill.sha256, text };
}
