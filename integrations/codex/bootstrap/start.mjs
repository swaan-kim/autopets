import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { digest, homeFor, inside, readJson, atomicJson, regular, safeDirectory, lock } from './files.mjs';
import { configureConnection } from './connection.mjs';
import { readConnection, requestJson } from '../skills/autopets/scripts/bridge-client.mjs';

export async function verifyPackage(directory) {
  const realRoot = await fs.realpath(directory);
  const manifest = await readJson(path.join(directory, 'manifest.json'));
  if (manifest.version !== 1 || !/^\d+\.\d+\.\d+$/u.test(manifest.appVersion) || !Array.isArray(manifest.files) || manifest.files.length > 1000) throw Error('package-format');
  const names = new Set();
  for (const file of manifest.files) {
    const target = inside(directory, file.path);
    if (names.has(file.path.toLowerCase()) || !/^[a-f0-9]{64}$/u.test(file.sha256)) throw Error('package-format');
    names.add(file.path.toLowerCase());
    await regular(target);
    if ((await fs.realpath(target)).toLowerCase() !== path.join(realRoot, ...file.path.split('/')).toLowerCase()) throw Error('package-link');
    if (digest(await fs.readFile(target)) !== file.sha256) throw Error('package-integrity');
  }
  for (const needed of ['runtime/node.exe', 'runtime/LICENSE', 'integrations/codex/bootstrap/start.mjs', 'integrations/codex/bootstrap/user-hook.mjs', manifest.installer]) {
    if (typeof needed !== 'string' || !names.has(needed.toLowerCase())) throw Error('package-incomplete');
  }
  return manifest;
}
function childExit(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error(code === 1 ? 'installation-cancelled' : 'installation-failed')));
  });
}
export const systemDriver = {
  discover: async () => new Promise((resolve, reject) => {
    // Query only this product's current-user uninstall entries. Never execute a
    // registry command string or modify registry/PATH/security policy.
    const script = `$items = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AutoPets','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\local.autopets.desktop') | ForEach-Object { Get-ItemProperty -LiteralPath $_ -ErrorAction SilentlyContinue }; $items | Where-Object { $_.DisplayName -eq 'AutoPets' -and $_.InstallLocation } | Select-Object -First 1 @{n='directory';e={$_.InstallLocation}}, @{n='version';e={$_.DisplayVersion}} | ConvertTo-Json -Compress`;
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = []; child.stdout.on('data', data => chunks.push(data));
    child.on('error', reject); child.on('exit', () => { try { const text = Buffer.concat(chunks).toString('utf8').trim(); resolve(text ? JSON.parse(text) : null); } catch { reject(Error('existing-installation-review')); } });
  }),
  install: async (installer, destination) => childExit(installer, ['/S', `/D=${destination}`]),
  launch: async executable => new Promise((resolve, reject) => {
    const child = spawn(executable, [], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  }),
  bridge: async (connectionPath, version) => {
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      try {
        const connection = await readConnection(connectionPath);
        const state = await requestJson(connection, '/v1/setup');
        if (state.version !== 1 || state.installedVersion !== version) throw Error('app-version-mismatch');
        return { state, begin: input => requestJson(connection, '/v1/setup', input) };
      } catch (error) { if (error.message === 'app-version-mismatch') throw error; await delay(250); }
    }
    throw Error('app-unavailable');
  },
};
async function installSkill(root, manifest, env) {
  const codex = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const directory = path.join(codex, 'skills/autopets');
  await safeDirectory(path.dirname(directory));
  const file = path.join(directory, 'SKILL.md');
  const marker = '<!-- autopets-bootstrap-v1 -->';
  try { await regular(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const existing = await fs.readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (existing !== null && (!existing.includes(marker) || manifest.skillPath !== file || manifest.skillDigest !== digest(Buffer.from(existing)))) return { conflict: true, path: null };
  await safeDirectory(directory);
  const node = path.join(root, 'connector/runtime/node.exe'), script = path.join(root, 'connector/integrations/codex/bootstrap/start.mjs');
  const text = `---\nname: autopets\ndescription: AutoPets를 켜거나 현재 Codex 작업에 펫을 연결할 때 사용한다. 설치 확인, 실행, 연결 복구를 한 번에 처리한다.\n---\n${marker}\n# AutoPets 켜기\n\n사용자가 켜 달라고 요청하면 현재 작업 디렉터리와 CODEX_THREAD_ID를 유지하고 아래 실행 파일과 인수를 구조화해서 실행한다.\n\n실행 파일: ${JSON.stringify(node)}\n인수: ${JSON.stringify([script])}\n\n처음 결과가 connecting이면 앱은 실행됐지만 채팅 연결은 대기 중이라고 설명한다. 필요한 Codex 훅 신뢰 확인만 안내한다. trust나 실행 정책을 우회하지 않는다. 상태·모델·절감 효과를 추정하지 않는다. 같은 설정을 다시 묻지 않는다. 자동 도움·보호의 실제 검증 상태를 그대로 전달한다. --disconnect는 사용자가 연결 해제를 요청했을 때만 사용하며 앱 데이터는 지우지 않는다.\n`;
  if (existing !== text) await fs.writeFile(file, text);
  return { conflict: false, path: file, sha256: digest(Buffer.from(text)) };
}
export async function start({ packageDir, root = homeFor(), env = process.env, driver = systemDriver, platform = process.platform, arch = process.arch, progress = () => {} } = {}) {
  if (platform !== 'win32' || arch !== 'x64') throw Error('windows-x64-required');
  return lock(root, async () => {
    const manifestPath = path.join(root, 'install-manifest.json');
    let installed = await readJson(manifestPath).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (installed && (installed.version !== 1 || installed.owner !== 'autopets')) throw Error('installation-conflict');
    const supplied = packageDir ? await verifyPackage(packageDir) : null;
    let updateAvailable = null;
    if (installed && supplied && installed.installedVersion !== supplied.appVersion) {
      // Never replace a running installation implicitly; use its registered runner.
      updateAvailable = supplied.appVersion;
    }
    progress('installing');
    const found = !installed && driver.discover ? await driver.discover() : null;
    if (found && (!path.isAbsolute(found.directory || '') || !supplied || found.version !== supplied.appVersion)) throw Error('existing-installation-review');
    const appDir = installed?.appDirectory || found?.directory || path.join(root, 'app'), executable = path.join(appDir, 'AutoPets.exe');
    const intact = installed && await Promise.all(installed.ownedFiles.map(async item => {
      const file = inside(root, item.path); await regular(file); return digest(await fs.readFile(file)) === item.sha256;
    })).then(async values => values.every(Boolean) && digest(await fs.readFile(executable)) === installed.appDigest).catch(() => false);
    if (!intact) {
      if (!supplied || (installed && supplied.appVersion !== installed.installedVersion)) throw Error('matching-package-required');
      // Check native installer before copying any runtime helpers.
      await safeDirectory(appDir);
      const appIntact = installed?.appDigest && await fs.readFile(executable).then(data => digest(data) === installed.appDigest).catch(() => false);
      // Adopt a same-version installation only after its new setup API responds.
      if (found) {
        await driver.launch(executable);
        const connection = env.AUTOPETS_CONNECTION_FILE || path.join(env.AUTOPETS_DATA_DIR || path.join(env.LOCALAPPDATA, 'local.autopets.desktop'), 'connection.json');
        await driver.bridge(connection, supplied.appVersion);
      } else if (!appIntact) await driver.install(inside(packageDir, supplied.installer), appDir);
      await regular(executable);
      const ownedFiles = [];
      for (const item of supplied.files.filter(item => !item.path.startsWith('app/') && item.path !== 'install.ps1')) {
        const destination = inside(root, `connector/${item.path}`);
        await safeDirectory(path.dirname(destination));
        try { await regular(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (await fs.readFile(destination).then(data => digest(data) !== item.sha256).catch(() => true)) await fs.copyFile(inside(packageDir, item.path), destination);
        ownedFiles.push({ path: `connector/${item.path}`, sha256: item.sha256 });
      }
      installed = { ...installed, version: 1, owner: 'autopets', installedVersion: supplied.appVersion, packageDigest: digest(await fs.readFile(path.join(packageDir, 'manifest.json'))),
        appDirectory: appDir, appDigest: digest(await fs.readFile(executable)),
        completedSteps: ['app', 'runtime'], ownedFiles, hookIds: installed?.hookIds || [], skillPath: installed?.skillPath || null, updatedAt: Date.now() };
      await atomicJson(manifestPath, installed);
    }
    const skill = await installSkill(root, installed, env);
    installed.skillPath = skill.path;
    if (skill.path) installed.skillDigest = skill.sha256;
    installed.hookIds = await configureConnection(root, installed, { env });
    installed.completedSteps = ['app', 'runtime', ...(skill.path ? ['skill'] : []), 'hooks-configured'];
    installed.updatedAt = Date.now();
    await atomicJson(manifestPath, installed);
    progress('connecting');
    await driver.launch(executable);
    const connection = env.AUTOPETS_CONNECTION_FILE || path.join(env.AUTOPETS_DATA_DIR || path.join(env.LOCALAPPDATA, 'local.autopets.desktop'), 'connection.json');
    const bridge = await driver.bridge(connection, installed.installedVersion);
    const sessionId = env.CODEX_THREAD_ID || null;
    const state = await bridge.begin({ installedVersion: installed.installedVersion, sessionId, cwd: sessionId ? process.cwd() : null });
    return { ok: true, ...state, skillConflict: skill.conflict, updateAvailable, publicOneCallVerified: false };
  });
}
export async function disconnect({ root = homeFor(), env = process.env } = {}) {
  return lock(root, async () => {
    const file = path.join(root, 'install-manifest.json'), manifest = await readJson(file);
    if (manifest.owner !== 'autopets') throw Error('installation-conflict');
    manifest.hookIds = await configureConnection(root, manifest, { remove: true, env });
    if (manifest.skillPath && manifest.skillDigest) {
      const content = await fs.readFile(manifest.skillPath).catch(() => null);
      if (content && digest(content) === manifest.skillDigest) await fs.unlink(manifest.skillPath);
    }
    manifest.skillPath = null; manifest.completedSteps = manifest.completedSteps.filter(step => !['skill', 'hooks-configured'].includes(step));
    await atomicJson(file, manifest);
    return { ok: true, disconnected: true, recordsDeleted: false };
  });
}
const messages = {
  'setup-in-progress': '설치가 이미 진행 중이에요. 완료 후 다시 불러주세요.',
  'windows-x64-required': 'Windows x64의 로컬 Codex에서 시작해주세요.',
  'matching-package-required': '설치된 버전의 패키지로 다시 시작해 복구해주세요.',
  'app-unavailable': '앱 연결을 확인하지 못했어요. Windows 실행 허용 상태를 확인하고 다시 불러주세요.',
  'app-version-mismatch': '다른 버전의 앱이 실행 중이에요. AutoPets를 종료하고 다시 불러주세요.',
  'installation-cancelled': '설치가 취소됐어요. 다시 불러 이어서 진행할 수 있어요.',
  'existing-installation-review': '기존 AutoPets 버전을 확인해주세요. 기존 설치를 자동으로 바꾸지 않았어요.',
};
async function main() {
  try {
    const args = process.argv.slice(2);
    if (args[0] === '--disconnect' && args.length === 1) return console.log(JSON.stringify(await disconnect()));
    if (args.length && (args.length !== 2 || args[0] !== '--package' || !path.isAbsolute(args[1]))) throw Error('arguments');
    console.log(JSON.stringify(await start({ packageDir: args[1], progress: phase => console.error(phase === 'installing' ? '설치 확인 중' : '연결 확인 중') })));
  } catch (error) { console.log(JSON.stringify({ ok: false, phase: 'attention', retryable: true, message: messages[error.message] || '설치를 완료하지 못했어요. 원래 채팅은 계속 사용할 수 있어요.' })); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
