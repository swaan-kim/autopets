// End-to-end test with a REAL Codex run (`codex exec`, the model of the
// user's config) and the REAL pet. Nothing is faked: Codex reads the autopet
// skill, shows the pet, waits, receives the task, drafts outlines, asks in the
// pet, gets the answer the test clicks in the pet UI, builds the deck and
// reports with done. The pet UI is driven through CDP only (no OS input).
//
// Isolation from a pet the user may be running: use a test build with its own
// identifier and state folder name (see README "테스트 빌드").
//
//   node e2e-codex.mjs <codex.exe> <test skill folder> <scratch> <A|B> [label]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright');

const [CODEX, SKILL_DIR, S, PICK = 'B', LABEL = `run-${PICK}`] = process.argv.slice(2);
if (!CODEX || !SKILL_DIR || !S) throw new Error('usage: node e2e-codex.mjs <codex.exe> <skill dir> <scratch> <A|B> [label]');
const PORT = 9335;
const OUT = path.join(S, `e2e-${LABEL}`);
const WS = path.join(OUT, 'workspace');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(WS, { recursive: true });
// 'installed': the user's own path -- the installed skill, invoked as $autopet, with the production pet.
const INSTALLED = SKILL_DIR === 'installed';
const SKILL = INSTALLED ? path.join(process.env.CODEX_HOME || path.join(process.env.USERPROFILE, '.codex'), 'skills', 'autopet') : SKILL_DIR;
const EXE = path.join(SKILL, 'bin', 'autopet-preview.exe');
const STATE = path.join(process.env.LOCALAPPDATA, INSTALLED ? 'local.autopets.petpreview' : 'local.autopets.petpreview.hitltest');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => { const line = `[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${a.join(' ')}`; console.log(line); fs.appendFileSync(path.join(OUT, 'driver.log'), line + '\n'); };
let pass = 0, fail = 0;
const results = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; results.push({ name: n, ok: Boolean(ok), detail: String(d).slice(0, 600) }); log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + String(d).slice(0, 400) : ''}`); };
for (const event of ['unhandledRejection', 'uncaughtException']) {
  process.on(event, async (error) => { check('driver error', false, error?.stack ?? error); await finish(); });
}
const ps = (...args) => execFileSync('powershell.exe', ['-NoProfile', '-File', path.join(HERE, 'winpid.ps1'), ...args], { encoding: 'utf8' }).trim();

// The same words a user would type, pointing at the test copy of the skill.
const PROMPT = INSTALLED ? '$autopet' : `$autopet 스킬을 호출한 것과 같습니다. 이 스킬 파일 전체를 먼저 읽고 그대로 따르세요: ${path.join(SKILL_DIR, 'SKILL.md')} (스킬 폴더: ${SKILL_DIR}). 펫을 띄워줘.`;
log(`user idle ${ps('-Op', 'idle')} ms; pick ${PICK}; workspace ${WS}`);
const codex = spawn(CODEX, ['exec', '--json', '--skip-git-repo-check', '--approve-for-me', '-C', WS, '-o', path.join(OUT, 'last-message.txt'), PROMPT], {
  cwd: WS,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const events = [];
let buffer = '';
codex.stdout.on('data', (d) => {
  fs.appendFileSync(path.join(OUT, 'codex-events.jsonl'), d);
  buffer += d;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const text = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    try { events.push(JSON.parse(text)); } catch {}
  }
});
codex.stderr.on('data', (d) => fs.appendFileSync(path.join(OUT, 'codex-stderr.txt'), d));
let codexExit = null;
codex.on('exit', (code) => { codexExit = code; log(`codex exec exited ${code}`); });

let browser, page;
async function connect(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end && codexExit === null) {
    try {
      if (browser && !browser.isConnected()) browser = undefined;
      browser ??= await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
      page = browser.contexts()[0]?.pages().find((p) => p.url().startsWith('http://tauri.localhost'));
      if (page) break;
    } catch { browser = undefined; }
    await sleep(1000);
  }
  if (!page) return false;
  await page.waitForFunction(() => window.autopet && document.querySelector('.feature-panel'));
  await page.evaluate(() => { const core = window.__TAURI__.core; window.__TAURI__.core = { ...core, invoke: (c, a, o) => (c === 'pet_focus' ? Promise.resolve() : core.invoke(c, a, o)) }; });
  const pid = JSON.parse(fs.readFileSync(path.join(STATE, 'status.json'), 'utf8')).pid;
  ps('-Op', 'move', '-ProcessId', String(pid), '-X', '900', '-Y', '560');
  return true;
}
const invoke = (cmd, args) => page.evaluate(([c, a]) => window.__TAURI__.core.invoke(c, a).catch((e) => ({ error: String(e) })), [cmd, args]);
const click = async (sel, text) => { await page.locator(sel, { hasText: text }).first().click(); await sleep(300); };
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});
const until = async (fn, ms, every = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; if (codexExit !== null) return null; await sleep(every); } return null; };
const agentTexts = () => events.filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message').map((e) => e.item.text ?? '');

async function finish() {
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ pick: PICK, pass, fail, results }, null, 2));
  try { execFileSync(EXE, ['quit'], { encoding: 'utf8' }); } catch {}
  if (codexExit === null) codex.kill();
  await browser?.close().catch(() => {});
  log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// ---------------------------------------------------------------- 1-2. $autopet: pet appears
check('Codex showed the pet (CDP page found)', await connect(5 * 60_000));
if (!page) await finish();
const waiting = await until(async () => (await invoke('pet_chat_status'))?.waiting, 5 * 60_000);
check('the Codex run is waiting for the pet (wait)', waiting?.thread, JSON.stringify(waiting));
if (!waiting) await finish();

// ---------------------------------------------------------------- 3-4. setup in the pet, 제작 시작
const pet = await page.evaluate(() => { const r = document.getElementById('pet').getBoundingClientRect(); return { x: r.x + 44, y: r.y + 44 }; });
await page.mouse.click(pet.x, pet.y);
await sleep(800);
await click('.fp-feature', '발표자료 만들기');
await click('.fp-option', '학교 발표');
await click('.fp-option', '직접 입력');
await page.locator('.fp-custom-input').fill('10장');
await click('.fp-custom .fp-primary', '다음');
await click('.fp-option', '심플하고 깔끔하게');
await click('.fp-option', '시간 우선');
await page.locator('.fp-text-input').fill('생성형 AI 활용 사례');
await click('.fp-text .fp-primary', '다음');
await sleep(2000);
await shot('1-summary');
await click('.fp-start', '제작 시작');
log('제작 시작 clicked');

// ---------------------------------------------------------------- 5-6. Codex drafts outlines and asks
const asked = await until(async () => { const s = await invoke('pet_slides_status'); return s?.phase === 'question' || s?.phase === 'failed' || s?.phase === 'completed' ? s : null; }, 20 * 60_000);
check('Codex paused on a pet question before making the deck', asked?.phase === 'question' && asked.question?.stage === 'outline', asked ? `${asked.phase} ${asked.error ?? ''}` : 'timeout');
if (asked?.phase !== 'question') await finish();
const q = asked.question;
log(`question: ${q.question}`);
for (const o of q.options) log(`  ${o.id}. ${o.label} — ${o.summary} [${o.slides.length}] ${o.slides.join(' / ')}`);
check('the question carries outlines Codex drafted (2-3, with slide titles)', q.options.length >= 2 && q.options.every((o) => o.slides.length >= 5), q.options.map((o) => `${o.id}:${o.slides.length}`).join(' '));
const outputFile = asked.outputDir ? path.join(asked.outputDir, 'presentation.html') : null;
check('no deck exists while the question is open', outputFile && !fs.existsSync(outputFile), outputFile);
await page.keyboard.press('Escape'); // close the bubble: the pet alone signals the question
await sleep(1500);
await shot('2-pet-needs-choice');

// Not answering: the work must not move on.
log('holding the answer for 90 s');
const before = await invoke('pet_slides_status');
await sleep(90_000);
const held = await invoke('pet_slides_status');
const htmlNow = fs.existsSync(asked.outputDir) ? fs.readdirSync(asked.outputDir).filter((f) => f.endsWith('.html')) : [];
check('without an answer Codex stays paused (no deck, no file changes, still running)', held.phase === 'question' && htmlNow.length === 0 && held.fileChangeCount === before.fileChangeCount && codexExit === null, `${held.phase} html=${htmlNow.length} files ${before.fileChangeCount}->${held.fileChangeCount}`);

// ---------------------------------------------------------------- 7. the user picks in the pet
// The pet is on the real desktop: someone may answer it by hand first. Then
// the test follows that answer instead of clicking.
let option = q.options.find((o) => o.id === PICK) ?? q.options[q.options.length - 1];
const already = (await invoke('pet_slides_status'))?.checkpoints?.[0]?.answer;
if (already) {
  option = q.options.find((o) => o.id === already.optionId) ?? option;
  log(`answered outside the test: ${already.optionId ?? 'custom'} — following it`);
} else {
  if (!(await page.evaluate(() => !document.querySelector('.bubble').hidden))) await page.mouse.click(pet.x, pet.y);
  await sleep(900);
  await shot('3-question');
  try {
    await page.locator(`.fp-choice-btn[data-option="${option.id}"]`).click({ timeout: 10_000 });
    await sleep(500);
    await shot('4-confirm');
    await page.evaluate(() => { const b = document.querySelector('.fp-answer'); b?.click(); b?.click(); });
    log(`answered ${option.id}. ${option.label}`);
  } catch (error) {
    const late = (await invoke('pet_slides_status'))?.checkpoints?.[0]?.answer;
    if (!late) { check('answer the question in the pet', false, String(error)); await finish(); }
    option = q.options.find((o) => o.id === late.optionId) ?? option;
    log(`answered outside the test: ${late.optionId ?? 'custom'} — following it`);
  }
}

// ---------------------------------------------------------------- 8-9. Codex resumes with the choice
const resumed = await until(async () => { const s = await invoke('pet_slides_status'); return s?.checkpoints?.[0]?.state === 'delivered' ? s : null; }, 2 * 60_000, 1000);
check('the answer was delivered to the waiting Codex run', resumed, resumed?.lastEvent);
await sleep(1500);
await shot('5-resumed');
const end = await until(async () => { const s = await invoke('pet_slides_status'); return ['completed', 'failed'].includes(s?.phase) ? s : null; }, 30 * 60_000, 3000);
if (end?.phase === 'question') log('note: a further question was asked');
await sleep(1500);
await page.mouse.click(pet.x, pet.y).catch(() => {});
await sleep(900);
await shot('6-finished');
check('Codex finished and the pet verified it (completed)', end?.phase === 'completed', end ? `${end.phase} ${end.error ?? ''}` : 'timeout');

// ---------------------------------------------------------------- 10. the deck follows the chosen outline
const html = end?.outputFile && fs.existsSync(end.outputFile) ? fs.readFileSync(end.outputFile, 'utf8') : '';
const sections = [...html.matchAll(/<section\b[\s\S]*?<\/section>/gi)].map((m) => m[0]);
const heading = (s) => (s.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const titles = sections.map(heading);
log(`deck: ${sections.length} sections`);
titles.forEach((t, i) => log(`  ${i + 1}. ${t}`));
const norm = (t) => t.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const deckText = norm(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' '));
const hits = (o) => o.slides.filter((t) => deckText.includes(norm(t))).length;
const mine = hits(option);
const others = q.options.filter((o) => o.id !== option.id).map((o) => ({ id: o.id, hits: o.slides.filter((t) => !option.slides.map(norm).includes(norm(t))).filter((t) => deckText.includes(norm(t))).length }));
check(`deck follows ${option.id} (its slide titles are in the deck)`, mine >= Math.ceil(option.slides.length * 0.7), `${mine}/${option.slides.length}`);
check('deck does not follow the other outline(s)', others.every((o) => o.hits < mine / 2), JSON.stringify(others));
const cp = end?.checkpoints?.find((c) => c.stage === 'outline');
check('pet outline match agrees', cp?.outlineMatch?.ok === true, JSON.stringify(cp?.outlineMatch));

// ---------------------------------------------------------------- 11-12. records, chat visibility
await until(async () => codexExit !== null, 15 * 60_000, 2000);
const exited = codexExit !== null;
const texts = agentTexts();
check('the Codex run showed the decision in its own messages', texts.some((t) => t.includes('선택 완료') && t.includes(option.label)), texts.find((t) => t.includes('선택 완료'))?.slice(0, 300));
check('pet saw that in the chat\'s session record', cp?.chatShown === true);
const record = end?.recordFile && fs.existsSync(end.recordFile) ? JSON.parse(fs.readFileSync(end.recordFile, 'utf8')) : null;
check('run.json: question, options, answer, delivery after answer, deck after delivery', record?.checkpoints?.[0]?.answer?.optionId === option.id && record.checkpoints[0].deliveredAt >= record.checkpoints[0].answeredAt && record.result?.ok === true, record?.result?.message);
check('exactly one answer and one resume', record?.events?.filter((e) => e.kind === 'answered-in-pet').length === 1 && record.events.filter((e) => e.kind === 'answer-delivered').length === 1);
const last = fs.existsSync(path.join(OUT, 'last-message.txt')) ? fs.readFileSync(path.join(OUT, 'last-message.txt'), 'utf8') : '';
check('Codex ended its turn with the result', exited && last.length > 0, last.slice(0, 400));
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ pick: option.id, question: q, deckTitles: titles, outlineMatch: cp?.outlineMatch, outputFile: end?.outputFile, recordFile: end?.recordFile, lastMessage: last }, null, 2));
await finish();
