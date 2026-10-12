import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { SKILL_ROOT, skillRootForRuntime, resolvePetSkills, readPinnedSkill } from '../runtime/pet-skills.mjs';
import { auditPetResources, classifyFigmaRead } from '../runtime/pet-resource-audit.mjs';
import { readSkillArgs } from '../skills/autopets/scripts/read-skill.mjs';

const ref={id:'frontend-design',version:'41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f'};
const turn='33333333-3333-4333-8333-333333333333';
const row=p=>({type:'response_item',payload:p});

test('skill reader retries only corrected exact arguments; a cwd suffix remains invalid',async()=>{
  const args=['--id',ref.id,'--version',ref.version];
  await assert.rejects(readSkillArgs([...args,'.']),/invalid-skill-read-arguments/);
  const result=await readSkillArgs(args);
  assert.equal(result.id,ref.id);
  assert.equal(result.version,ref.version);
  assert.equal(result.text,await fs.readFile(result.path,'utf8'));
});

test('installed skill root follows the physical runtime file, not an MSIX directory alias',()=>{
  const logical = path.resolve('fixture/logical/connector/integrations/codex');
  const physical = path.resolve('fixture/package-cache/connector/integrations/codex');
  const runtimeFile = path.join(logical, 'runtime/pet-skills.mjs');
  const observed = [];
  const resolved = skillRootForRuntime(runtimeFile, file => {
    observed.push(file);
    // The MSIX repro resolves files to the cache but leaves the directory unchanged.
    return file === runtimeFile ? path.join(physical, 'runtime/pet-skills.mjs') : file;
  });
  assert.deepEqual(observed, [runtimeFile]);
  assert.equal(resolved, path.join(physical, 'skills'));
  assert.throws(()=>skillRootForRuntime(runtimeFile, ()=>{throw Error('missing-runtime');}), /missing-runtime/);
});

test('physical runtime anchoring still rejects a skill redirected outside its package',async()=>{
  const outside = path.resolve(SKILL_ROOT, '../outside/frontend-design/SKILL.md');
  await assert.rejects(resolvePetSkills({skills:[ref]}, {
    realpath: file => file === path.join(SKILL_ROOT, ref.id, 'SKILL.md') ? Promise.resolve(outside) : fs.realpath(file),
  }), /bundled-skill-location-mismatch/);
  const renamed = path.join(SKILL_ROOT, ref.id, 'OTHER.md');
  await assert.rejects(resolvePetSkills({skills:[ref]}, {
    realpath: file => file === path.join(SKILL_ROOT, ref.id, 'SKILL.md') ? Promise.resolve(renamed) : fs.realpath(file),
  }), /bundled-skill-location-mismatch/);
});

test('missing or tampered packaged skill fails before dispatch, including detached license',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'autopets-skills-'));
  t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('autopets-skills-'));await fs.rm(dir,{recursive:true,force:true});});
  await fs.cp(SKILL_ROOT,dir,{recursive:true});
  const options={root:dir},template={skills:[ref]};
  const selected=await resolvePetSkills(template,options);
  assert.equal(path.relative(await fs.realpath(dir),selected[0].path),path.join('frontend-design','SKILL.md'));
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

test('nested Windows reader calls retain exact content, path and single-result requirements',async()=>{
  const skills=await resolvePetSkills({skills:[ref]});
  const content=await readPinnedSkill(ref.id,ref.version);
  const command=`node C:\\bundle\\autopets\\scripts\\read-skill.mjs --id ${ref.id} --version ${ref.version}`;
  const call={type:'custom_tool_call',name:'exec',call_id:'windows-read',input:`const r = await tools.exec_command(${JSON.stringify({cmd:command})}); text(r.output);`};
  const output={type:'custom_tool_call_output',call_id:'windows-read',output:[{type:'text',text:JSON.stringify(content)}]};
  const rows=[{type:'turn_context',payload:{turn_id:turn}},row(call),row(output)];
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[ref]);
  // A second JSON envelope can add another level of escaped path separators.
  call.input=JSON.stringify({code:call.input});
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[ref]);
  output.output=[{type:'text',text:JSON.stringify({...content,path:path.join(path.dirname(content.path),'other.md')})}];
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[]);
  output.output=[{type:'text',text:JSON.stringify({...content,text:content.text.slice(0,-1)})}];
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[]);
  output.output=[{type:'text',text:JSON.stringify(content)}];
  output.output=[{type:'input_text',text:JSON.stringify({i:1,result:{status:'fulfilled',value:{exit_code:0,output:JSON.stringify(content)}}})}];
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[ref]);
  output.output=[{type:'input_text',text:JSON.stringify({i:1,result:{status:'rejected',value:{exit_code:0,output:JSON.stringify(content)}}})}];
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[]);
  output.output=[{type:'input_text',text:JSON.stringify({i:1,result:{status:'fulfilled',value:{exit_code:1,output:JSON.stringify(content)}}})}];
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[]);
  output.output=[{type:'text',text:JSON.stringify(content)}];
  rows.push(row(output));
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
