import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluationCases } from '../evaluation-cases.mjs';
import { evaluateLocalRules, compareMeasurements } from '../evaluation.mjs';
test('24 Korean prompts cover four work types without manufacturing quality or savings scores', () => {
  assert.equal(evaluationCases.length, 24);
  for (const group of ['simple', 'research', 'document', 'planning']) assert.equal(evaluationCases.filter(item => item.group === group).length, 6);
  const report = evaluateLocalRules();
  assert.equal(report.liveQualityEvaluated, false); assert.equal(report.liveSavingsMeasured, false);
  assert.ok(report.cases.every(item => item.injectionBytes <= 3072));
  assert.ok(report.cases.every(item => item.classificationMatches));
});
const row = (variant, extra = {}) => ({ caseId: 'simple-1', variant, provider: 'codex', environmentVersion: 'fixture-v1', source: 'live', trial: 1,
  quality: { acceptable: true, criticalError: false }, metrics: { totalTokens: 100, elapsedMs: 1000, settingsActions: 2, reworkCount: 0 }, usageScope: 'full-task', includesAllOverhead: true, ...extra });
test('comparison pairs exact environments, counts failed runs, and never estimates missing tokens', () => {
  const rows = [row('native-default'), row('autopets', { quality: { acceptable: false, criticalError: true }, metrics: { totalTokens: 50, elapsedMs: 500, settingsActions: 0, reworkCount: 1 } }), row('usual', { metrics: { totalTokens: null, elapsedMs: 1200, settingsActions: 3, reworkCount: 1 } })];
  const report = compareMeasurements(rows);
  assert.deepEqual(report.comparisons[0].excludedFromAutomaticSavings, ['simple-1']);
  assert.equal(report.comparisons[0].totalTokens.autopetsPerAcceptableResult, null);
  assert.equal(report.comparisons[1].totalTokens.availablePairs, 0);
  assert.equal(report.automaticRoutingEnabled, false);
  assert.equal(compareMeasurements([row('native-default'), row('autopets', { environmentVersion: 'different' })]).comparisons[0].pairCount, 0);
});
test('evaluation rejects partial cost and duplicate results; fixtures cannot become measured savings', () => {
  assert.throws(() => compareMeasurements([row('autopets', { includesAllOverhead: false })]));
  assert.throws(() => compareMeasurements([row('autopets'), row('autopets')]));
  assert.equal(compareMeasurements([row('native-default', { source: 'fixture' }), row('autopets', { source: 'fixture' })]).comparisons[0].livePairCount, 0);
});
test('stage overhead and subscription credits stay separate from tokens and unknown costs', () => {
  const stages = Object.fromEntries(['planning', 'guidance', 'execution', 'review', 'retries'].map(stage => [stage, { totalTokens: 20, elapsedMs: 200, subscriptionCredits: null }]));
  const report = compareMeasurements([row('native-default', { stages }), row('autopets', { stages })]);
  assert.equal(report.comparisons[0].stages.planning.totalTokens.baselineMedian, 20);
  assert.equal(report.comparisons[0].subscriptionCredits.availablePairs, 0);
  assert.equal(report.comparisons[0].subscriptionCredits.autopetsPerAcceptableResult, null);
  assert.equal(compareMeasurements([row('autopets')]).comparisons[0].stages.execution.totalTokens.autopetsMedian, null);
  assert.throws(() => compareMeasurements([row('autopets', { stages: { planning: stages.planning } })]), /measurement-stages/);
  assert.throws(() => compareMeasurements([row('autopets', { stages, metrics: { totalTokens: 10, elapsedMs: 1000, settingsActions: 0, reworkCount: 0 } })]), /stage-total/);
});
