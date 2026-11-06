import assert from 'node:assert/strict';
import test from 'node:test';
import { behaviour, frameTiming, poseContinuity, quantile } from '../motion-review/metrics.mjs';
import { reviewSnapshot, scenarios } from '../motion-review/scenarios.mjs';
import { compareHtml } from '../motion-review/compare.mjs';

const frame = (t, extra = {}) => ({ t, clip: 'blink', bg: '0% 0%', box: [0, 0, 100, 100], blend: 0, card: false, state: 'idle', playing: true, animations: 1, ...extra });

test('frame timing separates stalls from the median', () => {
  const frames = [0, 16.7, 33.4, 50.1, 150.1, 166.8].map(t => frame(t));
  const timing = frameTiming(frames);
  assert.equal(timing.frames, 6);
  assert.equal(timing.p50, 16.7);
  assert.equal(timing.max, 100);
  assert.deepEqual([timing.over34, timing.over50, timing.over100], [1, 1, 0]);
  assert.equal(quantile([], 0.5), null);
});

test('a sprite swap counts as hard only without a blend layer', () => {
  const frames = [frame(0), frame(16, { bg: '50% 0%' }), frame(32, { bg: '50% 0%' }), frame(48, { bg: '100% 0%', blend: 0.8 }), frame(64, { bg: '100% 0%', blend: 0.4 })];
  const pose = poseContinuity(frames);
  assert.equal(pose.swaps, 2);
  assert.equal(pose.hardSwaps, 1);
});

test('position jumps are relative to pet height', () => {
  const pose = poseContinuity([frame(0), frame(16, { box: [0, 25, 100, 100] })]);
  assert.equal(pose.maxShiftPerFrame, 0.25);
});

test('behaviour counts card openings, one-shot completions and work-pose overrides', () => {
  const frames = [frame(0), frame(16, { card: true }), frame(32, { card: true }), frame(48), frame(64, { card: true }),
    frame(80, { clip: 'complete', state: 'complete' }), frame(96, { clip: 'complete', state: 'complete' }), frame(112, { clip: 'greet', state: 'working' })];
  const result = behaviour(frames);
  assert.equal(result.cardOpens, 2);
  assert.equal(result.completions, 1);
  assert.equal(result.greetWhileWorking, true);
  assert.deepEqual(result.clips, ['blink', 'complete', 'greet']);
});

test('scenarios are unique, bounded and use known steps and anchors', () => {
  const steps = new Set(['wait', 'move', 'curve', 'down', 'up', 'cancel', 'run', 'hidden', 'reduced', 'probe']);
  const ids = scenarios.map(scenario => scenario.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const scenario of scenarios) {
    assert.ok(scenario.pets >= 1 && scenario.pets <= 3, scenario.id);
    let pressed = false;
    for (const step of scenario.steps) {
      assert.ok(steps.has(step.do), `${scenario.id}: ${step.do}`);
      if (step.to) assert.ok(['pet', 'handle', 'away'].includes(step.to.at), `${scenario.id}: ${step.to.at}`);
      if (step.do === 'down') { assert.equal(pressed, false, `${scenario.id}: double press`); pressed = true; }
      if (step.do === 'up') pressed = false;
    }
    assert.equal(pressed, false, `${scenario.id} must release the virtual pointer`);
    assert.equal(typeof scenario.expect, 'function');
  }
});

test('fixtures stay synthetic and isolated per slot', () => {
  const snapshot = reviewSnapshot([null, { state: 'working' }, null]);
  assert.equal(snapshot.petLinks.length, 3);
  assert.equal(new Set(snapshot.petLinks.map(link => link.target.threadId)).size, 3);
  assert.ok(snapshot.petLinks.every(link => link.target.cwd.includes('fixture only')));
  assert.equal(snapshot.petLinks[1].run.state, 'working');
  assert.equal(snapshot.petLinks[0].run, null);
});

test('comparison page escapes labels and links videos relatively', () => {
  const scenario = { id: 'S1', title: '대기 <b>', video: 'S1.webm', resource: { cpuPerSecond: 0.1 }, expectations: [{ name: 'x', pass: false, detail: '<script>' }],
    pets: [{ timing: { p95: 16.7, max: 20, over34: 0 }, pose: { hardSwapsPerSecond: 1, maxShiftPerFrame: 0 }, cardOpens: 0, completions: 0, clips: ['blink'] }] };
  const report = label => ({ label, recordedAt: 'now', browser: 'Chromium', scale: 1, source: { commit: 'abc', dirty: false }, scenarios: [scenario] });
  const html = compareHtml([{ directory: '/tmp/review/a', report: report('<i>A</i>') }, { directory: '/tmp/review/b', report: report('B') }], '/tmp/review/compare.html');
  assert.ok(!html.includes('<script>') || html.indexOf('<script>') === html.lastIndexOf('<script>'));
  assert.ok(html.includes('&lt;i&gt;A&lt;/i&gt;'));
  assert.ok(html.includes('src="a/S1.webm"'));
  assert.ok(html.includes('합성 검사'));
});
