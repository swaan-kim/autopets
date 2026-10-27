import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// MSIX can redirect files while realpath(directory) still returns the logical
// directory. Anchor siblings to this installed runtime file's physical location;
// do not relax the per-skill containment or integrity checks below.
export function skillRootForRuntime(runtimeFile, resolveFile = realpathSync.native) {
  return path.resolve(path.dirname(resolveFile(runtimeFile)), '../skills');
}
export const SKILL_ROOT = skillRootForRuntime(fileURLToPath(import.meta.url));
export const skillDigest = text => createHash('sha256').update(text).digest('hex');
const canonical = text => text.replaceAll('\r\n', '\n');
const helper = { id: 'autopets-figma-design', version: '1.0.0' };
const validId = value => typeof value === 'string' && /^[a-z0-9-]+$/u.test(value);
const validVersion = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const pinFile = 'versions/skill-pins.json';

function validateEntry(entry) {
  if (!entry || !validId(entry.id) || !validVersion(entry.version) || !validHash(entry.sha256)
    || !['bytes', 'utf8-lf'].includes(entry.integrity) || typeof entry.publisher !== 'string' || !entry.publisher.trim()) throw Error('bundled-skill-registry-invalid');
  if (entry.license && (typeof entry.license.spdx !== 'string' || !entry.license.spdx.trim()
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(entry.license.file ?? '') || !validHash(entry.license.sha256))) throw Error('bundled-skill-provenance-invalid');
  if (entry.source !== undefined) {
    let source;
    try { source = new URL(entry.source); } catch { throw Error('bundled-skill-provenance-invalid'); }
    const commit = entry.upstreamCommit ?? entry.version;
    if (source.protocol !== 'https:' || source.hostname !== 'github.com' || source.username || source.password
      || !/^[a-f0-9]{40}$/u.test(commit) || !source.pathname.split('/').includes(commit)
      || typeof entry.modified !== 'boolean' || !entry.license
      || (entry.modified && !validHash(entry.upstreamSha256))) throw Error('bundled-skill-provenance-invalid');
  } else if (entry.modified || entry.upstreamCommit || entry.upstreamSha256) throw Error('bundled-skill-provenance-invalid');
}
function pinIdentity(entry) {
  const { id, version, publisher, integrity, sha256, source, modified, upstreamCommit, upstreamSha256, license } = entry;
  return JSON.stringify({ id, version, publisher, integrity, sha256, source, modified, upstreamCommit, upstreamSha256,
    license: license && { spdx: license.spdx, file: license.file, sha256: license.sha256 } });
}
async function packagedPath(root, relative, options) {
  const locate = options.realpath ?? realpath;
  const file = path.join(root, relative);
  const actual = await locate(file).catch(() => { throw Error('bundled-skill-missing'); });
  const actualRoot = await locate(root);
  if (path.relative(actualRoot, actual) !== relative) throw Error('bundled-skill-location-mismatch');
  return actual;
}
async function registryAt(root, relative, options) {
  const file = await packagedPath(root, relative, options);
  const text = await (options.readFile ?? readFile)(file, 'utf8');
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024) throw Error('bundled-skill-registry-invalid');
  let registry;
  try { registry = JSON.parse(text); } catch { throw Error('bundled-skill-registry-invalid'); }
  if (registry.version !== 1 || !Array.isArray(registry.skills) || registry.skills.length > 256) throw Error('bundled-skill-registry-invalid');
  for (const entry of registry.skills) validateEntry(entry);
  return registry;
}
async function resolveEntry(root, entry, directory, options) {
  const load = options.readFile ?? readFile;
  const actual = await packagedPath(root, path.join(directory, 'SKILL.md'), options);
  const raw = await load(actual, 'utf8').catch(() => { throw Error('bundled-skill-missing'); });
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 65536 || !raw.includes(`name: ${entry.id}`)) throw Error('bundled-skill-invalid');
  if (skillDigest(entry.integrity === 'utf8-lf' ? canonical(raw) : raw) !== entry.sha256) throw Error('bundled-skill-integrity');
  if (entry.license) {
    const licensePath = await packagedPath(root, path.join(directory, entry.license.file), options);
    const license = await load(licensePath);
    if (skillDigest(license) !== entry.license.sha256) throw Error('bundled-skill-license-integrity');
  }
  return { id: entry.id, version: entry.version, path: actual, sha256: entry.sha256, textSha256: skillDigest(canonical(raw)) };
}

