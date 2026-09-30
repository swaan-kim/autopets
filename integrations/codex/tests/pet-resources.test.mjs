import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { SKILL_ROOT, resolvePetSkills, readPinnedSkill } from '../runtime/pet-skills.mjs';
import { auditPetResources, classifyFigmaRead } from '../runtime/pet-resource-audit.mjs';

const ref={id:'frontend-design',version:'41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f'};
const turn='33333333-3333-4333-8333-333333333333';
const row=p=>({type:'response_item',payload:p});

test('missing or tampered packaged skill fails before dispatch, including detached license',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'autopets-skills-'));
  t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('autopets-skills-'));await fs.rm(dir,{recursive:true,force:true});});
  await fs.cp(SKILL_ROOT,dir,{recursive:true});
  const options={root:dir},template={skills:[ref]};
  const selected=await resolvePetSkills(template,options);
  assert.ok(selected[0].path.startsWith(dir));
  await fs.appendFile(path.join(dir,'frontend-design/SKILL.md'),'changed');
  await assert.rejects(resolvePetSkills(template,options),/integrity/);
  await fs.copyFile(path.join(SKILL_ROOT,'frontend-design/SKILL.md'),path.join(dir,'frontend-design/SKILL.md'));
  await fs.writeFile(path.join(dir,'frontend-design/LICENSE.txt'),'missing original license');
  await assert.rejects(resolvePetSkills(template,options),/license-integrity/);
  await assert.rejects(resolvePetSkills({skills:[{...ref,id:'../../other'}]},options),/reference-invalid/);
  await assert.rejects(resolvePetSkills({skills:[{...ref,version:'latest'}]},options),/unavailable/);
});

test('a skill read needs the paired tool result with the exact complete pinned content',async()=>{
  const skills=await resolvePetSkills({skills:[ref]});
  const result=await readPinnedSkill(ref.id,ref.version);
  const call={type:'function_call',name:'functions.exec',call_id:'read-1',arguments:`await tools.exec_command({cmd:'node C:/bundle/autopets/scripts/read-skill.mjs --id ${ref.id} --version ${ref.version}'})`};
  const rows=[{type:'turn_context',payload:{turn_id:turn}},row(call)];
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[]);
  rows.push(row({type:'function_call_output',call_id:'wrong-call',output:JSON.stringify(result)}));
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[]);
  const output=row({type:'function_call_output',call_id:'read-1',output:JSON.stringify({exit_code:0,output:JSON.stringify(result)})});
  rows.push(output);
  const evidence=auditPetResources(rows,turn,skills);
  assert.deepEqual(evidence.skills,[ref]);
  assert.ok(!JSON.stringify(evidence).includes(result.text));
  output.payload.output=JSON.stringify({...result,text:'name: frontend-design'});
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[]);
  output.payload.output=JSON.stringify({exit_code:1,output:JSON.stringify(result)});
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[]);
  output.payload.output=JSON.stringify(result);
  call.arguments='echo "frontend-design was read"';
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[]);
});

test('other turns and ordinary assistant text cannot create skill evidence',async()=>{
  const skills=await resolvePetSkills({skills:[ref]});
  const content=await readPinnedSkill(ref.id,ref.version);
  const rows=[{type:'turn_context',payload:{turn_id:'other'}},row({type:'function_call',call_id:'a',name:'exec_command',arguments:`read-skill.mjs --id ${ref.id} --version ${ref.version}`}),
    row({type:'function_call_output',call_id:'a',output:JSON.stringify(content)}),{type:'turn_context',payload:{turn_id:turn}},row({role:'assistant',content:[{text:JSON.stringify(content)}]})];
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[]);
});

test('Figma availability or function-name mentions are not actual read evidence',()=>{
  const call={name:'mcp__figma__get_design_context',arguments:JSON.stringify({nodeId:'1:2',fileKey:'fixture-only'})};
  const success={isError:false,content:[{type:'text',text:'<frame name="synthetic" />'}]};
  assert.equal(classifyFigmaRead(call,JSON.stringify(success)),'read-confirmed');
  assert.equal(classifyFigmaRead({...call,name:'mcp__codex_apps__figma_get_design_context'},JSON.stringify(success)),'read-confirmed');
  assert.equal(classifyFigmaRead({...call,arguments:'{}'},success),'unverified-target');
  assert.equal(classifyFigmaRead(call,{...success,isError:true}),'unverified-result');
  assert.equal(classifyFigmaRead(call,{content:success.content}),'unverified-result');
  assert.equal(classifyFigmaRead({name:'functions.exec',arguments:'await tools.mcp__figma__get_design_context({})'},success),'unverified-nested-call');
  const rows=[{type:'turn_context',payload:{turn_id:turn}},row({...call,type:'function_call',call_id:'figma-read'}),row({type:'function_call_output',call_id:'figma-read',output:JSON.stringify(success)})];
  assert.equal(auditPetResources(rows,turn,[],true).figmaUsed,true);
  assert.equal(auditPetResources(rows,turn,[],false).figmaUsed,false);
  rows.push(row({type:'function_call_output',call_id:'figma-read',output:JSON.stringify({...success,isError:true})}));
  assert.equal(auditPetResources(rows,turn,[],true).figmaUsed,false);
});
