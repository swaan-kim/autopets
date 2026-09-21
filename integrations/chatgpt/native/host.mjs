import { readFile,stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConnection,requestJson } from '../../codex/skills/autopets/scripts/bridge-client.mjs';
import { CAPABILITIES,validateMessage,validatePreferences,ProtocolError } from '../extension/protocol.mjs';
import { FrameDecoder,encodeFrame } from './framing.mjs';
export function validateConfig(config,origin){
 if(!config||Object.keys(config).some(k=>!['version','allowedOrigin','connectionPath'].includes(k))||config.version!==1||!/^chrome-extension:\/\/[a-p]{32}\/$/u.test(config.allowedOrigin)||config.allowedOrigin!==origin||!isAbsolute(config.connectionPath))throw new ProtocolError('origin-or-config');
 return config;
}
export async function handleMessage(message,{connectionPath,bridge=async body=>requestJson(await readConnection(connectionPath),'/v1/assistance',body,1400,16384),status=async()=>requestJson(await readConnection(connectionPath),'/v1/assistance-status',undefined,1400,16384)}){
 const m=validateMessage(message),reply=(extra)=>({version:1,id:m.id,...extra});
 if(m.type==='handshake')return reply({ok:true,host:'com.autopets.bridge',capabilities:CAPABILITIES,liveMutation:false});
 if(m.type==='status'){try{const result=await status();return reply({ok:true,connected:true,data:{preferences:validatePreferences(result.preferences),capabilities:CAPABILITIES},capabilities:CAPABILITIES});}catch{return reply({ok:false,error:'local-app-unavailable',capabilities:CAPABILITIES});}}
 const body=m.payload;
 // No browser account/submission identity has passed real verification in this release.
 if(body.operation!=='read')return reply({ok:false,error:'capability-unverified',capabilities:CAPABILITIES});
 try{const result=await bridge(body);return reply({ok:true,connected:true,data:{preferences:validatePreferences(result.preferences),task:result.task??null,capabilities:CAPABILITIES},capabilities:CAPABILITIES});}
 catch{return reply({ok:false,error:'local-app-unavailable',capabilities:CAPABILITIES});}
}
export async function runHost({input,output,origin,config,bridge,status}){
 validateConfig(config,origin);const seen=new Set();let queue=Promise.resolve(),failed=false;
 const decoder=new FrameDecoder(message=>{if(seen.size>=512)throw new ProtocolError('session-limit');const m=validateMessage(message);if(seen.has(m.id))throw new ProtocolError('duplicate-message');seen.add(m.id);queue=queue.then(async()=>{if(failed)return;let result;try{result=await handleMessage(m,{connectionPath:config.connectionPath,bridge,status});}catch{result={version:1,id:m.id,ok:false,error:'invalid-message'};}output.write(encodeFrame(result));});});
 try{for await(const chunk of input)decoder.push(Buffer.from(chunk));decoder.end();await queue;}catch(error){failed=true;await queue;throw error;}
}
async function main(){
 const configFile=new URL('./host-config.json',import.meta.url);if((await stat(configFile)).size>4096)throw new ProtocolError('config-size');
 const config=JSON.parse(await readFile(configFile,'utf8'));await runHost({input:process.stdin,output:process.stdout,origin:process.argv[2],config});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])main().catch(()=>{process.stderr.write('AutoPets native connection unavailable.\n');process.exitCode=1;});
