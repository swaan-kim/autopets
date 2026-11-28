// Screen copy check (#98). Finds Korean UI text that is hard for a first-time user:
// jargon, long sentences, the same thing called by different words, a stiff tone, and
// promises the app cannot prove. It reads source text only; it never runs the app.
// Existing copy is kept in a baseline so only new problems fail; fixing one shrinks it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = 'apps/desktop/src';
export const BASELINE = 'docs/development/ux-review/copy-baseline.json';
// Screens a first-time user meets. Settings and experimental panels may keep technical words.
const MAIN_PATH = ['features/pets/', 'features/onboarding/', 'features/tasks/', 'app/', 'shell/'];

const HANGUL = /[가-힣]/u;
// word → plain wording to try instead. Matched as written; keep entries specific.
export const JARGON = [
  ['MCP', '연결 도구'], ['훅', '자동 알림'], ['라우팅', '설정 고르기'], ['프로필', '설정'], ['개정', '수정 번호(가능하면 숨기기)'],
  ['위임', '맡기기'], ['런타임', '실행 환경'], ['프롬프트', '요청'], ['세션', '채팅'], ['커넥터', '연결 도구'],
  ['리비전', '수정 번호(가능하면 숨기기)'], ['토큰', '사용량'], ['추론', '꼼꼼함'], ['플러그인', '기능 묶음'], ['관측', '확인'],
  ['지침', '안내'], ['파라미터', '설정값'], ['엔드포인트', '연결 주소'], ['스키마', '형식'], ['petId', '(사용자에게 보이지 않게)'],
  ['recipe', '(사용자에게 보이지 않게)'], ['JSON', '(사용자에게 보이지 않게)'], ['CLI', '명령 창'], ['API', '연결'], ['동기화', '맞추기'],
];
// The words the team settled on in #96; the left side is the one to replace.
export const TERMS = [
  [/대화/u, '대화', '채팅'], [/누르세요/u, '누르세요', '눌러 주세요'], [/클릭/u, '클릭', '누르기'], [/에러/u, '에러', '문제'],
  [/오류가 발생/u, '오류가 발생했', '문제가 생겼어요'], [/수행/u, '수행', '하기'], [/확인 바랍니다/u, '확인 바랍니다', '확인해 주세요'],
];
// Claims that need observed evidence (AGENTS.md, docs/product/planning-execution.md "표시의 약속").
const PROMISE = /절감|아껴\s?(?:드|줘|요)|아낄\s?수|요금이\s?줄|비용이\s?줄|보장(?:해|합|돼|된)|무조건|확실히\s?(?:줄|좋)|자동으로\s?바꿨|바꿔\s?드렸/u;
const NEGATED = /(?:지\s?않|없어요|없습니다|아니에요|못\s?해요|않아요)/u;
const AI_TEXT = /(?:줘|주세요\s?\(AI\))[.!?]?(?:\s|$)|petId=|recipe=/u;
const FORMAL = /(?:습니다|십시오|합니까|됩니까)[.!?]?\s*$/u;
const LONG_SENTENCE = 50;

export const RULES = {
  promise: { level: 'error', label: '증명할 수 없는 약속', hint: '기록으로 확인한 사실만 말해요. 줄었다·보장한다·바꿨다는 말은 증거가 있을 때만 써요.' },
  jargon: { level: 'warn', label: '어려운 말', hint: '처음 쓰는 사람이 아는 말로 바꾸거나, 몰라도 되는 정보면 화면에서 빼요.' },
  long: { level: 'warn', label: '긴 문장', hint: `한 문장에 한 가지만. ${LONG_SENTENCE}자를 넘으면 나누거나 줄여요.` },
  terms: { level: 'warn', label: '같은 뜻 다른 말', hint: '팀이 정한 말로 맞춰요.' },
  formal: { level: 'warn', label: '딱딱한 말투', hint: '해요체로 써요.' },
};

