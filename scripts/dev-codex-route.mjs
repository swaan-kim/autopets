// Development-only route: make Codex \`$autopets\` open the SOURCE dev app instead of
// the installed release. The installed connector's start.mjs always launches the
// exe beside its `connector` folder and talks to the installed app's data, so a
// Codex-invoked pet would otherwise show the older installed UI.
//
//   node scripts/dev-codex-route.mjs install [--data-dir <abs>] [--launcher <abs .cmd>]
//   node scripts/dev-codex-route.mjs restore
//   node scripts/dev-codex-route.mjs start   [--data-dir <abs>] [--launcher <abs .cmd>]   (run by the skill)
//
// `install` backs up the current ~/.codex/skills/autopets/SKILL.md under .local/ and
// writes a dev skill. `restore` puts the backup back. `start` mirrors the app-facing
// part of connectInstalled(): reuse/open the app, then POST /v1/setup with the
// current CODEX_THREAD_ID and folder. It installs no files and changes no hooks.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readConnection, requestJson } from '../integrations/codex/skills/autopets/scripts/bridge-client.mjs';

export const MARKER = '<!-- autopets-dev-route-v1 -->';
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

export function devPaths({ repo = repoRoot, dataDir, launcher, env = process.env } = {}) {
  const local = path.join(repo, '.local');
  return {
    repo, script: fileURLToPath(import.meta.url),
    dataDir: path.resolve(dataDir || path.join(local, 'dev-data')),
    launcher: launcher ? path.resolve(launcher) : null,
    devExe: path.join(repo, 'apps/desktop/src-tauri/target/debug/autopets.exe'),
    reference: path.join(repo, 'integrations/codex/skills/autopets/references/explicit-pet.md'),
    petScript: path.join(repo, 'integrations/codex/skills/autopets/scripts/pet.mjs'),
    skillFile: path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills/autopets/SKILL.md'),
    backupFile: path.join(local, 'codex-dev-route/installed-autopets-SKILL.md'),
  };
}

export function renderSkill({ node, script, dataDir, launcher, reference, petScript }) {
  const connection = path.join(dataDir, 'connection.json');
  const args = [script, 'start', '--data-dir', dataDir, ...(launcher ? ['--launcher', launcher] : [])];
  return `---
name: autopets
description: AutoPets 강아지 펫을 화면에 띄우고(/오토펫, /autopets, $autopets), 현재 Codex 작업에 제작·UI 제작 펫을 연결하고, 저장한 펫 적용과 펫 작업, 현재 계획의 후속 구현, 상태 확인을 요청할 때 사용한다.
---
${MARKER}
# AutoPets (소스 개발 앱)

개발용 스킬이다. 설치된 AutoPets 앱이나 그 connector의 start.mjs를 실행하지 않고, 소스 개발 앱(데이터 ${JSON.stringify(dataDir)})을 연다. 원래 스킬은 \`node scripts/dev-codex-route.mjs restore\`로 되돌린다.

“제작 펫 연결”, “UI 제작 펫 연결”, petId·petRevision을 지정한 저장 펫 시작 요청, “제작 펫으로 작업”, “펫 상태 확인” 또는 현재 펫 계획의 명시적 후속 구현 요청이면 다음 안내 파일을 읽고 그 절차를 따른다. 현재 작업 ID와 폴더를 유지한다. 연결 성공과 실제 모델 적용·자동 훅 수신을 구분한다.

펫 작업 안내: ${JSON.stringify(reference)}

그 안내의 pet.mjs는 ${JSON.stringify(petScript)}이고 Node는 ${JSON.stringify(node)}를 쓴다. 모든 pet.mjs 호출에 \`--connection ${JSON.stringify(connection)}\`을 붙인다. 이 인수를 빼면 설치된 앱이 열리므로 생략하지 않는다.

사용자가 다른 요청 없이 이 스킬만 불렀거나(\`/오토펫\`, \`/autopets\`, \`$autopets\`), 켜 달라·불러 달라·띄워 달라·보여 달라고 하면 **다른 말이나 확인 질문을 하기 전에 가장 먼저** 현재 작업 디렉터리와 CODEX_THREAD_ID를 유지하고 아래 실행 파일과 인수를 구조화해서 실행한다.

실행 파일: ${JSON.stringify(node)}
인수: ${JSON.stringify(args)}

실행 중인 개발 앱이 있으면 그 앱의 강아지 펫을 바로 보여 주고(숨김·가장자리 숨김도 다시 꺼냄, 관리 화면은 열지 않음), 없으면 지정한 개발 실행기를 켜고 준비되는 즉시 펫을 보여 준다. 그다음 이 채팅을 연결한다. 결과의 target은 source-dev-app이어야 하고 \`pets\`가 \`show-requested\`이면 펫 표시를 요청한 것이다. 처음 결과가 connecting이면 펫은 떠 있고 채팅 연결은 대기 중이라고 설명한다. 명시적 펫 연결에는 훅 허용이 필요하지 않다. 새 스킬이 발견되지 않을 때만 작업 종료 후 Codex 재시작을 안내한다. trust나 실행 정책을 우회하지 않는다. 상태·모델·절감 효과를 추정하지 않는다. 같은 설정을 다시 묻지 않는다. 자동 도움·보호의 실제 검증 상태를 그대로 전달한다. 실패하면 결과의 message를 그대로 전하고 설치된 앱으로 대신 열지 않는다.
`;
}

