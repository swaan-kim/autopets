// Human-in-the-loop protocol test with the REAL pet build and the REAL CLI
// commands (wait / ask / done / fail). Only the chat is simulated: a fake
// CODEX_THREAD_ID and a fake session record (rollout) under a scratch
// CODEX_HOME. The pet runs isolated (own state folder via
// AUTOPET_PREVIEW_STATE_DIR; build it with a separate identifier so it does
// not forward to a pet the user is running). The UI is driven through CDP
// only (no OS input; pet_focus stubbed).
//
//   node hitl-sim.mjs <autopet-preview.exe> <scratch folder>
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright');

const [EXE, S] = process.argv.slice(2).map((p) => path.resolve(p));
if (!EXE || !S) throw new Error('usage: node hitl-sim.mjs <exe> <scratch>');
const PORT = 9334;
const HOME = `${S}/hitl-codex-home`;
const STATE = `${S}/hitl-state`;
const WS = `${S}/hitl-workspace`;
const SHOTS = `${S}/hitl-shots`;
const A = 'sim-chat-aaaa-0001';
const B = 'sim-chat-bbbb-0002';
for (const d of [HOME, STATE, WS, SHOTS]) fs.rmSync(d, { recursive: true, force: true });
fs.mkdirSync(`${HOME}/sessions/2026/11/06`, { recursive: true });
for (const d of [WS, SHOTS]) fs.mkdirSync(d, { recursive: true });
const ROLLOUT = `${HOME}/sessions/2026/11/06/rollout-2026-11-06T01-00-00-${A}.jsonl`;
const line = (o) => fs.appendFileSync(ROLLOUT, JSON.stringify(o) + '\n');
const item = (it) => line({ type: 'event_msg', payload: { type: 'item_completed', item: it } });
const say = (text, phase = 'commentary') => item({ type: 'AgentMessage', phase, content: [{ type: 'Text', text }] });
line({ type: 'session_meta', payload: { id: A, cwd: WS } });

