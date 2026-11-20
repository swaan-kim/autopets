import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTurn, approvalNotice, userInputNotice, digestTurn, isWorkCommand, proseLines } from '../codex-attention.mjs';

const NONE = { available: true, fileChanges: 0, workCommands: 0, tools: 0, delegated: 0, plan: null, userPrompt: null };
const FILES = { ...NONE, fileChanges: 2, workCommands: 1 };
const kind = (message, evidence = NONE) => classifyTurn({ message, evidence }).kind;

// Real final message captured from Codex (gpt-5.6-sol) for "학과 행사 안내 웹페이지를 만들어줘. 먼저 계획을 제안해줘. 아직 파일은 만들지 마."
const REAL_PLAN = `다음 순서로 진행하겠습니다. 아직 파일은 만들거나 수정하지 않겠습니다.

1. 요구사항 정리
   - 학과명과 행사 목적
2. 페이지 구성
   - 상단: 학과명과 주요 메뉴
   - 자주 묻는 질문
3. 디자인 방향
   - 모바일과 PC에 모두 대응하는 반응형 레이아웃
4. 구현 및 검증
   - 페이지 구현 후 모바일·데스크톱 화면 점검

기본안은 특정 행사 하나를 집중적으로 안내하는 단일 페이지입니다. 구현을 시작할 때 행사 정보가 아직 없다면 교체하기 쉬운 예시 문구와 이미지 영역으로 구성하겠습니다.`;

test('a plan that waits for the go-ahead is action_required, even without a question mark', () => {
  const result = classifyTurn({ message: REAL_PLAN, evidence: { ...NONE, userPrompt: '학과 행사 안내 웹페이지를 만들어줘. 먼저 계획을 제안해줘.' } });
  assert.equal(result.kind, 'action_required');
  assert.equal(result.reason, 'confirmation_required');
  assert.match(result.summary, /계획을 정리했어/u);
});

// Real reply (isolated Codex app-server, 2026-11-13) with neither "계획" nor a question.
const REAL_PLAN_FUTURE = `다음처럼 \`index.html\` 하나로 완성하겠습니다.

1. 페이지 구조
   - 학과명과 행사 제목이 보이는 상단 배너
   - 행사 일시·장소·대상 등 핵심 정보
2. 디자인
   - 모바일과 PC에 모두 대응하는 반응형 레이아웃
3. 구현 방식
   - 외부 프레임워크 없이 \`index.html\` 하나만 사용

결과물은 별도 설치 없이 브라우저에서 바로 열 수 있는 단일 \`index.html\` 파일입니다.`;

test('a plan written as future work after a plan-first request waits for the go-ahead', () => {
  const prompt = '학과 행사 안내 웹페이지를 만들어줘. 먼저 계획을 제안해줘.';
  assert.equal(classifyTurn({ message: REAL_PLAN_FUTURE, evidence: { ...NONE, userPrompt: prompt } }).reason, 'confirmation_required');
  // Without the request for a plan first, a description of coming work alone is not enough.
  assert.equal(kind(REAL_PLAN_FUTURE), 'none');
  // Once files were written in the same turn it is not a pending plan.
  assert.notEqual(classifyTurn({ message: REAL_PLAN_FUTURE, evidence: { ...FILES, userPrompt: prompt } }).kind, 'action_required');
});

test('explicit confirmation requests are action_required (confirmation_required)', () => {
  for (const message of [
    `## 구현 계획\n- 헤더\n- 일정표\n- 신청 폼\n\n이 계획으로 진행하려면 '그대로 구현해줘'라고 말씀해 주세요.`,
    '파일 구조를 위와 같이 바꿀 예정입니다. 이 계획대로 진행할까요?',
    '수정 범위가 커서 파일을 수정하기 전에 확인이 필요합니다.',
    '이 작업을 계속 진행해도 될까요?',
    'Here is the plan. Shall I proceed?',
  ]) {
    const result = classifyTurn({ message, evidence: NONE });
    assert.equal(result.kind, 'action_required', message);
    assert.equal(result.reason, 'confirmation_required', message);
  }
});

