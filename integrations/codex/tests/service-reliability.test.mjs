import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { atomicJson } from '../bootstrap/files.mjs';
import { inspectPetHost } from '../skills/autopets/scripts/pet.mjs';
import { inspectDelegationCompatibility } from '../runtime/delegation-audit.mjs';

const parent='11111111-1111-4111-8111-111111111111';
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'autopets-service-'));
  t.after(async()=>{ assert.equal(path.dirname(dir),os.tmpdir()); assert.ok(path.basename(dir).startsWith('autopets-service-')); await fs.rm(dir,{recursive:true,force:true}); });
  return dir;
}
test('atomic replacement retries only the same temporary file and leaves no residue',async t=>{
  const dir=await fixture(t), file=path.join(dir,'state.json');
  await atomicJson(file,{before:true});
  let attempts=0; const sources=new Set();
  const io={...fs,rename:async(from,to)=>{sources.add(from); if(++attempts<3) throw Object.assign(Error('busy'),{code:'EPERM'}); return fs.rename(from,to);}};
  await atomicJson(file,{after:true},{io,sleep:async()=>{}});
  assert.equal(attempts,3); assert.equal(sources.size,1);
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{after:true});
  assert.deepEqual(await fs.readdir(dir),['state.json']);
});
test('permanent replacement failure preserves original data and cleans its temp file',async t=>{
  const dir=await fixture(t), file=path.join(dir,'state.json'); await atomicJson(file,{original:true});
  const original=await fs.readFile(file), failure=Object.assign(Error('replacement-denied'),{code:'EPERM'}); let attempts=0;
  await assert.rejects(atomicJson(file,{changed:true},{io:{...fs,rename:async()=>{attempts++;throw failure;}},sleep:async()=>{}}),error=>error===failure);
  assert.equal(attempts,5); assert.deepEqual(await fs.readFile(file),original); assert.deepEqual(await fs.readdir(dir),['state.json']);
});
test('model catalog outage does not block identity-only operations',async()=>{
  const calls=[], cwd=path.resolve('fixture');
  const runtime=async(_,use)=>use({call:async(method)=>{calls.push(method);if(method==='model/list')throw Error('catalog-offline');return {thread:{id:parent,cwd,turns:[],originator:'Codex Desktop',updatedAt:1,status:{type:'idle'}}};}});
  const identity=await inspectPetHost({executable:'unused',cwd,threadId:parent,includeModels:false,runtime});
  assert.equal(identity.node.id,parent);assert.deepEqual(calls,['thread/read']);
  await assert.rejects(inspectPetHost({executable:'unused',cwd,threadId:parent,includeModels:true,runtime}),/catalog-offline/);
});
test('read-only preflight accepts known index/header and refuses schema or target drift',async t=>{
  const dir=await fixture(t), cwd=path.join(dir,'project');
  await fs.mkdir(path.join(dir,'sessions'));await fs.mkdir(cwd);
  const record=path.join(dir,'sessions',`rollout-${parent}.jsonl`);
  await fs.writeFile(record,JSON.stringify({type:'session_meta',payload:{id:parent,cwd}})+'\n'+JSON.stringify({private:'NOT-RETURNED'})+'\n');
  const index=path.join(dir,'state_5.sqlite'), db=new DatabaseSync(index);
  db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT, source TEXT, agent_path TEXT, created_at_ms INTEGER)');
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run(parent,record,'desktop',null,0);db.close();
  const original=await fs.readFile(index);
  const result=await inspectDelegationCompatibility({codexHome:dir,parentId:parent,cwd});
  assert.equal(result.supported,true);assert.ok(!JSON.stringify(result).includes('NOT-RETURNED'));assert.deepEqual(await fs.readFile(index),original);
  await assert.rejects(inspectDelegationCompatibility({codexHome:dir,parentId:parent,cwd:dir}),/unsupported-runtime-record/);
  const changed=new DatabaseSync(index);changed.exec('ALTER TABLE threads RENAME COLUMN agent_path TO unknown_path');changed.close();
  await assert.rejects(inspectDelegationCompatibility({codexHome:dir,parentId:parent,cwd}),/unsupported-runtime-index/);
});