const env = (thread) => ({
  ...process.env, CODEX_HOME: HOME, AUTOPET_PREVIEW_STATE_DIR: STATE, CODEX_THREAD_ID: thread ?? '',
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
});
const parse = (text) => { try { return JSON.parse(text.trim()); } catch { return { raw: text }; } };
const run = (args, thread = A) => {
  try { return parse(execFileSync(EXE, args, { encoding: 'utf8', env: env(thread), cwd: WS })); } catch (e) { return parse(e.stdout ?? ''); }
};
const runAsync = (args, thread = A) => {
  const child = spawn(EXE, args, { env: env(thread), cwd: WS });
  let out = '';
  let exited = false;
  child.stdout.on('data', (d) => (out += d));
  const done = new Promise((r) => child.on('exit', (code) => { exited = true; r({ code, out: out.trim() ? parse(out) : null }); }));
  return { child, done, get exited() { return exited; } };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const results = [];
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  results.push({ name: n, ok: Boolean(ok), detail: String(d).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + String(d).slice(0, 300) : ''}`);
};
const ps = (...args) => execFileSync('powershell.exe', ['-NoProfile', '-File', path.join(HERE, 'winpid.ps1'), ...args], { encoding: 'utf8' }).trim();

console.log(`user idle: ${ps('-Op', 'idle')} ms (the test pet is unfocused and gets no OS input)`);

// ---------------------------------------------------------------- connect
let browser, page, petPid;
const errors = [];
async function connect() {
  page = undefined;
  if (browser && !browser.isConnected()) browser = undefined;
  for (let i = 0; i < 120 && !page; i++) {
    try {
      browser ??= await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
      page = browser.contexts()[0]?.pages().find((p) => p.url().startsWith('http://tauri.localhost'));
    } catch { browser = undefined; }
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('pet page not found over CDP');
  await page.waitForFunction(() => window.autopet && document.querySelector('.feature-panel'));
  await page.evaluate(() => {
    const core = window.__TAURI__.core;
    window.__TAURI__.core = { ...core, invoke: (c, a, o) => (c === 'pet_focus' ? Promise.resolve() : core.invoke(c, a, o)) };
  });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Keep the test pet away from a pet the user may have in the corner.
  ps('-Op', 'move', '-ProcessId', String(petPid), '-X', '900', '-Y', '560');
}
const invoke = (cmd, args) => page.evaluate(([c, a]) => window.__TAURI__.core.invoke(c, a).catch((e) => ({ error: String(e) })), [cmd, args]);
const status = () => invoke('pet_slides_status');
const ui = () => page.evaluate(() => {
  const q = (s) => document.querySelector(s)?.textContent ?? null;
  const panel = document.querySelector('.feature-panel');
  return {
    stage: panel.dataset.stage, open: !document.querySelector('.bubble').hidden,
    badge: q('.fp-badge'), title: q('.fp-name'), question: q('.fp-q-text'), phase: q('.fp-phase-text'),
    choices: [...document.querySelectorAll('.fp-choice-btn')].map((b) => b.textContent),
    confirm: q('.fp-confirm'), choice: q('.fp-choice'), error: q('.fp-error'), file: q('.fp-file'), skill: q('.fp-skill'),
    buttons: [...panel.querySelectorAll('button')].map((b) => `${b.textContent}${b.disabled ? '(off)' : ''}`),
    attention: document.getElementById('pet').dataset.attention ?? '', pill: document.getElementById('pet-status').hidden ? null : q('#pet-status'),
    overflow: panel.scrollHeight > panel.clientHeight + 1,
  };
});
const click = async (sel, text) => { await page.locator(sel, { hasText: text }).first().click(); await sleep(250); };
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const openBubble = async () => {
  if ((await ui()).open) return;
  const c = await page.evaluate(() => { const r = document.getElementById('pet').getBoundingClientRect(); return { x: r.x + 44, y: r.y + 44 }; });
  await page.mouse.click(c.x, c.y);
  await page.waitForFunction(() => !document.querySelector('.bubble').hidden);
  await sleep(400);
};
const closeBubble = async () => { await page.keyboard.press('Escape'); await sleep(500); };
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250); } return null; };

// A deck whose slide titles follow one outline option.
function deck(titles) {
  const sections = titles.map((t, i) => `<section class="slide"><h2>${t}</h2><p>${i + 1}번째 슬라이드 본문입니다. 핵심 메시지와 요점 세 가지.</p></section>`).join('\n');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>deck</title><style>${'.slide{padding:4vw}'.repeat(40)}</style></head><body>${sections}<script>let i=0;document.addEventListener('keydown',e=>{});</script></body></html>`;
}
const OUTLINE = {
  stage: 'outline', title: '발표자료 구성안 선택', question: '발표자료 구성안을 만들었어요. 어떤 방향으로 진행할까요?',
  options: [
    { id: 'A', label: '기술 원리 중심', summary: '개념과 핵심 기술부터 차근차근', slides: ['생성형 AI란 무엇인가', '핵심 기술: 트랜스포머', '기술 발전의 흐름', '대표 활용 사례', '정리와 결론'] },
    { id: 'B', label: '실제 활용 사례 중심', summary: '산업별 사례와 장단점 위주', slides: ['생성형 AI 활용 현황', '교육 분야 사례', '업무 자동화 사례', '장점과 문제점', '향후 전망과 결론'] },
  ],
  allowCustom: true,
};
const writeQuestion = (file, body) => fs.writeFileSync(file, '﻿' + JSON.stringify(body, null, 2), 'utf8'); // with BOM, like PowerShell 5.1

// ---------------------------------------------------------------- setup
const shown = run(['show']);
petPid = shown.pid;
check('test pet shown (isolated state folder)', shown.ok && shown.state === 'shown' && fs.existsSync(`${STATE}/status.json`), JSON.stringify(shown));
await connect();

async function setupAndStart(topic) {
  await openBubble();
  const u0 = await ui();
  if (u0.buttons.includes('새로 만들기')) await click('.fp-secondary', '새로 만들기');
  else if (u0.stage === 'home') await click('.fp-feature', '발표자료 만들기');
  for (const o of ['업무 보고', '5장 이내', '심플하고 깔끔하게', '균형']) await click('.fp-option', o);
  await page.locator('.fp-text-input').fill(topic);
  await click('.fp-text .fp-primary', '다음');
  await sleep(1800);
  await click('.fp-start', '제작 시작');
}

const w = runAsync(['wait']);
await sleep(1500);
const homeUi = await (async () => { await openBubble(); return ui(); })();
check('existing home grid unchanged (6 catalog pets, only 발표자료 enabled)', homeUi.stage === 'home' && homeUi.buttons.length === 6 && homeUi.buttons.filter((b) => !b.endsWith('(off)')).join() === '▤발표자료 만들기', homeUi.buttons.join(','));
await setupAndStart('생성형 AI 활용 사례 — 사내 교육용, 5장');
const wr = await Promise.race([w.done, sleep(8000).then(() => null)]);
const task = wr?.out?.task;
check('wait returns the task with the required outline checkpoint', task?.checkpoint?.required === 'outline' && task.checkpoint.ask.includes(`ask --task ${task.id}`) && task.checkpoint.file.endsWith('checkpoint-outline.json'), JSON.stringify(task?.checkpoint));
check('request tells the chat to ask in the pet before making the deck', task?.request?.includes('구성안 확인(필수)') && task.request.includes(task.checkpoint.file) && task.request.includes('결과 HTML을 만들거나 다른 작업을 하지 말고'));
const outDir = task.outputDir;
fs.mkdirSync(outDir, { recursive: true });
const qfile = task.checkpoint.file;

// the chat reads the skill (evidence the pet checks)
const skillText = fs.readFileSync(task.skill.path, 'utf8');
item({ type: 'CommandExecution', parsed_cmd: [{ cmd: `Get-Content -Raw ${task.skill.path}` }], aggregated_output: skillText });
say('요청을 분석해 구성안 두 가지를 만들었습니다. A: 기술 원리 중심 / B: 실제 활용 사례 중심. Pet에서 선택을 기다립니다.');
await sleep(1200);

// ---------------------------------------------------------------- bad asks
fs.writeFileSync(qfile, '{"stage":"outline","question":"x","options":[{"label":"하나","slides":["a","b"]}]}');
let r = run(['ask', '--task', task.id, '--file', qfile]);
check('ask with an invalid question file is refused with the reason', r.ok === false && r.state === 'refused' && r.message.includes('2~4개'), r.message);
writeQuestion(qfile, { ...OUTLINE, stage: 'length' });
r = run(['ask', '--task', task.id, '--file', qfile]);
check('a later-stage question before the outline is refused', r.ok === false && r.message.includes('구성안'), r.message);
writeQuestion(qfile, OUTLINE);
r = run(['ask', '--task', task.id, '--file', qfile], B);
check('another chat cannot ask on this task', r.ok === false && r.message.includes('다른 채팅'), r.message);
// (done without any decision is probed on task 2: done settles a task.)

// ---------------------------------------------------------------- the question
await closeBubble();
const ask1 = runAsync(['ask', '--task', task.id, '--file', qfile, '--timeout', '10']);
const st1 = await waitFor(async () => { const s = await status(); return s?.phase === 'question' ? s : null; });
check('the pet switches to "question" with the chat\'s own options', st1?.question?.options?.map((o) => o.label).join('|') === '기술 원리 중심|실제 활용 사례 중심' && st1.question.taskId === task.id, JSON.stringify(st1?.question)?.slice(0, 200));
await sleep(1200);
let u = await ui();
check('closed pet shows ring + "선택이 필요해요" without opening anything', u.attention === 'question' && u.pill === '선택이 필요해요' && !u.open, JSON.stringify({ a: u.attention, p: u.pill, open: u.open }));
await shot('1-pet-needs-choice');
r = run(['done', '--task', task.id]);
check('done is refused while the user has not answered', r.ok === false && r.message.includes('아직 답하지'), r.message);
const r2 = await ask1.done;
check('without an answer, ask times out and the task does not move on', r2.out?.state === 'ask-timeout' && !fs.existsSync(task.outputFile) && (await status()).phase === 'question', JSON.stringify(r2.out));

// hide the pet; asking again re-attaches to the same question and brings the pet back
await Promise.race([invoke('pet_hide').catch(() => {}), sleep(1500)]); // the page goes away with the window
await sleep(1500);
const hidden = ps('-Op', 'rect', '-ProcessId', String(petPid));
check('pet hidden (no pet window)', hidden.includes('null'), hidden);
const ask2 = runAsync(['ask', '--task', task.id, '--file', qfile]);
await connect();
const st2 = await status();
check('asking the same question again re-attaches (no second question)', st2.checkpoints.length === 1 && st2.question.id === st1.question.id, `${st2.checkpoints.length} ${st2.question?.id}`);
const different = { ...OUTLINE, question: '다른 질문' };
writeQuestion(`${outDir}/checkpoint-other.json`, different);
r = run(['ask', '--task', task.id, '--file', `${outDir}/checkpoint-other.json`]);
check('a different question while one is open is refused', r.ok === false && r.message.includes('아직 답을 받지 않은'), r.message);
await openBubble();
u = await ui();
check('after hide/show the bubble shows the pending question and its options', u.badge === '선택 필요' && u.question?.includes('어떤 방향') && u.choices.length === 3 && u.choices[2] === '직접 수정하기', JSON.stringify(u.choices));
check('question view (2 outlines + 직접 수정) fits the bubble', !u.overflow);
await shot('2-question');
await closeBubble();
await openBubble();
u = await ui();
check('closing and reopening the bubble keeps the question', u.badge === '선택 필요' && u.choices.length === 3);

// custom path, then back; then pick B with a confirmation step
await click('.fp-choice-custom', '직접 수정하기');
await page.locator('.fp-text-input').fill('B안으로 하되 실습 1장 추가');
await sleep(1300); // a poll tick must not wipe the typed text
check('typed custom text survives status polling', (await page.locator('.fp-text-input').inputValue()) === 'B안으로 하되 실습 1장 추가');
await click('.fp-secondary', '선택지 보기');
await click('.fp-choice-btn', '실제 활용 사례 중심');
u = await ui();
check('choosing shows a confirmation with the planned slides', u.confirm?.includes('B. 실제 활용 사례 중심') && u.confirm.includes('교육 분야 사례') && u.buttons.includes('이대로 진행'), u.confirm);
check('nothing is sent before confirming', (await status()).question.state === 'pending' && !ask2.exited);
await shot('3-confirm');
// rapid repeated clicks on 이대로 진행 (the same button element, synchronously)
await page.evaluate(() => { const b = document.querySelector('.fp-answer'); b.click(); b.click(); b.click(); });
const a2 = await Promise.race([ask2.done, sleep(8000).then(() => null)]);
check('ask returns the user\'s choice to the chat (B)', a2?.code === 0 && a2.out.state === 'answered' && a2.out.choice.optionId === 'B' && a2.out.choice.slides[1] === '교육 분야 사례', JSON.stringify(a2?.out)?.slice(0, 300));
check('chatSummary for the chat lists both outlines and the choice', a2?.out?.chatSummary?.includes('- A안: 기술 원리 중심') && a2.out.chatSummary.includes('- 사용자 선택: B안 (실제 활용 사례 중심)'), a2?.out?.chatSummary);
const again = await invoke('pet_checkpoint_answer', { taskId: task.id, questionId: st1.question.id, optionId: 'A', custom: null });
check('a different answer afterwards is refused', String(again?.error).includes('이미 답한'), JSON.stringify(again));
const same = await invoke('pet_checkpoint_answer', { taskId: task.id, questionId: st1.question.id, optionId: 'B', custom: null });
check('the same answer again is a no-op', !same?.error && same.checkpoints[0].state === 'delivered', JSON.stringify(same?.error ?? same?.phase));
const wrongTask = await invoke('pet_checkpoint_answer', { taskId: 'task-0', questionId: st1.question.id, optionId: 'B', custom: null });
check('an answer for another task is refused', String(wrongTask?.error).includes('작업'), JSON.stringify(wrongTask));
const rep = run(['ask', '--task', task.id, '--file', qfile]);
check('re-running the answered ask repeats the answer (no second resume)', rep.ok && rep.repeated === true && rep.choice.optionId === 'B', JSON.stringify(rep).slice(0, 200));
let st3 = await status();
check('pet is back to running with the decision recorded', st3.phase === 'running' && st3.checkpoints[0].state === 'delivered' && !st3.question, `${st3.phase} ${st3.checkpoints[0].state}`);
await sleep(1200);
u = await ui();
check('pet shows the chosen outline while it continues', u.phase === '발표자료 제작 중...' && u.choice?.includes('B. 실제 활용 사례 중심') && u.pill === '제작 중…' && u.attention === '', `${u.phase} | ${u.choice} | ${u.pill}`);
await shot('4-running-after-choice');

// the chat shows the decision and makes the deck from outline B
say(a2.out.chatSummary);
item({ type: 'CommandExecution', parsed_cmd: [{ cmd: `Set-Content ${task.outputFile}` }], aggregated_output: '' });
fs.writeFileSync(task.outputFile, deck(a2.out.choice.slides), 'utf8');
item({ type: 'FileChange', changes: { [task.outputFile]: { type: 'add' } } });
await sleep(1600);
const done1 = run(['done', '--task', task.id]);
check('done after the decision: completed', done1.ok && done1.state === 'completed', done1.message);
check('done reports the decision and the outline match (5/5 of B)', done1.decisions?.[0]?.answer === 'B안: 실제 활용 사례 중심' && done1.outlineMatch?.found === 5 && done1.outlineMatch.otherOnlyFound === 0 && done1.outlineMatch.ok, JSON.stringify(done1.outlineMatch));
check('the chat showing the decision was seen in its session record', done1.decisions?.[0]?.shownInChat === true);
const record = JSON.parse(fs.readFileSync(done1.runRecord, 'utf8'));
check('run.json keeps the full checkpoint (question, options, answer, delivery)', record.kind === 'autopets-pet-preview-run-v3' && record.checkpoints[0].answer.optionId === 'B' && record.checkpoints[0].deliveredAt >= record.checkpoints[0].answeredAt && record.events.filter((e) => e.kind === 'answer-delivered').length === 1);
check('triple click sent exactly one answer from the pet', record.events.filter((e) => e.kind === 'answered-in-pet').length === 1);
await sleep(1200);
u = await ui();
check('pet shows completion with the outline match', u.badge === '완료' && u.choice?.includes('제목 5/5 반영') && u.buttons.includes('결과 열기') && u.pill === '완료', `${u.badge} | ${u.choice}`);
check('completed view fits the bubble', !u.overflow);
await shot('5-completed');

// ---------------------------------------------------------------- task 2: deck before the question
const w2 = runAsync(['wait']);
await sleep(1200);
await setupAndStart('사내 보안 교육 — 5장');
const task2 = (await w2.done).out.task;
fs.mkdirSync(task2.outputDir, { recursive: true });
item({ type: 'CommandExecution', parsed_cmd: [{ cmd: `Get-Content -Raw ${task2.skill.path}` }], aggregated_output: skillText });
fs.writeFileSync(task2.outputFile, deck(['보안이란', '피싱', '비밀번호', '결론']), 'utf8');
writeQuestion(task2.checkpoint.file, OUTLINE);
r = run(['ask', '--task', task2.id, '--file', task2.checkpoint.file]);
check('asking after the deck already exists is refused', r.ok === false && r.message.includes('이미 있습니다'), r.message);
await sleep(1000);
r = run(['done', '--task', task2.id]);
check('done without a real decision is not accepted as complete', r.ok === false && r.state === 'failed' && r.message.includes('구성안'), r.message);
await sleep(1200);
u = await ui();
check('pet shows the reason of the failure', u.badge === '오류' && u.error?.includes('구성안'), u.error);

// ---------------------------------------------------------------- task 3: turn ends while waiting
const w3 = runAsync(['wait']);
await sleep(1200);
await click('.fp-secondary', '설정 수정'); // error view -> summary
await page.locator('.fp-start').click();
const task3 = (await w3.done).out.task;
fs.mkdirSync(task3.outputDir, { recursive: true });
writeQuestion(task3.checkpoint.file, OUTLINE);
const ask3 = runAsync(['ask', '--task', task3.id, '--file', task3.checkpoint.file]);
await waitFor(async () => (await status())?.phase === 'question');
line({ type: 'event_msg', payload: { type: 'turn_aborted', reason: 'interrupted' } });
const a3 = await Promise.race([ask3.done, sleep(8000).then(() => null)]);
const st4 = await status();
check('turn ended mid-question: ask ends and the question is cancelled', a3?.out?.ok === false && ['task-ended', 'question-cancelled'].includes(a3.out.state) && st4.checkpoints[0].state === 'cancelled', JSON.stringify(a3?.out));
check('failure names the unanswered question', st4.phase === 'failed' && st4.error.includes('답하기 전에'), st4.error);
await sleep(1200);
u = await ui();
check('pet error view, ring cleared', u.badge === '오류' && u.attention === '' && u.pill === '오류', `${u.badge} ${u.attention} ${u.pill}`);
await shot('6-turn-ended');

check('no console errors in the pet page', errors.length === 0, errors.join(' | '));
run(['quit']);
fs.writeFileSync(`${S}/hitl-sim-results.json`, JSON.stringify({ pass, fail, results }, null, 2));
console.log(`\n${pass} passed, ${fail} failed`);
await browser?.close().catch(() => {});
process.exit(fail ? 1 : 0);
