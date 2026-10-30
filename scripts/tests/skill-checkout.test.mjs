import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { skillDigest, validateBundledSkillPins } from '../../integrations/codex/runtime/pet-skills.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const relativeSkills = 'integrations/codex/skills';

test('fresh Windows-style Git checkout preserves pinned skill and license bytes', async t => {
  try { await execute('git', ['--version'], { windowsHide: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return t.skip('Git is not installed');
    throw error;
  }
  const temporaryParent = await fs.realpath(os.tmpdir());
  const temporary = await fs.mkdtemp(path.join(temporaryParent, 'autopets-skill-checkout-'));
  t.after(async () => {
    const absolute = path.resolve(temporary);
    assert.ok(path.isAbsolute(absolute));
    assert.equal(path.dirname(absolute), temporaryParent);
    assert.ok(path.basename(absolute).startsWith('autopets-skill-checkout-'));
    await fs.rm(absolute, { recursive: true, force: true });
  });

  // Stage the actual attributes and resources in an isolated index. Copying the
  // existing worktree alone cannot reproduce Git's Windows checkout conversion.
  const source = path.join(temporary, 'source');
  await fs.mkdir(source);
  await fs.copyFile(path.join(root, '.gitattributes'), path.join(source, '.gitattributes'));
  await fs.cp(path.join(root, relativeSkills), path.join(source, relativeSkills), { recursive: true });
  const emptyConfig = path.join(temporary, 'empty-git-config');
  const emptyAttributes = path.join(temporary, 'empty-git-attributes');
  await fs.writeFile(emptyConfig, '');
  await fs.writeFile(emptyAttributes, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_CONFIG_COUNT;
  const git = (...args) => execute('git', [
    '-c', 'core.autocrlf=true', '-c', 'core.safecrlf=false',
    '-c', `core.attributesFile=${emptyAttributes.replaceAll('\\', '/')}`, ...args,
  ], { cwd: source, env, windowsHide: true });
  await git('init', '--quiet', '--template=');
  await git('add', '--', '.gitattributes', relativeSkills);
  const checkout = async name => {
    const destination = path.join(temporary, name);
    await fs.mkdir(destination);
    await git('checkout-index', '--all', `--prefix=${destination.replaceAll('\\', '/')}/`);
    return path.join(destination, relativeSkills);
  };

  const checked = await checkout('checked');
  const pins = JSON.parse(await fs.readFile(path.join(checked, 'versions/skill-pins.json'), 'utf8'));
  const current = JSON.parse(await fs.readFile(path.join(checked, 'skill-sources.json'), 'utf8'));
  assert.deepEqual(await validateBundledSkillPins({ root: checked }), {
    current: current.skills.length, preserved: pins.skills.length,
  });
  const frontend = pins.skills.find(entry => entry.id === 'frontend-design');
  assert.equal(frontend?.integrity, 'bytes');
  const archive = entry => path.join('versions', entry.id, entry.version);
  const frontendBody = path.join(archive(frontend), 'SKILL.md');
  assert.equal(skillDigest(await fs.readFile(path.join(checked, frontendBody))), frontend.sha256);
  const licensed = pins.skills.filter(entry => entry.license);
  assert.ok(licensed.length > 0, 'The checkout must exercise archived license files');
  for (const entry of licensed) {
    const file = path.join(archive(entry), entry.license.file);
    assert.equal(skillDigest(await fs.readFile(path.join(checked, file))), entry.license.sha256, file);
  }

  // Negative control: the same index without the archive attribute must really
  // convert LF to CRLF and fail integrity, rather than silently testing a copy.
  const attributes = await fs.readFile(path.join(source, '.gitattributes'), 'utf8');
  await fs.writeFile(path.join(source, '.gitattributes'), attributes.replace(
    /^integrations\/codex\/skills\/versions\/\*\* -text\r?\n/gmu, '',
  ));
  await git('add', '--', '.gitattributes');
  const unprotected = await checkout('unprotected');
  const converted = await fs.readFile(path.join(unprotected, frontendBody));
  assert.ok(converted.includes(Buffer.from('\r\n')), 'Git must apply Windows newline conversion');
  assert.notEqual(skillDigest(converted), frontend.sha256);
  for (const entry of licensed) {
    const file = path.join(archive(entry), entry.license.file);
    assert.notEqual(skillDigest(await fs.readFile(path.join(unprotected, file))), entry.license.sha256, file);
  }
  await assert.rejects(validateBundledSkillPins({ root: unprotected }), /^Error: bundled-skill-integrity$/u);
});
