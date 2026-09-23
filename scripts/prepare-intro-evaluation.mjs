import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateIntroBrief } from '../packages/contracts/artifacts.mjs';

export const CONDITIONS = Object.freeze(['A', 'B', 'C', 'D']);
export function prepareEvaluation(cases, skillCommit) {
  if (cases.length !== 6 || new Set(cases.map(item => item.id)).size !== 6) throw Error('six-unique-cases-required');
  const rows = [];
  for (const item of cases) {
    validateIntroBrief(item.brief);
    for (const condition of CONDITIONS) for (let repeat = 1; repeat <= 3; repeat++) {
      const runId = `${item.id}-${condition}-${repeat}`;
      rows.push({ runId, blindId: createHash('sha256').update(`intro-v1:${runId}`).digest('hex').slice(0, 12), caseId: item.id,
        condition, repeat, skillCommit, status: 'not-run', model: null, reasoning: null, toolVersion: null,
        materialHash: null, instructionPacketHash: null, environment: null, participantId: null,
        outcome: null, pngPath: null, secondsToAcceptance: null, setupSeconds: null,
        operations: null, revisions: null, coreContent: null, unsupportedClaims: null,
        koreanReadability: null, layout: null, tokenObservation: 'unavailable',
        preparationTokens: null, generationTokens: null, reviewTokens: null, retryTokens: null,
        totalTokens: null, notes: '' });
    }
  }
  // Counterbalance condition order; assignments are kept separately from blinded outputs.
  return rows.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.repeat - b.repeat
    || (CONDITIONS.indexOf(a.condition) + a.repeat) % 4 - (CONDITIONS.indexOf(b.condition) + b.repeat) % 4);
}
export function measuredTokenTotal(row) {
  const keys = ['preparationTokens', 'generationTokens', 'reviewTokens', 'retryTokens'];
  if (row.tokenObservation !== 'complete' || keys.some(key => !Number.isSafeInteger(row[key]) || row[key] < 0)) return null;
  return keys.reduce((sum, key) => sum + row[key], 0);
}
export function summarizeEvaluation(rows) {
  return CONDITIONS.map(condition => {
    const done = rows.filter(row => row.condition === condition && row.status === 'completed');
    const totals = done.map(measuredTokenTotal).filter(value => value !== null);
    return { condition, completed: done.length, accepted: done.filter(row => row.outcome === 'accepted').length,
      fullyObservedUsageRuns: totals.length, meanMeasuredTokens: totals.length ? totals.reduce((sum, n) => sum + n, 0) / totals.length : null };
  });
}
async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const fixture = JSON.parse(await fs.readFile(path.join(root, 'packages/guidance/evaluation/intro-cases.json'), 'utf8'));
  const skill = JSON.parse(await fs.readFile(path.join(root, 'packages/guidance/baoyu-source.json'), 'utf8'));
  const out = path.resolve(root, process.argv[2] || 'work/intro-evaluation');
  await fs.mkdir(out, { recursive: true });
  const rows = prepareEvaluation(fixture.cases, skill.commit);
  // Deliberately refuse overwriting collected measurements on a repeated command.
  await fs.writeFile(path.join(out, 'runs.private.json'), JSON.stringify(rows, null, 2), { flag: 'wx' });
  const blind = rows.map(({ blindId, caseId }) => ({ blindId, caseId, pngPath: null,
    coreContent: null, unsupportedClaims: null, koreanReadability: null, layout: null, notes: '' }));
  await fs.writeFile(path.join(out, 'judge-sheet.json'), JSON.stringify(blind, null, 2), { flag: 'wx' });
  await fs.writeFile(path.join(out, 'cases.json'), JSON.stringify(fixture, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ scheduled: rows.length, executed: 0, output: out, evidence: 'evaluation-material-only' }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
