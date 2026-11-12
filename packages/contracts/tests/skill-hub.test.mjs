// The skill hub lists capabilities that already exist in AI tools. This checks the bundled list:
// every entry is explained, sourced and startable only through an https address or a short prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MAX_LAUNCH_URI } from '../../guidance/start-request.mjs';

const hub = JSON.parse(fs.readFileSync(new URL('../data/skill-hub.json', import.meta.url), 'utf8'));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const https = value => typeof value === 'string' && /^https:\/\/[a-z0-9.-]+\/[^\s]*$/u.test(value);
const encoded = value => [...new TextEncoder().encode(value)].reduce((total, byte) => total + (/[A-Za-z0-9\-._~]/u.test(String.fromCharCode(byte)) ? 1 : 3), 0);
const TARGETS = ['web', 'codex', 'claude', 'claude-code'];
const HOSTS = ['chatgpt', 'codex', 'claude', 'claude-code'];

test('the hub records when its facts were checked and names every kind in plain words', () => {
  assert.equal(hub.version, 1);
  assert.match(hub.verifiedAt, /^\d{4}-\d{2}-\d{2}$/u);
  assert.deepEqual(Object.keys(hub.kinds).sort(), ['connector', 'feature', 'plugin', 'skill']);
  assert.ok(hub.entries.length >= 15, 'a hub is only useful with a real range of things to try');
  for (const kind of Object.keys(hub.kinds)) assert.ok(hub.entries.some(entry => entry.kind === kind), kind);
});

test('every entry is explained, sourced from an official https page and tied to the AI it works in', () => {
  assert.equal(new Set(hub.entries.map(entry => entry.id)).size, hub.entries.length);
  for (const entry of hub.entries) {
    assert.match(entry.id, /^[a-z0-9][a-z0-9-]{0,63}$/u, entry.id);
    assert.ok(Object.hasOwn(hub.kinds, entry.kind), entry.id);
    assert.ok(text(entry.name, 40) && text(entry.publisher, 30), entry.id);
    assert.ok(text(entry.summary, 80) && text(entry.when, 80) && text(entry.needs, 80), `${entry.id} needs a one-line benefit, when to use it and what it requires`);
    assert.ok(entry.note === '' || text(entry.note, 120), entry.id);
    assert.ok(https(entry.source), `${entry.id} source`);
    assert.ok(Array.isArray(entry.worksIn) && entry.worksIn.length > 0 && entry.worksIn.every(host => HOSTS.includes(host)), entry.id);
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'kind', 'name', 'needs', 'note', 'publisher', 'source', 'starts', 'summary', 'when', 'worksIn'], entry.id);
  }
});

test('an entry opens only an https address or a short prompt that fits a link, one per target', () => {
  for (const entry of hub.entries) {
    assert.ok(Array.isArray(entry.starts), entry.id);
    assert.equal(new Set(entry.starts.map(start => start.target)).size, entry.starts.length, `${entry.id} has one start per target`);
    for (const start of entry.starts) {
      assert.ok(TARGETS.includes(start.target) && text(start.label, 24), entry.id);
      if (start.target === 'web') {
        assert.deepEqual(Object.keys(start).sort(), ['label', 'target', 'url'], entry.id);
        assert.ok(https(start.url), `${entry.id} url`);
      } else {
        assert.deepEqual(Object.keys(start).sort(), ['label', 'prompt', 'target'], entry.id);
        assert.ok(text(start.prompt, 160), `${entry.id} prompt`);
        // Room for the longest scheme prefix and a work folder with a long, non-ASCII user name.
        assert.ok(encoded(start.prompt) + 400 <= MAX_LAUNCH_URI, `${entry.id} prompt fits a link`);
        assert.ok(entry.worksIn.includes(start.target), `${entry.id} starts in an AI it works in`);
      }
    }
  }
});

test('ended or unconfirmed features are not offered', () => {
  const names = hub.entries.map(entry => `${entry.id} ${entry.name}`).join('\n');
  assert.doesNotMatch(names, /agent mode|에이전트 모드|canvas|캔버스/iu, 'ChatGPT agent mode has ended and canvas could not be confirmed');
  assert.ok(hub.entries.find(entry => entry.id === 'chatgpt-study-mode').starts.some(start => start.url === 'https://chatgpt.com/studymode'));
});