/** Build-time validation: retain every committed pin, including its license and origin declaration. */
export async function validateBundledSkillPins(options = {}) {
  const root = options.root ?? SKILL_ROOT;
  const current = await registryAt(root, 'skill-sources.json', options);
  const pins = await registryAt(root, path.join(...pinFile.split('/')), options);
  const keys = new Set();
  for (const entry of pins.skills) {
    const key = `${entry.id}/${entry.version}`;
    if (keys.has(key)) throw Error('bundled-skill-pin-duplicate');
    keys.add(key);
    await resolveEntry(root, entry, path.join('versions', entry.id, entry.version), options);
  }
  for (const entry of current.skills) {
    const matches = pins.skills.filter(pin => pin.id === entry.id && pin.version === entry.version);
    if (matches.length !== 1 || pinIdentity(matches[0]) !== pinIdentity(entry)) throw Error('bundled-skill-pin-mismatch');
    await resolveEntry(root, entry, entry.id, options);
  }
  return { current: current.skills.length, preserved: pins.skills.length };
}

/** Resolve one immutable installed pin without asking the model to transcribe a commit hash.
 * The observer still compares the returned version and complete content with the request's pin.
 */
export async function readBundledSkill(id, options = {}) {
  if (!validId(id)) throw Error('bundled-skill-reference-invalid');
  const registry = JSON.parse(await (options.readFile ?? readFile)(path.join(options.root ?? SKILL_ROOT, 'skill-sources.json'), 'utf8'));
  if (registry.version !== 1 || !Array.isArray(registry.skills)) throw Error('bundled-skill-registry-invalid');
  const matches = registry.skills.filter(skill => skill.id === id);
  if (matches.length !== 1 || typeof matches[0].version !== 'string') throw Error('bundled-skill-unavailable');
  return readPinnedSkill(id, matches[0].version, options);
}

/** Resolve only packaged, pinned skill references. Saved templates never supply filesystem paths. */
export async function resolvePetSkills(template, options = {}) {
  const root = options.root ?? SKILL_ROOT;
  const registry = await registryAt(root, 'skill-sources.json', options);
  const pins = await registryAt(root, path.join(...pinFile.split('/')), options);
  const references = template?.skills;
  if (!Array.isArray(references) || !references.length || references.length > 8) throw Error('bundled-skill-reference-required');
  const requested = [...references, ...(template.features?.figmaDesign ? [helper] : [])];
  const seen = new Set(), selected = [];
  for (const ref of requested) {
    if (!ref || !validId(ref.id) || !validVersion(ref.version)) throw Error('bundled-skill-reference-invalid');
    if (seen.has(ref.id)) throw Error('bundled-skill-reference-duplicate');
    seen.add(ref.id);
    const found = registry.skills.filter(s => s.id === ref.id && s.version === ref.version);
    const archived = pins.skills.filter(s => s.id === ref.id && s.version === ref.version);
    if (found.length > 1 || archived.length > 1) throw Error('bundled-skill-unavailable');
    if (archived.length !== 1) throw Error(found.length ? 'bundled-skill-pin-mismatch' : 'bundled-skill-unavailable');
    if (found.length && pinIdentity(found[0]) !== pinIdentity(archived[0])) throw Error('bundled-skill-pin-mismatch');
    const entry = found[0] ?? archived[0];
    const skill = await resolveEntry(root, entry, found.length ? ref.id : path.join('versions', ref.id, ref.version), options);
    // A pre-update reader used the stable current path. Historical host output
    // can still prove that old read through exact version + full content hashes;
    // never read/execute the newer file when recovering this evidence.
    if (!found.length) skill.evidencePaths = [skill.path, path.join(await (options.realpath ?? realpath)(root), ref.id, 'SKILL.md')];
    selected.push(skill);
  }
  return selected;
}

export function petSkillInstruction(template, skills, profile) {
  if (typeof template?.instruction !== 'string' || !template.instruction.trim()) throw Error('pet-instruction-missing');
  const paths = skills.map(skill => skill.path).join('\n');
  const instruction = `${template.instruction}\n선택 스킬 파일을 각각 완전히 읽고 적용하세요:\n${paths}\n반환된 skillReader.reads의 실행 파일과 인수를 각각 그대로 사용하세요. 인수에는 선택한 정확한 버전이 포함됩니다. 긴 버전 해시를 다시 입력하거나 끝에 점(.)이나 작업 폴더를 붙이지 마세요. 작업 폴더는 도구의 cwd로 지정하세요. 인용·인수 오류는 현재 턴 안에서 읽기 명령을 수정해 확인하세요. 부모의 요약은 실제 스킬 읽기를 대신하지 않습니다. 추가 하위 작업은 만들지 마세요.${profile === 'plan' ? '\n계획만 제시하고 확인을 기다리세요. 파일을 수정하지 마세요.' : ''}${template.features?.figmaDesign ? '\nFigma 시안 활용이 켜져 있습니다. 제공된 프레임과 현재 호스트의 공식 Figma 스킬·도구를 확인하세요. 연결이나 권한이 없으면 시안 작업을 멈추고 필요한 연결을 안내하세요. Figma 원본을 쓰지 마세요.' : ''}`;
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
