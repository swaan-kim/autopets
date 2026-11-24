import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { runPet, parsePetArgs, readReviewInput, petFailure } from '../skills/autopets/scripts/pet.mjs';

const parent = '11111111-1111-4111-8111-111111111111';
const cwd = path.resolve('fixture'), executable = path.resolve('fixture-codex.exe'), connection = path.resolve('fixture-connection.json');
const card = { question: '2+2는?', choices: ['3', '4', '5', '6'], answer: 2, explanation: '2와 2를 더하면 4', topic: '덧셈', correct: true };

function fixture() {
  const calls = [];
  const deps = { cwd, realpath: async v => v, isFile: async () => true, readConnection: async () => ({}),
    inspect: async args => { calls.push({ inspect: args }); return { node: { cwd }, models: [] }; },
    request: async (_, url, input) => { calls.push({ url, input }); return input.operation === 'due' ? { cards: [], limit: 10 } : { saved: 1, nextReviewDays: 3 }; } };
  const run = (operation, args = []) => runPet([operation, '--codex', executable, '--connection', connection, ...args], { CODEX_THREAD_ID: parent }, deps);
  return { deps, calls, run };
}

test('review commands need an input file only for save and result', () => {
  assert.throws(() => parsePetArgs(['review-save']), /invalid-arguments/);
  assert.throws(() => parsePetArgs(['review-due', '--input', path.resolve('x.json')]), /invalid-arguments/);
  assert.throws(() => parsePetArgs(['review-save', '--input', 'relative.json']), /absolute-path-required/);
  assert.throws(() => parsePetArgs(['status', '--input', path.resolve('x.json')]), /invalid-arguments/);
  assert.equal(parsePetArgs(['review-result', '--input', path.resolve('x.json')]).operation, 'review-result');
  // One batch: its short code, and --mode all for 전체 다시 풀기.
  assert.deepEqual(parsePetArgs(['review-due', '--batch', 'ab12cd34', '--mode', 'all']), { operation: 'review-due', batch: 'ab12cd34', mode: 'all' });
  assert.throws(() => parsePetArgs(['review-due', '--batch', 'AB12CD34']), /invalid-review-batch/);
  assert.throws(() => parsePetArgs(['review-due', '--mode', 'all']), /invalid-arguments/, 'all needs a batch');
  assert.throws(() => parsePetArgs(['review-due', '--batch', 'ab12cd34', '--mode', 'some']), /invalid-arguments/);
  assert.throws(() => parsePetArgs(['status', '--batch', 'ab12cd34']), /invalid-arguments/);
});

test('review scripts verify the current chat and send only cards to /v1/review', async () => {
  const f = fixture();
  f.deps.readReviewInput = async () => ({ cards: [card] });
  await assert.rejects(f.run('review-save', ['--input', path.resolve('cards.json')]), /invalid-review-batch/, 'a new quiz needs its batch name');
  assert.ok(!f.calls.some(c => c.url), 'nothing sent');
  f.deps.readReviewInput = async () => ({ batch: { name: '덧셈', chat: '전체 대화' }, cards: [card] });
  const saved = await f.run('review-save', ['--input', path.resolve('cards.json')]);
  assert.equal(saved.ok, true); assert.equal(saved.nextReviewDays, 3);
  const sent = f.calls.find(c => c.url);
  assert.equal(sent.url, '/v1/review');
  assert.deepEqual(sent.input, { operation: 'save', target: { sourceId: 'codex-windows-local', threadId: parent, cwd }, batch: { name: '덧셈' }, cards: [card] }, 'only the batch name is sent');
  // Questions added during a batch review join that batch.
  f.deps.readReviewInput = async () => ({ batch: { id: 'ab12cd34' }, cards: [card] });
  await f.run('review-save', ['--input', path.resolve('cards.json')]);
  assert.deepEqual(f.calls.at(-1).input.batch, { id: 'ab12cd34' });
  f.deps.readReviewInput = async () => ({ batch: { id: 'ab12cd34', name: '덧셈' }, cards: [card] });
  await assert.rejects(f.run('review-save', ['--input', path.resolve('cards.json')]), /invalid-review-batch/, 'a name or an id, not both');
  assert.equal(f.calls[0].inspect.threadId, parent, 'the Codex runtime confirms the chat first');
  assert.equal(f.calls[0].inspect.includeModels, false);
  assert.ok(!f.calls.some(c => c.url === '/v1/pet-link'), 'no pet task is started');

  f.deps.readReviewInput = async () => ({ results: [{ id: 'a', correct: false }] });
  await f.run('review-result', ['--input', path.resolve('results.json')]);
  assert.deepEqual(f.calls.at(-1).input.results, [{ id: 'a', correct: false }]);
  assert.deepEqual((await f.run('review-due')).cards, []);
  assert.equal(f.calls.at(-1).input.batch, undefined);
  await f.run('review-due', ['--batch', 'ab12cd34', '--mode', 'all']);
  assert.deepEqual([f.calls.at(-1).input.batch, f.calls.at(-1).input.all], ['ab12cd34', true]);
  f.deps.readReviewInput = async () => ({ batch: 'ab12cd34', all: true, results: [{ id: 'a', correct: true }] });
  await f.run('review-result', ['--input', path.resolve('results.json')]);
  assert.deepEqual([f.calls.at(-1).input.batch, f.calls.at(-1).input.all], ['ab12cd34', true]);
  f.deps.readReviewInput = async () => ({ all: true, results: [{ id: 'a', correct: true }] });
  await assert.rejects(f.run('review-result', ['--input', path.resolve('r.json')]), /invalid-review-batch/);
  f.deps.readReviewInput = async () => ({ results: 'nope' });
  await assert.rejects(f.run('review-result', ['--input', path.resolve('r.json')]), /review-input-format/);
});

