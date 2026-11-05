import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const hosts = JSON.parse(readFileSync(new URL('../data/connections.json', import.meta.url), 'utf8'));
test('connection catalog separates execution surfaces and does not convert fixtures into live support', () => {
  assert.equal(new Set(hosts.map(h => h.id)).size, hosts.length);
  assert.deepEqual(hosts.filter(h => h.connectAvailable).map(h => h.id), ['codex-windows-local']);
  for (const host of hosts) {
    assert.ok(['openai', 'anthropic', 'google'].includes(host.provider));
    assert.ok(['local', 'cloud'].includes(host.execution));
    assert.deepEqual(Object.keys(host.features).sort(), ['guidance', 'model', 'planMode', 'reasoning', 'returnToTask', 'settingsObservation', 'status', 'submission', 'usage']);
    assert.ok(Object.values(host.features).every(value => value !== 'verified'));
    if (host.execution === 'cloud') assert.equal(host.connectAvailable, false);
  }
  assert.notEqual(hosts.find(h => h.id === 'work-local').surface, hosts.find(h => h.id === 'chatgpt-web').surface);
  assert.notEqual(hosts.find(h => h.id === 'codex-windows-local').surface, hosts.find(h => h.id === 'codex-vscode').surface);
});
