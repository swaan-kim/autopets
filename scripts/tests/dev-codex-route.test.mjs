import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MARKER, devPaths, renderSkill, install, restore, startDev, parseArgs } from '../dev-codex-route.mjs';

async function sandbox() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-dev-route-'));
  const repo = path.join(dir, 'repo'), codex = path.join(dir, 'codex');
  const paths = devPaths({ repo, env: { CODEX_HOME: codex }, launcher: path.join(repo, '.local/start-dev.cmd') });
  return { dir, paths };
}
const original = Buffer.from('---\nname: autopets\n---\n<!-- autopets-bootstrap-v1 -->\ninstalled\n');

test('dev skill points every entry at the source checkout and dev data', () => {
  const paths = devPaths({ repo: path.resolve('/r'), dataDir: path.resolve('/d'), launcher: path.resolve('/r/.local/go.cmd'), env: { CODEX_HOME: path.resolve('/c') } });
  const text = renderSkill({ node: path.resolve('/node.exe'), ...paths });
  assert.match(text, /^---\nname: autopets\n/u);
  assert.ok(text.includes(MARKER));
  assert.ok(text.includes(JSON.stringify([paths.script, 'start', '--data-dir', paths.dataDir, '--launcher', paths.launcher])));
  assert.ok(text.includes(JSON.stringify(path.join(paths.dataDir, 'connection.json'))));
  assert.ok(text.includes(JSON.stringify(paths.reference)) && text.includes(JSON.stringify(paths.petScript)));
  assert.ok(!text.includes('AppData'));
});

test('install backs up the installed skill once and restore returns the same bytes', async () => {
  const { paths } = await sandbox();
  await fs.mkdir(path.dirname(paths.skillFile), { recursive: true });
  await fs.writeFile(paths.skillFile, original);
  assert.equal((await install({ paths, node: 'node' })).backup, paths.backupFile);
  assert.ok((await fs.readFile(paths.skillFile, 'utf8')).includes(MARKER));
  await install({ paths, node: 'node' }); // re-install keeps the original backup
  assert.deepEqual(await fs.readFile(paths.backupFile), original);
  await restore({ paths });
  assert.deepEqual(await fs.readFile(paths.skillFile), original);
});

test('/오토펫 in the skill picker and a bare call both start the dog pet; restore removes the picker entry', async () => {
  const { paths } = await sandbox();
  const text = renderSkill({ node: 'node', ...paths });
  assert.match(text.split('\n')[2], /\/오토펫, \/autopets, \$autopets/u);
  assert.match(text, /다른 요청 없이 이 스킬만 불렀거나/u);
  await fs.mkdir(path.dirname(paths.skillFile), { recursive: true });
  await fs.writeFile(paths.skillFile, original);
  await install({ paths, node: 'node' });
  const agent = path.join(path.dirname(paths.skillFile), 'agents/openai.yaml');
  assert.match(await fs.readFile(agent, 'utf8'), /display_name: "오토펫 · AutoPets"/u);
  await restore({ paths });
  await assert.rejects(fs.access(agent));
  // Someone else's picker entry is never overwritten.
  await fs.mkdir(path.dirname(agent), { recursive: true }); await fs.writeFile(agent, 'interface:\n  display_name: "mine"\n');
  await install({ paths, node: 'node' });
  assert.equal(await fs.readFile(agent, 'utf8'), 'interface:\n  display_name: "mine"\n');
});

test('install refuses to replace a different saved original and restore refuses a non-dev skill', async () => {
  const { paths } = await sandbox();
  await fs.mkdir(path.dirname(paths.skillFile), { recursive: true });
  await fs.mkdir(path.dirname(paths.backupFile), { recursive: true });
  await fs.writeFile(paths.backupFile, 'older original');
  await fs.writeFile(paths.skillFile, original);
  await assert.rejects(install({ paths, node: 'node' }), /backup-conflict/u);
  await assert.rejects(restore({ paths }), /skill-not-dev-route/u);
  assert.deepEqual(await fs.readFile(paths.skillFile), original);
  await assert.rejects(install({ paths: { ...paths, launcher: path.resolve('/x.ps1') }, node: 'node' }), /launcher-must-be-cmd/u);
});

