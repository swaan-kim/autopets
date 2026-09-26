import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runPowerShellJson } from '../bootstrap/start.mjs';

function processFixture(action) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  let kills = 0;
  child.kill = () => { kills++; child.emit('close', -1); };
  return {
    child,
    spawnProcess: (exe, args, options) => {
      assert.equal(exe, 'powershell.exe');
      assert.ok(args.includes('-NoProfile'));
      assert.equal(options.windowsHide, true);
      setImmediate(() => action(child));
      return child;
    },
    kills: () => kills,
  };
}

test('registry discovery preserves Korean JSON and closes without killing successful query', async () => {
  const f = processFixture(child => {
    child.stdout.emit('data', Buffer.from('{"directory":"한글 앱","version":"0.1.0"}'));
    child.emit('close', 0);
  });
  assert.deepEqual(await runPowerShellJson('fixture', f), { directory: '한글 앱', version: '0.1.0' });
  assert.equal(f.kills(), 0);
});

test('discovery permits a valid result after five seconds but retains a finite deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const late = processFixture(() => {});
  const result = runPowerShellJson('fixture', late);
  t.mock.timers.tick(5001);
  assert.equal(late.kills(), 0, 'A cold query must not be killed at the old five-second deadline');
  late.child.stdout.emit('data', Buffer.from('{"version":"0.1.0"}'));
  late.child.emit('close', 0);
  assert.deepEqual(await result, { version: '0.1.0' });

  const hung = processFixture(() => {});
  const failure = assert.rejects(runPowerShellJson('fixture', hung), error => error.discovery?.reason === 'timeout');
  t.mock.timers.tick(15001);
  await failure;
  assert.equal(hung.kills(), 1);
});

test('discovery distinguishes bounded process failures without recording script or raw output', async () => {
  for (const [reason, action] of [
    ['timeout', () => {}],
    ['spawn', child => child.emit('error', Error('secret-process-detail'))],
    ['exit', child => child.emit('close', 7)],
    ['json', child => { child.stdout.emit('data', Buffer.from('secret-output')); child.emit('close', 0); }],
    ['output-limit', child => child.stdout.emit('data', Buffer.alloc(65537, 'x'))],
  ]) {
    const f = processFixture(action);
    await assert.rejects(runPowerShellJson('secret-script', { ...f, timeoutMs: 30 }), error => {
      assert.equal(error.message, 'existing-installation-review');
      assert.deepEqual(Object.keys(error.discovery).sort(), ['elapsedMs', 'exitCode', 'reason']);
      assert.equal(error.discovery.reason, reason);
      assert.ok(error.discovery.elapsedMs >= 0);
      assert.ok(!JSON.stringify(error.discovery).includes('secret'));
      return true;
    });
    assert.equal(f.kills(), 1);
  }
});
