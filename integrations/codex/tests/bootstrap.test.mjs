import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { start, disconnect, verifyPackage } from '../bootstrap/start.mjs';
import { digest, atomicJson, lock } from '../bootstrap/files.mjs';
import { mergeHooks, handlers } from '../bootstrap/connection.mjs';
import { chatConfig } from '../bootstrap/user-hook.mjs';
import { runHookOnce } from '../bootstrap/deduplicate.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-setup-한글 '));
  t.after(async () => { assert.equal(path.dirname(directory), os.tmpdir()); assert.ok(path.basename(directory).startsWith('autopets-setup-')); await fs.rm(directory, { recursive: true, force: true }); });
  const root = path.join(directory, '설치'), pkg = path.join(directory, '패키지');
  const paths = ['runtime/node.exe', 'runtime/LICENSE', 'integrations/codex/bootstrap/start.mjs', 'integrations/codex/bootstrap/user-hook.mjs', 'integrations/codex/skills/autopets/references/explicit-pet.md', 'app/setup.exe'];
  const files = [];
  for (const name of paths) { const data = Buffer.from(name); await fs.mkdir(path.dirname(path.join(pkg, name)), { recursive: true }); await fs.writeFile(path.join(pkg, name), data); files.push({ path: name, sha256: digest(data) }); }
  await atomicJson(path.join(pkg, 'manifest.json'), { version: 1, appVersion: '0.1.0', files, installer: 'app/setup.exe' });
  const env = { LOCALAPPDATA: directory, AUTOPETS_HOME: root, CODEX_HOME: path.join(directory, 'codex'), CODEX_THREAD_ID: 'chat-a' };
  const calls = [];
  const driver = {
    install: async (_, destination) => { calls.push('install'); await fs.writeFile(path.join(destination, 'AutoPets.exe'), 'app'); },
    launch: async () => { calls.push('launch'); },
    bridge: async () => ({ begin: async request => { calls.push(request); return { version: 1, phase: 'connecting', appReady: true, chatConnected: false, guidanceDelivered: false }; } }),
  };
  const run = (extra = {}) => start({ root, packageDir: pkg, env, driver, platform: 'win32', arch: 'x64', ...extra });
  return { directory, root, pkg, env, calls, driver, run };
}
test('first start and repeat preserve unrelated hooks and do not reinstall or claim delivery', async t => {
  const f = await fixture(t);
  const third = { type: 'command', command: 'existing-command', statusMessage: 'Other' };
  await atomicJson(path.join(f.env.CODEX_HOME, 'hooks.json'), { description: 'keep', hooks: { Stop: [{ matcher: 'x', hooks: [third] }] } });
  const first = await f.run(); assert.equal(first.chatConnected, false); assert.equal(first.publicOneCallVerified, false);
  const before = await fs.readFile(path.join(f.env.CODEX_HOME, 'hooks.json'), 'utf8');
  await f.run({ packageDir: undefined });
  assert.equal(await fs.readFile(path.join(f.env.CODEX_HOME, 'hooks.json'), 'utf8'), before);
  assert.equal(f.calls.filter(c => c === 'install').length, 1);
  assert.equal(f.calls.filter(c => c === 'launch').length, 2);
  assert.equal(JSON.parse(before).hooks.Stop[0].hooks[0].command, 'existing-command');
  await disconnect({ root: f.root, env: f.env });
  const after = JSON.parse(await fs.readFile(path.join(f.env.CODEX_HOME, 'hooks.json'), 'utf8'));
  assert.deepEqual(after, { description: 'keep', hooks: { Stop: [{ matcher: 'x', hooks: [third] }] } });
  assert.equal((await fs.stat(path.join(f.root, 'app/AutoPets.exe'))).isFile(), true);
});
test('repair copies damaged helper only; a newer package never upgrades implicitly', async t => {
  const f = await fixture(t); await f.run();
  await fs.writeFile(path.join(f.root, 'connector/runtime/LICENSE'), 'damaged');
  assert.equal((await f.run()).skillConflict, false); assert.equal(f.calls.filter(c => c === 'install').length, 1);
  const file = path.join(f.pkg, 'manifest.json'), m = JSON.parse(await fs.readFile(file, 'utf8')); m.appVersion = '0.2.0'; await atomicJson(file, m);
  const result = await f.run(); assert.equal(result.updateAvailable, '0.2.0');
  assert.equal(f.calls.filter(c => c === 'install').length, 1);
});
test('installed skill routes explicit pet requests to its own packaged instructions', async t => {
  const f = await fixture(t); await f.run();
  const skill = await fs.readFile(path.join(f.env.CODEX_HOME, 'skills/autopets/SKILL.md'), 'utf8');
  assert.match(skill, /제작 펫 연결/);
  const reference = /^펫 작업 안내: (.+)$/mu.exec(skill);
  assert.ok(reference, 'Installed entrypoint must expose the explicit pet workflow');
  const file = JSON.parse(reference[1]);
  assert.equal(file, path.join(f.root, 'connector/integrations/codex/skills/autopets/references/explicit-pet.md'));
  assert.ok((await fs.readFile(file, 'utf8')).length > 0);
});
test('foreign skill is preserved and reported, including disconnect', async t => {
  const f = await fixture(t); const file = path.join(f.env.CODEX_HOME, 'skills/autopets/SKILL.md');
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'my own skill');
  const result = await f.run(); assert.equal(result.skillConflict, true);
  await disconnect({ root: f.root, env: f.env }); assert.equal(await fs.readFile(file, 'utf8'), 'my own skill');
});
test('integrity failure and traversal stop before installation', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.pkg, 'runtime/node.exe'), 'changed');
  await assert.rejects(f.run(), /integrity/); assert.equal(f.calls.length, 0);
  const file = path.join(f.pkg, 'manifest.json'), m = JSON.parse(await fs.readFile(file, 'utf8')); m.files[0].path = '../outside'; await atomicJson(file, m);
  await assert.rejects(verifyPackage(f.pkg), /package-path/);
});
test('cancel and launch failure can be retried without a duplicate installation', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run({ driver: { ...f.driver, install: async () => { throw Error('installation-cancelled'); } } }), /cancelled/);
  await assert.rejects(f.run({ driver: { ...f.driver, launch: async () => { throw Error('launch-failed'); } } }), /launch-failed/);
  await f.run(); assert.equal(f.calls.filter(c => c === 'install').length, 1);
});
test('parallel starts have a single owner', async t => {
  const f = await fixture(t); let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const first = lock(f.root, async () => { entered(); await new Promise(resolve => { release = resolve; }); });
  await ready; await assert.rejects(lock(f.root, async () => {}), /setup-in-progress/);
  release(); await first; await lock(f.root, async () => {});
});
test('same event across project and user hooks injects once and returns the same hold', async t => {
  const f = await fixture(t); await atomicJson(path.join(f.root, 'state/connection-settings.json'), { enabled: true });
  const input = { session_id: 'a', turn_id: 't', hook_event_name: 'UserPromptSubmit', prompt: '비교' }; let count = 0;
  const execute = () => runHookOnce(input, 'prepare', async () => { count++; return { output: { hookSpecificOutput: { additionalContext: 'helper' } } }; }, f.root);
  const results = await Promise.all([execute(), execute()]); assert.equal(count, 1);
  assert.equal(results.filter(r => r.output.hookSpecificOutput).length, 1);
  const hold = { ...input, turn_id: 'hold' };
  const run = () => runHookOnce(hold, 'prepare', async () => ({ output: { decision: 'block', reason: '모델 변경 필요' } }), f.root);
  assert.deepEqual((await run()).output, (await run()).output);
  const stored = await fs.readFile(path.join(f.root, 'state/claims', digest('a'), (await fs.readdir(path.join(f.root, 'state/claims', digest('a'))))[0]), 'utf8');
  assert.ok(!stored.includes('helper')); assert.ok(!stored.includes('비교'));
});
test('two chats use separate records and same chat cannot move projects', async t => {
  const f = await fixture(t), connection = path.join(f.directory, 'connection.json');
  const a = await chatConfig(f.root, { session_id: 'a', cwd: f.directory }, connection);
  const b = await chatConfig(f.root, { session_id: 'b', cwd: f.directory }, connection);
  assert.notEqual(a, b); assert.equal(JSON.parse(await fs.readFile(a, 'utf8')).validationMode, false);
  await assert.rejects(chatConfig(f.root, { session_id: 'a', cwd: f.pkg }, connection), /scope/);
});
test('malformed existing hooks are never rewritten', () => {
  assert.throws(() => mergeHooks({ hooks: { Stop: {} } }, handlers('node', 'runner')), /hooks-format/);
});
test('compatible pre-existing app is adopted without a second native installation', async t => {
  const f = await fixture(t), directory = path.join(f.directory, '기존 앱');
  await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'AutoPets.exe'), 'previous-app');
  const driver = { ...f.driver, discover: async () => ({ directory, version: '0.1.0' }) };
  await f.run({ driver }); assert.equal(f.calls.filter(c => c === 'install').length, 0);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root, 'install-manifest.json'), 'utf8')).appDirectory, directory);
});
test('modified owned skill and changed owned hook survive disconnect', async t => {
  const f = await fixture(t); await f.run();
  const skill = path.join(f.env.CODEX_HOME, 'skills/autopets/SKILL.md');
  await fs.appendFile(skill, '\nMy modification');
  const file = path.join(f.env.CODEX_HOME, 'hooks.json'), hooks = JSON.parse(await fs.readFile(file, 'utf8'));
  hooks.hooks.Stop[0].hooks[0].command = 'user-change'; await atomicJson(file, hooks);
  await disconnect({ root: f.root, env: f.env });
  assert.match(await fs.readFile(skill, 'utf8'), /My modification/);
  assert.match(await fs.readFile(file, 'utf8'), /user-change/);
});
test('real user runner binds its chat config, deduplicates observation and fails open after disconnect', async t => {
  const f = await fixture(t), events = [];
  await atomicJson(path.join(f.root, 'state/connection-settings.json'), { version: 1, enabled: true });
  const server = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const body = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
    if (req.url === '/v1/events') { events.push(body); res.end('{"ok":true}'); }
    else { res.statusCode = 503; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const connection = path.join(f.directory, 'connection.json');
  await atomicJson(connection, { version: 1, baseUrl: `http://127.0.0.1:${server.address().port}`, token: 'a'.repeat(64) });
  const script = fileURLToPath(new URL('../bootstrap/user-hook.mjs', import.meta.url));
  const input = { session_id: 'real-a', turn_id: 'turn-a', cwd: f.directory, hook_event_name: 'UserPromptSubmit', prompt: '비교해줘', model: 'gpt-5.6-terra' };
  const run = role => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, role, '--autopets-user-v1'], { env: { ...process.env, ...f.env, AUTOPETS_CONNECTION_FILE: connection }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; const timeout = setTimeout(() => { child.kill(); reject(Error('timeout')); }, 8000);
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('exit', code => { clearTimeout(timeout); assert.equal(code, 0); assert.equal(stderr, ''); resolve(JSON.parse(stdout)); });
    child.stdin.end(JSON.stringify(input));
  });
  assert.deepEqual(await run('observe'), {}); assert.deepEqual(await run('observe'), {});
  assert.equal(events.length, 1); assert.equal(events[0].sessionId, 'real-a');
  assert.deepEqual(await run('prepare'), {});
  const config = JSON.parse(await fs.readFile(path.join(f.root, 'state/chats', digest('real-a'), 'config.json'), 'utf8'));
  assert.equal(config.version, 2); assert.equal(config.validationMode, false);
  await atomicJson(path.join(f.root, 'state/connection-settings.json'), { enabled: false });
  const before = events.length; assert.deepEqual(await run('observe'), {}); assert.equal(events.length, before);
});
