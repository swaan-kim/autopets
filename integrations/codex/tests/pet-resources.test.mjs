import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { SKILL_ROOT, skillRootForRuntime, skillDigest, resolvePetSkills, readPinnedSkill, readBundledSkill, validateBundledSkillPins } from '../runtime/pet-skills.mjs';
import { auditPetResources, classifyFigmaRead } from '../runtime/pet-resource-audit.mjs';
import { readSkillArgs } from '../skills/autopets/scripts/read-skill.mjs';

const ref={id:'frontend-design',version:'41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f'};
const turn='33333333-3333-4333-8333-333333333333';
const row=p=>({type:'response_item',payload:p});

async function versionFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-skill-versions-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('autopets-skill-versions-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.cp(SKILL_ROOT, root, { recursive: true });
  const registry = JSON.parse(await fs.readFile(path.join(root, 'skill-sources.json'), 'utf8'));
  const pins = JSON.parse(await fs.readFile(path.join(root, 'versions/skill-pins.json'), 'utf8'));
  const previous = registry.skills.find(entry => entry.id === 'autopets-daily-plan');
  const text = (await fs.readFile(path.join(root, previous.id, 'SKILL.md'), 'utf8')) + '\n새 버전의 작업 원칙입니다.\n';
  const next = { ...previous, version: '2.0.0', sha256: skillDigest(text.replaceAll('\r\n', '\n')) };
  registry.skills[registry.skills.indexOf(previous)] = next;
  pins.skills.push(next);
  await fs.mkdir(path.join(root, 'versions', next.id, next.version));
  await fs.writeFile(path.join(root, next.id, 'SKILL.md'), text);
  await fs.writeFile(path.join(root, 'versions', next.id, next.version, 'SKILL.md'), text);
  await fs.writeFile(path.join(root, 'skill-sources.json'), JSON.stringify(registry));
  await fs.writeFile(path.join(root, 'versions/skill-pins.json'), JSON.stringify(pins));
  return { root, previous, next, registry, pins };
}

test('an installed update retains the old exact skill while short reads choose only the current version', async t => {
  const f = await versionFixture(t), options = { root: f.root };
  assert.deepEqual(await validateBundledSkillPins(options), { current: 9, preserved: 10 });
  const old = await readPinnedSkill(f.previous.id, f.previous.version, options);
  const current = await readBundledSkill(f.previous.id, options);
  assert.equal(old.version, f.previous.version);
  assert.equal(old.sha256, f.previous.sha256);
  assert.equal(path.relative(await fs.realpath(f.root), old.path), path.join('versions', f.previous.id, f.previous.version, 'SKILL.md'));
  assert.equal(current.version, f.next.version);
  assert.notEqual(current.text, old.text);
  assert.equal(current.path, await fs.realpath(path.join(f.root, f.next.id, 'SKILL.md')));
});

test('a missing old pin never substitutes the newer installed skill or hides a packaging failure', async t => {
  const f = await versionFixture(t), options = { root: f.root };
  await fs.unlink(path.join(f.root, 'versions', f.previous.id, f.previous.version, 'SKILL.md'));
  await assert.rejects(readPinnedSkill(f.previous.id, f.previous.version, options), /bundled-skill-missing/);
  assert.equal((await readBundledSkill(f.next.id, options)).version, f.next.version);
  await assert.rejects(validateBundledSkillPins(options), /bundled-skill-missing/);
  await assert.rejects(readPinnedSkill(f.previous.id, '../2.0.0', options), /reference-invalid/);
});

test('recovery recognizes a pre-update read only at its known installed path with exact historical content', async t => {
  const f = await versionFixture(t), options = { root: f.root };
  const skills = await resolvePetSkills({ skills: [f.previous] }, options);
  const content = await readPinnedSkill(f.previous.id, f.previous.version, options);
  const oldOutput = { ...content, path: path.join(await fs.realpath(f.root), f.previous.id, 'SKILL.md') };
  const output = row({ type: 'function_call_output', call_id: 'old-read', output: JSON.stringify(oldOutput) });
  const rows = [{ type: 'turn_context', payload: { turn_id: turn } },
    row({ type: 'function_call', name: 'exec_command', call_id: 'old-read', arguments: `node C:/bundle/autopets/scripts/read-skill.mjs --bundled-id ${f.previous.id}` }), output];
  assert.deepEqual(auditPetResources(rows, turn, skills).skills, [{ id: f.previous.id, version: f.previous.version }]);
  output.payload.output = JSON.stringify({ ...oldOutput, path: path.join(f.root, 'unregistered/SKILL.md') });
  assert.deepEqual(auditPetResources(rows, turn, skills).skills, []);
  output.payload.output = JSON.stringify({ ...oldOutput, text: (await readBundledSkill(f.next.id, options)).text });
  assert.deepEqual(auditPetResources(rows, turn, skills).skills, []);
});

test('rewriting a current version requires a new immutable pin rather than replacing its declared hash', async t => {
  const f = await versionFixture(t), options = { root: f.root };
  const file = path.join(f.root, f.next.id, 'SKILL.md');
  const text = await fs.readFile(file, 'utf8') + 'changed without a version bump';
  await fs.writeFile(file, text);
  f.registry.skills.find(entry => entry.id === f.next.id).sha256 = skillDigest(text);
  await fs.writeFile(path.join(f.root, 'skill-sources.json'), JSON.stringify(f.registry));
  await assert.rejects(readPinnedSkill(f.next.id, f.next.version, options), /bundled-skill-pin-mismatch/);
  await assert.rejects(validateBundledSkillPins(options), /bundled-skill-pin-mismatch/);
  assert.equal((await readPinnedSkill(f.previous.id, f.previous.version, options)).sha256, f.previous.sha256);
});

