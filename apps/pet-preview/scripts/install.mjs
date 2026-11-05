// Installs (or removes) the experimental `autopet` Codex skill for this user.
//
//   node apps/pet-preview/scripts/install.mjs              install / update
//   node apps/pet-preview/scripts/install.mjs --uninstall  remove
//
// Writes only to <CODEX_HOME or ~/.codex>/skills/autopet/. The existing
// `autopets` skill, AutoPets app, hooks and data are not touched.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const previewRoot = path.resolve(here, '..');
const sourceSkill = path.join(previewRoot, 'codex-skill', 'autopet');
const builtExe = path.join(previewRoot, 'src-tauri', 'target', 'release', 'autopet-preview.exe');
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const target = path.join(codexHome, 'skills', 'autopet');
const marker = path.join(target, '.autopet-preview-install');
const installedExe = path.join(target, 'bin', 'autopet-preview.exe');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function closeRunningPet() {
  if (fs.existsSync(installedExe)) spawnSync(installedExe, ['quit'], { stdio: 'ignore', windowsHide: true, timeout: 15000 });
}

if (fs.existsSync(target) && !fs.existsSync(marker)) {
  fail(`${target} already exists and was not created by this installer; leaving it unchanged.`);
}

if (process.argv.includes('--uninstall')) {
  closeRunningPet();
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`Removed ${target}`);
  process.exit(0);
}

if (!fs.existsSync(builtExe)) {
  fail(`Missing ${builtExe}\nBuild first: cargo build --release --manifest-path apps/pet-preview/src-tauri/Cargo.toml`);
}

closeRunningPet();
fs.mkdirSync(path.join(target, 'bin'), { recursive: true });
fs.cpSync(sourceSkill, target, { recursive: true });
fs.copyFileSync(builtExe, installedExe);
fs.writeFileSync(marker, `Installed from ${previewRoot}\n`);
console.log(`Installed Codex skill "autopet" to ${target}`);
console.log('Start a new Codex chat and type /오토펫 (or /autopet, $autopet).');
