import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { checkText, extractStrings, compare, scan, sourceFiles, BASELINE } from '../check-ux-copy.mjs';

const rules = text => checkText(text).map(problem => problem.rule);

test('finds the problems a first-time user trips on', () => {
  assert.deepEqual(rules('사용량을 절감해 드려요.'), ['promise']);
  assert.deepEqual(rules('사용량이 줄어든다고 보장하지 않아요.'), [], 'the honest, negated form passes');
  assert.ok(rules('MCP 연결을 켜 주세요.').includes('jargon'));
  assert.ok(!checkText('MCP 연결을 켜 주세요.', { mainPath: false }).some(p => p.rule === 'jargon'), 'advanced screens may keep technical words');
  assert.ok(rules('새 대화에 넣었어요.').includes('terms'));
  assert.ok(rules('보내기만 누르세요.').includes('terms'));
  assert.ok(rules('앱에서 사용할 수 있습니다.').includes('formal'));
  assert.ok(rules('가'.repeat(51) + '.').includes('long'));
  assert.deepEqual(rules('Codex 새 채팅에 요청을 넣었어요. 보내기만 눌러 주세요.'), []);
});

test('skips text written for the AI or in the user\'s own words', () => {
  assert.deepEqual(rules('학과 행사 웹페이지를 만들어줘. 대화 내용은 빼줘.'), []);
  assert.deepEqual(rules('AutoPets 스킬로 시작해줘. petId=a, recipe=b.'), []);
});

test('reads string literals, template text and JSX text, not comments', () => {
  const found = extractStrings([
    '// 주석의 대화는 화면에 보이지 않아요',
    "const a = '첫 문장이에요';",
    'const b = `${name}에 넣었어요`;',
    '/* 여러 줄',
    '   주석 */ const c = <p>버튼을 눌러 주세요</p>;',
  ].join('\n'));
  assert.deepEqual(found, [
    { text: '첫 문장이에요', line: 2 },
    { text: '○에 넣었어요', line: 3 },
    { text: '버튼을 눌러 주세요', line: 5 },
  ]);
});

test('only new problems fail; fixed ones are counted', () => {
  const finding = { file: 'a.tsx', rule: 'terms', word: '대화', text: '새 대화' };
  assert.deepEqual(compare([finding], [finding]), { fresh: [], fixed: 0 });
  assert.deepEqual(compare([finding, finding], [finding]).fresh.length, 1, 'a second copy of a known problem is new');
  assert.deepEqual(compare([], [finding]), { fresh: [], fixed: 1 });
});

test('the committed baseline matches the current screens', async () => {
  const baseline = JSON.parse(await fs.readFile(new URL(`../../${BASELINE}`, import.meta.url), 'utf8')).entries;
  const { fresh, fixed } = compare(await scan(await sourceFiles()), baseline);
  assert.deepEqual(fresh.map(item => `${item.file}:${item.line} ${item.rule} ${item.text}`), [], 'new copy problems: run `pnpm ux:check` and fix them');
  assert.equal(fixed, 0, 'some baseline problems were fixed: run `pnpm ux:check --update-baseline` to shrink the baseline');
});

test('Codex and Claude Code share one review skill and one agent per persona', async () => {
  const read = file => fs.readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
  assert.equal(await read('.claude/skills/ux-review/SKILL.md'), await read('.agents/skills/ux-review/SKILL.md'), 'keep the two skill copies identical');
  const personas = (await fs.readdir(new URL('../../docs/development/ux-review/personas/', import.meta.url))).map(name => name.replace(/\.md$/u, '')).sort();
  const agents = (await fs.readdir(new URL('../../.claude/agents/', import.meta.url))).filter(name => name.startsWith('ux-')).map(name => name.slice(3).replace(/\.md$/u, '')).sort();
  assert.deepEqual(agents, personas);
  for (const persona of personas) assert.ok((await read(`.claude/agents/ux-${persona}.md`)).includes(`docs/development/ux-review/personas/${persona}.md`));
});
