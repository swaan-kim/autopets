// The pet's own look at a finished result (#77): fixed rules, one bounded read, counts for the app
// and short samples only for the AI that wrote the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findBlanks, findExternal, findNotes, reviewResult, reviewText, visibleText } from '../../integrations/mcp/review.mjs';
import { createSession } from '../../integrations/mcp/server.mjs';
import { createLibraryClient } from '../../integrations/mcp/client.mjs';

// The shape of a real result: five slides, four unfilled blanks and notes to the author left on the page.
const SLIDES = `<!doctype html><html><head><style>.slide{display:none} .x::after{content:"[스타일 안의 글]"}</style>
<script>const label = '[스크립트 안의 글]';</script></head><body>
<section class="slide active"><h1>코딩 동아리 신입 모집</h1><p>동아리명 · 모집 정보는 실제 내용으로 수정해 주세요.</p></section>
<section class="slide"><h2>주요 활동</h2><p>활동 구성은 동아리 운영 계획에 맞춰 조정해 주세요.</p></section>
<section class="slide"><h2>이런 분을 기다려요</h2><ul><li>코딩이 처음이어도 괜찮아요. [1]</li></ul></section>
<section class="slide"><h2>지원 방법</h2><p>[모집 시작일] ~ [마감일]</p><p>[지원 링크 또는 QR 안내]</p><p>[모집 시작일]</p></section>
<section class="slide"><h2>문의</h2><p>[연락처 또는 SNS 계정]</p><!-- [주석 안의 글] --></section>
</body></html>`;

test('a slide file is counted the way a reader would find it', () => {
  const review = reviewText(SLIDES, 'html');
  assert.deepEqual(review.counts, { slides: 5, blanks: 5, notes: 2, external: 0 });
  assert.deepEqual(review.blanks, ['[모집 시작일]', '[마감일]', '[지원 링크 또는 QR 안내]', '[연락처 또는 SNS 계정]'], 'unique samples; a footnote number is not a blank');
  assert.equal(review.notes.length, 2);
  assert.ok(review.notes[0].startsWith('동아리명') && [...review.notes[0]].length <= 30, 'samples are short');
  const text = visibleText(SLIDES);
  assert.equal(/스타일 안의 글|스크립트 안의 글|주석 안의 글/u.test(text), false, 'only what a reader sees is checked');
});

test('blanks, author notes and internet-only parts are recognised without guessing', () => {
  assert.equal(findBlanks('○○동아리 OOO님 {{이름}} YYYY-MM-DD 00월 00일 TBD lorem ipsum').length, 7);
  assert.deepEqual(findBlanks('[1] [x] [ ] 가격은 3,000원 [자세히 보기](https://example.com) [참고][1] BOOK TODOS XXL'), [], 'numbers, checkboxes, links and ordinary words are left alone');
  assert.deepEqual(findNotes('여기에 팀 이름을 입력하세요\n일정을 확인해 주세요\n사진은 실제 사진으로 교체해 주세요\nReplace this with your logo'), ['여기에 팀 이름을 입력하세요', '사진은 실제 사진으로 교체해 주세요', 'Replace this with your logo']);
  const html = '<link rel="stylesheet" href="https://fonts.example.com/a.css"><img src="https://img.example.org/a.png"><a href="https://site.example.net">사이트</a><script src="./local.js"></script><style>@import url("https://cdn.example.io/x.css");</style>';
  assert.deepEqual(findExternal(html).sort(), ['cdn.example.io', 'fonts.example.com', 'img.example.org'], 'a plain link to a site is not a dependency');
  assert.deepEqual(reviewText('# 메모\n[날짜] 회의', 'text').counts, { slides: 0, blanks: 1, notes: 0, external: 0 });
  assert.equal(reviewText('<section>하나</section>', 'html').counts.slides, 0, 'one section is a page, not slides');
});

