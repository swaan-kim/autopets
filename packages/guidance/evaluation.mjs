import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { evaluationCases } from './evaluation-cases.mjs';
import { classifyTask, buildGuidance } from './index.mjs';
import { defaultPreferences, utf8Bytes } from '../contracts/index.mjs';

const median = values => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2; };
const validNumber = value => Number.isFinite(value) && value >= 0;
export function evaluateLocalRules() {
  const preferences = { ...defaultPreferences(), enabled: true };
  return { mode: 'local-rules-only', extraModelCalls: 0, liveQualityEvaluated: false, liveSavingsMeasured: false,
    cases: evaluationCases.map(item => { const start = performance.now(), recipe = classifyTask(item.prompt), guidance = buildGuidance({ recipe, preferences });
      return { caseId: item.id, expectedRecipe: item.group, selectedRecipe: recipe.id, injectionBytes: utf8Bytes(guidance), preparationMs: Number((performance.now() - start).toFixed(4)), classificationMatches: recipe.id === item.group }; }) };
}
export function compareMeasurements(rows) {
  if (!Array.isArray(rows) || rows.length > 5000) throw new Error('measurement-array');
  const keys = new Set(), byVariant = new Map();
  for (const row of rows) {
    if (!evaluationCases.some(item => item.id === row.caseId) || !['native-default', 'usual', 'autopets'].includes(row.variant)
      || !['live', 'fixture'].includes(row.source) || !['codex', 'chatgpt'].includes(row.provider)
      || !Number.isSafeInteger(row.trial) || row.trial < 1 || !row.environmentVersion
      || !row.quality || typeof row.quality.acceptable !== 'boolean' || typeof row.quality.criticalError !== 'boolean'
      || !row.metrics || ['elapsedMs', 'settingsActions', 'reworkCount'].some(key => !validNumber(row.metrics[key]))
      || !(row.metrics.totalTokens === null || validNumber(row.metrics.totalTokens))
      || row.usageScope !== 'full-task' || row.includesAllOverhead !== true) throw new Error('measurement-shape-or-incomplete-cost');
    const key = JSON.stringify([row.caseId, row.provider, row.environmentVersion, row.source, row.trial]);
    if (keys.has(`${key}:${row.variant}`)) throw new Error('duplicate-measurement'); keys.add(`${key}:${row.variant}`);
    byVariant.set(`${key}:${row.variant}`, row);
  }
  const comparisons = [];
  for (const baseline of ['native-default', 'usual']) {
    const pairs = rows.filter(row => row.variant === 'autopets').map(row => {
      const key = JSON.stringify([row.caseId, row.provider, row.environmentVersion, row.source, row.trial]);
      return [byVariant.get(`${key}:${baseline}`), row];
    }).filter(([a]) => a);
    const accepted = row => row.quality.acceptable && !row.quality.criticalError;
    const regressions = pairs.filter(([a, b]) => accepted(a) && !accepted(b)).map(([, b]) => b.caseId);
    const measured = pairs.filter(([a, b]) => a.source === 'live' && b.source === 'live');
    const metric = name => ({ baselineMedian: median(measured.map(([a]) => a.metrics[name]).filter(validNumber)), autopetsMedian: median(measured.map(([, b]) => b.metrics[name]).filter(validNumber)) });
    const tokenPairs = measured.filter(([a, b]) => validNumber(a.metrics.totalTokens) && validNumber(b.metrics.totalTokens));
    const perAccepted = (index, metricName, sample) => {
      const acceptedCount = sample.filter(pair => accepted(pair[index])).length;
      return acceptedCount ? sample.reduce((sum, pair) => sum + pair[index].metrics[metricName], 0) / acceptedCount : null;
    };
    comparisons.push({ baseline, pairCount: pairs.length, livePairCount: measured.length, qualityRegressions: regressions,
      excludedFromAutomaticSavings: [...new Set(regressions)], elapsedMs: metric('elapsedMs'), settingsActions: metric('settingsActions'), reworkCount: metric('reworkCount'),
      totalTokens: { availablePairs: tokenPairs.length, baselinePerAcceptableResult: perAccepted(0, 'totalTokens', tokenPairs), autopetsPerAcceptableResult: perAccepted(1, 'totalTokens', tokenPairs) },
      note: '실패·추가 지침·기록·검토·재시도를 포함한 작업 전체 비용. 토큰을 관측하지 못한 사례는 추정하지 않음.' });
  }
  return { mode: 'imported-measurements', measurements: rows.length, comparisons, automaticRoutingEnabled: false, note: '평가 보고서만 생성하며 배포 모델 정책을 자동으로 승인하지 않습니다.' };
}
export async function main() {
  const args = process.argv.slice(2); let results, out;
  while (args.length) { const key = args.shift(); if (!['--results', '--out'].includes(key) || !args.length) throw new Error('arguments'); const value = args.shift(); if (key === '--results') results = value; else out = value; }
  const report = results ? compareMeasurements(JSON.parse(await readFile(path.resolve(results), 'utf8'))) : evaluateLocalRules();
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (out) { const file = path.resolve(out); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); }
  console.log(text);
}
export async function runCli() { await main().catch(error => { console.error(`Evaluation failed: ${error.message}`); process.exitCode = 1; }); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
