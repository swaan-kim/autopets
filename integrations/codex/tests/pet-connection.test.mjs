import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { runPet, parsePetArgs } from '../skills/autopets/scripts/pet.mjs';
import { auditDelegatedTurn, resolveDelegatedRecord } from '../runtime/delegation-audit.mjs';
const parent='11111111-1111-4111-8111-111111111111', child='22222222-2222-4222-8222-222222222222', turn='33333333-3333-4333-8333-333333333333';
const cwd=path.resolve('fixture'), executable=path.resolve('fixture-codex.exe'), connection=path.resolve('fixture-connection.json');
function fixture() {
  let link=null; const calls=[];
  const deps={cwd,realpath:async v=>v,readConnection:async ()=>({}),
    inspect:async ()=>({node:{cwd},models:[{model:'gpt-6-luna',supportedReasoningEfforts:['low']},{model:'gpt-6-sol',supportedReasoningEfforts:['low','medium']}]}),
    readFile:async ()=>'name: autopets-build-implementation',request:async (_,url,input)=>{
      calls.push({url,input});
      if(input.operation==='connect') { link??={target:input.target,revision:1,profile:'light',enabled:true,connected:true,template:{instruction:'Build small.'},run:null}; link.connected=true; }
      if(input.operation==='prepare') link.run={id:input.requestId,startedAt:1000,state:'requested'};
      if(input.operation==='report' && input.receipt.kind==='spawned') link.run.agentPath=input.receipt.agentPath;
      return {ok:true,link:structuredClone(link),dispatchAllowed:input.operation==='prepare'};
    }};
  const run=(operation,args=[],env={CODEX_THREAD_ID:parent})=>runPet([operation,'--codex',executable,'--connection',connection,...args],env,deps);
  return {deps,calls,run,edit:fn=>fn(link)};
}
test('explicit connect rereads the same task without hooks, events or model runs',async()=>{
  const f=fixture(), result=await f.run('connect');
  assert.equal(result.link.target.threadId,parent);
  assert.deepEqual(f.calls.map(c=>c.input.operation),['connect','read']);
  assert.ok(f.calls.every(c=>c.url==='/v1/pet-link'));
  await f.run('connect'); assert.equal((await f.run('status')).link.revision,1);
});
test('no fabricated task flags, absent current identity, or mismatched response',async()=>{
  assert.throws(()=>parsePetArgs(['connect','--thread',parent]));
  const f=fixture(); await assert.rejects(f.run('connect',[],{}),/current-task/);
  f.deps.request=async()=>({ok:true,link:{target:{threadId:child,sourceId:'codex-windows-local',cwd}}});
  await assert.rejects(f.run('connect'),/wrong-pet-target/);
});
test('unavailable selection stops before prepare and disabled dispatch remains false',async()=>{
  const f=fixture(); await f.run('connect');
  await assert.rejects(f.run('prepare',['--profile','nonexistent']),/unsupported/);
  assert.equal(f.calls.filter(c=>c.input.operation==='prepare').length,0);
  const result=await f.run('prepare');
  assert.equal(result.requestedModel,'gpt-6-luna'); assert.equal(result.requestedEffort,'low');
  assert.ok(result.instruction.includes('SKILL.md')); assert.ok(Buffer.byteLength(result.instruction)<=3072);
  assert.equal(result.dispatchAllowed,true);
  const request=f.deps.request;
  f.deps.request=async(...args)=>({...await request(...args),dispatchAllowed:false});
  assert.equal((await f.run('prepare',['--request',result.requestId])).dispatchAllowed,false);
});
test('unknown connection response does not retry or submit work',async()=>{
  const f=fixture(); let writes=0;
  f.deps.request=async()=>{ writes++; throw Error('network timeout'); };
  await assert.rejects(f.run('connect'),/timeout/); assert.equal(writes,1);
});

test('saved native path permits restart recovery without spawning or guessing',async()=>{
  const f=fixture();await f.run('connect');const request=await f.run('prepare');
  const selected='/root/autopets_fixture';
  await f.run('spawned',['--request',request.requestId,'--agent-path',selected]);
  f.edit(link=>{link.connected=false;link.enabled=false;link.revision=3;link.run.state='unknown';});
  f.deps.resolveRecord=async input=>{assert.equal(input.agentPath,selected);assert.equal(input.parentId,parent);return {file:path.resolve('fixture-record'),childId:child,turnId:turn};};
  f.deps.audit=async()=>({parentId:parent,childId:child,turnId:turn,model:'gpt-6-luna',effort:'low',completed:true});
  const before=f.calls.length;
  await f.run('recover');
  assert.deepEqual(f.calls.slice(before).map(c=>c.input.operation),['read','connect','report']);
  assert.equal(f.calls.at(-1).input.requestId,request.requestId);
  assert.equal(f.calls.at(-1).input.expectedRevision,3);
  assert.equal(f.calls.at(-1).input.receipt.kind,'runtime');
});

