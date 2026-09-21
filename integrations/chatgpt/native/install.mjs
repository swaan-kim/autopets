#!/usr/bin/env node
import { mkdir,copyFile,writeFile,access } from 'node:fs/promises';
import { resolve,dirname,isAbsolute,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export function parseArguments(argv){
 const opts={install:false,extensionId:null,node:process.execPath,connection:null,destination:null};
 for(let i=0;i<argv.length;i++){const x=argv[i];if(x==='--install')opts.install=true;else if(x==='--dry-run')opts.install=false;else if(['--extension-id','--node','--connection','--destination'].includes(x)){const value=argv[++i];if(!value||value.startsWith('--'))throw Error('argument');opts[({'--extension-id':'extensionId','--node':'node','--connection':'connection','--destination':'destination'})[x]]=value;}else throw Error('argument');}
 if(!/^[a-p]{32}$/u.test(opts.extensionId||''))throw Error('extension-id');
 opts.destination=resolve(opts.destination||join(process.env.LOCALAPPDATA||process.cwd(),'AutoPets','ChatGPTBridge'));
 opts.connection=opts.connection||join(process.env.LOCALAPPDATA||process.cwd(),'local.autopets.desktop','connection.json');
 for(const value of [opts.node,opts.destination,opts.connection])if(!isAbsolute(value)||/["%!\r\n&|<>^]/u.test(value))throw Error('unsafe-path');
 return opts;
}
export function installationPlan(opts){
 const origin='chrome-extension://'+opts.extensionId+'/',wrapper=join(opts.destination,'autopets-native.cmd');
 return{mode:opts.install?'install':'dry-run',destination:opts.destination,registryKey:'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.autopets.bridge',manifest:{name:'com.autopets.bridge',description:'AutoPets local ChatGPT connection',path:wrapper,type:'stdio',allowed_origins:[origin]},config:{version:1,allowedOrigin:origin,connectionPath:opts.connection},node:opts.node};
}
export async function install(opts){
 const plan=installationPlan(opts);if(!opts.install)return plan;
 if(process.platform!=='win32')throw Error('windows-only');await access(opts.node);await access(opts.connection);
 const files=['integrations/chatgpt/native/host.mjs','integrations/chatgpt/native/framing.mjs','integrations/chatgpt/extension/protocol.mjs','integrations/codex/skills/autopets/scripts/bridge-client.mjs'];
 for(const file of files){const dest=join(opts.destination,file);await mkdir(dirname(dest),{recursive:true});await copyFile(join(root,file),dest);}
 const host=join(opts.destination,'integrations/chatgpt/native/host.mjs');
 await writeFile(join(opts.destination,'integrations/chatgpt/native/host-config.json'),JSON.stringify(plan.config,null,2));
 await writeFile(plan.manifest.path,'@echo off\r\n"'+opts.node+'" "'+host+'" %*\r\n');
 const manifestPath=join(opts.destination,'com.autopets.bridge.json');await writeFile(manifestPath,JSON.stringify(plan.manifest,null,2));
 const result=spawnSync('reg.exe',['ADD',plan.registryKey,'/ve','/t','REG_SZ','/d',manifestPath,'/f'],{windowsHide:true,encoding:'utf8'});
 if(result.status!==0)throw Error('registry-write');return{mode:'installed',destination:opts.destination,allowedOrigin:plan.config.allowedOrigin};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){try{const result=await install(parseArguments(process.argv.slice(2)));console.log(JSON.stringify(result,null,2));}catch(error){console.error('AutoPets installation not completed: '+error.message);process.exitCode=1;}}