test('the input file must be a .json under the temp folder and is removed after reading', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-review-'));
  const file = path.join(temp, 'cards.json');
  await fs.writeFile(file, '﻿' + JSON.stringify({ cards: [card] }), 'utf8');
  assert.deepEqual(await readReviewInput(file), { cards: [card] });
  await assert.rejects(fs.stat(file), /ENOENT/);

  const broken = path.join(temp, 'broken.json');
  await fs.writeFile(broken, '{', 'utf8');
  await assert.rejects(readReviewInput(broken), /review-input-format/);
  await assert.rejects(fs.stat(broken), /ENOENT/, 'removed even when unreadable');

  // A file outside the temp folder is never read or removed.
  const outside = await fs.mkdtemp(path.join(path.resolve('.'), '.review-outside-'));
  try {
    const kept = path.join(outside, 'cards.json');
    await fs.writeFile(kept, JSON.stringify({ cards: [card] }), 'utf8');
    await assert.rejects(readReviewInput(kept, { tmpdir: temp }), /review-input-location/);
    assert.ok((await fs.stat(kept)).isFile());
    const text = path.join(temp, 'cards.txt');
    await fs.writeFile(text, '{}', 'utf8');
    await assert.rejects(readReviewInput(text), /review-input-location/);
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('review failures have short Korean messages and no raw details', () => {
  for (const code of ['not-review-pet', 'invalid-review-card', 'invalid-review-batch', 'review-batch-not-found', 'review-cards-full', 'review-card-not-due', 'review-input-location']) {
    const failure = petFailure(Error(code));
    assert.equal(failure.ok, false); assert.equal(failure.code, code); assert.match(failure.message, /[가-힣]/u);
  }
});

test('the review skill keeps its question criteria and saves exactly the fields the app accepts', async () => {
  const { readPinnedSkill } = await import('../runtime/pet-skills.mjs');
  const { text } = await readPinnedSkill('autopets-review-helper', '1.0.0');
  for (const rule of ['이 채팅에서 실제로 다룬 내용으로만 낸다', '무엇을 더 공부하면 되는지 한 줄로', '한 문제는 한 가지만 묻는다',
    '3문제마다 적어도 1문제는', '기본은 10문제', '최소 3문제', '최대 10문제', '한 메시지에 전부 낸다', '"2, 2, 1, 4"처럼 한 줄로',
    '건너뛴 문제', '한 번에 채점한다', '점수(예: 7/10)', '묶음 이름', '그 문제들의 결과만 갱신한다', '복습 끝 · 틀린 N문제는 내일 다시',
    '묶음 복습도 양에 맞춘다', '같은 주제로 새 문제를 더한다', '그 묶음에 추가로 저장한다', '헷갈리기 쉬운 개념', '"모두 정답", "정답 없음"은 쓰지 않는다', '정답 번호가 한쪽으로 쏠리지 않게',
    '답하기 전에는 정답이나 힌트를 보여주지 않는다', '"모르겠어"라고 하면 틀린 것으로', '질문 문장과 보기 순서는 바꾼다',
    '두 번 연속 틀린 문제', '문제 N개 저장 · 다음 복습 M일 뒤', '복습 끝 · 다음 복습 N일 뒤']) assert.ok(text.includes(rule), rule);
  // The child's JSON question + the user's result (`correct`) must be exactly the bridge's NewCard fields.
  const example = JSON.parse(text.match(/```json\n([\s\S]+?)\n```/u)[1]);
  const rust = await fs.readFile(new URL('../../../apps/desktop/src-tauri/src/domain/review.rs', import.meta.url), 'utf8');
  const struct = rust.match(/pub struct NewCard \{([\s\S]+?)\n\}/u)[1];
  const fields = [...struct.matchAll(/pub (\w+):/gu)].map(m => m[1].replace(/_(\w)/gu, (_, c) => c.toUpperCase()));
  assert.deepEqual([...Object.keys(example.questions[0]), 'correct'].sort(), fields.sort());
  const guide = await fs.readFile(new URL('../skills/autopets/references/review-helper.md', import.meta.url), 'utf8');
  for (const key of fields) assert.ok(guide.includes(`\`${key}\``), `the chat guide saves ${key}`);
  assert.match(rust, /pub const CARDS_PER_SAVE: usize = 10;/u, 'the app saves a quiz of up to 10 questions');
  assert.equal(typeof example.title, 'string', 'the child names the batch');
  for (const key of ['"batch":{"name"', '"batch":{"id"', 'review-due --batch', '--mode all', '"all":true', '`wrong`']) assert.ok(guide.includes(key), `the chat guide covers ${key}`);
  // The composer requests stay short; the criteria live only in the skill.
  const chat = await fs.readFile(new URL('../../../apps/desktop/src-tauri/src/platform/review_chat.rs', import.meta.url), 'utf8');
  assert.match(chat, /Kind::Quiz => "AutoPets 스킬로 방금 공부한 내용으로 문제 10개 내줘",/u);
  assert.match(chat, /「\{name\}」 복습 문제 내줘 \(묶음 \{id\}\)/u, 'no fixed count');
  assert.match(chat, /「\{name\}」 전체 다시 풀기 \(묶음 \{id\}\)/u);
});
