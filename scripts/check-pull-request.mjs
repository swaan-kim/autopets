import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const headings = ['무엇이 좋아졌나', 'Before → After', '핵심 변경', '검사와 제한', '검토 요청'];
const handoffFields = ['작업·검사 기준', '수정 범위', '결정과 이유', '유지할 계약', '완료한 것', '남은 일', '다음 행동·재현'];
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
        current = heading;
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
  return text.split(/\r?\n/u).map(line => /^\s*[-*]\s+(.+?):\s*(.*)$/u.exec(line))
    .find(match => match?.[1] === name)?.[2]?.trim() ?? '';
}

/** Structure and evidence presence only. Does not certify images, test results or approval. */
export function validatePullRequest(body) {
  if (typeof body !== 'string' || !body.trim()) return ['PR 설명을 작성하세요.'];
  if (body.length > 100000) return ['PR 설명은 100,000자 이내로 줄이고 상세 자료를 연결하세요.'];
  const errors = [], text = clean(body);
  let sections;
  try { sections = sectionsOf(text); }
  catch (error) { return [error.message]; }
  for (const name of headings) {
    const section = sections.get(name)?.replace(/<details>[\s\S]*?<\/details>/gu, '') ?? '';
    if (!meaningful(section)) errors.push(`비어 있거나 누락된 구역: ${name}`);
  }
  const evidence = withoutFencedCode(sections.get('Before → After') ?? '');
  const kind = field(evidence, '비교 유형');
  if (!['화면', '동작', '신규 기능'].includes(kind)) errors.push('비교 유형은 화면 / 동작 / 신규 기능 중 하나를 적으세요.');
  if (!/(?:실제 실행|합성 검사|디자인 예시)/u.test(field(evidence, '근거 수준'))) errors.push('근거 수준을 실제 실행 / 합성 검사 / 디자인 예시로 구분하세요.');
  for (const name of ['기준 소스', '변경 소스']) {
    const value = field(evidence, name);
    // New features can compare an empty prior state, but still identify its source.
    if (!/\b[a-f0-9]{7,40}\b/iu.test(value)) errors.push(`${name}에 비교·검사한 커밋 SHA를 적으세요.`);
  }
  if (!meaningful(field(evidence, '비교 조건'))) errors.push('비교 조건에 같은 입력·데이터·화면/배율·상태를 적으세요.');
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
  if (kind === '신규 기능' && !image && !comparison) errors.push('신규 기능은 이미지나 동작 표로 보여주세요.');
  if (kind === '화면' && !comparison && !missingBefore) errors.push('Before/After 표를 채우거나 이전 자료가 없는 이유를 적으세요.');
  const details = [...withoutFencedCode(text).matchAll(/<details>\s*<summary>다음 AI에게<\/summary>([\s\S]*?)<\/details>/gu)];
  if (details.length !== 1) errors.push('접힌 다음 AI에게 구역을 하나 작성하세요.');
  else for (const name of handoffFields) {
    const value = field(details[0][1], name);
    if (!meaningful(value)) errors.push(`AI 인계 항목을 구체적으로 적으세요: ${name}`);
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
    } else console.log('PR 요약·전후 비교·검사·AI 인계 형식 확인 완료. 근거의 진실성과 사람 검토는 별도입니다.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