test('recovery cannot select another run and an unknown child is not inferred',async()=>{
  const f=fixture();await f.run('connect');const request=await f.run('prepare');
  await assert.rejects(f.run('recover'),/explicit-child-record-required/);
  await assert.rejects(f.run('spawned',['--request',request.requestId,'--agent-path','/root/../wrong']),/invalid-child/);
  await assert.rejects(f.run('recover',['--request',child]),/pet-run-mismatch/);
  f.edit(link=>{link.run.trackingClosed=true;});
  await assert.rejects(f.run('recover'),/pet-run-closed/);
  assert.equal(f.calls.filter(c=>c.input.operation==='prepare').length,1);
});
test('runtime audit binds exact child, parent, turn, time and settings, excluding content',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'autopets-child-audit-'));
  t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('autopets-child-audit-'));await fs.rm(dir,{recursive:true,force:true});});
  const file=path.join(dir,'selected.jsonl'), start=Date.now();
  const rows=[{type:'session_meta',payload:{id:child,session_id:parent,parent_thread_id:parent,cwd,source:{subagent:{thread_spawn:{parent_thread_id:parent}}}}},
    {type:'event_msg',timestamp:new Date(start).toISOString(),payload:{type:'task_started',turn_id:turn}},
    {type:'turn_context',payload:{turn_id:turn,model:'gpt-6-luna',effort:'low'}},
    {type:'response_item',payload:{role:'assistant',content:[{text:'private-fixture'}]}},
    {type:'event_msg',payload:{type:'task_complete',turn_id:turn}}];
  const write=()=>fs.writeFile(file,rows.map(r=>JSON.stringify(r)).join('\n'));
  await write();
  const options={file,parentId:parent,childId:child,turnId:turn,cwd,startedAfter:start};
  assert.deepEqual(await auditDelegatedTurn(options),{parentId:parent,childId:child,turnId:turn,model:'gpt-6-luna',effort:'low',completed:true});
  await assert.rejects(auditDelegatedTurn({...options,startedAfter:start+10000}),/stale/);
  rows[0].payload.source.subagent.thread_spawn.parent_thread_id=turn; await write();
  await assert.rejects(auditDelegatedTurn(options),/parent-mismatch/);
  await fs.appendFile(file,'\n{"incomplete":'); await assert.rejects(auditDelegatedTurn(options));
});

test('local index lookup is exact, bounded, read-only, and rejects reused paths',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'autopets-child-index-'));
  t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('autopets-child-index-'));await fs.rm(dir,{recursive:true,force:true});});
  await fs.mkdir(path.join(dir,'sessions'));
  const file=path.join(dir,'sessions',`rollout-fixture-${child}.jsonl`), startedAfter=Date.now();
  const rows=[{type:'session_meta',payload:{id:child,session_id:parent,parent_thread_id:parent,cwd,source:{subagent:{thread_spawn:{parent_thread_id:parent}}}}},
    {type:'event_msg',timestamp:new Date(startedAfter).toISOString(),payload:{type:'task_started',turn_id:turn}},
    {type:'turn_context',payload:{turn_id:turn,model:'gpt-6-sol',effort:'medium'}}];
  await fs.writeFile(file,rows.map(r=>JSON.stringify(r)).join('\n'));
  const db=new DatabaseSync(path.join(dir,'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT,rollout_path TEXT,source TEXT,agent_path TEXT,created_at_ms INTEGER)');
  const source=JSON.stringify(rows[0].payload.source);
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run(child,file,source,'/root/autopets_fixture',startedAfter);db.close();
  const options={codexHome:dir,parentId:parent,agentPath:'/root/autopets_fixture',cwd,startedAfter};
  assert.deepEqual(await resolveDelegatedRecord(options),{file:await fs.realpath(file),childId:child,turnId:turn});
  await assert.rejects(resolveDelegatedRecord({...options,agentPath:'/root/wrong'}),/not-unique/);
  const update=new DatabaseSync(path.join(dir,'state_5.sqlite'));
  update.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run(turn,file,source,'/root/autopets_fixture',startedAfter);update.close();
  await assert.rejects(resolveDelegatedRecord(options),/not-unique/);
});