test('questions and requests for information are action_required (question)', () => {
  for (const message of [
    '두 가지 시안을 준비했습니다. 어떤 디자인으로 진행할까요?',
    'A안은 깔끔하고 B안은 화려합니다. A안과 B안 중 어떤 방향을 선택하시겠어요?',
    '발표자료의 분량을 늘릴까요?',
    '추가로 필요한 정보가 있습니다. 행사 날짜와 장소를 알려 주세요.',
    '행사 날짜를 알려 주셔야 페이지를 마무리할 수 있어요.',
  ]) assert.equal(kind(message), 'action_required', message);
});

test('ordinary answers, examples, FAQ copy and optional offers raise nothing', () => {
  for (const message of [
    'React의 useEffect는 렌더링 이후에 실행됩니다. 의존성 배열이 바뀔 때마다 다시 실행돼요.',
    'FAQ 섹션 예시: "궁금한 점이 있으신가요?" 같은 문구를 넣으면 좋습니다.',
    '자주 쓰는 질문 예시는 다음과 같습니다.\n\n```\n참가비가 있나요?\n주차가 가능한가요?\n```',
    '> 이 계획대로 진행할까요?\n\n위처럼 사용자에게 묻는 문장을 버튼 옆에 두면 됩니다.',
    '설명은 여기까지입니다. 궁금한 점이 있으신가요?',
    '두 방식의 차이를 정리했어요. 원하시면 예제 코드도 만들어 드릴까요?',
    '문제가 있으면 알려 주세요.',
    'Let me know if you have any questions.',
  ]) assert.equal(kind(message), 'none', message);
});

test('completion needs a completion statement AND observed work', () => {
  const report = '`index.html`에 학과 행사 안내 페이지를 만들었습니다. 브라우저에서 열어 확인해 주세요.';
  const done = classifyTurn({ message: report, evidence: FILES });
  assert.equal(done.kind, 'completed'); assert.equal(done.verified, true);
  assert.match(done.summary, /만들었습니다/u);
  // Real completion reply: the summary is its own first sentence, not glued to the list below it.
  const real = classifyTurn({ message: '학과 행사 안내 웹페이지를 구현했습니다.\n\n- 단일 `index.html`에 HTML·CSS·JavaScript 통합\n- 반응형 디자인', evidence: FILES });
  assert.equal(real.summary, '학과 행사 안내 웹페이지를 구현했습니다.');
  // Same words, but the turn changed nothing: an explanation, not finished work.
  assert.equal(kind(report, NONE), 'none');
  // Real reply captured when the sandbox blocked the write: not completed.
  assert.equal(kind('현재 작업 환경이 읽기 전용으로 설정되어 있어 `index.html` 생성이 정책상 차단되었습니다. 쓰기 권한이 허용된 환경에서 다시 실행해야 파일을 만들 수 있습니다.', NONE), 'none');
  // Commands that ran tests are work; read-only listing is not.
  assert.equal(kind('테스트를 실행했고 모두 통과했습니다.', { ...NONE, workCommands: 1 }), 'completed');
  assert.equal(kind('코드를 살펴보고 구조를 정리했습니다.', NONE), 'none');
  // A pet subagent did the work for this chat.
  assert.equal(kind('발표자료 제작을 완료했습니다. 결과 파일을 확인해 보세요.', { ...NONE, delegated: 1 }), 'completed');
});