export const AGENT_FILE = 'agents/openai.yaml';
export function renderAgent() {
  return `# ${MARKER}
interface:
  display_name: "오토펫 · AutoPets"
  short_description: "AutoPets 강아지 펫을 바로 띄우고 이 채팅과 연결합니다 (소스 개발 앱)"
  default_prompt: "AutoPets 강아지 펫을 화면에 띄워줘."
`;
}

const read = file => fs.readFile(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
const isDevRoute = data => data !== null && data.toString('utf8').includes(MARKER);

export async function install({ paths = devPaths(), node = process.execPath } = {}) {
  if (paths.launcher && !/\.(cmd|bat)$/iu.test(paths.launcher)) throw Error('launcher-must-be-cmd');
  const current = await read(paths.skillFile), backup = await read(paths.backupFile);
  let backedUp = false;
  if (current !== null && !isDevRoute(current)) {
    // Never replace a different saved original; the user must decide which one to keep.
    if (backup !== null && !backup.equals(current)) throw Error('backup-conflict');
    if (backup === null) { await fs.mkdir(path.dirname(paths.backupFile), { recursive: true }); await fs.writeFile(paths.backupFile, current); backedUp = true; }
  }
  await fs.mkdir(path.dirname(paths.skillFile), { recursive: true });
  await fs.writeFile(paths.skillFile, renderSkill({ node, ...paths }));
  const agent = path.join(path.dirname(paths.skillFile), AGENT_FILE);
  const existingAgent = await read(agent);
  // Only our own picker entry is written; a different one is left untouched.
  if (existingAgent === null || isDevRoute(existingAgent)) { await fs.mkdir(path.dirname(agent), { recursive: true }); await fs.writeFile(agent, renderAgent()); }
  return { ok: true, skill: paths.skillFile, backup: (backedUp || backup !== null) ? paths.backupFile : null, dataDir: paths.dataDir, launcher: paths.launcher };
}

export async function restore({ paths = devPaths() } = {}) {
  const current = await read(paths.skillFile), backup = await read(paths.backupFile);
  if (backup === null) throw Error('backup-missing');
  if (current !== null && !isDevRoute(current)) throw Error('skill-not-dev-route');
  await fs.writeFile(paths.skillFile, backup);
  const agent = path.join(path.dirname(paths.skillFile), AGENT_FILE);
  if (isDevRoute(await read(agent))) await fs.rm(agent, { force: true });
  return { ok: true, skill: paths.skillFile, restoredFrom: paths.backupFile };
}

export const systemDriver = {
  readSetup: async connectionPath => {
    try { const connection = await readConnection(connectionPath); return { connection, state: await requestJson(connection, '/v1/setup', undefined, 1400, 32768) }; }
    catch { return null; }
  },
  post: (connection, body) => requestJson(connection, '/v1/setup', body, 1400, 32768),
  exists: file => fs.access(file).then(() => true, () => false),
  launch: (command, args, options) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, ...options });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  }),
  sleep: ms => delay(ms),
  now: () => Date.now(),
};

