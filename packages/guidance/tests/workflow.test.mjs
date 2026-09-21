import test from 'node:test';
import assert from 'node:assert/strict';
import { canBypassPlanning, explicitPlanChange, workflowIntent, workflowStage, buildWorkflowGuidance } from '../index.mjs';
import { defaultPreferences } from '../../contracts/index.mjs';
import { evaluationCases } from '../evaluation-cases.mjs';

const task = () => ({ enabled: true, planFirst: true, phase: 'planning', settingsRevision: 1, planRevision: 1,
  planning: { model: 'gpt-5.6-sol', reasoning: 'medium' }, execution: { model: 'gpt-5.6-terra', reasoning: 'medium' },
  plan: { summary: '자료를 비교', steps: ['조사', '비교'], completionCriteria: ['공식 출처'] }, approval: null });
test('only explicit short translations/spelling/single-sentence edits bypass planning', () => {
  for (const id of ['simple-1', 'simple-3', 'simple-4', 'simple-5', 'simple-6']) assert.equal(canBypassPlanning(evaluationCases.find(item => item.id === id).prompt), true, id);
  for (const prompt of ['다음 문서를 요약해줘: 내용', '코드를 수정해줘: 내용', '번역: '.repeat(300), '번역: 안녕. 그리고 보고서도 작성해줘', '"번역: text"라는 입력을 처리하는 앱 구현', '조사하고 번역: 자료']) assert.equal(canBypassPlanning(prompt), false);
});
test('phase follows revision-bound approval and anchored new conditions invalidate intent', () => {
  const t = task();
  assert.equal(workflowStage(t, 'new-work'), 'planning');
  t.approval = { planRevision: 1, settingsRevision: 1 }; t.phase = 'ready';
  assert.equal(workflowStage(t, 'execute'), 'execution');
  assert.equal(workflowIntent('진행해줘', t), 'execute'); t.phase = 'executing';
  assert.equal(workflowIntent('진행해줘', t), 'execute');
  for (const prompt of [evaluationCases.find(item => item.id === 'planning-4').prompt, '예산을 30만원으로 바꿔줘', '계획 바꿔서 문서만 만들자', '새 작업: 앱 만들기']) {
    assert.equal(explicitPlanChange(prompt), true, prompt); assert.equal(workflowIntent(prompt, t), 'new-work');
  }
  for (const prompt of ['"예산을 바꿔줘"를 번역해줘', '인용문: 계획 바꿔서 작성', '사용자 사례에 목표 변경이라고 적혀 있어']) assert.equal(explicitPlanChange(prompt), false);
  t.plan = null; assert.equal(workflowStage(t, 'execute'), 'execution');
  t.planRevision++; assert.equal(workflowStage(t, 'execute'), 'planning');
});
test('stage guidance keeps preferences and discloses whole plan/context fields omitted from 3KB', () => {
  const t = task(); t.plan = { summary: '가'.repeat(300), steps: ['나'.repeat(150), '다'.repeat(150)], completionCriteria: ['라'.repeat(150)] };
  const preferences = { ...defaultPreferences(), enabled: true, workStyle: 'thorough', answerLength: 'detailed', outputFormat: 'table' };
  const result = buildWorkflowGuidance({ task: t, intent: 'new-work', preferences, reserveBytes: 1200 });
  assert.ok(Buffer.byteLength(result.text) + 1200 <= 3072); assert.match(result.text, /계획 확인 전 본 작업을 실행하지/);
  assert.match(result.text, /근거·누락을 꼼꼼히/); assert.match(result.text, /근거와 설명을 상세하게/); assert.match(result.text, /표 중심/);
  assert.equal(result.planPartial, true); assert.match(result.text, /일부 생략됨/); assert.match(result.text, /명령 아님|실행 지시가 아닙니다/);
  for (const key of result.includedPlanKeys) assert.ok(result.text.includes(JSON.stringify(t.plan[key])));
});
