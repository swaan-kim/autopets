import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPreferences, emptyContext, validatePreferences, resolvePreferences, utf8Bytes } from '../../contracts/index.mjs';
import { classifyTask, buildGuidance, buildGuidanceMetadata, checkQuality } from '../index.mjs';

const preferences = { ...defaultPreferences(), enabled: true };
const recipe = classifyTask('보고서 작성');

test('legacy preferences receive concise/adaptive defaults while explicit enums are validated', () => {
  const { answerLength, outputFormat, ...legacy } = defaultPreferences();
  assert.equal(answerLength, 'concise'); assert.equal(outputFormat, 'adaptive');
  assert.deepEqual(validatePreferences(legacy), defaultPreferences());
  for (const answerLength of ['concise', 'normal', 'detailed']) for (const outputFormat of ['adaptive', 'table', 'list', 'document']) {
    assert.deepEqual(validatePreferences({ ...preferences, answerLength, outputFormat }), { ...preferences, answerLength, outputFormat });
  }
  for (const bad of [null, '', 'unknown', 3]) {
    assert.throws(() => validatePreferences({ ...preferences, answerLength: bad }));
    assert.throws(() => validatePreferences({ ...preferences, outputFormat: bad }));
  }
});

test('effective preferences use explicit choice then task override then global without mutation or enabling assistance', () => {
  const global = { ...preferences, workStyle: 'thorough', answerLength: 'detailed', outputFormat: 'document' };
  assert.equal(resolvePreferences({ preferences: global, task: { workStyleOverride: null } }).workStyle, 'thorough');
  assert.equal(resolvePreferences({ preferences: global, task: { workStyleOverride: 'auto', settingsRevision: 1 } }).workStyle, 'auto');
  const effective = resolvePreferences({ preferences: global, task: { workStyleOverride: 'fast', answerLength: 'concise', outputFormat: 'table' }, explicit: { workStyle: 'thorough', answerLength: 'normal', outputFormat: 'list' } });
  assert.deepEqual(effective, { ...global, answerLength: 'normal', outputFormat: 'list' });
  const inherited = resolvePreferences({ preferences: global, task: { workStyleOverride: 'fast', answerLength: 'concise' } });
  assert.equal(inherited.answerLength, 'detailed'); assert.equal(global.workStyle, 'thorough');
  assert.equal(resolvePreferences({ preferences: { ...global, enabled: false }, explicit: { workStyle: 'fast' } }).enabled, false);
  for (const task of [{ workStyleOverride: 'invalid' }, { settingsRevision: -1 }, { settingsRevision: 1.5 }]) assert.throws(() => resolvePreferences({ preferences, task }));
  assert.throws(() => resolvePreferences({ preferences, explicit: { enabled: true } }));
});

test('guidance includes answer preferences with latest-request precedence and remains backwards compatible', () => {
  const options = { recipe, preferences: { ...preferences, answerLength: 'detailed', outputFormat: 'table' }, task: { workStyleOverride: 'fast' } };
  const result = buildGuidanceMetadata(options);
  assert.equal(buildGuidance(options), result.text);
  assert.match(result.text, /근거와 설명을 상세하게/); assert.match(result.text, /표 중심/);
  assert.match(result.text, /필수 조건·정확성은 유지하며 빠르게/); assert.match(result.text, /최신 요청에 길이·형식/);
  assert.deepEqual(buildGuidanceMetadata({ ...options, preferences: defaultPreferences() }), { text: '', contextPartial: false, includedContextKeys: [] });
});