export async function startDev({ paths = devPaths(), env = process.env, cwd = process.cwd(), driver = systemDriver, waitMs = 240000 } = {}) {
  const connectionPath = path.join(paths.dataDir, 'connection.json');
  const appEnv = { ...env, AUTOPETS_DATA_DIR: paths.dataDir };
  const started = driver.now();
  const sessionId = env.CODEX_THREAD_ID || null;
  let live = await driver.readSetup(connectionPath), launch;
  if (live) launch = 'reused-running-dev-app';
  else {
    if (!paths.launcher || !(await driver.exists(paths.launcher))) throw Error('dev-app-unavailable');
    launch = 'started-dev-launcher';
    await driver.launch('cmd.exe', ['/c', 'start', '"AutoPets Dev"', '/min', `"${paths.launcher}"`], { env: appEnv, cwd: paths.repo, windowsVerbatimArguments: true });
    const until = driver.now() + waitMs;
    // The app writes its connection file once its bridge listens; the pets are shown right after.
    while (!live && driver.now() < until) { await driver.sleep(250); live = await driver.readSetup(connectionPath); }
    if (!live) throw Error('dev-app-unavailable');
  }
  const { connection, state } = live;
  if (state?.version !== 1 || state?.appReady !== true) throw Error('dev-app-unavailable');
  const appReadyMs = driver.now() - started;
  // 1) Show the dog pets now: a second launch with `--show-pets` reaches the running app's
  //    single-instance handler, which shows hidden pets, restores docked ones and neither
  //    opens nor focuses the manager. 2) Then connect the calling chat. The pet says
  //    "Codex 연결 중" in between, so showing it never waits for the chat connection.
  let pets = 'dev-exe-missing';
  if (await driver.exists(paths.devExe)) {
    const chat = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(sessionId ?? '') ? ['--chat', sessionId] : [];
    await driver.launch(paths.devExe, ['--show-pets', ...chat], { env: appEnv });
    pets = 'show-requested';
  }
  const petsRequestedMs = driver.now() - started;
  const result = await driver.post(connection, { installedVersion: state.installedVersion, sessionId, cwd: sessionId ? cwd : null,
    hostId: 'codex-windows-local', entryPoint: 'ai', connectionMode: 'explicit-pet' });
  return { ok: true, ...result, target: 'source-dev-app', launch, pets, connection: connectionPath, publicOneCallVerified: false,
    timings: { appReadyMs, petsRequestedMs, chatConnectedMs: driver.now() - started } };
}

export function parseArgs(argv) {
  const [command, ...rest] = argv, options = {};
  if (!['install', 'restore', 'start'].includes(command)) throw Error('arguments');
  for (let i = 0; i < rest.length; i += 2) {
    const key = { '--data-dir': 'dataDir', '--launcher': 'launcher' }[rest[i]];
    if (!key || command === 'restore' || typeof rest[i + 1] !== 'string' || !path.isAbsolute(rest[i + 1])) throw Error('arguments');
    options[key] = rest[i + 1];
  }
  return { command, options };
}

const messages = {
  'dev-app-unavailable': '개발 앱에 연결하지 못했어요. 개발 앱을 켠 뒤 다시 불러주세요.',
  'backup-conflict': '이미 다른 원래 스킬 백업이 있어요. 어떤 파일을 보관할지 확인해주세요.',
  'backup-missing': '되돌릴 원래 스킬 백업이 없어요.',
  'skill-not-dev-route': '현재 스킬이 개발용 스킬이 아니어서 덮어쓰지 않았어요.',
  'launcher-must-be-cmd': '개발 실행기는 .cmd 또는 .bat 파일이어야 해요.',
  arguments: '사용법: dev-codex-route.mjs install|restore|start [--data-dir <절대경로>] [--launcher <절대경로 .cmd>]',
};

async function main() {
  try {
    const { command, options } = parseArgs(process.argv.slice(2));
    const paths = devPaths(options);
    const result = command === 'install' ? await install({ paths }) : command === 'restore' ? await restore({ paths }) : await startDev({ paths });
    console.log(JSON.stringify(result));
  } catch (error) {
    const code = Object.hasOwn(messages, error.message) ? error.message : 'dev-route-failed';
    console.log(JSON.stringify({ ok: false, target: 'source-dev-app', code, message: messages[code] || '개발 앱 연결을 완료하지 못했어요.' }));
    process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
