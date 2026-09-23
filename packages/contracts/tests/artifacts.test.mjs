import test from 'node:test';
import assert from 'node:assert/strict';
import { validateArtifactRequest, validateIntroBrief, validateIntroStyle, INTRO_LIMITS } from '../artifacts.mjs';
const identity = { provider: 'codex', accountId: 'session:test', chatId: 'chat-a' };
const brief = { audience: '팀원', message: '공유 자료 만들기', points: ['핵심 내용 유지'], sourceText: '실험용 원문', sourceLabel: '시연 자료' };
const style = { palette: ['#456A5B'], logoDataUrl: null, layout: 'landscape', copyLength: 'short' };
test('artifact brief accepts Korean and Unicode scalar limits without coercing content', () => {
  assert.equal(validateIntroBrief(brief), brief);
  validateIntroBrief({ ...brief, audience: '🐾'.repeat(80) });
  for (const bad of [{ ...brief, audience: '' }, { ...brief, points: [] }, { ...brief, points: ['가'.repeat(161)] }, { ...brief, sourceText: '가'.repeat(8001) }, { ...brief, transcript: 'private' }, { ...brief, message: '\ud800' }]) assert.throws(() => validateIntroBrief(bad));
});
test('style contract allows only reusable presentation choices, not chat contents', () => {
  assert.equal(validateIntroStyle(style), style);
  for (const bad of [{ ...style, palette: ['red'] }, { ...style, palette: [] }, { ...style, sourceText: 'other chat' }, { ...style, logoDataUrl: 'https://example.com/logo.png' }, { ...style, logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }, { ...style, logoDataUrl: 'data:image/png;base64,AAA' }]) assert.throws(() => validateIntroStyle(bad));
});
test('artifact writes require scoped identity, optimistic revision and exact operation fields', () => {
  const save = { operation: 'save-brief', identity, expectedRevision: 0, templateId: 'product-intro', brief, style };
  assert.equal(validateArtifactRequest(save), save);
  for (const bad of [{ ...save, identity: { ...identity, chatId: '' } }, { ...save, expectedRevision: -1 }, { ...save, expectedRevision: 1.5 }, { ...save, templateId: 'unknown' }, { ...save, acceptedAt: Date.now() }]) assert.throws(() => validateArtifactRequest(bad));
  assert.throws(() => validateArtifactRequest({ operation: '__proto__' }));
  assert.throws(() => validateArtifactRequest({ operation: 'import-version', identity, expectedRevision: 0, pngBytes: [256, ...Array(32).fill(0)], renderedText: 'text' }));
  assert.throws(() => validateArtifactRequest({ operation: 'import-version', identity, expectedRevision: 0, pngBytes: Array(33).fill(0), renderedText: '' }));
  assert.throws(() => validateArtifactRequest({ operation: 'delete-style', styleId: '../escape' }));
  validateArtifactRequest({ operation: 'save-style', identity, expectedRevision: 1, versionId: 'v1', name: '짧은 초록 소개' });
  assert.equal(INTRO_LIMITS.pngBytes, 5242880);
});