test('preserved skills and license files retain package containment and hash checks', async t => {
  const f = await versionFixture(t), options = { root: f.root };
  const archived = path.join(f.root, 'versions', f.previous.id, f.previous.version, 'SKILL.md');
  await assert.rejects(readPinnedSkill(f.previous.id, f.previous.version, { ...options,
    realpath: file => file === archived ? Promise.resolve(path.join(f.root, 'outside.md')) : fs.realpath(file),
  }), /location-mismatch/);
  await fs.appendFile(archived, 'changed');
  await assert.rejects(readPinnedSkill(f.previous.id, f.previous.version, options), /bundled-skill-integrity/);
  const license = path.join(f.root, ref.id, 'LICENSE.txt');
  await assert.rejects(readPinnedSkill(ref.id, ref.version, { ...options,
    realpath: file => file === license ? Promise.resolve(path.join(f.root, '..', 'LICENSE.txt')) : fs.realpath(file),
  }), /location-mismatch/);
});

test('upstream declarations require a pinned source, modification status and contained verified license', async t => {
  const f = await versionFixture(t), options = { root: f.root };
  const entry = f.registry.skills.find(skill => skill.id === 'autopets-marketing-copy');
  for (const patch of [{ source: entry.source.replace(entry.upstreamCommit, 'main') }, { modified: undefined },
    { upstreamSha256: 'not-a-content-hash' }, { license: { ...entry.license, file: '../LICENSE.txt' } }]) {
    const changed = { ...f.registry, skills: f.registry.skills.map(skill => skill.id === entry.id ? { ...skill, ...patch } : skill) };
    await fs.writeFile(path.join(f.root, 'skill-sources.json'), JSON.stringify(changed));
    await assert.rejects(resolvePetSkills({ skills: [{ id: entry.id, version: entry.version }] }, options), /provenance-invalid/);
  }
  await fs.writeFile(path.join(f.root, 'skill-sources.json'), JSON.stringify(f.registry));
  f.pins.skills.push(f.pins.skills[0]);
  await fs.writeFile(path.join(f.root, 'versions/skill-pins.json'), JSON.stringify(f.pins));
  await assert.rejects(validateBundledSkillPins(options), /pin-duplicate/);
});

test('skill reader retries only corrected exact arguments; a cwd suffix remains invalid',async()=>{
  const args=['--id',ref.id,'--version',ref.version];
  await assert.rejects(readSkillArgs([...args,'.']),/invalid-skill-read-arguments/);
  const result=await readSkillArgs(args);
  assert.equal(result.id,ref.id);
  assert.equal(result.version,ref.version);
  assert.equal(result.text,await fs.readFile(result.path,'utf8'));
});

test('short bundled reads retain exact pins and reject ambiguity, extra args and wrong explicit versions',async()=>{
  const result=await readSkillArgs(['--bundled-id',ref.id]);
  assert.deepEqual(result,await readPinnedSkill(ref.id,ref.version));
  await assert.rejects(readSkillArgs(['--bundled-id',ref.id,'.']),/invalid-skill-read-arguments/);
  await assert.rejects(readSkillArgs(['--id',ref.id,'--version','41bbe19d1a1a7eaab5e7bb9050a417e5e6cffc8f']),/bundled-skill-unavailable/);
  await assert.rejects(readBundledSkill('../outside'),/reference-invalid/);
  await assert.rejects(readBundledSkill('missing-skill'),/bundled-skill-unavailable/);
  const registry=JSON.parse(await fs.readFile(path.join(SKILL_ROOT,'skill-sources.json'),'utf8'));
  registry.skills.push({...registry.skills.find(s=>s.id===ref.id),version:'different'});
  await assert.rejects(readBundledSkill(ref.id,{readFile:async()=>JSON.stringify(registry)}),/bundled-skill-unavailable/);
});

test('bundled read evidence still requires the selected version and full verified content',async()=>{
  const skills=await resolvePetSkills({skills:[ref]});
  const result=await readBundledSkill(ref.id);
  const call=row({type:'function_call',name:'exec_command',call_id:'bundled',arguments:`node C:/bundle/autopets/scripts/read-skill.mjs --bundled-id ${ref.id}`});
  const output=row({type:'function_call_output',call_id:'bundled',output:JSON.stringify(result)});
  const rows=[{type:'turn_context',payload:{turn_id:turn}},call,output];
  assert.deepEqual(auditPetResources(rows,turn,skills).skills,[ref]);
  for(const override of [{version:'other'},{sha256:'wrong'},{text:result.text.slice(1)}]) {
    output.payload.output=JSON.stringify({...result,...override});
    assert.deepEqual(auditPetResources(rows,turn,skills).skills,[]);
  }
  output.payload.output=JSON.stringify(result);
  assert.deepEqual(auditPetResources(rows,turn,[{...skills[0],version:'other'}]).skills,[]);
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
  await assert.rejects(readBundledSkill(ref.id,options),/integrity/);
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
