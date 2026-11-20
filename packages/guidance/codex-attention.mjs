// Local, deterministic reading of a finished Codex turn: does the user have to answer before work
// continues (`action_required`), did the requested work actually finish (`completed`), or neither?
// No model call, no network, no storage. Unclear text is `none`: a missed notice is cheaper than
// a pet that interrupts for every question mark (FAQ copy, examples, optional offers).
//
// Inputs are the turn's final assistant message and a digest of what the turn did (from the
// Codex rollout). A finished turn is never "completed" by itself: completion needs a completion
// statement AND observable work (file changes, non-read-only commands, tools, delegated agents).

export const SUMMARY_MAX = 160;
const MAX_INPUT_CHARS = 24000;
const CLOSING_SENTENCES = 4;

// ── Text preparation ────────────────────────────────────────────────────────────────────────
const FENCE = /(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*|$)/gu;
const QUOTED = /“[^”\n]{0,200}”|"[^"\n]{0,200}"|‘[^’\n]{0,200}’|'[^'\n]{1,120}'|「[^」\n]{0,200}」|『[^』\n]{0,200}』|`[^`\n]{0,200}`/gu;
const QUOTE_MARK = '〈인용〉';

function stripMarkdown(line) {
  return line
    .replace(/<\/?[a-z_][a-z0-9_-]*(?:\s[^>]*)?>/giu, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,6}(?:#{1,6}\s+|[-*+•]\s+|\d{1,3}[.)]\s+)/u, '')
    .replace(/\*\*|__|~~/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Prose lines of a message: code blocks, quotes, tables and markup removed. */
export function proseLines(text) {
  const source = String(text ?? '').slice(0, MAX_INPUT_CHARS).replace(/\r\n?/gu, '\n').replace(FENCE, '\n');
  return source.split('\n')
    .filter(line => !/^\s*(?:>|\|)/u.test(line))          // blockquotes (examples) and tables
    .map(stripMarkdown)
    .filter(Boolean);
}

const sentencesOf = lines => lines.flatMap(line => line.split(/(?<=[.?!。？！])\s+/u))
  .map(sentence => sentence.trim()).filter(sentence => sentence.length > 1);

/** Quoted spans (example copy, button labels, the phrase to type) are not the assistant's own words. */
const bare = sentence => sentence.replace(QUOTED, QUOTE_MARK);

// ── Patterns (Korean first, then English) ───────────────────────────────────────────────────
// "‘그대로 구현해줘’라고 말씀해 주세요" — the user is told what to reply.
const INSTRUCT_REPLY = /(?:라고|이라고|〈인용〉\s*(?:을|를|으로|로|이라고|라고)?)\s*(?:말씀|말해|답(?:해|변|장)|입력|보내|적어|요청|회신|써\s*주)/u;
// "진행할까요?", "이대로 구현해도 될까요?", "계속할지 알려 주세요"
const CONFIRM = /(?:진행|계속|구현|시작|착수|적용|반영|수정|변경|삭제|실행|설치|배포|커밋|푸시|작성|제작|이동|넘어가|만들어\s*드릴|만들)\s*(?:을|를)?\s*(?:해도\s*(?:될|괜찮을)\s*까요|해도\s*되(?:나요|겠습니까|겠어요|까요)|할\s*까요|할까요|하시겠(?:어요|습니까)|해\s*드릴\s*까요|해드릴까요|할지|하는\s*게\s*좋을까요|하면\s*될까요|할래요|할게요\s*\?|갈까요)/u;
const PROCEED_DIRECTION = /(?:이대로|그대로|이\s*(?:계획|방향|안|방식)(?:으로|대로)?)\s*(?:진행|갈|가도|구현|만들)/u;
// Asking for a decision or information from the user.
const DECISION_ASK = /(?:승인|허락|허가|동의|확정|결정|선택|골라|답변|회신|피드백|의견|선호)\s*(?:을|를|해|하여|해서)?\s*(?:\s*주(?:세요|시면|십시오|실래요|시겠어요|실\s*수)|부탁)/u;
const INFO_ASK = /(?:알려|말씀해|보내|공유해|첨부해|제공해|입력해|정해)\s*(?:\s*주(?:세요|시면|십시오|실\s*수|시겠어요|실래요))/u;
const NEEDS = /(?:확인|결정|선택|승인|답변|추가\s*정보|정보|자료|입력|의견)(?:이|가)\s*필요(?:합니다|해요|하다|해|한\s*상황)|필요한\s*(?:정보|자료|내용|결정)(?:이|가)\s*있(?:습니다|어요)/u;
const AWAITING = /(?:답변|회신|확인|결정|선택|승인|말씀|응답|의견)\S*\s*(?:을|를)?\s*기다리(?:겠|고\s*있|는\s*중)|주시면\s*(?:바로|그에\s*맞(?:춰|게)|이어서|그대로|곧바로)?\s*(?:진행|구현|시작|작업|반영|수정|마무리|만들)/u;
const BLOCKING = /(?:주셔야|있어야|정해져야|확인(?:되어|돼)야|결정(?:되어|돼)야|받아야)\s*(?:\S+\s*){0,3}?(?:진행|마무리|완료|계속|시작|만들)|(?:진행|구현|수정|작업)(?:하기)?\s*전에\s*(?:확인|결정|승인|선택)/u;
const CHOICE = /(?:[A-Z1-9]\s*안|[가-다]\s*안|옵션\s*[A-Z1-9]|선택지|방안|두\s*가지|세\s*가지)/u;
const QUESTION_END = /(?:까요|나요|가요|세요|셔요|십니까|습니까|실래요|을래요|할래요|겠어요|을지요|는지요|죠|어떠세요|어떨까요|괜찮으세요|괜찮으신가요)\s*[?？]\s*$/u;
const EN_ASK = /\b(?:shall|should) i (?:proceed|continue|go ahead|start|implement|apply|make)\b|\bdo you want me to\b|\bwould you like me to (?:proceed|continue|go ahead|implement|start|apply)\b|\bplease (?:confirm|choose|select|approve|decide|reply)\b|\blet me know (?:which|whether|how|what)\b|\breply with\b|\bbefore i (?:proceed|continue|make|start)\b|\bwaiting for your\b|\bonce you (?:confirm|approve|decide)\b|\bwhich (?:option|approach|one|direction|version)\b[^.]*\?/iu;
const EN_QUESTION = /^(?:shall|should|do|would|can|could|which|what|how|is|are|will)\b[^.]*\?\s*$|\byou\b[^.]*\?\s*$/iu;

// Not a request for an answer: closing courtesy and optional offers.
const GENERIC = /(?:궁금한\s*(?:점|사항|것|부분)|추가\s*(?:질문|문의)|더\s*(?:도와|필요한\s*(?:게|것|부분))|다른\s*(?:도움|질문|요청)|문제가\s*(?:있|생기)|이상한\s*(?:점|부분)|언제든(?:지)?|편하게\s*말씀)|\b(?:any (?:other |more )?questions|anything else|let me know if (?:you|there|anything)|feel free)\b/iu;
const OPTIONAL = /(?:원하시면|원하면|원하신다면|원한다면|필요하시면|필요하면|필요하다면|필요할\s*경우|희망하시면|괜찮으시면|괜찮다면|선택적으로|원하실\s*경우|추가로\s*원하)|\bif you(?:'d| would)? (?:like|want|prefer)\b|\boptionally\b|\bhappy to\b/iu;

const COMPLETION = /(?:완료(?:했|하였|됐|되었|했습니다|입니다|함)|마쳤|끝냈|끝났|만들었|작성했|구현했|수정했|고쳤|추가했|생성했|저장했|반영했|적용했|업데이트했|변경했|정리했|제작했|교체했|삭제했|설치했|배포했|해결했|완성했|준비했|커밋했|푸시했|push했|commit했|병합했|머지했|merge했|업로드했|올렸습니다|게시했|빌드했|통과(?:했|합니다|함|됩니다)|성공(?:했|합니다|함)|\b(?:done|completed|implemented|created|added|updated|fixed|built|wrote|finished|saved|all tests pass(?:ed)?)\b|\bI(?:'ve| have) (?:added|created|updated|implemented|fixed|made|written|built|finished)\b)/iu;
const FAILURE = /(?:실패했|실패합니다|실패하여|차단(?:되었|됐|했|되어)|막혀|오류가\s*(?:발생|났)|에러가\s*(?:발생|났)|못했|하지\s*못|할\s*수\s*없(?:었|습니다|어요|음)|불가능|권한(?:이)?\s*없|\b(?:failed|blocked|could not|couldn't|unable to|was rejected)\b)/iu;
// Only the last check could not be done (a preview, a browser look, a visual review).
const VERIFY_CAVEAT = /(?:검수|검증|확인|미확인|시각|미리\s*보기|열어\s*보|브라우저|스크린샷|preview|visual|could not (?:open|view|verify|check))/iu;
// The requested work itself went wrong.
const REAL_ERROR = /(?:(?:테스트|빌드|컴파일|설치|배포|저장|생성|작성|실행)\S{0,3}\s*(?:가|이|를|을)?\s*실패|오류가\s*(?:발생|났)|에러가\s*(?:발생|났)|완료하지\s*못|만들지\s*못|구현하지\s*못|\b(?:tests? failed|build failed|error occurred)\b)/iu;
// Finishing a wait, a look-up or a review is not finished work ("펫이 닫혀서 대기를 끝냈습니다").
const NOT_WORK = /(?:대기|기다림|기다리기|확인|조회|검색|탐색|살펴보기|검토|분석|읽기)(?:을|를)?\s*(?:끝냈|마쳤|완료(?:했|하였|됐|되었))/u;
// The plan is on the table and nothing was changed yet.
const DEFERRAL = /(?:아직\s*(?:\S+\s*){0,4}?(?:만들|수정|변경|작성|구현|생성|적용|건드리)(?:하|지|기|어)?\s*(?:지\s*)?않|구현(?:을)?\s*시작할\s*때|(?:승인|확인|동의|허락)(?:해\s*주시|되|하시|해주시)면\s*(?:바로\s*)?(?:진행|구현|시작|작업)|이\s*계획(?:으로|대로)|계획(?:대로|안대로)\s*진행|\bbefore (?:i )?(?:implement|start)|\bnothing (?:has been )?changed yet\b)/iu;
const PLAN_WORD = /(?:계획|단계|순서로\s*진행|진행\s*순서|작업\s*순서|로드맵|구현\s*방안|구성안|기획안|설계안|\bplan\b|\bsteps?\b)/iu;
// Work described as still to come ("다음처럼 index.html 하나로 완성하겠습니다").
const FUTURE_WORK = /(?:하겠습니다|할게요|할\s*예정|하려고\s*합니다|겠습니다\.?$|\bI(?:'ll| will)\b|\bI'm going to\b|\bwe(?:'ll| will)\b)/imu;
// The user asked for a plan before any work ("먼저 계획을 제안해줘").
const PLAN_FIRST = /(?:먼저|우선|일단)\s*(?:\S+\s*){0,3}?(?:계획|기획|설계|방향|구성|제안|plan)|계획(?:을|만|부터)\s*(?:\S+\s*){0,2}?(?:세워|짜|제안|작성|알려|보여|정리)|(?:plan|propose)\s+(?:it\s+)?(?:first|only)|before (?:you )?(?:implement|start|write)/iu;

/** Summary text: no markup, no citation directives, absolute paths shortened to file names. */
function tidy(text) {
  return String(text ?? '')
    .replace(/:[a-z][a-z-]*\{[^}\n]*\}/giu, ' ')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s`'"“”()<>|]+/gu, path => path.split(/[\\/]/u).filter(Boolean).pop() ?? path)
    .replace(/[`*_]/gu, '')
    .replace(/\s+/gu, ' ').trim();
}

// ── Message analysis ────────────────────────────────────────────────────────────────────────
function askType(text) {
  if (INSTRUCT_REPLY.test(text) || CONFIRM.test(text) || PROCEED_DIRECTION.test(text) || /승인|허락|허가|동의|확정/u.test(text)
    || /(?:확인|승인)(?:이|가)\s*필요|(?:진행|구현|수정|작업|변경|삭제)(?:하기)?\s*전에\s*(?:확인|결정|승인)/u.test(text)
    || /\b(?:proceed|continue|go ahead|confirm|approve)\b/iu.test(text)) return 'confirmation_required';
  return 'question';
}

/** What the closing of the message asks of the user, if anything. */
export function analyzeMessage(message) {
  const lines = proseLines(message);
  const sentences = sentencesOf(lines);
  const closing = sentences.slice(-CLOSING_SENTENCES);
  let ask = null; let blocking = false;
  for (const sentence of [...closing].reverse()) {
    const text = bare(sentence);
    if (GENERIC.test(text) && !BLOCKING.test(text) && !INSTRUCT_REPLY.test(text)) continue;
    const strong = INSTRUCT_REPLY.test(text) || CONFIRM.test(text) || DECISION_ASK.test(text) || NEEDS.test(text) || AWAITING.test(text)
      || BLOCKING.test(text) || EN_ASK.test(text) || (PROCEED_DIRECTION.test(text) && /[?？]\s*$/u.test(text));
    const question = /[?？]\s*$/u.test(text) && (QUESTION_END.test(text) || EN_QUESTION.test(text) || CHOICE.test(text));
    const info = INFO_ASK.test(text) && !/(?:있|생기|필요하)(?:으시)?면\s*(?:언제든(?:지)?\s*)?(?:알려|말씀)/u.test(text);
    if (!strong && !question && !info) continue;
    const optional = OPTIONAL.test(text) && !BLOCKING.test(text) && !NEEDS.test(text) && !INSTRUCT_REPLY.test(text);
    blocking ||= BLOCKING.test(text) || NEEDS.test(text);
    ask = { sentence, type: askType(text), optional, cue: strong ? 'explicit-ask' : question ? 'question' : 'info-request' };
    break;
  }
  const text = sentences.map(bare).join(' ');
  const closingText = closing.map(bare).join(' ');
  const completionAt = sentences.findIndex(sentence => COMPLETION.test(bare(sentence)) && !FAILURE.test(bare(sentence)) && !NOT_WORK.test(bare(sentence)));
  // A bare "완료되었습니다." says nothing about the result; the next line usually names it.
  const completion = completionAt < 0 ? null : tidy(sentences[completionAt]).replace(/\([^)]*\)/gu, '').trim().length < 16 && sentences[completionAt + 1]
    ? `${sentences[completionAt]} ${sentences[completionAt + 1]}` : sentences[completionAt];
  // The lead says the work failed, or a closing sentence reports a real error. A note that only
  // the final check could not be done ("브라우저 보안 정책에 차단되어 시각 검수는 미확인") after a
  // completion report is a caveat, not a failure of the requested work.
  const failureLead = sentences[0] ? FAILURE.test(bare(sentences[0])) && completionAt !== 0 : false;
  const failure = failureLead || closing.some(sentence => { const value = bare(sentence); return FAILURE.test(value) && !(completionAt >= 0 && VERIFY_CAVEAT.test(value) && !REAL_ERROR.test(value)); });
  const listItems = String(message ?? '').split(/\r?\n/u).filter(line => /^\s{0,6}(?:[-*+•]|\d{1,3}[.)])\s+\S/u.test(line)).length;
  const headings = String(message ?? '').split(/\r?\n/u).filter(line => /^\s{0,3}#{1,6}\s+\S/u.test(line));
  const planLike = (PLAN_WORD.test(text) || FUTURE_WORK.test(text)) && (listItems >= 3 || headings.length >= 2);
  const planTitle = headings.map(line => stripMarkdown(line)).find(line => PLAN_WORD.test(line)) ?? null;
  return { empty: sentences.length === 0, ask, blocking, completion, failure, planLike, deferral: DEFERRAL.test(text), planTitle, first: sentences[0] ?? null };
}

// ── Turn classification ─────────────────────────────────────────────────────────────────────
const clip = (text, max) => { const value = String(text ?? '').replace(/\s+/gu, ' ').trim(); return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value; };
const sentenceClip = (text, max) => clip(tidy(text), max);

// "‘디자인 계획’을", never "‘디자인 계획’ 계획을".
const planName = (title, max) => { const name = sentenceClip(title, max); return /계획$/u.test(name) ? `‘${name}’` : `‘${name}’ 계획`; };

function finish(result) {
  return { ...result, summary: result.summary ? clip(result.summary, SUMMARY_MAX) : null };
}

/**
 * evidence: { available, fileChanges, workCommands, tools, delegated, plan: {title}|null, userPrompt }
 * Returns { kind: 'action_required'|'completed'|'none', reason, summary, cues, verified }.
 */
export function classifyTurn(input = {}) {
  const result = classifyReply(input);
  // The user just called AutoPets in this chat (`$autopets`, `/autopets`, `/오토펫`): "말씀해 주세요"
  // in its reply is the pet setup talking, not a question that blocks work. Finished work in that
  // turn is still reported.
  const prompt = input.evidence?.userPrompt;
  if (result.kind === 'action_required' && typeof prompt === 'string' && /^\s*(?:\[?\$autopets\b|\/autopets\b|\/오토펫(?![\p{L}\p{N}]))/iu.test(prompt)) {
    return { ...result, kind: 'none', reason: 'autopets-command', summary: null };
  }
  return result;
}

function classifyReply({ message, evidence = {}, stopHookActive = false } = {}) {
  const cues = [];
  if (stopHookActive) return finish({ kind: 'none', reason: 'stop-hook-continuing', summary: null, cues });
  // Plan mode: the turn ended with a proposed plan and Codex shows "implement this plan?".
  if (evidence.plan) {
    const title = evidence.plan.title ? `${planName(evidence.plan.title, 48)}을 정리했어.` : '작업 계획을 정리했어.';
    return finish({ kind: 'action_required', reason: 'confirmation_required', summary: `${title} 이대로 구현할지 Codex에서 정해 줘.`, cues: ['proposed-plan'] });
  }
  const analysis = analyzeMessage(message);
  if (analysis.empty) return finish({ kind: 'none', reason: 'empty-message', summary: null, cues });
  const available = evidence.available === true;
  const files = available ? Number(evidence.fileChanges) || 0 : 0;
  const acted = available && (files > 0 || (Number(evidence.workCommands) || 0) > 0 || (Number(evidence.tools) || 0) > 0 || (Number(evidence.delegated) || 0) > 0);
  const done = Boolean(analysis.completion);
  const planFirst = typeof evidence.userPrompt === 'string' && PLAN_FIRST.test(evidence.userPrompt);
  const { ask } = analysis;
  if (ask) cues.push(ask.cue);
  const askSummary = (lead) => `${lead}${ask ? ` “${sentenceClip(ask.sentence, 84).replace(/[“”]/gu, "'")}”` : ''}`;
  const planLead = analysis.planTitle ? `${planName(analysis.planTitle, 40)}을 정리했어. 이대로 진행할지 물어보고 있어.` : '작업 계획을 정리했어. 이대로 진행할지 물어보고 있어.';

  // 1. The user's answer is required before Codex can go on ("…알려 주셔야 마무리할 수 있어요").
  if (ask && analysis.blocking) {
    cues.push('blocking');
    return finish({ kind: 'action_required', reason: ask.type, summary: askSummary(ask.type === 'confirmation_required' ? '진행하려면 확인이 필요해.' : 'Codex가 답을 기다리고 있어.'), cues });
  }
  // 2. A real (not optional) ask. After finished work it is a follow-up on a completed task.
  if (ask && !ask.optional) {
    if (done && files > 0 && !analysis.failure) {
      cues.push('completed-with-follow-up');
      return finish({ kind: 'completed', reason: 'completed', summary: `${sentenceClip(analysis.completion, 96)} 다음 단계도 물어보고 있어.`, cues, verified: true });
    }
    const lead = analysis.failure ? '작업을 끝내지 못했어. 다음에 어떻게 할지 물어보고 있어.'
      : ask.type === 'confirmation_required'
        ? (analysis.planLike && files === 0 ? planLead : '진행해도 될지 물어보고 있어.')
        : 'Codex가 물어보고 있어.';
    return finish({ kind: 'action_required', reason: ask.type, summary: askSummary(lead), cues });
  }
  // 3. A plan was presented, nothing was changed, and Codex stopped: it waits for the go-ahead.
  if (analysis.planLike && files === 0 && !done && (analysis.deferral || planFirst || ask)) {
    cues.push(analysis.deferral ? 'plan-deferred' : planFirst ? 'plan-requested-first' : 'plan-with-offer');
    return finish({ kind: 'action_required', reason: 'confirmation_required', summary: planLead, cues });
  }
  // 4. Finished work: a completion statement backed by what the turn actually did.
  if (done && acted && !analysis.failure) {
    cues.push(files > 0 ? 'files-changed' : 'work-observed');
    return finish({ kind: 'completed', reason: 'completed', summary: sentenceClip(analysis.completion, 120), cues, verified: true });
  }
  if (files > 0 && !analysis.failure && !ask) {
    cues.push('files-changed');
    return finish({ kind: 'completed', reason: 'completed', summary: sentenceClip(analysis.first, 120), cues, verified: true });
  }
  // 5. The work could not be observed (no transcript): say it finished, never that it succeeded.
  if (done && !available && !analysis.failure) {
    cues.push('unverified');
    return finish({ kind: 'completed', reason: 'completed', summary: sentenceClip(analysis.completion, 120), cues, verified: false });
  }
  return finish({ kind: 'none', reason: ask?.optional ? 'optional-offer' : done ? 'no-observed-work' : analysis.failure ? 'failure' : 'no-request', summary: null, cues });
}

// ── Official waiting events (hooks) ─────────────────────────────────────────────────────────
const basename = value => String(value).split(/[\\/]/u).filter(Boolean).pop() ?? '';

/** PermissionRequest: Codex is about to ask the user to approve a tool call. */
export function approvalNotice(toolName, toolInput) {
  const name = String(toolName ?? '');
  const input = toolInput !== null && typeof toolInput === 'object' ? toolInput : {};
  const command = typeof input.command === 'string' ? input.command : Array.isArray(input.command) ? input.command.join(' ') : '';
  let summary;
  if (name === 'apply_patch' || /^\*\*\* Begin Patch/u.test(command)) {
    const files = [...command.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gmu)].map(match => basename(match[1].trim()));
    summary = files.length ? `파일 변경 승인을 기다리고 있어: ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` 외 ${files.length - 3}개` : ''}` : '파일 변경 승인을 기다리고 있어.';
  } else if (/^mcp__/u.test(name)) {
    const [, server = '', tool = ''] = name.split('__');
    summary = `도구 사용 승인을 기다리고 있어: ${server}${tool ? ` · ${tool}` : ''}`;
  } else if (command) {
    const shown = command.split('\n')[0].replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s`'"“”()<>|]+/gu, value => basename(value));
    summary = `명령 실행 승인을 기다리고 있어: ${clip(shown, 72)}`;
  } else summary = `${clip(name || '도구', 40)} 사용 승인을 기다리고 있어.`;
  return finish({ kind: 'action_required', reason: 'approval_required', summary, cues: ['permission-request'] });
}

/** PreToolUse(request_user_input): Codex shows questions and waits for the user's choice. */
export function userInputNotice(toolInput) {
  const questions = Array.isArray(toolInput?.questions) ? toolInput.questions.filter(item => item && typeof item.question === 'string') : [];
  if (!questions.length) return finish({ kind: 'action_required', reason: 'question', summary: 'Codex가 선택지를 보여 주고 답을 기다리고 있어.', cues: ['request-user-input'] });
  const more = questions.length > 1 ? ` (외 ${questions.length - 1}개)` : '';
  return finish({ kind: 'action_required', reason: 'question', summary: `선택이 필요해: “${sentenceClip(questions[0].question, 90)}”${more}`, cues: ['request-user-input'] });
}

// ── Rollout digest (what the turn did) ──────────────────────────────────────────────────────
const READ_ONLY = /^(?:get-content|gc|cat|type|get-childitem|gci|ls|dir|rg|grep|select-string|sls|findstr|test-path|get-item|gi|resolve-path|get-location|pwd|where(?:\.exe)?|which|get-command|gcm|head|tail|wc|echo|write-output|write-host|measure-object|sort-object|select-object|format-table|format-list|out-string|get-date|get-process|get-filehash|tree|find|sed\s+-n|awk|jq|git\s+(?:status|log|diff|show|branch|rev-parse|remote|ls-files|blame|grep|describe|config\s+--get)|node\s+(?:-v|--version)|npm\s+(?:-v|--version|ls|view)|pnpm\s+(?:-v|--version|ls)|cargo\s+(?:--version|metadata)|python\s+--version)\b/iu;
const WRITES = /(?:^|[\s;|&])(?:>>?|set-content|add-content|out-file|new-item|remove-item|rm|del|move-item|mv|copy-item|cp|rename-item|ren|mkdir|md|rmdir|tee|tee-object)(?=[\s;|&]|$)/iu;

/** True when a shell command changes something or runs a program (tests, builds, scripts). */
export function isWorkCommand(command) {
  const list = Array.isArray(command) ? command : [command];
  const script = String(list[list.length - 1] ?? '').trim();
  if (!script) return false;
  if (WRITES.test(script)) return true;
  const parts = script.split(/\s*(?:\||;|&&|\|\|)\s*/u).map(part => part.replace(/^[&.]\s+/u, '').replace(/^["']|["']$/gu, '').trim()).filter(Boolean);
  return parts.some(part => !READ_ONLY.test(part));
}

/**
 * Digest of one turn from rollout JSONL lines (the slice that starts at this turn's
 * `turn_context`). Only counts and short labels leave this function.
 */
export function digestTurn(lines, turnId) {
  const parsed = [];
  for (const line of lines) { try { parsed.push(JSON.parse(line)); } catch { /* partial line */ } }
  let start = -1;
  for (let i = parsed.length - 1; i >= 0; i--) {
    const entry = parsed[i];
    if ((entry?.type === 'turn_context' && entry.payload?.turn_id === turnId)
      || (entry?.type === 'event_msg' && entry.payload?.type === 'task_started' && entry.payload?.turn_id === turnId)) { start = i; if (entry.type === 'turn_context') break; }
  }
  if (start < 0) return { available: false };
  const digest = { available: true, fileChanges: 0, workCommands: 0, tools: 0, delegated: 0, plan: null, userPrompt: null, reviewer: null, mode: null, lastMessage: null };
  for (const entry of parsed.slice(start)) {
    const payload = entry?.payload ?? {};
    if (entry?.type === 'turn_context') {
      if (payload.turn_id && payload.turn_id !== turnId) break; // the next turn started
      digest.reviewer = typeof payload.approvals_reviewer === 'string' ? payload.approvals_reviewer : digest.reviewer;
      digest.mode = typeof payload.collaboration_mode?.mode === 'string' ? payload.collaboration_mode.mode : digest.mode;
      continue;
    }
    if (entry?.type === 'event_msg' && payload.type === 'task_started' && payload.turn_id && payload.turn_id !== turnId) break;
    if (entry?.type === 'event_msg' && payload.type === 'task_complete' && typeof payload.last_agent_message === 'string') digest.lastMessage = payload.last_agent_message;
    if (entry?.type !== 'event_msg' || payload.type !== 'item_completed') continue;
    const item = payload.item ?? {};
    switch (item.type) {
      case 'UserMessage':
        if (digest.userPrompt === null) digest.userPrompt = (Array.isArray(item.content) ? item.content : []).map(part => typeof part?.text === 'string' ? part.text : '').join('\n').slice(0, 2000);
        break;
      case 'FileChange':
        if (item.status === undefined || item.status === 'completed') digest.fileChanges += item.changes && typeof item.changes === 'object' ? Math.max(1, Object.keys(item.changes).length) : 1;
        break;
      case 'CommandExecution':
        if ((item.status === undefined || item.status === 'completed') && isWorkCommand(item.command)) digest.workCommands += 1;
        break;
      case 'McpToolCall': case 'ImageGeneration': case 'WebSearch':
        if (item.type === 'McpToolCall') digest.tools += 1;
        break;
      case 'SubAgentActivity':
        if (item.kind === 'started') digest.delegated += 1;
        break;
      case 'Plan':
        if (typeof item.text === 'string' && item.text.trim()) {
          const heading = item.text.split('\n').map(line => line.trim()).find(Boolean) ?? '';
          digest.plan = { title: heading.replace(/^#{1,6}\s*/u, '').slice(0, 80) || null };
        }
        break;
      default: break;
    }
  }
  return digest;
}
