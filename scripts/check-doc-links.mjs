import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
async function markdown(dir){const out=[];for(const item of await fs.readdir(path.join(root,dir),{withFileTypes:true})){if(['node_modules','.git','target'].includes(item.name))continue;const name=path.join(dir,item.name);if(item.isDirectory())out.push(...await markdown(name));else if(item.name.endsWith('.md'))out.push(name);}return out;}
const files=['README.md','AGENTS.md',...await markdown('docs'),...await markdown('integrations')], errors=[];
for(const file of files){const text=(await fs.readFile(path.join(root,file),'utf8')).replace(/```[\s\S]*?```/g,'');for(const match of text.matchAll(/\]\(([^)]+)\)/g)){let href=match[1].replace(/^<|>$/g,'').split(/\s+["']/)[0];if(/^(?:[a-z]+:|#|\/)/i.test(href))continue;href=href.split('#')[0].split('?')[0];if(!href)continue;try{await fs.access(path.resolve(root,path.dirname(file),decodeURIComponent(href)));}catch{errors.push(file+': '+href);}}}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Relative document links verified: '+files.length+' Markdown files.');
