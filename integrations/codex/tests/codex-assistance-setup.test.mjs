import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { STATUS, hookCommands, updateHooks } from '../assistance/setup.mjs';

const setup = fileURLToPath(new URL('../assistance/setup.mjs', import.meta.url));
const events = ['UserPromptSubmit', 'SessionStart', 'PostCompact'];

async function snapshot(directory) {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    files[entry.name] = entry.isDirectory() ? await snapshot(file) : (await readFile(file)).toString('base64');
  }
  return files;
}

async function fixture(t, hooks) {
  const root = await mkdtemp(path.join(tmpdir(), "autopets-setup-한글-'-"));
  t.after(async () => {
    assert.equal(path.dirname(root), tmpdir());
    assert.ok(path.basename(root).startsWith('autopets-setup-'));
    await rm(root, { recursive: true, force: true });
  });
  const project = path.join(root, 'project'), home = path.join(root, 'fixture-home');
  await mkdir(project); await mkdir(path.join(home, '.codex'), { recursive: true });
  // A fake global config makes accidental non-project writes observable without
  // ever exposing the actual user profile to the child process.
  await writeFile(path.join(home, '.codex', 'config.toml'), 'trust_level = "untrusted"\n');
  const hooksFile = path.join(project, '.codex', 'hooks.json');
  if (hooks !== undefined) {
    await mkdir(path.dirname(hooksFile));
    await writeFile(hooksFile, typeof hooks === 'string' ? hooks : `${JSON.stringify(hooks, null, 2)}\n`);
  }
  const configFile = path.join(project, '.local', 'autopets-assistance', 'config.json');
  const connection = path.join(root, 'connection.json');
  const run = async (...flags) => {
    assert.equal(path.dirname(project), root);
    const result = await new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [setup, '--project', project, ...flags], {
        cwd: project, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex') },
      });
      let stdout = '', stderr = '';
      proc.stdout.on('data', value => stdout += value); proc.stderr.on('data', value => stderr += value);
      proc.on('error', reject); proc.on('close', code => resolve({ code, stdout, stderr }));
    });
    return { ...result, report: result.code === 0 ? JSON.parse(result.stdout) : null };
  };
  return { root, project, home, hooksFile, configFile, connection, run };
}

test('assistance setup defaults to dry-run and writes neither project nor global configuration', async t => {
  const f = await fixture(t), before = await snapshot(f.root);
  const result = await f.run('--connection', f.connection, '--validation');
  assert.equal(result.code, 0); assert.equal(result.stderr, '');
  assert.equal(result.report.dryRun, true); assert.equal(result.report.changed, true);
  assert.equal(result.report.trustChanged, false); assert.equal(result.report.productionVerified, false);
  assert.deepEqual(await snapshot(f.root), before);
});

test('assistance hook removal requires the exact command pair, marker and type and preserves other hooks', async t => {
  const f = await fixture(t), commands = hookCommands(f.configFile);
  const owned = { type: 'command', ...commands, statusMessage: STATUS, timeout: 8 };
  const foreign = [
    { ...owned, statusMessage: 'user owned hook' },
    { ...owned, command: `${commands.command} --custom` },
    { ...owned, commandWindows: `${commands.commandWindows}AA` },
    { ...owned, type: 'prompt' },
    { type: 'command', command: 'user-check', statusMessage: STATUS },
  ];
  const source = { customSetting: { preserve: true }, hooks: {
    UserPromptSubmit: [{ matcher: 'keep-this-matcher', custom: 1, hooks: [owned, ...foreign] }],
    SessionStart: [{ hooks: [owned] }], Stop: [{ hooks: [{ type: 'command', command: 'other-tool' }] }],
  } };
  const copy = structuredClone(source), result = updateHooks(source, commands, false);
  assert.deepEqual(source, copy, 'input must not be mutated');
  assert.deepEqual(result, { customSetting: { preserve: true }, hooks: {
    UserPromptSubmit: [{ matcher: 'keep-this-matcher', custom: 1, hooks: foreign }],
    Stop: source.hooks.Stop,
  } });
});

test('assistance install is idempotent on disk, preserves existing hooks and emits one owned handler per event', async t => {
  const original = { hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'user-hook' }] }] }, customSetting: 'retain' };
  const f = await fixture(t, original), homeBefore = await snapshot(f.home);
  const first = await f.run('--connection', f.connection, '--validation', '--apply');
  assert.equal(first.code, 0); assert.equal(first.report.changed, true); assert.equal(first.report.dryRun, false);
  const saved = JSON.parse(await readFile(f.hooksFile, 'utf8'));
  assert.deepEqual(saved.hooks.Stop, original.hooks.Stop); assert.equal(saved.customSetting, 'retain');
  for (const event of events) assert.equal(saved.hooks[event].flatMap(group => group.hooks).filter(hook => hook.statusMessage === STATUS).length, 1);
  assert.deepEqual(JSON.parse(await readFile(f.configFile, 'utf8')), {
    version: 1, enabled: true, validationMode: true, project: await realpath(f.project), connection: f.connection,
  });
  const beforeRepeat = await snapshot(f.root);
  const repeat = await f.run('--connection', f.connection, '--validation', '--apply');
  assert.equal(repeat.code, 0); assert.equal(repeat.report.changed, false);
  assert.deepEqual(await snapshot(f.root), beforeRepeat, 'no extra backup or duplicate hook on repeat');
  assert.deepEqual(await snapshot(f.home), homeBefore);
});

test('assistance remove remains dry-run until apply and repeated removal preserves other hooks', async t => {
  const original = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-hook' }] }] }, ownMetadata: 7 };
  const f = await fixture(t, original);
  assert.equal((await f.run('--connection', f.connection, '--apply')).code, 0);
  const before = await snapshot(f.root), preview = await f.run('--remove');
  assert.equal(preview.code, 0); assert.equal(preview.report.dryRun, true); assert.equal(preview.report.removal, true);
  assert.deepEqual(await snapshot(f.root), before);
  const removed = await f.run('--remove', '--apply');
  assert.equal(removed.code, 0); assert.equal(removed.report.changed, true);
  assert.deepEqual(JSON.parse(await readFile(f.hooksFile, 'utf8')), original);
  assert.equal(JSON.parse(await readFile(f.configFile, 'utf8')).enabled, false);
  const after = await snapshot(f.root), repeated = await f.run('--remove', '--apply');
  assert.equal(repeated.code, 0); assert.equal(repeated.report.changed, false);
  assert.deepEqual(await snapshot(f.root), after);
});

test('assistance setup rejects malformed hooks without partially writing local or global config', async t => {
  const f = await fixture(t, '{"hooks":{"UserPromptSubmit":"not-an-array"}}'), before = await snapshot(f.root);
  const result = await f.run('--connection', f.connection, '--apply');
  assert.equal(result.code, 1); assert.equal(result.stdout, ''); assert.ok(result.stderr);
  assert.deepEqual(await snapshot(f.root), before);
});

test('assistance hook Windows command quotes Unicode and apostrophes without shell expansion', async t => {
  const f = await fixture(t), command = hookCommands(f.configFile);
  const encoded = command.commandWindows.split(' ').at(-1), source = Buffer.from(encoded, 'base64').toString('utf16le');
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  assert.equal(source, `& ${[process.execPath, fileURLToPath(new URL('../assistance/prepare.mjs', import.meta.url)), 'hook', '--config', f.configFile].map(quote).join(' ')}; exit $LASTEXITCODE`);
});
