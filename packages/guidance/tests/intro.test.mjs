import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildIntroPrompt } from '../intro.mjs';
const read = async relative => JSON.parse(await fs.readFile(new URL(relative, import.meta.url), 'utf8'));
const brief = { audience: '팀원', message: '한 장으로 소개', points: ['핵심 내용 보존'], sourceText: 'DO_NOT_INJECT_RAW_SOURCE', sourceLabel: '원문' };
const style = { palette: ['#456A5B'], logoDataUrl: null, layout: 'landscape', copyLength: 'short' };
test('intro copy prompt includes necessary brief without raw source or execution claims', () => {
  const result = buildIntroPrompt({ brief, style, templateId: 'product-intro', pendingRevision: null });
  assert.ok(Buffer.byteLength(result) <= 3072);
  assert.match(result, /한 장으로 소개/);
  assert.match(result, /모델·모드 변경이나 도구 설치는 이 요청에 포함하지 않습니다/);
  assert.match(result, /사용자 확인을 대신하지/);
  assert.doesNotMatch(result, /DO_NOT_INJECT_RAW_SOURCE/);
});
test('oversized Korean brief is explicitly deferred, never silently truncated', () => {
  const project = { templateId: 'comparison', style, brief: { ...brief, audience: '대'.repeat(80), message: '메'.repeat(240), points: Array(5).fill('조건'.repeat(80)), sourceText: '가'.repeat(8000) }, pendingRevision: { kind: 'custom', instruction: '수'.repeat(500), baseVersionId: 'old-version' } };
  const result = buildIntroPrompt(project);
  assert.ok(Buffer.byteLength(result) <= 3072);
  assert.match(result, /pendingRevision을 inspect로 읽으세요/);
  assert.match(result, /조건을 추측하지 마세요/);
});
test('upstream source is pinned, all vendored files including license match hashes', async () => {
  const source = await read('../baoyu-source.json');
  const catalog = await read('../../contracts/data/intro-templates.json');
  assert.match(source.commit, /^[a-f0-9]{40}$/);
  assert.equal(catalog.skill.commit, source.commit);
  assert.equal(catalog.skill.version, source.version);
  assert.equal(source.license, 'MIT');
  assert.ok(source.files.some(file => file.path === 'LICENSE'));
  for (const file of source.files) {
    assert.ok(!file.path.includes('..') && !file.path.startsWith('/'));
    const data = await fs.readFile(new URL(`../vendor/baoyu-infographic/${file.path}`, import.meta.url));
    assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256, file.path);
  }
  assert.deepEqual(catalog.templates.map(template => template.id).sort(), ['comparison', 'plan-summary', 'product-intro']);
});