test('one bounded read of the reported file or the newest result in the reported folder', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autopets-review-'));
  t.after(async () => { assert.ok(path.basename(root).startsWith('autopets-review-')); await fs.rm(root, { recursive: true, force: true }); });
  const file = path.join(root, 'slides.html');
  await fs.writeFile(file, SLIDES);
  assert.equal((await reviewResult(file)).file, 'slides.html');
  // A folder: the newest readable result, also inside `outputs`.
  await fs.mkdir(path.join(root, 'outputs')); await fs.mkdir(path.join(root, 'work'));
  await fs.writeFile(path.join(root, 'work', 'draft.html'), '<p>[작업 중]</p>');
  await fs.writeFile(path.join(root, 'outputs', 'final.md'), '# 최종\n[발표 날짜]');
  await fs.utimes(path.join(root, 'outputs', 'final.md'), new Date(), new Date(Date.now() + 60_000));
  const folder = await reviewResult(root);
  assert.equal(folder.file, 'final.md'); assert.deepEqual(folder.blanks, ['[발표 날짜]']);
  // Nothing readable: another type, too large, empty, missing, relative or with a parent step.
  await fs.writeFile(path.join(root, 'deck.pptx'), 'binary');
  await fs.writeFile(path.join(root, 'big.html'), 'x'.repeat(512 * 1024 + 1));
  await fs.writeFile(path.join(root, 'empty.txt'), '  ');
  for (const target of [path.join(root, 'deck.pptx'), path.join(root, 'big.html'), path.join(root, 'empty.txt'), path.join(root, 'none.html'), 'slides.html', `${root}${path.sep}..${path.sep}x.html`, 7, null])
    assert.equal(await reviewResult(target), null, String(target));
  assert.equal(await reviewResult(file, { stat: async () => { throw Error('denied'); } }), null, 'a failed read is no review, never an error');
});

test('the report sends counts to the app and the samples back to the AI in the same answer', async () => {
  const sent = [];
  const review = reviewText(SLIDES, 'html');
  const session = createSession({ library: async body => { sent.push(body); return { recorded: true, jobId: body.jobId, state: body.state }; }, inspect: async target => target.endsWith('slides.html') ? { file: 'slides.html', ...review } : null });
  await session({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex', version: '1' } } });
  await session({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const call = (id, args) => session({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'autopets_report', arguments: args } });
  const working = (await call(2, { state: 'working', title: '발표자료', resultPath: 'C:\\work\\slides.html' })).result.structuredContent;
  assert.equal('review' in working, false, 'only a finished result is looked at');
  const done = (await call(3, { state: 'done', jobId: working.jobId, resultPath: 'C:\\work\\slides.html' })).result.structuredContent;
  assert.deepEqual(sent[1].review, { slides: 5, blanks: 5, notes: 2, external: 0 }, 'the app receives counts');
  assert.equal(/모집|동아리/u.test(JSON.stringify(sent[1])), false, 'no text from the result goes to the app');
  assert.equal(done.review.file, 'slides.html'); assert.equal(done.review.blanks.includes('[모집 시작일]'), true);
  assert.match(done.reviewNote, /내용을 지어내 빈칸을 채우지 마세요/u);
  const plain = (await call(4, { state: 'done', jobId: working.jobId, resultPath: 'C:\\work\\deck.pptx' })).result.structuredContent;
  assert.equal('review' in plain, false); assert.equal('review' in sent[2], false);
});

test('an app from before the review still records the report', async () => {
  const posts = [];
  const library = createLibraryClient({ environment: { AUTOPETS_CONNECTION_FILE: 'synthetic' }, connect: async () => ({}),
    request: async (_, route, body) => { posts.push(body); if (body.review) throw Object.assign(Error('bad request'), { status: 400 }); return { ok: true, jobId: body.jobId, state: body.state }; } });
  const jobId = '11111111-1111-4111-8111-111111111111';
  const result = await library({ operation: 'report', jobId, state: 'done', host: 'codex', resultPath: 'C:\\work\\slides.html', review: { slides: 5, blanks: 4, notes: 3, external: 0 } });
  assert.deepEqual(result, { recorded: true, jobId, state: 'done' });
  assert.equal(posts.length, 2); assert.equal('review' in posts[1], false);
  await library({ operation: 'report', jobId, state: 'done', host: 'codex' });
  assert.equal(posts.length, 3, 'a report without a review is sent once');
});