// Real Codex Desktop replies (2026-11-13) from a chat whose pet subagent did the work.
const REAL_DONE_WITH_CAVEAT = `발표자료를 구현했습니다.

[새내기 연결의 날 발표자료 열기](</C:/work/presentation.html>)

- 가상 학과 행사 소개 5장
- 기존 파일 수정 없음

AutoPets의 Luna·낮음 설정과 발표자료 스킬 적용은 확인했습니다. 정적 검사는 통과했지만, 로컬 \`file://\` 주소가 브라우저 보안 정책에 차단되어 실제 브라우저 시각 검수는 미확인 상태입니다.`;
const REAL_FAILED = `구현을 완료하지 못했습니다. AutoPets 하위 작업에서 HTML 작성 명령이 실행 전 구문 오류로 실패했습니다.

- 새 파일이나 폴더는 생성되지 않았습니다.
- 같은 펫 실행은 중복 재실행할 수 없습니다.

다시 구현하려면 “다시 구현해줘”라고 보내주세요. 새 AutoPets 작업으로 재시도하겠습니다.`;

test('real Desktop replies: finished pet work with a verification caveat is completed; a failure never is', () => {
  const delegated = { ...NONE, workCommands: 9, delegated: 1, userPrompt: '다시 구현해줘' };
  const done = classifyTurn({ message: REAL_DONE_WITH_CAVEAT, evidence: delegated });
  assert.equal(done.kind, 'completed'); assert.match(done.summary, /^발표자료를 구현했습니다\. 새내기 연결의 날 발표자료/u);
  const failed = classifyTurn({ message: REAL_FAILED, evidence: delegated });
  assert.notEqual(failed.kind, 'completed'); assert.match(failed.summary ?? '', /끝내지 못했어/u);
  // A real error after a completion report blocks the completed notice even with changed files.
  assert.notEqual(kind('index.html을 만들었습니다. 하지만 테스트가 실패했습니다.', FILES), 'completed');
  // The reply to `$autopets` itself is pet setup, not a task or a question.
  assert.equal(classifyTurn({ message: 'AutoPets 스킬을 불러왔습니다. 연결할 펫이나 수행할 작업을 말씀해 주세요.', evidence: { ...NONE, userPrompt: '[$autopets](C:\\skills\\autopets\\SKILL.md) \n' } }).kind, 'none');
  // Real reply to `/오토펫` (Codex Desktop, 2026-11-13).
  for (const userPrompt of ['/오토펫', '/autopets', ' /오토펫 ']) {
    assert.equal(classifyTurn({ message: 'AutoPets 강아지 펫을 다시 표시하고 현재 채팅에 연결했습니다. 앱에서 펫을 고른 뒤 할 일을 말씀해 주세요.', evidence: { ...NONE, workCommands: 2, userPrompt } }).kind, 'none', userPrompt);
  }
  // A real question after "/오토펫로 만든 페이지…" style text that is not the call itself stays a question.
  assert.equal(classifyTurn({ message: '어떤 디자인으로 진행할까요?', evidence: { ...NONE, userPrompt: '/오토펫테스트 페이지 만들어줘' } }).kind, 'action_required');
});

test('without a readable transcript, completion is reported as unverified', () => {
  const result = classifyTurn({ message: '보고서 작성을 완료했습니다.', evidence: { available: false } });
  assert.equal(result.kind, 'completed'); assert.equal(result.verified, false);
});

test('finished work followed by a real next-step question stays completed', () => {
  const result = classifyTurn({ message: '웹페이지 구현을 완료했습니다. 이어서 배포까지 진행할까요?', evidence: FILES });
  assert.equal(result.kind, 'completed'); assert.match(result.summary, /다음 단계도 물어보고 있어/u);
});

test('Plan mode proposed plans and stop-hook continuations', () => {
  const plan = classifyTurn({ message: null, evidence: { ...NONE, plan: { title: '사진·영상 동아리 소개 원페이지 디자인 계획' } } });
  assert.equal(plan.kind, 'action_required'); assert.equal(plan.reason, 'confirmation_required');
  assert.match(plan.summary, /동아리 소개/u);
  assert.equal(classifyTurn({ message: '진행할까요?', evidence: NONE, stopHookActive: true }).kind, 'none');
  assert.equal(classifyTurn({ message: '', evidence: NONE }).kind, 'none');
});