const lineOf = (source, index) => source.slice(0, index).split('\n').length;
// Keep offsets: comments become spaces so reported line numbers stay right.
const blank = text => text.replace(/[^\n]/gu, ' ');
const stripComments = source => source
  .replace(/\/\*[\s\S]*?\*\//gu, blank)
  .replace(/(^|[\s;,(){}])\/\/[^\n]*/gu, (match, lead) => lead + blank(match.slice(lead.length)));

/** User-visible Korean strings in a TSX/TS source: string literals, template text and JSX text. */
export function extractStrings(source) {
  const code = stripComments(source);
  const found = [];
  const add = (raw, index) => {
    const text = raw.replace(/\$\{[^}]*\}/gu, '○').replace(/\\n/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (HANGUL.test(text)) found.push({ text, line: lineOf(code, index) });
  };
  for (const match of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/gu)) add(match[1] ?? match[2] ?? match[3], match.index);
  for (const match of code.matchAll(/>([^<>{}`'"]*[가-힣][^<>{}`'"]*)</gu)) add(match[1], match.index + 1);
  return found;
}

/** Problems in one string. `mainPath` turns on the jargon rule. */
export function checkText(text, { mainPath = true } = {}) {
  const problems = [];
  // Text the app hands to the AI, or a sample of the user's own words, is not screen copy.
  if (AI_TEXT.test(text)) return problems;
  const sentences = text.split(/(?<=[.!?])\s+/u);
  // "줄인다고 약속하지 않아요" is the honest form, so a negated sentence is fine.
  if (sentences.some(sentence => PROMISE.test(sentence) && !NEGATED.test(sentence))) problems.push({ rule: 'promise' });
  if (mainPath) for (const [word, plain] of JARGON) {
    const pattern = /^[A-Za-z]+$/u.test(word) ? new RegExp(`(^|[^A-Za-z])${word}([^A-Za-z]|$)`, 'u') : new RegExp(word, 'u');
    if (pattern.test(text)) problems.push({ rule: 'jargon', word, suggestion: plain });
  }
  for (const sentence of sentences) {
    if ([...sentence].length > LONG_SENTENCE) { problems.push({ rule: 'long', length: [...sentence].length }); break; }
  }
  for (const [pattern, word, plain] of TERMS) if (pattern.test(text)) problems.push({ rule: 'terms', word, suggestion: plain });
  if (FORMAL.test(text)) problems.push({ rule: 'formal' });
  return problems;
}

// Developer previews are not product screens.
const SKIP = [`${SOURCE}/development/`];
const isMainPath = file => MAIN_PATH.some(part => file.startsWith(`${SOURCE}/${part}`));
const key = finding => `${finding.file}|${finding.rule}|${finding.word ?? ''}|${finding.text}`;

export async function sourceFiles(dir = path.join(root, SOURCE)) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(full));
    else if (/\.(tsx|ts)$/u.test(entry.name) && !SKIP.some(part => path.relative(root, full).split(path.sep).join('/').startsWith(part)) && !/\.(test|d)\.ts$/u.test(entry.name)) files.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return files.sort();
}

export async function scan(files) {
  const findings = [];
  for (const file of files) {
    const source = await fs.readFile(path.join(root, file), 'utf8');
    for (const { text, line } of extractStrings(source)) {
      for (const problem of checkText(text, { mainPath: isMainPath(file) })) findings.push({ file, line, text, ...problem });
    }
  }
  return findings;
}

/** Findings not covered by the baseline, and baseline entries that no longer occur. */
export function compare(findings, baseline) {
  const left = new Map();
  for (const entry of baseline) left.set(key(entry), (left.get(key(entry)) ?? 0) + 1);
  const fresh = [];
  for (const finding of findings) {
    const count = left.get(key(finding)) ?? 0;
    if (count > 0) left.set(key(finding), count - 1); else fresh.push(finding);
  }
  const fixed = [...left.values()].reduce((sum, count) => sum + count, 0);
  return { fresh, fixed };
}

const print = (finding) => {
  const rule = RULES[finding.rule];
  const extra = finding.word ? ` · "${finding.word}" → ${finding.suggestion}` : finding.length ? ` · ${finding.length}자` : '';
  return `  ${rule.level === 'error' ? '✗' : '!'} ${finding.file}:${finding.line} [${rule.label}${extra}] ${finding.text.slice(0, 90)}`;
};

async function main(argv) {
  const flag = name => argv.includes(name);
  const filesAt = argv.indexOf('--files');
  const all = await sourceFiles();
  const only = filesAt >= 0 ? argv.slice(filesAt + 1).filter(item => !item.startsWith('--')).map(file => file.split(path.sep).join('/')) : null;
  const files = only ? all.filter(file => only.includes(file)) : all;
  const findings = await scan(files);
  const baselinePath = path.join(root, BASELINE);
  if (flag('--update-baseline')) {
    if (only) throw Error('Update the baseline from a full scan only (no --files).');
    const entries = findings.map(({ file, rule, word, text }) => ({ file, rule, ...(word ? { word } : {}), text }));
    await fs.writeFile(baselinePath, `${JSON.stringify({ version: 1, about: '기존 화면 문구에서 이미 알려진 점검 결과. 새로 생긴 것만 실패로 알리기 위한 기준선이에요. 고치면 줄어들고, 줄이는 것만 갱신해요(pnpm ux:check --update-baseline).', entries }, null, 1)}\n`);
    console.log(`기준선을 갱신했어요: ${entries.length}건`);
    return 0;
  }
  const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8')).entries.filter(entry => !only || only.includes(entry.file));
  const { fresh, fixed } = compare(findings, baseline);
  if (flag('--json')) { console.log(JSON.stringify({ scanned: files.length, findings: flag('--all') ? findings : fresh, baseline: baseline.length, fixed }, null, 1)); return fresh.length ? 1 : 0; }
  const byRule = Object.fromEntries(Object.keys(RULES).map(rule => [rule, findings.filter(item => item.rule === rule).length]));
  console.log(`화면 문구 점검: 파일 ${files.length}개 · 전체 ${findings.length}건 (${Object.entries(byRule).map(([rule, count]) => `${RULES[rule].label} ${count}`).join(', ')})`);
  console.log(`기준선 ${baseline.length}건 · 새로 생긴 것 ${fresh.length}건 · 고쳐진 것 ${fixed}건`);
  const shown = flag('--all') ? findings : fresh;
  for (const rule of Object.keys(RULES)) {
    const items = shown.filter(item => item.rule === rule);
    if (!items.length) continue;
    console.log(`\n${RULES[rule].label} — ${RULES[rule].hint}`);
    for (const item of items) console.log(print(item));
  }
  if (fixed && !only) console.log('\n고쳐진 항목이 있어요. `pnpm ux:check --update-baseline`으로 기준선을 줄여 주세요.');
  return fresh.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
}
