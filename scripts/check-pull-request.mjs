import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const headingNames = [
  ['한눈에 보기', '무엇이 좋아졌나'],
  ['사용 흐름과 전후 비교', 'Before → After'],
  ['바꾼 내용과 이유', '핵심 변경'],
  ['확인한 내용과 남은 점', '검사와 제한'],
  ['함께 확인할 점', '검토 요청'],
];
const handoffFields = [
  ['관련 작업과 검사', '작업·검사 기준'],
  ['영향을 받는 곳', '수정 범위'],
  ['선택한 이유', '결정과 이유'],
  ['그대로 유지할 것', '유지할 계약'],
  ['확인한 것', '완료한 것'],
  ['아직 남은 것', '남은 일'],
  ['이어서 할 일', '다음 행동·재현'],
];
const clean = text => text.replace(/<!--[\s\S]*?-->/gu, '');
function withoutFencedCode(text) {
  let fence;
  return text.split(/\r?\n/u).map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}
const meaningful = text => {
  const value = text.replace(/<[^>]*>/gu, '').replace(/[`*_\s|\-]/gu, '').trim();
  return value.length >= 2 && !/^(?:TODO|TBD|N\/?A|없음|미작성|작성필요|해당없음|입력|예정)$/iu.test(value)
    && !/^(?:\[[^\]]*\]|<[^>]*>)$/u.test(value);
};

// Parse only real headings; quoted examples and fenced code are not PR sections.
function sectionsOf(body) {
  const sections = new Map();
  let current, fence;
  for (const line of body.split(/\r?\n/u)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
    }
    if (!fence && !marker) {
      const heading = /^\s{0,3}##\s+(.+?)\s*#*\s*$/u.exec(line)?.[1];
      if (heading) {
        current = headingNames.find(names => names.includes(heading))?.[0] ?? heading;
        if (sections.has(current)) throw Error(`중복 구역: ${current}`);
        sections.set(current, []);
        continue;
      }
    }
    if (current) sections.get(current).push(line);
  }
  return new Map([...sections].map(([key, lines]) => [key, lines.join('\n').trim()]));
}

function field(text, name) {
  const names = Array.isArray(name) ? name : [name];
  return text.split(/\r?\n/u).map(line => /^\s*[-*]\s+(.+?):\s*(.*)$/u.exec(line))
    .find(match => names.includes(match?.[1]))?.[2]?.trim() ?? '';
}

/** Structure and evidence presence only. Does not certify images, test results or approval. */
export function validatePullRequest(body) {
  if (typeof body !== 'string' || !body.trim()) return ['PR 설명을 작성하세요.'];
  if (body.length > 100000) return ['PR 설명은 100,000자 이내로 줄이고 상세 자료를 연결하세요.'];
  const errors = [], text = withoutFencedCode(clean(body)).split(/\r?\n/u)
    .filter(line => !/^\s*>/u.test(line)).join('\n');
  const details = [...text.matchAll(/<details>\s*<summary>(?:개발 기록과 다음 작업|다음 AI에게)<\/summary>([\s\S]*?)<\/details>/gu)];
  const visible = text.replace(/<details\b[^>]*>[\s\S]*?<\/details>/gu, '');
  let sections;
  try { sections = sectionsOf(visible); }
  catch (error) { return [error.message]; }
  for (const [name] of headingNames) {
    const section = sections.get(name) ?? '';
    if (!meaningful(section)) errors.push(`비어 있거나 누락된 구역: ${name}`);
  }
  const evidence = sections.get('사용 흐름과 전후 비교') ?? '';
  const comparisonRecord = `${evidence}\n${details.length === 1 ? details[0][1] : ''}`;
  const kind = field(comparisonRecord, '비교 유형');
  if (!['화면', '동작', '신규 기능', '문서'].includes(kind)) errors.push('비교 유형은 화면 / 동작 / 신규 기능 / 문서 중 하나를 적으세요.');
  const level = field(comparisonRecord, '근거 수준');
  if (!/(?:실제 실행|합성 검사|디자인 예시)/u.test(level) && !(kind === '문서' && /문서 검토/u.test(level))) {
    errors.push('근거 수준을 실제 실행 / 합성 검사 / 디자인 예시로 구분하세요. 문서는 문서 검토로 적을 수 있어요.');
  }
  if (!meaningful(field(comparisonRecord, '비교 조건'))) errors.push('비교 조건에 같은 입력·데이터·화면/배율·상태를 적으세요. 문서는 비교한 문서와 읽는 상황을 적으세요.');
  const image = /!\[[^\]]*\]\((?:https:\/\/|docs\/changes\/|\.\/docs\/changes\/)[^)]+\)|<img\b[^>]*\bsrc=["'](?:https:\/\/|docs\/changes\/)[^"']+["']/iu.test(evidence);
  const table = evidence.split(/\r?\n/u).filter(line => /^\s*\|/u.test(line))
    .filter(line => !/^\s*\|?\s*[-:]+\s*\|/u.test(line));
  const cells = line => line.trim().replace(/^\||\|$/gu, '').split('|').map(cell => cell.trim());
  const header = cells(table[0] ?? '');
  const beforeColumn = header.findIndex(cell => /\bBefore\b|이전|변경 전/iu.test(cell));
  const afterColumn = header.findIndex(cell => /\bAfter\b|변경|개선 후/iu.test(cell) && !/변경 전/u.test(cell));
  const comparison = beforeColumn >= 0 && afterColumn >= 0 && beforeColumn !== afterColumn
    && table.slice(1).some(line => {
      const row = cells(line);
      return meaningful(row[beforeColumn] ?? '') && meaningful(row[afterColumn] ?? '');
    });
  const missingBefore = /이전\s*(?:자료|화면|기능)\s*없음/u.test(evidence)
    && meaningful(field(evidence, '이전 자료 없음'));
  if (kind === '화면' && !image) errors.push('화면 변경에는 공개 가능한 Before/After 이미지를 연결하세요.');
  if (kind === '동작' && !comparison) errors.push('동작 변경에는 같은 입력의 이전/변경 동작 표를 적으세요.');
  if (kind === '문서' && !comparison) errors.push('문서 변경에는 이전 설명과 바뀐 설명을 비교하는 표를 적으세요.');
  if (kind === '신규 기능' && !image && !comparison) errors.push('신규 기능은 이미지나 동작 표로 보여주세요.');
  if (kind === '화면' && !comparison && !missingBefore) errors.push('Before/After 표를 채우거나 이전 자료가 없는 이유를 적으세요.');
  if (details.length !== 1) errors.push('본문 아래에 접힌 개발 기록과 다음 작업 구역을 하나 작성하세요.');
  else for (const names of handoffFields) {
    const value = field(details[0][1], names);
    if (!meaningful(value)) errors.push(`개발 기록을 구체적으로 적으세요: ${names[0]}`);
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, file, ...extra] = process.argv.slice(2);
    if (!['--body', '--event'].includes(mode) || !file || extra.length) throw Error('사용법: pnpm review:check --body <PR설명.md> 또는 --event <GitHub event.json>');
    const input = await readFile(file, 'utf8');
    const body = mode === '--event' ? JSON.parse(input).pull_request?.body : input;
    const errors = validatePullRequest(body);
    if (errors.length) {
      console.error(errors.map(error => `- ${error}`).join('\n'));
      process.exitCode = 1;
    } else console.log('PR 요약·사용 흐름·선택 이유·확인 결과·개발 기록 형식 확인 완료. 설명의 품질과 근거의 사실 여부, 사람 검토는 별도입니다.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
