import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {makeZip} from './package-chatgpt.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const names=execFileSync('git',['ls-files','-z','--','hooks','skills','scripts','integrations','packages','docs'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const files=[];
for(const name of names){if(/(?:^|\/)(?:node_modules|\.local|work|release)(?:\/|$)/.test(name)||/\.(?:sqlite3|log)$/.test(name)||path.basename(name)==='connection.json')throw Error('Private or generated path in tracked companion: '+name);const file=path.join(root,name);if((await fs.lstat(file)).isSymbolicLink())throw Error('Symlink in companion: '+name);files.push({name,data:await fs.readFile(file)});}
const destination=path.join(root,'release','AutoPets-companion.zip');await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,makeZip(files));console.log(destination);
