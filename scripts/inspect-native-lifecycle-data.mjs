// Read-only, synthetic CI data only. This never launches or connects an AI host.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.env.GITHUB_REPOSITORY, 'swaan-kim/autopets');
const directory = path.join(process.env.LOCALAPPDATA, 'local.autopets.desktop');
const db = new DatabaseSync(path.join(directory, 'autopets.sqlite3'), { readOnly: true });
try {
  const row = db.prepare('SELECT id,label,cwd,supervision FROM sessions WHERE id=?').get('gui-fixture');
  assert.ok(row);
  const supervision = JSON.parse(row.supervision);
  assert.equal(supervision.completionCriterion, 'GUI restart must preserve this test record');
  assert.equal(supervision.interventionMode, 'milestones');
  assert.equal(supervision.elapsedAlertMinutes, 7);
  const events = db.prepare('SELECT event_id,session_id,turn_id,kind FROM events ORDER BY event_id').all();
  assert.equal(events.length, 1);
  const slots = db.prepare('SELECT slot,session_id FROM slots ORDER BY slot').all();
  assert.ok(slots.some(slot => slot.session_id === row.id));
  const configs = db.prepare('SELECT request_id,session_id,turn_id,fingerprint FROM task_config_requests ORDER BY request_id').all();
  assert.equal(configs.length, 1);
  const pets = db.prepare('SELECT id,value FROM pet_templates_v1 ORDER BY id').all().map(row => ({ id: row.id, value: JSON.parse(row.value) }));
  assert.equal(pets.length, 1, 'actual role editor must save exactly one pet');
  assert.equal(pets[0].id, pets[0].value.id);
  assert.equal(pets[0].value.revision, 1);
  assert.equal(pets[0].value.template.id, 'research-document');
  assert.equal(pets[0].value.template.version, 1);
  assert.equal(pets[0].value.template.skills[0].version, '1.0.0');
  assert.ok(pets[0].value.template.instruction.length > 0);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  const positions = JSON.parse(readFileSync(path.join(directory, 'positions.json'), 'utf8'));
  const sortedPositions = Object.fromEntries(Object.entries(positions).sort(([a], [b]) => a.localeCompare(b)));
  console.log(JSON.stringify({ session: { id: row.id, label: row.label, cwd: row.cwd,
    completionCriterion: supervision.completionCriterion, interventionMode: supervision.interventionMode,
    elapsedAlertMinutes: supervision.elapsedAlertMinutes }, events, slots, configs, pets, positions: sortedPositions, integrity: 'ok' }));
} finally { db.close(); }