test('approval and user-input notices summarize the official request', () => {
  assert.match(approvalNotice('Bash', { command: 'node -v' }).summary, /명령 실행 승인.*node -v/u);
  const longPath = approvalNotice('Bash', { command: "Get-Content -Raw 'C:\\Users\\someone\\AppData\\work\\index.html'" }).summary;
  assert.match(longPath, /index\.html/u); assert.doesNotMatch(longPath, /Users|AppData/u);
  assert.match(approvalNotice('apply_patch', { command: '*** Begin Patch\n*** Add File: web/hello.txt\n+hi\n*** End Patch' }).summary, /파일 변경 승인.*hello\.txt/u);
  assert.match(approvalNotice('mcp__github__create_issue', {}).summary, /github · create_issue/u);
  const ask = userInputNotice({ questions: [{ id: 'a', question: '소개할 동아리는 어떤 성격인가요?' }, { id: 'b', question: '페이지 범위는?' }] });
  assert.equal(ask.reason, 'question'); assert.match(ask.summary, /동아리는 어떤 성격.*외 1개/u);
  for (const notice of [approvalNotice('Bash', { command: 'x'.repeat(500) }), userInputNotice({ questions: [{ question: '가'.repeat(500) }] })]) assert.ok(notice.summary.length <= 160);
});

test('read-only commands are not counted as work', () => {
  for (const command of ['Get-ChildItem -Force | Select-Object Name', 'rg --files', 'git status --short', 'node -v', ['pwsh.exe', '-Command', "Get-Content -Raw 'a.md'"]]) assert.equal(isWorkCommand(command), false, String(command));
  for (const command of ['pnpm test', 'node build.mjs', 'echo hi > a.txt', 'Set-Content a.txt hi', ['pwsh.exe', '-Command', 'cargo build']]) assert.equal(isWorkCommand(command), true, String(command));
});

test('the digest covers only the requested turn', () => {
  const T1 = '01a1d04a-0000-7000-8000-000000000001'; const T2 = '01a1d04a-0000-7000-8000-000000000002';
  const event = item => JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item } });
  const lines = [
    JSON.stringify({ type: 'turn_context', payload: { turn_id: T1, approvals_reviewer: 'user' } }),
    event({ type: 'FileChange', changes: { 'a.txt': {} } }),
    JSON.stringify({ type: 'turn_context', payload: { turn_id: T2, approvals_reviewer: 'auto_review', collaboration_mode: { mode: 'plan' } } }),
    event({ type: 'UserMessage', content: [{ type: 'text', text: '먼저 계획을 세워줘' }] }),
    event({ type: 'CommandExecution', command: ['pwsh', '-Command', 'rg --files'], status: 'completed' }),
    event({ type: 'CommandExecution', command: ['pwsh', '-Command', 'pnpm test'], status: 'completed' }),
    event({ type: 'Plan', text: '# 디자인 계획\n\n- 하나' }),
    '{"partial',
  ];
  const second = digestTurn(lines, T2);
  assert.deepEqual({ files: second.fileChanges, work: second.workCommands, reviewer: second.reviewer, mode: second.mode, plan: second.plan, prompt: second.userPrompt },
    { files: 0, work: 1, reviewer: 'auto_review', mode: 'plan', plan: { title: '디자인 계획' }, prompt: '먼저 계획을 세워줘' });
  assert.equal(digestTurn(lines, T1).fileChanges, 1);
  assert.equal(digestTurn(lines, 'missing').available, false);
});

test('prose drops code blocks, quotes and tables', () => {
  assert.deepEqual(proseLines('앞\n```js\nconst a = "진행할까요?";\n```\n> 인용\n| 표 | 값 |\n뒤'), ['앞', '뒤']);
});
