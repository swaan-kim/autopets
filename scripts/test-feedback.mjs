import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {ownerForAnnotation} from './check-ui-scope.mjs';

// Test-only server and browser. No installed app, host config, or AI execution.
process.env.AGENTATION_STORE='memory';
const {startHttpServer}=await import('agentation-mcp');
const desktopRequire=createRequire(new URL('../apps/desktop/package.json',import.meta.url));
const mcpRequire=createRequire(import.meta.resolve('agentation-mcp'));
const {createServer}=await import(pathToFileURL(desktopRequire.resolve('vite')).href);
const {Client}=await import(pathToFileURL(mcpRequire.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const {StdioClientTransport}=await import(pathToFileURL(mcpRequire.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
const output=new URL('../work/agentation-20261027/',import.meta.url);
await fs.mkdir(output,{recursive:true});
let feedback,vite,browser,client,sessionId;
const report={fixtureOnly:true,actualAiTurns:0,checks:[],pageErrors:[]};
try {
  feedback=startHttpServer(0,undefined,{host:'127.0.0.1'});await once(feedback,'listening');
  const endpoint=`http://127.0.0.1:${feedback.address().port}`;
  vite=await createServer({root:fileURLToPath(new URL('../apps/desktop/',import.meta.url)),logLevel:'error',clearScreen:false,
    server:{host:'127.0.0.1',port:0,strictPort:false},
    define:{'import.meta.env.VITE_AGENTATION':JSON.stringify('1'),'import.meta.env.VITE_AGENTATION_ENDPOINT':JSON.stringify(endpoint)}});
  await vite.listen();const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:992,height:688},reducedMotion:'reduce'});
  page.setDefaultTimeout(12000);page.on('pageerror',error=>report.pageErrors.push(error.message));
  await page.addInitScript(()=>{window.__feedbackCopies=0;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{window.__feedbackCopies++;}}});});
  await page.goto(origin);
  await page.locator('[data-agentation-development]').waitFor({state:'attached'});
  await page.locator('agentation-toolbar').waitFor({state:'attached'});
  // Observed toolbar button labels are recorded on failure, not guessed coordinates.
  const toolbar=page.locator('agentation-toolbar');
  const buttons=await toolbar.getByRole('button').evaluateAll(nodes=>nodes.map(n=>({label:n.getAttribute('aria-label'),title:n.getAttribute('title'),text:n.textContent})));
  report.toolbarButtons=buttons;
  const launcher=toolbar.getByRole('button',{name:'Start feedback mode',exact:true});
  await launcher.click();
  await page.locator('[data-agent-id="home.choose-pet"]').click();
  const editor=page.locator('[data-annotation-editor]').filter({visible:true});
  await editor.locator('textarea').fill('AP-FEEDBACK-SMOKE: 홈 선택 버튼의 여백 확인');
  await editor.getByRole('button',{name:/^Add$/}).click();
  let annotation;
  for(let attempt=0;attempt<40;attempt++){
    const value=await (await fetch(`${endpoint}/pending`)).json();
    annotation=value.annotations?.find(row=>row.comment==='AP-FEEDBACK-SMOKE: 홈 선택 버튼의 여백 확인');
    if(annotation)break;await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(annotation,'actual browser annotation reaches HTTP');sessionId=annotation.sessionId;
  assert.equal(annotation.url,origin+'/');assert.ok(annotation.elementPath.includes('home.choose-pet'));
  assert.equal(ownerForAnnotation(annotation),'home');
  report.checks.push('browser toolbar -> exact local HTTP annotation with scope and page');
  assert.equal(await page.evaluate(()=>window.__feedbackCopies),0);
  await page.reload();await page.locator('agentation-toolbar').waitFor({state:'attached'});
  await page.waitForFunction(()=>[...Object.keys(localStorage)].some(key=>String(localStorage.getItem(key)).includes('AP-FEEDBACK-SMOKE')));
  await page.getByRole('button',{name:'Start feedback mode',exact:true}).click();
  await page.locator('[data-annotation-marker]').waitFor();
  report.checks.push('annotation survives browser reload');
  client=new Client({name:'autopets-feedback-verifier',version:'1.0.0'},{capabilities:{}});
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./feedback-mcp.mjs',import.meta.url))],
    env:{...process.env,AUTOPETS_FEEDBACK_URL:endpoint},stderr:'pipe'});
  await client.connect(transport);
  const tools=await client.listTools();assert.ok(tools.tools.some(tool=>tool.name==='agentation_get_all_pending'));
  const pending=await client.callTool({name:'agentation_get_all_pending',arguments:{}});
  const text=JSON.stringify(pending);assert.ok(text.includes(annotation.id)&&text.includes(annotation.comment)&&text.includes(origin));
  report.checks.push('configured STDIO wrapper -> real MCP tool reads the same annotation');
  await client.callTool({name:'agentation_acknowledge',arguments:{annotationId:annotation.id}});
  await client.callTool({name:'agentation_reply',arguments:{annotationId:annotation.id,message:'Fixture only: verified exact home scope.'}});
  await client.callTool({name:'agentation_resolve',arguments:{annotationId:annotation.id,summary:'Fixture verified; no product task executed.'}});
  const resolved=await (await fetch(`${endpoint}/annotations/${annotation.id}`)).json();
  assert.equal(resolved.status??resolved.annotation?.status,'resolved');
  await page.locator('[data-annotation-marker]').waitFor({state:'detached'});
  report.checks.push('MCP acknowledge/reply/resolve reflected in HTTP and browser marker removal');
  assert.equal(await page.evaluate(()=>window.__feedbackCopies),0);
  const addScopedNote=async(selector,comment,owner)=>{
    await page.getByRole('button',{name:'Start feedback mode',exact:true}).click();
    await page.locator(selector).first().click({position:{x:20,y:20}});
    const form=page.locator('[data-annotation-editor]').filter({visible:true});
    await form.locator('textarea').fill(comment);await form.getByRole('button',{name:/^Add$/}).click();
    let created;
    for(let attempt=0;attempt<40;attempt++){
      const value=await (await fetch(`${endpoint}/pending`)).json();created=value.annotations?.find(row=>row.comment===comment);
      if(created)break;await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(created);
    report.scopedAnnotations??=[];report.scopedAnnotations.push({owner,element:created.element,attributes:created.attributes,elementPath:created.elementPath});
    assert.equal(ownerForAnnotation(created),owner);
    const result=await client.callTool({name:'agentation_get_all_pending',arguments:{}});
    assert.ok(JSON.stringify(result).includes(created.id));
    await client.callTool({name:'agentation_resolve',arguments:{annotationId:created.id,summary:`Fixture verified: ${owner}.`}});
    await page.locator('[data-annotation-marker]').waitFor({state:'detached'});
    await page.getByRole('button',{name:'Exit',exact:true}).click();
  };
  await page.getByRole('button',{name:'Exit',exact:true}).click();
  await page.locator('.app-header nav').getByRole('button',{name:'펫 고르기',exact:true}).click();
  await addScopedNote('button[data-agent-id^="pet-selection.role."]','AP-FEEDBACK-SELECTION: 선택 카드 확인','pet-selection');
  await page.goto(origin+'/__review__/tasks');await page.locator('agentation-toolbar').waitFor({state:'attached'});
  await page.getByText('검수용 예시 · 실제 작업 실행 없음',{exact:true}).waitFor();
  await page.locator('[data-agent-scope="task-card"]').first().waitFor();
  await addScopedNote('[data-agent-id="task-card.status"]','AP-FEEDBACK-TASK: 작업 상태 카드 확인','task-card');
  report.checks.push('home, pet-selection and clearly labelled synthetic task-card feedback each reach the correct owner via MCP');
  const overlay=await browser.newPage();await overlay.goto(origin+'/?pet=0');
  assert.equal(await overlay.locator('[data-agentation-development]').count(),0);
  report.checks.push('no clipboard use; tool excluded from pet overlay');
  await page.screenshot({path:fileURLToPath(new URL('feedback-connected.png',output)),fullPage:true});
  const files=await fs.readdir(new URL('../apps/desktop/dist/assets/',import.meta.url));
  for(const file of files.filter(name=>name.endsWith('.js'))){
    const body=await fs.readFile(new URL('../apps/desktop/dist/assets/'+file,import.meta.url),'utf8');
    assert.ok(!/agentation-toolbar|data-agentation-development|__review__\/tasks/.test(body),'production excludes feedback runtime and fixtures');
  }
  assert.ok(!files.some(file=>/^(Feedback|feedbackFixture)-/.test(file)));report.checks.push('production bundle excludes Agentation and synthetic task cards');
  assert.deepEqual(report.pageErrors,[]);report.passed=true;
} catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);}
finally{
  await client?.close().catch(()=>{});await browser?.close();await vite?.close();
  if(feedback?.listening){feedback.closeAllConnections();await new Promise(resolve=>feedback.close(resolve));}
  await fs.writeFile(new URL('feedback-report.json',output),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
