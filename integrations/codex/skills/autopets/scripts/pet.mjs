#!/usr/bin/env node
// Explicit attachment: never depends on hooks, launches AI, or fabricates a session event.
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { readConnection, requestJson } from './bridge-client.mjs';
import { withReadOnlyRuntime } from '../../../runtime/rpc.mjs';
import { summarizeTaskMetadata } from '../../../runtime/task-metadata.mjs';
import { availableProfile } from '../../../runtime/delegation.mjs';
import { auditDelegatedTurn, resolveDelegatedRecord } from '../../../runtime/delegation-audit.mjs';
import { openInstalledPetApp } from '../../../bootstrap/start.mjs';

const uuid = v => typeof v === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(v);
export function parsePetArgs(args) {
  const result = { operation: args[0] };
  if (!['connect','status','settings','prepare','spawned','returned','failed','observe','recover','close-tracking','disable','enable','disconnect'].includes(result.operation)) throw Error('invalid-operation');
  const flags = { '--codex':'executable','--connection':'connection','--profile':'profile','--request':'requestId','--child':'childId','--turn':'turnId','--record':'record','--agent-path':'agentPath' };
  for(let i=1;i<args.length;i+=2) {
    const key=flags[args[i]];
    if (!key || result[key] !== undefined || !args[i+1]) throw Error('invalid-arguments');
    result[key]=args[i+1];
  }
  for(const key of ['executable','connection','record']) if(result[key]!==undefined && !path.isAbsolute(result[key])) throw Error('absolute-path-required');
  for(const key of ['requestId','childId','turnId']) if(result[key]!==undefined && !uuid(result[key])) throw Error('invalid-identity');
  return result;
}
export async function inspectPetHost({executable,cwd,threadId}) {
  return withReadOnlyRuntime({executable,cwd},async ({call})=>{
    const {thread}=await call('thread/read',{threadId,includeTurns:false});
    const node=summarizeTaskMetadata(thread,{id:threadId,cwd,label:'current-local-task'},Date.now());
    if(node.creationSurface!=='codex-local' || node.parentId) throw Error('unsupported-current-task');
    const models=[]; let cursor=null;
    for(let page=0;page<8;page++) {
      const value=await call('model/list',{...(cursor?{cursor}:{}),limit:100});
      for(const m of value.data??[]) models.push({model:m.model,supportedReasoningEfforts:(m.supportedReasoningEfforts??[]).map(e=>typeof e==='string'?e:e.reasoningEffort)});
      cursor=value.nextCursor; if(!cursor) break;
    }
    if(cursor) throw Error('incomplete-model-catalog');
    return {node,models};
  });
}
export async function runPet(args,env=process.env,deps={}) {
  const o=parsePetArgs(args), cwd=await (deps.realpath??realpath)(deps.cwd??process.cwd());
  if(!uuid(env.CODEX_THREAD_ID)) throw Error('current-task-unavailable');
  const executable=o.executable??env.AUTOPETS_CODEX_EXECUTABLE;
  if(!executable || !path.isAbsolute(executable)) throw Error('codex-runtime-required');
  const host=await (deps.inspect??inspectPetHost)({executable,cwd,threadId:env.CODEX_THREAD_ID});
  const target={sourceId:'codex-windows-local',threadId:env.CODEX_THREAD_ID,cwd:host.node.cwd};
  const connectionPath=o.connection??env.AUTOPETS_CONNECTION_FILE??path.join(env.AUTOPETS_DATA_DIR??path.join(env.LOCALAPPDATA??'', 'local.autopets.desktop'),'connection.json');
  // Explicit invocation can open the installed app; hooks and diagnostics cannot.
  if(o.operation==='connect' && !o.connection && !env.AUTOPETS_CONNECTION_FILE) await (deps.openApp??openInstalledPetApp)({env});
  const connection=await (deps.readConnection??readConnection)(connectionPath);
  const call=body=>(deps.request??requestJson)(connection,'/v1/pet-link',body,5000,32768);
  const verify=value=>{
    const l=value?.link;
    if(value?.ok!==true || (l && (l.target.threadId!==target.threadId || l.target.sourceId!==target.sourceId || path.resolve(l.target.cwd).toLowerCase()!==path.resolve(target.cwd).toLowerCase()))) throw Error('wrong-pet-target');
    return value;
  };
  if(o.operation==='connect') {
    const saved=verify(await call({operation:'connect',target}));
    const reread=verify(await call({operation:'read',target}));
    if(!reread.link || reread.link.revision!==saved.link?.revision) throw Error('connection-unconfirmed');
    return {...reread,operation:'connect'};
  }
  let current=verify(await call({operation:'read',target}));
  if(o.operation==='status') return current;
  if(!current.link) throw Error('pet-not-connected');
  if(o.operation==='recover' && !current.link.connected) current=verify(await call({operation:'connect',target}));
  const expectedRevision=current.link.revision;
  if(['settings','prepare'].includes(o.operation)) {
    const profile=o.profile??current.link.profile;
    const selected=availableProfile(profile,host.models);
    if(o.operation==='settings') {
      const saved=verify(await call({operation:'settings',target,expectedRevision,profile}));
      const reread=verify(await call({operation:'read',target}));
      if(reread.link?.revision!==saved.link?.revision) throw Error('settings-unconfirmed');
      return reread;
    }
    const skill=fileURLToPath(new URL('../../autopets-build-implementation/SKILL.md',import.meta.url));
    const skillText=await (deps.readFile??readFile)(skill,'utf8');
    if(!skillText.includes('name: autopets-build-implementation')) throw Error('bundled-skill-missing');
    const instruction=`${current.link.template.instruction}\n선택 스킬 ${skill}을 읽고 적용하세요. 추가 하위 작업은 만들지 마세요.${profile==='plan'?' 계획만 제시하고 확인을 기다리세요. 파일을 수정하지 마세요.':''}`;
    if(Buffer.byteLength(instruction)>3072) throw Error('instruction-limit');
    const requestId=o.requestId??randomUUID();
    const result=verify(await call({operation:'prepare',target,expectedRevision,requestId,profile}));
    // Existing reservations, even after a lost response, must not cause another spawn.
    return {...result,dispatchAllowed:result.dispatchAllowed===true,requestId,taskName:`autopets_${requestId.replaceAll('-','')}`,requestedModel:selected.model,requestedEffort:selected.effort,instruction,skillPath:skill};
  }
  if(['enable','disable','disconnect'].includes(o.operation)) return verify(await call({operation:o.operation==='disconnect'?'disconnect':'enable',target,expectedRevision,...(o.operation==='disconnect'?{}:{enabled:o.operation==='enable'})}));
  const requestId=o.requestId??(o.operation==='recover'?current.link.run?.id:undefined);
  if(!requestId || current.link.run?.id!==requestId) throw Error('pet-run-mismatch');
  if(o.operation==='close-tracking') return verify(await call({operation:'close-tracking',target,expectedRevision,requestId}));
  if(current.link.run.trackingClosed) throw Error('pet-run-closed');
  let receipt={kind:o.operation};
  if(o.operation==='spawned') {
    if(!/^\/root(?:\/[a-z0-9_]+)+$/u.test(o.agentPath??'') || o.record || o.childId || o.turnId) throw Error('invalid-child-selector');
    receipt={kind:'spawned',agentPath:o.agentPath};
  }
  if(o.operation==='observe' || o.operation==='recover') {
    const shared={parentId:target.threadId,cwd:target.cwd,startedAfter:current.link.run.startedAt};
    const agentPath=o.agentPath??(!o.record && !o.childId && !o.turnId?current.link.run.agentPath:undefined);
    let record;
    if(agentPath) {
      if(o.record || o.childId || o.turnId) throw Error('ambiguous-child-selector');
      record=await (deps.resolveRecord??resolveDelegatedRecord)({...shared,codexHome:env.CODEX_HOME??path.join(os.homedir(),'.codex'),agentPath});
    } else { if(!o.record || !o.childId || !o.turnId) throw Error('explicit-child-record-required'); record={file:o.record,childId:o.childId,turnId:o.turnId}; }
    receipt={kind:'runtime',...await (deps.audit??auditDelegatedTurn)({...shared,...record})};
  }
  return verify(await call({operation:'report',target,expectedRevision,requestId,receipt}));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runPet(process.argv.slice(2)))); }
  catch(error) { console.log(JSON.stringify({ok:false,code:/^[a-z-]+$/u.test(error.message)?error.message:'pet-connection-unavailable',retrySubmission:false})); process.exitCode=1; }
}
