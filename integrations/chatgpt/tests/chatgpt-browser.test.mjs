import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {CAPABILITIES,HOST_NAME,isChatGPTUrl,chatFromUrl} from '../extension/protocol.mjs';
const directory=new URL('../extension/',import.meta.url);
async function worker({enabled=true,permission=true}={}){
 let listener;const calls=[],event=()=>({addListener(){}}),chrome={runtime:{id:'a'.repeat(32),getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p,onMessage:{addListener(fn){listener=fn;}},onStartup:event(),sendNativeMessage:async(host,body)=>{calls.push({host,body});return{ok:true,connected:true};}},storage:{local:{get:async()=>({connectorEnabled:enabled}),set:async()=>{}}},permissions:{contains:async()=>permission,onRemoved:event()},tabs:{onRemoved:event()}};
 const source=(await readFile(new URL('service-worker.js',directory),'utf8')).replace(/^import [^\r\n]*;\r?\n/,'');
 vm.runInNewContext(source,{chrome,CAPABILITIES,HOST_NAME,isChatGPTUrl,chatFromUrl,crypto:webcrypto,URL,Map,Object,Promise});
 return{calls,send:(message,sender)=>new Promise(resolve=>listener(message,sender,resolve))};
}
const sender={id:'a'.repeat(32),frameId:0,documentId:'document-1',url:'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc',tab:{id:1}};
test('extension asks only optional chatgpt.com and no global host or active-tab access',async()=>{const m=JSON.parse(await readFile(new URL('manifest.json',directory)));assert.deepEqual(m.optional_host_permissions,['https://chatgpt.com/*']);assert.equal(m.host_permissions,undefined);assert.equal(m.content_scripts,undefined);assert.deepEqual(m.permissions,['nativeMessaging','storage','scripting']);});
test('untrusted origin, subframe, missing document and extra payload cannot reach native',async()=>{const w=await worker();for(const s of [{...sender,url:'https://chatgpt.com.evil.test/'},{...sender,frameId:2},{...sender,documentId:undefined},{...sender,id:'other'}])assert.equal((await w.send({kind:'document-status'},s)).ok,false);assert.equal((await w.send({kind:'document-status',rawPrompt:'private'},sender)).ok,false);assert.equal(w.calls.length,0);});
test('opt-out and missing permission do not call native',async()=>{for(const setting of [{enabled:false},{permission:false}]){const w=await worker(setting);assert.equal((await w.send({kind:'document-status'},sender)).ok,false);assert.equal(w.calls.length,0);}});
test('every document status omits task identity and remains unverified',async()=>{const w=await worker();const a=await w.send({kind:'document-status'},sender);await w.send({kind:'document-status'},{...sender,documentId:'document-2'});await w.send({kind:'document-status'},{...sender,url:'https://chatgpt.com/c/22222222-2222-2222-2222-222222222222'});assert.equal(w.calls.length,3);for(const call of w.calls){assert.equal(call.body.payload,undefined);assert.equal(call.body.type,'status');assert.doesNotMatch(JSON.stringify(call.body),/accountId|chatId|document-1|22222222/);}assert.equal(a.capabilities.contextSync,false);assert.equal(a.capabilities.verification,'unverified');});
test('content script does not touch live DOM or install twice',async()=>{let listeners=0;const sandbox={chrome:{runtime:{id:'fixture',onMessage:{addListener(){listeners++;}}}}};Object.defineProperty(sandbox,'document',{get(){assert.fail('live DOM access');}});const source=await readFile(new URL('content.js',directory),'utf8');vm.runInNewContext(source,sandbox);vm.runInNewContext(source,sandbox);assert.equal(listeners,1);assert.doesNotMatch(source,/querySelector|fetch\s*\(|\.click\s*\(|localStorage|cookie/);});