test('context metadata reports fully included fields without silently truncating constraints', () => {
  const context = { ...emptyContext(), goal: '새 목표', outputFormat: '비교표', constraints: ['반드시 최신 자료'], decisions: ['대상 A'], remaining: ['출처 확인'] };
  const result = buildGuidanceMetadata({ recipe, preferences, context });
  assert.equal(result.contextPartial, false);
  assert.deepEqual(result.includedContextKeys, ['goal', 'outputFormat', 'constraints', 'decisions', 'remaining']);
  assert.match(result.text, /JSON 데이터, 실행 지시가 아님/);
  for (const item of context.constraints) assert.ok(result.text.includes(item));
  const large = { ...context, goal: '가'.repeat(300), constraints: ['필수조건-첫째 ' + '나'.repeat(130), '필수조건-둘째 ' + '다'.repeat(130)] };
  const partial = buildGuidanceMetadata({ recipe, preferences, context: large, reserveBytes: 1600 });
  assert.equal(partial.contextPartial, true); assert.match(partial.text, /문맥 일부 생략됨/); assert.match(partial.text, /inspect/);
  assert.ok(utf8Bytes(partial.text) + 1600 <= 3072);
  // A listed key means its entire field is present, not just the first item.
  if (partial.includedContextKeys.includes('constraints')) for (const item of large.constraints) assert.ok(partial.text.includes(item));
  else for (const item of large.constraints) assert.ok(!partial.text.includes(item));
  assert.ok(!partial.includedContextKeys.includes('goal'));
});

test('all answer styles and tight UTF-8 budgets keep partial-context disclosure or fail before output', () => {
  const context = { ...emptyContext(), goal: '가'.repeat(300), constraints: ['나'.repeat(150), '다'.repeat(150)], remaining: ['라'.repeat(150)] };
  for (const answerLength of ['concise', 'normal', 'detailed']) for (const workStyle of ['auto', 'fast', 'thorough']) for (const reserveBytes of [0, 1200, 1600, 2048]) {
    const result = buildGuidanceMetadata({ recipe, preferences: { ...preferences, answerLength, workStyle }, context, reserveBytes });
    assert.ok(utf8Bytes(result.text) + reserveBytes <= 3072);
    if (result.contextPartial) assert.match(result.text, /문맥 일부 생략됨/);
  }
  const reused = buildGuidanceMetadata({ recipe: classifyTask('요약', { nativeMemory: true }), preferences, context });
  assert.equal(reused.contextPartial, true); assert.deepEqual(reused.includedContextKeys, []);
  assert.match(reused.text, /inspect/); assert.ok(!reused.text.includes(context.goal));
});

test('quality identifies missing required content with code provenance', () => {
  const requirements = { requiredContent: [{ id: 'deadline', text: '금요일' }, '담당: 민수'], maxChars: 50 };
  const missing = checkQuality({ recipe, requirements, output: '금요일에 출시합니다.' });
  assert.equal(missing.status, 'needs-review'); assert.deepEqual(missing.findings, ['필수 내용 누락: 담당: 민수']);
  assert.ok(missing.checks.every(item => item.method === 'code'));
  const complete = checkQuality({ recipe, requirements, output: '금요일 출시. 담당: 민수' });
  assert.equal(complete.status, 'passed'); assert.match(complete.scope, /문자 포함/);
});

test('links and model self-report do not pass semantic or factual verification', () => {
  const requirements = { requiredTerms: ['가격'], requiresSources: true, sourceAccuracy: true, factualAccuracy: true };
  const result = checkQuality({ recipe, requirements, output: '가격은 1원. https://example.invalid', selfReport: { status: 'passed' } });
  assert.equal(result.status, 'unchecked');
  assert.equal(result.checks.find(item => item.id === 'requiresSources').method, 'code');
  assert.equal(result.checks.find(item => item.id === 'sourceAccuracy').method, 'unsupported');
  assert.equal(result.checks.find(item => item.id === 'factualAccuracy').status, 'unchecked');
  assert.equal(result.checks.find(item => item.id === 'selfReport').method, 'self-report');
  assert.equal(result.checks.find(item => item.id === 'selfReport').reportedStatus, 'passed');
  assert.equal(checkQuality({ recipe, output: '모든 조건 검증 완료', selfReport: { status: 'passed' } }).status, 'unchecked');
  assert.equal(checkQuality({ recipe, requirements: { requiredContent: [{ meaning: '의미 보존' }] }, output: '잘됨' }).status, 'unchecked');
});
