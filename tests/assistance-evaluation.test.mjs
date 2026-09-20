import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluationCases } from '../packages/guidance/evaluation-cases.mjs';
import { evaluateLocalRules, compareMeasurements } from '../scripts/evaluate-assistance.mjs';
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
