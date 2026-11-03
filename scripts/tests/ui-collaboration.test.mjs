import test from 'node:test';
import assert from 'node:assert/strict';
import {ownership,validateOwnedFiles,ownerForAnnotation} from '../check-ui-scope.mjs';

test('UI owners have exclusive file lists and cannot cross into another owner or backend',()=>{
  const all=Object.values(ownership.owners).flatMap(owner=>owner.files);
  assert.equal(new Set(all).size,all.length);
  for(const [owner,scope] of Object.entries(ownership.owners)) assert.deepEqual(validateOwnedFiles(owner,scope.files).files,scope.files);
  assert.throws(()=>validateOwnedFiles('home',['apps/desktop/src/features/pets/ExplicitPet.tsx']),/Out of scope/);
  assert.throws(()=>validateOwnedFiles('task-card',['apps/desktop/src-tauri/src/storage/pet_links.rs']),/Out of scope/);
  assert.throws(()=>validateOwnedFiles('home',['../PetHome.tsx']),/Out of scope/);
  assert.throws(()=>validateOwnedFiles('unknown',['AGENTS.md']));
});
test('annotation ownership comes from stable markers, never comment text',()=>{
  assert.equal(ownerForAnnotation({attributes:{'data-agent-scope':'task-card'},comment:'please edit home'}),'task-card');
  assert.equal(ownerForAnnotation({attributes:{'data-agent-review-owner':'pet-selection'},element:'img'}),'pet-selection');
  assert.equal(ownerForAnnotation({attributes:{'data-agent-scope':'home','data-agent-review-owner':'task-card'}}),null);
  assert.equal(ownerForAnnotation({attributes:{'data-agent-id':'home.choose-pet'}}),'home');
  assert.equal(ownerForAnnotation({comment:'home owns this'}),null);
  assert.equal(ownerForAnnotation({attributes:{'data-agent-scope':'unknown'}}),null);
  assert.equal(ownerForAnnotation({attributes:{'data-agent-scope':'__proto__'}}),null);
  assert.equal(ownerForAnnotation({attributes:{'data-agent-scope':'home','data-agent-id':'task-card.status'}}),null);
  assert.equal(ownerForAnnotation({elementPath:'[data-agent-id="home.root"] > [data-agent-id="task-card.status"] > p'}),'task-card');
  assert.equal(ownerForAnnotation({attributes:{'data-agent-id':'home.title'},elementPath:'[data-agent-id="task-card.status"] > p'}),null);
});
