import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePullRequest } from '../check-pull-request.mjs';

const body = `## 무엇이 좋아졌나
담당 @example: 오래된 A 카드로 B를 해제하지 못하게 했습니다. 관련 #22.
## Before → After
- 비교 유형: 화면
- 근거 수준: 합성 검사
- 기준 소스: d29c26f
- 변경 소스: aabbccdd
- 비교 조건: 같은 가상 A/B, 992×688, 100%, 계획 확인 상태
| Before | After |
| --- | --- |
| ![이전](docs/changes/22/before.png) | ![변경](docs/changes/22/after.png) |
## 핵심 변경
- 대상과 개정을 확인한 뒤 해제합니다.
## 검사와 제한
Node 합성 검사 통과. 실제 설치와 사용자 검사는 이번에 수행하지 않았습니다.
## 검토 요청
대상 전환 후 오래된 카드가 거절되는지 확인해 주세요.
<details>
<summary>다음 AI에게</summary>
- 작업·검사 기준: d29c26f → aabbccdd
- 수정 범위: 연결 카드와 관련 합성 검사
- 결정과 이유: 슬롯보다 정확한 대상을 우선해 혼선을 막음
- 유지할 계약: DB와 공개 API는 동일
- 완료한 것: 오래된 대상 거절 합성 검사
- 남은 일: 실제 사용자 확인은 별도 진행
- 다음 행동·재현: pnpm test로 관련 검사 실행
</details>`;

test('UI evidence and a compact collapsed AI handoff are accepted', () => {
  assert.deepEqual(validatePullRequest(body), []);
});

test('non-UI work uses a same-input behavior table without fake screenshots', () => {
  const changed = body.replace('비교 유형: 화면', '비교 유형: 동작')
    .replace('| ![이전](docs/changes/22/before.png) | ![변경](docs/changes/22/after.png) |', '| 같은 A 카드로 대상 전환 후 해제하면 B도 지워짐 | 같은 입력을 오래된 개정으로 거절하고 B 보존 |');
  assert.deepEqual(validatePullRequest(changed), []);
});

test('a genuinely new feature can state its missing baseline with a reason', () => {
  const changed = body.replace('비교 유형: 화면', '비교 유형: 신규 기능')
    .replace('| ![이전](docs/changes/22/before.png) | ![변경](docs/changes/22/after.png) |', '| 이전 기능 없음: 개발 피드백 도구 미탑재 | ![개발 도구](docs/changes/22/after.png) |');
  assert.deepEqual(validatePullRequest(changed), []);
});

test('empty template and superficial placeholders do not claim evidence', async () => {
  const template = await readFile(new URL('../../.github/pull_request_template.md', import.meta.url), 'utf8');
  assert.ok(validatePullRequest(template).length > 8);
  for (const value of ['TODO', 'TBD', '없음', '해당 없음', '[내용]']) {
    assert.ok(validatePullRequest(body.replace('수정 범위: 연결 카드와 관련 합성 검사', `수정 범위: ${value}`)).length);
  }
});

test('missing checks, comparison conditions, source and handoff are actionable errors', () => {
  const changed = body.replace('## 검사와 제한', '## 다른 제목').replace('기준 소스: d29c26f', '기준 소스: 나중에')
    .replace('비교 조건: 같은 가상 A/B, 992×688, 100%, 계획 확인 상태', '비교 조건:')
    .replace(/<details>[\s\S]*<\/details>/u, '');
  const errors = validatePullRequest(changed).join('\n');
  for (const field of ['검사와 제한', '기준 소스', '비교 조건', '다음 AI에게']) assert.ok(errors.includes(field));
});

test('commented and fenced sample headings cannot replace actual sections', () => {
  for (const wrapped of [`<!--\n${body}\n-->`, `\`\`\`markdown\n${body}\n\`\`\``]) {
    assert.ok(validatePullRequest(wrapped).some(error => error.includes('무엇이 좋아졌나')));
  }
  assert.ok(validatePullRequest(body + '\n## 핵심 변경\n중복').some(error => error.includes('중복')));
});

test('rendered examples cannot impersonate comparison evidence or collapsed handoff', () => {
  const quoted = body.replace(/(## Before → After\n)([\s\S]*?)(\n## 핵심 변경)/u, '$1```md\n$2\n```$3')
    .replace(/(<details>[\s\S]*<\/details>)/u, '```md\n$1\n```');
  const errors = validatePullRequest(quoted).join('\n');
  assert.match(errors, /비교 유형/u);
  assert.match(errors, /다음 AI에게/u);
});

test('unrelated tables cannot substitute for a before/after behavior comparison', () => {
  const unrelated = body.replace('비교 유형: 화면', '비교 유형: 동작')
    .replace('| Before | After |', '| Package | Version |')
    .replace('| ![이전](docs/changes/22/before.png) | ![변경](docs/changes/22/after.png) |', '| React | 19.2 |');
  assert.ok(validatePullRequest(unrelated).some(error => error.includes('동작 표')));
});

test('valid Markdown heading indentation and fenced reproduction commands remain supported', () => {
  const indented = body.replace(/^## /gmu, '  ## ')
    .replace('Node 합성 검사 통과.', 'Node 합성 검사 통과.\n```sh\npnpm test\n```');
  assert.deepEqual(validatePullRequest(indented), []);
});

test('event CLI reads shell-like PR text as data and returns failure for incomplete content', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'autopets-pr-format-'));
  t.after(() => {
    assert.equal(path.dirname(dir), tmpdir());
    assert.ok(path.basename(dir).startsWith('autopets-pr-format-'));
    return rm(dir, {recursive: true, force: true});
  });
  const event = path.join(dir, 'event.json'), cli = fileURLToPath(new URL('../check-pull-request.mjs', import.meta.url));
  await writeFile(event, JSON.stringify({pull_request: {body: body.replace('관련 #22.', '관련 #22. $(exit 13) `exit 14`')}}));
  let result = spawnSync(process.execPath, [cli, '--event', event], {encoding:'utf8', windowsHide:true});
  assert.equal(result.status, 0, result.stderr);
  await writeFile(event, JSON.stringify({pull_request: {body:'설명 없음'}}));
  result = spawnSync(process.execPath, [cli, '--event', event], {encoding:'utf8', windowsHide:true});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /다음 AI에게/u);
});
