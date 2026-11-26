#!/usr/bin/env node
// Explicit attachment: never depends on hooks, launches AI, or fabricates a session event.
import path from 'node:path';
import { realpath, stat, readFile, rm } from 'node:fs/promises';
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
import { recipeStart, RECIPE_ID, RECIPES } from '../../../../../packages/contracts/recipes.mjs';

const reviewBatch = v => typeof v === 'string' && /^[0-9a-f]{8}$/u.test(v);
const uuid = v => typeof v === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(v);
export function parsePetArgs(args) {
  const result = { operation: args[0] };
  if (!['connect','apply-pet','status','settings','prepare','spawned','returned','failed','observe','recover','close-tracking','disable','enable','disconnect','review-save','review-due','review-result'].includes(result.operation)) throw Error('invalid-operation');
  const flags = { '--codex':'executable','--connection':'connection','--profile':'profile','--request':'requestId','--child':'childId','--turn':'turnId','--record':'record','--agent-path':'agentPath','--pet':'petId','--pet-revision':'petRevision','--recipe':'recipe','--input':'input','--batch':'batch','--mode':'mode' };
  for(let i=1;i<args.length;i+=2) {
    const key=flags[args[i]];
    if (!key || result[key] !== undefined || !args[i+1]) throw Error('invalid-arguments');
    result[key]=args[i+1];
  }
  for(const key of ['executable','connection','record','input']) if(result[key]!==undefined && !path.isAbsolute(result[key])) throw Error('absolute-path-required');
  // 복습 도우미: cards and results come in a UTF-8 JSON file (Korean survives any shell), read once and removed.
  if((result.input!==undefined) !== ['review-save','review-result'].includes(result.operation)) throw Error('invalid-arguments');
  // review-due --batch <묶음 코드> [--mode all]: that batch's part of today's list, or all its cards.
  if((result.batch!==undefined || result.mode!==undefined) && result.operation!=='review-due') throw Error('invalid-arguments');
  if(result.batch!==undefined && !reviewBatch(result.batch)) throw Error('invalid-review-batch');
  if(result.mode!==undefined && (!['due','all'].includes(result.mode) || result.batch===undefined)) throw Error('invalid-arguments');
  for(const key of ['requestId','childId','turnId']) if(result[key]!==undefined && !uuid(result[key])) throw Error('invalid-identity');
  if(result.petId!==undefined || result.petRevision!==undefined || result.operation==='apply-pet') {
    if(!['connect','apply-pet'].includes(result.operation) || typeof result.petId!=='string' || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(result.petId)
      || !/^[1-9]\d{0,8}$/u.test(result.petRevision??'')) throw Error('invalid-saved-pet');
    result.petRevision=Number(result.petRevision);
  }
  // A recipe only starts together with the exact saved pet it belongs to.
  if(result.recipe!==undefined && (!['connect','apply-pet'].includes(result.operation) || result.petId===undefined || !RECIPE_ID.test(result.recipe))) throw Error('invalid-recipe');
  return result;
}
const regularFile=file=>stat(file).then(s=>s.isFile(),()=>false);
// Codex's executable path contains its version and changes on every update, so it is never
// remembered: each call takes the first one the current host gives and checks it still exists.
// A missing selected path is an error, not a reason to try the next source.
export async function resolveCodexExecutable(explicit,env,isFile=regularFile) {
  const selected=[explicit,env.AUTOPETS_CODEX_EXECUTABLE,env.CODEX_APP_RUNTIME_CLI_PATH].find(v=>typeof v==='string' && v!=='');
  if(!selected) throw Error('codex-runtime-required');
  if(!path.isAbsolute(selected) || !(await isFile(selected))) throw Error('codex-runtime-unavailable');
  return selected;
}
const failureCode=error=>/^[a-z][a-z-]{0,63}$/u.test(error?.message??'')?error.message:null;
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
  // An unknown recipe stops before the app or the chat's pet is touched.
  if(o.recipe && !RECIPES.some(recipe=>recipe.id===o.recipe)) throw Error('unknown-recipe');
  const executable=await resolveCodexExecutable(o.executable,env,deps.isFile);
  let host;
  try { host=await (deps.inspect??inspectPetHost)({executable,cwd,threadId:env.CODEX_THREAD_ID,includeModels:['settings','prepare'].includes(o.operation)}); }
  catch(error) { throw failureCode(error)?error:Error('codex-runtime-failed'); }
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
  // The questions for the chosen recipe travel with the applied pet, so the chat needs no second lookup.
  const withRecipe=result=>o.recipe?{...result,recipe:recipeStart(o.recipe,result.link?.template,{home:env.USERPROFILE??os.homedir(),now:deps.now?.()})}:result;
  if(o.operation==='connect') {
    const saved=verify(await call({operation:'connect',target}));
    const reread=verify(await call({operation:'read',target}));
    if(!reread.link || reread.link.revision!==saved.link?.revision) throw Error('connection-unconfirmed');
    return withRecipe({...(o.petId?await applyPet(reread):reread),operation:'connect'});
  }
  if(o.operation.startsWith('review-')) return review(o,target,connection,deps);
  let current=verify(await call({operation:'read',target}));
  if(o.operation==='status') return current;
  if(!current.link) throw Error('pet-not-connected');
  if(o.operation==='apply-pet') return withRecipe(await applyPet(current));
  if(o.operation==='recover' && !current.link.connected) current=verify(await call({operation:'connect',target}));
  const expectedRevision=current.link.revision;
  if(['settings','prepare'].includes(o.operation)) {
    const profile=o.profile??current.link.profile;
    const selected=availableProfile(profile,host.models,current.link.template);
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
const MAX_REVIEW_INPUT=64*1024;
/** The JSON file the chat wrote under the temp folder. Only that folder is read, and the file is removed. */
export async function readReviewInput(file,deps={}) {
  const temp=await (deps.realpath??realpath)(deps.tmpdir??os.tmpdir());
  let actual;
  try { actual=await (deps.realpath??realpath)(file); } catch { throw Error('review-input-unavailable'); }
  const relative=path.relative(temp,actual);
  if(!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(actual).toLowerCase()!=='.json') throw Error('review-input-location');
  try {
    const info=await stat(actual);
    if(!info.isFile() || info.size>MAX_REVIEW_INPUT) throw Error('review-input-format');
    const value=JSON.parse((await readFile(actual,'utf8')).replace(/^﻿/u,''));
    if(!value || typeof value!=='object' || Array.isArray(value)) throw Error('review-input-format');
    return value;
  } catch(error) { throw error?.message==='review-input-format'?error:Error('review-input-format'); }
  finally { await rm(actual,{force:true}).catch(()=>undefined); }
}
async function review(o,target,connection,deps) {
  const send=body=>(deps.request??requestJson)(connection,'/v1/review',body,5000,65536);
  const scope=(batch,all)=>({...(batch===undefined?{}:{batch}),...(all?{all:true}:{})});
  if(o.operation==='review-due') return {ok:true,...await send({operation:'due',target,...scope(o.batch,o.mode==='all')})};
  const input=await (deps.readReviewInput??readReviewInput)(o.input,deps);
  if(o.operation==='review-save') {
    // A new quiz is one batch: {"batch":{"name":"…"},"cards":[…]}. Questions added during a batch
    // review join it: {"batch":{"id":"<묶음 코드>"},"cards":[…]}.
    if(!Array.isArray(input.cards)) throw Error('review-input-format');
    const named=typeof input.batch?.name==='string' && input.batch.name.trim()!=='';
    const existing=reviewBatch(input.batch?.id);
    if(named===existing) throw Error('invalid-review-batch');
    return {ok:true,...await send({operation:'save',target,batch:named?{name:input.batch.name}:{id:input.batch.id},cards:input.cards})};
  }
  // A review: {"results":[…]}, with "batch" for one batch and "all": true for 전체 다시 풀기.
  if(!Array.isArray(input.results)) throw Error('review-input-format');
  if((input.batch!==undefined && !reviewBatch(input.batch)) || (input.all!==undefined && typeof input.all!=='boolean') || (input.all && input.batch===undefined)) throw Error('invalid-review-batch');
  return {ok:true,...await send({operation:'result',target,results:input.results,...scope(input.batch,input.all)})};
}
const EFFORT_LABELS={low:'낮음',medium:'보통',high:'높음',xhigh:'매우 높음'};
function unavailableProfileMessage(requested) {
  const valid=requested && typeof requested.model==='string' && /^[a-z0-9.-]+$/u.test(requested.model);
  const name=valid?requested.model.replace(/^gpt-[\d.]+-/u,'').replace(/^./u,c=>c.toUpperCase()):'';
  const setting=valid?`${name} · ${EFFORT_LABELS[requested.effort]??requested.effort}`:'펫에 저장된 모델·강도';
  const stage=requested?.stage==='plan'?'계획 단계에 필요한':'이 작업에 필요한';
  return `이 Codex 계정에서는 ${stage} ${setting} 설정을 쓸 수 없어 작업을 시작하지 않았어요. 다른 모델로 몰래 바꾸지 않았어요. `
    +(requested?.stage==='plan'
      ?'계획 없이 바로 만들려면 같은 채팅에 "이번만 가볍게: (할 일)"처럼 보내거나, AutoPets 앱에서 다른 펫을 골라 주세요.'
      :'AutoPets 앱의 펫 설정에서 작업 방식을 "가볍게"로 바꾼 뒤 다시 요청해 주세요.');
}
export function petFailure(error) {
  // Only a short known-shape code leaves; raw OS/runtime text may hold paths or tokens.
  const code=failureCode(error)??'pet-internal-error';
  const connectionFile='AutoPets 연결 파일을 읽을 수 없어요. AutoPets 앱을 다시 켠 뒤 시도해 주세요.';
  const messages = {
    'codex-runtime-required':'현재 Codex 실행 파일 경로를 받지 못했습니다. Codex 앱의 채팅에서 다시 요청해 주세요.',
    'codex-runtime-unavailable':'현재 Codex 실행 파일을 찾을 수 없습니다. Codex 업데이트로 경로가 변경됐을 수 있습니다.',
    'codex-runtime-failed':'현재 Codex 실행 파일을 실행하지 못했거나 응답을 확인하지 못했어요. Codex를 다시 시작한 뒤 시도해 주세요.',
    'connection-unavailable':'AutoPets 연결 파일을 찾을 수 없어요. AutoPets 앱이 켜져 있는지 확인해 주세요.',
    'connection-format':connectionFile,'connection-size':connectionFile,'connection-path':connectionFile,
    'bridge-unavailable':'AutoPets 앱의 로컬 연결이 응답하지 않아요. AutoPets 앱이 켜져 있는지 확인해 주세요.',
    'pet-internal-error':'펫 도구에서 예상하지 못한 오류가 났어요. 보안을 위해 세부 내용은 표시하지 않아요.',
    'unsupported-runtime-index':'현재 Codex의 작업 기록을 확인할 수 없어 새 펫 작업을 시작하지 않았어요. Codex 버전과 연결 상태를 확인해 주세요.',
    'unsupported-runtime-record':'현재 채팅의 실행 기록을 확인할 수 없어 새 펫 작업을 시작하지 않았어요. 기존 작업은 다시 실행하지 말고 상태를 확인해 주세요.',
    'pet-revision-changed':'설정이 바뀌었어요. 현재 채팅의 펫 상태를 다시 확인해 주세요.',
    'pet-run-active-or-unresolved':'기존 작업을 먼저 확인해 주세요. 새 작업만 막으려면 도움을 꺼주세요.',
    'not-review-pet':'이 채팅의 펫이 복습 도우미가 아니라서 문제를 저장하지 않았어요. AutoPets 앱에서 복습 도우미를 이 채팅에 연결해 주세요.',
    'pet-not-connected':'이 채팅에 연결된 펫이 없어요. 먼저 펫을 연결해 주세요.',
    'invalid-review-card':'문제 형식이 맞지 않아 저장하지 않았어요. 보기 4개, 정답 번호 1~4, 길이 제한을 확인해 주세요.',
    'invalid-review-batch':'문제 묶음 정보가 맞지 않아 저장하지 않았어요. 묶음 이름(40자 이내)과 묶음 코드를 확인해 주세요.',
    'review-batch-not-found':'그 문제 묶음을 찾을 수 없어요. AutoPets 앱의 문제 묶음에서 다시 눌러 주세요.',
    'review-cards-full':'저장된 문제가 500개라 더 저장하지 않았어요. AutoPets 앱의 문제 묶음에서 지운 뒤 다시 시도해 주세요.',
    'review-card-not-due':'오늘 복습할 문제가 아닌 카드가 섞여 있어 결과를 저장하지 않았어요. review-due로 다시 읽어 주세요.',
    'review-input-location':'입력 파일은 임시 폴더(%TEMP%) 안의 .json 파일이어야 해요.',
    'review-input-unavailable':'입력 파일을 찾을 수 없어요.',
    'review-input-format':'입력 파일을 읽을 수 없어요. UTF-8 JSON인지 확인해 주세요.',
    'unknown-recipe':'이 시작 요청의 작업 방법을 찾을 수 없어요. AutoPets 앱에서 다시 시작해 주세요.',
    'invalid-recipe':'이 시작 요청의 작업 방법을 읽을 수 없어요. AutoPets 앱에서 다시 시작해 주세요.',
    'recipe-pet-mismatch':'시작 요청의 작업 방법과 펫이 서로 맞지 않아요. AutoPets 앱에서 다시 시작해 주세요.',
  };
  if (messages[code]) return {ok:false,code,retrySubmission:false,message:messages[code]};
  if (code==='unavailable-delegation-profile') return {ok:false,code,retrySubmission:false,message:unavailableProfileMessage(error.requested)};
  return {ok:false,code,retrySubmission:false,...(code==='slots-full'?{
    message:'펫 3개가 모두 연결돼 있어요. AutoPets에서 사용하지 않는 연결을 하나 해제한 뒤 다시 연결해 주세요. 기존 연결은 자동으로 바꾸지 않아요.',
  }:{})};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runPet(process.argv.slice(2)))); }
  catch(error) { console.log(JSON.stringify(petFailure(error))); process.exitCode=1; }
}
