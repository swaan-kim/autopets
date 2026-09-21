import {readFile,writeFile,readdir,mkdir,stat} from 'node:fs/promises';
import {dirname,join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=b=>{let n=0xffffffff;for(const x of b)n=table[(n^x)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
export function makeZip(files){
 const chunks=[],entries=[];let offset=0;
 for(const {name,data} of files){if(!name||name.includes('..')||name.includes('\\')||name.startsWith('/'))throw Error('zip-path');const n=Buffer.from(name),b=Buffer.from(data),sum=crc(b),h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(33,12);h.writeUInt32LE(sum,14);h.writeUInt32LE(b.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(n.length,26);chunks.push(h,n,b);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(sum,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);entries.push(c,n);offset+=h.length+n.length+b.length;}
 const central=Buffer.concat(entries),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,central,end]);
}
async function list(directory,prefix=''){const out=[];for(const entry of(await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(entry.isSymbolicLink())throw Error('symlink');const name=prefix+entry.name;if(entry.isDirectory())out.push(...await list(join(directory,entry.name),name+'/'));else if(/\.(?:mjs|js|json|html|css)$/u.test(entry.name))out.push({name,data:await readFile(join(directory,entry.name))});}return out;}
export async function packageChatGPT({out=join(root,'release/chatgpt'),node=null,nodeLicense=null}={}){
 const extension=await list(join(root,'integrations/chatgpt/extension'));
 const manifest=JSON.parse(extension.find(f=>f.name==='manifest.json').data);if(manifest.host_permissions?.length||JSON.stringify(manifest.optional_host_permissions)!==JSON.stringify(['https://chatgpt.com/*']))throw Error('manifest-permissions');
 // Shared deterministic policy is copied only when available, never fetched at runtime.
 const runtimeFiles={guidance:['index.mjs','recipes.mjs','injection.mjs','routing.mjs','quality.mjs','workflow.mjs'],contracts:['index.mjs','constants.mjs','validation.mjs','identity.mjs','context.mjs','preferences.mjs','workflow.mjs']};
 for(const[part,files]of Object.entries(runtimeFiles))for(const name of files)extension.push({name:'vendor/'+part+'/'+name,data:await readFile(join(root,'packages',part,name))});
 const companion=[];
 for(const name of ['integrations/chatgpt/native/host.mjs','integrations/chatgpt/native/framing.mjs','integrations/chatgpt/native/install.mjs','integrations/chatgpt/extension/protocol.mjs','integrations/codex/skills/autopets/scripts/bridge-client.mjs','integrations/chatgpt/README.md'])companion.push({name,data:await readFile(join(root,name))});
 if(node){if(!nodeLicense)throw Error('--node-license is required when bundling a Node executable');companion.push({name:'runtime/node.exe',data:await readFile(resolve(node))},{name:'runtime/NODE-LICENSE.txt',data:await readFile(resolve(nodeLicense))});}
 companion.push({name:'install-chatgpt.cmd',data:Buffer.from('@echo off\r\n'+(node?'"%~dp0runtime\\node.exe"':'node')+' "%~dp0integrations\\chatgpt\\native\\install.mjs" %*\r\n')});
 const audit={version:1,connectionVerified:false,installed:false,liveMutation:false,nodeBundled:!!node,extensionFiles:extension.map(f=>f.name),companionFiles:companion.map(f=>f.name)};
 await mkdir(out,{recursive:true});const bundles=[['AutoPets-chatgpt-extension.zip',makeZip(extension)],['AutoPets-chatgpt-companion.zip',makeZip(companion)]];
 for(const[name,data]of bundles)await writeFile(join(out,name),data);
 await writeFile(join(out,'SHA256SUMS.txt'),bundles.map(([name,data])=>createHash('sha256').update(data).digest('hex')+'  '+name).join('\n')+'\n');
 await writeFile(join(out,'package-status.json'),JSON.stringify(audit,null,2));return{out,...audit};
}
export async function runCli(){
 const options={};try{for(let i=2;i<process.argv.length;i++){const key=process.argv[i],value=process.argv[++i];if(!['--out','--node','--node-license'].includes(key)||!value)throw Error('arguments');options[({'--out':'out','--node':'node','--node-license':'nodeLicense'})[key]]=resolve(value);}console.log(JSON.stringify(await packageChatGPT(options),null,2));}catch(error){console.error('ChatGPT package failed: '+error.message);process.exitCode=1;}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))await runCli();
