#!/usr/bin/env node
// Explicit attachment: never depends on hooks, launches AI, or fabricates a session event.
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { readConnection, requestJson } from './bridge-client.mjs';
import { withReadOnlyRuntime } from '../../../runtime/rpc.mjs';
import { summarizeTaskMetadata } from '../../../runtime/task-metadata.mjs';
import { availableProfile } from '../../../runtime/delegation.mjs';
import { auditDelegatedTurn, resolveDelegatedRecord, inspectDelegationCompatibility } from '../../../runtime/delegation-audit.mjs';
import { openInstalledPetApp } from '../../../bootstrap/start.mjs';
import { resolvePetSkills, petSkillInstruction } from '../../../runtime/pet-skills.mjs';

const uuid = v => typeof v === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(v);
export function parsePetArgs(args) {
  const result = { operation: args[0] };
  if (!['connect','apply-pet','status','settings','prepare','spawned','returned','failed','observe','recover','close-tracking','disable','enable','disconnect'].includes(result.operation)) throw Error('invalid-operation');
  const flags = { '--codex':'executable','--connection':'connection','--profile':'profile','--request':'requestId','--child':'childId','--turn':'turnId','--record':'record','--agent-path':'agentPath','--pet':'petId','--pet-revision':'petRevision' };
  for(let i=1;i<args.length;i+=2) {
    const key=flags[args[i]];
    if (!key || result[key] !== undefined || !args[i+1]) throw Error('invalid-arguments');
    result[key]=args[i+1];
  }
  for(const key of ['executable','connection','record']) if(result[key]!==undefined && !path.isAbsolute(result[key])) throw Error('absolute-path-required');
  for(const key of ['requestId','childId','turnId']) if(result[key]!==undefined && !uuid(result[key])) throw Error('invalid-identity');
  if(result.petId!==undefined || result.petRevision!==undefined || result.operation==='apply-pet') {
    if(!['connect','apply-pet'].includes(result.operation) || typeof result.petId!=='string' || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(result.petId)
      || !/^[1-9]\d{0,8}$/u.test(result.petRevision??'')) throw Error('invalid-saved-pet');
    result.petRevision=Number(result.petRevision);
  }
  return result;
}
export async function inspectPetHost({executable,cwd,threadId,includeModels=true,runtime=withReadOnlyRuntime}) {
  return runtime({executable,cwd},async ({call})=>{
    const {thread}=await call('thread/read',{threadId,includeTurns:false});
    const node=summarizeTaskMetadata(thread,{id:threadId,cwd,label:'current-local-task'},Date.now());
    if(node.creationSurface!=='codex-local' || node.parentId) throw Error('unsupported-current-task');
    if (!includeModels) return {node,models:[]};
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
  const host=await (deps.inspect??inspectPetHost)({executable,cwd,threadId:env.CODEX_THREAD_ID,includeModels:['settings','prepare'].includes(o.operation)});
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
  const applyPet=async current=>{
    if(!current.link) throw Error('pet-not-connected');
    const saved=verify(await call({operation:'apply-pet',target,expectedRevision:current.link.revision,petId:o.petId,petRevision:o.petRevision}));
    const reread=verify(await call({operation:'read',target}));
    if(reread.link?.revision!==saved.link?.revision || reread.link?.savedPet?.id!==o.petId || reread.link?.savedPet?.revision!==o.petRevision) throw Error('saved-pet-unconfirmed');
    return reread;
  };
  if(o.operation==='connect') {
    const saved=verify(await call({operation:'connect',target}));
    const reread=verify(await call({operation:'read',target}));
    if(!reread.link || reread.link.revision!==saved.link?.revision) throw Error('connection-unconfirmed');
    return {...(o.petId?await applyPet(reread):reread),operation:'connect'};
  }
  let current=verify(await call({operation:'read',target}));
  if(o.operation==='status') return current;
  if(!current.link) throw Error('pet-not-connected');
  if(o.operation==='apply-pet') return applyPet(current);
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
    const skills=await (deps.resolveSkills??resolvePetSkills)(current.link.template);
    const instruction=petSkillInstruction(current.link.template,skills,profile);
    await (deps.preflight??inspectDelegationCompatibility)({codexHome:env.CODEX_HOME??path.join(os.homedir(),'.codex'),parentId:target.threadId,cwd:target.cwd});
    const requestId=o.requestId??randomUUID();
    const result=verify(await call({operation:'prepare',target,expectedRevision,requestId,profile}));
    // Existing reservations, even after a lost response, must not cause another spawn.
    const skillReader={executable:process.execPath,script:fileURLToPath(new URL('./read-skill.mjs',import.meta.url)),
      reads:skills.map(({id,version})=>['--id',id,'--version',version])};
    return {...result,dispatchAllowed:result.dispatchAllowed===true,requestId,taskName:`autopets_${requestId.replaceAll('-','')}`,requestedModel:selected.model,requestedEffort:selected.effort,instruction,skillPath:skills[0].path,skills,skillReader};
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
    // Old runs did not snapshot the template; keep their original runtime-only recovery.
    const template=current.link.run.template;
    const expectedSkills=template?await (deps.resolveSkills??resolvePetSkills)(template):undefined;
    const audit=await (deps.audit??auditDelegatedTurn)({...shared,...record,expectedSkills,figmaEnabled:template?.features?.figmaDesign===true});
    const {resources,...runtime}=audit;
    receipt={kind:'runtime',...runtime};
    const observed=verify(await call({operation:'report',target,expectedRevision,requestId,receipt}));
    if(!resources) return observed;
    const result=verify(await call({operation:'report',target,expectedRevision:observed.link.revision,requestId,
      receipt:{kind:'resources',childId:audit.childId,turnId:audit.turnId,skills:resources.skills,figmaUsed:resources.figmaUsed}}));
    return {...result,resourceObservation:{figma:resources.figmaObservation}};
  }
  return verify(await call({operation:'report',target,expectedRevision,requestId,receipt}));
}
export function petFailure(error) {
  const code=/^[a-z-]+$/u.test(error?.message??'')?error.message:'pet-connection-unavailable';
  const messages = {
    'unsupported-runtime-index':'현재 Codex의 작업 기록을 확인할 수 없어 새 펫 작업을 시작하지 않았어요. Codex 버전과 연결 상태를 확인해 주세요.',
    'unsupported-runtime-record':'현재 채팅의 실행 기록을 확인할 수 없어 새 펫 작업을 시작하지 않았어요. 기존 작업은 다시 실행하지 말고 상태를 확인해 주세요.',
    'pet-revision-changed':'설정이 바뀌었어요. 현재 채팅의 펫 상태를 다시 확인해 주세요.',
    'pet-run-active-or-unresolved':'기존 작업을 먼저 확인해 주세요. 새 작업만 막으려면 도움을 꺼주세요.',
  };
  if (messages[code]) return {ok:false,code,retrySubmission:false,message:messages[code]};
  return {ok:false,code,retrySubmission:false,...(code==='slots-full'?{
    message:'펫 3개가 모두 연결돼 있어요. AutoPets에서 사용하지 않는 연결을 하나 해제한 뒤 다시 연결해 주세요. 기존 연결은 자동으로 바꾸지 않아요.',
  }:{})};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runPet(process.argv.slice(2)))); }
  catch(error) { console.log(JSON.stringify(petFailure(error))); process.exitCode=1; }
}
