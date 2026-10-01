#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPinnedSkill } from '../../../runtime/pet-skills.mjs';

export async function readSkillArgs(args) {
  if (args.length !== 4 || args[0] !== '--id' || args[2] !== '--version') throw Error('invalid-skill-read-arguments');
  return readPinnedSkill(args[1], args[3]);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await readSkillArgs(process.argv.slice(2)))); }
  catch (error) { console.log(JSON.stringify({ ok: false, code: /^[a-z-]+$/u.test(error.message) ? error.message : 'skill-read-unavailable' })); process.exitCode = 1; }
}
