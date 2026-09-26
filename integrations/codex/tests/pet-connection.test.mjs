import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { runPet, parsePetArgs } from '../skills/autopets/scripts/pet.mjs';
import { auditDelegatedTurn } from '../runtime/delegation-audit.mjs';
const parent='01a0d905-55a5-7061-9d60-151ed3d2b5f3', child='01a0d905-d514-7d31-b05e-02630a284ccb', turn='01a0de13-1b09-7fa0-86e0-35f69dbbc6a8';
const cwd=path.resolve('fixture'), executable=path.resolve('fixture-codex.exe'), connection=path.resolve('fixture-connection.json');
function fixture() {
  let link=null; const calls=[];
  const deps={cwd,realpath:async v=>v,readConnection:async ()=>({}),
    inspect:async ()=>({node:{cwd},models:[{model:'gpt-6-luna',supportedReasoningEfforts:['low']},{model:'gpt-6-sol',supportedReasoningEfforts:['low','medium']}]}),
    readFile:async ()=>'name: autopets-build-implementation',request:async (_,url,input)=>{
      calls.push({url,input});
      if(input.operation==='connect') link??={target:input.target,revision:1,profile:'light',enabled:true,connected:true,template:{instruction:'Build small.'},run:null};
      if(input.operation==='prepare') link.run={id:input.requestId,startedAt:1000,state:'requested'};
      return {ok:true,link:structuredClone(link),dispatchAllowed:input.operation==='prepare'};
    }};
  const run=(operation,args=[],env={CODEX_THREAD_ID:parent})=>runPet([operation,'--codex',executable,'--connection',connection,...args],env,deps);
  return {deps,calls,run};
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
test('runtime audit binds exact child, parent, turn, time and settings, excluding content',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'autopets-child-audit-'));
  t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('autopets-child-audit-'));await fs.rm(dir,{recursive:true,force:true});});
  const file=path.join(dir,'selected.jsonl'), start=Date.now();
  const rows=[{type:'session_meta',payload:{id:child,cwd,source:{subagent:{thread_spawn:{parent_thread_id:parent}}}}},
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