function fakeDriver({ liveAfter = 0, exists = true, state = { version: 1, appReady: true, installedVersion: '0.1.0' } } = {}) {
  let reads = 0, clock = 0;
  const calls = { launches: [], posts: [], order: [] };
  return { calls, driver: {
    readSetup: async () => (reads++ >= liveAfter ? { connection: { token: 't' }, state } : null),
    post: async (connection, body) => { calls.order.push('post'); calls.posts.push(body); return { phase: 'connecting', appReady: true }; },
    exists: async () => exists,
    launch: async (command, args, options) => { calls.order.push(command === 'cmd.exe' ? 'launcher' : 'show-pets'); calls.launches.push({ command, args, dataDir: options.env.AUTOPETS_DATA_DIR }); },
    sleep: async ms => { clock += ms; },
    now: () => clock,
  } };
}

test('start reuses a running dev app: the dog pets are shown first, then the calling chat is linked', async () => {
  const { paths } = await sandbox();
  const { driver, calls } = fakeDriver();
  const chat = '0199aaaa-1111-7222-8333-444455556666';
  const result = await startDev({ paths, driver, env: { CODEX_THREAD_ID: chat }, cwd: path.resolve('/work') });
  assert.equal(result.launch, 'reused-running-dev-app');
  assert.equal(result.target, 'source-dev-app');
  assert.equal(result.pets, 'show-requested');
  // The second launch asks the running app to show its pets (never the plain relaunch that only opens the manager).
  assert.deepEqual(calls.launches, [{ command: paths.devExe, args: ['--show-pets', '--chat', chat], dataDir: paths.dataDir }]);
  assert.deepEqual(calls.order, ['show-pets', 'post']);
  assert.deepEqual(calls.posts, [{ installedVersion: '0.1.0', sessionId: chat, cwd: path.resolve('/work'), hostId: 'codex-windows-local', entryPoint: 'ai', connectionMode: 'explicit-pet' }]);
  assert.deepEqual(Object.keys(result.timings), ['appReadyMs', 'petsRequestedMs', 'chatConnectedMs']);
  // A non-UUID thread id is still sent to setup but never passed on the command line.
  const other = fakeDriver();
  await startDev({ paths, driver: other.driver, env: { CODEX_THREAD_ID: 'thread-1' }, cwd: path.resolve('/work') });
  assert.deepEqual(other.calls.launches[0].args, ['--show-pets']);
});

test('start opens the dev launcher when no app answers, then waits for it', async () => {
  const { paths } = await sandbox();
  const { driver, calls } = fakeDriver({ liveAfter: 3 });
  const result = await startDev({ paths, driver, env: {}, cwd: path.resolve('/work') });
  assert.equal(result.launch, 'started-dev-launcher');
  assert.deepEqual(calls.order, ['launcher', 'show-pets', 'post']);
  assert.equal(calls.launches[0].command, 'cmd.exe');
  assert.deepEqual(calls.launches[1].args, ['--show-pets']);
  // It polls quickly so the pet appears as soon as the app answers.
  assert.equal(result.timings.appReadyMs, 750);
  assert.ok(calls.launches[0].args.includes(`"${paths.launcher}"`));
  assert.equal(calls.posts[0].sessionId, null);
  assert.equal(calls.posts[0].cwd, null);
});

test('start never falls back to another app', async () => {
  const { paths } = await sandbox();
  await assert.rejects(startDev({ paths, driver: fakeDriver({ liveAfter: Infinity }).driver, waitMs: 5000 }), /dev-app-unavailable/u);
  await assert.rejects(startDev({ paths: { ...paths, launcher: null }, driver: fakeDriver({ liveAfter: Infinity }).driver }), /dev-app-unavailable/u);
  await assert.rejects(startDev({ paths, driver: fakeDriver({ state: { version: 1, appReady: false } }).driver }), /dev-app-unavailable/u);
});

test('arguments must be known and absolute', () => {
  assert.deepEqual(parseArgs(['start', '--data-dir', path.resolve('/d')]), { command: 'start', options: { dataDir: path.resolve('/d') } });
  assert.throws(() => parseArgs(['start', '--data-dir', 'relative']), /arguments/u);
  assert.throws(() => parseArgs(['restore', '--data-dir', path.resolve('/d')]), /arguments/u);
  assert.throws(() => parseArgs(['other']), /arguments/u);
});
